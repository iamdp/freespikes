/**
 * Free Spikes Worker
 * - Serves static assets from public/
 * - Handles POST /api/submit (stories + contact)
 * - Handles GET /admin (password-protected dashboard + CSV)
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // API: form submissions
    if (path === '/api/submit' && request.method === 'POST') {
      return handleSubmit(request, env);
    }

    // Admin dashboard
    if (path === '/admin' && request.method === 'GET') {
      return handleAdmin(request, env);
    }

    // Everything else: static assets
    return env.ASSETS.fetch(request);
  },
};

async function handleSubmit(request, env) {
  try {
    const formData = await request.formData();
    const formType = formData.get('form_type') || 'story';

    const name = formData.get('name') || '';
    const email = formData.get('email') || '';
    const trail = formData.get('trail') || '';
    const content = formData.get('story') || formData.get('message') || '';
    const permission = formData.get('permission') === 'yes' ? 1 : 0;
    const photo = formData.get('photo');

    if (!content.trim()) {
      return json({ error: 'Content is required' }, 400);
    }

    let photoKey = null;
    if (photo && photo.size > 0 && photo.type.startsWith('image/')) {
      if (photo.size > 10 * 1024 * 1024) {
        return json({ error: 'Photo too large (max 10MB)' }, 400);
      }
      const ext = (photo.name.split('.').pop() || 'jpg').toLowerCase();
      photoKey = `stories/${crypto.randomUUID()}.${ext}`;
      await env.BUCKET.put(photoKey, photo.stream(), {
        httpMetadata: { contentType: photo.type },
      });
    }

    const result = await env.DB.prepare(
      `INSERT INTO submissions (form_type, name, email, trail, content, permission, photo_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(formType, name, email, trail, content, permission, photoKey).run();

    // Email notification (best-effort)
    try {
      if (env.EMAIL && env.NOTIFY_EMAIL) {
        const subject = formType === 'story' ? 'New Free Spikes story' : 'New Free Spikes contact';
        const text = [
          `Type: ${formType}`,
          `Name: ${name || '(none)'}`,
          email ? `Email: ${email}` : '',
          trail ? `Trail: ${trail}` : '',
          `Content:\n${content}`,
          permission ? 'Permission to share: yes' : '',
          photoKey ? `Photo key: ${photoKey}` : '',
        ].filter(Boolean).join('\n\n');

        await env.EMAIL.send({
          to: env.NOTIFY_EMAIL,
          from: `noreply@${env.DOMAIN || 'freespikes.com'}`,
          subject,
          text,
        });
      }
    } catch (emailErr) {
      console.error('Email send failed:', emailErr);
    }

    return json({ ok: true, id: result.meta?.last_row_id });
  } catch (err) {
    console.error(err);
    return json({ error: 'Server error' }, 500);
  }
}

async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const password = url.searchParams.get('password') || '';

  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return new Response(
      `<!DOCTYPE html><html><head><title>Admin</title></head><body>
        <h1>Free Spikes Admin</h1>
        <form method="GET">
          <label>Password: <input type="password" name="password"></label>
          <button type="submit">Login</button>
        </form>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }

  const { results } = await env.DB.prepare(
    `SELECT id, form_type, name, email, trail, content, permission, photo_key, created_at
     FROM submissions ORDER BY created_at DESC LIMIT 200`
  ).all();

  if (url.searchParams.get('export') === 'csv') {
    const csv = toCSV(results);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="freespikes-submissions.csv"',
      },
    });
  }

  const rows = results.map(r => `
    <tr>
      <td>${r.id}</td>
      <td>${escapeHtml(r.form_type)}</td>
      <td>${escapeHtml(r.name || '')}</td>
      <td>${escapeHtml(r.email || '')}</td>
      <td>${escapeHtml(r.trail || '')}</td>
      <td style="max-width:300px;white-space:pre-wrap">${escapeHtml(r.content || '')}</td>
      <td>${r.permission ? 'yes' : ''}</td>
      <td>${r.photo_key ? escapeHtml(r.photo_key) : ''}</td>
      <td>${escapeHtml(r.created_at)}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Free Spikes Submissions</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; vertical-align: top; }
    th { background: #0a6ebd; color: white; }
    a { color: #0a6ebd; }
  </style>
</head>
<body>
  <h1>Free Spikes Submissions</h1>
  <p><a href="?password=${encodeURIComponent(password)}&export=csv">Download CSV</a></p>
  <table>
    <thead>
      <tr>
        <th>ID</th><th>Type</th><th>Name</th><th>Email</th><th>Trail</th><th>Content</th><th>Share?</th><th>Photo</th><th>Created</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

function toCSV(rows) {
  if (!rows.length) return 'id,form_type,name,email,trail,content,permission,photo_key,created_at\n';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map(h => {
      const v = row[h] == null ? '' : String(row[h]);
      return `"${v.replace(/"/g, '""')}"`;
    });
    lines.push(values.join(','));
  }
  return lines.join('\n');
}

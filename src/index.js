/**
 * Free Spikes Worker
 * - Serves static assets from public/
 * - Handles POST /api/submit (stories + contact)
 * - Handles /admin with cookie-based auth (password never in URL)
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // API: form submissions
    if (path === '/api/submit' && request.method === 'POST') {
      return handleSubmit(request, env);
    }

    // Admin dashboard (GET shows form or dashboard; POST handles login)
    if (path === '/admin') {
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
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  let authenticated = cookies.admin_auth === '1';

  // Handle login POST
  if (request.method === 'POST') {
    const formData = await request.formData();
    const password = formData.get('password') || '';
    if (env.ADMIN_PASSWORD && password === env.ADMIN_PASSWORD) {
      // Set cookie and redirect so password is never in the URL
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/admin',
          'Set-Cookie': 'admin_auth=1; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=86400',
        },
      });
    } else {
      // Wrong password — show form again with error
      return loginForm(true);
    }
  }

  // GET requests: check cookie
  if (!authenticated) {
    return loginForm(false);
  }

  // Authenticated — show dashboard or CSV
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
    .logout { float: right; }
  </style>
</head>
<body>
  <h1>Free Spikes Submissions</h1>
  <p>
    <a href="/admin?export=csv">Download CSV</a>
    <a href="/admin/logout" class="logout" onclick="document.cookie='admin_auth=; Path=/admin; Max-Age=0'; location.reload(); return false;">Logout</a>
  </p>
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

function loginForm(showError) {
  const error = showError ? '<p style="color:#c00">Incorrect password.</p>' : '';
  return new Response(
    `<!DOCTYPE html><html><head><title>Admin Login</title>
     <style>body{font-family:system-ui,sans-serif;margin:3rem auto;max-width:400px;} input{padding:0.5rem;width:100%;margin:0.5rem 0;} button{padding:0.6rem 1.2rem;background:#0a6ebd;color:white;border:none;border-radius:4px;}</style>
     </head><body>
      <h1>Free Spikes Admin</h1>
      ${error}
      <form method="POST">
        <label>Password: <input type="password" name="password" required autofocus></label>
        <button type="submit">Login</button>
      </form>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

function parseCookies(cookieHeader) {
  const cookies = {};
  cookieHeader.split(';').forEach(pair => {
    const [name, ...rest] = pair.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  });
  return cookies;
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

/**
 * Free Spikes Worker
 * - Serves static assets from public/
 * - Handles POST /api/submit (stories + contact)
 * - Handles /admin with signed-cookie auth + failed-login delay
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/submit' && request.method === 'POST') {
      return handleSubmit(request, env);
    }

    if (path === '/admin') {
      return handleAdmin(request, env);
    }

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

// ----- Admin auth (HMAC-signed cookie + delay) -----
const COOKIE_NAME = 'admin_auth';
const COOKIE_MAX_AGE = 86400; // 24h
const FAILED_DELAY_MS = 1500;

async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies[COOKIE_NAME];
  const authenticated = token ? await verifyToken(token, env.ADMIN_PASSWORD) : false;

  if (request.method === 'POST') {
    const formData = await request.formData();
    const password = formData.get('password') || '';
    if (env.ADMIN_PASSWORD && password === env.ADMIN_PASSWORD) {
      const signed = await createToken(env.ADMIN_PASSWORD);
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/admin',
          'Set-Cookie': `${COOKIE_NAME}=${signed}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`,
        },
      });
    } else {
      // Short delay to slow brute-force
      await new Promise(r => setTimeout(r, FAILED_DELAY_MS));
      return loginForm(true);
    }
  }

  if (!authenticated) {
    return loginForm(false);
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
    .logout { float: right; }
  </style>
</head>
<body>
  <h1>Free Spikes Submissions</h1>
  <p>
    <a href="/admin?export=csv">Download CSV</a>
    <a href="#" class="logout" onclick="document.cookie='${COOKIE_NAME}=; Path=/admin; Max-Age=0'; location.reload(); return false;">Logout</a>
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

async function createToken(secret) {
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE;
  const payload = `v1.${exp}`;
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

async function verifyToken(token, secret) {
  if (!secret || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const exp = parseInt(parts[1], 10);
  if (isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = await hmac(secret, payload);
  // Constant-time compare
  if (expected.length !== parts[2].length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ parts[2].charCodeAt(i);
  }
  return diff === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
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

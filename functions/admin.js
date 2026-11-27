/**
 * GET /admin
 * Simple password-protected dashboard for viewing submissions.
 * Query ?password=xxx or use basic auth header later.
 * Also supports /admin?export=csv for download.
 */
export async function onRequestGet(context) {
  const { request, env } = context;
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

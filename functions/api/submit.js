/**
 * POST /api/submit
 * Handles story and contact form submissions.
 * Stores in D1, uploads photo to R2 (stories), sends email notification.
 */
export async function onRequestPost(context) {
  const { request, env } = context;

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

# Free Spikes — Cloudflare Pages setup notes

## Required bindings (set in Cloudflare Pages project Settings > Bindings)

- **DB** (D1 Database) — create database and run schema.sql
- **BUCKET** (R2 Bucket) — for story photos
- **EMAIL** (Send Email binding) — Cloudflare Email Service
- **NOTIFY_EMAIL** (plain text) — your email address for notifications
- **ADMIN_PASSWORD** (plain text or secret) — password for /admin
- **DOMAIN** (plain text, optional) — freespikes.com

## Deploy

1. Create D1 database in Cloudflare dashboard.
2. Run the SQL in schema.sql against it (via Wrangler or dashboard).
3. Create R2 bucket.
4. Enable Email Sending for freespikes.com (or use Email Routing destination).
5. Connect GitHub repo or upload the freespikes-site folder via Wrangler / Direct Upload.
   Note: Functions require Wrangler or Git deploy (drag-and-drop does not compile functions).
6. Add the bindings listed above.
7. Deploy. Forms post to /api/submit. Admin at /admin?password=...

## Local testing

```bash
npx wrangler pages dev . --d1=DB --r2=BUCKET
```
(adjust as needed)

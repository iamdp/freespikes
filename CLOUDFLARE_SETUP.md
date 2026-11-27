# Free Spikes — Cloudflare Worker setup notes

Worker name: **shy-dawn-d7a9**

## Structure
- Static assets live in `public/`
- Worker entry point is `src/index.js` (handles /api/submit and /admin, falls back to assets)
- Configured via `wrangler.toml`

## Required bindings (set in Cloudflare Worker Settings > Bindings)

- **DB** (D1 Database) — create database and run schema.sql
- **BUCKET** (R2 Bucket) — for story photos
- **EMAIL** (Send Email binding) — Cloudflare Email Service
- **NOTIFY_EMAIL** (plain text) — your email address for notifications
- **ADMIN_PASSWORD** (plain text or secret) — password for /admin
- **DOMAIN** (plain text, optional) — freespikes.com

## Deploy

The Worker is connected to the Git repo. The deploy command should be:

```
npx wrangler deploy
```

(or leave it empty if the dashboard uses the default). Wrangler will use `wrangler.toml`.

You may need `CLOUDFLARE_API_TOKEN` in the environment variables.

## Steps

1. Create D1 database and run schema.sql.
2. Create R2 bucket.
3. Enable Email Sending / verify destination email.
4. Deploy (or push to main).
5. After successful deploy, add the bindings listed above in the Worker settings.
6. Forms post to /api/submit. Admin at /admin?password=...

## Local testing

```bash
npx wrangler dev
```

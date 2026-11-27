# Free Spikes — Cloudflare Pages setup notes

Project name: **shy-dawn-d7a9**

## Structure
- Static assets live in `public/`
- Pages Functions live in `functions/` at the repo root

## Required bindings (set in Cloudflare Pages project Settings > Bindings)

- **DB** (D1 Database) — create database and run schema.sql
- **BUCKET** (R2 Bucket) — for story photos
- **EMAIL** (Send Email binding) — Cloudflare Email Service
- **NOTIFY_EMAIL** (plain text) — your email address for notifications
- **ADMIN_PASSWORD** (plain text or secret) — password for /admin
- **DOMAIN** (plain text, optional) — freespikes.com

## Deploy command

Set the Deploy command in Pages project settings to:

```
npx wrangler pages deploy public --project-name=shy-dawn-d7a9
```

(You may also need a CLOUDFLARE_API_TOKEN secret in the Pages environment variables.)

Leave the Build command empty.

## Steps

1. Create D1 database and run schema.sql.
2. Create R2 bucket.
3. Enable Email Sending / verify destination email.
4. Set the Deploy command above and redeploy.
5. After successful deploy, add the bindings listed above.
6. Forms post to /api/submit. Admin at /admin?password=...

## Local testing

```bash
npx wrangler pages dev public --d1=DB --r2=BUCKET
```

# freespikes
Free Spikes for Safer Hikes — static website with Cloudflare Worker.

Static assets are in `public/`. Worker code is in `src/index.js`.

Forms post to /api/submit. Admin dashboard at /admin.

Deploy with:

```
npx wrangler deploy
```

(Configured via wrangler.toml for Worker shy-dawn-d7a9.)

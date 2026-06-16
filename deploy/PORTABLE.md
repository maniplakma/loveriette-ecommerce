# Portable deployment

This project runs on **any VPS** (Contabo, DigitalOcean, AWS, etc.) with **no hardcoded domains, IPs, or provider paths** in application code.

## Configuration source

All runtime settings come from **environment variables** (`.env` on the server). See [`.env.example`](../../.env.example).

Central module: [`server.js/config.js`](../../server.js/config.js)

## Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NODE_ENV` | Recommended | `development` | `production` on VPS |
| `PORT` | No | `3000` | HTTP port Node listens on |
| `HOST` | No | `0.0.0.0` | Bind address (`127.0.0.1` behind Nginx) |
| `PUBLIC_URL` | No | — | Public site URL for logs (no trailing slash) |
| `SESSION_SECRET` | **Yes in production** | — | Session encryption |
| `COOKIE_SECURE` | After SSL | `0` | Set `1` with HTTPS |
| `ADMIN_EMAIL` | First deploy | `admin@localhost` | Seeds admin if DB empty |
| `ADMIN_PASSWORD` | First deploy | local dev only | Seeds admin if DB empty |
| `ADMIN_NAME` | No | `Site Admin` | Admin display name |
| `APP_ROOT` | No | parent of `server.js/` | Project root |
| `FRONTEND_DIR` | No | `{APP_ROOT}/index.html` | Static frontend |
| `SERVER_DIR` | No | `{APP_ROOT}/server.js` | Backend folder |
| `DB_PATH` | No | `{SERVER_DIR}/ecom.db` | SQLite file |
| `UPLOADS_DIR` | No | `{SERVER_DIR}/uploads` | Receipts, avatars, QR |
| `BRANDING_UPLOADS_DIR` | No | `{FRONTEND_DIR}/uploads` | Store logo uploads |
| `LOG_DIR` | No | `{APP_ROOT}/logs` | App / PM2 logs |
| `JSON_BODY_LIMIT` | No | `12mb` | Max upload body size |
| `PM2_APP_NAME` | No | `ecommerce` | PM2 process name |
| `PM2_MAX_MEMORY` | No | `512M` | PM2 restart threshold |
| `DEFAULT_SOCIAL_LINKS_JSON` | No | `[]` | Fallback social links |
| `TUNNEL_TARGET_HOST` | No | `127.0.0.1` | Dev tunnel target |
| `TEST_BASE` | No | `http://127.0.0.1:{PORT}` | Test runner URL |

## Portable paths

Paths resolve from the **application folder** unless overridden:

```
{APP_ROOT}/
  .env
  ecosystem.config.cjs
  index.html/          ← FRONTEND_DIR
  server.js/           ← SERVER_DIR
    ecom.db            ← DB_PATH
    uploads/           ← UPLOADS_DIR
  logs/                ← LOG_DIR
```

Deploy to `/var/www/ecommerce`, `/opt/shop`, or `/home/user/app` — same behavior.

## Build & start (any server)

```bash
npm ci --omit=dev
npm run build
cp .env.example .env && nano .env
pm2 start ecosystem.config.cjs --env production
```

## Nginx

Use [`deploy/nginx/ecommerce.conf`](nginx/ecommerce.conf). Replace `SHOP_DOMAIN` with your domain — not stored in app code.

## Related docs

- [CONTABO-VPS.md](CONTABO-VPS.md) — example Contabo setup (paths are examples only)
- [BACKUP-MIGRATION.md](BACKUP-MIGRATION.md) — backup, restore, migrate VPS

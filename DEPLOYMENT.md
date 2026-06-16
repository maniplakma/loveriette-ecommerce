# Loveriette — Contabo VPS Deployment Guide

Deploy the Loveriette e-commerce site on **Ubuntu 24.04** (Contabo VPS) using **Node.js**, **PM2**, and **Nginx** with optional **Let's Encrypt** SSL.

This project is a **static frontend** (`index.html/`) served by an **Express API** (`server.js/`). There is no separate webpack/vite build — the production “build” verifies the tree, creates upload/log directories, and installs production dependencies.

---

## Architecture

```
Internet → Nginx (80/443) → Node/Express (127.0.0.1:3000)
                              ├── SQLite: server.js/ecom.db
                              └── Uploads: server.js/uploads/
```

---

## 1. Server prerequisites

SSH into your Contabo VPS as root or a sudo user.

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx ufw
```

### Install Node.js 22+ (required for `node:sqlite`)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should be v22.x or higher
```

### Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## 2. Deploy application files

### Option A — Git clone

```bash
sudo mkdir -p /var/www
sudo chown "$USER":"$USER" /var/www
cd /var/www
git clone <YOUR_REPO_URL> loveriette
cd loveriette
```

### Option B — Upload from your PC (rsync)

From your local machine (replace `USER` and `VPS_IP`):

```bash
rsync -avz --exclude node_modules --exclude .env \
  ./ /var/www/loveriette/
```

On the VPS:

```bash
cd /var/www/loveriette
```

---

## 3. Production build

```bash
cd /var/www/loveriette
npm ci --omit=dev
npm run build
```

`npm run build` runs `scripts/prepare-production.js`, which:

- Verifies Node 22+
- Checks required files exist
- Creates `logs/` and upload directories

---

## 4. Environment variables

Copy the template and edit values:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

### Required variables (production)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Recommended | — | Set to `production` |
| `PORT` | No | `3000` | HTTP port for Express |
| `HOST` | No | `0.0.0.0` | Bind all interfaces for external access |
| `SESSION_SECRET` | **Yes** | dev fallback | Long random string for sessions |
| `COOKIE_SECURE` | **Yes** (HTTPS) | off | Set `1` when using HTTPS |
| `ADMIN_EMAIL` | First deploy | `admin@loveriette.com` | Admin login email (seed only) |
| `ADMIN_PASSWORD` | First deploy | `loveriette123` | Admin password (seed only) |
| `ADMIN_NAME` | No | `Loveriette Admin` | Admin display name (seed only) |

### Optional (development / CI only)

| Variable | Default | Description |
|----------|---------|-------------|
| `TEST_BASE` | `http://127.0.0.1:3000` | Base URL for `test-workflows.js` |

Generate a session secret:

```bash
openssl rand -hex 32
```

**Important:** `ADMIN_EMAIL` / `ADMIN_PASSWORD` are only used when the database has no admin user. After first boot, change the admin password in the admin panel. Never commit `.env` to git.

### Persistent data (back up regularly)

| Path | Contents |
|------|----------|
| `server.js/ecom.db` | SQLite database (orders, users, products, settings) |
| `server.js/uploads/` | Avatars, receipts, payment QR images, report proofs |
| `index.html/uploads/` | Branding assets uploaded via admin |

---

## 5. PM2 (process manager)

Install PM2 globally:

```bash
sudo npm install -g pm2
```

Start the app (reads `.env` from project root via PM2 + Node):

```bash
cd /var/www/loveriette
mkdir -p logs
pm2 start ecosystem.config.cjs --env production
```

PM2 loads environment from your shell when started. To inject `.env` automatically, use:

```bash
set -a && source .env && set +a && pm2 start ecosystem.config.cjs --env production
```

Or install `pm2-dotenv` / export vars in `ecosystem.config.cjs` if you prefer.

### PM2 commands

```bash
# Status
pm2 status
pm2 show loveriette

# Logs
pm2 logs loveriette
pm2 logs loveriette --lines 100

# Restart / stop
pm2 restart loveriette
pm2 stop loveriette
pm2 delete loveriette

# After code or .env updates
cd /var/www/loveriette
npm ci --omit=dev
npm run build
set -a && source .env && set +a && pm2 restart loveriette

# Persist across reboots
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME"
# Run the command PM2 prints, then:
pm2 save
```

Health check (on the VPS):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
# Expect: 200
```

Optional workflow tests (with server running):

```bash
node server.js/test-workflows.js
```

---

## 6. Nginx reverse proxy

Edit the site config and replace `YOUR_DOMAIN`:

```bash
sudo cp /var/www/loveriette/deploy/nginx/loveriette.conf /etc/nginx/sites-available/loveriette
sudo nano /etc/nginx/sites-available/loveriette
# Replace YOUR_DOMAIN with e.g. loveriette.com
```

Enable the site:

```bash
sudo ln -sf /etc/nginx/sites-available/loveriette /etc/nginx/sites-enabled/loveriette
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

`client_max_body_size 12M` matches the Express JSON/upload limit for receipt images.

---

## 7. SSL with Let's Encrypt (Certbot)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
```

After SSL is active, set in `.env`:

```env
COOKIE_SECURE=1
```

Then restart PM2:

```bash
set -a && source .env && set +a && pm2 restart loveriette
```

Certbot auto-renewal is installed by default. Verify:

```bash
sudo certbot renew --dry-run
```

---

## 8. Post-deploy checklist

1. Open `https://YOUR_DOMAIN` — storefront loads.
2. Log in at `/login.html` with admin credentials (change password immediately).
3. Admin panel `/admin.html` — verify products, payment methods, integrations.
4. Place a test order and confirm buyer/admin notifications.
5. Confirm uploads work (avatar, receipt, payment QR).
6. Set `COOKIE_SECURE=1` and strong `SESSION_SECRET` in production.

---

## 9. Updates & rollback

```bash
cd /var/www/loveriette
git pull   # or rsync new files
npm ci --omit=dev
npm run build
set -a && source .env && set +a && pm2 restart loveriette
```

Before major updates, backup:

```bash
cp server.js/ecom.db "server.js/ecom.db.bak.$(date +%F)"
tar -czf "uploads-backup-$(date +%F).tar.gz" server.js/uploads index.html/uploads
```

---

## 10. Troubleshooting

| Issue | Check |
|-------|--------|
| 502 Bad Gateway | `pm2 status`, `pm2 logs loveriette`, app listening on `127.0.0.1:3000` |
| Sessions not sticking | `COOKIE_SECURE=1` only with HTTPS; `SESSION_SECRET` stable across restarts |
| SQLite errors | Node version ≥ 22; `server.js/ecom.db` writable |
| Upload fails | Nginx `client_max_body_size 12M`; disk space `df -h` |
| Admin login fails | DB already seeded — use admin panel password, not `.env` defaults |

---

## Quick reference

| Item | Value |
|------|--------|
| App root | `/var/www/loveriette` |
| Start script | `server.js/server.js` |
| Internal URL | `http://127.0.0.1:3000` |
| PM2 app name | `loveriette` |
| Nginx config | `/etc/nginx/sites-available/loveriette` |
| Env file | `/var/www/loveriette/.env` |

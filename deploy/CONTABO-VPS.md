# Contabo VPS — Manual Deployment (loveriette ecommerce)

Deploy **only** to `/var/www/ecommerce`. **Do not** change `/var/www/ezyshell` or its PM2/Nginx config.

| App | Path | PM2 name | Internal port |
|-----|------|----------|----------------|
| Existing Next.js | `/var/www/ezyshell` | (your existing name) | typically `3000` |
| **This ecommerce site** | `/var/www/ecommerce` | `ecommerce` | **`3001`** |

---

## Before deployment — requirements

| Item | Required version / notes |
|------|--------------------------|
| **OS** | Ubuntu 24.04 LTS (Contabo VPS) |
| **Node.js** | **22.x or newer** (uses built-in `node:sqlite`) |
| **Database** | **SQLite 3** (embedded file — **no** MySQL/PostgreSQL install) |
| **npm** | Comes with Node.js |
| **PM2** | Latest (`npm install -g pm2`) |
| **Nginx** | System package (reverse proxy) |
| **System packages** | `curl`, `git`, `nginx`, `ufw` (optional) |

### Environment variables (required in `/var/www/ecommerce/.env`)

| Variable | Required | Example / notes |
|----------|----------|-----------------|
| `NODE_ENV` | Yes | `production` |
| `PORT` | Yes | `3001` (must match PM2/Nginx) |
| `HOST` | Yes | `0.0.0.0` (listen on all interfaces; use with UFW + Nginx) |
| `SESSION_SECRET` | Yes | `openssl rand -hex 32` |
| `COOKIE_SECURE` | Yes after SSL | `0` for HTTP only; `1` after HTTPS |
| `ADMIN_EMAIL` | First boot only | Seeds admin if DB has no admin |
| `ADMIN_PASSWORD` | First boot only | Change in admin after login |
| `ADMIN_NAME` | Optional | Display name for seeded admin |
| `TEST_BASE` | Optional | CI/local tests only |

---

## Exact folder structure on VPS

```
/var/www/ecommerce/
├── .env                          # secrets (chmod 600)
├── ecosystem.config.cjs          # PM2: process name "ecommerce"
├── package.json
├── package-lock.json
├── node_modules/                 # from npm ci --omit=dev
├── logs/
│   ├── out.log
│   └── err.log
├── scripts/
│   └── prepare-production.js
├── deploy/
│   └── nginx/
│       └── ecommerce.conf
├── index.html/                   # static frontend (HTML/CSS/JS)
│   ├── index.html
│   ├── admin.html
│   ├── dashboard.html
│   ├── style.css
│   ├── assets/
│   │   └── store-logo.png
│   └── … (all other .html / .js / .css)
└── server.js/                    # Express API + SQLite
    ├── server.js
    ├── db.js
    ├── imap-fetch.js
    ├── ecom.db                     # SQLite database (persistent)
    ├── test-workflows.js           # optional tests
    ├── tunnel.js                   # optional local dev only
    └── uploads/                    # persistent uploads
        ├── avatars/
        ├── receipts/
        ├── report-proofs/
        └── payment-qr/
```

There is **no** separate database server. All data lives in `server.js/ecom.db` and `server.js/uploads/`.

---

## Step 1 — SSH into VPS

```bash
ssh YOUR_USER@YOUR_SERVER_IP
```

---

## Step 2 — Install system packages (if not already installed)

**Does not modify ezyshell.**

```bash
sudo apt update
sudo apt install -y curl git nginx ufw
```

---

## Step 3 — Install Node.js 22 (skip if `node -v` is already v22+)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Expected: `v22.x.x` or higher.

---

## Step 4 — Install PM2 globally

```bash
sudo npm install -g pm2
pm2 -v
```

---

## Step 5 — Create app directory (separate from ezyshell)

```bash
sudo mkdir -p /var/www/ecommerce
sudo chown "$USER":"$USER" /var/www/ecommerce
```

**Do not** run anything inside `/var/www/ezyshell`.

---

## Step 6 — Upload project files to `/var/www/ecommerce`

### Option A — From your PC with `rsync` (recommended)

Run on **your local machine** (replace `YOUR_USER` and `YOUR_SERVER_IP`):

```bash
rsync -avz --progress \
  --exclude node_modules \
  --exclude .env \
  --exclude tunnel-live.txt \
  --exclude tunnel-output.txt \
  --exclude PUBLIC-LINK.txt \
  --exclude logs \
  /path/to/ecom-site/ \
  YOUR_USER@YOUR_SERVER_IP:/var/www/ecommerce/
```

Windows PowerShell (if no rsync, use scp zip):

```powershell
cd C:\Users\kaye\OneDrive\Desktop\ecom-site
tar -czf ecommerce-deploy.tar.gz --exclude=node_modules --exclude=.env --exclude=logs .
scp ecommerce-deploy.tar.gz YOUR_USER@YOUR_SERVER_IP:/tmp/
```

On VPS:

```bash
cd /var/www/ecommerce
tar -xzf /tmp/ecommerce-deploy.tar.gz
rm /tmp/ecommerce-deploy.tar.gz
```

### Option B — Git clone

```bash
cd /var/www/ecommerce
git clone YOUR_REPO_URL .
```

---

## Step 7 — Install dependencies

```bash
cd /var/www/ecommerce
npm ci --omit=dev
```

---

## Step 8 — Production build (prepare dirs + verify Node)

```bash
cd /var/www/ecommerce
npm run build
```

Expected output ends with: `Production prepare complete.`

---

## Step 9 — Create `.env`

```bash
cd /var/www/ecommerce
cp .env.example .env
chmod 600 .env
nano .env
```

**Exact `.env` contents** (edit values):

```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

SESSION_SECRET=PASTE_OUTPUT_OF_openssl_rand_hex_32
COOKIE_SECURE=0

ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=ChangeThisStrongPassword
ADMIN_NAME=Loveriette Admin
```

Generate secret:

```bash
openssl rand -hex 32
```

Use `COOKIE_SECURE=0` until SSL is enabled; then set `COOKIE_SECURE=1` and restart PM2.

---

## Step 10 — Database setup (SQLite)

No `mysql` / `postgres` commands. First server start creates schema automatically.

### Fresh install (empty DB)

```bash
cd /var/www/ecommerce
rm -f server.js/ecom.db
mkdir -p server.js/uploads/avatars server.js/uploads/receipts server.js/uploads/report-proofs server.js/uploads/payment-qr
```

On first `pm2 start`, `db.js` creates `server.js/ecom.db` and seeds admin from `.env`.

### Migrate existing DB from your PC

Copy your local `server.js/ecom.db` and uploads:

```bash
# on PC
scp server.js/ecom.db YOUR_USER@YOUR_SERVER_IP:/var/www/ecommerce/server.js/ecom.db
scp -r server.js/uploads YOUR_USER@YOUR_SERVER_IP:/var/www/ecommerce/server.js/
```

On VPS:

```bash
chmod 644 /var/www/ecommerce/server.js/ecom.db
```

---

## Step 11 — Start with PM2

```bash
cd /var/www/ecommerce
mkdir -p logs
pm2 start ecosystem.config.cjs --env production
pm2 status
pm2 logs ecommerce --lines 30
```

### PM2 commands (ecommerce only)

```bash
pm2 status
pm2 show ecommerce
pm2 logs ecommerce
pm2 logs ecommerce --lines 100
pm2 restart ecommerce
pm2 stop ecommerce
pm2 delete ecommerce
pm2 save
```

Persist PM2 across reboot (run once; follow the command PM2 prints):

```bash
pm2 startup systemd -u "$USER" --hp "$HOME"
pm2 save
```

**Do not** run `pm2 delete all` — that would stop ezyshell too.

---

## Step 12 — Firewall (UFW) + verify app on port 3001

Allow external access on port **3001** (direct Node) and **80/443** (Nginx):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 3001/tcp comment 'ecommerce Node'
sudo ufw allow 'Nginx Full' comment 'HTTP/HTTPS'
sudo ufw enable
sudo ufw status numbered
```

Or run the bundled script (also installs/configures Nginx):

```bash
cd /var/www/ecommerce
chmod +x deploy/setup-external-access.sh
SHOP_DOMAIN=shop.yourdomain.com ./deploy/setup-external-access.sh
```

For **IP-only** access on port 80 (no domain yet):

```bash
ENABLE_IP_DEFAULT=1 ./deploy/setup-external-access.sh
```

Verify locally and externally:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/
curl -s http://127.0.0.1:3001/branding | head -c 200
# From another machine (replace VPS IP):
curl -s -o /dev/null -w "%{http_code}\n" http://YOUR_VPS_IP:3001/
```

Expected: HTTP `200` and JSON with `name`, `logoUrl`.

Confirm ezyshell still running:

```bash
pm2 status
curl -s -o /dev/null -w "ezyshell-check:%{http_code}\n" http://127.0.0.1:3000/
```

(Adjust `3000` if your ezyshell uses a different port.)

---

## Step 13 — Nginx configuration

Use a **subdomain** for the shop (e.g. `shop.yourdomain.com`) so ezyshell keeps its domain.

```bash
sudo cp /var/www/ecommerce/deploy/nginx/ecommerce.conf /etc/nginx/sites-available/ecommerce
sudo nano /etc/nginx/sites-available/ecommerce
```

Replace **both** occurrences of `SHOP_DOMAIN` with your subdomain, e.g. `shop.example.com`.

Enable site (**does not** disable ezyshell site):

```bash
sudo ln -sf /etc/nginx/sites-available/ecommerce /etc/nginx/sites-enabled/ecommerce
sudo nginx -t
sudo systemctl reload nginx
```

**Do not** remove or edit `/etc/nginx/sites-available/` files belonging to ezyshell.

### Port configuration summary

| Layer | Port | Notes |
|-------|------|-------|
| Public HTTP | `80` / `443` | Nginx |
| Direct Node (optional) | `0.0.0.0:3001` | `HOST=0.0.0.0` + UFW `3001/tcp` |
| ecommerce Node (Nginx upstream) | `127.0.0.1:3001` | loopback on same VPS |
| ezyshell Node | `127.0.0.1:3000` (typical) | unchanged |

---

## Step 14 — SSL (optional, do later)

Point DNS `A` record for `shop.yourdomain.com` to VPS IP first.

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d shop.yourdomain.com
```

Then update `.env`:

```bash
nano /var/www/ecommerce/.env
# COOKIE_SECURE=1
pm2 restart ecommerce
```

Test renewal:

```bash
sudo certbot renew --dry-run
```

---

## Step 15 — Optional workflow tests

```bash
cd /var/www/ecommerce
node server.js/test-workflows.js
```

Expected: `88 passed, 0 failed`.

---

## Verification checklist (after deployment)

- [ ] `pm2 status` shows `ecommerce` **online** and ezyshell process still **online**
- [ ] `curl http://YOUR_VPS_IP:3001/` returns `200` (external, if UFW allows 3001)
- [ ] Browser: `http://shop.yourdomain.com` loads storefront
- [ ] Login / signup works
- [ ] Admin panel `/admin.html` loads
- [ ] Product list loads from API
- [ ] Test order + receipt upload works
- [ ] `server.js/ecom.db` exists and grows after orders
- [ ] Uploads save under `server.js/uploads/`
- [ ] Ezyshell site still works on its domain/port

---

## Troubleshooting

| Problem | Command / fix |
|---------|----------------|
| `ecommerce` errored in PM2 | `pm2 logs ecommerce --lines 50` |
| Node version too old | `node -v` must be ≥ 22; reinstall Node 22 |
| `502 Bad Gateway` on shop domain | `pm2 status`; `curl http://127.0.0.1:3001/` |
| Port 3001 in use | `ss -tlnp \| grep 3001` — change `PORT` in `.env` + nginx upstream if needed |
| Sessions not sticking | Match `COOKIE_SECURE` to HTTPS (`1` only with SSL) |
| SQLite permission error | `ls -la server.js/ecom.db`; ensure user running PM2 owns file |
| Upload fails | Nginx `client_max_body_size 12M` in ecommerce.conf |
| Broke ezyshell | `pm2 status`; `sudo nginx -t`; restore ezyshell nginx file from backup — **never edit ezyshell files from this guide** |

---

## Update procedure (future deployments)

```bash
cd /var/www/ecommerce

# Backup data first
cp server.js/ecom.db "server.js/ecom.db.bak.$(date +%F)"
tar -czf "/tmp/ecommerce-uploads-$(date +%F).tar.gz" server.js/uploads index.html/uploads 2>/dev/null || true

# Pull or rsync new code (exclude .env, node_modules, ecom.db)
# git pull   OR   rsync from PC

npm ci --omit=dev
npm run build
pm2 restart ecommerce
pm2 logs ecommerce --lines 20
```

Rollback:

```bash
pm2 stop ecommerce
cp server.js/ecom.db.bak.YYYY-MM-DD server.js/ecom.db
pm2 start ecosystem.config.cjs --env production
```

---

## Quick reference

```bash
# App root
/var/www/ecommerce

# Start
cd /var/www/ecommerce && pm2 start ecosystem.config.cjs --env production

# Build
cd /var/www/ecommerce && npm ci --omit=dev && npm run build

# Logs
pm2 logs ecommerce

# Nginx site file
/etc/nginx/sites-available/ecommerce

# Database file
/var/www/ecommerce/server.js/ecom.db
```

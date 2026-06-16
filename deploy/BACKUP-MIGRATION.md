# Backup, restore & migration

Portable guide for moving this ecommerce site between servers or providers.

**Database:** SQLite file (not MySQL/PostgreSQL).  
**Persistent data:** `ecom.db` + upload folders.

Paths below use defaults. If you set `DB_PATH`, `UPLOADS_DIR`, or `BRANDING_UPLOADS_DIR` in `.env`, substitute those paths.

---

## What to back up

| Item | Default path | Contains |
|------|--------------|----------|
| Database | `server.js/ecom.db` | Users, orders, products, settings |
| Server uploads | `server.js/uploads/` | Receipts, avatars, payment QR, proofs |
| Branding uploads | `index.html/uploads/` | Store logo / branding images |
| Environment | `.env` | Secrets and config (**store securely**) |

Optional: entire app folder excluding `node_modules/`.

---

## Backup commands (on running server)

```bash
# Set your app root
APP_ROOT=/var/www/ecommerce
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/tmp/ecommerce-backup-$STAMP"

mkdir -p "$BACKUP_DIR"

# Stop writes optional (recommended for large sites)
pm2 stop ecommerce

cp "$APP_ROOT/.env" "$BACKUP_DIR/.env"
cp "$APP_ROOT/server.js/ecom.db" "$BACKUP_DIR/ecom.db"

tar -czf "$BACKUP_DIR/uploads-server.tar.gz" -C "$APP_ROOT/server.js" uploads
tar -czf "$BACKUP_DIR/uploads-branding.tar.gz" -C "$APP_ROOT/index.html" uploads 2>/dev/null || true

pm2 start ecommerce

tar -czf "/tmp/ecommerce-backup-$STAMP.tar.gz" -C /tmp "ecommerce-backup-$STAMP"
echo "Archive: /tmp/ecommerce-backup-$STAMP.tar.gz"
```

Download to your PC:

```bash
scp user@OLD_SERVER:/tmp/ecommerce-backup-*.tar.gz ./
```

---

## Restore on a new VPS (migration)

### 1. Install prerequisites

```bash
sudo apt update
sudo apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 2. Deploy application files

```bash
sudo mkdir -p /var/www/ecommerce
sudo chown "$USER":"$USER" /var/www/ecommerce
# rsync or scp project into /var/www/ecommerce (exclude node_modules)
cd /var/www/ecommerce
npm ci --omit=dev
npm run build
```

### 3. Restore data

```bash
cd /var/www/ecommerce
tar -xzf /path/to/ecommerce-backup-YYYYMMDD-HHMMSS.tar.gz -C /tmp
RESTORE=/tmp/ecommerce-backup-YYYYMMDD-HHMMSS

cp "$RESTORE/.env" .env
chmod 600 .env

cp "$RESTORE/ecom.db" server.js/ecom.db
chmod 644 server.js/ecom.db

tar -xzf "$RESTORE/uploads-server.tar.gz" -C server.js
tar -xzf "$RESTORE/uploads-branding.tar.gz" -C index.html 2>/dev/null || true
```

### 4. Update `.env` for new server

```bash
nano .env
```

Typical changes when migrating:

```env
PUBLIC_URL=https://shop.your-new-domain.com
PORT=3001
HOST=127.0.0.1
COOKIE_SECURE=1
```

No code changes required for a new domain.

### 5. Start application

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:${PORT:-3001}/
```

### 6. Point Nginx + DNS to new server

```bash
sudo cp deploy/nginx/ecommerce.conf /etc/nginx/sites-available/ecommerce
sudo nano /etc/nginx/sites-available/ecommerce   # SHOP_DOMAIN
sudo ln -sf /etc/nginx/sites-available/ecommerce /etc/nginx/sites-enabled/ecommerce
sudo nginx -t && sudo systemctl reload nginx
```

Update DNS A record to the new VPS IP. Re-run Certbot if using SSL:

```bash
sudo certbot --nginx -d shop.your-domain.com
```

---

## Migrate with custom paths (.env)

If production uses custom paths:

```env
APP_ROOT=/data/apps/shop
DB_PATH=/data/shop/database/ecom.db
UPLOADS_DIR=/data/shop/uploads
BRANDING_UPLOADS_DIR=/data/shop/branding
LOG_DIR=/data/shop/logs
```

Back up and restore **those paths** instead of defaults.

---

## Scheduled backup (cron example)

```bash
crontab -e
```

```cron
0 3 * * * APP_ROOT=/var/www/ecommerce STAMP=$(date +\%Y\%m\%d) && cp "$APP_ROOT/server.js/ecom.db" "$APP_ROOT/server.js/ecom.db.bak.$STAMP" && tar -czf "/var/backups/ecommerce-$STAMP.tar.gz" -C "$APP_ROOT" server.js/ecom.db server.js/uploads index.html/uploads .env
```

Create `/var/backups` first:

```bash
sudo mkdir -p /var/backups
sudo chown "$USER":"$USER" /var/backups
```

---

## Verify after restore

```bash
cd /var/www/ecommerce
node server.js/test-workflows.js
```

Expected: all tests passed.

Manual checks:

- [ ] Storefront loads
- [ ] Admin login works
- [ ] Products visible
- [ ] Old orders visible in admin
- [ ] Receipt / logo images load from `/uploads/`

---

## Rollback

```bash
pm2 stop ecommerce
cp server.js/ecom.db.bak.YYYY-MM-DD server.js/ecom.db
pm2 start ecosystem.config.cjs --env production
```

---

## Clean install (no data migration)

```bash
rm -f server.js/ecom.db
pm2 restart ecommerce
```

First start creates a new database; admin seeded from `ADMIN_*` in `.env`.

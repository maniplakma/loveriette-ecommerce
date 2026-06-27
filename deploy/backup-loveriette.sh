#!/usr/bin/env bash
# Backup loveriette (ecommerce) on Contabo VPS.
# Safe: stops PM2 briefly for a consistent SQLite copy, then restarts.
#
# Usage:
#   cd /var/www/ecommerce
#   chmod +x deploy/backup-loveriette.sh
#   ./deploy/backup-loveriette.sh
#
# Optional:
#   APP_ROOT=/var/www/ecommerce BACKUP_ROOT=/var/backups ./deploy/backup-loveriette.sh

set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/ecommerce}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/loveriette}"
PM2_NAME="${PM2_NAME:-ecommerce}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="/tmp/loveriette-backup-$STAMP"
ARCHIVE="$BACKUP_ROOT/loveriette-backup-$STAMP.tar.gz"

DB_PATH="${DB_PATH:-$APP_ROOT/server.js/ecom.db}"
ENV_FILE="${ENV_FILE:-$APP_ROOT/.env}"
UPLOADS_SERVER="${UPLOADS_SERVER:-$APP_ROOT/server.js/uploads}"
UPLOADS_BRANDING="${UPLOADS_BRANDING:-$APP_ROOT/index.html/uploads}"

if [[ ! -d "$APP_ROOT" ]]; then
  echo "ERROR: APP_ROOT not found: $APP_ROOT"
  exit 1
fi

mkdir -p "$BACKUP_ROOT" "$WORK"

echo "==> Loveriette backup started ($STAMP)"
echo "    App:    $APP_ROOT"
echo "    Output: $ARCHIVE"

echo "==> Stopping $PM2_NAME (brief pause for clean DB copy)..."
pm2 stop "$PM2_NAME" >/dev/null 2>&1 || true

if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$WORK/.env"
  chmod 600 "$WORK/.env"
  echo "    .env copied"
else
  echo "    WARN: no .env at $ENV_FILE"
fi

if [[ -f "$DB_PATH" ]]; then
  cp "$DB_PATH" "$WORK/ecom.db"
  echo "    ecom.db copied ($(du -h "$WORK/ecom.db" | cut -f1))"
else
  echo "    WARN: no database at $DB_PATH"
fi

if [[ -d "$UPLOADS_SERVER" ]]; then
  tar -czf "$WORK/uploads-server.tar.gz" -C "$(dirname "$UPLOADS_SERVER")" "$(basename "$UPLOADS_SERVER")"
  echo "    server uploads archived"
fi

if [[ -d "$UPLOADS_BRANDING" ]]; then
  tar -czf "$WORK/uploads-branding.tar.gz" -C "$(dirname "$UPLOADS_BRANDING")" "$(basename "$UPLOADS_BRANDING")"
  echo "    branding uploads archived"
fi

cat > "$WORK/README.txt" <<EOF
Loveriette backup
Created: $STAMP
APP_ROOT=$APP_ROOT
DB_PATH=$DB_PATH

Restore:
  cd /var/www/ecommerce
  ./deploy/restore-loveriette.sh $ARCHIVE
EOF

echo "==> Starting $PM2_NAME..."
pm2 start "$PM2_NAME" >/dev/null 2>&1 || pm2 restart "$PM2_NAME"

tar -czf "$ARCHIVE" -C /tmp "$(basename "$WORK")"
rm -rf "$WORK"

echo ""
echo "==> DONE"
echo "Archive: $ARCHIVE"
echo "Size:    $(du -h "$ARCHIVE" | cut -f1)"
echo ""
echo "Download to PC (run on your Windows machine):"
echo "  scp user@YOUR_VPS_IP:$ARCHIVE ."
echo ""
echo "List backups:"
echo "  ls -lh $BACKUP_ROOT"

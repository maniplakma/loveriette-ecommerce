#!/usr/bin/env bash
# Restore loveriette from backup archive created by backup-loveriette.sh
#
# Usage:
#   cd /var/www/ecommerce
#   chmod +x deploy/restore-loveriette.sh
#   ./deploy/restore-loveriette.sh /var/backups/loveriette/loveriette-backup-YYYYMMDD-HHMMSS.tar.gz

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/loveriette-backup-YYYYMMDD-HHMMSS.tar.gz"
  exit 1
fi

ARCHIVE="$1"
APP_ROOT="${APP_ROOT:-/var/www/ecommerce}"
PM2_NAME="${PM2_NAME:-ecommerce}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RESTORE="/tmp/loveriette-restore-$STAMP"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "ERROR: archive not found: $ARCHIVE"
  exit 1
fi

mkdir -p "$RESTORE"
tar -xzf "$ARCHIVE" -C "$RESTORE" --strip-components=1 2>/dev/null || tar -xzf "$ARCHIVE" -C "$RESTORE"

echo "==> Restoring loveriette from $ARCHIVE"
echo "==> Stopping $PM2_NAME..."
pm2 stop "$PM2_NAME" >/dev/null 2>&1 || true

# Safety copy of current state before overwrite
if [[ -f "$APP_ROOT/server.js/ecom.db" ]]; then
  cp "$APP_ROOT/server.js/ecom.db" "$APP_ROOT/server.js/ecom.db.before-restore-$STAMP"
  echo "    Current DB saved as ecom.db.before-restore-$STAMP"
fi

if [[ -f "$RESTORE/.env" ]]; then
  cp "$RESTORE/.env" "$APP_ROOT/.env"
  chmod 600 "$APP_ROOT/.env"
  echo "    .env restored"
fi

if [[ -f "$RESTORE/ecom.db" ]]; then
  cp "$RESTORE/ecom.db" "$APP_ROOT/server.js/ecom.db"
  chmod 644 "$APP_ROOT/server.js/ecom.db"
  echo "    ecom.db restored"
fi

if [[ -f "$RESTORE/uploads-server.tar.gz" ]]; then
  tar -xzf "$RESTORE/uploads-server.tar.gz" -C "$APP_ROOT/server.js"
  echo "    server uploads restored"
fi

if [[ -f "$RESTORE/uploads-branding.tar.gz" ]]; then
  mkdir -p "$APP_ROOT/index.html"
  tar -xzf "$RESTORE/uploads-branding.tar.gz" -C "$APP_ROOT/index.html"
  echo "    branding uploads restored"
fi

echo "==> Starting $PM2_NAME..."
pm2 restart "$PM2_NAME"

echo ""
echo "==> Restore complete. Verify:"
echo "  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/"
echo "  cd $APP_ROOT && npm run test:workflows"

rm -rf "$RESTORE"

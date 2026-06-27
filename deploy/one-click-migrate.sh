#!/usr/bin/env bash
# One command migration: ezyshell MongoDB → loveriette SQLite
# Run on VPS (Termius):
#   curl -sL https://raw.githubusercontent.com/maniplakma/loveriette-ecommerce/main/deploy/one-click-migrate.sh | bash
set -euo pipefail

REPO="https://raw.githubusercontent.com/maniplakma/loveriette-ecommerce/main"
ECOM="/var/www/ecommerce"
BACKEND="/var/www/ezyshell/backend"
SCRIPTS="$ECOM/scripts"

echo "==> Download scripts..."
mkdir -p "$SCRIPTS"
curl -sL "$REPO/scripts/ezyshell-mongo-export.js" -o "$SCRIPTS/ezyshell-mongo-export.js"
curl -sL "$REPO/scripts/migrate-ezyshell.js" -o "$SCRIPTS/migrate-ezyshell.js"

echo "==> Backup loveriette DB..."
mkdir -p /var/backups/loveriette
cp "$ECOM/server.js/ecom.db" "/var/backups/loveriette/ecom.db.bak-$(date +%F-%H%M)" 2>/dev/null || true

echo "==> Export ezyshell (MongoDB)..."
cd "$BACKEND"
node "$SCRIPTS/ezyshell-mongo-export.js" --store-slug loveriette --out "$ECOM/ezyshell-export.json"

echo "==> Import into loveriette..."
cd "$ECOM"
node "$SCRIPTS/migrate-ezyshell.js" import --file "$ECOM/ezyshell-export.json"

echo "==> Restart shop..."
pm2 restart ecommerce

echo ""
echo "DONE! Test: login on loveriette with your old ezyshell email + password."

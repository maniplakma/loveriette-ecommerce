#!/usr/bin/env bash
# Full production deploy on Contabo VPS — run as root via Termius/VNC.
# One line:
#   curl -fsSL https://raw.githubusercontent.com/maniplakma/loveriette-ecommerce/main/scripts/vps-deploy-production.sh | bash
#
# Preserves .env, server.js/ecom.db, and server.js/uploads/

set -euo pipefail

APP="${APP:-/var/www/ecommerce}"
PM2_NAME="${PM2_NAME:-ecommerce}"
PORT="${PORT:-3001}"
REPO="${REPO:-https://github.com/maniplakma/loveriette-ecommerce.git}"
BRANCH="${BRANCH:-main}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -d "$APP" ]]; then
  echo "ERROR: $APP not found. Set APP=/path/to/ecommerce" >&2
  exit 1
fi

cd "$APP"

echo "==> Pre-deploy backup ($STAMP)"
mkdir -p /var/backups/loveriette
if [[ -f server.js/ecom.db ]]; then
  cp server.js/ecom.db "server.js/ecom.db.pre-deploy-$STAMP"
  cp server.js/ecom.db "/var/backups/loveriette/ecom.db.$STAMP"
  echo "    DB: ecom.db.pre-deploy-$STAMP"
fi

echo "==> Pull latest from $BRANCH"
if [[ -d .git ]]; then
  git fetch origin "$BRANCH"
  git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
  git reset --hard "origin/$BRANCH"
  echo "    Commit: $(git rev-parse --short HEAD)"
  echo "    Games features need PR #14/#15 merged into main, or deploy with:"
  echo "    BRANCH=cursor/games-timer-winners-expand-ec32 curl -fsSL .../vps-deploy-production.sh | bash"
else
  echo "    No .git — cloning into temp and syncing..."
  TMP="$(mktemp -d)"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$TMP"
  rsync -a --delete \
    --exclude .env \
    --exclude node_modules \
    --exclude logs \
    --exclude server.js/ecom.db \
    --exclude 'server.js/ecom.db.*' \
    --exclude server.js/uploads \
    "$TMP/" "$APP/"
  rm -rf "$TMP"
fi

echo "==> Install dependencies"
npm ci --omit=dev

echo "==> Production prepare"
npm run build

echo "==> Database integrity"
if ! node -e "require('./server.js/db.js')" 2>/dev/null; then
  echo "WARN: DB check failed — running repair..."
  bash scripts/repair-db.sh
  node -e "require('./server.js/db.js')"
fi

echo "==> Restart PM2 ($PM2_NAME)"
pm2 restart "$PM2_NAME" 2>/dev/null || pm2 start ecosystem.config.cjs --env production
pm2 save

echo "==> Purge ghost orders (no valid payment proof in DB)"
node scripts/purge-ghost-orders.js || true

echo "==> Health checks"
sleep 3
HOME_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" || echo 000)"
MOD_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/modules" || echo 000)"
LEND_REDIRECT="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/lending" || echo 000)"

echo "    GET /           => $HOME_CODE"
echo "    GET /api/modules => $MOD_CODE"
echo "    GET /lending    => $LEND_REDIRECT (expect 301)"

if [[ "$HOME_CODE" != "200" && "$HOME_CODE" != "304" ]]; then
  echo "ERROR: home page unhealthy — run: pm2 logs $PM2_NAME --lines 80" >&2
  exit 1
fi

if [[ "$MOD_CODE" != "200" ]]; then
  echo "WARN: /api/modules returned $MOD_CODE — code may be stale; check git log -1" >&2
fi

echo ""
echo "==> Deploy complete. Hard refresh browser: Ctrl+Shift+R"
echo "    Live: https://loveriette.shop"
pm2 list

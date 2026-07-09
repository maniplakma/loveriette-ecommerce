#!/usr/bin/env bash
# Quick games UI + backend deploy on VPS (no full npm ci).
# Run on VPS as root:
#   curl -fsSL https://raw.githubusercontent.com/maniplakma/loveriette-ecommerce/main/scripts/vps-pull-games.sh | bash
#
# For full production deploy (recommended after major releases):
#   curl -fsSL https://raw.githubusercontent.com/maniplakma/loveriette-ecommerce/main/scripts/vps-deploy-production.sh | bash

set -euo pipefail

APP="${APP:-/var/www/ecommerce}"
PM2_NAME="${PM2_NAME:-ecommerce}"
PORT="${PORT:-3001}"
BRANCH="${BRANCH:-main}"
REPO="${REPO:-https://github.com/maniplakma/loveriette-ecommerce.git}"

if [[ ! -d "$APP" ]]; then
  echo "ERROR: $APP not found" >&2
  exit 1
fi

cd "$APP"

echo "==> Pull $BRANCH (games hotfix)"
if [[ -d .git ]]; then
  git fetch origin "$BRANCH"
  git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
  git reset --hard "origin/$BRANCH"
  echo "    Commit: $(git rev-parse --short HEAD)"
else
  echo "ERROR: no .git in $APP — use vps-deploy-production.sh instead" >&2
  exit 1
fi

echo "==> Restart PM2 ($PM2_NAME)"
pm2 restart "$PM2_NAME" 2>/dev/null || pm2 start ecosystem.config.cjs --env production
pm2 save

sleep 2
GAMES_HTML="$(curl -fsSL "http://127.0.0.1:${PORT}/games" || true)"
GAMES_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/games" || echo 000)"

echo "    GET /games => $GAMES_CODE"
if echo "$GAMES_HTML" | grep -q 'games-page.js?v=20260710smooth'; then
  echo "    OK: games-page.js?v=20260710smooth"
else
  echo "WARN: games-page.js cache version not smooth — check git log -1" >&2
fi
if echo "$GAMES_HTML" | grep -q 'How to play all games'; then
  echo "    OK: guide link present"
else
  echo "WARN: guide link missing from /games HTML" >&2
fi
if echo "$GAMES_HTML" | grep -q 'games-open-full\|Full screen'; then
  echo "    OK: fullscreen button in page source"
else
  echo "WARN: fullscreen UI may be stale (check games-page.js)" >&2
fi

echo ""
echo "==> Games hotfix complete. Hard refresh: Ctrl+Shift+R"
echo "    https://loveriette.shop/games"

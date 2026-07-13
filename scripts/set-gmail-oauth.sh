#!/usr/bin/env bash
# Set Gmail OAuth credentials on VPS .env and verify with Google.
# Usage:
#   GOOGLE_CLIENT_ID='xxx.apps.googleusercontent.com' \
#   GOOGLE_CLIENT_SECRET='GOCSPX-xxx' \
#   bash scripts/set-gmail-oauth.sh
#
# Or interactive:
#   bash scripts/set-gmail-oauth.sh

set -euo pipefail

APP="${APP:-/var/www/ecommerce}"
ENV_FILE="${ENV_FILE:-$APP/.env}"
PM2_NAME="${PM2_NAME:-ecommerce}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"

if [[ -z "$CLIENT_ID" ]]; then
  read -r -p "Google Client ID: " CLIENT_ID
fi
if [[ -z "$CLIENT_SECRET" ]]; then
  read -r -s -p "Google Client Secret: " CLIENT_SECRET
  echo
fi

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required." >&2
  exit 1
fi

PATCH="$(mktemp)"
trap 'rm -f "$PATCH"' EXIT
python3 - <<PY
import json
json.dump({'clientId': '''$CLIENT_ID''', 'clientSecret': '''$CLIENT_SECRET'''}, open('$PATCH', 'w'))
PY

python3 "$SCRIPT_DIR/patch-gmail-env.py" "$ENV_FILE" "$PATCH"

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env || true
  sleep 2
fi

PUBLIC_URL="$(grep -E '^PUBLIC_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
PUBLIC_URL="${PUBLIC_URL:-https://loveriette.shop}"

echo ""
echo "Gmail OAuth credentials saved to $ENV_FILE"
echo "Redirect URI (must match Google Console exactly):"
echo "  ${PUBLIC_URL%/}/auth/google/callback"
echo ""
echo "Next: open ${PUBLIC_URL%/}/admin.html → Integrations → Gmail OAuth → Connect Gmail"
echo ""

if command -v curl >/dev/null 2>&1; then
  HEALTH_URL="${PUBLIC_URL%/}/api/health"
  echo "Health check: $HEALTH_URL"
  curl -fsSL "$HEALTH_URL" || true
  echo ""
fi

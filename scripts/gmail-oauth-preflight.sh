#!/usr/bin/env bash
# Check loveriette.shop Gmail OAuth readiness (run on VPS or locally against live URL).
# Usage: bash scripts/gmail-oauth-preflight.sh [https://loveriette.shop]

set -euo pipefail

BASE="${1:-https://loveriette.shop}"
BASE="${BASE%/}"

echo "Gmail OAuth preflight — $BASE"
echo ""

health="$(curl -fsSL "$BASE/api/health" 2>/dev/null || echo '{}')"
echo "=== Server health ==="
echo "$health" | python3 -m json.tool 2>/dev/null || echo "$health"
echo ""

domain_ok="$(echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('domainConnected') else 'no')" 2>/dev/null || echo unknown)"
gmail_ok="$(echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('gmailOAuthAllowed') else 'no')" 2>/dev/null || echo unknown)"

echo "=== Live checks ==="
echo "HTTPS + custom domain ready: $domain_ok"
echo "Gmail OAuth allowed by app:    $gmail_ok"
echo "Redirect URI for Google Console:"
echo "  $BASE/auth/google/callback"
echo "JavaScript origin:"
echo "  $BASE"
echo ""

privacy_code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/privacy.html" 2>/dev/null || echo 000)"
echo "Privacy policy page:           HTTP $privacy_code ($BASE/privacy.html)"
echo ""

ENV_FILE="${ENV_FILE:-/var/www/ecommerce/.env}"
if [[ -f "$ENV_FILE" ]]; then
  echo "=== VPS .env ($ENV_FILE) ==="
  grep -E '^PUBLIC_URL=' "$ENV_FILE" || echo "PUBLIC_URL= (missing)"
  if grep -qE '^GOOGLE_CLIENT_ID=.+' "$ENV_FILE"; then echo "GOOGLE_CLIENT_ID= set"; else echo "GOOGLE_CLIENT_ID= MISSING"; fi
  if grep -qE '^GOOGLE_CLIENT_SECRET=.+' "$ENV_FILE"; then echo "GOOGLE_CLIENT_SECRET= set"; else echo "GOOGLE_CLIENT_SECRET= MISSING"; fi
  echo ""
fi

echo "=== Google Cloud (you do in browser) ==="
echo "  1. Enable Gmail API"
echo "  2. OAuth consent → External → Testing"
echo "  3. Scopes: gmail.readonly + gmail.send"
echo "  4. Test user: your seller Gmail"
echo "  5. OAuth client → Web → redirect URI above"
echo ""
echo "=== After .env has Client ID + Secret ==="
echo "  Admin → Integrations → Connect Gmail → Save filters → Test Fetcher"
echo ""

if [[ "$domain_ok" == "yes" && "$gmail_ok" == "yes" && "$privacy_code" == "200" ]]; then
  echo "Site side: READY for Gmail OAuth."
else
  echo "Site side: fix items above before Connect Gmail."
fi

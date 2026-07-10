#!/usr/bin/env bash
# One-time Mailtrap SMTP enable on VPS — no admin UI needed.
# Usage (on VPS as root):
#   SMTP_PASSWORD=your_mailtrap_api_token bash scripts/vps-enable-mailtrap-smtp.sh
#
# Or curl after deploy:
#   SMTP_PASSWORD=xxx bash /var/www/ecommerce/scripts/vps-enable-mailtrap-smtp.sh

set -euo pipefail

APP="${APP:-/var/www/ecommerce}"
cd "$APP"

TOKEN="${SMTP_PASSWORD:-}"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: Set SMTP_PASSWORD=your_mailtrap_api_token" >&2
  exit 1
fi

ENV_BLOCK="
SMTP_HOST=live.smtp.mailtrap.io
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=api
SMTP_PASSWORD=${TOKEN}
SMTP_FROM_EMAIL=noreply@loveriette.shop
SMTP_FROM_NAME=loveriette
"

echo "==> Writing SMTP to .env"
touch .env
chmod 600 .env 2>/dev/null || true
for key in SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASSWORD SMTP_FROM_EMAIL SMTP_FROM_NAME; do
  sed -i "/^${key}=/d" .env 2>/dev/null || true
done
printf '%s\n' "$ENV_BLOCK" >> .env

echo "==> Deploy latest code"
curl -fsSL https://raw.githubusercontent.com/maniplakma/loveriette-ecommerce/main/scripts/vps-deploy-production.sh | bash

echo ""
echo "==> Done. Test forgot password at https://loveriette.shop/forgot-password.html"
echo "    Or sign up a test account for welcome email."

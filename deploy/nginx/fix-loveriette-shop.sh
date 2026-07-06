#!/bin/bash
# Final fix: loveriette.shop -> ecommerce :3001 (never ezyshell :3000)
# Run on VPS as root: bash /var/www/ecommerce/deploy/nginx/fix-loveriette-shop.sh

set -e

DOMAIN="loveriette.shop"
APP_PORT="3001"
SITE="/etc/nginx/sites-available/loveriette-shop"
ENABLED="/etc/nginx/sites-enabled/loveriette-shop"

echo "==> Current nginx owners of $DOMAIN:"
grep -rn "$DOMAIN" /etc/nginx/ 2>/dev/null || echo "   (none yet)"

echo "==> Disable wrong loveriette symlinks..."
rm -f /etc/nginx/sites-enabled/loveriette
rm -f /etc/nginx/sites-enabled/loveriette.com
rm -f /etc/nginx/sites-enabled/loveriette-shop

echo "==> Remove $DOMAIN from every nginx file EXCEPT loveriette-shop..."
find /etc/nginx -type f \( -name '*.conf' -o -path '*/sites-available/*' -o -path '*/sites-enabled/*' \) 2>/dev/null | while read -r f; do
  [ -f "$f" ] || continue
  [ "$f" = "$SITE" ] && continue
  grep -q "$DOMAIN" "$f" 2>/dev/null || continue
  cp "$f" "$f.bak-$(date +%Y%m%d%H%M)"
  # Remove domain from server_name lines; collapse extra spaces
  sed -i "s/[[:space:]]*${DOMAIN}[[:space:]]*/ /g; s/server_name[[:space:]]\+;/server_name _;/g; s/server_name[[:space:]]\+ \+/server_name /g" "$f"
  echo "   cleaned: $f"
done

echo "==> Write ecommerce-only config (port $APP_PORT)..."
tee "$SITE" > /dev/null << EOF
# $DOMAIN -> PM2 ecommerce @ 127.0.0.1:$APP_PORT (NOT ezyshell 3000)
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 12M;
    access_log /var/log/nginx/loveriette.access.log;
    error_log  /var/log/nginx/loveriette.error.log;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }
}
EOF

ln -sf "$SITE" "$ENABLED"

echo "==> Test & reload nginx (HTTP)..."
nginx -t
systemctl reload nginx

echo "==> Attach SSL to ecommerce config (fixes https showing ezyshell)..."
if command -v certbot >/dev/null 2>&1; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --reinstall 2>/dev/null \
    || certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect 2>/dev/null \
    || echo "   certbot needs email — run: certbot --nginx -d $DOMAIN"
else
  echo "   certbot not installed — run: apt install certbot python3-certbot-nginx"
fi

nginx -t
systemctl reload nginx

echo "==> Restart ecommerce app..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart ecommerce --update-env 2>/dev/null || true
fi

echo ""
echo "==> Verify:"
curl -s -o /dev/null -w "  ecommerce :$APP_PORT -> HTTP %{http_code}\n" "http://127.0.0.1:$APP_PORT/"
curl -s -o /dev/null -w "  nginx Host $DOMAIN (80) -> HTTP %{http_code}\n" -H "Host: $DOMAIN" "http://127.0.0.1/"
curl -sk -o /dev/null -w "  nginx Host $DOMAIN (443) -> HTTP %{http_code}\n" -H "Host: $DOMAIN" "https://127.0.0.1/" || true
echo ""
echo "  Page title check (should say loveriette, NOT ezyshell):"
curl -sk -H "Host: $DOMAIN" "https://127.0.0.1/" 2>/dev/null | grep -o '<title[^>]*>[^<]*</title>' | head -1 || \
curl -s -H "Host: $DOMAIN" "http://127.0.0.1/" | grep -o '<title[^>]*>[^<]*</title>' | head -1

echo ""
echo "DONE. Browser: https://$DOMAIN (incognito + Ctrl+Shift+R)"
echo "Remaining $DOMAIN refs:"
grep -rn "$DOMAIN" /etc/nginx/ 2>/dev/null || echo "  (only loveriette-shop — good)"

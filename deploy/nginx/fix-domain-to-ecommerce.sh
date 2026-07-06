#!/bin/bash
# Point loveriette.shop ONLY to ecommerce (3001), never ezyshell (3000)
# Run on VPS as root: bash /var/www/ecommerce/deploy/nginx/fix-domain-to-ecommerce.sh

set -e

DOMAIN="loveriette.shop"
APP_PORT="3001"
SITE="/etc/nginx/sites-available/loveriette-shop"
ENABLED="/etc/nginx/sites-enabled/loveriette-shop"

echo "==> 1) Remove loveriette.shop from ALL other nginx configs..."
for f in /etc/nginx/sites-available/*; do
  [ -f "$f" ] || continue
  [ "$f" = "$SITE" ] && continue
  if grep -q "$DOMAIN" "$f" 2>/dev/null; then
    cp "$f" "$f.bak-$(date +%Y%m%d%H%M)"
    sed -i "s/$DOMAIN//g; s/server_name  \+/server_name /g; s/server_name ;/server_name _;/g" "$f"
    echo "   cleaned: $f"
  fi
done

echo "==> 2) Disable duplicate loveriette nginx symlinks..."
rm -f /etc/nginx/sites-enabled/loveriette
rm -f /etc/nginx/sites-enabled/loveriette.com
rm -f /etc/nginx/sites-enabled/loveriette-shop

echo "==> 3) Write ecommerce-only config (port $APP_PORT)..."
tee "$SITE" > /dev/null << EOF
# $DOMAIN -> ecommerce PM2 @ 127.0.0.1:$APP_PORT (NOT ezyshell 3000)
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
    }
}
EOF

ln -sf "$SITE" "$ENABLED"

echo "==> 4) Test nginx..."
nginx -t
systemctl reload nginx

echo "==> 5) Verify local routing..."
echo -n "   ecommerce $APP_PORT: "
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:$APP_PORT/"
echo -n "   nginx Host $DOMAIN: "
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: $DOMAIN" "http://127.0.0.1/"

echo ""
echo "==> 6) SSL (run if needed): certbot --nginx -d $DOMAIN"
echo "==> 7) pm2 restart ecommerce --update-env"
echo ""
echo "DONE. Test: https://$DOMAIN (incognito)"
grep -r "$DOMAIN" /etc/nginx/sites-enabled/ 2>/dev/null || true

#!/usr/bin/env bash
# Configure UFW + Nginx for external access to the ecommerce app.
# Run on Ubuntu VPS as a user with sudo. Does NOT modify ezyshell nginx sites.
#
# Usage:
#   cd /var/www/ecommerce
#   chmod +x deploy/setup-external-access.sh
#   SHOP_DOMAIN=shop.example.com ./deploy/setup-external-access.sh
#
# Optional: access via VPS IP on port 80 (no domain yet)
#   ENABLE_IP_DEFAULT=1 ./deploy/setup-external-access.sh

set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/ecommerce}"
SHOP_DOMAIN="${SHOP_DOMAIN:-}"
ENABLE_IP_DEFAULT="${ENABLE_IP_DEFAULT:-0}"
NGINX_SITE="/etc/nginx/sites-available/ecommerce"

if [[ ! -d "$APP_ROOT/deploy/nginx" ]]; then
  echo "APP_ROOT must contain deploy/nginx/ (default: /var/www/ecommerce)" >&2
  exit 1
fi

echo "==> Installing Nginx (if missing)"
if ! command -v nginx >/dev/null 2>&1; then
  sudo apt update
  sudo apt install -y nginx
else
  echo "    nginx already installed"
fi

echo "==> Configuring UFW"
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow OpenSSH
  sudo ufw allow 3001/tcp comment 'ecommerce Node'
  sudo ufw allow 'Nginx Full' comment 'HTTP/HTTPS via Nginx'
  if sudo ufw status | grep -q "Status: inactive"; then
    echo "    UFW is inactive. Enable with: sudo ufw enable"
  else
    sudo ufw reload
  fi
  sudo ufw status numbered
else
  echo "    ufw not installed — skip: sudo apt install -y ufw"
fi

echo "==> Installing Nginx site config"
sudo cp "$APP_ROOT/deploy/nginx/ecommerce.conf" "$NGINX_SITE"

if [[ -n "$SHOP_DOMAIN" ]]; then
  sudo sed -i "s/SHOP_DOMAIN/${SHOP_DOMAIN}/g" "$NGINX_SITE"
  echo "    server_name: ${SHOP_DOMAIN}"
else
  echo "    SHOP_DOMAIN not set — edit $NGINX_SITE and replace SHOP_DOMAIN"
fi

if [[ "$ENABLE_IP_DEFAULT" == "1" ]]; then
  sudo cp "$APP_ROOT/deploy/nginx/ecommerce-ip-default.conf" /etc/nginx/sites-available/ecommerce-ip
  sudo ln -sf /etc/nginx/sites-available/ecommerce-ip /etc/nginx/sites-enabled/ecommerce-ip
  echo "    Enabled default_server on port 80 for VPS IP access"
fi

sudo ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/ecommerce
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx

echo ""
echo "Done. Ensure .env has:"
echo "  HOST=0.0.0.0"
echo "  PORT=3001"
echo ""
echo "Restart app: pm2 restart ecommerce"
echo "Test local:  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/"
if [[ -n "$SHOP_DOMAIN" ]]; then
  echo "Test public: curl -s -o /dev/null -w '%{http_code}\n' http://${SHOP_DOMAIN}/"
fi
echo "Direct port: http://YOUR_VPS_IP:3001/ (requires HOST=0.0.0.0 + UFW 3001)"

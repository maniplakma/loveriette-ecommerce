#!/bin/bash
# Hotfix deploy — upload critical files only (when full deploy SSH fails)
set -eu
APP_ROOT="/var/www/ecommerce"
cd "$APP_ROOT"
pm2 restart ecommerce
sleep 2
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3001/api/health || curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3001/
pm2 list

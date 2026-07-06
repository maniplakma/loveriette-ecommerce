#!/usr/bin/env bash
# Run on VPS via VNC — no PC deploy needed.
# One line: curl -fsSL https://raw.githubusercontent.com/maniplakma/loveriette-ecommerce/main/scripts/vps-pull-fix.sh | bash

set -euo pipefail
APP=/var/www/ecommerce
BASE=https://raw.githubusercontent.com/maniplakma/loveriette-ecommerce/main

echo "==> Downloading fixed files from GitHub..."
cd "$APP"

curl -fsSL -o index.html/dashboard.html "$BASE/index.html/dashboard.html"
curl -fsSL -o index.html/dashboard.js "$BASE/index.html/dashboard.js"
curl -fsSL -o index.html/email-inbox.css "$BASE/index.html/email-inbox.css"
curl -fsSL -o index.html/admin.html "$BASE/index.html/admin.html"
curl -fsSL -o index.html/admin.js "$BASE/index.html/admin.js"
curl -fsSL -o server.js/gmail-fetch.js "$BASE/server.js/gmail-fetch.js"

echo "==> Restarting..."
pm2 restart ecommerce
sleep 2
curl -s -o /dev/null -w "HTTP: %{http_code}\n" http://127.0.0.1:3001/dashboard.html

echo "==> Check (should be 0):"
grep -c email-links index.html/dashboard.html || true

echo "==> DONE. Hard refresh browser: Ctrl+Shift+R"

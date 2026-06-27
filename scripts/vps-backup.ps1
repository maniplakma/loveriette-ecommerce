# One-click VPS backup via PuTTY plink (run on YOUR PC)
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\vps-backup.ps1

param(
  [string]$VpsHost = "161.97.78.192",
  [string]$VpsUser = "root",
  [string]$VpsPassword = $env:VPS_PASSWORD
)

if (-not $VpsPassword) {
  Write-Error "Set VPS_PASSWORD env var or pass -VpsPassword"
  exit 1
}

$Plink = "C:\Program Files\PuTTY\plink.exe"
if (-not (Test-Path $Plink)) {
  Write-Error "PuTTY plink not found. Install PuTTY or use SSH manually."
  exit 1
}

$RemoteScript = @'
set -e
mkdir -p /var/backups/loveriette
STAMP=$(date +%Y%m%d-%H%M%S)
DIR=/var/backups/loveriette/backup-$STAMP
mkdir -p "$DIR"

echo "=== PM2 status ==="
pm2 list || true

echo "=== Backup loveriette ==="
if [ -d /var/www/ecommerce ]; then
  pm2 stop ecommerce 2>/dev/null || true
  cp /var/www/ecommerce/server.js/ecom.db "$DIR/ecom.db" 2>/dev/null && echo "ecom.db OK" || echo "WARN: no ecom.db"
  cp /var/www/ecommerce/.env "$DIR/.env" 2>/dev/null && echo ".env OK" || echo "WARN: no .env"
  tar -czf "$DIR/uploads-server.tar.gz" -C /var/www/ecommerce/server.js uploads 2>/dev/null || true
  tar -czf "$DIR/uploads-branding.tar.gz" -C /var/www/ecommerce/index.html uploads 2>/dev/null || true
  pm2 start ecommerce 2>/dev/null || pm2 restart ecommerce 2>/dev/null || true
  tar -czf "/var/backups/loveriette/loveriette-$STAMP.tar.gz" -C /var/backups/loveriette "backup-$STAMP"
  echo "LOVERIETTE_ARCHIVE=/var/backups/loveriette/loveriette-$STAMP.tar.gz"
else
  echo "WARN: /var/www/ecommerce not found"
fi

echo "=== Backup ezyshell DB (read-only) ==="
if [ -f /var/www/ezyshell/.env ]; then
  export DATABASE_URL="$(grep '^DATABASE_URL=' /var/www/ezyshell/.env | cut -d= -f2- | tr -d '"')"
  if [ -n "$DATABASE_URL" ] && command -v pg_dump >/dev/null 2>&1; then
    pg_dump "$DATABASE_URL" > "/var/backups/loveriette/ezyshell-$STAMP.sql"
    echo "EZYSHELL_SQL=/var/backups/loveriette/ezyshell-$STAMP.sql"
  else
    echo "WARN: pg_dump or DATABASE_URL missing"
  fi
else
  echo "WARN: /var/www/ezyshell/.env not found"
fi

echo "=== Done ==="
ls -lh /var/backups/loveriette/ | tail -5
'@

Write-Host "Connecting to ${VpsUser}@${VpsHost} ..."

$target = "${VpsUser}@${VpsHost}"
$RemoteScript | & $Plink -ssh $target -pw $VpsPassword bash -s

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Backup finished on VPS. Files are in /var/backups/loveriette/"
} else {
  Write-Host "Connection failed. Check Contabo firewall, SSH port 22, and password."
}

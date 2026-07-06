# One-shot: SSH to VPS and repair/restore ecom.db (run from Windows PowerShell)
# Usage:
#   $env:VPS_PASSWORD = 'your-root-password'
#   powershell -ExecutionPolicy Bypass -File scripts/vps-restore-db.ps1

param(
  [string]$VpsHost = "161.97.78.192",
  [string]$VpsUser = "root",
  [string]$VpsPassword = $env:VPS_PASSWORD,
  [string]$AppRoot = "/var/www/ecommerce"
)

$ErrorActionPreference = "Stop"
if (-not $VpsPassword) {
  Write-Error "Set VPS_PASSWORD env var first"
  exit 1
}

$Plink = "C:\Program Files\PuTTY\plink.exe"
if (-not (Test-Path $Plink)) { Write-Error "Install PuTTY (plink.exe) first."; exit 1 }

$target = "${VpsUser}@${VpsHost}"

$RemoteScript = @'
set -eu
APP_ROOT='__APP_ROOT__'
cd "$APP_ROOT"

echo "==> PM2 status before repair"
pm2 status ecommerce 2>/dev/null || true

if [ -f scripts/repair-db.sh ]; then
  bash scripts/repair-db.sh
else
  echo "repair-db.sh missing — inline restore"
  DB_DIR="$APP_ROOT/server.js"
  cd "$DB_DIR"
  STAMP=$(date +%Y%m%d%H%M)
  cp ecom.db "ecom.db.broken-$STAMP" 2>/dev/null || true
  rm -f ecom.db-wal ecom.db-shm 2>/dev/null || true
  LATEST=$(ls -t ecom.db.pre-deploy-* /var/backups/loveriette/ecom.db* 2>/dev/null | head -1)
  if [ -n "$LATEST" ]; then
    cp "$LATEST" ecom.db
    echo "Restored from $LATEST"
  else
    echo "No backup found"
    ls -la ecom.db* /var/backups/loveriette/ 2>/dev/null || true
    exit 1
  fi
fi

echo "==> Restart ecommerce"
pm2 restart ecommerce --update-env || pm2 start ecosystem.config.cjs --env production
sleep 2
curl -s -o /dev/null -w "HTTP 3001: %{http_code}\n" http://127.0.0.1:3001/ || true
pm2 logs ecommerce --lines 8 --nostream 2>/dev/null || true
echo "==> Done"
'@

$RemoteScript = $RemoteScript.Replace('__APP_ROOT__', $AppRoot)
$RemoteScript = $RemoteScript -replace "`r`n", "`n"
$path = Join-Path $env:TEMP "loveriette-restore-db.sh"
[System.IO.File]::WriteAllText($path, $RemoteScript, (New-Object System.Text.UTF8Encoding $false))

Write-Host "==> Repairing database on $target ..."
& $Plink -batch -ssh $target -pw $VpsPassword -m $path
$exit = $LASTEXITCODE
Remove-Item $path -Force -ErrorAction SilentlyContinue
if ($exit -ne 0) { Write-Error "DB restore failed (exit $exit). See output above."; exit 1 }

Write-Host ""
Write-Host "DB restore OK. Now run: powershell -ExecutionPolicy Bypass -File scripts/vps-deploy.ps1"

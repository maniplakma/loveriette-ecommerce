# Deploy loveriette code updates to Contabo VPS (preserves .env, ecom.db, uploads)
# Usage:
#   $env:VPS_PASSWORD = 'your-root-password'
#   powershell -ExecutionPolicy Bypass -File scripts\vps-deploy.ps1
#
# Optional:
#   -VpsHost 161.97.78.192 -VpsUser root -AppRoot /var/www/ecommerce

param(
  [string]$VpsHost = "161.97.78.192",
  [string]$VpsUser = "root",
  [string]$VpsPassword = $env:VPS_PASSWORD,
  [string]$AppRoot = "/var/www/ecommerce",
  [string]$Pm2Name = "ecommerce"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent

if (-not $VpsPassword) {
  Write-Error "Set VPS_PASSWORD env var or pass -VpsPassword"
  exit 1
}

$Plink = "C:\Program Files\PuTTY\plink.exe"
$Pscp  = "C:\Program Files\PuTTY\pscp.exe"
if (-not (Test-Path $Plink)) { Write-Error "Install PuTTY (plink.exe) first."; exit 1 }
if (-not (Test-Path $Pscp))  { Write-Error "Install PuTTY (pscp.exe) first."; exit 1 }

$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$TarName = "loveriette-deploy-$Stamp.tar.gz"
$TarPath = Join-Path $env:TEMP $TarName

Write-Host "==> Packing project (excluding .env, DB, node_modules)..."
Push-Location $RepoRoot
try {
  if (Test-Path $TarPath) { Remove-Item $TarPath -Force }
  & tar -czf $TarPath `
    --exclude=node_modules `
    --exclude=.env `
    --exclude=logs `
    --exclude=.git `
    --exclude=server.js/ecom.db `
    --exclude=server.js/uploads `
    --exclude=index.html/uploads `
    .
  if ($LASTEXITCODE -ne 0) { throw "tar failed" }
} finally {
  Pop-Location
}

$target = "${VpsUser}@${VpsHost}"
$remoteTar = "/tmp/$TarName"
Write-Host "==> Uploading to ${target}:${remoteTar} ..."
& $Pscp -batch -pw $VpsPassword $TarPath "${target}:${remoteTar}"
if ($LASTEXITCODE -ne 0) { throw "scp upload failed" }

# Bash remote script — use LF + plink -m (avoids Windows pipe mangling "pipefail")
$RemoteScript = @'
set -eu
set -o pipefail
APP_ROOT='__APP_ROOT__'
PM2_NAME='__PM2_NAME__'
ARCHIVE='__ARCHIVE__'
STAMP='__STAMP__'

echo '==> Pre-deploy backup...'
mkdir -p /var/backups/loveriette
if [ -f "$APP_ROOT/server.js/ecom.db" ]; then
  cp "$APP_ROOT/server.js/ecom.db" "$APP_ROOT/server.js/ecom.db.pre-deploy-$STAMP"
  cp "$APP_ROOT/server.js/ecom.db" "/var/backups/loveriette/ecom.db.$STAMP"
  echo "    DB snapshot: ecom.db.pre-deploy-$STAMP"
fi

echo '==> Extracting code (keeping .env and uploads)...'
cd "$APP_ROOT"
tar -xzf "$ARCHIVE"
rm -f "$ARCHIVE"

echo '==> Installing dependencies...'
npm ci --omit=dev

echo '==> Production prepare...'
npm run build

echo '==> Database integrity check...'
if ! node -e "require('./server.js/db.js')" 2>/dev/null; then
  echo 'WARN: DB integrity failed — running repair script...'
  bash scripts/repair-db.sh || {
    echo 'ERROR: DB repair failed. Restore ecom.db manually from backup.'
    exit 1
  }
  node -e "require('./server.js/db.js')" || {
    echo 'ERROR: DB still invalid after repair.'
    exit 1
  }
fi

echo '==> Restarting PM2...'
pm2 restart "$PM2_NAME" || pm2 start ecosystem.config.cjs --env production
pm2 save

echo '==> Health check...'
sleep 2
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/ || echo '000')
echo "HTTP 127.0.0.1:3001 => $CODE"
pm2 list

if [ "$CODE" != '200' ] && [ "$CODE" != '304' ]; then
  echo 'WARN: unexpected status — check pm2 logs ecommerce'
  exit 1
fi
echo '==> Deploy complete.'
'@

$RemoteScript = $RemoteScript.Replace('__APP_ROOT__', $AppRoot)
$RemoteScript = $RemoteScript.Replace('__PM2_NAME__', $Pm2Name)
$RemoteScript = $RemoteScript.Replace('__ARCHIVE__', $remoteTar)
$RemoteScript = $RemoteScript.Replace('__STAMP__', $Stamp)
$RemoteScript = $RemoteScript -replace "`r`n", "`n"

$RemoteScriptPath = Join-Path $env:TEMP "loveriette-remote-$Stamp.sh"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($RemoteScriptPath, $RemoteScript, $utf8NoBom)

Write-Host "==> Running remote deploy on VPS..."
& $Plink -batch -ssh $target -pw $VpsPassword -m $RemoteScriptPath
$plinkExit = $LASTEXITCODE
Remove-Item $RemoteScriptPath -Force -ErrorAction SilentlyContinue
if ($plinkExit -ne 0) {
  Write-Error "Remote deploy failed. SSH in and run: pm2 logs ecommerce --lines 50"
  exit 1
}

Remove-Item $TarPath -Force -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Done. Open your site (IP or domain) and hard-refresh (Ctrl+Shift+R)."
Write-Host "Admin: Integrations -> Gmail OAuth if not connected yet."

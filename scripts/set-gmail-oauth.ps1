# Set Gmail OAuth credentials on production VPS .env (safe Python patch + Google verify)
param(
  [Parameter(Mandatory = $true)]
  [string]$ClientId,
  [Parameter(Mandatory = $true)]
  [string]$ClientSecret,
  [string]$VpsHost = '161.97.78.192',
  [string]$VpsUser = 'root',
  [string]$VpsPassword = $env:VPS_PASSWORD,
  [string]$AppRoot = '/var/www/ecommerce',
  [string]$Pm2Name = 'ecommerce'
)

$ErrorActionPreference = 'Stop'
$Plink = 'C:\Program Files\PuTTY\plink.exe'
$Pscp  = 'C:\Program Files\PuTTY\pscp.exe'
if (-not $VpsPassword) { throw 'Set VPS_PASSWORD env var' }
if (-not (Test-Path $Plink)) { throw 'Install PuTTY (plink.exe)' }
if (-not (Test-Path $Pscp))  { throw 'Install PuTTY (pscp.exe)' }

$patchPath = Join-Path $env:TEMP "gmail-oauth-patch-$(Get-Date -Format 'yyyyMMddHHmmss').json"
$json = @{ clientId = $ClientId; clientSecret = $ClientSecret } | ConvertTo-Json
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($patchPath, $json, $utf8NoBom)

$target = "${VpsUser}@${VpsHost}"
& $Pscp -batch -pw $VpsPassword $patchPath "${target}:/tmp/gmail-oauth-patch.json"
& $Pscp -batch -pw $VpsPassword (Join-Path $PSScriptRoot 'patch-gmail-env.py') "${target}:/tmp/patch-gmail-env.py"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed' }

$remote = @"
set -e
python3 /tmp/patch-gmail-env.py $AppRoot/.env /tmp/gmail-oauth-patch.json || VERIFY_RC=`$?
rm -f /tmp/gmail-oauth-patch.json
pm2 restart $Pm2Name --update-env
sleep 2
curl -s http://127.0.0.1:3001/api/health
if [ "`${VERIFY_RC:-0}" = "2" ]; then
  echo ''
  echo 'WARN: Google rejected client id/secret — reset Client Secret in Cloud Console and run this script again.'
  exit 2
fi
"@

& $Plink -batch -pw $VpsPassword $target $remote
Remove-Item $patchPath -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Redirect URI:'
Write-Host '  https://loveriette.shop/auth/google/callback'

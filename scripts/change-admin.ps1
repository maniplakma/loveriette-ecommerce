# Change admin email + password on production VPS (no nano needed)
# Usage:
#   $env:VPS_PASSWORD = 'your-root-password'
#   powershell -ExecutionPolicy Bypass -File scripts/change-admin.ps1
#
# Or with values directly:
#   powershell -ExecutionPolicy Bypass -File scripts/change-admin.ps1 `
#     -Email "admin@loveriette.shop" -Password "YourNewPassword123"

param(
  [string]$Email = '',
  [string]$Password = '',
  [string]$Name = 'Site Admin',
  [string]$VpsHost = '161.97.78.192',
  [string]$VpsUser = 'root',
  [string]$VpsPassword = $env:VPS_PASSWORD,
  [string]$AppRoot = '/var/www/ecommerce',
  [string]$Pm2Name = 'ecommerce'
)

$ErrorActionPreference = 'Stop'
$Plink = 'C:\Program Files\PuTTY\plink.exe'
$Pscp  = 'C:\Program Files\PuTTY\pscp.exe'
if (-not $VpsPassword) { throw 'Set VPS_PASSWORD env var first.' }
if (-not (Test-Path $Plink)) { throw 'Install PuTTY (plink.exe) first.' }

if (-not $Email) {
  $Email = Read-Host 'New admin email'
}
if (-not $Password) {
  $sec = Read-Host 'New admin password' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  $sec2 = Read-Host 'Confirm password' -AsSecureString
  $bstr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec2)
  $confirm = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr2)
  if ($Password -ne $confirm) { throw 'Passwords do not match.' }
}

$Email = $Email.Trim().ToLower()
if (-not $Email -or -not $Password) { throw 'Email and password are required.' }
if ($Password.Length -lt 8) { throw 'Use at least 8 characters for password.' }

$patchPath = Join-Path $env:TEMP "admin-patch-$(Get-Date -Format 'yyyyMMddHHmmss').json"
$json = @{ email = $Email; password = $Password; name = $Name } | ConvertTo-Json
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($patchPath, $json, $utf8)

$target = "${VpsUser}@${VpsHost}"
& $Pscp -batch -pw $VpsPassword $patchPath "${target}:/tmp/admin-patch.json"
& $Pscp -batch -pw $VpsPassword (Join-Path $PSScriptRoot 'patch-admin-env.py') "${target}:/tmp/patch-admin-env.py"

$remote = @"
set -e
cd $AppRoot
python3 /tmp/patch-admin-env.py $AppRoot/.env /tmp/admin-patch.json
rm -f /tmp/admin-patch.json
npm run reset-admin
pm2 restart $Pm2Name --update-env
echo ''
echo '=== Admin login updated ==='
echo "Email: $Email"
echo 'Password: (the one you just entered)'
"@

& $Plink -batch -pw $VpsPassword $target $remote
Remove-Item $patchPath -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Done. Login at https://loveriette.shop/admin.html' -ForegroundColor Green

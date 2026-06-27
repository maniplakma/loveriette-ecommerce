# Backup loveriette on Windows (local dev)
# Usage (PowerShell):
#   cd C:\Users\kaye\OneDrive\Desktop\ecom-site
#   .\scripts\backup-local.ps1

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $Root "backups"
$Work = Join-Path $BackupRoot "loveriette-local-$Stamp"
$Archive = Join-Path $BackupRoot "loveriette-local-$Stamp.zip"

New-Item -ItemType Directory -Force -Path $Work | Out-Null

$Db = Join-Path $Root "server.js\ecom.db"
$EnvFile = Join-Path $Root ".env"
$UploadsServer = Join-Path $Root "server.js\uploads"
$UploadsBranding = Join-Path $Root "index.html\uploads"

Write-Host "==> Local backup started ($Stamp)"

if (Test-Path $EnvFile) {
  Copy-Item $EnvFile (Join-Path $Work ".env")
  Write-Host "    .env copied"
}

if (Test-Path $Db) {
  Copy-Item $Db (Join-Path $Work "ecom.db")
  Write-Host "    ecom.db copied"
} else {
  Write-Host "    WARN: no ecom.db found"
}

if (Test-Path $UploadsServer) {
  Compress-Archive -Path $UploadsServer -DestinationPath (Join-Path $Work "uploads-server.zip") -Force
  Write-Host "    server uploads archived"
}

if (Test-Path $UploadsBranding) {
  Compress-Archive -Path $UploadsBranding -DestinationPath (Join-Path $Work "uploads-branding.zip") -Force
  Write-Host "    branding uploads archived"
}

@"
Loveriette local backup
Created: $Stamp
Root: $Root
"@ | Set-Content (Join-Path $Work "README.txt")

if (Test-Path $Archive) { Remove-Item $Archive -Force }
Compress-Archive -Path "$Work\*" -DestinationPath $Archive -Force
Remove-Item $Work -Recurse -Force

Write-Host ""
Write-Host "==> DONE"
Write-Host "Archive: $Archive"
Write-Host "Size:    $((Get-Item $Archive).Length / 1MB | ForEach-Object { '{0:N2} MB' -f $_ })"

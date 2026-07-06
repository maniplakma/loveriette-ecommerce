# Verify live order creation on loveriette.shop
# Usage: powershell -ExecutionPolicy Bypass -File scripts/test-live-order.ps1

$body = @{
  email = "qa-live-order-$(Get-Date -Format 'yyyyMMddHHmmss')@loveriette.shop"
  paymentMethodId = 1
  productId = 1
  variantId = 4
  quantity = 1
} | ConvertTo-Json -Compress

$jsonPath = Join-Path $env:TEMP "loveriette-live-order.json"
$body | Set-Content -Path $jsonPath -Encoding UTF8 -NoNewline

Write-Host "POST https://loveriette.shop/orders"
Write-Host "Body: $body"
$res = curl.exe -s -w "`nHTTP:%{http_code}" -X POST "https://loveriette.shop/orders" `
  -H "Content-Type: application/json" `
  --data-binary "@$jsonPath"
Write-Host $res

if ($res -match 'HTTP:201') {
  Write-Host "`nSUCCESS: Live order created."
  exit 0
}
Write-Host "`nFAILED: Live order not created."
exit 1

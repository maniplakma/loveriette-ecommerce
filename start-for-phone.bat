@echo off

title Ecom Site - Local + Phone

cd /d "%~dp0"

set PORT=%PORT%

if "%PORT%"=="" set PORT=3000



echo.

echo ========================================

echo   Starting local server on port %PORT%

echo ========================================

echo.

start "Ecom Server" cmd /k "cd /d %~dp0 && node server.js/server.js"



timeout /t 3 /nobreak >nul



echo Optional: run "npm run tunnel" in another terminal for a public demo link.

echo Open http://127.0.0.1:%PORT% in your browser.

echo Check server window for LAN URLs if testing on phone (same WiFi).

echo.

pause


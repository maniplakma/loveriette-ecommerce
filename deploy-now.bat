@echo off
title Deploy inbox fix to VPS
cd /d "%~dp0"

echo.
echo  === Deploy fixed files to VPS ===
echo  Password: Contabo ROOT password (isang beses lang)
echo.

set "SSH=C:\Program Files\Git\usr\bin\ssh.exe"
set "SCP=C:\Program Files\Git\usr\bin\scp.exe"
if not exist "%SSH%" set "SSH=ssh"
if not exist "%SCP%" set "SCP=scp"

set VPS=root@161.97.78.192
set SOCK=%TEMP%\loveriette-deploy.sock
set ROOT=/var/www/ecommerce

del "%SOCK%" 2>nul

echo [1/8] Connecting...
"%SSH%" -o StrictHostKeyChecking=accept-new -M -S "%SOCK%" -fnNT %VPS%
if errorlevel 1 goto fail

echo [2/8] dashboard.html
"%SCP%" -o ControlPath="%SOCK%" "index.html\dashboard.html" "%VPS%:%ROOT%/index.html/dashboard.html"
if errorlevel 1 goto fail

echo [3/8] dashboard.js
"%SCP%" -o ControlPath="%SOCK%" "index.html\dashboard.js" "%VPS%:%ROOT%/index.html/dashboard.js"
if errorlevel 1 goto fail

echo [4/8] email-inbox.css
"%SCP%" -o ControlPath="%SOCK%" "index.html\email-inbox.css" "%VPS%:%ROOT%/index.html/email-inbox.css"
if errorlevel 1 goto fail

echo [5/8] admin.html
"%SCP%" -o ControlPath="%SOCK%" "index.html\admin.html" "%VPS%:%ROOT%/index.html/admin.html"
if errorlevel 1 goto fail

echo [6/8] admin.js
"%SCP%" -o ControlPath="%SOCK%" "index.html\admin.js" "%VPS%:%ROOT%/index.html/admin.js"
if errorlevel 1 goto fail

echo [7/8] gmail-fetch.js
"%SCP%" -o ControlPath="%SOCK%" "server.js\gmail-fetch.js" "%VPS%:%ROOT%/server.js/gmail-fetch.js"
if errorlevel 1 goto fail

echo [8/8] Restart server...
"%SSH%" -o ControlPath="%SOCK%" %VPS% "pm2 restart ecommerce && sleep 2 && curl -s -o /dev/null -w 'HTTP: %%{http_code}\n' http://127.0.0.1:3001/dashboard.html"
if errorlevel 1 goto fail

"%SSH%" -S "%SOCK%" -O exit 2>nul

echo.
echo  SUCCESS! Browser: Ctrl+Shift+R then Email Access.
echo  Dapat WALANG "Open link" buttons.
pause
exit /b 0

:fail
"%SSH%" -S "%SOCK%" -O exit 2>nul
echo.
echo  FAILED. Check root password or internet. Try ulit.
pause
exit /b 1

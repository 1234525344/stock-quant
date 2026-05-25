@echo off
REM Setup Windows Scheduled Tasks for Stock-Quant

echo ============================================
echo Setting up auto-start tasks
echo ============================================

REM Remove old tasks
schtasks /Delete /TN StockQuantServer /F >nul 2>&1
schtasks /Delete /TN StockQuantTunnel /F >nul 2>&1

REM Stock-Quant Server
schtasks /Create /TN StockQuantServer /TR "\"C:\Program Files\nodejs\node.exe\" server.js" /SC ONLOGON /DELAY 0000:30 /RL LIMITED /IT /F
echo StockQuantServer: %ERRORLEVEL%

REM Cloudflare Tunnel Manager
schtasks /Create /TN StockQuantTunnel /TR "\"C:\Program Files\nodejs\node.exe\" tunnel-manager.js" /SC ONLOGON /DELAY 0001:00 /RL LIMITED /IT /F
echo StockQuantTunnel: %ERRORLEVEL%

echo Done!

@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================================
:: Quant Platform Watchdog (persistent loop)
:: - Starts at login via Startup folder
:: - Checks health every 5 minutes
:: - Auto-restarts crashed services
:: This window can be minimized - it runs forever
:: ============================================================

title Quant Platform Watchdog
set "QUANT_DIR=C:\Users\lb\stock-quant"

echo ############################################################
echo #  Quant Platform Watchdog v2.0
echo #  Started: %date% %time%
echo #  Server: http://localhost:3456
echo #  Public: https://lbquant.top
echo #  Checking every 300 seconds
echo ############################################################

:loop
echo [%date% %time%] Checking...

:: ---- Check Server (port 3456) ----
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3456' -TimeoutSec 5 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [%date% %time%] [DOWN] Server is not responding. Restarting...
    cd /d "%QUANT_DIR%"
    start /b /min cmd /c "node server.js >> logs\server-watchdog.log 2>&1"
    echo [%date% %time%] [RESTART] Server start triggered
) else (
    echo [%date% %time%] [OK] Server
)

:: ---- Check Tunnel (Cloudflare) ----
cd /d "%QUANT_DIR%"
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'https://lbquant.top' -TimeoutSec 10 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [%date% %time%] [DOWN] Tunnel is not responding. Restarting...
    :: Kill existing cloudflared
    taskkill /f /im cloudflared.exe >nul 2>&1
    timeout /t 3 /nobreak >nul
    start /b /min cmd /c "node tunnel-manager.js >> logs\tunnel-watchdog.log 2>&1"
    echo [%date% %time%] [RESTART] Tunnel start triggered
) else (
    echo [%date% %time%] [OK] Tunnel (lbquant.top)
)

:: Wait 5 minutes, then check again
timeout /t 300 /nobreak >nul
goto loop

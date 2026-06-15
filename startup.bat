@echo off
:: Quant Platform Auto-Start (Windows Startup Folder)
:: Smart: only starts if not already running

set PM2_HOME=C:\Users\lb\.pm2
set PATH=C:\Users\lb\AppData\Roaming\npm;%PATH%

:: Check if server is already running
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3456' -TimeoutSec 3 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [%date% %time%] Quant platform already running, skipping start
    exit /b 0
)

echo [%date% %time%] Starting quant platform...

cd /d C:\Users\lb\stock-quant

:: Try to resurrect from saved PM2 state first
pm2 resurrect 2>nul

:: Check again after 5 seconds
timeout /t 5 /nobreak >nul
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3456' -TimeoutSec 3 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [%date% %time%] Quant platform started via PM2 resurrect
    exit /b 0
)

:: Fallback: start from scratch
echo [%date% %time%] PM2 resurrect failed, starting fresh...
pm2 kill 2>nul
cd /d C:\Users\lb\stock-quant
pm2 start ecosystem.config.cjs
pm2 save
echo [%date% %time%] Quant platform started fresh
exit /b 0

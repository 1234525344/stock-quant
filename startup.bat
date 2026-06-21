@echo off
:: Quant Platform — 标准化启动脚本
:: 使用 PM2 管理 server + tunnel + monitor 三个进程
set PM2_HOME=C:\Users\lb\.pm2
set PATH=C:\Users\lb\AppData\Roaming\npm;%PATH%

echo ============================================
echo   lbquant.top — 量化交易平台启动
echo   %date% %time%
echo ============================================
echo.

:: 检查是否已在运行
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3456/api/health' -TimeoutSec 3 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] 服务器已在运行, 跳过启动
    goto :check_tunnel
)

:: 启动 PM2 进程组
cd /d C:\Users\lb\stock-quant

where pm2 >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] PM2 未安装, 使用 Node 直接启动
    start /B node server.js > logs\server.log 2>&1
    timeout /t 3 /nobreak >nul
    goto :check_tunnel
)

:: 尝试恢复 PM2 状态
pm2 resurrect 2>nul
timeout /t 5 /nobreak >nul

powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3456/api/health' -TimeoutSec 3 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] PM2 resurrect 成功
    goto :check_tunnel
)

:: 全新启动
echo [INFO] 全新启动 PM2 进程组...
pm2 kill 2>nul
cd /d C:\Users\lb\stock-quant
pm2 start ecosystem.config.cjs
pm2 save
echo [OK] PM2 进程组已启动

:check_tunnel
:: 检查 cloudflared 隧道
tasklist /FI "IMAGENAME eq cloudflared.exe" 2>NUL | find /I /N "cloudflared.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [OK] Cloudflare 隧道已在运行
) else (
    echo [INFO] 启动 Cloudflare 隧道...
    start "" "C:\Users\lb\cloudflared.exe" --protocol http2 tunnel run 8001c255-c5e7-46e4-8459-155b57217686
    echo [OK] 隧道已启动
)

echo.
echo ============================================
echo   启动完成
echo   本地: http://localhost:3456
echo   公网: https://lbquant.top
echo   状态: https://lbquant.top/status
echo ============================================
exit /b 0

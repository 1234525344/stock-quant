@echo off
REM 量化交易平台 — 免费公网部署启动脚本（固定域名版）
REM 使用 serveo.net SSH 隧道，重启后域名不变

set "SUBDOMAIN=stockquant"

echo ============================================
echo   量化交易平台 — 免费公网模式
echo   固定地址: https://%SUBDOMAIN%.serveo.net
echo ============================================
echo.

REM 先杀掉旧进程
taskkill //F //IM node.exe > nul 2>&1

REM 启动 Node.js 服务器
echo [1/2] 启动量化引擎...
start /B node server.js > server.log 2>&1
timeout /t 3 /nobreak > nul

REM 检查服务器是否启动成功
curl -s http://localhost:3456/api/health > nul 2>&1
if errorlevel 1 (
    echo [错误] 服务器启动失败，请检查 server.log
    pause
    exit /b 1
)
echo       服务器已启动: http://localhost:3456

REM 启动 serveo 隧道（固定子域名 + 自动重连）
echo [2/2] 建立公网隧道...
echo       公网地址: https://%SUBDOMAIN%.serveo.net

:loop
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -R %SUBDOMAIN%:80:localhost:3456 serveo.net
echo       隧道断开，5秒后自动重连...
timeout /t 5 /nobreak > nul
goto loop

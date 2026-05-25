@echo off
REM 每日选股发帖 — 一键启动
REM 步骤：
REM   1. 先启动 server:  start "stock-server" node server.js
REM   2. 关掉所有 Edge 窗口
REM   3. 双击本文件

echo ================================
echo  每日量化选股自动发帖
echo ================================
echo.

REM 关闭当前 Edge（释放 CDP 端口）
taskkill /f /im msedge.exe 2>nul
timeout /t 2 /nobreak >nul

REM 以 CDP 模式打开 Edge
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222

echo.
echo Edge 已启动，请在浏览器中登录雪球/知乎/东财
echo 登录完成后按任意键继续...
pause >nul

REM 等待服务器就绪
echo.
echo 检查服务器连接...
node -e "const http=require('http');http.get('http://localhost:3456/api/pool',r=>{console.log(r.statusCode===200?'服务器已就绪':'服务器未响应')}).on('error',()=>console.log('服务器未启动，请先运行: node server.js'))"

REM 发帖
echo.
echo 开始发帖...
node daily-picks.js

echo.
echo 完成！按任意键退出...
pause >nul

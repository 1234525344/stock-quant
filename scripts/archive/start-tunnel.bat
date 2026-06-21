@echo off
REM 启动 Cloudflare 隧道 — 开机自启
cd /d C:\Users\lb

REM 杀掉旧进程
taskkill /F /IM cloudflared.exe >nul 2>&1

REM 启动隧道（HTTP2协议，中国可用）
cloudflared.exe tunnel --url http://localhost:3456 --protocol http2 --no-autoupdate > logs\tunnel.log 2>&1

REM 提取URL保存到文件
timeout /t 8 /nobreak >nul
findstr "trycloudflare.com" logs\tunnel.log > logs\tunnel_url.txt
echo Tunnel started. Check logs\tunnel_url.txt for URL.

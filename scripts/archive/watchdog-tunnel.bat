@echo off
REM Tunnel Watchdog — checks if cloudflared is alive, restarts if dead
:Loop
tasklist /FI "IMAGENAME eq cloudflared.exe" 2>NUL | find /I /N "cloudflared.exe">NUL
if "%ERRORLEVEL%"=="1" (
    echo [%date% %time%] Tunnel dead, restarting...
    start "" "C:\Users\lb\cloudflared.exe" --protocol http2 tunnel run 8001c255-c5e7-46e4-8459-155b57217686
    echo Tunnel restarted.
)
timeout /t 300 /nobreak >nul
goto Loop
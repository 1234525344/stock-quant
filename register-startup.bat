@echo off
:: One-shot: register PM2 quant platform as a Windows scheduled task (runs at every logon)

set TASK_NAME=QuantPlatform
set PM2_HOME=C:\Users\lb\.pm2
set BATCH_PATH=C:\Users\lb\stock-quant\startup.bat

echo Creating scheduled task: %TASK_NAME%

:: Delete existing task if present
schtasks /delete /tn "%TASK_NAME%" /f 2>nul

:: Create new task: run at user logon, highest privileges NOT needed
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "cmd.exe /c \"%BATCH_PATH%\"" ^
  /sc ONLOGON ^
  /it ^
  /ru "lb" ^
  /rl HIGHEST ^
  /f

if %ERRORLEVEL% EQU 0 (
  echo [OK] Task "%TASK_NAME%" registered successfully
  echo The quant platform will auto-start on next login.
) else (
  echo [FAIL] Could not create scheduled task. Trying alternative method...

  :: Fallback: copy to Startup folder
  copy /Y "%BATCH_PATH%" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\quant-platform.bat"
  echo [OK] Copied to Startup folder instead
)

pause

@echo off
cd /d "C:\Users\lb\stock-quant"
echo [%date% %time%] PM2 resurrect...
call npx pm2 resurrect
exit /b 0

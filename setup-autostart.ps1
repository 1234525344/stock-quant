# 开机自启设置 — 隧道管理器 + 量化平台
# 以管理员身份运行: powershell -ExecutionPolicy Bypass -File setup-autostart.ps1

$ErrorActionPreference = "Continue"
$scriptDir = "C:\Users\lb\stock-quant"
$nodeExe = "C:\Program Files\nodejs\node.exe"

Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  设置量化平台 + 隧道开机自启" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan

# 1. 量化平台服务器
Write-Host "[1/2] 量化平台服务器..." -ForegroundColor Yellow
$taskName1 = "StockQuantServer"
schtasks /Delete /TN $taskName1 /F 2>$null
$action1 = New-ScheduledTaskAction -Execute $nodeExe -Argument "server.js" -WorkingDirectory $scriptDir
$trigger1 = New-ScheduledTaskTrigger -AtLogon -RandomDelay (New-TimeSpan -Seconds 30)
$settings1 = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName1 -Action $action1 -Trigger $trigger1 -Settings $settings1 -Description "量化交易平台服务器" -User "lb" -RunLevel Limited
Write-Host "✅ $taskName1" -ForegroundColor Green

# 2. Cloudflare 隧道管理器
Write-Host "[2/2] Cloudflare 隧道..." -ForegroundColor Yellow
$taskName2 = "StockQuantTunnel"
schtasks /Delete /TN $taskName2 /F 2>$null
$action2 = New-ScheduledTaskAction -Execute $nodeExe -Argument "tunnel-manager.js" -WorkingDirectory $scriptDir
$trigger2 = New-ScheduledTaskTrigger -AtLogon -RandomDelay (New-TimeSpan -Seconds 60)
$settings2 = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $taskName2 -Action $action2 -Trigger $trigger2 -Settings $settings2 -Description "Cloudflare Tunnel 管理器" -User "lb" -RunLevel Limited
Write-Host "✅ $taskName2" -ForegroundColor Green

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  开机自启已配置！" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "任务列表:" -ForegroundColor White
Write-Host "  • StockQuantServer — 量化平台 (开机启动)" -ForegroundColor White
Write-Host "  • StockQuantTunnel  — 隧道管理 (开机启动)" -ForegroundColor White
Write-Host ""
Write-Host "管理命令:" -ForegroundColor Yellow
Write-Host "  立即启动: schtasks /Run /TN StockQuantServer" -ForegroundColor White
Write-Host "  立即启动: schtasks /Run /TN StockQuantTunnel" -ForegroundColor White
Write-Host "  查看状态: schtasks /Query /TN StockQuantServer" -ForegroundColor White
Write-Host "  删除任务: schtasks /Delete /TN StockQuantServer /F" -ForegroundColor White
Write-Host ""
Write-Host "当前隧道URL保存在: $scriptDir\logs\tunnel_url.txt" -ForegroundColor White

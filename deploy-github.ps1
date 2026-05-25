# 一键部署到 GitHub + Render.com
# 使用方法: powershell -File deploy-github.ps1
# 前置条件: 已在浏览器登录 GitHub (https://github.com/login/device)

$ErrorActionPreference = "Stop"
Set-Location "C:\Users\lb\stock-quant"

Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  量化平台一键部署到 Render.com" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Step 1: 检查 GitHub 登录
Write-Host "[1/5] 检查 GitHub 登录..." -ForegroundColor Yellow
$authStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "未登录 GitHub，正在打开登录页面..." -ForegroundColor Yellow
    gh auth login --hostname github.com --web
    if ($LASTEXITCODE -ne 0) {
        Write-Host "GitHub 登录失败，请在浏览器打开: https://github.com/login/device" -ForegroundColor Red
        exit 1
    }
}
Write-Host "✅ GitHub 已登录" -ForegroundColor Green

# Step 2: 添加 SSH key 到 GitHub
Write-Host "[2/5] 添加 SSH Key..." -ForegroundColor Yellow
$sshPub = Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" -Raw
gh ssh-key add "$env:USERPROFILE\.ssh\id_ed25519.pub" --title "stock-quant-auto" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "SSH key 可能已存在或添加失败，继续..." -ForegroundColor Yellow
} else {
    Write-Host "✅ SSH Key 已添加" -ForegroundColor Green
}

# Step 3: 创建 GitHub 仓库
Write-Host "[3/5] 创建 GitHub 仓库..." -ForegroundColor Yellow
$repoName = "stock-quant"
gh repo create $repoName --public --source=. --remote=origin --push 2>&1
if ($LASTEXITCODE -ne 0) {
    # 可能已存在，尝试直接 push
    Write-Host "仓库可能已存在，直接推送..." -ForegroundColor Yellow
    git remote add origin "git@github.com:$(gh api user --jq .login)/stock-quant.git" 2>$null
    git push -u origin master 2>&1
}
Write-Host "✅ 代码已推送到 GitHub" -ForegroundColor Green

# Step 4: 获取 GitHub 用户名
$username = gh api user --jq .login
Write-Host "[4/5] GitHub 用户名: $username" -ForegroundColor Yellow
Write-Host "仓库地址: https://github.com/$username/stock-quant" -ForegroundColor White

# Step 5: Render.com 部署
Write-Host "[5/5] 部署到 Render.com..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Render.com 需要你在浏览器操作（一次性）:" -ForegroundColor Cyan
Write-Host "1. 打开 https://render.com" -ForegroundColor White
Write-Host "2. 用 GitHub 账号登录 ($username)" -ForegroundColor White
Write-Host "3. 点击 'New +' → 'Blueprint'" -ForegroundColor White
Write-Host "4. 选择仓库: $username/stock-quant" -ForegroundColor White
Write-Host "5. 设置环境变量 DEEPSEEK_API_KEY" -ForegroundColor White
Write-Host "6. 点击 'Apply' 等待部署完成" -ForegroundColor White
Write-Host ""
Write-Host "部署完成后，你的永久地址: https://stock-quant.onrender.com" -ForegroundColor Green
Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  GitHub 仓库已就绪！完成上面 Render 步骤即可" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan

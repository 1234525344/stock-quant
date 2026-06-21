#!/bin/bash
# 量化交易平台 — 免费公网部署启动脚本
# 使用 serveo.net SSH隧道，无需云服务器

echo "============================================"
echo "  量化交易平台 — 免费公网模式"
echo "============================================"
echo ""

# 启动 Node.js 服务器
echo "[1/2] 启动量化引擎..."
node server.js &
SERVER_PID=$!
sleep 3

# 检查服务器
if curl -s http://localhost:3456/api/health > /dev/null 2>&1; then
    echo "      服务器已启动 (PID: $SERVER_PID)"
else
    echo "[错误] 服务器启动失败"
    exit 1
fi

# 启动 serveo 隧道 (带自动重连)
echo "[2/2] 建立公网隧道 (serveo.net)..."
echo "      公网地址将显示在下一行..."
echo ""

while true; do
    ssh -o StrictHostKeyChecking=no \
        -o ServerAliveInterval=30 \
        -o ExitOnForwardFailure=yes \
        -R 80:localhost:3456 serveo.net
    echo ""
    echo "隧道断开，5秒后自动重连..."
    sleep 5
done

#!/bin/bash
# ============================================
#  量化交易平台 — 一键部署脚本
#  支持: Ubuntu 20.04+ / Debian 11+ / CentOS 7+
# ============================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[x]${NC} $1"; exit 1; }

echo "========================================"
echo "  量化交易平台 — 一键部署"
echo "========================================"
echo ""

# ── 1. 检测系统 ──
if [ "$(id -u)" = "0" ]; then
  warn "检测到 root 用户，建议用普通用户运行"
fi

if ! command -v curl &>/dev/null; then
  log "安装 curl..."
  sudo apt-get update -qq && sudo apt-get install -y -qq curl 2>/dev/null || \
  sudo yum install -y curl 2>/dev/null || true
fi

# ── 2. 安装 Docker ──
if ! command -v docker &>/dev/null; then
  log "Docker 未安装，正在安装..."
  curl -fsSL https://get.docker.com | sudo bash
  sudo systemctl enable docker --now
  sudo usermod -aG docker "$USER" 2>/dev/null || true
  log "Docker 安装完成"
else
  log "Docker 已安装: $(docker --version)"
fi

if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
  log "安装 docker-compose..."
  sudo curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
  sudo chmod +x /usr/local/bin/docker-compose
fi

# ── 3. 获取代码 ──
REPO_URL="${1:-https://gitee.com/lb-stock/stock-quant.git}"
APP_DIR="${APP_DIR:-$HOME/stock-quant}"

if [ -d "$APP_DIR/.git" ]; then
  log "目录已存在，更新代码..."
  cd "$APP_DIR"
  git pull origin master 2>/dev/null || git pull origin main 2>/dev/null || true
else
  log "克隆仓库..."
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# ── 4. 配置环境变量 ──
if [ ! -f .env ]; then
  cp .env.example .env
  log "已创建 .env 文件，请编辑填入 API Key:"
  echo ""
  echo -e "  ${YELLOW}nano .env${NC}"
  echo ""
  warn "至少填入 DEEPSEEK_API_KEY，然后重新运行: bash deploy.sh"
fi

# ── 5. 启动服务 ──
log "构建并启动 Docker 容器..."
if docker compose version &>/dev/null 2>&1; then
  docker compose up -d --build
else
  docker-compose up -d --build
fi

# ── 6. 等待健康检查 ──
log "等待服务启动..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3456/api/health > /dev/null 2>&1; then
    log "服务已就绪! 🎉"
    break
  fi
  sleep 2
done

# ── 7. 输出信息 ──
IP=$(curl -sf ifconfig.me 2>/dev/null || curl -sf ip.sb 2>/dev/null || echo "你的服务器IP")
echo ""
echo "========================================"
echo -e "  ${GREEN}部署完成! 🚀${NC}"
echo "========================================"
echo ""
echo "  本地访问: http://localhost:3456"
echo "  外网访问: http://${IP}:3456"
echo "  健康检查: http://localhost:3456/api/health"
echo "  状态页面: http://localhost:3456/status"
echo ""
echo "  管理命令:"
echo "    cd $APP_DIR && docker compose logs -f    # 查看日志"
echo "    cd $APP_DIR && docker compose restart    # 重启"
echo "    cd $APP_DIR && docker compose down       # 停止"
echo ""
echo "========================================"

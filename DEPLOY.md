# 一键部署指南 / One-Click Deploy

量化交易平台 — 多因子Alpha · 组合优化 · 风险归因 · AI选股

## 环境要求

- [Docker](https://docs.docker.com/get-docker/) 20.10+
- [Docker Compose](https://docs.docker.com/compose/install/) 2.0+

## 快速开始

```bash
# 1. 克隆仓库
git clone <your-repo-url> stock-quant
cd stock-quant

# 2. (可选) 配置环境变量
cp .env.example .env
# 编辑 .env，填入你的 API Key

# 3. 一键启动
docker-compose up -d

# 4. 打开浏览器访问
# http://localhost:3456
```

## 配置说明

在 `.env` 文件中（或通过环境变量）配置：

| 变量 | 必填 | 说明 |
|------|------|------|
| `DEEPSEEK_API_KEY` | 推荐 | DeepSeek API Key，用于AI选股/分析 |
| `AIHUBMIX_API_KEY` | 否 | AIHubMix API Key (多模型聚合) |
| `WXPUSHER_APP_TOKEN` | 否 | WxPusher AppToken，微信推送通知 |
| `WXPUSHER_UIDS` | 否 | WxPusher用户UID，逗号分隔 |
| `PUBLIC_URL` | 否 | 公网访问地址，用于分享页面生成链接 |
| `TDX_ROOT` | 否 | 通达信本地数据目录（不填则使用HTTP数据源） |
| `CORS_ORIGIN` | 否 | CORS允许的源（默认：*） |
| `PYTHON_BIN` | 否 | Python可执行文件路径（默认：python3） |

## Qlib 机器学习（可选）

Qlib 提供 LightGBM 模型训练和预测功能，但依赖较重的 Python 包（numpy/pandas/scipy）。
默认不安装以减小镜像体积。

```bash
# 构建带 Qlib 的镜像
INSTALL_QLIB=true docker-compose build --build-arg INSTALL_QLIB=true

# 启动
docker-compose up -d
```

## 数据持久化

- `stock-quant-data` 卷：SQLite 数据库、API密钥、模型文件
- `stock-quant-logs` 卷：应用日志

```bash
# 查看卷
docker volume ls | grep stock-quant

# 备份数据
docker run --rm -v stock-quant_data:/data -v $(pwd):/backup alpine cp -r /data /backup/backup-data
```

## 反向代理 (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3456;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 管理命令

```bash
# 查看日志
docker-compose logs -f stock-quant

# 重启服务
docker-compose restart

# 停止服务
docker-compose down

# 重新构建
docker-compose build --no-cache

# 查看健康状态
curl http://localhost:3456/api/health
```

## 故障排查

### 端口被占用
```bash
# 修改 docker-compose.yml 中的端口映射
# 将 "${PORT:-3456}:3456" 改为 "3457:3456"
```

### AI 功能不可用
确保设置了 `DEEPSEEK_API_KEY` 或 `AIHUBMIX_API_KEY` 环境变量。

### Python 桥接报错
确认容器内 Python3 可用：
```bash
docker exec stock-quant python3 --version
```

### 数据库损坏
```bash
# 删除数据卷重新初始化
docker-compose down -v
docker-compose up -d
```

## 技术栈

- **后端**: Node.js 22 + Express 4
- **数据库**: SQLite (sql.js)
- **实时**: WebSocket (ws)
- **Python 桥接**: pytdx / akshare / qlib
- **数据源**: 新浪 / 腾讯 / 东方财富 / 通达信
- **AI**: DeepSeek / AIHubMix

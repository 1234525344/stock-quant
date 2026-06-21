# 📊 量化交易平台

A股量化分析 · 多因子Alpha · 策略回测 · AI选股 · 资金流向 · 期权行情

---

## 🚀 一键部署

### 方案一：VPS 一键脚本（推荐）

```bash
bash <(curl -fsSL https://gitee.com/lb-stock/stock-quant/raw/master/deploy.sh)
```

自动完成：安装 Docker → 克隆代码 → 构建镜像 → 启动服务 → 健康检查

### 方案二：Docker Compose

```bash
git clone https://gitee.com/lb-stock/stock-quant.git
cd stock-quant
cp .env.example .env
# 编辑 .env 填入 DEEPSEEK_API_KEY
docker-compose up -d
```

打开 http://localhost:3456

> GitHub 镜像: https://github.com/1234525344/stock-quant

### 方案三：直接运行（需要 Node.js 22 + Python 3）

```bash
git clone https://gitee.com/lb-stock/stock-quant.git
cd stock-quant
cp .env.example .env
npm ci --omit=dev
npm start
```

---

## 📋 功能模块

| 模块 | 说明 |
|------|------|
| **技术分析** | K线图 / 均线 / MACD / RSI / 布林带 / ATR |
| **策略回测** | 均线交叉 / MACD金叉 / 布林带波段 / RSI超买超卖 |
| **AI选股** | DeepSeek AI 驱动的智能选股和热点分析 |
| **资金流向** | 主力资金 / 北向资金 / 板块资金全景图 |
| **ETF轮动** | 动量轮动 / 估值轮动 / 波动率策略 |
| **期权行情** | 50ETF / 300ETF 期权实时行情 |
| **自动交易** | 纸交易引擎 / 自适应市场状态 / 进化策略 |
| **异动监控** | 涨跌停板 / 强势突破 / 连板扫描 |
| **长线分析** | 基本面 / 多年财务 / 估值分析 |

## 🔧 配置

在 `.env` 文件中配置（详见 `.env.example`）：

```bash
# 必填: AI API Key
DEEPSEEK_API_KEY=sk-your-key-here

# 可选: 微信推送通知
WXPUSHER_APP_TOKEN=AT_xxx
WXPUSHER_UIDS=UID_xxx

# 可选: 公网域名
PUBLIC_URL=https://your-domain.com
```

## 📦 技术栈

- **后端**: Node.js 22 + Express + WebSocket
- **数据库**: SQLite (sql.js)
- **数据源**: 新浪 / 腾讯 / 东方财富 / 通达信
- **Python桥接**: pytdx / akshare / qlib
- **AI**: DeepSeek
- **部署**: Docker + Docker Compose

## 📖 详细文档

- [部署指南](DEPLOY.md)
- [API 文档](http://localhost:3456/api/health)

## 🖥️ 系统截图

打开 http://localhost:3456 查看完整界面。

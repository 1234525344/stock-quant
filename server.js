require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const cors = require("cors");
const { errorHandler, notFoundHandler, requestLogger } = require("./src/middleware/errorHandler");
const { getRealtimeEngine } = require("./src/realtime-engine");
const { getTDXTCPClient, connectTDXServer } = require("./src/tdx-tcp");
const { STOCK_POOL, riskEngine, paperTradingManager, monitorCache, pushedAlertIds } = require("./src/state");
const { isTradingHours } = require("./src/helpers");

// 路由模块
const systemRoutes = require("./src/routes/system");
const marketRoutes = require("./src/routes/market");
const fundflowRoutes = require("./src/routes/fundflow");
const fundsRoutes = require("./src/routes/funds");
const strategyRoutes = require("./src/routes/strategy");
const aiRoutes = require("./src/routes/ai");
const tradingRoutes = require("./src/routes/trading");
const portfolioRoutes = require("./src/routes/portfolio");

const app = express();

// 安全头
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS配置
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  maxAge: 86400,
}));

// 请求体限制
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

// 请求日志
app.use(requestLogger);

// 免责声明响应头
app.use((req, res, next) => {
  res.setHeader("X-Disclaimer", encodeURIComponent("数据仅供参考，不构成投资建议"));
  next();
});

// 全局限流
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "请求过于频繁，请稍后再试" },
});
app.use("/api/", limiter);

// AI端点限流
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  message: { error: "AI 请求过于频繁，请稍后再试" },
});
app.use("/api/ai/", aiLimiter);

// API Key 管理（管理端，不需要认证 — 仅本地访问）
const { apiKeyAuth, requireAuth, createKey, listKeys, disableKey } = require("./src/middleware/auth");

// 管理接口 — 生成/查看/禁用 key
app.get("/api/admin/keys", (req, res) => {
  // 简单限制：只允许本地访问
  const ip = req.ip || req.socket.remoteAddress;
  if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
    return res.status(403).json({ error: "仅限本地访问" });
  }
  res.json({ keys: listKeys() });
});

app.post("/api/admin/keys", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress;
  if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
    return res.status(403).json({ error: "仅限本地访问" });
  }
  const { plan, note } = req.body;
  const entry = createKey(plan || "monthly", note || "");
  res.json(entry);
});

app.delete("/api/admin/keys/:key", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress;
  if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
    return res.status(403).json({ error: "仅限本地访问" });
  }
  disableKey(req.params.key);
  res.json({ ok: true });
});

// 挂载路由模块 (所有路由已在模块内定义完整路径)
app.use(systemRoutes);
app.use(marketRoutes);
app.use(fundflowRoutes);
app.use(fundsRoutes);
app.use(strategyRoutes);
app.use("/api/ai", aiRoutes);
app.use(tradingRoutes);
app.use(portfolioRoutes);

// 404处理
app.use(notFoundHandler);

// 全局错误处理
app.use(errorHandler);

// ==================== 服务器启动 ====================

const PORT = process.env.PORT || 3456;
const WS_PORT = process.env.WS_PORT || 3457;
const HOST = process.env.HOST || "0.0.0.0";

const server = http.createServer(app);

// WebSocket服务器
const wss = new WebSocket.Server({ port: WS_PORT, host: HOST });

wss.on("listening", () => {
  console.log(`WebSocket实时推送已启动: ws://${HOST}:${WS_PORT}`);
});

// 初始化实时引擎
const realtimeEngine = getRealtimeEngine().start(wss, { pollInterval: 3000 });
const CACHE_TTL = 3000;
console.log("[实时引擎] 已启动, 缓存TTL=" + CACHE_TTL + "ms");

// 自动订阅默认股票池
realtimeEngine.subscribeCodes(STOCK_POOL);

// 尝试连接通达信TCP
connectTDXServer();
const tdxClient = getTDXTCPClient();
tdxClient.onStatus((s) => {
  if (s.status === "connected") {
    console.log("[通达信TCP] 已连接:", s.host + ":" + s.port);
    tdxClient.subscribe(STOCK_POOL);
  } else if (s.status === "reconnecting") {
    console.log("[通达信TCP] 重连中...");
  }
});
tdxClient.onQuote((quote) => {
  realtimeEngine._updateQuote(quote.code, quote);
});

// ==================== 全自动风控引擎 ====================

async function autoRiskTick() {
  try {
    const posData = riskEngine.positions.toJSON();
    const codes = posData.positions.map(p => p.code);

    if (codes.length > 0) {
      const engine = getRealtimeEngine();
      const quotes = codes.map(c => engine.getQuote(c)).filter(Boolean);

      if (quotes.length > 0) {
        riskEngine.positions.updatePrices(quotes);

        const newAlerts = [];
        for (const q of quotes) {
          const alert = riskEngine.alerts.checkPriceLimit(q, q.preClose);
          if (alert) newAlerts.push(alert);
        }

        const pnlPct = riskEngine.positions.getTotalPnlPct() * 100;
        const lossAlert = riskEngine.alerts.checkPortfolioLoss(pnlPct);
        if (lossAlert) newAlerts.push(lossAlert);

        const returns = posData.dailySnapshots.slice(-10).map((s, i, arr) => {
          if (i === 0) return 0;
          return arr[i - 1].equity > 0 ? (s.equity - arr[i - 1].equity) / arr[i - 1].equity : 0;
        });
        const declineAlert = riskEngine.alerts.checkConsecutiveDecline(returns);
        if (declineAlert) newAlerts.push(declineAlert);

        const trulyNew = newAlerts.filter(a => !pushedAlertIds.has(a.id));
        riskEngine.alerts.addAlerts(trulyNew);

        if (trulyNew.length > 0) {
          for (const alert of trulyNew) pushedAlertIds.add(alert.id);
          if (pushedAlertIds.size > 500) pushedAlertIds.clear();

          engine._broadcastAll({
            type: "risk_alert",
            alerts: trulyNew,
            summary: riskEngine.alerts.getAlertSummary(),
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // 15:00-15:05 自动日终快照
    const now = new Date();
    const min = now.getHours() * 60 + now.getMinutes();
    if (min >= 900 && min <= 905) {
      const today = now.toISOString().slice(0, 10);
      const lastSnapshot = posData.dailySnapshots.slice(-1)[0];
      if (!lastSnapshot || lastSnapshot.date !== today) {
        riskEngine.positions._takeSnapshot();
        console.log("[风控] 日终快照已保存:", today);
      }
    }
  } catch (e) { /* 静默失败 */ }
}

// 后台定时器
let autoTickInterval = setInterval(autoRiskTick, 30000);

function adjustTickInterval() {
  const trading = isTradingHours();
  const newInterval = trading ? 30000 : 120000;
  if (autoTickInterval) clearInterval(autoTickInterval);
  autoTickInterval = setInterval(autoRiskTick, newInterval);
}

setInterval(adjustTickInterval, 300000);
adjustTickInterval();

console.log("[风控] 全自动监控已启动 (交易时段30s/非交易120s)");

// ==================== SQLite 数据库 ====================

const database = require("./src/database");

(async () => {
  try {
    await database.ready;
    console.log("[数据库] SQLite 已就绪");
  } catch (e) {
    console.error("[数据库] 初始化失败:", e.message);
  }
})();

// ==================== 启动服务 ====================

server.listen(PORT, HOST, () => {
  console.log(`量化系统已启动: http://${HOST}:${PORT}`);
  console.log(`WebSocket: ws://${HOST}:${WS_PORT}`);
  console.log(`通达信本地数据: C:\\new_tdx64`);
  console.log(`环境: ${process.env.NODE_ENV || "development"}`);
});

// 优雅关闭
function gracefulShutdown(signal) {
  console.log(`\n[关闭] 收到 ${signal}，开始优雅关闭...`);

  // 停止接受新连接
  server.close(() => {
    console.log("[关闭] HTTP 服务器已关闭");
  });

  // 关闭WebSocket
  wss.close(() => {
    console.log("[关闭] WebSocket 服务器已关闭");
  });

  // 停止实时引擎
  try { realtimeEngine.stop(); } catch (e) {}
  console.log("[关闭] 实时引擎已停止");

  // 停止风控定时器
  if (autoTickInterval) clearInterval(autoTickInterval);
  console.log("[关闭] 风控定时器已停止");

  // 关闭数据库
  try { database.close(); } catch (e) {}
  console.log("[关闭] 数据库已关闭");

  // 关闭通达信连接
  try { tdxClient.disconnect(); } catch (e) {}
  console.log("[关闭] 通达信连接已关闭");

  console.log("[关闭] 优雅关闭完成");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// 未捕获异常处理
process.on("uncaughtException", (err) => {
  console.error("[致命错误] 未捕获异常:", err.message);
  gracefulShutdown("uncaughtException");
});

module.exports = { app, server, wss, realtimeEngine };

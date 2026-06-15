require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const cookieParser = require("cookie-parser");
const WebSocket = require("ws");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const cors = require("cors");
const { errorHandler, notFoundHandler } = require("./src/middleware/errorHandler");
const { checkPassword, getPasswordInfo, generateToken, verifyToken, COOKIE_NAME, COOKIE_MAX_AGE, refreshCookie } = require("./src/middleware/auth-gate");
const { getRealtimeEngine } = require("./src/realtime-engine");
const { getTDXTCPClient, connectTDXServer } = require("./src/tdx-tcp");
const { STOCK_POOL, monitorCache, pushedAlertIds } = require("./src/state");
const { isTradingHours } = require("./src/helpers");
const { logger } = require("./src/logger");

// 路由模块
const systemRoutes = require("./src/routes/system");
const marketRoutes = require("./src/routes/market");
const fundflowRoutes = require("./src/routes/fundflow");
const fundsRoutes = require("./src/routes/funds");
const aiRoutes = require("./src/routes/ai");
const tradingRoutes = require("./src/routes/trading");
const scanRoutes = require("./src/routes/scan");
const etfRotateRoutes = require("./src/routes/etf-rotate");
const trendPickRoutes = require("./src/routes/trend-pick");
const mlRoutes = require("./src/routes/ml");
const autotradeRoutes = require("./src/routes/autotrade");
const hotmoneyRoutes = require("./src/routes/hotmoney");
const limitupRoutes = require("./src/routes/limitup");
const newsRoutes = require("./src/routes/news");
const watchlistRoutes = require("./src/routes/watchlist");
const newsEngine = require("./src/news-engine");

const app = express();
app.set("trust proxy", 1); // Cloudflare Tunnel 需要信任代理

// Gzip/brotli 响应压缩 (JSON体积减少70%+, 首屏加载减半)
app.use(require("compression")());

// 安全头
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
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
app.use(cookieParser());

// ===== 认证接口 (必须在 accessGuard 之前) =====
// 验证密码
app.post("/api/auth/login", (req, res) => {
  const { password } = req.body || {};
  if (!checkPassword(password || "")) {
    return res.status(401).json({ error: "密码错误", code: "WRONG_PASSWORD" });
  }
  const ip = req.ip || req.socket?.remoteAddress;
  const token = generateToken(ip);
  res.cookie(COOKIE_NAME, token, {
    maxAge: COOKIE_MAX_AGE, httpOnly: true,
    secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
  });
  res.json({ success: true, message: "验证成功" });
});

// 查看密码信息 (本地)
app.get("/api/auth/password", (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress;
  if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
    return res.status(403).json({ error: "仅限本地访问" });
  }
  res.json(getPasswordInfo());
});

// 检查登录状态
app.get("/api/auth/status", (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  const valid = token && verifyToken(token);
  res.json({ authenticated: !!valid });
});

// 登出 (清除 cookie)
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

// 登录页 (无 cookie 也能访问)
app.get("/login.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// 静态资源 (认证守卫之前 — CSS/JS/图片无需登录即可加载)
const staticOptions = {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }
};
app.use(express.static(path.join(__dirname, "public"), staticOptions));

// ===== 访问守卫 =====
app.use((req, res, next) => {
  // 始终放行
  if (req.path === "/login.html") return next();
  if (req.path.startsWith("/api/auth/")) return next();
  // 静态资源已在守卫之前被 express.static 处理, 不会到达此处
  // 仅 HTML 页面和 /api/ 请求需要认证

  // 检查登录 cookie — 验证通过时自动续期
  const token = req.cookies?.[COOKIE_NAME];
  if (token && verifyToken(token)) {
    // 每次请求都续期 cookie, 确保只要用户持续使用就不会过期
    refreshCookie(res, token);
    return next();
  }

  // API: 返回 401 JSON
  if (req.path.startsWith("/api/") || (req.headers.accept || "").includes("application/json")) {
    return res.status(401).json({ error: "未授权", requireAuth: true });
  }

  // 页面: 返回登录页 HTML (不跳转, 避免循环)
  return res.sendFile(path.join(__dirname, "public", "login.html"));
});

// 管理面板 (登录后访问)
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// 免责声明响应头
app.use((req, res, next) => {
  res.setHeader("X-Disclaimer", encodeURIComponent("数据仅供参考，不构成投资建议"));
  next();
});

// Correlation ID & 请求指标
const { correlationId } = require("./src/middleware/correlation-id");
const { metrics } = require("./src/metrics");
app.use(correlationId());
app.use("/api/", metrics.requestMiddleware());

// 慢API日志 (环境变量 LOG_API_LATENCY=true 启用)
if (process.env.LOG_API_LATENCY === 'true') {
  app.use('/api/', (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      if (ms > 500) logger.warn(`[SLOW] ${req.method} ${req.path} ${ms}ms`);
    });
    next();
  });
}

// Prometheus 指标端点
app.get("/api/metrics", (req, res) => {
  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(metrics.toPrometheus());
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
app.use("/api/ai", aiRoutes);
app.use(tradingRoutes);
app.use(scanRoutes);
app.use(etfRotateRoutes);
app.use(trendPickRoutes);
app.use(mlRoutes);
app.use(autotradeRoutes);
app.use(hotmoneyRoutes);
app.use(limitupRoutes);
app.use(newsRoutes);
app.use(watchlistRoutes);

// 404处理
app.use(notFoundHandler);

// 全局错误处理
app.use(errorHandler);

// ==================== 服务器启动 ====================

const PORT = process.env.PORT || 3456;
const HOST = process.env.HOST || "0.0.0.0";

const server = http.createServer(app);

// WebSocket 挂载到 HTTP 同一端口 (通过 Cloudflare 隧道对外)
const wss = new WebSocket.Server({
  server,
  verifyClient: (info, done) => {
    const cookies = (info.req.headers.cookie || "").split(";").reduce((m, c) => {
      const [k, v] = c.trim().split("="); if (k) m[k] = v; return m;
    }, {});
    if (verifyToken(cookies[COOKIE_NAME])) return done(true);
    done(false, 401, "Unauthorized");
  },
});

wss.on("listening", () => {
  console.log(`WebSocket实时推送已启动: ws://${HOST}:${PORT}`);
});

// 初始化实时引擎
const realtimeEngine = getRealtimeEngine().start(wss, { pollInterval: 3000 });
const CACHE_TTL = 3000;
console.log("[实时引擎] 已启动, 缓存TTL=" + CACHE_TTL + "ms");

// 自动订阅默认股票池
realtimeEngine.subscribeCodes(STOCK_POOL);

// 尝试连接通达信TCP（连接失败不影响主服务）
let tdxClient = null;
let _tdxReconnectCount = 0;
try {
  connectTDXServer();
  tdxClient = getTDXTCPClient();
  tdxClient.onStatus((s) => {
    if (s.status === "connected") {
      console.log("[通达信TCP] 已连接:", s.host + ":" + s.port);
      tdxClient.subscribe(STOCK_POOL);
      _tdxReconnectCount = 0;
    } else if (s.status === "reconnecting") {
      _tdxReconnectCount++;
      if (_tdxReconnectCount % 30 === 1) {
        console.log("[通达信TCP] 重连中... (第" + _tdxReconnectCount + "次)");
      }
    }
  });
  tdxClient.onQuote((quote) => {
    try { realtimeEngine._updateQuote(quote.code, quote); } catch (e) {}
  });
} catch (e) {
  console.error("[通达信TCP] 启动失败:", e.message);
}

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
  console.log(`WebSocket: ws://${HOST}:${PORT}`);
  console.log(`通达信本地数据: C:\\new_tdx64`);
  console.log(`环境: ${process.env.NODE_ENV || "development"}`);
  // 启动新闻引擎
  newsEngine.start();
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

  // 停止新闻引擎
  try { newsEngine.stop(); } catch (e) {}
  console.log("[关闭] 新闻引擎已停止");

  // 关闭数据库
  try { database.close(); } catch (e) {}
  console.log("[关闭] 数据库已关闭");

  // 关闭通达信连接
  if (tdxClient) { try { tdxClient.disconnect(); } catch (e) {} }
  console.log("[关闭] 通达信连接已关闭");

  // 刷盘日志缓冲区
  try { logger.flushSync(); } catch (e) {}
  console.log("[关闭] 日志已刷盘");

  console.log("[关闭] 优雅关闭完成");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// 未捕获异常处理
process.on("uncaughtException", (err) => {
  console.error("[致命错误] 未捕获异常:", err.message, err.stack);
  gracefulShutdown("uncaughtException");
});

// 未处理的Promise拒绝 — 记录但不崩溃（这是之前服务器挂掉的主要原因）
process.on("unhandledRejection", (reason, promise) => {
  console.error("[未处理拒绝]", reason?.message || reason);
  if (reason?.stack) console.error(reason.stack.slice(0, 500));
  // 不调用 gracefulShutdown，避免因单个异步错误就挂掉整个服务
});

module.exports = { app, server, wss, realtimeEngine };

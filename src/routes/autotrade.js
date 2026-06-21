// 自动交易 API 路由
const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const engine = require("../autotrade/engine");
const { STRATEGY_TYPES } = require("../autotrade/strategy");
const tradeDB = require("../database/trades.db");
const { getRealtimeEngine } = require("../realtime-engine");
const { EvolutionEngine } = require("../autotrade/evolution-engine");

// 确保 tradeDB 已初始化
if (!tradeDB.ready) tradeDB.init();
const { sendPushPlus, getWxPusherConfig } = require("../services/notify");

// 发送选股通知
async function notifyStockPick(title, stocks, source) {
  try {
    const settings = tradeDB.getSettings();
    if (settings.notify_on_trade !== "true") return;
    const config = getWxPusherConfig(settings);
    if (!config) return;
    const stockList = stocks.map(s => `> - **${s.code}** ${s.name || ""}`).join("\n");
    const { sendWxPusher } = require("../services/notify");
    await sendWxPusher(config, {
      title,
      content: `> 来源: **${source}**\n> 数量: **${stocks.length} 只**\n\n${stockList}`,
    });
  } catch (e) {
    console.error("[选股通知] 发送失败:", e.message);
  }
}

// ===== 自进化引擎 =====
const evolutionEngine = new EvolutionEngine();

router.post("/api/autotrade/evolution/start", asyncHandler(async (req, res) => {
  await evolutionEngine.start();
  res.json({ success: true, message: "自进化引擎已启动" });
}));

router.post("/api/autotrade/evolution/stop", asyncHandler(async (req, res) => {
  evolutionEngine.stop();
  res.json({ success: true, message: "自进化引擎已停止" });
}));

router.get("/api/autotrade/evolution/status", asyncHandler(async (req, res) => {
  res.json({ status: evolutionEngine.getStatus() });
}));

router.post("/api/autotrade/evolution/evolve", asyncHandler(async (req, res) => {
  await evolutionEngine.evolve();
  res.json({ success: true, status: evolutionEngine.getStatus() });
}));

// ===== 引擎控制 =====

router.post("/api/autotrade/start", asyncHandler(async (req, res) => {
  const rtEngine = getRealtimeEngine();
  await engine.start(rtEngine.wss);
  res.json({ success: true, message: "交易引擎已启动" });
}));

router.post("/api/autotrade/stop", asyncHandler(async (req, res) => {
  engine.stop();
  res.json({ success: true, message: "交易引擎已停止" });
}));

router.get("/api/autotrade/status", asyncHandler(async (req, res) => {
  res.json(engine.getStatus());
}));

// ===== 策略管理 =====

router.get("/api/autotrade/strategies", asyncHandler(async (req, res) => {
  res.json(engine.listStrategies());
}));

router.get("/api/autotrade/strategies/types", asyncHandler(async (req, res) => {
  res.json(STRATEGY_TYPES);
}));

router.post("/api/autotrade/strategies", asyncHandler(async (req, res) => {
  const { name, type, config } = req.body;
  if (!name || !type) return res.status(400).json({ error: "缺少策略名称或类型" });
  const result = engine.createStrategy(name, type, config || {});
  res.json(result);
}));

router.post("/api/autotrade/strategies/:id/enable", asyncHandler(async (req, res) => {
  res.json(engine.enableStrategy(req.params.id));
}));

router.post("/api/autotrade/strategies/:id/disable", asyncHandler(async (req, res) => {
  res.json(engine.disableStrategy(req.params.id));
}));

router.patch("/api/autotrade/strategies/:id", asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  tradeDB.run("UPDATE strategies SET name=? WHERE id=?", [name, req.params.id]);
  // Reload
  const s = tradeDB.get("SELECT * FROM strategies WHERE id=?", [req.params.id]);
  if (s) { s.config = s.config ? JSON.parse(s.config) : {}; engine.strategies.set(req.params.id, s); }
  res.json({ success: true });
}));

router.delete("/api/autotrade/strategies/:id", asyncHandler(async (req, res) => {
  res.json(engine.deleteStrategy(req.params.id));
}));

// ===== 订单 & 交易 =====

router.get("/api/autotrade/orders", asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const orders = tradeDB.all(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ${limit}`);
  res.json(orders);
}));

router.get("/api/autotrade/trades", asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const trades = tradeDB.all(`SELECT * FROM trades ORDER BY created_at DESC LIMIT ${limit}`);
  res.json(trades);
}));

// ===== 持仓 =====

router.get("/api/autotrade/equity", asyncHandler(async (req, res) => {
  const eq = tradeDB.getEquity();
  const positions = tradeDB.all("SELECT * FROM positions WHERE quantity > 0");
  const dailyPnl = tradeDB.all("SELECT * FROM daily_pnl ORDER BY date");
  const equityCurve = dailyPnl.map(d => ({ date: d.date, equity: d.equity }));
  if (equityCurve.length === 0) {
    equityCurve.push({ date: new Date().toISOString().slice(0,10), equity: eq.initialCapital || 1000000 });
  }
  res.json({
    ...eq,
    positionCount: positions.length,
    suggestedMax: 6,
    equityCurve: equityCurve.slice(-60),
  });
}));

router.get("/api/autotrade/positions", asyncHandler(async (req, res) => {
  const positions = tradeDB.all("SELECT * FROM positions WHERE quantity > 0");
  res.json(positions);
}));

// ===== 账户 =====

router.get("/api/autotrade/account", asyncHandler(async (req, res) => {
  res.json(tradeDB.getEquity());
}));

router.get("/api/autotrade/daily-pnl", asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 365);
  const records = tradeDB.all(`SELECT * FROM daily_pnl ORDER BY date DESC LIMIT ${limit}`);
  res.json(records);
}));

// ===== 手动交易 =====

router.post("/api/autotrade/manual-buy", asyncHandler(async (req, res) => {
  const { code, quantity, price } = req.body;
  if (!code || !quantity || !price) return res.status(400).json({ error: "缺少参数" });
  const { getStockName } = require("../data");
  const name = await getStockName(code).catch(() => code);

  const { RiskManager } = require("../autotrade/risk-manager");
  const riskMgr = new RiskManager();
  const check = riskMgr.canBuy(code, quantity, price);
  if (!check.allowed) return res.json({ success: false, error: check.reason });

  const paperBroker = require("../autotrade/paper-broker");
  const result = await paperBroker.buy(code, name, quantity, price, "manual");
  res.json(result);
}));

router.post("/api/autotrade/manual-sell", asyncHandler(async (req, res) => {
  const { code, quantity, price } = req.body;
  if (!code || !quantity || !price) return res.status(400).json({ error: "缺少参数" });

  const paperBroker = require("../autotrade/paper-broker");
  const pos = tradeDB.get("SELECT * FROM positions WHERE code=?", [code]);
  const result = await paperBroker.sell(code, pos?.name || code, quantity, price, "manual");
  res.json(result);
}));

// ===== 回测 =====

// 轻量回测: 返回信号标记点(K线图叠加用)
router.get("/api/backtest", asyncHandler(async (req, res) => {
  const { code, strategy, days } = req.query;
  if (!code) return res.status(400).json({ error: "code 必填" });
  const backtest = require("../autotrade/backtest");
  const endDate = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - (parseInt(days) || 365));
  const startDate = start.toISOString().slice(0, 10);

  const result = await backtest.runStrategy(
    strategy || "ma_cross", code, startDate, endDate
  );
  // 从回测交易日志提取信号点
  const signalPoints = (result.tradeLog || []).map(t => ({
    date: t.date,
    price: t.price,
    type: t.side, // "buy" | "sell"
  }));
  // merge flat fields for frontend compatibility
  const merged = {
    ...result.summary,
    sharpe: result.risk?.sharpeRatio ?? 0,
    sortino: result.risk?.sortinoRatio ?? 0,
    calmar: result.risk?.calmarRatio ?? 0,
    maxDrawdown: result.risk?.maxDrawdownPct ?? 0,
    maxDrawdownAbs: result.risk?.maxDrawdown ?? 0,
    winRate: result.trades?.winRate ?? 0,
    avgWin: result.trades?.avgWin ?? 0,
    avgLoss: result.trades?.avgLoss ?? 0,
    totalTrades: result.summary?.totalTrades ?? 0,
    benchmarkReturn: 0,
  };
  // equityCurve is [1000000, 1000500, ...] from backtest.
  // Frontend expects [{date, equity}, ...] for ECharts.
  const rawEq = result.equityCurve || [];
  const eqDates = result.equityDates || [];
  const eqObjs = rawEq.map((v, i) => ({
    date: eqDates[i] || String(i),
    equity: v,
  }));
  res.json({ code, startDate, endDate, signalPoints, equityCurve: eqObjs, summary: merged });
}));

router.post("/api/autotrade/backtest", asyncHandler(async (req, res) => {
  const { strategyType, code, startDate, endDate, config } = req.body;
  if (!strategyType || !code) return res.status(400).json({ error: "strategyType 和 code 必填" });
  const backtest = require("../autotrade/backtest");
  const result = await backtest.runStrategy(
    strategyType, code,
    startDate || "2025-01-01",
    endDate || new Date().toISOString().slice(0, 10),
    config
  );
  res.json(result);
}));

// ===== 绩效分析 =====

router.get("/api/autotrade/performance", asyncHandler(async (req, res) => {
  const performance = require("../autotrade/performance");
  const trades = tradeDB.all("SELECT * FROM trades ORDER BY created_at");
  const dailyPnl = tradeDB.all("SELECT * FROM daily_pnl ORDER BY date");
  const equityCurve = dailyPnl.map(d => d.equity);
  const initialCapital = tradeDB.getEquity().initialCapital || 1000000;

  // 补全每日净值
  if (equityCurve.length === 0) {
    equityCurve.push(initialCapital);
  }

  const report = performance.fullReport(equityCurve, trades, initialCapital);
  res.json(report);
}));

// ===== 市场状态 =====

router.get("/api/autotrade/regime/:code?", asyncHandler(async (req, res) => {
  const code = req.params.code || "000001"; // 默认上证指数
  const { getKlineData } = require("../data");
  const { detectRegime } = require("../autotrade/regime");
  const klines = await getKlineData(code, 120);
  if (klines.length < 60) return res.json({ error: "数据不足" });
  res.json(detectRegime(klines));
}));

// ===== 真实持仓导入 (手动录入券商持仓) =====

router.post("/api/autotrade/import-positions", asyncHandler(async (req, res) => {
  const { positions } = req.body; // [{code, name, quantity, avgCost}]
  if (!Array.isArray(positions)) return res.status(400).json({ error: "positions 数组必填" });

  // 清除旧持仓
  tradeDB.run("DELETE FROM positions");

  let totalCost = 0;
  for (const p of positions) {
    if (!p.code || !p.quantity || !p.avgCost) continue;
    tradeDB.run(
      "INSERT INTO positions (code, name, quantity, avg_cost, current_price, market_value, unrealized_pnl) VALUES (?,?,?,?,0,0,0)",
      [p.code, p.name || p.code, p.quantity, p.avgCost]
    );
    totalCost += p.quantity * p.avgCost;
    engine._setCooldown(p.code); // 导入的持仓设置冷却，避免自动策略立即卖出
  }

  // 同步账户现金（总资产 = 现金 + 持仓市值）
  const equity = tradeDB.getEquity();
  const newCash = (equity.initialCapital || 1000000) - totalCost;
  tradeDB.setAccount("cash", Math.max(0, +newCash.toFixed(2)));

  // 立即获取行情刷新持仓市值
  try {
    const { getRealtimeQuotes } = require("../data");
    const quotes = await getRealtimeQuotes(positions.map(p => p.code));
    const paperBroker = require("../autotrade/paper-broker");
    paperBroker.updatePositionPrices(quotes);
  } catch (_) {}

  res.json({
    success: true,
    imported: positions.length,
    totalCost: +totalCost.toFixed(2),
    cash: tradeDB.getEquity().cash,
  });
}));

// ===== 账户重置 =====

router.get("/api/autotrade/logs", asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  res.json({ logs: engine.getRecentLogs(limit) });
}));

router.post("/api/autotrade/reset", asyncHandler(async (req, res) => {
  const { cash } = req.body;
  const initialCapital = cash || 1000000;
  tradeDB.run("DELETE FROM orders");
  tradeDB.run("DELETE FROM trades");
  tradeDB.run("DELETE FROM positions");
  tradeDB.run("DELETE FROM daily_pnl");
  tradeDB.run("DELETE FROM account");
  tradeDB.setAccount("initial_capital", initialCapital);
  tradeDB.setAccount("cash", initialCapital);
  res.json({ success: true, message: `账户已重置，初始资金 ¥${initialCapital.toLocaleString()}` });
}));

// ===== 自动优化 =====

router.post("/api/autotrade/optimize", asyncHandler(async (req, res) => {
  const { strategyType, code, paramRanges, startDate, endDate } = req.body;
  if (!strategyType || !code || !paramRanges) return res.status(400).json({ error: "strategyType, code, paramRanges 必填" });
  const optimizer = require("../autotrade/auto-optimizer");
  const result = await optimizer.optimizeStrategy(
    strategyType, code, paramRanges,
    startDate || "2025-01-01",
    endDate || new Date().toISOString().slice(0, 10)
  );
  res.json(result);
}));

router.post("/api/autotrade/backtest-all", asyncHandler(async (req, res) => {
  const optimizer = require("../autotrade/auto-optimizer");
  const results = await optimizer.backtestAllEnabled();
  res.json({ count: results.length, results });
}));

router.get("/api/autotrade/daily-report", asyncHandler(async (req, res) => {
  const optimizer = require("../autotrade/auto-optimizer");
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const fs = require("fs");
  const path = require("path");
  const filepath = path.join(__dirname, "..", "..", "data", "reports", `report_${date}.json`);
  if (fs.existsSync(filepath)) {
    res.json(JSON.parse(fs.readFileSync(filepath, "utf8")));
  } else {
    const report = optimizer.generateDailyReport();
    optimizer.saveDailyReport(report);
    res.json(report);
  }
}));

router.get("/api/autotrade/reports", asyncHandler(async (req, res) => {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..", "..", "data", "reports");
  if (!fs.existsSync(dir)) return res.json({ reports: [] });
  const files = fs.readdirSync(dir).filter(f => f.startsWith("report_")).sort().reverse().slice(0, 30);
  res.json({ reports: files.map(f => f.replace("report_", "").replace(".json", "")) });
}));

router.get("/api/autotrade/health", asyncHandler(async (req, res) => {
  const optimizer = require("../autotrade/auto-optimizer");
  const health = await optimizer.strategyHealthCheck();
  res.json(health);
}));

// ===== 市场状态(引擎缓存) =====

router.get("/api/autotrade/current-regime", asyncHandler(async (req, res) => {
  res.json({
    regime: engine._currentRegime,
    regimeFactor: engine._getRegimeFactor(),
    checkedAt: engine._regimeCheckedAt,
  });
}));

// ===== 设置管理 =====

router.get("/api/autotrade/settings", asyncHandler(async (req, res) => {
  const settings = tradeDB.getSettings();
  // 合并环境变量中的 WxPusher 配置信息
  if (process.env.WXPUSHER_APP_TOKEN) {
    settings.wxpusher_appToken_env = true;
  }
  // 隐藏 token 中间部分
  if (settings.wxpusher_appToken) {
    const t = settings.wxpusher_appToken;
    settings.wxpusher_appToken_masked = t.length > 8 ? t.slice(0, 4) + "****" + t.slice(-4) : "****";
  }
  res.json(settings);
}));

router.put("/api/autotrade/settings", asyncHandler(async (req, res) => {
  const updates = req.body || {};
  tradeDB.setSettings(updates);
  res.json({ success: true, settings: tradeDB.getSettings() });
}));

// 重置账户金额
router.post("/api/autotrade/reset-account", asyncHandler(async (req, res) => {
  const { capital } = req.body || {};
  const amount = parseFloat(capital);
  if (!amount || amount <= 0) return res.status(400).json({ error: "金额必须大于0" });
  tradeDB.setSetting("initial_capital", String(amount));
  tradeDB.setAccount("initial_capital", amount);
  tradeDB.setAccount("cash", amount);
  // 清空持仓
  tradeDB.run("DELETE FROM positions");
  tradeDB.run("DELETE FROM trades");
  tradeDB.run("DELETE FROM orders");
  tradeDB.run("DELETE FROM daily_pnl");
  res.json({ success: true, cash: amount, message: `账户已重置为 ${amount} 元` });
}));

// 测试微信通知
const { testNotify } = require("../services/notify");
router.post("/api/autotrade/test-notify", asyncHandler(async (req, res) => {
  const settings = tradeDB.getSettings();
  const config = getWxPusherConfig(settings);
  if (!config) return res.status(400).json({ error: "请先配置 WxPusher AppToken 和 UID (环境变量 WXPUSHER_APP_TOKEN + WXPUSHER_UIDS 或在设置页面配置)" });
  await testNotify(config);
  res.json({ success: true, message: "测试通知已发送，请检查微信" });
}));

// ===== 自选股管理 =====

router.get("/api/autotrade/stock-pool", asyncHandler(async (req, res) => {
  const pool = tradeDB.getSetting("stock_pool", []);
  res.json({ stocks: Array.isArray(pool) ? pool : [] });
}));

router.post("/api/autotrade/stock-pool", asyncHandler(async (req, res) => {
  const { code, name } = req.body || {};
  if (!code) return res.status(400).json({ error: "股票代码不能为空" });
  const pool = tradeDB.getSetting("stock_pool", []);
  if (!Array.isArray(pool)) pool = [];
  if (pool.find(s => s.code === code)) return res.status(400).json({ error: "该股票已在自选池中" });
  pool.push({ code, name: name || "", addedAt: new Date().toISOString() });
  tradeDB.setSetting("stock_pool", pool);
  // 发送添加通知
  notifyStockPick(`📋 手动添加自选股`, [{ code, name }], "手动添加");
  res.json({ success: true, stocks: pool });
}));

router.delete("/api/autotrade/stock-pool/:code", asyncHandler(async (req, res) => {
  const pool = tradeDB.getSetting("stock_pool", []);
  const filtered = (Array.isArray(pool) ? pool : []).filter(s => s.code !== req.params.code);
  tradeDB.setSetting("stock_pool", filtered);
  res.json({ success: true, stocks: filtered });
}));

// AI 自动选股
const aiPicker = require("../ai-picker");
router.post("/api/autotrade/auto-pick", asyncHandler(async (req, res) => {
  const { style, count } = req.body || {};
  const picks = await aiPicker.pickStocks({ style: style || "balanced", count: count || 10 });
  // 自动加入自选池
  const pool = tradeDB.getSetting("stock_pool", []);
  const poolArr = Array.isArray(pool) ? pool : [];
  let added = 0;
  const newPicks = [];
  for (const p of picks) {
    if (!poolArr.find(s => s.code === p.code)) {
      poolArr.push({ code: p.code, name: p.name || "", addedAt: new Date().toISOString(), source: "ai-pick" });
      added++;
      newPicks.push(p);
    }
  }
  tradeDB.setSetting("stock_pool", poolArr);
  // 发送选股通知
  if (newPicks.length > 0) {
    notifyStockPick(`🤖 AI 选股通知 — ${newPicks.length} 只新股`, newPicks, "AI智能选股引擎");
  }
  res.json({ success: true, picks, addedToPool: added, total: poolArr.length });
}));

module.exports = router;

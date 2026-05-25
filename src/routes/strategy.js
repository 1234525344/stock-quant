const router = require("express").Router();
const { asyncHandler, validate } = require("../middleware/errorHandler");
const { STOCK_POOL, SCAN_MODES } = require("../state");
const { getKlineData, getKlineDataEnhanced, getFundFlow, getStockName, batchWithLimit } = require("../data");
const { backtest, strategies, strategyNames, parseCustomStrategy, INDICATOR_NAMES } = require("../strategy");
const { screen } = require("../screener");
const { evolve } = require("../evolver");
const { rollingConsistency } = require("../consistency");
const { SMA, EMA, MACD, RSI, KDJ, BOLL } = require("../indicators");
const { getSignalsNow } = require("../helpers");

// ==================== 回测 ====================

router.get("/api/backtest", validate({ code: { type: "string", required: true, pattern: /^\d{6}$/ } }), asyncHandler(async (req, res) => {
  const { code, strategy, days } = req.query;
  const klines = await getKlineData(code, +days || 365);
  if (klines.length < 60) return res.json({ error: "数据不足" });

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const opens = klines.map(k => k.open);
  const dates = klines.map(k => k.date);
  const klineObj = { opens, highs, lows, closes, volumes, dates };

  const stratFn = strategies[strategy] || strategies.maCrossStrategy;
  const result = backtest(klineObj, stratFn);
  // 买入持有基准收益
  const benchmarkReturn = closes.length > 1 ? +(((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(2) : 0;
  res.json({ ...result, strategy: strategyNames[strategy] || strategyNames.maCrossStrategy, code, benchmarkReturn, trades: result.trades.slice(0, 20) });
}));

// ==================== 选股 ====================

router.get("/api/screen", validate({ code: { type: "string", required: true, pattern: /^\d{6}$/ } }), asyncHandler(async (req, res) => {
  const { code } = req.query;
  const klines = await getKlineData(code, 250);
  if (klines.length < 60) return res.json({ error: "数据不足" });

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const dates = klines.map(k => k.date);
  const opens = klines.map(k => k.open);
  const name = await getStockName(code);

  const result = screen({ opens, highs, lows, closes, volumes, dates }, {});
  res.json({ ...result, code, name });
}));

// ==================== 实时买卖信号 ====================

router.get("/api/signals/now", validate({ code: { type: "string", required: true, pattern: /^\d{6}$/ } }), asyncHandler(async (req, res) => {
  const { code } = req.query;
  const signals = await getSignalsNow(code);
  res.json(signals);
}));

// ==================== 股票池 ====================

router.get("/api/pool", (req, res) => {
  res.json(STOCK_POOL);
});

// ==================== 批量扫描 ====================

router.get("/api/scan", asyncHandler(async (req, res) => {
  const mode = SCAN_MODES[req.query.mode] || SCAN_MODES.all;
  const minScore = parseInt(req.query.minScore) || mode.minScore;
  const maxResults = parseInt(req.query.limit) || 30;

  // 根据模式选择扫描范围: 全面扫描时扫描全部
  const poolSize = req.query.mode === "all" ? STOCK_POOL.length : Math.min(60, STOCK_POOL.length);
  const pool = STOCK_POOL.slice(0, poolSize);

  const klineResults = await batchWithLimit(pool, async (code) => {
    try {
      const [klines, fundFlow] = await Promise.all([
        getKlineData(code, 250),
        getFundFlow(code, 5).catch(() => null),
      ]);
      if (klines.length < 60) return null;
      const closes = klines.map(k => k.close);
      const highs = klines.map(k => k.high);
      const lows = klines.map(k => k.low);
      const volumes = klines.map(k => k.volume);
      const dates = klines.map(k => k.date);
      const opens = klines.map(k => k.open);

      // 传入真实资金流向数据
      const fundFlowData = fundFlow && fundFlow.length > 0
        ? { mainNet: fundFlow[fundFlow.length - 1].main,
            recentFlow: fundFlow.slice(-3).reduce((s,d) => s + d.main, 0) }
        : null;

      // 根据不同模式调整筛选参数
      const filters = {};
      if (req.query.mode === "strong") {
        filters.minVolRatio = 1.3;
        filters.requireMACDSignal = true;
      } else if (req.query.mode === "oversold") {
        filters.requireRSILow = true;
        filters.maxPricePos60 = 0.85;
      } else if (req.query.mode === "volume") {
        filters.minVolRatio = 1.6;
      }

      const r = screen({ opens, highs, lows, closes, volumes, dates }, filters, fundFlowData);
      if (!r.passed) return null;
      const name = await getStockName(code);
      return {
        code, name,
        score: r.score, grade: r.grade, gradeColor: r.gradeColor,
        launchStatus: r.launchStatus,
        positionScore: r.positionScore,
        launchScore: r.launchScore,
        qualityScore: r.qualityScore,
        lastPrice: r.lastPrice, chg5: r.chg5,
        reasons: r.reasons,
        details: r.details,
      };
    } catch (e) { return null; }
  }, 10);

  const rawResults = klineResults.filter(Boolean).filter(r => r.score >= minScore);

  // 按模式指定字段排序
  const sortField = mode.sortBy === "position" ? "positionScore" :
                     mode.sortBy === "launch" ? "launchScore" : "score";
  const results = rawResults.sort((a, b) => b[sortField] - a[sortField]).slice(0, maxResults);

  res.json({
    mode: mode.label,
    modeDesc: mode.desc,
    totalScanned: poolSize,
    totalPassed: results.length,
    results,
  });
}));

// ==================== 策略对比 ====================

router.get("/api/compare", asyncHandler(async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "需要股票代码" });
  const klines = await getKlineData(code, 365);
  if (klines.length < 60) return res.json({ error: "数据不足" });

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const opens = klines.map(k => k.open);
  const dates = klines.map(k => k.date);
  const klineObj = { opens, highs, lows, closes, volumes, dates };

  const results = {};
  for (const [name, fn] of Object.entries(strategies)) {
    results[name] = backtest(klineObj, fn);
    delete results[name].trades;
    delete results[name].equityCurve;
    results[name].strategy = strategyNames[name];
  }
  res.json({ code, results });
}));

// ==================== 自定义策略 ====================

router.post("/api/strategy/custom", asyncHandler(async (req, res) => {
  const { code, config, days } = req.body;
  if (!code || !config) return res.status(400).json({ error: "需要股票代码和策略配置" });
  const klines = await getKlineData(code, days || 365);
  if (klines.length < 60) return res.json({ error: "数据不足" });
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const opens = klines.map(k => k.open);
  const dates = klines.map(k => k.date);
  const klineObj = { opens, highs, lows, closes, volumes, dates };

  const stratFn = parseCustomStrategy(config);
  const result = backtest(klineObj, stratFn);
  const name = await getStockName(code);
  res.json({ ...result, code, name, strategy: config.name || "自定义策略" });
}));

// ==================== 策略条件类型 ====================

router.get("/api/strategy/condition-types", (req, res) => {
  res.json({
    types: [
      { type: "ma_cross", name: "均线交叉", params: { fast: 5, slow: 20 }, desc: "快线从下方穿越慢线=买入" },
      { type: "macd_cross", name: "MACD交叉", params: { fast: 12, slow: 26, signal: 9 }, desc: "DIF从下方穿越DEA=买入" },
      { type: "rsi_level", name: "RSI水平", params: { period: 14, oversold: 30, overbought: 70 }, desc: "RSI低于超卖线回升=买入" },
      { type: "boll_touch", name: "布林带突破", params: { period: 20, multiplier: 2 }, desc: "价格从下轨下方回升=买入" },
      { type: "price_vs_ma", name: "价格穿均线", params: { period: 60 }, desc: "价格从下方穿越均线=买入" },
      { type: "kdj_cross", name: "KDJ交叉", params: { period: 9 }, desc: "K线从下方穿越D线(低位)=买入" },
      { type: "volume_spike", name: "成交量异动", params: { period: 20, threshold: 1.5 }, desc: "放量上涨=买入, 放量下跌=卖出" },
    ],
    logicModes: ["AND", "OR", "VOTE"],
  });
});

// ==================== AI策略进化器 ====================

router.post("/api/evolve", asyncHandler(async (req, res) => {
  const { code, config, days, generations, populationSize } = req.body;
  if (!code || !config) return res.status(400).json({ error: "需要股票代码和策略配置" });
  const result = await evolve({
    code, baseConfig: config,
    days: days || 250,
    generations: Math.min(generations || 8, 15),
    populationSize: Math.min(populationSize || 20, 40),
  });
  res.json(result);
}));

// ==================== 一致性追踪 ====================

router.get("/api/consistency", asyncHandler(async (req, res) => {
  const { code, strategy, days } = req.query;
  if (!code) return res.status(400).json({ error: "需要股票代码" });
  const klines = await getKlineDataEnhanced(code, days || 365);
  if (klines.length < 60) return res.json({ error: "数据不足" });

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const opens = klines.map(k => k.open);
  const dates = klines.map(k => k.date);
  const klineObj = { opens, highs, lows, closes, volumes, dates };

  const stratFn = strategies[strategy] || strategies.maCrossStrategy;
  const report = rollingConsistency(klineObj, stratFn, 60, 5);
  res.json({
    code, name: await getStockName(code),
    strategy: strategyNames[strategy] || strategyNames.maCrossStrategy,
    ...report,
  });
}));

module.exports = router;

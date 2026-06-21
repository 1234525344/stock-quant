// Python 量化引擎路由 — 回测 + 指标计算
const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { getKlineData, getRealtimeQuotes, getStockName } = require("../data");
const { execPython } = require("../python-bin");
const path = require("path");

const ENGINE = path.join(__dirname, "../quant-engine.py");

function callEngine(cmd, data, args = []) {
  return new Promise((resolve) => {
    const { execFile } = require("child_process");
    const { PYTHON_BIN } = require("../python-bin");
    const child = execFile(PYTHON_BIN, [ENGINE, cmd, ...args], {
      timeout: 30000, maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout) => {
      if (err) return resolve({ error: err.message });
      try { resolve(JSON.parse(stdout)); }
      catch (e) { resolve({ error: "parse error" }); }
    });
    child.stdin.write(JSON.stringify(data));
    child.stdin.end();
  });
}

// 回测API
router.get("/api/quant/backtest/:code", asyncHandler(async (req, res) => {
  const { code } = req.params;
  const { strategy, fast, slow } = req.query;
  const days = parseInt(req.query.days) || 365;

  const klines = await getKlineData(code, days);
  if (!klines.length) return res.json({ error: "无K线数据" });

  const params = {};
  if (fast) params.fast = parseInt(fast);
  if (slow) params.slow = parseInt(slow);

  const result = await callEngine("backtest", klines, [strategy || "maCross", JSON.stringify(params)]);
  res.json(result);
}));

// 指标计算API
router.get("/api/quant/indicators/:code", asyncHandler(async (req, res) => {
  const { code } = req.params;
  const klines = await getKlineData(code, 365);
  if (!klines.length) return res.json({ error: "无K线数据" });

  const result = await callEngine("indicators", klines);
  res.json(result);
}));

// 综合量化分析 (回测+指标+实时)
router.get("/api/quant/analyze/:code", asyncHandler(async (req, res) => {
  const { code } = req.params;
  const [klines, quotes] = await Promise.all([
    getKlineData(code, 500).catch(() => []),
    getRealtimeQuotes([code]).catch(() => []),
  ]);
  if (!klines.length) return res.json({ error: "无K线数据" });

  const q = quotes[0] || {};
  const name = q.name || await getStockName(code);

  // 并行计算所有指标+回测
  const [indicators, btMa, btMacd, btBoll, btRsi] = await Promise.all([
    callEngine("indicators", klines),
    callEngine("backtest", klines, ["maCross", '{"fast":5,"slow":20}']),
    callEngine("backtest", klines, ["macd"]),
    callEngine("backtest", klines, ["boll"]),
    callEngine("backtest", klines, ["rsi"]),
  ]);

  // 找到最佳策略
  const strategies = [
    { name: "均线交叉 MA5×MA20", ...btMa },
    { name: "MACD金叉死叉", ...btMacd },
    { name: "布林带波段", ...btBoll },
    { name: "RSI超买超卖", ...btRsi },
  ];
  const best = strategies.filter(s => s.totalReturn !== undefined).sort((a, b) => b.totalReturn - a.totalReturn)[0];

  res.json({
    code, name, price: q.price || klines[klines.length-1].close,
    indicators: {
      sma5: indicators.sma5,
      sma20: indicators.sma20,
      sma60: indicators.sma60,
      bollUpper: indicators.boll_upper,
      bollMid: indicators.boll_mid,
      bollLower: indicators.boll_lower,
      rsi14: indicators.rsi14,
      macdDif: indicators.macd_dif,
      macdDea: indicators.macd_dea,
      macdHist: indicators.macd_hist,
      atr14: indicators.atr14,
    },
    strategies,
    bestStrategy: best,
    klines: klines.slice(-250),
  });
}));

module.exports = router;

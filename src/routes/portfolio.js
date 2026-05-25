const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");

// ── Shared State ──
const { STOCK_POOL } = require("../state");

// ── Data Layer ──
const { getKlineData, getStockName, batchWithLimit, getRealtimeQuotes } = require("../data");

// ── Factors ──
const { computeCrossSectionalFactors, computeFactorReturns, factorICStats } = require("../factors");

// ── Risk ──
const { alignReturns, ledoitWolfCovariance, portfolioReturns } = require("../risk");

// ── Portfolio ──
const { optimize, efficientFrontier } = require("../portfolio");

// ── AI ──
const { chatCompletion, getApiKey } = require("../ai-service");

// ── Helpers ──
const { getSignalsNow, getStockAnalysis } = require("../helpers");

// ═══════════════════════════════════════════════════════════
// 因子暴露矩阵 (全股票池)
// ═══════════════════════════════════════════════════════════
router.get("/api/factors/exposures", asyncHandler(async (req, res) => {
  const pool = STOCK_POOL.slice(0, 35);
  const batchData = await batchWithLimit(pool, async (code) => {
    try {
      const klines = await getKlineData(code, 250);
      if (klines.length < 60) return null;
      return { code, klines };
    } catch (e) { return null; }
  }, 5);

  const validData = batchData.filter(Boolean);
  if (validData.length < 5) return res.status(400).json({ error: "数据不足，至少需要5只有效股票" });

  const factorResults = computeCrossSectionalFactors(validData);
  const names = await Promise.all(validData.map(d => getStockName(d.code).catch(() => d.code)));

  // 构建响应: 每只股票的因子暴露 + Alpha
  const expos = factorResults.map((r, i) => ({
    code: r.code,
    name: names[i] || r.code,
    alpha: r.alpha,
    factors: r.exposures,
  }));

  res.json(expos);
}));

// ═══════════════════════════════════════════════════════════
// 因子收益率 / IC时间序列
// ═══════════════════════════════════════════════════════════
router.get("/api/factors/returns", asyncHandler(async (req, res) => {
  const pool = STOCK_POOL.slice(0, 20);
  const batchData = await batchWithLimit(pool, async (code) => {
    try {
      const klines = await getKlineData(code, 365);
      if (klines.length < 120) return null;
      return { code, klines };
    } catch (e) { return null; }
  }, 5);

  const validData = batchData.filter(Boolean);
  if (validData.length < 5) return res.status(400).json({ error: "数据不足，至少需要5只有效股票" });

  const factorRets = computeFactorReturns(validData, 20);
  const icStats = factorICStats(factorRets);

  res.json({ series: factorRets, icStats });
}));

// ═══════════════════════════════════════════════════════════
// 组合优化
// ═══════════════════════════════════════════════════════════
router.post("/api/portfolio/optimize", asyncHandler(async (req, res) => {
  let { codes, method } = req.body;
  if (!codes) codes = STOCK_POOL.slice(0, 10).join(",");
  const codeList = codes.split(",").filter(Boolean).slice(0, 15);
  if (codeList.length < 2) return res.status(400).json({ error: "至少需要2只股票" });

  // 批量取K线
  const batchData = await batchWithLimit(codeList, async (code) => {
    try {
      const klines = await getKlineData(code, 250);
      if (klines.length < 60) return null;
      return { code, closes: klines.map(k => k.close), klines };
    } catch (e) { return null; }
  }, 5);

  const validData = batchData.filter(Boolean);
  if (validData.length < 2) return res.json({ error: "有效数据不足" });

  // 对齐收益率
  const aligned = alignReturns(validData);
  const retMatrix = aligned.matrix;
  if (retMatrix.length < 2) return res.json({ error: "对齐后数据不足" });

  // 协方差矩阵 (Ledoit-Wolf)
  const { cov, codes: covCodes, shrinkage } = ledoitWolfCovariance(retMatrix);

  // Alpha信号 (从多因子模型获取)
  const factors = computeCrossSectionalFactors(validData);
  const alphas = factors.map(f => f.alpha / 100); // rescale

  // 各方法优化
  const methods = (method || "all").split(",");
  const results = {};

  const doOpt = async (m) => {
    const result = optimize(retMatrix.map(r => r.returns), cov, m, alphas);
    const names = await Promise.all(covCodes.map(c => getStockName(c).catch(() => c)));
    return {
      method: m,
      weights: result.weights.map((w, i) => ({
        code: covCodes[i],
        name: names[i] || covCodes[i],
        weight: w.weight,
      })),
      stats: result.stats,
    };
  };

  if (methods.includes("all") || methods.includes("maxSharpe"))
    results.maxSharpe = await doOpt("maxSharpe");
  if (methods.includes("all") || methods.includes("minVariance"))
    results.minVariance = await doOpt("minVariance");
  if (methods.includes("all") || methods.includes("riskParity"))
    results.riskParity = await doOpt("riskParity");
  if (methods.includes("all") || methods.includes("equalWeight"))
    results.equalWeight = await doOpt("equalWeight");
  if (methods.includes("all") || methods.includes("blackLitterman"))
    results.blackLitterman = await doOpt("blackLitterman");

  // 有效前沿
  const frontier = efficientFrontier(retMatrix.map(r => r.returns), cov);

  // Alpha分布
  const alphaDist = factors.map(f => ({
    code: f.code,
    alpha: f.alpha,
    exposures: f.exposures,
  }));

  res.json({
    stocks: await Promise.all(covCodes.map(async (c, i) => ({
      code: c,
      name: await getStockName(c).catch(() => c),
      alpha: alphaDist[i]?.alpha || 0,
    }))),
    shrinkage: +shrinkage.toFixed(3),
    results,
      efficientFrontier: frontier,
      alphaDistribution: alphaDist,
    });
}));

// ═══════════════════════════════════════════════════════════
// 有效前沿 (轻量级)
// ═══════════════════════════════════════════════════════════
router.get("/api/portfolio/efficient-frontier", asyncHandler(async (req, res) => {
  const { codes } = req.query;
  if (!codes) return res.json({ error: "需要股票代码列表" });
  const codeList = codes.split(",").filter(Boolean).slice(0, 12);
  if (codeList.length < 2) return res.json({ error: "至少需要2只股票" });

  const batchData = await batchWithLimit(codeList, async (code) => {
    try {
      const klines = await getKlineData(code, 250);
      if (klines.length < 60) return null;
      return { code, closes: klines.map(k => k.close), klines };
    } catch (e) { return null; }
  }, 5);

  const validData = batchData.filter(Boolean);
  const aligned = alignReturns(validData);
  const { cov } = ledoitWolfCovariance(aligned.matrix);
  const frontier = efficientFrontier(aligned.matrix.map(r => r.returns), cov);

  res.json({ frontier });
}));

// ═══════════════════════════════════════════════════════════
// 组合分析 API - 分析多只股票的组合风险收益
// ═══════════════════════════════════════════════════════════
router.post("/api/portfolio/analyze", asyncHandler(async (req, res) => {
  const { codes, weights } = req.body;
  if (!codes || !Array.isArray(codes) || codes.length === 0) {
    return res.status(400).json({ error: "请提供至少一只股票代码" });
  }
  if (codes.length > 20) {
    return res.status(400).json({ error: "最多支持20只股票" });
  }

  // 获取所有股票的数据
  const stockData = [];
  for (const code of codes.slice(0, 10)) {
    try {
      const [quote, analysis] = await Promise.all([
        getRealtimeQuotes([code]).then(r => r[0]).catch(() => null),
        getStockAnalysis(code).catch(() => null),
      ]);
      if (quote) {
        stockData.push({
          code,
          name: quote.name || code,
          price: quote.price,
          change: quote.change,
          changePct: quote.changePct,
          volume: quote.volume,
          analysis: analysis,
        });
      }
    } catch (e) {}
  }

  if (stockData.length === 0) {
    return res.status(404).json({ error: "未找到有效的股票数据" });
  }

  // 计算组合指标
  const avgChange = stockData.reduce((s, d) => s + (d.changePct || 0), 0) / stockData.length;
  const avgVolatility = stockData.reduce((s, d) => {
    const vol = d.analysis?.volatility?.percentile || 50;
    return s + vol;
  }, 0) / stockData.length;

  // 计算相关性（简化版）
  const signals = stockData.map(d => d.analysis?.signals?.consensus || "neutral");
  const buyCount = signals.filter(s => s.includes("buy")).length;
  const sellCount = signals.filter(s => s.includes("sell")).length;

  // 风险评估
  let riskLevel = "低";
  let riskColor = "#22c55e";
  if (avgVolatility > 70 || sellCount > buyCount) {
    riskLevel = "高";
    riskColor = "#f87171";
  } else if (avgVolatility > 40 || buyCount === sellCount) {
    riskLevel = "中";
    riskColor = "#fbbf24";
  }

  // 分散化评分
  const diversification = Math.min(100, stockData.length * 15);

  res.json({
    stocks: stockData,
    summary: {
      totalStocks: stockData.length,
      avgChange: avgChange.toFixed(2),
      avgVolatility: avgVolatility.toFixed(0),
      buySignals: buyCount,
      sellSignals: sellCount,
      neutralSignals: signals.length - buyCount - sellCount,
      riskLevel,
      riskColor,
      diversification,
      suggestion: buyCount > sellCount ? "偏多" : sellCount > buyCount ? "偏空" : "均衡",
    },
    generatedAt: new Date().toISOString(),
  });
}));

module.exports = router;

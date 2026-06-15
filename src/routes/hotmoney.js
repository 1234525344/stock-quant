// 游资分析 API 路由
//
// GET /api/hotmoney/scan        — 批量扫描股票池, 按游资风格评分排序
// GET /api/hotmoney/screen/:code — 单只股票深度分析 (含游资风格匹配)
// GET /api/hotmoney/patterns     — 全池特殊形态汇总 (连板/炸板/翘板/地天板)
// GET /api/hotmoney/signals/:code — 单只股票买卖点信号
// GET /api/hotmoney/styles/:code  — 单只股票游资风格匹配

const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { getKlineData, getStockName, getFundFlow, batchWithLimit } = require("../data");
const { STOCK_POOL } = require("../state");
const {
  shortTermAnalysis,
  longTermAnalysis,
  analyzeEntryExit,
  hotMoneyScan,
  detectConsecutiveLimitUps,
  detectBlownLimitUps,
  detectBottomFishing,
  detectExtremeReversal,
  detectDivergenceToConsensus,
} = require("../hotmoney");
const { matchAllStyles } = require("../hotmoney");

// ── 单股深度分析 ──
router.get("/api/hotmoney/screen/:code", asyncHandler(async (req, res) => {
  const code = req.params.code;
  const days = parseInt(req.query.days) || 250;

  const klines = await getKlineData(code, days);
  if (!klines || klines.length < 60) {
    return res.status(400).json({ error: "数据不足" });
  }

  const name = await getStockName(code);
  let fundFlow = null;
  try {
    fundFlow = await getFundFlow(code, 60);
  } catch (e) { /* optional */ }

  const short = shortTermAnalysis(klines, code);
  const long = longTermAnalysis(klines, code, fundFlow);
  const signals = analyzeEntryExit(klines, fundFlow);
  const styles = matchAllStyles(klines);

  res.json({
    code,
    name,
    shortTerm: short,
    longTerm: long,
    signals,
    styles,
  });
}));

// ── 买卖点信号 ──
router.get("/api/hotmoney/signals/:code", asyncHandler(async (req, res) => {
  const code = req.params.code;
  const days = parseInt(req.query.days) || 120;

  const klines = await getKlineData(code, days);
  if (!klines || klines.length < 60) {
    return res.status(400).json({ error: "数据不足" });
  }

  const signals = analyzeEntryExit(klines);

  // Detect specific patterns
  const consecutiveLU = detectConsecutiveLimitUps(klines).slice(-3);
  const blownUps = detectBlownLimitUps(klines).slice(-3);
  const bottomFish = detectBottomFishing(klines).slice(-2);
  const reversal = detectExtremeReversal(klines).slice(-2);

  res.json({
    code,
    signals,
    patterns: {
      consecutiveLimitUps: consecutiveLU,
      blownUps,
      bottomFishingToday: bottomFish.filter(b => b.idx >= klines.length - 2),
      extremeReversal: reversal,
    },
  });
}));

// ── 全池形态汇总 ──
router.get("/api/hotmoney/patterns", asyncHandler(async (req, res) => {
  const poolSize = Math.min(parseInt(req.query.pool) || 50, 100);
  const pool = STOCK_POOL.slice(0, poolSize);

  const batchData = await batchWithLimit(pool, async (code) => {
    try {
      const klines = await getKlineData(code, 120);
      if (!klines || klines.length < 60) return null;
      const name = await getStockName(code);
      return { code, name, klines };
    } catch (e) { return null; }
  }, 8);

  const validData = batchData.filter(Boolean);
  const patterns = {
    consecutiveLimitUps: [],   // 连板股
    blownUps: [],              // 炸板股
    bottomFishing: [],         // 翘板信号
    extremeReversal: [],       // 地天板/天地板
    divergenceToConsensus: [], // 分歧转一致
  };

  for (const stock of validData) {
    const klines = stock.klines;

    const consLU = detectConsecutiveLimitUps(klines, 2);
    if (consLU.length > 0) {
      patterns.consecutiveLimitUps.push({
        code: stock.code, name: stock.name,
        current: consLU[consLU.length - 1],
        history: consLU.length,
      });
    }

    const blowns = detectBlownLimitUps(klines);
    const recentBlowns = blowns.filter(b => b.idx >= klines.length - 3);
    for (const b of recentBlowns) {
      patterns.blownUps.push({
        code: stock.code, name: stock.name, latest: b,
      });
    }

    const fish = detectBottomFishing(klines);
    const recentFish = fish.filter(f => f.idx >= klines.length - 2);
    for (const f of recentFish) {
      patterns.bottomFishing.push({
        code: stock.code, name: stock.name, latest: f,
      });
    }

    const rev = detectExtremeReversal(klines);
    const recentRev = rev.filter(r => r.idx >= klines.length - 5);
    for (const r of recentRev) {
      patterns.extremeReversal.push({
        code: stock.code, name: stock.name, latest: r,
      });
    }

    const dtc = detectDivergenceToConsensus(klines);
    const recentDTC = dtc.filter(d => d.date === klines[klines.length - 1]?.date);
    for (const d of recentDTC) {
      patterns.divergenceToConsensus.push({
        code: stock.code, name: stock.name, latest: d,
      });
    }
  }

  res.json({
    scanned: validData.length,
    timestamp: new Date().toISOString(),
    patterns,
    summary: {
      totalLimitingUp: patterns.consecutiveLimitUps.length,
      totalBlownUps: patterns.blownUps.length,
      totalBottomFishing: patterns.bottomFishing.length,
      totalExtremeReversal: patterns.extremeReversal.length,
      totalDivergenceToConsensus: patterns.divergenceToConsensus.length,
    },
  });
}));

// ── 批量扫描 (短线+长线评级 + 形态) ──
router.get("/api/hotmoney/scan", asyncHandler(async (req, res) => {
  const poolSize = Math.min(parseInt(req.query.pool) || 50, 100);
  const pool = STOCK_POOL.slice(0, poolSize);

  const batchData = await batchWithLimit(pool, async (code) => {
    try {
      const klines = await getKlineData(code, 250);
      if (!klines || klines.length < 60) return null;
      const name = await getStockName(code);
      return { code, name, klines };
    } catch (e) { return null; }
  }, 8);

  const validData = batchData.filter(Boolean);

  // 获取资金流数据
  const fundFlowCache = {};
  try {
    const flowResults = await batchWithLimit(pool.slice(0, 30), async (code) => {
      try {
        const ff = await getFundFlow(code, 60);
        fundFlowCache[code] = ff;
        return true;
      } catch (e) { return false; }
    }, 5);
  } catch (e) { /* proceed without fund flow */ }

  // 逐个分析
  const shortTermPicks = [];
  const longTermPicks = [];
  const allResults = [];

  for (const stock of validData) {
    const ff = fundFlowCache[stock.code] || null;
    const short = shortTermAnalysis(stock.klines, stock.code);
    const long = longTermAnalysis(stock.klines, stock.code, ff);
    const signals = analyzeEntryExit(stock.klines, ff);
    const styles = matchAllStyles(stock.klines);
    const topMatch = (styles && styles.topMatch && styles.topMatch !== "无匹配") ? styles.topMatch : "";

    allResults.push({
      code: stock.code,
      name: stock.name,
      shortTerm: { score: short.score, grade: short.grade, suggestion: short.suggestion, topTrader: topMatch },
      longTerm: { score: long.score, grade: long.grade, suggestion: long.suggestion, topTrader: topMatch },
      signals: { score: signals.score, suggestion: signals.suggestion, timeframe: signals.timeframe, topMatch, styleMatch: topMatch },
    });

    if (short.grade === "A" || short.grade === "B") { short.code = stock.code; short.name = stock.name; short.topTrader = topMatch; shortTermPicks.push(short); }
    if (long.grade === "A" || long.grade === "B") { long.code = stock.code; long.name = stock.name; long.topTrader = topMatch; longTermPicks.push(long); }
  }

  // 排序
  allResults.sort((a, b) => b.shortTerm.score - a.shortTerm.score);

  res.json({
    timestamp: new Date().toISOString(),
    scanned: validData.length,
    withFundFlow: Object.keys(fundFlowCache).length,
    topShortTerm: allResults.filter(r => r.shortTerm.grade === "A" || r.shortTerm.grade === "B").slice(0, 15),
    topLongTerm: allResults.filter(r => r.longTerm.grade === "A" || r.longTerm.grade === "B").slice(0, 15),
    all: allResults,
    summary: {
      shortTermA: allResults.filter(r => r.shortTerm.grade === "A").length,
      shortTermB: allResults.filter(r => r.shortTerm.grade === "B").length,
      longTermA: allResults.filter(r => r.longTerm.grade === "A").length,
      longTermB: allResults.filter(r => r.longTerm.grade === "B").length,
    },
  });
}));

// ── 游资风格匹配 ──
router.get("/api/hotmoney/styles/:code", asyncHandler(async (req, res) => {
  const code = req.params.code;
  const days = parseInt(req.query.days) || 250;

  const klines = await getKlineData(code, days);
  if (!klines || klines.length < 60) {
    return res.status(400).json({ error: "数据不足" });
  }

  const name = await getStockName(code);
  const styles = matchAllStyles(klines);

  res.json({
    code,
    name,
    ...styles,
  });
}));

module.exports = router;

const express = require("express");
const router = express.Router();
const { asyncHandler } = require("../middleware/errorHandler");

// ── Data 层 ──
const {
  getRealtimeQuotes,
  getKlineData,
  getKlineDataEnhanced,
  searchStock,
  getStockName,
  getFundFlow,
  getMarginTrade,
  getMarketBreadth,
} = require("../data");

// ── 指数 / 板块 ──
const {
  getIndexQuotes,
  getIndexKline,
  getSectorPerformance,
  getSectorFlow,
  getConceptFlow,
  getStockComments,
} = require("../index");

// ── 技术指标 ──
const { SMA, MACD, RSI, KDJ, BOLL } = require("../indicators");

// ── TDX ──
const { getTDXRoot, getTDXSnapshot } = require("../tdx-reader");
const { getTDXTCPClient, connectTDXServer } = require("../tdx-tcp");

// ── 实时引擎 ──
const { getRealtimeEngine } = require("../realtime-engine");

// ── 辅助函数 ──
const { getStockAnalysis } = require("../helpers");

// ── 资金流向 ──
const { calcDailyFundFlow } = require("../fundflow");

// ── 共享状态 ──
const { quoteCache, STOCK_POOL } = require("../state");

// ── 缓存中间件 ──
const { cacheMiddleware, cacheHeaders } = require("../middleware/cache");

// ── 本地常量 ──
const HTTP_CACHE_TTL = 30000; // 30s HTTP行情缓存

// ═══════════════════════════════════════════════════════════
// 搜索
// ═══════════════════════════════════════════════════════════

router.get("/api/search", asyncHandler(async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    res.json(await searchStock(q));
}));

// ═══════════════════════════════════════════════════════════
// TDX 状态 & 连接
// ═══════════════════════════════════════════════════════════

router.get("/api/tdx/status", (req, res) => {
  const root = getTDXRoot();
  const tcpClient = getTDXTCPClient();
  const engine = getRealtimeEngine();

  res.json({
    tdxInstalled: root !== null,
    tdxRoot: root || null,
    tcpConnected: tcpClient.getStatus().connected,
    tcpSubscribed: tcpClient.getStatus().subscribed.length,
    engineSubscribed: engine.subscribedCodes.size,
    cacheSize: engine.quoteCache ? engine.quoteCache.size : 0,
    quoteCacheSize: quoteCache.size,
    timestamp: new Date().toISOString(),
  });
});

router.post("/api/tdx/connect", (req, res) => {
  try {
    const { host, port } = req.body;
    // SSRF防护: 仅允许连接已知TDX服务器或本地地址
    const ALLOWED_HOSTS = [
      "119.147.212.81", "47.92.127.149", "120.76.152.2",
      "124.70.45.107", "47.94.201.130", "127.0.0.1", "localhost",
    ];
    if (host && !ALLOWED_HOSTS.includes(host)) {
      return res.status(400).json({ error: "不允许连接到指定主机" });
    }
    if (port && (port < 1 || port > 65535)) {
      return res.status(400).json({ error: "端口号无效" });
    }
    const client = connectTDXServer(host || undefined, port || undefined);
    // 自动订阅当前监控的股票
    const engine = getRealtimeEngine();
    if (engine.subscribedCodes.size > 0) {
      client.subscribe([...engine.subscribedCodes]);
    }
    res.json({ status: "connecting", subscribed: client.getStatus().subscribed.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/tdx/disconnect", (req, res) => {
  const client = getTDXTCPClient();
  client.disconnect();
  res.json({ status: "disconnected" });
});

// ═══════════════════════════════════════════════════════════
// 实时行情
// ═══════════════════════════════════════════════════════════

// 单只股票毫秒级实时行情 (优先TDX, fallback Sina)
router.get("/api/quote/realtime/:code", asyncHandler(async (req, res) => {
    const { code } = req.params;
    if (!code) return res.status(400).json({ error: "需要股票代码" });

    // 1. 查实时引擎
    const engine = getRealtimeEngine();
    const cached = engine.getQuote(code);
    if (cached) return res.json({ ...cached, source: "engine_cache" });

    // 2. TDX本地文件
    const tdxData = getTDXSnapshot([code]);
    if (tdxData.length > 0 && tdxData[0].price > 0) {
      return res.json({ ...tdxData[0], source: "tdx_file" });
    }

    // 3. Sina HTTP
    const quotes = await getRealtimeQuotes([code]);
    if (quotes.length > 0) {
      return res.json({ ...quotes[0], source: "sina_http" });
    }

    res.json({ error: "无法获取行情数据" });
}));

// 批量实时行情 (从引擎获取)
router.get("/api/quote/batch", asyncHandler(async (req, res) => {
    const { codes } = req.query;
    if (!codes) return res.json([]);
    const codeList = codes.split(",").slice(0, 50);
    const engine = getRealtimeEngine();

    // 1. 从实时引擎缓存获取
    const results = [];
    const missing = [];
    for (const c of codeList) {
      const q = engine.getQuote(c);
      if (q && Date.now() - q.time < 3000) { results.push(q.data || q); }
      else missing.push(c);
    }

    // 2. 缺失的从HTTP缓存获取
    const stillMissing = [];
    for (const c of missing) {
      const cached = quoteCache.get(c);
      if (cached && Date.now() - cached.time < 30000) {
        results.push(cached.data);
      } else {
        stillMissing.push(c);
      }
    }

    // 3. 仍然缺失的, 从新浪HTTP实时拉取
    if (stillMissing.length > 0) {
      try {
        const fresh = await getRealtimeQuotes(stillMissing);
        for (const q of fresh) {
          quoteCache.set(q.code, { time: Date.now(), data: q });
          results.push(q);
        }
      } catch (e) { /* HTTP fallback failed, return what we have */ }
    }

    res.json(results);
}));

// 实时行情列表 (默认从STOCK_POOL)
router.get("/api/quote", asyncHandler(async (req, res) => {
    let { codes } = req.query;
    if (!codes) codes = STOCK_POOL.join(",");
    const codeList = codes.split(",").slice(0, 50);

    // 优先从实时引擎获取
    const engine = getRealtimeEngine();
    const engineResults = engine.getQuotes(codeList);
    if (engineResults.length === codeList.length) {
      return res.json(engineResults);
    }

    // 引擎缓存不足, HTTP补漏
    const cacheKey = codeList.join(",");
    const cached = quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.time < HTTP_CACHE_TTL) return res.json(cached.data);

    const data = await getRealtimeQuotes(codeList);
    quoteCache.set(cacheKey, { time: Date.now(), data });
    res.json(data);
}));

// 订阅实时行情
router.post("/api/subscribe", (req, res) => {
  try {
    const { codes } = req.body;
    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ error: "需要股票代码数组" });
    }
    const engine = getRealtimeEngine();
    engine.subscribeCodes(codes);
    res.json({
      subscribed: [...engine.subscribedCodes],
      count: engine.subscribedCodes.size,
      quoteCount: engine.quoteCache.size,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// K线
// ═══════════════════════════════════════════════════════════

router.get("/api/kline", asyncHandler(async (req, res) => {
    const { code, days } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    res.json(await getKlineData(code, +days || 365));
}));

// 增强K线 (多源fallback)
router.get("/api/kline/enhanced", asyncHandler(async (req, res) => {
    const { code, days } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const data = await getKlineDataEnhanced(code, +days || 365);
    res.json(data);
}));

// ═══════════════════════════════════════════════════════════
// 技术指标
// ═══════════════════════════════════════════════════════════

router.get("/api/indicators", asyncHandler(async (req, res) => {
    const { code, days } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const klines = await getKlineData(code, +days || 250);
    if (klines.length < 30) return res.json({ error: "数据不足" });

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const opens = klines.map(k => k.open);
    const volumes = klines.map(k => k.volume);
    const dates = klines.map(k => k.date);

    const ma5 = SMA(closes, 5);
    const ma10 = SMA(closes, 10);
    const ma20 = SMA(closes, 20);
    const ma60 = SMA(closes, 60);
    const { dif, dea, macd } = MACD(closes);
    const rsi14 = RSI(closes, 14);
    const { k, d, j } = KDJ(highs, lows, closes);
    const { mid, upper, lower } = BOLL(closes);

    res.json({
      dates, opens, highs, lows, closes, volumes,
      ma5, ma10, ma20, ma60,
      macd: { dif, dea, macd },
      rsi: rsi14,
      kdj: { k, d, j },
      boll: { mid, upper, lower },
    });
}));

// ═══════════════════════════════════════════════════════════
// 个股评论 / 研报
// ═══════════════════════════════════════════════════════════

router.get("/api/stock/comments", asyncHandler(async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const data = await getStockComments(code);
    res.json(data);
}));

// ═══════════════════════════════════════════════════════════
// 增强个股分析
// ═══════════════════════════════════════════════════════════

router.get("/api/stock/analysis/:code", asyncHandler(async (req, res) => {
  const { code } = req.params;

  const [analysisResp, quote, indexKlines] = await Promise.all([
    getStockAnalysis(code).catch(() => null),
    getRealtimeQuotes([code]).catch(() => []),
    getIndexKline("000001", 250).catch(() => []),
  ]);

  const name = (quote[0]?.name) || analysisResp?.name || await getStockName(code);
  const price = quote[0]?.price || analysisResp?.price || 0;
  const changePct = quote[0]?.change || analysisResp?.changePct || 0;

  // Beta vs 上证指数
  let beta = null;
  let signals = analysisResp?.signals || {};
  if (analysisResp?.risk?.beta != null) {
    beta = analysisResp.risk.beta;
  }

  res.json({
    code, name, price, changePct,
    fiftyTwoWeek: analysisResp?.fiftyTwoWeek || { high: 0, low: 0, distFromHigh: null, distFromLow: null },
    volatility: analysisResp?.volatility || { current: 0, percentile: null },
    volume: analysisResp?.volume || { lastVol: 0, avgVol20: 0, volRatio: null },
    risk: { beta },
    signals,
  });
}));

// ═══════════════════════════════════════════════════════════
// 指数行情 / 指数K线
// ═══════════════════════════════════════════════════════════

router.get("/api/index/quotes", cacheHeaders(30), async (req, res) => {
  try {
    const data = await getIndexQuotes();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/index/kline", asyncHandler(async (req, res) => {
    const { code, days } = req.query;
    if (!code) return res.status(400).json({ error: "需要指数代码" });
    const klines = await getIndexKline(code, +days || 365);
    if (!klines.length) return res.json({ error: "数据不足" });
    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume);
    const dates = klines.map(k => k.date);
    const ma5 = SMA(closes, 5);
    const ma10 = SMA(closes, 10);
    const ma20 = SMA(closes, 20);
    const ma60 = SMA(closes, 60);
    const { dif, dea, macd } = MACD(closes);
    const rsi14 = RSI(closes, 14);
    const { mid, upper, lower } = BOLL(closes);
    res.json({
      dates, closes, volumes,
      ma5, ma10, ma20, ma60,
      macd: { dif, dea, macd },
      rsi: rsi14,
      boll: { mid, upper, lower },
    });
}));

// ═══════════════════════════════════════════════════════════
// 板块资金流向 / 行业板块
// ═══════════════════════════════════════════════════════════

// 板块资金流向 (实时)
router.get("/api/market/sector-flow", cacheHeaders(60), async (req, res) => {
  try {
    const data = await getSectorFlow();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 概念板块资金流向
router.get("/api/market/concept-flow", cacheHeaders(60), async (req, res) => {
  try {
    const data = await getConceptFlow();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 行业板块行情
router.get("/api/market/sectors", cacheHeaders(60), async (req, res) => {
  try {
    const data = await getSectorPerformance();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 市场综述
// ═══════════════════════════════════════════════════════════

router.get("/api/market/summary", asyncHandler(async (req, res) => {
    const [indices, sectors, sectorFlow] = await Promise.all([
      getIndexQuotes().catch(() => []),
      getSectorPerformance().catch(() => []),
      getSectorFlow().catch(() => []),
    ]);

    // 判断市场整体状态
    let totalChg = 0, upCount = 0, downCount = 0;
    indices.forEach(i => {
      totalChg += i.changePct || 0;
      if (i.changePct > 0) upCount++;
      else if (i.changePct < 0) downCount++;
    });
    const avgChg = indices.length > 0 ? totalChg / indices.length : 0;

    // 行业强弱
    const topSectors = [...sectors].sort((a, b) => (b.changePct || 0) - (a.changePct || 0)).slice(0, 5);
    const bottomSectors = [...sectors].sort((a, b) => (a.changePct || 0) - (b.changePct || 0)).slice(0, 5);

    // ===== 市场资金流向 =====
    let totalMainNet = 0, totalAmount = 0;
    let inflowSectors = 0, outflowSectors = 0;
    if (sectorFlow && sectorFlow.length > 0) {
      for (const sf of sectorFlow) {
        totalMainNet += sf.mainNet || 0;
        totalAmount += Math.abs(sf.mainNet || 0);
        if ((sf.mainNet || 0) > 1e6) inflowSectors++;
        else if ((sf.mainNet || 0) < -1e6) outflowSectors++;
      }
    }

    // 资金流向判断
    let flowStatus, flowLabel, flowWarning;
    const flowRatio = totalAmount > 0 ? totalMainNet / totalAmount : 0;
    if (totalMainNet < -5e9) {
      flowStatus = "major_outflow";
      flowLabel = "大资金出逃";
      flowWarning = "⚠️ 市场主力资金大幅流出，注意风险控制。建议降低仓位，规避高位个股，等待资金回流信号。";
    } else if (totalMainNet < -1e9) {
      flowStatus = "outflow";
      flowLabel = "资金持续流出";
      flowWarning = "市场资金整体呈流出态势，热门板块缺乏持续性。建议精选个股，控制仓位。";
    } else if (totalMainNet > 5e9) {
      flowStatus = "major_inflow";
      flowLabel = "大资金入场";
      flowWarning = "🔥 主力资金大幅流入，市场做多意愿强烈。可积极关注资金持续流入的板块和个股。";
    } else if (totalMainNet > 1e9) {
      flowStatus = "inflow";
      flowLabel = "资金流入";
      flowWarning = "资金温和流入，市场氛围偏暖。可适度参与资金关注度高的板块。";
    } else {
      flowStatus = "balanced";
      flowLabel = "资金均衡";
      flowWarning = "市场资金有进有出，多空均衡。建议等待资金方向明确后再加大仓位。";
    }

    // 生成市场综述
    let mood, moodColor, summary;
    if (avgChg > 1.5) {
      mood = "强势上涨"; moodColor = "#e53e3e";
      summary = `市场整体表现强劲，${upCount}个主要指数上涨。涨幅领先的板块是${topSectors[0]?.name || "—"}(${topSectors[0]?.changePct?.toFixed(1) || "—"}%)，市场情绪乐观。`;
    } else if (avgChg > 0.3) {
      mood = "温和上涨"; moodColor = "#e53e3e";
      summary = `市场温和走强，多数指数小幅上涨。${topSectors[0]?.name || "—"}板块表现较好。整体环境偏积极。`;
    } else if (avgChg < -1.5) {
      mood = "明显下跌"; moodColor = "#38a169";
      summary = `市场整体下跌幅度较大，${downCount}个主要指数下跌。${bottomSectors[0]?.name || "—"}等板块跌幅居前。`;
    } else if (avgChg < -0.3) {
      mood = "小幅回调"; moodColor = "#38a169";
      summary = `市场小幅回调，属于正常波动范围。${bottomSectors[0]?.name || "—"}板块稍弱。`;
    } else {
      mood = "横盘震荡"; moodColor = "#718096";
      summary = `市场整体波动不大，方向不明确。板块轮动较快，缺乏持续热点。`;
    }

    // 资金面追加到综述
    if (flowStatus === "major_outflow") {
      summary += ` 但需注意：主力资金今日大幅流出${(Math.abs(totalMainNet)/1e8).toFixed(0)}亿，${outflowSectors}个板块资金净流出，建议谨慎。`;
    } else if (flowStatus === "major_inflow") {
      summary += ` 资金面上，主力净流入${(totalMainNet/1e8).toFixed(0)}亿，${inflowSectors}个板块获资金增持。`;
    }

    res.json({
      indices, sectors,
      marketMood: { mood, moodColor, summary },
      topSectors, bottomSectors,
      upCount, downCount, avgChg,
      // 资金流向
      fundFlow: {
        status: flowStatus,
        label: flowLabel,
        warning: flowWarning,
        totalMainNet: +totalMainNet.toFixed(0),
        totalAmount: +totalAmount.toFixed(0),
        inflowSectors,
        outflowSectors,
        flowRatio: +flowRatio.toFixed(3),
      },
      timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    });
}));

// ═══════════════════════════════════════════════════════════
// 融资融券 / 市场宽度
// ═══════════════════════════════════════════════════════════

router.get("/api/margin", asyncHandler(async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const data = await getMarginTrade(code);
    res.json({ code, data });
}));

router.get("/api/market/breadth", asyncHandler(async (req, res) => {
    const breadth = await getMarketBreadth();
    res.json(breadth || { error: "数据获取失败" });
}));

module.exports = router;

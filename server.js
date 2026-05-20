const express = require("express");
const path = require("path");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const { getRealtimeQuotes, getKlineData, getKlineDataEnhanced, searchStock, batchWithLimit, getStockName, getFundFlow, getFundFlowMinute, getMarginTrade, getMarketBreadth } = require("./src/data");
const { SMA, EMA, MACD, RSI, KDJ, BOLL } = require("./src/indicators");
const { backtest, strategies, strategyNames, parseCustomStrategy, INDICATOR_NAMES } = require("./src/strategy");
const { rollingConsistency } = require("./src/consistency");
const { evolve } = require("./src/evolver");
const { screen } = require("./src/screener");
const { calcDailyFundFlow, MFI, CMF } = require("./src/fundflow");
const { comprehensiveFlowReport } = require("./src/quantflow");
const { getIndexQuotes, getIndexKline, getSectorPerformance, getSectorFlow, getConceptFlow, getStockComments } = require("./src/index");
const { computeCrossSectionalFactors, computeFactorReturns, factorICStats } = require("./src/factors");
const { ledoitWolfCovariance, alignReturns, portfolioReturns, comprehensiveRiskReport, riskDecomposition } = require("./src/risk");
const { optimize, efficientFrontier, maxSharpe, minVariance, riskParity, equalWeight } = require("./src/portfolio");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 全局限流 — 防止滥用 (微信小程序要求服务端稳定可靠)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟窗口
  max: 200,            // 最多200次请求/分钟
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "请求过于频繁，请稍后再试" },
});
app.use("/api/", limiter);

// 免责声明响应头
app.use((req, res, next) => {
  res.setHeader("X-Disclaimer", "数据仅供参考，不构成投资建议");
  next();
});

// 量化工厂页面
app.get("/quantlab", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "quantlab.html"));
});

const quoteCache = new Map();
const CACHE_TTL = 5000;

const STOCK_POOL = [
  // 金融蓝筹
  "000001","000002","002415","300750",
  "600000","600036","601166","601318","601398",
  // 消费白马
  "000858","002594","600276","600519","600887","601888","603259",
  // 新能源
  "601012","002459","002466","300014","300274","600438","601615",
  // 科技
  "000063","000725","002049","002230","002371","300059",
  "600570","600703","603986","688981",
  // 医药
  "000568","000651","000661","002007","300015","300122",
  "600085","600132","600196","600809",
  // 新增: 中小成长 + 周期
  "002475","300124","600900","601899","603288",
  "000333","002714","300433","600745","601138",
  "002142","300498","600690","601088","603833",
  "000625","002916","300760","600104","601225",
  "000338","002241","300408","600690","601689",
  // 更多中小盘
  "002353","300274","600183","601058","603160",
  "000977","002456","300450","600406","601360",
];

// ==================== API ====================

app.get("/api/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    res.json(await searchStock(q));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/quote", async (req, res) => {
  try {
    let { codes } = req.query;
    if (!codes) codes = STOCK_POOL.join(",");
    const codeList = codes.split(",").slice(0, 50);
    const cacheKey = codeList.join(",");
    const cached = quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) return res.json(cached.data);

    const data = await getRealtimeQuotes(codeList);
    quoteCache.set(cacheKey, { time: Date.now(), data });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/kline", async (req, res) => {
  try {
    const { code, days } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    res.json(await getKlineData(code, +days || 365));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/indicators", async (req, res) => {
  try {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/backtest", async (req, res) => {
  try {
    const { code, strategy, days } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
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
    res.json({ ...result, strategy: strategyNames[strategy] || strategyNames.maCrossStrategy, code, trades: result.trades.slice(0, 20) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/screen", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 获取个股评论/研报 (新浪财经)
app.get("/api/stock/comments", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const data = await getStockComments(code);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 批量扫描 — 选低位启动优质股
app.get("/api/scan", async (req, res) => {
  try {
    const pool = STOCK_POOL.slice(0, 40);
    const klineResults = await batchWithLimit(pool, async (code) => {
      try {
        const klines = await getKlineData(code, 250);
        if (klines.length < 60) return null;
        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const volumes = klines.map(k => k.volume);
        const dates = klines.map(k => k.date);
        const opens = klines.map(k => k.open);
        const r = screen({ opens, highs, lows, closes, volumes, dates }, {});
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
    }, 5);

    const results = klineResults.filter(Boolean).sort((a, b) => b.score - a.score);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/compare", async (req, res) => {
  try {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 资金流向 — 日级别 (量价估算)
app.get("/api/fundflow", async (req, res) => {
  try {
    const { code, days } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const klines = await getKlineData(code, +days || 60);
    if (klines.length < 5) return res.json({ error: "数据不足" });
    const flowData = calcDailyFundFlow(klines);
    const name = await getStockName(code);
    const quote = await getRealtimeQuotes([code]).catch(() => []);
    // 附加MFI和CMF指标
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume);
    const mfi = MFI(highs, lows, closes, volumes);
    const cmf = CMF(highs, lows, closes, volumes);
    res.json({
      code, name,
      price: quote[0]?.price,
      change: quote[0]?.change,
      data: flowData,
      mfi: mfi.slice(-20),
      cmf: cmf.slice(-20),
      dates: klines.map(k => k.date).slice(-20),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 资金流向 — 当日实时 (用近期数据趋势估算)
app.get("/api/fundflow/minute", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    // 取最近5天日K + 实时行情
    const klines = await getKlineData(code, 5);
    if (klines.length < 1) return res.json({ error: "数据不足" });
    const flowData = calcDailyFundFlow(klines);
    const latest = flowData[flowData.length - 1];
    const name = await getStockName(code);
    const quote = await getRealtimeQuotes([code]).catch(() => []);
    res.json({
      code, name,
      time: latest.date,
      main: latest.main, retail: latest.retail, mid: latest.mid,
      large: latest.large, huge: latest.huge,
      mainPct: latest.mainPct, retailPct: latest.retailPct, midPct: latest.midPct,
      largePct: latest.largePct, hugePct: latest.hugePct,
      price: quote[0]?.price, change: quote[0]?.change,
      totalAmount: latest.totalAmount,
      trend: flowData, // 用日数据近似分时趋势
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 专业量化资金流向 — 综合报告
app.get("/api/quantflow", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const klines = await getKlineData(code, 250);
    if (klines.length < 60) return res.json({ error: "数据不足" });
    const report = comprehensiveFlowReport(klines);
    const name = await getStockName(code);
    const quote = await getRealtimeQuotes([code]).catch(() => []);
    res.json({
      code, name,
      price: quote[0]?.price, change: quote[0]?.change,
      ...report,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 实时资金快照 — 轻量级, 高频调用
app.get("/api/quantflow/snapshot", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const klines = await getKlineData(code, 60);
    if (klines.length < 5) return res.json({ error: "数据不足" });
    const report = comprehensiveFlowReport(klines);
    const quote = await getRealtimeQuotes([code]).catch(() => []);
    const last = klines[klines.length - 1];
    res.json({
      code,
      price: quote[0]?.price || last.close,
      change: quote[0]?.change || 0,
      name: quote[0]?.name,
      flow: report.summary,
      signals: report.signalSummary,
      lastVWAP: report.lastVWAP?.toFixed(2),
      lastOFI: report.lastOFI,
      lastPrice: last.close,
      timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 大盘指数 ====================

app.get("/api/index/quotes", async (req, res) => {
  try {
    const data = await getIndexQuotes();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/index/kline", async (req, res) => {
  try {
    const { code, days } = req.query;
    if (!code) return res.status(400).json({ error: "需要指数代码" });
    const klines = await getIndexKline(code, +days || 365);
    if (!klines.length) return res.json({ error: "数据不足" });
    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume);
    const dates = klines.map(k => k.date);
    const { SMA, MACD, RSI, BOLL } = require("./src/indicators");
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 板块资金流向 (实时)
app.get("/api/market/sector-flow", async (req, res) => {
  try {
    const data = await getSectorFlow();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 概念板块资金流向
app.get("/api/market/concept-flow", async (req, res) => {
  try {
    const data = await getConceptFlow();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 行业板块行情
app.get("/api/market/sectors", async (req, res) => {
  try {
    const data = await getSectorPerformance();
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 市场总览 (综合: 指数 + 板块 + 市场宽度)
app.get("/api/market/summary", async (req, res) => {
  try {
    const [indices, sectors] = await Promise.all([
      getIndexQuotes().catch(() => []),
      getSectorPerformance().catch(() => []),
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

    // 生成通俗易懂的市场综述
    let mood, moodColor, summary;
    if (avgChg > 1.5) {
      mood = "强势上涨"; moodColor = "#e53e3e";
      summary = `市场整体表现强劲，${upCount}个主要指数上涨。涨幅领先的板块是${topSectors[0]?.name || "—"}(${topSectors[0]?.changePct?.toFixed(1) || "—"}%)，市场情绪乐观。适合积极关注，但也要注意追高风险。`;
    } else if (avgChg > 0.3) {
      mood = "温和上涨"; moodColor = "#e53e3e";
      summary = `市场温和走强，多数指数小幅上涨。${topSectors[0]?.name || "—"}板块表现较好。整体环境偏积极，适合精选个股适度参与。`;
    } else if (avgChg < -1.5) {
      mood = "明显下跌"; moodColor = "#38a169";
      summary = `市场整体下跌幅度较大，${downCount}个主要指数下跌。${bottomSectors[0]?.name || "—"}等板块跌幅居前。建议控制仓位，谨慎操作，等待企稳信号。`;
    } else if (avgChg < -0.3) {
      mood = "小幅回调"; moodColor = "#38a169";
      summary = `市场小幅回调，属于正常波动范围。${bottomSectors[0]?.name || "—"}板块稍弱。整体风险可控，可趁回调关注优质标的。`;
    } else {
      mood = "横盘震荡"; moodColor = "#718096";
      summary = `市场整体波动不大，方向不明确。板块轮动较快，缺乏持续热点。建议多看少动，等待方向明朗后再做决策。`;
    }

    res.json({
      indices, sectors,
      marketMood: { mood, moodColor, summary },
      topSectors, bottomSectors,
      upCount, downCount, avgChg,
      timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 实时资金流向 (分钟级) ====================

app.get("/api/fundflow/realtime", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const [minData, quote] = await Promise.all([
      getFundFlowMinute(code).catch(() => null),
      getRealtimeQuotes([code]).catch(() => []),
    ]);
    const q = quote[0] || {};
    const name = q.name || await getStockName(code);

    // 东方财富分钟级数据
    const trend = minData?.trend || [];
    const latest = trend[trend.length - 1] || {};

    // 计算近5分钟资金变化率
    const recent5 = trend.slice(-5);
    let mainAccel = 0;
    if (recent5.length >= 2) {
      mainAccel = (recent5[recent5.length - 1].main || 0) - (recent5[0].main || 0);
    }

    // 判断实时资金趋势
    let flowMood;
    if (latest.main > 5e7) flowMood = "strong_in";
    else if (latest.main > 1e7) flowMood = "in";
    else if (latest.main < -5e7) flowMood = "strong_out";
    else if (latest.main < -1e7) flowMood = "out";
    else flowMood = "neutral";

    res.json({
      code, name,
      price: q.price, change: q.change,
      time: latest.time || new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      flow: {
        main: latest.main || 0,
        retail: latest.retail || 0,
        mid: latest.mid || 0,
        large: latest.large || 0,
        huge: latest.huge || 0,
      },
      mainAccel,
      flowMood,
      trend: trend.slice(-120),  // 最近120分钟
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 北向资金 (沪深港通) — 东方财富沪股通+深股通
app.get("/api/fundflow/northbound", async (req, res) => {
  try {
    const url = "https://push2his.eastmoney.com/api/qt/kamt.kline/get?secid=90.IFBJVOL&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57&klt=1&lmt=240";
    const { data } = await axios.get(url, { timeout: 8000 });
    const raw = data?.data;
    if (!raw) return res.json({ todayNet: 0, mood: "无数据", trend: [] });

    // 北向 = 沪股通(hk2sh) + 深股通(hk2sz), 数据单位是元
    const shLines = (raw.hk2sh || []).map(line => { const p = line.split(","); return { time: p[0], net: +p[1] || 0 }; });
    const szLines = (raw.hk2sz || []).map(line => { const p = line.split(","); return { time: p[0], net: +p[1] || 0 }; });

    // 合并同时刻的沪+深
    const trend = [];
    const maxLen = Math.max(shLines.length, szLines.length);
    for (let i = 0; i < maxLen; i++) {
      const sh = shLines[i];
      const sz = szLines[i];
      const time = sh?.time || sz?.time || "";
      const netFlow = (sh?.net || 0) + (sz?.net || 0);
      trend.push({ time, netFlow });
    }

    const latest = trend[trend.length - 1] || {};
    const todayNet = trend.reduce((s, t) => s + (t.netFlow || 0), 0);

    let mood;
    if (todayNet > 5e9) mood = "大幅流入";
    else if (todayNet > 1e9) mood = "持续流入";
    else if (todayNet < -5e9) mood = "大幅流出";
    else if (todayNet < -1e9) mood = "持续流出";
    else mood = "小幅波动";

    res.json({
      todayNet: +todayNet.toFixed(0),
      mood,
      latestTime: latest.time,
      latestNet: latest.netFlow || 0,
      trend: trend.slice(-60),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 统一实时资金流 (合并多个数据源)
app.get("/api/fundflow/live", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });

    const [minData, klines, quote] = await Promise.all([
      getFundFlowMinute(code).catch(() => null),
      getKlineData(code, 5).catch(() => []),
      getRealtimeQuotes([code]).catch(() => []),
    ]);

    const q = quote[0] || {};
    const name = q.name || await getStockName(code);
    const dailyFlow = calcDailyFundFlow(klines);
    const latestDay = dailyFlow[dailyFlow.length - 1] || {};
    const minTrend = minData?.trend || [];
    const latestMin = minTrend[minTrend.length - 1] || {};

    // 实时资金速率 (元/分钟)
    const recentMins = minTrend.slice(-10);
    let flowRate = 0;
    if (recentMins.length >= 2) {
      const dt = recentMins.length * 1; // approximate minutes
      flowRate = ((latestMin.main || 0) - (recentMins[0].main || 0)) / Math.max(1, dt);
    }

    res.json({
      code, name,
      price: q.price, change: q.change,
      timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      daily: {
        main: latestDay.main || 0,
        retail: latestDay.retail || 0,
        mid: latestDay.mid || 0,
        totalAmount: latestDay.totalAmount || 0,
      },
      minute: {
        main: latestMin.main || 0,
        retail: latestMin.retail || 0,
        large: latestMin.large || 0,
        huge: latestMin.huge || 0,
      },
      flowRate: +flowRate.toFixed(0),
      flowMood: flowRate > 5e6 ? "rapid_in" : flowRate > 1e6 ? "slow_in"
              : flowRate < -5e6 ? "rapid_out" : flowRate < -1e6 ? "slow_out"
              : "steady",
      minTrend: minTrend.slice(-60),
      dailyFlow: dailyFlow,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 北向资金历史 (日级别, 用于图表)
app.get("/api/fundflow/northbound/daily", async (req, res) => {
  try {
    const url = "https://push2his.eastmoney.com/api/qt/kamt.kline/get?secid=90.IFBJVOL&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&lmt=60";
    const { data } = await axios.get(url, { timeout: 8000 });
    const raw = data?.data;
    if (!raw) return res.json([]);

    const shLines = raw.hk2sh || [];
    const szLines = raw.hk2sz || [];
    const maxLen = Math.max(shLines.length, szLines.length);
    const result = [];
    for (let i = 0; i < maxLen; i++) {
      const shP = (shLines[i] || "").split(",");
      const szP = (szLines[i] || "").split(",");
      const date = shP[0] || szP[0] || "";
      const netFlow = (+shP[1] || 0) + (+szP[1] || 0);
      result.push({ date, netFlow: +netFlow.toFixed(0) });
    }
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 量化工厂 API ====================

// 因子暴露矩阵 (全股票池)
app.get("/api/factors/exposures", async (req, res) => {
  try {
    const pool = STOCK_POOL.slice(0, 35);
    const batchData = await batchWithLimit(pool, async (code) => {
      try {
        const klines = await getKlineData(code, 250);
        if (klines.length < 60) return null;
        return { code, klines };
      } catch (e) { return null; }
    }, 5);

    const validData = batchData.filter(Boolean);
    if (validData.length < 5) return res.json({ error: "数据不足" });

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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 因子收益率 / IC时间序列
app.get("/api/factors/returns", async (req, res) => {
  try {
    const pool = STOCK_POOL.slice(0, 20);
    const batchData = await batchWithLimit(pool, async (code) => {
      try {
        const klines = await getKlineData(code, 365);
        if (klines.length < 120) return null;
        return { code, klines };
      } catch (e) { return null; }
    }, 5);

    const validData = batchData.filter(Boolean);
    if (validData.length < 5) return res.json({ error: "数据不足" });

    const factorRets = computeFactorReturns(validData, 20);
    const icStats = factorICStats(factorRets);

    res.json({ series: factorRets, icStats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 组合优化
app.post("/api/portfolio/optimize", async (req, res) => {
  try {
    let { codes, method } = req.body;
    if (!codes) codes = STOCK_POOL.slice(0, 10).join(",");
    const codeList = codes.split(",").filter(Boolean).slice(0, 15);
    if (codeList.length < 2) return res.json({ error: "至少需要2只股票" });

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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 有效前沿 (轻量级)
app.get("/api/portfolio/efficient-frontier", async (req, res) => {
  try {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 风险分解
app.get("/api/risk/decompose", async (req, res) => {
  try {
    const { code, benchmark } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });

    const [klines, idxKlines] = await Promise.all([
      getKlineData(code, 365),
      getIndexKline(benchmark || "000001", 365).catch(() => []),
    ]);

    if (klines.length < 60) return res.json({ error: "数据不足" });
    const closes = klines.map(k => k.close);
    const rets = [];
    for (let i = 1; i < closes.length; i++) {
      rets.push(closes[i - 1] > 0 ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);
    }

    let mktRets = null;
    if (idxKlines.length >= 60) {
      const idxCloses = idxKlines.map(k => k.close);
      mktRets = [];
      for (let i = 1; i < idxCloses.length; i++) {
        mktRets.push(idxCloses[i - 1] > 0 ? (idxCloses[i] - idxCloses[i - 1]) / idxCloses[i - 1] : 0);
      }
    }

    let riskReport;
    if (mktRets && mktRets.length >= 20) {
      riskReport = riskDecomposition(rets, mktRets);
    } else {
      const totalVar = rets.reduce((s, r) => s + r ** 2, 0) / rets.length;
      const totalRisk = Math.sqrt(totalVar * 252);
      riskReport = { totalRisk: +totalRisk.toFixed(4), systematicRisk: 0, specificRisk: 0, beta: 0, rSquared: 0 };
    }

    const var95 = rets.sort((a, b) => a - b)[Math.floor(rets.length * 0.05)] * Math.sqrt(252);

    res.json({
      code,
      name: await getStockName(code),
      ...riskReport,
      var95: +(var95 * 100).toFixed(1),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 协方差矩阵
app.get("/api/risk/covariance", async (req, res) => {
  try {
    const { codes } = req.query;
    if (!codes) return res.json({ error: "需要股票代码列表" });
    const codeList = codes.split(",").filter(Boolean).slice(0, 15);
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
    const { cov, codes: covCodes, shrinkage } = ledoitWolfCovariance(aligned.matrix);

    // 转为相关性矩阵
    const corr = covCodes.map((_, i) =>
      covCodes.map((_, j) => {
        const s = Math.sqrt(Math.max(0, cov[i][i] * cov[j][j]));
        return s > 0 ? +(cov[i][j] / s).toFixed(3) : 0;
      })
    );

    res.json({
      codes: covCodes,
      covariance: cov,
      correlation: corr,
      shrinkage: +shrinkage.toFixed(3),
      annualVol: covCodes.map((_, i) => +(Math.sqrt(Math.max(0, cov[i][i])) * Math.sqrt(252) * 100).toFixed(1)),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 自定义策略回测 ====================

app.post("/api/strategy/custom", async (req, res) => {
  try {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 可用的策略条件类型
app.get("/api/strategy/condition-types", (req, res) => {
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

// ==================== 实时信号监控 ====================

const monitorCache = { stocks: [], signals: {}, lastCheck: null };

app.post("/api/monitor/start", async (req, res) => {
  try {
    const { codes, config } = req.body;
    if (!codes || !config) return res.status(400).json({ error: "需要股票代码和策略" });
    const codeList = codes.split(",").filter(Boolean).slice(0, 20);
    monitorCache.stocks = codeList;
    monitorCache.config = config;

    // 首次扫描
    const results = await batchWithLimit(codeList, async (code) => {
      try {
        const klines = await getKlineData(code, 120);
        if (klines.length < 60) return null;
        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const volumes = klines.map(k => k.volume);
        const opens = klines.map(k => k.open);
        const dates = klines.map(k => k.date);
        const stratFn = parseCustomStrategy(config);
        const raw = stratFn(closes, highs, lows, volumes, opens, dates);
        const sigs = raw.signals;
        const lastSig = sigs[sigs.length - 1];
        const prevSig = sigs[sigs.length - 2];
        if (lastSig !== 0 && lastSig !== prevSig) {
          const name = await getStockName(code);
          const quote = await getRealtimeQuotes([code]).catch(() => []);
          return {
            code, name,
            price: quote[0]?.price || closes[closes.length - 1],
            signal: lastSig === 1 ? "BUY" : "SELL",
            signalType: lastSig,
            date: dates[dates.length - 1],
          };
        }
        return null;
      } catch (e) { return null; }
    }, 3);

    monitorCache.signals = results.filter(Boolean);
    monitorCache.lastCheck = new Date().toISOString();
    res.json({ stocks: codeList, signals: monitorCache.signals, lastCheck: monitorCache.lastCheck });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/monitor/check", async (req, res) => {
  try {
    if (!monitorCache.stocks.length) return res.json({ signals: [], message: "未启动监控" });
    const codeList = monitorCache.stocks;
    const config = monitorCache.config;

    const results = await batchWithLimit(codeList, async (code) => {
      try {
        const klines = await getKlineData(code, 5);
        if (klines.length < 2) return null;
        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const volumes = klines.map(k => k.volume);
        const opens = klines.map(k => k.open);
        const dates = klines.map(k => k.date);
        const stratFn = parseCustomStrategy(config);
        const raw = stratFn(closes, highs, lows, volumes, opens, dates);
        const sigs = raw.signals;
        const lastSig = sigs[sigs.length - 1];
        const prevSig = sigs[sigs.length - 2];
        if (lastSig !== 0 && lastSig !== prevSig) {
          const name = await getStockName(code);
          const quote = await getRealtimeQuotes([code]).catch(() => []);
          return {
            code, name,
            price: quote[0]?.price || closes[closes.length - 1],
            signal: lastSig === 1 ? "BUY" : "SELL",
            signalType: lastSig,
            date: dates[dates.length - 1],
            timestamp: new Date().toISOString(),
          };
        }
        return null;
      } catch (e) { return null; }
    }, 3);

    const newSignals = results.filter(Boolean);
    const oldKeys = new Set(monitorCache.signals.map(s => `${s.code}_${s.signal}_${s.date}`));
    const alerts = newSignals.filter(s => !oldKeys.has(`${s.code}_${s.signal}_${s.date}`));
    monitorCache.signals = newSignals;
    monitorCache.lastCheck = new Date().toISOString();
    res.json({ signals: newSignals, alerts, lastCheck: monitorCache.lastCheck, monitoredStocks: codeList.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/monitor/stop", (req, res) => {
  monitorCache.stocks = [];
  monitorCache.signals = {};
  monitorCache.config = null;
  monitorCache.lastCheck = null;
  res.json({ status: "stopped" });
});

// ==================== 自动化纸交易 (模拟交易) ====================

let paperAccount = {
  balance: 1000000, initialCapital: 1000000,
  positions: {},
  orders: [], trades: [], tradeId: 1,
  active: false, config: null, stocks: [],
  dailySnapshots: [],
  startDate: null,
};

app.get("/api/paper/status", (req, res) => {
  const positions = Object.values(paperAccount.positions);
  const totalMarketValue = positions.reduce((s, p) => s + p.shares * p.currentPrice, 0);
  const totalEquity = paperAccount.balance + totalMarketValue;
  const totalReturn = +(((totalEquity - paperAccount.initialCapital) / paperAccount.initialCapital) * 100).toFixed(2);

  res.json({
    active: paperAccount.active,
    balance: +paperAccount.balance.toFixed(2),
    initialCapital: paperAccount.initialCapital,
    totalEquity: +totalEquity.toFixed(2),
    totalReturn,
    positions,
    trades: paperAccount.trades.slice(-20),
    config: paperAccount.config,
    stocks: paperAccount.stocks,
    startDate: paperAccount.startDate,
    dailySnapshots: paperAccount.dailySnapshots.slice(-60),
  });
});

app.post("/api/paper/start", async (req, res) => {
  try {
    const { codes, config, initialCapital } = req.body;
    if (!codes || !config) return res.status(400).json({ error: "需要股票代码和策略配置" });
    const codeList = codes.split(",").filter(Boolean).slice(0, 10);

    paperAccount = {
      balance: initialCapital || 1000000,
      initialCapital: initialCapital || 1000000,
      positions: {},
      orders: [], trades: [], tradeId: 1,
      active: true, config, stocks: codeList,
      dailySnapshots: [],
      startDate: new Date().toISOString().slice(0, 10),
    };

    // 初始化: 获取所有持仓的当前价格
    for (const code of codeList) {
      try {
        const quotes = await getRealtimeQuotes([code]);
        const name = await getStockName(code);
        paperAccount.positions[code] = { code, name, shares: 0, avgCost: 0, currentPrice: quotes[0]?.price || 0 };
      } catch (e) {}
    }

    res.json({ status: "started", stocks: codeList, initialCapital: paperAccount.initialCapital });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/paper/stop", (req, res) => {
  paperAccount.active = false;
  res.json({ status: "stopped", trades: paperAccount.trades.length });
});

app.post("/api/paper/tick", async (req, res) => {
  try {
    if (!paperAccount.active) return res.json({ error: "纸交易未启动" });

    const events = [];
    const codeList = paperAccount.stocks;

    // 更新价格 & 检查信号
    for (const code of codeList) {
      try {
        const [klines, quotes] = await Promise.all([
          getKlineData(code, 120),
          getRealtimeQuotes([code]).catch(() => []),
        ]);

        if (klines.length < 60) continue;
        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const volumes = klines.map(k => k.volume);
        const opens = klines.map(k => k.open);
        const dates = klines.map(k => k.date);
        const price = quotes[0]?.price || closes[closes.length - 1];

        // 更新持仓价格
        if (paperAccount.positions[code]) {
          paperAccount.positions[code].currentPrice = price;
        }

        // 生成信号
        const stratFn = parseCustomStrategy(paperAccount.config);
        const raw = stratFn(closes, highs, lows, volumes, opens, dates);
        const sigs = raw.signals;
        const lastSig = sigs[sigs.length - 1];
        const prevSig = sigs[sigs.length - 2];

        if (lastSig !== 0 && lastSig !== prevSig) {
          const pos = paperAccount.positions[code];
          if (!pos) continue;

          if (lastSig === 1 && pos.shares === 0) {
            // 买入
            const buyAmount = paperAccount.balance * 0.95; // 单只最多95%仓位
            const shares = Math.floor(buyAmount / price / 100) * 100;
            if (shares >= 100) {
              const cost = shares * price;
              const comm = cost * 0.00026;
              paperAccount.balance -= cost + comm;
              pos.shares = shares;
              pos.avgCost = price;
              const trade = {
                id: paperAccount.tradeId++, code, name: pos.name,
                action: "BUY", price, shares, cost: cost + comm,
                date: dates[dates.length - 1], time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
              };
              paperAccount.trades.push(trade);
              events.push({ type: "TRADE", trade });
            }
          } else if (lastSig === -1 && pos.shares > 0) {
            // 卖出
            const proceeds = pos.shares * price;
            const comm = proceeds * 0.00126;
            const pnl = proceeds - pos.shares * pos.avgCost - comm;
            const pnlPct = +((pnl / (pos.shares * pos.avgCost)) * 100).toFixed(2);
            paperAccount.balance += proceeds - comm;
            const trade = {
              id: paperAccount.tradeId++, code, name: pos.name,
              action: "SELL", price, shares: pos.shares,
              cost: proceeds - comm, pnl: +pnl.toFixed(2), pnlPct,
              date: dates[dates.length - 1], time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
            };
            paperAccount.trades.push(trade);
            pos.shares = 0; pos.avgCost = 0;
            events.push({ type: "TRADE", trade });
          }
        }
      } catch (e) {}
    }

    // 日终快照
    const now = new Date();
    if (now.getHours() >= 15 && !paperAccount._snapshotToday) {
      paperAccount._snapshotToday = true;
      const posVals = Object.values(paperAccount.positions);
      const totalMkt = posVals.reduce((s, p) => s + p.shares * p.currentPrice, 0);
      const totalEq = paperAccount.balance + totalMkt;
      paperAccount.dailySnapshots.push({
        date: now.toISOString().slice(0, 10),
        equity: +totalEq.toFixed(2),
        balance: +paperAccount.balance.toFixed(2),
        marketValue: +totalMkt.toFixed(2),
      });
    }
    if (now.getHours() < 15) paperAccount._snapshotToday = false;

    res.json({ events, balance: +paperAccount.balance.toFixed(2), timestamp: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/paper/reset", (req, res) => {
  paperAccount = {
    balance: 1000000, initialCapital: 1000000,
    positions: {}, orders: [], trades: [], tradeId: 1,
    active: false, config: null, stocks: [],
    dailySnapshots: [],
    startDate: null,
  };
  res.json({ status: "reset" });
});

// 策略生成器 & 监控页面
app.get("/strategy-builder", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "strategy-builder.html"));
});

app.get("/monitor", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "monitor.html"));
});

app.get("/paper-trading", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "paper-trading.html"));
});

// 交易中心统一页面
app.get("/trade-center", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "trade-center.html"));
});

// ===== AI策略进化器 =====
app.post("/api/evolve", async (req, res) => {
  try {
    const { code, config, days, generations, populationSize } = req.body;
    if (!code || !config) return res.status(400).json({ error: "需要股票代码和策略配置" });
    const result = await evolve({
      code, baseConfig: config,
      days: days || 250,
      generations: Math.min(generations || 8, 15),
      populationSize: Math.min(populationSize || 20, 40),
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 一致性追踪 =====
app.get("/api/consistency", async (req, res) => {
  try {
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 增强数据API =====

// 融资融券
app.get("/api/margin", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const data = await getMarginTrade(code);
    res.json({ code, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 市场宽度
app.get("/api/market/breadth", async (req, res) => {
  try {
    const breadth = await getMarketBreadth();
    res.json(breadth || { error: "数据获取失败" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 增强K线 (多源fallback)
app.get("/api/kline/enhanced", async (req, res) => {
  try {
    const { code, days } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const data = await getKlineDataEnhanced(code, +days || 365);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 健康检查 — 微信小程序/负载均衡器探测
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// 端口和主机 — 兼容本地开发 / 云部署 / Nginx反向代理
const PORT = process.env.PORT || 3456;
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`量化系统已启动: http://${HOST}:${PORT}`);
  console.log(`环境: ${process.env.NODE_ENV || "development"}`);
});

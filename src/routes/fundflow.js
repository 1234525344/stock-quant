const axios = require("axios");
const { asyncHandler } = require("../middleware/errorHandler");
const { getKlineData, getIntradayTrend, getRealtimeQuotes, getStockName, getFundFlow, getFundFlowMinute } = require("../data");
const { calcDailyFundFlow, MFI, CMF } = require("../fundflow");
const { comprehensiveFlowReport } = require("../quantflow");
const { getSectorFlow, getConceptFlow } = require("../index");

const router = require("express").Router();

// 资金流向 — 日级别 (量价估算)
router.get("/api/fundflow", asyncHandler(async (req, res) => {
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
}));

// 资金流向 — 当日实时 (用近期数据趋势估算)
// 实时K线 + 资金流叠加图数据 (分钟级)
router.get("/api/fundflow/rtchart", asyncHandler(async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });

    const [trends, minFlow, quote] = await Promise.all([
      getIntradayTrend(code).catch(() => []),
      getFundFlowMinute(code).catch(() => null),
      getRealtimeQuotes([code]).catch(() => []),
    ]);

    const q = quote[0] || {};
    const name = q.name || await getStockName(code);
    const flowTrend = minFlow?.trend || [];
    const price = q.price || (trends.length > 0 ? trends[trends.length - 1].close : 0);

    // 构建时间到资金流的映射
    const flowMap = {};
    flowTrend.forEach(f => {
      const t = f.time?.slice(0, 5); // HH:MM
      flowMap[t] = f;
    });

    // 走势数据 + 对应资金流
    const candles = trends.map(k => {
      const t = k.time?.slice(0, 5); // HH:MM
      const nearestFlow = flowMap[t] || {};
      return {
        time: k.time,
        open: k.open, close: k.close, high: k.high, low: k.low,
        volume: k.volume, amount: k.amount,
        mainFlow: nearestFlow.main || 0,
        retailFlow: nearestFlow.retail || 0,
        largeFlow: nearestFlow.large || 0,
        hugeFlow: nearestFlow.huge || 0,
      };
    });

    // 累计资金流 (净额)
    let cumMain = 0, cumRetail = 0;
    const cumFlow = flowTrend.map(f => {
      cumMain += f.main || 0;
      cumRetail += f.retail || 0;
      return { time: f.time?.slice(0, 5), cumMain, cumRetail, cumMid: cumMain + cumRetail };
    });

    const lite = req.query.lite === "1";
    res.json({
      code, name, price,
      change: q.change,
      timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      candles: lite
        ? candles.map(c => ({ time: c.time, open: c.open, close: c.close, high: c.high, low: c.low }))
        : candles,
      ...(lite ? {} : { cumFlow, flowTrend }),
      hasMinuteKline: candles.length > 0,
      ...(!lite ? { hasFlowData: flowTrend.length > 0 } : {}),
    });
}));

// 日级资金流向 (K线量价估算, 仅提供最近几天的数据概览)
router.get("/api/fundflow/daily-estimate", asyncHandler(async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
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
      trend: flowData,
    });
}));

// 专业量化资金流向 — 综合报告
router.get("/api/quantflow", asyncHandler(async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const [klines, fundFlow] = await Promise.all([
      getKlineData(code, 250),
      getFundFlow(code, 30).catch(() => null),
    ]);
    if (klines.length < 60) return res.json({ error: "数据不足" });
    const report = comprehensiveFlowReport(klines, fundFlow);
    const name = await getStockName(code);
    const quote = await getRealtimeQuotes([code]).catch(() => []);
    res.json({
      code, name,
      price: quote[0]?.price, change: quote[0]?.change,
      ...report,
    });
}));

// 实时资金快照 — 轻量级, 高频调用
router.get("/api/quantflow/snapshot", asyncHandler(async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const [klines, fundFlow] = await Promise.all([
      getKlineData(code, 60),
      getFundFlow(code, 5).catch(() => null),
    ]);
    if (klines.length < 5) return res.json({ error: "数据不足" });
    const report = comprehensiveFlowReport(klines, fundFlow);
    const quote = await getRealtimeQuotes([code]).catch(() => []);
    const last = klines[klines.length - 1];
    res.json({
      code,
      price: quote[0]?.price || last.close,
      change: quote[0]?.change || 0,
      name: quote[0]?.name,
      flow: report.summary,
      flowLabel: report.flowLabel,
      trendDirection: report.trendDirection,
      hasRealData: report.hasRealData,
      signals: report.signalSummary,
      lastVWAP: report.lastVWAP?.toFixed(2),
      lastOFI: report.lastOFI,
      lastPrice: last.close,
      timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    });
}));

router.get("/api/fundflow/realtime", asyncHandler(async (req, res) => {
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
}));

// 统一实时资金流 (合并多个数据源, 优先东方财富真实数据)
router.get("/api/fundflow/live", asyncHandler(async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });

    // 并行拉取: 分钟资金流 + 日级真实资金流 + 最新K线(fallback) + 实时报价
    const [minData, realDailyFlow, klines, quote] = await Promise.all([
      getFundFlowMinute(code).catch(() => null),
      getFundFlow(code, 30).catch(() => []),
      getKlineData(code, 5).catch(() => []),
      getRealtimeQuotes([code]).catch(() => []),
    ]);

    const q = quote[0] || {};
    const name = q.name || await getStockName(code);

    // 优先使用东方财富真实日级数据, 不可用时才用K线估算
    const hasRealDaily = realDailyFlow && realDailyFlow.length > 0;
    const dailyFlow = hasRealDaily
      ? realDailyFlow.map(d => ({ ...d, estimated: false }))
      : calcDailyFundFlow(klines);
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
    // 速度加速度: 后5分钟 vs 前5分钟
    const last5 = minTrend.slice(-5);
    const prev5 = minTrend.slice(-10, -5);
    let acceleration = 0;
    if (last5.length >= 2 && prev5.length >= 2) {
      const rate1 = ((last5[last5.length - 1].main || 0) - (last5[0].main || 0)) / 5;
      const rate2 = ((prev5[prev5.length - 1].main || 0) - (prev5[0].main || 0)) / 5;
      acceleration = +((rate1 - rate2) / Math.max(1, Math.abs(rate2))).toFixed(2);
    }

    res.json({
      code, name,
      price: q.price, change: q.change,
      timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      // 数据来源标识
      dataSource: {
        daily: hasRealDaily ? "eastmoney" : "estimated",
        minute: minData ? "eastmoney_realtime" : "unavailable",
        hasRealDaily,
        hasMinuteData: !!minData,
        freshUntil: minData ? new Date(Date.now() + 60000).toLocaleTimeString("zh-CN", { hour12: false }) : null,
      },
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
      acceleration,
      minTrend: minTrend.slice(-60),
      dailyFlow: dailyFlow,
    });
}));

// 批量获取资金流数据（用于自选股）
router.get("/api/fundflow/batch", asyncHandler(async (req, res) => {
    const { codes } = req.query;
    if (!codes) return res.status(400).json({ error: "需要codes参数" });

    const codeList = codes.split(",").slice(0, 50); // 最多50个
    const items = [];

    for (const code of codeList) {
      try {
        const [realDailyFlow, quote] = await Promise.all([
          getFundFlow(code, 5).catch(() => []),
          getRealtimeQuotes([code]).catch(() => []),
        ]);

        const q = quote[0] || {};
        const latestFlow = realDailyFlow && realDailyFlow.length > 0
          ? realDailyFlow[realDailyFlow.length - 1]
          : {};

        items.push({
          code,
          name: q.name || code,
          mainFlow: latestFlow.main || latestFlow.mainForce || 0,
          retailFlow: latestFlow.retail || latestFlow.smallOrder || 0,
          netFlow: (latestFlow.main || latestFlow.mainForce || 0) + (latestFlow.retail || latestFlow.smallOrder || 0),
        });
      } catch (e) {
        items.push({ code, mainFlow: 0, retailFlow: 0, netFlow: 0 });
      }
    }

    res.json({ items });
}));

module.exports = router;

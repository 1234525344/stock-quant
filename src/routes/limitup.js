// 涨停打板分析路由
const router = require("express").Router();
const { getLimitUpDown, getKlineData, getFundFlow, getRealtimeQuotes, batchWithLimit, getStockName } = require("../data");
const { asyncHandler } = require("../middleware/errorHandler");

// ── 获取昨日涨停池 ─────────────────────────
router.get("/api/limitup/yesterday", asyncHandler(async (req, res) => {
  const { date } = req.query;
  const result = await getLimitUpDown(date);
  res.json(result);
}));

// ── 涨停股评分扫描 ─────────────────────────
router.get("/api/limitup/scan", asyncHandler(async (req, res) => {
  const { date, limit } = req.query;
  const maxResults = Math.min(parseInt(limit) || 20, 50);

  // 1. 获取昨日涨停池
  const ztPool = await getLimitUpDown(date);
  if (!ztPool.up || ztPool.up.length === 0) {
    return res.json({ count: 0, results: [], message: "未获取到涨停股数据" });
  }

  console.log(`[limitup] 获取到 ${ztPool.up.length} 只涨停股，开始评分...`);

  // 2. 逐只获取K线+资金流并评分
  const scored = await batchWithLimit(ztPool.up, async (zt) => {
    try {
      const code = zt.code;
      const [klines, fundFlow] = await Promise.all([
        getKlineData(code, 60).catch(() => []),
        getFundFlow(code, 5).catch(() => null),
      ]);

      if (klines.length < 5) return null;

      const closes = klines.map(k => k.close);
      const highs = klines.map(k => k.high);
      const lows = klines.map(k => k.low);
      const volumes = klines.map(k => k.volume);
      const opens = klines.map(k => k.open);

      const score = scoreLimitUp({
        code, name: zt.name,
        klines, closes, highs, lows, volumes, opens,
        fundFlow,
        changePct: zt.changePct,
      });

      return {
        code,
        name: zt.name,
        ...score,
      };
    } catch (e) {
      console.error(`[limitup] 评分失败 ${zt.code}:`, e.message);
      return null;
    }
  }, 5);

  // 3. 排序并截取
  const sorted = scored
    .filter(Boolean)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, maxResults);

  // 4. 获取实时行情补充数据
  const codes = sorted.map(s => s.code);
  const quotes = await getRealtimeQuotes(codes).catch(() => []);
  const quoteMap = {};
  if (Array.isArray(quotes)) {
    quotes.forEach(q => { quoteMap[q.code] = q; });
  }

  const enriched = sorted.map(s => ({
    ...s,
    quote: quoteMap[s.code] || null,
  }));

  console.log(`[limitup] 评分完成，共 ${enriched.length} 只`);

  res.json({
    date: ztPool.up[0]?.date || "最新",
    totalCount: ztPool.up.length,
    count: enriched.length,
    results: enriched,
  });
}));

// ── 单股涨停次日评分 ─────────────────────
router.get("/api/limitup/score/:code", asyncHandler(async (req, res) => {
  const { code } = req.params;
  const [klines, fundFlow] = await Promise.all([
    getKlineData(code, 60).catch(() => []),
    getFundFlow(code, 5).catch(() => null),
  ]);

  if (klines.length < 5) {
    return res.json({ error: "K线数据不足" });
  }

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const opens = klines.map(k => k.open);
  const name = await getStockName(code);

  const score = scoreLimitUp({
    code, name,
    klines, closes, highs, lows, volumes, opens,
    fundFlow,
    changePct: null,
  });

  res.json({ code, name, ...score });
}));

// ── 评分算法 ─────────────────────────────
function scoreLimitUp({ code, name, klines, closes, highs, lows, volumes, opens, fundFlow, changePct }) {
  let connBanScore = 0;    // 连板分
  let sealTimeScore = 0;   // 封板时间分
  let blastScore = 0;      // 炸板分
  let volumeScore = 0;     // 成交额分
  let mcapScore = 0;       // 市值分
  let techBonus = 0;       // 技术加分
  const reasons = [];

  // ── 基本信息从K线推断 ──
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  const lastClose = last?.close || 0;
  const prevClose = prev?.close || 0;
  const lastVolume = last?.volume || 0;
  const avgVol5 = volumes.slice(-6, -1).reduce((s, v) => s + v, 0) / 5 || 1;

  // ── 1. 连板检测 ──
  let connBan = 0;
  for (let i = klines.length - 1; i >= 1; i--) {
    const k = klines[i];
    const pk = klines[i - 1];
    if (!pk || !k) break;
    const limitPrice = pk.close * 1.1; // 简化：10%涨停
    if (k.close >= limitPrice * 0.995 && k.high >= limitPrice * 0.99) {
      connBan++;
    } else {
      break;
    }
  }

  if (connBan >= 3) {
    connBanScore = 30;
    reasons.push(`${connBan}连板(+30)`);
  } else if (connBan === 2) {
    connBanScore = 20;
    reasons.push(`2连板(+20)`);
  } else {
    connBanScore = 10;
    reasons.push(`首板(+10)`);
  }

  // ── 2. 封板强度（从K线形态推断） ──
  // 如果收盘价接近最高价，说明封板牢固
  const sealStrength = last.high > 0 ? (lastClose / last.high) : 0;
  if (sealStrength >= 0.99) {
    sealTimeScore = 25;
    reasons.push("封板牢固(+25)");
  } else if (sealStrength >= 0.97) {
    sealTimeScore = 15;
    reasons.push("封板较强(+15)");
  } else {
    sealTimeScore = 5;
    reasons.push("封板一般(+5)");
  }

  // ── 3. 炸板检测（从影线推断） ──
  // 上影线长说明有炸板
  const upperShadow = last.high > lastClose ? (last.high - lastClose) / lastClose : 0;
  if (upperShadow < 0.005) {
    blastScore = 20;
    reasons.push("未炸板(+20)");
  } else if (upperShadow < 0.02) {
    blastScore = 10;
    reasons.push("轻微炸板(+10)");
  } else {
    blastScore = 0;
    reasons.push("炸板明显(+0)");
  }

  // ── 4. 成交额/量比 ──
  const volumeRatio = lastVolume / avgVol5;
  if (volumeRatio >= 1.5 && volumeRatio <= 5) {
    volumeScore = 15;
    reasons.push(`量比${volumeRatio.toFixed(1)}适中(+15)`);
  } else if (volumeRatio > 5) {
    volumeScore = 5;
    reasons.push(`量比${volumeRatio.toFixed(1)}过大(+5)`);
  } else {
    volumeScore = 5;
    reasons.push(`量比${volumeRatio.toFixed(1)}偏小(+5)`);
  }

  // ── 5. 位置评分 ──
  // 距离60日高点的位置
  const high60 = Math.max(...highs.slice(-60));
  const distFromHigh = high60 > 0 ? (lastClose - high60) / high60 : 0;
  if (distFromHigh >= -0.05) {
    mcapScore = 10;
    reasons.push("接近高位(+10)");
  } else if (distFromHigh >= -0.15) {
    mcapScore = 5;
    reasons.push("位置适中(+5)");
  } else {
    mcapScore = 0;
    reasons.push("低位涨停(+0)");
  }

  // ── 6. 技术加分 ──
  // MACD金叉
  if (closes.length >= 26) {
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const dif = ema12 - ema26;
    const prevEma12 = calcEMA(closes.slice(0, -1), 12);
    const prevEma26 = calcEMA(closes.slice(0, -1), 26);
    const prevDif = prevEma12 - prevEma26;
    if (dif > 0 && prevDif <= 0) {
      techBonus += 5;
      reasons.push("MACD金叉(+5)");
    }
  }

  // 资金流向加分
  if (fundFlow && fundFlow.length > 0) {
    const recentFlow = fundFlow.slice(-3).reduce((s, d) => s + (d.main || 0), 0);
    if (recentFlow > 0) {
      techBonus += 5;
      reasons.push("近期主力净流入(+5)");
    }
  }

  // ── 总分 ──
  const totalScore = connBanScore + sealTimeScore + blastScore + volumeScore + mcapScore + techBonus;

  // 等级
  let grade = "D";
  let gradeColor = "#999";
  if (totalScore >= 70) { grade = "S"; gradeColor = "#e74c3c"; }
  else if (totalScore >= 55) { grade = "A"; gradeColor = "#f39c12"; }
  else if (totalScore >= 40) { grade = "B"; gradeColor = "#3498db"; }
  else if (totalScore >= 25) { grade = "C"; gradeColor = "#27ae60"; }

  return {
    totalScore,
    grade,
    gradeColor,
    connBan,
    connBanScore,
    sealTimeScore,
    blastScore,
    volumeScore,
    mcapScore,
    techBonus,
    reasons,
    lastPrice: lastClose,
    changePct: changePct || (prevClose > 0 ? ((lastClose - prevClose) / prevClose * 100).toFixed(2) : null),
    volumeRatio: volumeRatio.toFixed(2),
    // 信号
    signal: totalScore >= 60 ? "强烈推荐" : totalScore >= 45 ? "推荐" : totalScore >= 30 ? "关注" : "观望",
  };
}

// ── EMA计算工具函数 ──
function calcEMA(data, period) {
  if (data.length < period) return data[data.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

module.exports = router;

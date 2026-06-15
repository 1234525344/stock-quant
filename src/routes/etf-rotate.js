const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { logger } = require("../logger");
const { getKlineData, getStockName, getRealtimeQuotes } = require("../data");
const { SMA, EMA, calcReturns, calcVolatility } = require("../indicators");

// ---- ETF 标的池 ----
const ETF_POOLS = {
  momentum: {
    label: "趋势动量",
    desc: "追逐近期最强趋势的ETF",
    etfs: [
      { code: "510300", name: "沪深300ETF" },
      { code: "510050", name: "上证50ETF" },
      { code: "510500", name: "中证500ETF" },
      { code: "159915", name: "创业板ETF" },
      { code: "588000", name: "科创50ETF" },
      { code: "510880", name: "红利ETF" },
      { code: "159949", name: "创业板50" },
      { code: "512100", name: "中证1000ETF" },
    ],
  },
  industry: {
    label: "行业轮动",
    desc: "在强势行业ETF之间切换",
    etfs: [
      { code: "515070", name: "AI智能ETF" },
      { code: "159509", name: "纳指科技ETF" },
      { code: "512880", name: "证券ETF" },
      { code: "512660", name: "军工ETF" },
      { code: "515790", name: "光伏ETF" },
      { code: "512010", name: "医药ETF" },
      { code: "512800", name: "银行ETF" },
      { code: "159869", name: "游戏ETF" },
      { code: "516510", name: "云计算ETF" },
      { code: "159766", name: "旅游ETF" },
    ],
  },
  defensive: {
    label: "防御配置",
    desc: "低波动+红利+黄金，适合避险期",
    etfs: [
      { code: "510880", name: "红利ETF" },
      { code: "511010", name: "国债ETF" },
      { code: "518880", name: "黄金ETF" },
      { code: "512800", name: "银行ETF" },
      { code: "159962", name: "港股红利ETF" },
      { code: "510050", name: "上证50ETF" },
    ],
  },
  tech: {
    label: "科技成长",
    desc: "聚焦科技赛道弹性品种",
    etfs: [
      { code: "515070", name: "AI智能ETF" },
      { code: "588000", name: "科创50ETF" },
      { code: "159509", name: "纳指科技ETF" },
      { code: "159869", name: "游戏ETF" },
      { code: "516510", name: "云计算ETF" },
      { code: "159915", name: "创业板ETF" },
      { code: "512660", name: "军工ETF" },
      { code: "515790", name: "光伏ETF" },
    ],
  },
};

// ---- ETF 评分 ----
function scoreETF(klines) {
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const i = closes.length - 1;
  if (i < 60 || !closes[i]) return null;

  const last = closes[i];

  // ---- 1. 动量分 (0-35): 多周期收益率 ----
  const rets = calcReturns(closes);
  let momentumScore = 0;

  if ((rets.d5 || 0) > 3) momentumScore += 12;
  else if ((rets.d5 || 0) > 1) momentumScore += 7;
  else if ((rets.d5 || 0) > 0) momentumScore += 3;
  if ((rets.d5 || 0) < -3) momentumScore -= 5;

  if ((rets.d10 || 0) > 5) momentumScore += 10;
  else if ((rets.d10 || 0) > 2) momentumScore += 5;
  if ((rets.d20 || 0) > 8) momentumScore += 8;
  else if ((rets.d20 || 0) > 3) momentumScore += 4;

  // 近期加速度 (5日 > 20日均速)
  const d5avg = (rets.d5 || 0) / 5;
  const d20avg = (rets.d20 || 0) / 20;
  if (d5avg > d20avg && d5avg > 0) momentumScore += 5;

  // ---- 2. 趋势分 (0-30): 均线排列 ----
  const ma5 = SMA(closes, 5);
  const ma10 = SMA(closes, 10);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);
  let trendScore = 0;

  if (ma5[i] != null && ma10[i] != null && ma20[i] != null) {
    if (ma5[i] > ma10[i] && ma10[i] > ma20[i]) trendScore += 12;
    else if (ma5[i] > ma10[i]) trendScore += 6;
  }
  if (ma20[i] != null && ma60[i] != null && ma20[i] > ma60[i]) trendScore += 6;
  if (ma5[i] != null && last > ma5[i]) trendScore += 4;
  if (ma20[i] != null && last > ma20[i]) trendScore += 4;

  // 价格创近期新高
  const high20 = Math.max(...highs.slice(i - 19, i + 1));
  if (last >= high20 * 0.98) trendScore += 4;

  // ---- 3. 量能分 (0-20): ETF 适用更低阈值 ----
  let volumeScore = 0;
  if (volumes[i] > 0 && i >= 20) {
    const avgV5 = volumes.slice(i - 5, i).reduce((a, b) => a + b, 0) / 5;
    const avgV20 = volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
    let vr5 = 1;
    if (avgV5 > 0 && avgV20 > 0) {
      vr5 = volumes[i] / avgV5;
      if (vr5 > 1.5) volumeScore += 6;
      else if (vr5 > 1.2) volumeScore += 4;
      else if (vr5 > 1.0) volumeScore += 2;
      const vr20 = volumes[i] / avgV20;
      if (vr20 > 1.3) volumeScore += 5;
      else if (vr20 > 1.0) volumeScore += 3;
    }
    // 量能趋势: 连续3日递增
    if (volumes[i] > volumes[i - 1] && volumes[i - 1] > volumes[i - 2] && volumes[i - 2] > volumes[i - 3]) {
      volumeScore += 4;
    }
    // 价涨量增
    const chg = closes[i - 1] > 0 ? (last - closes[i - 1]) / closes[i - 1] : 0;
    if (chg > 0 && volumes[i] > volumes[i - 1]) volumeScore += 3;
    // 地量+仍涨
    if (chg > 0 && vr5 < 0.8 && vr5 > 0) volumeScore += 2;
  }

  // ---- 4. 低波分 (0-15): 平稳上涨优于剧烈波动 ----
  const vol = calcVolatility(closes);
  let stabilityScore = 0;
  if (vol < 18) stabilityScore += 7;
  else if (vol < 25) stabilityScore += 4;
  if (vol < 30 && (rets.d20 || 0) > 2) stabilityScore += 5; // 低波动+正收益
  // 回撤控制
  const recentHigh = Math.max(...highs.slice(i - 19, i + 1));
  const drawdown = recentHigh > 0 ? (recentHigh - last) / recentHigh * 100 : 0;
  if (drawdown < 3) stabilityScore += 3;

  // ---- 综合 ----
  momentumScore = Math.max(0, Math.min(35, momentumScore));
  trendScore = Math.max(0, Math.min(30, trendScore));
  volumeScore = Math.max(0, Math.min(20, volumeScore));
  stabilityScore = Math.max(0, Math.min(15, stabilityScore));

  const total = momentumScore + trendScore + volumeScore + stabilityScore;

  let grade, gradeColor;
  if (total >= 70) { grade = "强配"; gradeColor = "#f87171"; }
  else if (total >= 55) { grade = "标配"; gradeColor = "#f59e0b"; }
  else if (total >= 40) { grade = "观望"; gradeColor = "#3b82f6"; }
  else { grade = "回避"; gradeColor = "#94a3b8"; }

  // 信号
  const signals = [];
  if (momentumScore >= 25) signals.push("强动量");
  if (trendScore >= 22) signals.push("多头排列");
  if (volumeScore >= 15) signals.push("放量突破");
  if (stabilityScore >= 12) signals.push("低波稳健");
  if (total >= 70) signals.push("综合高分");

  return {
    score: total,
    grade, gradeColor,
    momentumScore, trendScore, volumeScore, stabilityScore,
    returns: rets,
    volatility: vol,
    drawdown: +drawdown.toFixed(1),
    signals: signals.length > 0 ? signals : ["信号中性"],
    close: +last.toFixed(3),
  };
}

// ---- API ----

router.get("/api/etf/rotate", asyncHandler(async (req, res) => {
  const poolKey = req.query.pool || "momentum";
  const pool = ETF_POOLS[poolKey] || ETF_POOLS.momentum;

  const results = [];
  for (const etf of pool.etfs) {
    try {
      // 请求间延迟避免限流
      if (results.length > 0) await new Promise(r => setTimeout(r, 200));
      const klines = await getKlineData(etf.code, 120);
      if (!klines || klines.length < 60) continue;
      const scores = scoreETF(klines);
      if (!scores) continue;
      const name = etf.name || (await getStockName(etf.code).catch(() => etf.code));
      results.push({ code: etf.code, name, ...scores });
    } catch (e) { logger.warn(`[ETF] ${etf.code} fetch failed: ${e.message}`); }
  }

  // 按总分排序
  results.sort((a, b) => b.score - a.score);

  // 判断轮动信号
  const top = results[0] || null;
  const second = results[1] || null;
  let rotationSignal = "hold";
  let rotationReason = "";

  if (top && second && top.score > second.score + 10) {
    rotationSignal = "strong_hold";
    rotationReason = `${top.name} 得分大幅领先，坚定持有`;
  } else if (top && second && top.score - second.score <= 5) {
    rotationSignal = "watch";
    rotationReason = `${top.name} 与 ${second.name} 接近，关注轮动切换`;
  } else if (top) {
    rotationSignal = "hold";
    rotationReason = `${top.name} 当前最优`;
  }

  // ETF池信息
  const poolMeta = { key: poolKey, ...pool };
  delete poolMeta.etfs;

  res.json({
    pool: poolMeta,
    topPick: top ? { code: top.code, name: top.name, score: top.score, grade: top.grade } : null,
    rotation: { signal: rotationSignal, reason: rotationReason },
    results,
    timestamp: new Date().toISOString(),
  });
}));

// ETF池列表
router.get("/api/etf/pools", (req, res) => {
  const pools = Object.entries(ETF_POOLS).map(([key, p]) => ({
    key, label: p.label, desc: p.desc, count: p.etfs.length,
  }));
  res.json(pools);
});

module.exports = router;

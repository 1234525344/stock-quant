// 低位启动优质股筛选器 v2
// 核心逻辑: 找低位 + 捕捉启动信号 + 质量过滤
// 评分维度: 位置评估(0-35) + 启动信号(0-40) + 质量确认(0-25) = 100
const { SMA, EMA, MACD, RSI, KDJ, BOLL, ATR, WR, OBV } = require("./indicators");

function screen(klines, filters) {
  const { opens, highs, lows, closes, volumes, dates } = klines;
  if (closes.length < 120) return { passed: false, reason: "数据不足(需要至少120个交易日)" };

  const last = closes.length - 1;
  let score = 0;
  const reasons = [];
  const details = {};

  // ==================== 一、位置评估 (0-35分): 找低位 ====================

  // 累加器: 分别跟踪各维度实际得分
  let posActual = 0, launchActual = 0, qualActual = 0;

  // 1.1 价格在60日区间的位置(越低越好) — 0~10分
  const h60 = Math.max(...closes.slice(-60));
  const l60 = Math.min(...closes.slice(-60));
  const pos60 = (closes[last] - l60) / (h60 - l60 || 1);  // 0=最低, 1=最高
  let posScore = 0;
  if (pos60 < 0.15) posScore = 10;
  else if (pos60 < 0.25) posScore = 8;
  else if (pos60 < 0.4) posScore = 5;
  else if (pos60 < 0.55) posScore = 2;
  if (posScore >= 5) reasons.push(`60日低位(区间底部${(pos60*100).toFixed(0)}%) +${posScore}`);
  score += posScore; posActual += posScore;
  details.pricePos = +(pos60 * 100).toFixed(0);

  // 1.2 布林带位置(越低越好) — 0~10分
  let bollScore = 0;
  const { mid, upper, lower } = BOLL(closes);
  if (lower[last] != null && mid[last] != null) {
    const bandWidth = mid[last] - lower[last] || 1;
    const bollPos = (closes[last] - lower[last]) / bandWidth;
    if (bollPos < -0.1) bollScore = 10;
    else if (bollPos < 0.25) bollScore = 8;
    else if (bollPos < 0.5) bollScore = 4;
    if (bollScore >= 4) reasons.push(`布林低位(下轨附近) +${bollScore}`);
    details.bollPos = +(bollPos * 100).toFixed(0);
  }
  score += bollScore; posActual += bollScore;

  // 1.3 距离高点回撤幅度(越大越好) — 0~10分
  const h250 = Math.max(...closes.slice(-Math.min(250, closes.length)));
  const dd = (h250 - closes[last]) / h250;
  let ddScore = 0;
  if (dd > 0.35) ddScore = 10;
  else if (dd > 0.22) ddScore = 8;
  else if (dd > 0.12) ddScore = 4;
  else if (dd > 0.05) ddScore = 2;
  if (ddScore >= 4) reasons.push(`大幅回撤${(dd*100).toFixed(0)}% +${ddScore}`);
  score += ddScore; posActual += ddScore;
  details.drawdown = +(dd * 100).toFixed(1);

  // 1.4 WR威廉指标(越低=越超卖) — 0~5分
  const wr = WR(highs, lows, closes, 14);
  if (wr[last] != null) {
    let wrScore = 0;
    if (wr[last] < -80) wrScore = 5;
    else if (wr[last] < -60) wrScore = 3;
    else if (wr[last] < -30) wrScore = 1;
    if (wrScore >= 3) reasons.push(`威廉超卖(WR=${wr[last].toFixed(0)}) +${wrScore}`);
    score += wrScore; posActual += wrScore;
    details.wr = +wr[last].toFixed(0);
  }

  // ==================== 二、启动信号 (0-40分): 捕捉启动 ====================

  // 2.1 MACD底背离 / DIF拐头 — 0~12分
  const { dif, dea, macd: macdHist } = MACD(closes);

  // 找60日内价格最低点和对应DIF
  const slice60Close = closes.slice(-60);
  const slice60Dif = dif.slice(-60);
  const priceMinIdx = slice60Close.indexOf(Math.min(...slice60Close));
  let macdScore = 0;

  // 近20天 vs 前20-40天: 价格新低但DIF未新低 = 底背离
  const r20CloseMin = Math.min(...closes.slice(-20));
  const r40CloseMin = Math.min(...closes.slice(-40, -20));
  const r20DifMin = Math.min(...dif.slice(-20).filter(v => v != null));
  const r40DifMin = Math.min(...dif.slice(-40, -20).filter(v => v != null));

  if (r20CloseMin < r40CloseMin && r20DifMin > r40DifMin) {
    macdScore = 12;
    reasons.push("MACD底背离(价格新低指标不新低) +12");
  } else if (dif[last] != null && dif[last - 1] != null && dif[last] > dif[last - 1] && dif[last - 1] <= dif[last - 2]) {
    macdScore = 8;
    reasons.push("MACD/DIF拐头向上 +8");
  } else if (dif[last] != null && dea[last] != null && dif[last] > dea[last] && dif[last - 1] <= dea[last - 1]) {
    macdScore = 6;
    reasons.push("MACD金叉 +6");
  } else if (dif[last] != null && dea[last] != null && dif[last] > dea[last]) {
    macdScore = 3;
    reasons.push("MACD多方区间 +3");
  }
  score += macdScore; launchActual += macdScore;

  // 2.2 RSI低位回升 — 0~8分
  const rsi = RSI(closes, 14);
  if (rsi[last] != null) {
    let rsiScore = 0;
    if (rsi[last] > 30 && rsi[last - 1] <= 30) {
      rsiScore = 8;
      reasons.push(`RSI脱离超卖区(${rsi[last].toFixed(1)}) +8`);
    } else if (rsi[last] > rsi[last - 1] && rsi[last] < 45) {
      rsiScore = 5;
      reasons.push(`RSI低位回升(${rsi[last].toFixed(1)}) +5`);
    } else if (rsi[last] > rsi[last - 1] && rsi[last - 2] > rsi[last - 1]) {
      rsiScore = 3;
      reasons.push(`RSI企稳回升(${rsi[last].toFixed(1)}) +3`);
    }
    score += rsiScore; launchActual += rsiScore;
    details.rsi = +rsi[last].toFixed(1);
  }

  // 2.3 缩量后放量启动 — 0~10分
  const avgV5 = volumes.slice(-6, -1).reduce((s, v) => s + v, 0) / 5;
  const avgV20 = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
  const todayV = volumes[last];
  const todayChg = closes[last - 1] > 0 ? (closes[last] - closes[last - 1]) / closes[last - 1] : 0;

  let volScore = 0;
  if (avgV5 < avgV20 * 0.75 && todayV > avgV5 * 1.6 && todayChg > 0.005) {
    volScore = 10;
    reasons.push("缩量后放量启动(经典信号) +10");
  } else if (todayV > avgV20 * 1.5 && todayChg > 0.01) {
    volScore = 7;
    reasons.push("放量上涨 +7");
  } else if (todayV > avgV20 * 1.2 && todayChg > 0) {
    volScore = 3;
    reasons.push("温和放量 +3");
  }
  score += volScore; launchActual += volScore;
  details.volRatio = avgV20 > 0 ? +(todayV / avgV20).toFixed(1) : 1;

  // 2.4 KDJ低位金叉 — 0~10分
  const { k, d, j } = KDJ(highs, lows, closes);
  if (k[last] != null && d[last] != null && k[last - 1] != null && d[last - 1] != null) {
    let kdjScore = 0;
    const goldenCross = k[last] > d[last] && k[last - 1] <= d[last - 1];
    if (goldenCross && k[last] < 25) {
      kdjScore = 10;
      reasons.push(`KDJ低位金叉(K=${k[last].toFixed(1)}) +10`);
    } else if (goldenCross && k[last] < 45) {
      kdjScore = 7;
      reasons.push(`KDJ中低位金叉 +7`);
    } else if (k[last] > d[last] && j[last] < 40) {
      kdjScore = 4;
      reasons.push("KDJ低位多头 +4");
    }
    score += kdjScore; launchActual += kdjScore;
    details.kdjK = +k[last].toFixed(1);
    details.kdjD = +d[last].toFixed(1);
  }

  // ==================== 三、质量确认 (0-25分): 过滤垃圾股 ====================

  // 3.1 短期均线修复 — 0~7分
  const ma5 = SMA(closes, 5);
  const ma10 = SMA(closes, 10);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);

  let trendScore = 0;
  // 站上短期均线 → 短线启动确认
  if (closes[last] > ma5[last]) trendScore += 2;
  if (closes[last] > ma10[last]) trendScore += 2;
  // 5日线开始向上勾头
  if (ma5[last] != null && ma5[last - 2] != null && ma5[last] > ma5[last - 2]) trendScore += 2;
  // 成交量配合: 近5日均量 > 近20日均量
  const avgV5Rec = volumes.slice(-5).reduce((s, v) => s + v, 0) / 5;
  if (avgV5Rec > avgV20) trendScore += 1;
  score += trendScore; qualActual += trendScore;
  if (trendScore >= 5) reasons.push(`短期趋势修复 +${trendScore}`);
  details.aboveMA5 = closes[last] > ma5[last];
  details.aboveMA10 = closes[last] > ma10[last];

  // 3.2 OBV能量潮确认资金进场 — 0~6分
  const obv = OBV(closes, volumes);
  const obvRecent5 = obv.slice(-5);
  const obvRecent20 = obv.slice(-20);
  const obvSlope5 = obvRecent5.length >= 2
    ? (obvRecent5[obvRecent5.length - 1] - obvRecent5[0]) / 5 : 0;
  const obvSlope20 = obvRecent20.length >= 2
    ? (obvRecent20[obvRecent20.length - 1] - obvRecent20[0]) / 20 : 0;

  let obvScore = 0;
  if (obvSlope5 > 0 && obvSlope20 > 0) obvScore = 6;       // 短中期资金都在流入
  else if (obvSlope5 > 0 && obvSlope20 <= 0) obvScore = 4; // 短期开始流入(拐点)
  else if (obvSlope5 > 0) obvScore = 2;
  if (obvScore >= 4) reasons.push(`资金流入(OBV回升) +${obvScore}`);
  score += obvScore; qualActual += obvScore;
  details.obvTrend = obvSlope5 > 0 ? "up" : "down";

  // 3.3 成交量活跃度 — 0~6分
  const avgV60 = volumes.slice(-60).reduce((s, v) => s + v, 0) / 60;
  const actRatio = avgV20 / (avgV60 || 1);
  let actScore = 0;
  // 不冷清(无流动性)也不异常(对倒嫌疑)
  if (actRatio > 0.7 && actRatio < 2.5) actScore = 6;
  else if (actRatio > 0.4 && actRatio < 3.5) actScore = 3;
  else actScore = 1;
  score += actScore; qualActual += actScore;
  details.volActivity = +actRatio.toFixed(1);

  // 3.4 波动率适中 — 0~6分
  const atr = ATR(highs, lows, closes, 14);
  if (atr[last] != null) {
    const avgAtr20 = atr.slice(-20).filter(v => v != null).reduce((s, v) => s + v, 0) / 20;
    const atrPct = avgAtr20 / closes[last];
    let atrScore = 0;
    // 日均波幅2%~6%为适中(适合波段操作); <2%太沉闷; >8%太妖
    if (atrPct < 0.05 && atrPct > 0.015) atrScore = 6;
    else if (atrPct < 0.07 && atrPct > 0.01) atrScore = 3;
    else atrScore = 1;
    score += atrScore; qualActual += atrScore;
    details.atrPct = +(atrPct * 100).toFixed(1);
  }

  // ==================== 汇总 ====================
  let grade, gradeColor;
  if (score >= 60) { grade = "A级·强烈推荐"; gradeColor = "#ef4444"; }
  else if (score >= 45) { grade = "B级·推荐关注"; gradeColor = "#f59e0b"; }
  else if (score >= 30) { grade = "C级·可观察"; gradeColor = "#3b82f6"; }
  else { grade = "D级·暂不建议"; gradeColor = "#6b7280"; }

  // 启动状态
  let launchStatus;
  if (macdScore >= 8 && volScore >= 7) launchStatus = "🚀 正在启动";
  else if (macdScore >= 6 || volScore >= 7) launchStatus = "📈 启动迹象";
  else if (posScore + ddScore >= 20) launchStatus = "📦 低位筑底";
  else if (posScore >= 10) launchStatus = "🔍 回落中";
  else launchStatus = "⏳ 观望";

  const chg5 = closes[last - 5] > 0
    ? ((closes[last] - closes[last - 5]) / closes[last - 5]) * 100 : 0;
  const chg20 = closes[last - 20] > 0
    ? ((closes[last] - closes[last - 20]) / closes[last - 20]) * 100 : 0;

  const passed = score >= 25;

  return {
    passed,
    score: Math.min(100, score),
    grade,
    gradeColor,
    launchStatus,
    positionScore: posActual,
    launchScore: launchActual,
    qualityScore: qualActual,
    chg5: +chg5.toFixed(2),
    chg20: +chg20.toFixed(2),
    lastPrice: closes[last],
    lastDate: dates[last],
    reasons,
    details,
  };
}

async function batchScreen(stockList, getKlineFn, filters = {}) {
  const results = [];
  for (const stock of stockList) {
    try {
      const klines = await getKlineFn(stock.code);
      const result = screen(klines, filters);
      if (result.passed) results.push({ ...stock, ...result });
    } catch (e) { /* skip */ }
  }
  return results.sort((a, b) => b.score - a.score);
}

module.exports = { screen, batchScreen };

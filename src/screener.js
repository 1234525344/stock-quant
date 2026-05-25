// 正在启动/突破选股器 v3
// 核心逻辑: 捕捉正在启动的个股, 而非等待低位
// 评分维度: 启动动量(0-55) + 质量确认(0-30) + 位置参考(0-15) = 100
const { SMA, EMA, MACD, RSI, KDJ, BOLL, ATR, WR, OBV } = require("./indicators");

function screen(klines, filters, fundFlowData) {
  const { opens, highs, lows, closes, volumes, dates } = klines;
  if (closes.length < 60) return { passed: false, reason: "数据不足(需要至少60个交易日)" };

  const last = closes.length - 1;
  let score = 0;
  const reasons = [];
  const details = {};

  let launchActual = 0, qualActual = 0, posActual = 0;

  // ==================== 一、启动动量 (0-55分) ====================

  // 1.1 突破N日高点 — 0~15分 (核心信号)
  const breakPeriods = [20, 10, 5];
  const periodNames = { 20: "20日", 10: "10日", 5: "5日" };
  let breakScore = 0;

  for (const period of breakPeriods) {
    if (closes.length < period + 1) continue;
    const prevHigh = Math.max(...highs.slice(-period - 1, -1));
    if (closes[last] > prevHigh) {
      const pct = +((closes[last] - prevHigh) / prevHigh * 100).toFixed(2);
      if (period === 20) breakScore += 8;
      else if (period === 10) breakScore += 5;
      else breakScore += 2;

      if (period === 20) reasons.push(`突破${periodNames[period]}高点(+${pct}%) +8`);
    }
  }
  // 接近突破: 距前高<2%且今日上涨
  const nearHigh20 = Math.max(...highs.slice(-21, -1));
  if (breakScore === 0 && closes[last] > nearHigh20 * 0.98 && closes[last] > closes[last - 1]) {
    breakScore = 4;
    reasons.push("逼近20日高点, 即将突破 +4");
  }
  score += breakScore; launchActual += breakScore;
  details.breakoutScore = breakScore;

  // 1.2 放量启动 (量价配合) — 0~15分
  const avgV5 = volumes.slice(-6, -1).reduce((s, v) => s + v, 0) / 5;
  const avgV20 = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
  const todayV = volumes[last];
  const todayChg = closes[last - 1] > 0 ? (closes[last] - closes[last - 1]) / closes[last - 1] : 0;
  const todayRange = highs[last] - lows[last];

  let volScore = 0;
  // 放量突破: 成交量激增 + 价格上涨
  if (todayV > avgV20 * 2.0 && todayChg > 0.015 && todayRange > 0) {
    volScore = 15;
    reasons.push("巨量突破(量比>2.0) +15");
  } else if (todayV > avgV20 * 1.6 && todayChg > 0.01) {
    volScore = 12;
    reasons.push("大量上涨 +12");
  } else if (todayV > avgV20 * 1.3 && todayChg > 0.005) {
    volScore = 8;
    reasons.push("放量上涨 +8");
  } else if (todayV > avgV5 * 1.5 && todayChg > 0.01) {
    volScore = 6;
    reasons.push("近5日放量启动 +6");
  } else if (todayV > avgV5 && todayChg > 0) {
    volScore = 3;
    reasons.push("温和放量 +3");
  }
  score += volScore; launchActual += volScore;
  details.volRatio = avgV20 > 0 ? +(todayV / avgV20).toFixed(1) : 1;

  // 1.3 短期动量 (5日/10日涨幅) — 0~10分
  let momScore = 0;
  const chg5 = closes[last - 5] > 0 ? (closes[last] - closes[last - 5]) / closes[last - 5] * 100 : 0;
  const chg10 = closes[last - 10] > 0 ? (closes[last] - closes[last - 10]) / closes[last - 10] * 100 : 0;

  if (chg5 > 5 && chg10 > 0) { momScore = 10; reasons.push(`强势上涨5日+${chg5.toFixed(1)}% +10`); }
  else if (chg5 > 3 && chg10 > -2) { momScore = 7; reasons.push(`稳步上升 +7`); }
  else if (chg5 > 1.5) { momScore = 4; reasons.push(`温和上涨 +4`); }
  else if (chg5 < -3) { momScore = -3; reasons.push(`短期下跌${chg5.toFixed(1)}% -3`); }

  score += momScore; launchActual += Math.max(0, momScore);
  details.chg5 = +chg5.toFixed(2);
  details.chg10 = +chg10.toFixed(2);

  // 1.4 MACD动量 — 0~10分
  const { dif, dea, macd: macdHist } = MACD(closes);
  let macdScore = 0;

  // DIF趋势强度和位置
  if (dif[last] != null && dif[last - 1] != null && dif[last - 2] != null) {
    const difSlope = dif[last] - dif[last - 2];
    const difAboveZero = dif[last] > 0;
    const goldenCross = dif[last] > dea[last] && dif[last - 1] <= dea[last - 1];

    if (goldenCross && dif[last] < 0) {
      macdScore = 10;
      reasons.push("MACD零轴下方金叉(强反转) +10");
    } else if (goldenCross) {
      macdScore = 8;
      reasons.push("MACD金叉 +8");
    } else if (dif[last] > dea[last] && difSlope > 0 && difAboveZero) {
      macdScore = 6;
      reasons.push("MACD多头加速 +6");
    } else if (dif[last] > dea[last] && difSlope > 0) {
      macdScore = 4;
      reasons.push("MACD转强 +4");
    } else if (dif[last] > dea[last]) {
      macdScore = 2;
    }
  }
  score += macdScore; launchActual += macdScore;

  // 1.5 RSI动量 — 0~5分
  const rsi = RSI(closes, 14);
  if (rsi[last] != null) {
    let rsiScore = 0;
    // 强势: RSI在50-70且上升
    if (rsi[last] > 50 && rsi[last] < 75 && rsi[last] > rsi[last - 1]) {
      rsiScore = 5;
      reasons.push(`RSI强势区上升(${rsi[last].toFixed(1)}) +5`);
    } else if (rsi[last] > rsi[last - 1] && rsi[last] > 40) {
      rsiScore = 3;
    } else if (rsi[last] > 50) {
      rsiScore = 1;
    }
    score += rsiScore; launchActual += rsiScore;
    details.rsi = +rsi[last].toFixed(1);
  }

  // 1.6 资金流向信号 (外部传入, 从东方财富获取) — 0~5附加分
  if (fundFlowData) {
    let ffScore = 0;
    if (fundFlowData.mainNet > 1e7) {
      ffScore = 5; reasons.push("主力大幅流入(今日) +5");
    } else if (fundFlowData.mainNet > 3e6) {
      ffScore = 3; reasons.push("主力流入 +3");
    }
    score += ffScore; launchActual += ffScore;
    details.fundFlowMain = fundFlowData.mainNet;
  }

  // ==================== 二、质量确认 (0-30分) ====================

  // 2.1 均线趋势 — 0~10分
  const ma5 = SMA(closes, 5);
  const ma10 = SMA(closes, 10);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);

  let trendScore = 0;
  if (closes[last] > ma5[last]) trendScore += 2;
  if (closes[last] > ma10[last]) trendScore += 2;
  if (closes[last] > ma20[last]) trendScore += 2;
  // 均线多头排列
  if (ma5[last] > ma10[last] && ma10[last] > ma20[last]) trendScore += 2;
  // 均线发散向上 (启动特征)
  if (ma5[last] > ma5[last - 3] && ma10[last] > ma10[last - 5]) trendScore += 2;

  score += trendScore; qualActual += trendScore;
  if (trendScore >= 6) reasons.push(`均线多头排列 +${trendScore}`);
  details.trendScore = trendScore;

  // 2.2 OBV确认资金进场 — 0~6分
  const obv = OBV(closes, volumes);
  const obv5 = obv.slice(-5);
  const obv10 = obv.slice(-10);
  const obvSlope5 = obv5.length >= 2 ? (obv5[4] - obv5[0]) / 5 : 0;
  const obvSlope10 = obv10.length >= 2 ? (obv10[9] - obv10[0]) / 10 : 0;

  let obvScore = 0;
  if (obvSlope5 > 0 && obvSlope10 > 0 && obv5[4] > obv10[4]) {
    obvScore = 6; reasons.push("OBV加速上行(资金加速进场) +6");
  } else if (obvSlope5 > 0 && obvSlope10 > 0) {
    obvScore = 4; reasons.push("OBV持续流入 +4");
  } else if (obvSlope5 > 0) {
    obvScore = 2;
  }
  score += obvScore; qualActual += obvScore;

  // 2.3 成交量活跃度 — 0~5分
  const avgV60 = volumes.slice(-60).reduce((s, v) => s + v, 0) / 60;
  const actRatio = avgV20 / (avgV60 || 1);
  let actScore = 0;
  if (actRatio > 1.0 && actRatio < 2.5) actScore = 5;     // 活跃但不异常
  else if (actRatio > 0.6 && actRatio < 3.5) actScore = 3;
  else actScore = 1;
  score += actScore; qualActual += actScore;
  details.volActivity = +actRatio.toFixed(1);

  // 2.4 波动率 — 0~5分
  const atr = ATR(highs, lows, closes, 14);
  if (atr[last] != null) {
    const avgAtr20 = atr.slice(-20).filter(v => v != null).reduce((s, v) => s + v, 0) / 20;
    const atrPct = avgAtr20 / closes[last];
    let atrScore = 0;
    if (atrPct >= 0.02 && atrPct <= 0.06) atrScore = 5;   // 适中波动
    else if (atrPct >= 0.015 && atrPct <= 0.08) atrScore = 3;
    else atrScore = 1;
    score += atrScore; qualActual += atrScore;
    details.atrPct = +(atrPct * 100).toFixed(1);
  }

  // 2.5 KDJ确认 — 0~4分
  const { k, d, j } = KDJ(highs, lows, closes);
  if (k[last] != null && d[last] != null) {
    let kdjScore = 0;
    if (k[last] > d[last] && k[last] > k[last - 1] && k[last] < 75) {
      kdjScore = 4; reasons.push("KDJ多头向上 +4");
    } else if (k[last] > d[last]) {
      kdjScore = 2;
    }
    score += kdjScore; qualActual += kdjScore;
    details.kdjK = +k[last].toFixed(1);
  }

  // ==================== 三、位置参考 (0-15分) ====================
  // 不再是主要评分维度，仅判断是否在合理区域
  // 太高(追高风险)反而扣分

  // 3.1 距60日高点位置 — -5~8分
  const h60 = Math.max(...closes.slice(-60));
  const pos60 = closes[last] / h60;  // 1=最高点
  if (pos60 < 0.70) {
    score += 8; posActual += 8;
    reasons.push("距60日高点较远(安全边际) +8");
  } else if (pos60 < 0.85) {
    score += 4; posActual += 4;
    reasons.push("中等位置 +4");
  } else if (pos60 > 0.97) {
    score -= 3;  // 追高风险
    reasons.push("接近60日新高(追高风险) -3");
  }
  details.pricePos60 = +(pos60 * 100).toFixed(0);

  // 3.2 短期回调后企稳 — 0~7分
  const chg20 = closes[last - 20] > 0 ? (closes[last] - closes[last - 20]) / closes[last - 20] * 100 : 0;
  if (chg20 < -8 && chg5 > 1) {
    score += 7; posActual += 7;
    reasons.push("大幅回调后企稳反弹 +7");
  } else if (chg20 < -5 && chg5 > 0.5) {
    score += 4; posActual += 4;
    reasons.push("回调后反弹 +4");
  }
  details.chg20 = +chg20.toFixed(2);

  // ==================== 汇总 ====================
  let grade, gradeColor;
  if (score >= 60) { grade = "A级·强势突破"; gradeColor = "#ef4444"; }
  else if (score >= 45) { grade = "B级·正在启动"; gradeColor = "#f59e0b"; }
  else if (score >= 30) { grade = "C级·启动迹象"; gradeColor = "#3b82f6"; }
  else { grade = "D级·暂无明显信号"; gradeColor = "#6b7280"; }

  // 启动状态 (更精确的分类)
  let launchStatus;
  if (breakScore >= 8 && volScore >= 12) {
    launchStatus = "🚀 强势突破";
  } else if (breakScore >= 5 && volScore >= 6) {
    launchStatus = "🔥 正在启动";
  } else if (macdScore >= 6 && momScore >= 4) {
    launchStatus = "📈 启动迹象";
  } else if (volScore >= 3 && momScore >= 2) {
    launchStatus = "👀 初步走强";
  } else if (chg5 < -2) {
    launchStatus = "📉 短期走弱";
  } else {
    launchStatus = "⏳ 盘整中";
  }

  const passed = score >= 25;

  return {
    passed,
    score: Math.min(100, score),
    grade, gradeColor, launchStatus,
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

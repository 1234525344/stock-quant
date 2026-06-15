// 游资操作手法分析引擎
//
// 功能:
//   1. 经典游资形态识别 (连板/炸板/回封/翘板/地天板/分歧转一致)
//   2. 买卖点信号 (低吸/半路/打板/竞价/尾盘)
//   3. 短线股分析 (1-5日摆动交易)
//   4. 长线股分析 (趋势+资金沉淀)
//
// 游资操作风格参考:
//   打板派 — 涨停板买入,次日溢价卖出
//   低吸派 — 回调到关键支撑位买入
//   半路派 — 盘中放量突破时追入
//   翘板派 — 跌停板打开瞬间抄底
//   接力派 — 连板股中途介入

const { SMA, EMA, MACD, RSI, KDJ, BOLL, ATR } = require("./indicators");

// ==================== 工具函数 ====================

function pivot(arr, n = 0) { return n < 0 ? arr[arr.length + n] : arr[n]; }
function last(arr) { return arr[arr.length - 1]; }
function prev(arr, n = 1) { return arr[arr.length - 1 - n]; }
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function std(arr) { const m = mean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length); }
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

function pctChange(a, b) { return (a - b) / b; }

// ==================== 涨停/跌停计算 ====================

function getLimitPrice(yesterdayClose, isST = false) {
  const ratio = isST ? 0.05 : 0.10;
  return {
    up: +(yesterdayClose * (1 + ratio)).toFixed(2),
    down: +(yesterdayClose * (1 - ratio)).toFixed(2),
  };
}

function isLimitUp(close, yesterdayClose, high, isST = false) {
  const { up } = getLimitPrice(yesterdayClose, isST);
  return close >= up * 0.995;
}

function isLimitDown(close, yesterdayClose, low, isST = false) {
  const { down } = getLimitPrice(yesterdayClose, isST);
  return close <= down * 1.005;
}

function isNearLimitUp(price, yesterdayClose, threshold = 0.07, isST = false) {
  const chg = pctChange(price, yesterdayClose);
  return chg >= threshold && chg <= (isST ? 0.05 : 0.10);
}

// ==================== 1. 形态识别 ====================

/**
 * 检测连板 (连续涨停板)
 * 返回: { days, startIdx, endIdx, avgVolume, volumeTrend }
 */
function detectConsecutiveLimitUps(klines, minDays = 2) {
  const results = [];
  let streak = { start: -1, count: 0, dates: [] };

  for (let i = 1; i < klines.length; i++) {
    const k = klines[i];
    const prevK = klines[i - 1];
    const chg = (k.close - prevK.close) / prevK.close;

    if (isLimitUp(k.close, prevK.close, k.high)) {
      if (streak.count === 0) streak.start = i;
      streak.count++;
      streak.dates.push(k.date);
    } else {
      if (streak.count >= minDays) {
        const vols = klines.slice(streak.start, streak.start + streak.count).map(k => k.volume);
        results.push({
          startIdx: streak.start,
          days: streak.count,
          dates: [...streak.dates],
          firstDate: streak.dates[0],
          lastDate: last(streak.dates),
          avgVolume: mean(vols),
          volumeTrend: vols[vols.length - 1] / (vols[0] || 1),
        });
      }
      streak = { start: -1, count: 0, dates: [] };
    }
  }
  return results;
}

/**
 * 检测炸板 (触及涨停后回落)
 * 条件: 日内最高价触及涨停, 收盘价未封涨停
 */
function detectBlownLimitUps(klines) {
  const results = [];
  for (let i = 1; i < klines.length; i++) {
    const k = klines[i];
    const prevK = klines[i - 1];
    const { up } = getLimitPrice(prevK.close);
    const chg = (k.close - prevK.close) / prevK.close;

    // 最高价触及涨停但收盘没封住
    if (k.high >= up * 0.995 && !isLimitUp(k.close, prevK.close, k.high)) {
      const recovery = (k.close - k.open) / (k.high - k.open || 1);
      results.push({
        date: k.date,
        idx: i,
        highPct: +((k.high - prevK.close) / prevK.close * 100).toFixed(1),
        closePct: +(chg * 100).toFixed(1),
        dropFromHigh: +((k.high - k.close) / k.high * 100).toFixed(1),
        volume: k.volume,
        recovery,  // 0-1, higher = more recovery from low
        type: recovery > 0.7 ? "高位换手" : recovery > 0.4 ? "尾盘炸板" : "深度炸板",
      });
    }
  }
  return results;
}

/**
 * 检测回封 (炸板后重新封板)
 * 需要日内分钟数据, 这里用日K近似: 上影线长但收盘仍涨停
 */
function detectResealLimitUps(klines) {
  const results = [];
  for (let i = 1; i < klines.length; i++) {
    const k = klines[i];
    const prevK = klines[i - 1];
    const isLU = isLimitUp(k.close, prevK.close, k.high);
    const upperShadow = k.high - k.close;
    const body = Math.abs(k.close - k.open);

    // 封板但有明显上影线 = 可能盘中炸过
    if (isLU && upperShadow > body * 0.3) {
      results.push({
        date: k.date,
        idx: i,
        upperShadowPct: +(upperShadow / k.close * 100).toFixed(2),
        volume: k.volume,
        quality: upperShadow < body * 0.5 ? "强回封" : "弱回封",
      });
    }
  }
  return results;
}

/**
 * 检测翘板信号 (跌停板附近有大资金介入)
 * 条件: 前一天跌停或准跌停, 今天放量收阳
 */
function detectBottomFishing(klines) {
  const results = [];
  for (let i = 2; i < klines.length; i++) {
    const k = klines[i];
    const prevK = klines[i - 1];
    const prev2 = klines[i - 2];
    const { down } = getLimitPrice(prevK.close);

    // 前一日跌停或大幅下跌
    const prevChg = (prevK.close - prev2.close) / prev2.close;
    const wasWeak = prevChg <= -0.08 || isLimitDown(prevK.close, prev2.close, prevK.low);

    // 今日放量收阳
    const isYang = k.close > k.open;
    const volSurge = k.volume > prevK.volume * 1.5;
    const chg = (k.close - prevK.close) / prevK.close;
    const isRecovery = chg > 0.02;

    if (wasWeak && isYang && volSurge) {
      results.push({
        date: k.date,
        idx: i,
        prevChg: +(prevChg * 100).toFixed(1),
        todayChg: +(chg * 100).toFixed(1),
        volRatio: +(k.volume / prevK.volume).toFixed(1),
        signal: chg > 0.05 ? "强势翘板" : "弱翘板",
        entry: k.close,
        stopLoss: +(Math.min(prevK.low, k.low) * 0.98).toFixed(2),
      });
    }
  }
  return results;
}

/**
 * 检测分歧转一致 (放量炸板次日缩量封板 / 放量分歧后缩量上涨)
 */
function detectDivergenceToConsensus(klines) {
  const results = [];
  const blownUps = detectBlownLimitUps(klines);

  for (const bu of blownUps) {
    if (bu.idx + 1 >= klines.length) continue;
    const nextK = klines[bu.idx + 1];
    const thisK = klines[bu.idx];
    const prev2 = klines[bu.idx - 1];

    const nextChg = prev2 ? (nextK.close - thisK.close) / thisK.close : 0;
    const isNextLU = prev2 ? isLimitUp(nextK.close, thisK.close, nextK.high) : false;
    const volShrink = nextK.volume < thisK.volume * 0.8;

    // 炸板次日缩量反包 = 分歧转一致
    if (isNextLU && volShrink) {
      results.push({
        date: thisK.date,
        blownDate: bu.date,
        sealDate: nextK.date,
        type: "缩量反包",
        quality: "高",
      });
    } else if (nextChg > 0.03 && volShrink) {
      results.push({
        date: thisK.date,
        blownDate: bu.date,
        sealDate: nextK.date,
        type: "分歧转强",
        quality: "中",
      });
    }
  }
  return results;
}

/**
 * 检测地天板 (跌停→涨停,日内极端反转)
 * 日K近似: 下影线极长, 收盘涨停
 */
function detectExtremeReversal(klines) {
  const results = [];
  for (let i = 1; i < klines.length; i++) {
    const k = klines[i];
    const prevK = klines[i - 1];
    const lowerShadow = Math.min(k.open, k.close) - k.low;
    const upperShadow = k.high - Math.max(k.open, k.close);
    const body = Math.abs(k.close - k.open);
    const totalRange = k.high - k.low || 1;

    // 长下影 + 收盘涨停 = 地天板
    const isLU = isLimitUp(k.close, prevK.close, k.high);
    const longLowerShadow = lowerShadow > totalRange * 0.4;

    if (isLU && longLowerShadow) {
      results.push({
        date: k.date,
        idx: i,
        type: "地天板",
        lowerShadowPct: +(lowerShadow / totalRange * 100).toFixed(0),
        volume: k.volume,
        quality: body > totalRange * 0.3 ? "坚决" : "犹豫",
      });
    }

    // 长上影 + 收盘跌停 = 天地板
    const isLD = isLimitDown(k.close, prevK.close, k.low);
    const longUpperShadow = upperShadow > totalRange * 0.4;
    if (isLD && longUpperShadow) {
      results.push({
        date: k.date,
        idx: i,
        type: "天地板",
        upperShadowPct: +(upperShadow / totalRange * 100).toFixed(0),
        volume: k.volume,
        quality: "危险信号",
      });
    }
  }
  return results;
}

// ==================== 2. 买卖点信号 ====================

/**
 * 综合买卖点分析
 * 返回每只股票的当前信号
 */
function analyzeEntryExit(klines, fundFlow = null, realtime = null) {
  if (klines.length < 60) return { error: "数据不足,需要至少60根K线" };

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const opens = klines.map(k => k.open);

  const cur = last(klines);
  const prevK = prev(klines);
  const curChg = (cur.close - prevK.close) / prevK.close;

  const ma5 = SMA(closes, 5);
  const ma10 = SMA(closes, 10);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);
  const volMa5 = SMA(volumes, 5);
  const volMa20 = SMA(volumes, 20);

  const atr = ATR(highs, lows, closes, 14);
  const rsi = RSI(closes, 14);
  const boll = BOLL(closes, 20, 2);
  const macd = MACD(closes);

  const signals = {
    // 买入信号
    buy: [],
    // 卖出信号
    sell: [],
    // 综合评分 (-100 ~ +100)
    score: 0,
    // 操作建议
    suggestion: "",
    // 短线/长线判断
    timeframe: "",
  };

  // ── 买入信号检测 ──

  // 1. 放量突破前高/均线压制
  const volRatio = last(volumes) / (last(volMa5) || 1);
  const aboveMA20 = last(closes) > last(ma20);
  const aboveMA60 = last(closes) > last(ma60);
  const brokeMA20 = prev(ma20) && last(closes) > last(ma20) && prev(closes) <= prev(ma20);

  if (brokeMA20 && volRatio > 1.3) {
    signals.buy.push({ signal: "放量突破MA20", strength: 3, type: "半路" });
  }

  // 2. 缩量回踩均线不破
  const nearMA20 = Math.abs(last(closes) - last(ma20)) / last(ma20) < 0.02;
  const volShrink = volRatio < 0.7;
  if (nearMA20 && volShrink && last(closes) > last(ma20)) {
    signals.buy.push({ signal: "缩量回踩MA20", strength: 2, type: "低吸" });
  }

  // 3. MACD 金叉
  if (last(macd.dif) > last(macd.dea) && prev(macd.dif) <= prev(macd.dea)) {
    signals.buy.push({ signal: "MACD金叉", strength: 2, type: "趋势" });
  }

  // 4. KDJ 超卖金叉
  if (rsi.length > 1 && last(rsi) < 30 && prev(rsi) < last(rsi)) {
    signals.buy.push({ signal: "RSI超卖反弹", strength: 2, type: "低吸" });
  }

  // 5. 涨停板次日高开 (强势接力)
  const prevIsLU = isLimitUp(prevK.close, prev(klines, 2)?.close || prevK.close, prevK.high);
  if (prevIsLU && cur.open > prevK.close * 1.02) {
    signals.buy.push({ signal: "涨停次日高开接力", strength: 3, type: "打板/接力" });
  }

  // 6. 炸板次日反包
  const blownToday = last(detectBlownLimitUps(klines).filter(b => b.idx === klines.length - 1));
  if (blownToday && curChg > 0.03 && volRatio > 1.2) {
    signals.buy.push({ signal: "炸板修复中", strength: 2, type: "低吸" });
  }

  // 7. 翘板信号
  const bottomFish = detectBottomFishing(klines);
  if (bottomFish.length > 0 && last(bottomFish).idx === klines.length - 1) {
    signals.buy.push({ signal: "翘板信号", strength: 2, type: "翘板" });
  }

  // 8. 放量长阳 (主力进场)
  const isBigYang = curChg > 0.05 && cur.close > cur.open;
  const isVolSurge = volRatio > 1.5;
  if (isBigYang && isVolSurge && aboveMA20) {
    signals.buy.push({ signal: "放量长阳突破", strength: 4, type: "半路/打板" });
  }

  // ── 卖出信号检测 ──

  // 1. 高位放量滞涨
  const nearHigh52w = cur.close >= Math.max(...highs.slice(-250)) * 0.95;
  const doji = Math.abs(cur.close - cur.open) / (cur.high - cur.low || 1) < 0.3;
  if (nearHigh52w && doji && volRatio > 1.5) {
    signals.sell.push({ signal: "高位放量滞涨", strength: 4, type: "减仓" });
  }

  // 2. 破MA20且放量
  if (last(closes) < last(ma20) && prev(closes) >= prev(ma20) && volRatio > 1.2) {
    signals.sell.push({ signal: "放量跌破MA20", strength: 3, type: "止损" });
  }

  // 3. MACD 死叉
  if (macd.dif.length > 1 && last(macd.dif) < last(macd.dea) && prev(macd.dif) >= prev(macd.dea)) {
    signals.sell.push({ signal: "MACD死叉", strength: 2, type: "趋势" });
  }

  // 4. RSI 超买
  if (last(rsi) > 75) {
    signals.sell.push({ signal: `RSI超买(${last(rsi).toFixed(0)})`, strength: 3, type: "减仓" });
  }

  // 5. 连板后放量大阴线 (核按钮)
  const consecutiveLU = detectConsecutiveLimitUps(klines, 2);
  if (consecutiveLU.length > 0) {
    const lastLU = last(consecutiveLU);
    if (lastLU.lastDate === prevK.date && curChg < -0.05) {
      signals.sell.push({ signal: "连板后核按钮", strength: 5, type: "止损" });
    }
  }

  // 6. 布林上轨放量回落
  if (boll.upper.length > 0 && last(highs) >= last(boll.upper) * 0.99 && last(closes) < last(opens)) {
    signals.sell.push({ signal: "布林上轨受阻", strength: 2, type: "减仓" });
  }

  // ── 综合评分 ──
  let score = 0;
  for (const b of signals.buy) score += b.strength * 10;
  for (const s of signals.sell) score -= s.strength * 10;
  signals.score = Math.max(-100, Math.min(100, score));

  // ── 操作建议 ──
  if (score >= 25) {
    signals.suggestion = "可操作";
    signals.timeframe = "短线";
  } else if (score >= 10) {
    signals.suggestion = "观察";
    signals.timeframe = "短线/中线";
  } else if (score >= -10) {
    signals.suggestion = "观望";
    signals.timeframe = "中线";
  } else if (score >= -25) {
    signals.suggestion = "减仓或回避";
    signals.timeframe = "中线/长线";
  } else {
    signals.suggestion = "回避";
    signals.timeframe = "长线";
  }

  // 资金流向加成
  if (fundFlow) {
    const recentFlow = Array.isArray(fundFlow) ? fundFlow.slice(-5) : [];
    const mainNet = recentFlow.reduce((s, f) => s + (f.main || 0), 0);
    if (mainNet > 0) signals.score += 10;
    if (mainNet < 0) signals.score -= 10;
    signals.fundFlow = { recentMainNet: mainNet, period: "5日" };
  }

  return signals;
}

// ==================== 3. 短线股分析 ====================

/**
 * 短线股筛选 (1-5日摆动交易)
 * 游资短线偏好:
 *   - 高波动 (ATR大)
 *   - 高换手 (成交活跃)
 *   - 强动量 (短期趋势明确)
 *   - 有题材/消息驱动 (涨停基因)
 *   - 盘子适中 (流通市值50-200亿)
 */
function shortTermAnalysis(klines, name = "") {
  if (klines.length < 60) return { error: "数据不足" };

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const amounts = klines.map(k => k.amount || k.close * k.volume * 100);

  const cur = last(klines);
  const prevK = prev(klines);

  // 基础指标
  const ma5 = last(SMA(closes, 5));
  const ma10 = last(SMA(closes, 10));
  const ma20 = last(SMA(closes, 20));
  const atr14 = last(ATR(highs, lows, closes, 14));
  const atrPct = atr14 / cur.close;
  const volMa5 = last(SMA(volumes, 5));
  const volMa20 = last(SMA(volumes, 20));
  const volRatio = cur.volume / (volMa20 || 1);
  const avgAmount = mean(amounts.slice(-20));
  const rsi14 = last(RSI(closes, 14));

  // 短线评分 (0-100)
  let score = 50;

  // 1. 波动率 (10-30%)
  if (atrPct > 0.03) score += 10;
  else if (atrPct > 0.02) score += 5;
  else score -= 5;

  // 2. 成交量活跃
  if (volRatio > 2.0) score += 15;
  else if (volRatio > 1.5) score += 10;
  else if (volRatio > 1.0) score += 5;

  // 3. 短期趋势
  const chg5 = (cur.close - (closes[closes.length - 6] || closes[0])) / (closes[closes.length - 6] || closes[0]);
  const chg10 = (cur.close - (closes[closes.length - 11] || closes[0])) / (closes[closes.length - 11] || closes[0]);
  if (chg5 > 0.05 && chg10 > 0.05) score += 15;
  else if (chg5 > 0) score += 5;
  else score -= 10;

  // 4. 均线多头
  if (ma5 && ma10 && ma20 && ma5 > ma10 && ma10 > ma20) score += 10;

  // 5. 涨停基因 (近期有过涨停)
  const recentLimitUps = klines.slice(-20).filter((k, i) => {
    if (i === 0) return false;
    const prevK = klines[klines.length - 20 + i - 1];
    return isLimitUp(k.close, prevK.close, k.high);
  }).length;
  if (recentLimitUps >= 3) score += 15;
  else if (recentLimitUps >= 1) score += 8;

  // 6. 流通市值 (估算)
  const estMarketCap = avgAmount / 0.03; // 假设3%换手率
  const isGoodSize = estMarketCap > 5e9 && estMarketCap < 2e11; // 50亿-2000亿
  if (isGoodSize) score += 5;

  // 7. 位置 (非高位)
  const high52w = Math.max(...highs.slice(-250));
  const distFromHigh = (cur.close - high52w) / high52w;
  if (distFromHigh > -0.1) score += 5; // 接近新高
  else if (distFromHigh < -0.3) score -= 5; // 深度回调

  score = Math.max(0, Math.min(100, score));

  // 操作建议
  let suggestion;
  if (score >= 75) suggestion = "强势短线标的,可追涨或低吸";
  else if (score >= 60) suggestion = "短线可操作,注意仓位";
  else if (score >= 40) suggestion = "短线一般,等待更好买点";
  else suggestion = "不适合短线操作";

  // 买卖点信号
  const signals = analyzeEntryExit(klines);

  return {
    name,
    score,
    suggestion,
    indicators: {
      atrPct: +(atrPct * 100).toFixed(1),
      volRatio: +volRatio.toFixed(1),
      chg5: +(chg5 * 100).toFixed(1),
      chg10: +(chg10 * 100).toFixed(1),
      rsi14: +rsi14.toFixed(1),
      recentLimitUps,
      distFrom52wHigh: +(distFromHigh * 100).toFixed(1),
      estMarketCapBillions: +(estMarketCap / 1e9).toFixed(1),
    },
    signals,
    patterns: {
      consecutiveLimitUps: detectConsecutiveLimitUps(klines),
      blownUps: detectBlownLimitUps(klines).slice(-3),
      bottomFishing: detectBottomFishing(klines).slice(-2),
      extremeReversal: detectExtremeReversal(klines).slice(-2),
      divergenceToConsensus: detectDivergenceToConsensus(klines).slice(-2),
    },
    grade: score >= 75 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D",
  };
}

// ==================== 4. 长线股分析 ====================

/**
 * 长线股分析 (基于游资视角)
 * 游资眼里的"长线"和机构不同:
 *   - 机构: 基本面 + 估值 + 成长
 *   - 游资: 筹码结构 + 资金沉淀 + 趋势持续性 + 题材空间
 */
function longTermAnalysis(klines, name = "", fundFlow = null) {
  if (klines.length < 120) return { error: "数据不足,需要至少120根K线" };

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const amounts = klines.map(k => k.amount || k.close * k.volume * 100);

  const cur = last(klines);

  // 均线系统
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);
  const ma120 = SMA(closes, 120);
  const ma250 = SMA(closes, 250);

  const curMA20 = last(ma20);
  const curMA60 = last(ma60);
  const curMA120 = last(ma120);
  const curMA250 = last(ma250);

  // 多头排列检查
  const isLongTrend = curMA20 > curMA60 && curMA60 > curMA120 && curMA120 > curMA250;
  const isAboveAllMA = cur.close > curMA20 && cur.close > curMA60 && cur.close > curMA120 && cur.close > curMA250;

  // 趋势强度 (均线发散度)
  const maSpread = curMA250 > 0
    ? (curMA20 - curMA250) / curMA250
    : 0;

  // 成交量趋势
  const volMA20 = SMA(volumes, 20);
  const volMA60 = SMA(volumes, 60);
  const volTrend = last(volMA20) / (last(volMA60) || 1);

  // 资金沉淀分析
  let moneyFlowAnalysis = null;
  if (fundFlow) {
    const flows = Array.isArray(fundFlow) ? fundFlow : [];
    const recent20 = flows.slice(-20);
    const recent60 = flows.slice(-60);

    const main20Sum = recent20.reduce((s, f) => s + (f.main || 0), 0);
    const main60Sum = recent60.reduce((s, f) => s + (f.main || 0), 0);

    const isMainAccumulating = main20Sum > 0 && main60Sum > 0;
    const accumulationStrength = recent20.length > 0
      ? main20Sum / recent20.reduce((s, f) => s + Math.abs(f.main || 0), 0)
      : 0;

    moneyFlowAnalysis = {
      main20DayNet: main20Sum,
      main60DayNet: main60Sum,
      isAccumulating: isMainAccumulating,
      accumulationStrength: +accumulationStrength.toFixed(2),
      interpretation: accumulationStrength > 0.3 ? "主力持续吸筹"
        : accumulationStrength > 0.1 ? "主力小幅流入"
        : accumulationStrength > -0.1 ? "资金平衡"
        : accumulationStrength > -0.3 ? "主力小幅流出"
        : "主力持续出货",
    };
  }

  // 回调深度
  const high250 = Math.max(...highs.slice(-250));
  const low250 = Math.min(...lows.slice(-250));
  const drawdown = (cur.close - high250) / high250;
  const recoveryFromLow = (cur.close - low250) / (high250 - low250 || 1);

  // 波动率 (年化)
  const dailyReturns = closes.slice(-250).map((c, i) =>
    i > 0 ? Math.log(c / closes[i - 251 + 250]) : 0
  ).filter(r => !isNaN(r)).slice(1);
  const annualVol = std(dailyReturns) * Math.sqrt(250);

  // 换手率趋势 (用成交额/估算市值)
  const avgAmount20 = mean(amounts.slice(-20));
  const avgAmount60 = mean(amounts.slice(-60));
  const turnoverTrend = avgAmount20 / (avgAmount60 || 1);

  // 综合评分 (0-100)
  let score = 50;

  // 趋势
  if (isLongTrend && isAboveAllMA) score += 20;
  else if (isAboveAllMA) score += 10;
  else if (!isAboveAllMA) score -= 10;

  // 回调位置
  if (drawdown > -0.1 && recoveryFromLow > 0.8) score += 10;
  else if (drawdown < -0.3) score += 5; // 深度回调可能是机会
  else score -= 5;

  // 成交量
  if (volTrend > 1.2) score += 10;
  else if (volTrend < 0.8) score -= 10;

  // 换手
  if (turnoverTrend > 1.1) score += 5;

  score = Math.max(0, Math.min(100, score));

  let suggestion;
  if (score >= 75) suggestion = "长线趋势良好,可分批布局";
  else if (score >= 60) suggestion = "趋势尚可,等待回调加仓";
  else if (score >= 40) suggestion = "趋势不明,保持观察";
  else suggestion = "趋势走坏,建议回避";

  return {
    name,
    score,
    suggestion,
    indicators: {
      isLongTrend,
      isAboveAllMA,
      maSpread: +(maSpread * 100).toFixed(1),
      volTrend: +volTrend.toFixed(2),
      drawdown: +(drawdown * 100).toFixed(1),
      recoveryFromLow: +(recoveryFromLow * 100).toFixed(1),
      annualVol: +(annualVol * 100).toFixed(1),
      turnoverTrend: +turnoverTrend.toFixed(2),
    },
    moneyFlow: moneyFlowAnalysis,
    grade: score >= 75 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D",
  };
}

// ==================== 5. 综合扫描 ====================

/**
 * 按游资风格扫描股票池
 * 返回: 短线标的列表 + 长线标的列表 + 特殊形态列表
 */
function hotMoneyScan(stocksData) {
  const shortTermPicks = [];
  const longTermPicks = [];
  const patterns = {
    consecutiveLimitUps: [],
    blownUps: [],
    bottomFishing: [],
    extremeReversal: [],
    divergenceToConsensus: [],
  };

  for (const stock of stocksData) {
    if (!stock.klines || stock.klines.length < 60) continue;
    const klines = stock.klines;

    // 短线分析
    const shortResult = shortTermAnalysis(klines, stock.code);
    if (shortResult.grade === "A" || shortResult.grade === "B") {
      shortTermPicks.push(shortResult);
    }

    // 长线分析
    const longResult = longTermAnalysis(klines, stock.code);
    if (longResult.grade === "A" || longResult.grade === "B") {
      longTermPicks.push(longResult);
    }

    // 特殊形态收集
    const consLU = detectConsecutiveLimitUps(klines);
    if (consLU.length > 0) {
      patterns.consecutiveLimitUps.push({
        code: stock.code,
        name: stock.name,
        patterns: consLU.slice(-3),
      });
    }

    const blowns = detectBlownLimitUps(klines);
    if (blowns.length > 0 && blowns[blowns.length - 1].idx >= klines.length - 3) {
      patterns.blownUps.push({
        code: stock.code,
        name: stock.name,
        latest: last(blowns),
      });
    }

    const fish = detectBottomFishing(klines);
    if (fish.length > 0 && last(fish).idx >= klines.length - 2) {
      patterns.bottomFishing.push({
        code: stock.code,
        name: stock.name,
        latest: last(fish),
      });
    }

    const reversal = detectExtremeReversal(klines);
    if (reversal.length > 0 && last(reversal).idx >= klines.length - 5) {
      patterns.extremeReversal.push({
        code: stock.code,
        name: stock.name,
        latest: last(reversal),
      });
    }

    const dtc = detectDivergenceToConsensus(klines);
    if (dtc.length > 0 && dtc[dtc.length - 1].date === last(klines).date) {
      patterns.divergenceToConsensus.push({
        code: stock.code,
        name: stock.name,
        latest: last(dtc),
      });
    }
  }

  // 排序
  shortTermPicks.sort((a, b) => b.score - a.score);
  longTermPicks.sort((a, b) => b.score - a.score);

  return {
    shortTerm: shortTermPicks.slice(0, 20),
    longTerm: longTermPicks.slice(0, 20),
    patterns,
    summary: {
      totalScanned: stocksData.length,
      shortTermGradeA: shortTermPicks.filter(s => s.grade === "A").length,
      shortTermGradeB: shortTermPicks.filter(s => s.grade === "B").length,
      longTermGradeA: longTermPicks.filter(s => s.grade === "A").length,
      longTermGradeB: longTermPicks.filter(s => s.grade === "B").length,
      activePatterns: {
        consecutiveLimitUps: patterns.consecutiveLimitUps.length,
        blownUps: patterns.blownUps.length,
        bottomFishing: patterns.bottomFishing.length,
        extremeReversal: patterns.extremeReversal.length,
        divergenceToConsensus: patterns.divergenceToConsensus.length,
      },
    },
  };
}

// ==================== 6. 游资风格匹配 ====================

/**
 * 游资风格枚举与核心参数
 *
 * 章盟主: 波段主升浪+趋势锁仓, 30日均线建仓, 善庄不砸盘
 *   条件: 大成交额票(流动性好), 不做第一波专做第二波加速, 锁仓做T压成本
 *
 * 赵老哥: 二板定龙头, 八年一万倍, 只做主线龙头
 *   条件: 二板确认为龙头(首板随机性大), 流通市值20-50亿, 止损-5%减50%/-8%全清
 *
 * 炒股养家: 情绪周期大师, 买入分歧卖出一致, 《养家心法》
 *   条件: 启动→发酵→高潮→衰退四阶段定位, 赢面<60%空仓, >90%满仓
 *
 * 作手新一: 连板接力王(占90%+), 7年3000倍
 *   条件: 4板6板都敢做没有高度限制, 反包板(涨停-跌停-涨停)+趋势加速介入
 *
 * 方新侠: 格局之王, 大成交趋势票, 5-10天波段
 *   条件: 流通盘200亿+, 多头排列加速模式, 龙头分歧加仓, 三日不破五日线锁仓
 *
 * 小鳄鱼: 反包板核心战法, 3年1000倍, 90后新生代
 *   条件: 龙头大跌后深水区低吸博反包涨停, 高开7%+下杀低吸最佳, 隔日为主
 *
 * 歌神: 翘板(撬跌停板)操作, 反核战法
 *   条件: 被错杀跌停股大手笔撬板, 博情绪修复反弹, 3日内可获利25%
 *
 * 涅槃重升: 树式心法, 四个情绪周期, 100万→1亿
 *   条件: 低位震荡试错/主升期分歧介入/高位震荡轻仓/主跌期空仓
 *
 * 北京炒家: 首板套利专家, T+1必出, 超高频复利
 *   条件: 10:30前封板, 流通市值30-100亿, 股价<20元, 半年内至少3次涨停
 *
 * 92科比: 情绪周期布道者, 10万→3亿, 不做中位
 *   条件: 低位震荡(新题材首板)→主升期(分歧介入)→高位震荡(轻仓)→主跌期(空仓)
 */

/**
 * 章盟主模式 — 大盘龙头趋势接力
 * 特点: 500亿+市值, 长平台突破, 重仓锁仓
 */
function matchZhangMengzhu(klines) {
  if (klines.length < 120) return null;
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const amounts = klines.map(k => k.amount || k.close * k.volume * 100);
  const highs = klines.map(k => k.high);

  const cur = last(klines);
  const avgAmount20 = mean(amounts.slice(-20));
  const estMarketCap = avgAmount20 / 0.025; // 估算流通市值
  if (estMarketCap < 50e9) return null; // <500亿不匹配

  const ma20 = last(SMA(closes, 20));
  const ma60 = last(SMA(closes, 60));
  const ma120 = last(SMA(closes, 120));
  const isBullAlignment = ma20 > ma60 && ma60 > ma120 && cur.close > ma20;

  // 平台突破: 过去60日振幅<25% 且 最近5日涨幅>5%
  const high60 = Math.max(...highs.slice(-60));
  const low60 = Math.min(...lows.slice(-60));
  const range60 = (high60 - low60) / low60;
  const chg5 = (cur.close - (closes[closes.length - 6] || closes[0])) / (closes[closes.length - 6] || closes[0]);

  const isBreakout = range60 < 0.25 && chg5 > 0.05;
  const volRatio = cur.volume / (mean(volumes.slice(-20)) || 1);

  if (!isBullAlignment) return null;

  let score = 0;
  if (isBreakout) score += 3;
  if (volRatio > 1.5) score += 2;
  if (estMarketCap > 100e9) score += 1;
  if (chg5 < 0.15) score += 1; // 不追高

  if (score < 3) return null;

  return {
    name: "章盟主",
    style: "大盘龙头趋势接力",
    match: score >= 5 ? "高" : score >= 3 ? "中" : "低",
    score,
    signals: {
      marketCap: +(estMarketCap / 1e9).toFixed(0) + "亿",
      breakout: isBreakout ? "平台突破" : "趋势延续",
      chg5: +(chg5 * 100).toFixed(1) + "%",
      volRatio: +volRatio.toFixed(1),
    },
    tactics: "30日均线附近建仓, 锁仓做T压成本, 只做第二波加速, 跌破MA60止损, 目标主升浪完整波段",
  };
}

/**
 * 赵老哥模式 — 首板打板接力
 * 特点: 首板放量, 次日高开追入, 次次日溢价走
 */
function matchZhaoLaoge(klines) {
  if (klines.length < 20) return null;
  const closes = klines.map(k => k.close);
  const opens = klines.map(k => k.open);
  const highs = klines.map(k => k.high);
  const volumes = klines.map(k => k.volume);

  const cur = last(klines);
  const prevK = prev(klines);
  const prev2 = prev(klines, 2);

  // 昨日是否首板 (前日非涨停, 昨日涨停)
  const prev2IsLU = isLimitUp(prev2.close, prev(klines, 3)?.close || prev2.close, prev2.high);
  const prevIsLU = isLimitUp(prevK.close, prev2.close, prevK.high);
  const isFirstBoard = prevIsLU && !prev2IsLU;

  if (!isFirstBoard) return null;

  // 封板质量: 要求小实体 + 大成交量
  const prevBody = Math.abs(prevK.close - prevK.open);
  const prevRange = prevK.high - prevK.low || 1;
  const bodyRatio = prevBody / prevRange;

  const prevVolMA5 = mean(volumes.slice(-6, -1)); // 不含昨日的5日均量
  const volRatio = prevK.volume / (prevVolMA5 || 1);

  // 今日高开确认
  const todayGap = (cur.open - prevK.close) / prevK.close;

  let score = 0;
  if (bodyRatio < 0.3) score += 2; // 实体小 = 封板坚决
  if (volRatio > 2.0) score += 2;
  else if (volRatio > 1.5) score += 1;
  if (todayGap > 0.01) score += 2; // 高开接力
  else if (todayGap > 0) score += 1;

  if (score < 3) return null;

  return {
    name: "赵老哥",
    style: "二板定龙头接力",
    match: score >= 5 ? "高" : score >= 3 ? "中" : "低",
    score,
    signals: {
      boardDate: prevK.date,
      boardQuality: bodyRatio < 0.2 ? "一字/秒封" : bodyRatio < 0.3 ? "强势封板" : "换手封板",
      volRatio: +volRatio.toFixed(1),
      gap: +(todayGap * 100).toFixed(1) + "%",
    },
    tactics: "二板确认龙头后打板介入, 止损-5%减仓50%/-8%全清, 盈利10%-20%即撤, 次日情绪差即砍仓",
  };
}

/**
 * 炒股养家模式 — 等恐慌, 低吸半路
 * 特点: 等跌透, 等缩量, 等地量十字星, 等市场给机会
 */
function matchYangJia(klines) {
  if (klines.length < 30) return null;
  const closes = klines.map(k => k.close);
  const lows = klines.map(k => k.low);
  const opens = klines.map(k => k.open);
  const volumes = klines.map(k => k.volume);

  const cur = last(klines);

  // 连跌: 过去5日有3日以上收阴
  const recent5 = klines.slice(-6, -1);
  const bearDays = recent5.filter(k => k.close < k.open).length;
  if (bearDays < 3) return null;

  // 跌幅: 5日累计跌>8%
  const chg5 = (cur.close - closes[closes.length - 6]) / closes[closes.length - 6];
  if (chg5 > -0.08) return null;

  // 缩量: 今日量 < 20日均量 * 0.7
  const volMA20 = mean(volumes.slice(-21, -1));
  const volShrink = cur.volume / (volMA20 || 1);

  // 企稳形态: 长下影线 或 十字星
  const lowerShadow = Math.min(cur.open, cur.close) - cur.low;
  const totalRange = cur.high - cur.low || 1;
  const lowerShadowRatio = lowerShadow / totalRange;
  const body = Math.abs(cur.close - cur.open);
  const isDoji = body / (totalRange || 1) < 0.25;
  const isStabilizing = lowerShadowRatio > 0.5 || isDoji;

  // RSI 超卖
  const rsi14 = last(RSI(closes, 14));

  let score = 0;
  if (volShrink < 0.6) score += 3; // 极致缩量
  else if (volShrink < 0.8) score += 2;
  if (isStabilizing) score += 2; // 下影线/十字星
  if (rsi14 < 35) score += 2; // 超卖
  else if (rsi14 < 40) score += 1;
  if (chg5 < -0.15) score += 1; // 跌透了

  if (score < 4) return null;

  return {
    name: "炒股养家",
    style: "情绪周期大师·买入分歧卖出一致",
    match: score >= 6 ? "高" : score >= 4 ? "中" : "低",
    score,
    signals: {
      chg5: +(chg5 * 100).toFixed(1) + "%",
      volShrink: +volShrink.toFixed(2) + "x均量",
      pattern: isStabilizing ? (isDoji ? "地量十字星" : "长下影线企稳") : "缩量止跌",
      rsi14: +rsi14.toFixed(0),
    },
    tactics: "启动期轻仓试错, 发酵期中仓出击, 高潮期分批减仓, 退潮期绝对空仓, 赢面<60%观望",
  };
}

/**
 * 作手新一模式 — 龙头战法, 3日不涨即走
 * 特点: 人气龙头, 高换手>10%, 连板接力, 快进快出
 */
function matchZuoshouXinyi(klines) {
  if (klines.length < 20) return null;
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const volumes = klines.map(k => k.volume);
  const amounts = klines.map(k => k.amount || k.close * k.volume * 100);

  const cur = last(klines);
  const prevK = prev(klines);

  // 正在连板中
  const consLU = detectConsecutiveLimitUps(klines, 1);
  if (consLU.length === 0) return null;
  const currentStreak = consLU[consLU.length - 1];
  const isInStreak = currentStreak.lastDate === cur.date || currentStreak.lastDate === prevK.date;
  if (!isInStreak) return null;

  // 换手率(用成交额/估算市值)
  const avgAmount5 = mean(amounts.slice(-5));
  const avgAmount60 = mean(amounts.slice(-60));
  const turnover = avgAmount5 / (avgAmount60 / 0.03); // 粗略估计
  const turnoverPct = turnover * 100;

  // 封板强度
  const body = Math.abs(cur.close - cur.open);
  const range = cur.high - cur.low || 1;
  const sealQuality = body / range < 0.2 ? "一字封死" : body / range < 0.4 ? "换手封板" : "烂板";

  let score = 0;
  if (turnoverPct > 10) score += 3; // 高换手
  else if (turnoverPct > 5) score += 2;
  if (currentStreak.days >= 3) score += 2; // 已成妖
  if (currentStreak.days === 2) score += 1;
  if (sealQuality === "一字封死") score -= 1; // 买不到
  if (sealQuality === "换手封板") score += 2; // 买得到且健康
  if (currentStreak.volumeTrend > 1.5) score += 1; // 放量

  if (score < 4) return null;

  return {
    name: "作手新一",
    style: "连板接力王·反包+趋势加速",
    match: score >= 6 ? "高" : score >= 4 ? "中" : "低",
    score,
    signals: {
      streakDays: currentStreak.days,
      turnover: +turnoverPct.toFixed(1) + "%",
      sealQuality,
      volumeTrend: currentStreak.volumeTrend > 1 ? "放量" : "缩量",
    },
    tactics: "连板接力(占90%+), 4-6板都敢做无高度限制, 反包板追涨停-跌停-涨停形态, 单次回撤控制在2%",
  };
}

/**
 * 方新侠模式 — 趋势波段, 重仓持有
 * 特点: 趋势确立后重仓, 沿MA20持有, 不破不走
 */
function matchFangXinxia(klines) {
  if (klines.length < 120) return null;
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  const cur = last(klines);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);
  const ma120 = SMA(closes, 120);

  const isBullAlign = last(ma20) > last(ma60) && last(ma60) > last(ma120);

  // 趋势斜率: MA20过去20日的斜率
  const ma20Slope = ma20.length > 40
    ? (last(ma20) - ma20[ma20.length - 21]) / ma20[ma20.length - 21]
    : 0;

  // MA20支撑: 股价回踩但未有效跌破
  const aboveMA20 = cur.close > last(ma20);
  const nearMA20 = Math.abs(cur.close - last(ma20)) / last(ma20) < 0.03;

  // 成交量递增 (3波放量)
  const volMA5_1 = mean(volumes.slice(-10, -5));
  const volMA5_2 = mean(volumes.slice(-5));
  const volIncreasing = volMA5_2 > volMA5_1 * 1.05;

  if (!isBullAlign) return null;

  let score = 0;
  if (ma20Slope > 0.02) score += 3; // MA20陡峭上行
  else if (ma20Slope > 0.01) score += 2;
  if (nearMA20 && aboveMA20) score += 3; // 回踩MA20不破 → 最佳买点
  if (volIncreasing) score += 1;
  if (last(volumes) < mean(volumes.slice(-5)) * 0.8) score += 1; // 缩量回踩

  if (score < 4) return null;

  return {
    name: "方新侠",
    style: "格局之王·大成交趋势猎手",
    match: score >= 6 ? "高" : score >= 4 ? "中" : "低",
    score,
    signals: {
      trend: "MA多头排列",
      ma20Slope: +(ma20Slope * 100).toFixed(1) + "%/月",
      position: nearMA20 ? "回踩MA20(买点)" : aboveMA20 ? "MA20上方运行" : "MA20下方",
      volume: volIncreasing ? "增量" : "平量",
    },
    tactics: "回踩MA20不破加仓至7成, 沿MA20持有, 破MA60止损, 目标前高",
  };
}

/**
 * 小鳄鱼模式 — 打板炸板不跑, 转趋势
 * 特点: 封板失败被炸, 但趋势没坏, 不去追高而是拿趋势
 */
function matchXiaoeyu(klines) {
  if (klines.length < 60) return null;
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);

  // 近期(3日内)有炸板
  const blownUps = detectBlownLimitUps(klines);
  const recentBlown = blownUps.filter(b => b.idx >= klines.length - 4);
  if (recentBlown.length === 0) return null;

  const cur = last(klines);
  const blownDay = recentBlown[recentBlown.length - 1];
  const blownIdx = blownDay.idx;

  // 炸板后走势: 不跌反涨
  const postBlownCloses = closes.slice(blownIdx + 1);
  if (postBlownCloses.length < 2) return null;

  const chgAfterBlown = (last(postBlownCloses) - closes[blownIdx]) / closes[blownIdx];

  // 趋势未坏: MA20仍然上行
  const ma20Before = SMA(closes.slice(0, blownIdx + 1), 20);
  const ma20All = SMA(closes, 20);
  const ma20StillRising = last(ma20All) > last(ma20Before);

  // 炸板后缩量 (换手完毕)
  const volAfterBlown = mean(volumes.slice(blownIdx + 1));
  const volDuringBlown = volumes[blownIdx];
  const volShrinkAfter = volAfterBlown < volDuringBlown * 0.7;

  let score = 0;
  if (chgAfterBlown > 0.02) score += 3; // 炸板后涨了
  else if (chgAfterBlown > -0.02) score += 1; // 至少没跌
  if (ma20StillRising) score += 2;
  if (volShrinkAfter) score += 2;
  if (blownDay.type === "高位换手") score += 1; // 换手板更健康

  if (score < 3) return null;

  return {
    name: "小鳄鱼",
    style: "反包板核心·二板接力",
    match: score >= 6 ? "高" : score >= 3 ? "中" : "低",
    score,
    signals: {
      blownDate: blownDay.date,
      blownType: blownDay.type,
      chgAfterBlown: +(chgAfterBlown * 100).toFixed(1) + "%",
      volAfterBlown: volShrinkAfter ? "缩量(健康)" : "放量(分歧大)",
      ma20Trend: ma20StillRising ? "仍在上行" : "走平/下行",
    },
    tactics: "炸板次日不跌可试仓, 沿MA20持有做波段, 等下一波加速",
  };
}

/**
 * 歌神模式 — 赌基本面拐点, 超长线
 * 特点: 跌了60天以上, 底部放量止跌, 赌业绩拐点
 */
function matchGeShen(klines) {
  if (klines.length < 120) return null;
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  const cur = last(klines);

  // 长期下跌: 120日跌幅>30% 或 距52周高点>35%
  const high120 = Math.max(...highs.slice(-120));
  const drawdown120 = (cur.close - high120) / high120;
  if (drawdown120 > -0.25) return null;

  // 底部特征: 最近20日振幅收窄
  const high20 = Math.max(...highs.slice(-20));
  const low20 = Math.min(...lows.slice(-20));
  const range20 = (high20 - low20) / low20;

  // 底部放量止跌: 近期不再新低 + 放量
  const low60 = Math.min(...lows.slice(-60));
  const low20min = Math.min(...lows.slice(-20));
  const isBottoming = low20min <= low60 * 1.02; // 20日最低点接近60日最低 = 没有继续跌

  const volMA5 = mean(volumes.slice(-5));
  const volMA20 = mean(volumes.slice(-25, -5));
  const volBottomSurge = volMA5 > volMA20 * 1.3;

  // 均线开始粘合 (MA5/MA10/MA20靠拢)
  const ma5 = SMA(closes, 5);
  const ma10 = SMA(closes, 10);
  const ma20arr = SMA(closes, 20);
  const maSpread = last(ma20arr) > 0
    ? Math.max(last(ma5), last(ma10), last(ma20arr)) / Math.min(last(ma5), last(ma10), last(ma20arr)) - 1
    : 1;

  let score = 0;
  if (drawdown120 < -0.40) score += 3; // 跌透了
  else if (drawdown120 < -0.30) score += 2;
  if (range20 < 0.15) score += 2; // 波动收窄=多空平衡
  if (volBottomSurge) score += 2; // 底部放量
  if (maSpread < 0.05) score += 2; // 均线粘合
  if (isBottoming) score += 1;

  if (score < 5) return null;

  return {
    name: "歌神",
    style: "翘板反核·跌停撬板",
    match: score >= 7 ? "高" : score >= 5 ? "中" : "低",
    score,
    signals: {
      drawdown120: +(drawdown120 * 100).toFixed(1) + "%",
      range20: +(range20 * 100).toFixed(1) + "%",
      volBottom: volBottomSurge ? "底部放量" : "平量",
      maSpread: +(maSpread * 100).toFixed(1) + "%",
      isBottoming: isBottoming ? "止跌企稳" : "仍在探底",
    },
    tactics: "分3批建仓: 现价1/3, 新低1/3, 放量突破MA20加至满仓, 目标翻倍",
  };
}

/**
 * 涅槃重升模式 — 板块龙头首板
 * 特点: 最早涨停的, 封单大, 首板非连板, 次日溢价概率高
 */
function matchNiepan(klines) {
  if (klines.length < 20) return null;
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const amounts = klines.map(k => k.amount || k.close * k.volume * 100);

  const cur = last(klines);
  const prevK = prev(klines);

  // 今日/昨日首板
  const prev2IsLU = prev(klines, 2) && isLimitUp(prev(klines, 2).close, prev(klines, 3).close, prev(klines, 2).high);
  const curIsLU = isLimitUp(cur.close, prevK.close, cur.high);
  const isFirstBoard = curIsLU && !(isLimitUp(prevK.close, prev(klines, 2)?.close || prevK.close, prevK.high));

  if (!isFirstBoard) return null;

  // 封板质量
  const bodyRatio = Math.abs(cur.close - cur.open) / (cur.high - cur.low || 1);
  const volMA5 = mean(volumes.slice(-6, -1));
  const volRatio = cur.volume / (volMA5 || 1);

  // 涨停时间判断 (从K线推测: 开盘价接近收盘价 = 早盘封板)
  const openNearClose = Math.abs(cur.open - cur.close) / cur.close < 0.01;
  const highAfterOpen = cur.high / (cur.open || 1);

  let score = 0;
  if (bodyRatio < 0.15) score += 3; // 一字/秒板
  else if (bodyRatio < 0.3) score += 2;
  if (volRatio > 2.5) score += 2; // 封板资金足
  else if (volRatio > 1.5) score += 1;
  if (openNearClose) score += 2; // 开板即封

  if (score < 4) return null;

  return {
    name: "涅槃重升",
    style: "树式心法·情绪周期",
    match: score >= 6 ? "高" : score >= 4 ? "中" : "低",
    score,
    signals: {
      boardDate: cur.date,
      sealType: bodyRatio < 0.1 ? "一字板" : bodyRatio < 0.25 ? "T字板/早盘封" : "换手板",
      volRatio: +volRatio.toFixed(1) + "x均量",
      timing: openNearClose ? "秒封" : "盘中封",
    },
    tactics: "打板买入, 次日开盘溢价2%以上减半, 不涨停全清",
  };
}

/**
 * 北京炒家模式 — 尾盘板, 次日必走
 * 特点: 14:30后涨停, 次日无论盈亏无条件卖出
 */
function matchBeijingChaojia(klines) {
  if (klines.length < 10) return null;
  const cur = last(klines);
  const prevK = prev(klines);

  // 昨日尾盘板: 昨日涨停 + 盘中大部分时间没封(有一定上影线)
  const prevIsLU = isLimitUp(prevK.close, prev(klines, 2)?.close || prevK.close, prevK.high);
  const prevUpperShadow = prevK.high - Math.max(prevK.open, prevK.close);
  const prevLowerShadow = Math.min(prevK.open, prevK.close) - prevK.low;
  const prevRange = prevK.high - prevK.low || 1;
  // 尾盘板的特征: 下影线长(盘中跌过), 上影线短(尾盘封住), 实体占比大
  const isLateSeal = prevIsLU && prevLowerShadow > prevRange * 0.2 && prevUpperShadow < prevRange * 0.1;

  if (!isLateSeal) return null;

  // 今日操作: 卖出信号
  const todayGap = (cur.open - prevK.close) / prevK.close;
  const todayVolRatio = cur.volume / (prevK.volume || 1);

  let score = 3; // 基础分
  if (todayGap > 0.02) score += 2; // 有溢价
  else if (todayGap > 0) score += 1;
  if (todayVolRatio > 0.8) score += 1; // 流动性够

  return {
    name: "北京炒家",
    style: "首板套利·高频复利",
    match: score >= 5 ? "高(溢价明确)" : score >= 3 ? "中(小盈小亏)" : "低",
    score,
    signals: {
      lateSealDate: prevK.date,
      todayGap: +(todayGap * 100).toFixed(1) + "%",
      action: "今日无论盈亏必须卖",
      expectedPL: todayGap > 0.02 ? "+2%以上" : todayGap > 0 ? "小盈" : "小亏(纪律出)",
    },
    tactics: "集合竞价或开盘即卖, 不犹豫, 纪律第一",
  };
}

/**
 * 92科比模式 — 趋势加速段, 不做盘整
 * 特点: MA发散加速, 成交量递增, 斜率变陡
 */
function matchJiuerKobe(klines) {
  if (klines.length < 60) return null;
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);

  const cur = last(klines);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);

  // MA发散: MA5 > MA10 > MA20 > MA60 且间距拉大
  const ma5 = SMA(closes, 5);
  const ma10 = SMA(closes, 10);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);

  const curMA5 = last(ma5), curMA10 = last(ma10);
  const curMA20 = last(ma20), curMA60 = last(ma60);
  const isFanOut = curMA5 > curMA10 && curMA10 > curMA20 && curMA20 > curMA60;

  // 发散加速: 近期的MA间距 > 前期的MA间距 (20日前)
  const spreadNow = (curMA5 - curMA60) / curMA60;
  const spread20 = ma5.length > 20 && ma60.length > 20
    ? (ma5[ma5.length - 21] - ma60[ma60.length - 21]) / ma60[ma60.length - 21]
    : spreadNow;
  const isAccelerating = spreadNow > spread20 * 1.1;

  // 成交量递增: 近5日 > 前5日 > 前前5日
  const vol5 = mean(volumes.slice(-5));
  const vol5_1 = mean(volumes.slice(-10, -5));
  const vol5_2 = mean(volumes.slice(-15, -10));
  const isVolEscalating = vol5 > vol5_1 && vol5_1 > vol5_2;

  // 斜率变陡: 5日涨幅 > 10日平均涨幅
  const chg5 = (cur.close - (closes[closes.length - 6] || closes[0])) / (closes[closes.length - 6] || closes[0]);
  const chg10 = (cur.close - (closes[closes.length - 11] || closes[0])) / (closes[closes.length - 11] || closes[0]);
  const chg5Daily = chg5 / 5;
  const chg10Daily = chg10 / 10;
  const isSteepening = chg5Daily > chg10Daily * 1.3;

  // 不在盘整: 20日振幅 > 15%
  const high20 = Math.max(...highs.slice(-20));
  const low20 = Math.max(...lows.slice(-20));
  const range20 = (high20 - low20) / low20;

  if (!isFanOut) return null;
  if (range20 < 0.15) return null; // 盘整中, 不参与

  let score = 0;
  if (isAccelerating) score += 3;
  if (isVolEscalating) score += 2;
  if (isSteepening) score += 2;
  if (chg5 > 0.1) score += 1;

  if (score < 3) return null;

  return {
    name: "92科比",
    style: "情绪周期·高低切换",
    match: score >= 6 ? "高" : score >= 3 ? "中" : "低",
    score,
    signals: {
      spreadNow: +(spreadNow * 100).toFixed(1) + "%",
      accelerating: isAccelerating ? "加速中" : "匀速",
      volEscalating: isVolEscalating ? "放量递增" : "平量",
      steepening: isSteepening ? "斜率变陡" : "匀速上行",
      range20: +(range20 * 100).toFixed(1) + "%",
    },
    tactics: "沿MA5持有, 跌破MA5减半, 跌破MA10全清, 不参与盘整",
  };
}

/**
 * 综合游资风格匹配
 * 对一只股票检测所有10种游资模式的匹配度
 */
function matchAllStyles(klines) {
  if (klines.length < 60) return { matched: 0, styles: [] };

  const matchers = [
    matchZhangMengzhu,
    matchZhaoLaoge,
    matchYangJia,
    matchZuoshouXinyi,
    matchFangXinxia,
    matchXiaoeyu,
    matchGeShen,
    matchNiepan,
    matchBeijingChaojia,
    matchJiuerKobe,
  ];

  const results = [];
  for (const matcher of matchers) {
    try {
      const result = matcher(klines);
      if (result) results.push(result);
    } catch (e) {
      // skip failed matchers
    }
  }

  // 按匹配分数排序
  results.sort((a, b) => b.score - a.score);

  return {
    matched: results.length,
    topMatch: results.length > 0 ? results[0].name : "无匹配",
    topStyle: results.length > 0 ? results[0].style : "",
    styles: results,
  };
}

module.exports = {
  // 工具
  getLimitPrice,
  isLimitUp,
  isLimitDown,
  isNearLimitUp,

  // 形态识别
  detectConsecutiveLimitUps,
  detectBlownLimitUps,
  detectResealLimitUps,
  detectBottomFishing,
  detectDivergenceToConsensus,
  detectExtremeReversal,

  // 信号
  analyzeEntryExit,

  // 分析
  shortTermAnalysis,
  longTermAnalysis,

  // 扫描
  hotMoneyScan,

  // 游资风格匹配
  matchZhangMengzhu,
  matchZhaoLaoge,
  matchYangJia,
  matchZuoshouXinyi,
  matchFangXinxia,
  matchXiaoeyu,
  matchGeShen,
  matchNiepan,
  matchBeijingChaojia,
  matchJiuerKobe,
  matchAllStyles,
};

// 专业量化资金流向引擎 v3
// 融合东方财富真实数据 + 微观结构分析: VWAP, 订单流失衡, 大单检测

const { mergeFundFlow, aggregateFlow, flowRating } = require("./fundflow");

// ============= VWAP =============

function VWAP(highs, lows, closes, volumes) {
  const typicals = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
  const vwap = [];
  let cumPV = 0, cumVol = 0;
  for (let i = 0; i < closes.length; i++) {
    cumPV += typicals[i] * volumes[i];
    cumVol += volumes[i];
    vwap.push(cumVol > 0 ? cumPV / cumVol : closes[i]);
  }
  return vwap;
}

function VWAPBands(highs, lows, closes, volumes) {
  const typicals = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
  const vwap = VWAP(highs, lows, closes, volumes);
  const upper = [], lower = [];
  let cumVar = 0, cumVol = 0, cumPV = 0;

  for (let i = 0; i < closes.length; i++) {
    cumPV += typicals[i] * volumes[i];
    cumVol += volumes[i];
    const v = cumVol > 0 ? cumPV / cumVol : closes[i];
    const diff = typicals[i] - v;
    cumVar += diff * diff * volumes[i];
    const std = cumVol > 0 ? Math.sqrt(cumVar / cumVol) : 0;
    upper.push(v + 2 * std);
    lower.push(v - 2 * std);
  }
  return { vwap, upper, lower };
}

// ============= 大单检测 =============

function detectLargeOrders(klines) {
  const results = new Array(klines.length).fill(null);
  const volumes = klines.map(k => k.volume);

  for (let i = 20; i < klines.length; i++) {
    const k = klines[i];
    const avgVol = volumes.slice(i - 20, i).reduce((s, v) => s + v, 0) / 20;
    const volRatio = avgVol > 0 ? k.volume / avgVol : 1;
    const range = k.high - k.low || 1;
    const body = Math.abs(k.close - k.open);
    const bodyRatio = body / range;

    let score = 0;
    if (volRatio > 2.5) score += 35;
    else if (volRatio > 1.8) score += 25;
    else if (volRatio > 1.3) score += 12;
    else score += 3;

    if (bodyRatio > 0.7) score += 25;
    else if (bodyRatio > 0.4) score += 12;
    else score += 3;

    const upperWick = (k.high - Math.max(k.open, k.close)) / range;
    const lowerWick = (Math.min(k.open, k.close) - k.low) / range;
    if (upperWick < 0.15 && lowerWick < 0.15) score += 15;
    else if (upperWick < 0.3 || lowerWick < 0.3) score += 8;
    else score += 2;

    const direction = k.close >= k.open ? 1 : -1;
    const mainForce = k.volume * 100 * k.close * (score / 100) * direction;
    const confidence = score >= 60 ? "high" : score >= 30 ? "medium" : "low";

    results[i] = {
      date: k.date,
      score: Math.min(100, score),
      confidence,
      direction: direction > 0 ? "buy" : "sell",
      intensity: volRatio > 2.5 ? "heavy" : volRatio > 1.5 ? "moderate" : "light",
      mainFlow: +mainForce.toFixed(0),
      price: k.close,
      volume: k.volume,
    };
  }
  return results;
}

// ============= 订单流失衡 =============

function orderFlowImbalance(klines, window = 10) {
  const result = new Array(klines.length).fill(null);
  for (let i = window; i < klines.length; i++) {
    let buyPressure = 0, sellPressure = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const k = klines[j];
      const range = k.high - k.low || 1;
      const midPrice = (k.high + k.low) / 2;
      buyPressure += Math.max(0, (k.close - midPrice) / range) * k.volume;
      sellPressure += Math.max(0, (midPrice - k.low) / range) * k.volume;
    }
    const total = buyPressure + sellPressure;
    result[i] = total > 0 ? +((buyPressure - sellPressure) / total * 100).toFixed(2) : 0;
  }
  return result;
}

// ============= 综合资金流向报告 =============

function comprehensiveFlowReport(klines, eastMoneyFlow) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  // 微观结构分析
  const { vwap, upper, lower } = VWAPBands(highs, lows, closes, volumes);
  const ofi = orderFlowImbalance(klines);
  const largeOrders = detectLargeOrders(klines);

  // 融合真实东方财富数据
  const mergedFlow = mergeFundFlow(eastMoneyFlow, klines);
  const recentFlow = aggregateFlow(mergedFlow, 5);
  const flowRatingResult = flowRating(recentFlow);

  // 大单信号汇总
  const recentLO = largeOrders.slice(-20).filter(Boolean);
  const strongSignals = recentLO.filter(l => l.confidence === "high");
  const signalSummary = {
    total: recentLO.length,
    strong: strongSignals.length,
    buyCount: strongSignals.filter(s => s.direction === "buy").length,
    sellCount: strongSignals.filter(s => s.direction === "sell").length,
    signals: strongSignals.slice(-5).reverse(),
  };

  // 综合判断资金方向
  let trendDirection = "neutral";
  let trendStrength = 0;

  // 权重: 真实资金流(60%) + 大单信号(25%) + 订单流失衡(15%)
  const flowSignal = (recentFlow.mainNet || 0) > 0 ? 1 : -1;
  const lotSignal = signalSummary.buyCount > signalSummary.sellCount ? 1 : -1;
  const ofiSignal = (ofi[ofi.length - 1] || 0) > 0 ? 1 : -1;

  const compositeSignal = flowSignal * 0.6 + lotSignal * 0.25 + ofiSignal * 0.15;

  if (compositeSignal > 0.3) {
    trendDirection = "inflow";
    trendStrength = Math.min(100, Math.abs(compositeSignal) * 100);
    if (recentFlow.mainNet > 5e7) trendStrength = 90;
  } else if (compositeSignal < -0.3) {
    trendDirection = "outflow";
    trendStrength = Math.min(100, Math.abs(compositeSignal) * 100);
    if (recentFlow.mainNet < -5e7) trendStrength = 90;
  }

  const flowLabel = trendDirection === "inflow"
    ? (trendStrength > 70 ? "主力大幅流入" : trendStrength > 40 ? "主力持续流入" : "小幅流入")
    : trendDirection === "outflow"
    ? (trendStrength > 70 ? "主力大幅出逃" : trendStrength > 40 ? "主力持续流出" : "小幅流出")
    : "资金均衡";

  return {
    summary: recentFlow,
    flowRating: flowRatingResult,
    flowLabel,
    trendDirection,
    trendStrength,
    compositeSignal: +compositeSignal.toFixed(2),
    signalSummary,
    mergedFlow: mergedFlow.slice(-20),
    indicators: {
      vwap: vwap.slice(-60),
      vwapUpper: upper.slice(-60),
      vwapLower: lower.slice(-60),
      ofi: ofi.slice(-60),
      largeOrders: largeOrders.slice(-60),
    },
    lastVWAP: vwap[vwap.length - 1],
    lastOFI: ofi[ofi.length - 1],
    hasRealData: mergedFlow.some(d => !d.estimated),
  };
}

module.exports = { VWAP, VWAPBands, detectLargeOrders, orderFlowImbalance, comprehensiveFlowReport };

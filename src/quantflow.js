// 专业量化资金流向引擎
// 基于微观结构分析: VWAP, 订单流失衡, 成交量分解, 大单检测

// ============= 核心: 订单流估算 =============

// VWAP — 成交量加权平均价格
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

// VWAP 标准差 (用于上下轨)
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

// ============= 大单/主力检测 =============

// 基于K线特征检测大资金行为
// 大单特征: 放量 + 大实体 + 极端价位
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

    // 大单评分: 0-100 (调低阈值以覆盖更多信号)
    let score = 0;
    if (volRatio > 2.5) score += 35;
    else if (volRatio > 1.8) score += 25;
    else if (volRatio > 1.3) score += 12;
    else score += 3; // 基础分, 正常成交量也有轻微信号

    if (bodyRatio > 0.7) score += 25;
    else if (bodyRatio > 0.4) score += 12;
    else score += 3;

    const upperWick = (k.high - Math.max(k.open, k.close)) / range;
    const lowerWick = (Math.min(k.open, k.close) - k.low) / range;
    if (upperWick < 0.15 && lowerWick < 0.15) score += 15;
    else if (upperWick < 0.3 || lowerWick < 0.3) score += 8;
    else score += 2;

    if (i >= 3) {
      const prevBody = Math.abs(klines[i-1].close - klines[i-1].open);
      if (body > prevBody * 1.5 && Math.sign(k.close - k.open) !== Math.sign(klines[i-1].close - klines[i-1].open)) {
        score += 10;
      }
    }

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

// ============= 实时订单流失衡指标 =============
// 估算买卖压力 (基于最新K线的微观结构)

function orderFlowImbalance(klines, window = 10) {
  const result = new Array(klines.length).fill(null);
  for (let i = window; i < klines.length; i++) {
    let buyPressure = 0, sellPressure = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const k = klines[j];
      const range = k.high - k.low || 1;
      // 买方压力: 收盘高于均价的程度
      const midPrice = (k.high + k.low) / 2;
      const buyPct = (k.close - midPrice) / range;
      // 卖方压力: 均价高于收盘的程度
      const sellPct = (midPrice - k.low) / range;
      const volWeight = k.volume;
      buyPressure += Math.max(0, buyPct) * volWeight;
      sellPressure += Math.max(0, sellPct) * volWeight;
    }
    const total = buyPressure + sellPressure;
    result[i] = total > 0 ? +((buyPressure - sellPressure) / total * 100).toFixed(2) : 0;
  }
  return result;
}

// ============= 综合资金流向报告 =============

function comprehensiveFlowReport(klines) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  // 基础指标
  const { vwap, upper, lower } = VWAPBands(highs, lows, closes, volumes);
  const ofi = orderFlowImbalance(klines);
  const largeOrders = detectLargeOrders(klines);

  // 累计资金流 (分段)
  const flowSegments = { daily: [], weekly: [] };
  const dailyFlow = { main: 0, retail: 0, institution: 0, totalAmount: 0 };

  // 按日聚合
  const dayMap = new Map();
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const day = k.date.slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, []);
    dayMap.get(day).push(i);
  }

  for (const [day, indices] of dayMap) {
    let dayMain = 0, dayRetail = 0, dayInst = 0, dayAmt = 0;
    for (const i of indices) {
      const k = klines[i];
      const amt = k.amount || k.close * k.volume * 100;
      const lo = largeOrders[i];
      const kDir = klines[i].close >= klines[i].open ? 1 : -1;
      const bodyRatio = klines[i].high !== klines[i].low ? Math.abs(kDir) * Math.abs(klines[i].close - klines[i].open) / (klines[i].high - klines[i].low) : 0.3;

      if (lo && lo.score > 0) {
        const mainAmt = amt * (lo.score / 100);
        dayMain += mainAmt * lo.direction;
        if (lo.confidence === "high") {
          dayInst += amt * 0.3 * lo.direction;
        } else if (lo.confidence === "medium") {
          dayInst += amt * 0.15 * kDir;
        }
        // 剩余 → 散户跟风 (方向与主力相同但幅度小)
        const residual = amt - Math.abs(mainAmt) - Math.abs(dayInst || 0);
        dayRetail += residual * kDir * 0.4;
      } else {
        // 弱信号: 根据K线方向分配
        dayMain += amt * 0.05 * kDir;
        dayInst += amt * 0.1 * kDir;
        dayRetail += amt * 0.15 * kDir;
      }
      dayAmt += amt;
    }
    flowSegments.daily.push({
      date: day,
      main: +dayMain.toFixed(0),
      retail: +dayRetail.toFixed(0),
      institution: +dayInst.toFixed(0),
      imbalance: ofi[indices[indices.length - 1]],
      totalAmount: +dayAmt.toFixed(0),
    });
  }

  // 最近5日汇总
  const recent = flowSegments.daily.slice(-5);
  const summary = {
    mainNet: recent.reduce((s, d) => s + (d.main || 0), 0) || 0,
    retailNet: recent.reduce((s, d) => s + (d.retail || 0), 0) || 0,
    institutionNet: recent.reduce((s, d) => s + (d.institution || 0), 0) || 0,
    avgImbalance: recent.length > 0 ? +(recent.reduce((s, d) => s + (d.imbalance || 0), 0) / recent.length).toFixed(2) : 0,
  };

  // 大单信号汇总 (最近20根)
  const recentLO = largeOrders.slice(-20).filter(Boolean);
  const strongSignals = recentLO.filter(l => l.confidence === "high");
  const signalSummary = {
    total: recentLO.length,
    strong: strongSignals.length,
    buyCount: strongSignals.filter(s => s.direction === "buy").length,
    sellCount: strongSignals.filter(s => s.direction === "sell").length,
    signals: strongSignals.slice(-5),
  };

  return {
    summary,
    signalSummary,
    dailyFlow: flowSegments.daily,
    indicators: {
      vwap: vwap.slice(-60),
      vwapUpper: upper.slice(-60),
      vwapLower: lower.slice(-60),
      ofi: ofi.slice(-60),
      largeOrders: largeOrders.slice(-60),
    },
    lastVWAP: vwap[vwap.length - 1],
    lastOFI: ofi[ofi.length - 1],
  };
}

module.exports = { VWAP, VWAPBands, detectLargeOrders, orderFlowImbalance, comprehensiveFlowReport };

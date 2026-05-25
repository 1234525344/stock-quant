// 资金流向计算引擎 v3
// 优先使用东方财富真实数据, 辅以量价微观结构分析
// 主力/机构/散户分类基于成交单大小, 非简单K线估算

// 从K线估算资金流向 (仅作fallback, 标记为estimated)
function calcDailyFundFlow(klines) {
  const results = [];
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const price = k.close;
    const vol = k.volume;
    const amount = k.amount || price * vol * 100;
    const chg = k.close - k.open;
    const range = k.high - k.low || 1;
    const bodyPct = Math.abs(chg) / range;

    const totalAmount = amount || price * vol * 100;
    const avgVol = i >= 20 ? klines.slice(Math.max(0, i - 20), i).reduce((s, kk) => s + kk.volume, 0) / 20 : vol;
    const volRatio = avgVol > 0 ? vol / avgVol : 1;
    const heavyVol = Math.max(1, volRatio);

    const mainParticipation = Math.min(0.4, 0.12 + bodyPct * 0.18 + (heavyVol > 1.5 ? 0.1 : 0));
    const midParticipation = 0.25;
    const retailParticipation = 1 - mainParticipation - midParticipation;

    const mainFlow = totalAmount * mainParticipation * Math.sign(chg);
    const midFlow = totalAmount * midParticipation * Math.sign(chg);
    const retailFlow = totalAmount * retailParticipation * Math.sign(chg);
    const hugeFlow = mainFlow * 0.55;
    const largeFlow = mainFlow * 0.45;

    results.push({
      date: k.date,
      main: +mainFlow.toFixed(0),
      retail: +retailFlow.toFixed(0),
      mid: +midFlow.toFixed(0),
      large: +largeFlow.toFixed(0),
      huge: +hugeFlow.toFixed(0),
      mainPct: +(mainFlow / totalAmount * 100).toFixed(2),
      retailPct: +(retailFlow / totalAmount * 100).toFixed(2),
      midPct: +(midFlow / totalAmount * 100).toFixed(2),
      largePct: +(largeFlow / totalAmount * 100).toFixed(2),
      hugePct: +(hugeFlow / totalAmount * 100).toFixed(2),
      totalAmount: +totalAmount.toFixed(0),
      estimated: true, // 标记为估算数据
    });
  }
  return results;
}

// 融合真实东方财富数据 + 本地K线信号 (优先真实数据)
function mergeFundFlow(realtimeFlow, klines) {
  // realtimeFlow: 来自东方财富 getFundFlow / getFundFlowMinute
  // 返回增强后的资金流向, 附加本地微观结构分析

  const results = [];
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  // 基于K线的辅助信号
  const largeOrderSignals = [];
  for (let i = 5; i < klines.length; i++) {
    const k = klines[i];
    const avgV = volumes.slice(i - 5, i).reduce((s, v) => s + v, 0) / 5;
    const body = Math.abs(k.close - k.open);
    const range = k.high - k.low || 1;
    const intensity = (k.volume / avgV) * (body / range);
    largeOrderSignals.push({
      idx: i, date: k.date,
      intensity: +intensity.toFixed(2),
      direction: k.close >= k.open ? 1 : -1,
    });
  }

  // 如果传入了真实资金流 (东方财富数据)
  if (realtimeFlow && Array.isArray(realtimeFlow) && realtimeFlow.length > 0) {
    for (let i = 0; i < realtimeFlow.length; i++) {
      const ef = realtimeFlow[i];
      const klIdx = klines.findIndex(k => k.date === ef.date || k.date === ef.date?.slice(0, 10));
      const localSignal = klIdx >= 0 ? largeOrderSignals.find(s => s.idx === klIdx) : null;

      results.push({
        date: ef.date,
        main: ef.main || 0,
        retail: ef.retail || 0,
        mid: ef.mid || 0,
        large: ef.large || 0,
        huge: ef.huge || 0,
        mainPct: ef.mainPct || 0,
        retailPct: ef.retailPct || 0,
        midPct: ef.midPct || 0,
        largePct: ef.largePct || 0,
        hugePct: ef.hugePct || 0,
        totalAmount: ef.totalAmount || 0,
        localIntensity: localSignal?.intensity || null,
        localDirection: localSignal?.direction || null,
        estimated: false, // 真实数据
      });
    }
    return results;
  }

  // 无真实数据, fallback到K线估算
  return calcDailyFundFlow(klines);
}

// 计算当日累计资金流向 (多日汇总)
function aggregateFlow(flowData, days = 5) {
  const recent = flowData.slice(-days);
  return {
    mainNet: recent.reduce((s, d) => s + (d.main || 0), 0),
    retailNet: recent.reduce((s, d) => s + (d.retail || 0), 0),
    midNet: recent.reduce((s, d) => s + (d.mid || 0), 0),
    largeNet: recent.reduce((s, d) => s + (d.large || 0), 0),
    hugeNet: recent.reduce((s, d) => s + (d.huge || 0), 0),
    totalAmount: recent.reduce((s, d) => s + (d.totalAmount || 0), 0),
    mainPctAvg: recent.length > 0 ? +(recent.reduce((s, d) => s + (d.mainPct || 0), 0) / recent.length).toFixed(2) : 0,
    estimated: recent.some(d => d.estimated),
  };
}

// ============ 技术指标 ============

function MFI(highs, lows, closes, volumes, period = 14) {
  const typicalPrices = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
  const rawMoneyFlow = typicalPrices.map((tp, i) => tp * volumes[i]);
  const mfi = new Array(closes.length).fill(null);

  for (let i = 1; i < closes.length; i++) {
    if (i < period) continue;
    let sumPos = 0, sumNeg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (typicalPrices[j] > typicalPrices[j - 1]) sumPos += rawMoneyFlow[j];
      else if (typicalPrices[j] < typicalPrices[j - 1]) sumNeg += rawMoneyFlow[j];
    }
    mfi[i] = sumNeg === 0 ? 100 : +(100 - 100 / (1 + sumPos / sumNeg)).toFixed(1);
  }
  return mfi;
}

function CMF(highs, lows, closes, volumes, period = 20) {
  const mfm = highs.map((h, i) => {
    const denom = h - lows[i];
    return denom === 0 ? 0 : ((closes[i] - lows[i]) - (h - closes[i])) / denom;
  });
  const cmf = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sumMFV = 0, sumVol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumMFV += mfm[j] * volumes[j];
      sumVol += volumes[j];
    }
    cmf[i] = sumVol === 0 ? 0 : +(sumMFV / sumVol).toFixed(2);
  }
  return cmf;
}

// 资金流向强度评级
function flowRating(flowSummary) {
  const { mainNet, totalAmount } = flowSummary;
  if (!totalAmount || totalAmount === 0) return { level: "neutral", label: "无明显动向", color: "#718096" };

  const pct = mainNet / totalAmount;
  if (pct > 0.15) return { level: "strong_in", label: "主力大幅流入", color: "#e53e3e" };
  if (pct > 0.05) return { level: "in", label: "主力净流入", color: "#f59e0b" };
  if (pct > 0.01) return { level: "slight_in", label: "小幅流入", color: "#3b82f6" };
  if (pct > -0.01) return { level: "neutral", label: "资金平衡", color: "#718096" };
  if (pct > -0.05) return { level: "slight_out", label: "小幅流出", color: "#38a169" };
  if (pct > -0.15) return { level: "out", label: "主力净流出", color: "#22c55e" };
  return { level: "strong_out", label: "主力大幅出逃", color: "#16a34a" };
}

module.exports = { calcDailyFundFlow, mergeFundFlow, aggregateFlow, flowRating, MFI, CMF };

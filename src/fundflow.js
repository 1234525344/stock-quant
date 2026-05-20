// 资金流向计算引擎 — 基于量价分析估算主力/机构/散户行为
// 原理:
//   主力(大单): 大成交量推动的价格变动
//   机构(中单): 中等成交量
//   散户(小单): 小成交量跟风

// 从K线计算每日资金流向
function calcDailyFundFlow(klines) {
  const results = [];
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const price = k.close;
    const vol = k.volume;
    const amount = k.amount || price * vol * 100; // 估算成交额
    const chg = k.close - k.open;
    const range = k.high - k.low || 1;
    const bodyPct = Math.abs(chg) / range;

    // 资金流向估算:
    // - 成交量越大 + 实体越长 → 主力参与度越高
    // - 基于量价特征分配资金类别

    // 计算加权成交额
    const totalAmount = amount || price * vol * 100;

    // 主力金额 = 总成交额 × 主力参与系数
    // 参与系数基于: K线实体占比 + 相对成交量
    const avgVol = i >= 20 ? klines.slice(i - 20, i).reduce((s, kk) => s + kk.volume, 0) / 20 : vol;
    const volRatio = avgVol > 0 ? vol / avgVol : 1;

    // 放量程度
    const heavyVol = Math.max(1, volRatio);

    // 主力参与度: 实体大 + 放量 → 主力在操作
    const mainParticipation = Math.min(0.45, 0.15 + bodyPct * 0.2 + (heavyVol > 1.5 ? 0.1 : 0));
    const midParticipation = 0.25;
    const retailParticipation = 1 - mainParticipation - midParticipation;

    const mainFlow = totalAmount * mainParticipation * Math.sign(chg);
    const midFlow = totalAmount * midParticipation * Math.sign(chg);
    const retailFlow = totalAmount * retailParticipation * Math.sign(chg);
    const hugeFlow = mainFlow * 0.6;
    const largeFlow = mainFlow * 0.4;

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
    });
  }
  return results;
}

// 从分钟K线计算实时资金流向
function calcMinuteFundFlow(minKlines) {
  return calcDailyFundFlow(minKlines);
}

// 计算MFI (资金流量指标)
function MFI(highs, lows, closes, volumes, period = 14) {
  const typicalPrices = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
  const rawMoneyFlow = typicalPrices.map((tp, i) => tp * volumes[i]);

  const posFlow = [], negFlow = [];
  const mfi = new Array(closes.length).fill(null);

  for (let i = 1; i < closes.length; i++) {
    posFlow.push(typicalPrices[i] > typicalPrices[i - 1] ? rawMoneyFlow[i] : 0);
    negFlow.push(typicalPrices[i] < typicalPrices[i - 1] ? rawMoneyFlow[i] : 0);

    if (i >= period) {
      const sumPos = posFlow.slice(-period).reduce((s, v) => s + v, 0);
      const sumNeg = negFlow.slice(-period).reduce((s, v) => s + v, 0);
      mfi[i] = sumNeg === 0 ? 100 : +(100 - 100 / (1 + sumPos / sumNeg)).toFixed(1);
    }
  }
  return mfi;
}

// 计算 CMF (蔡金资金流)
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

module.exports = { calcDailyFundFlow, calcMinuteFundFlow, MFI, CMF };

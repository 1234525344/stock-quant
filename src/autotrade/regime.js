// 市场状态识别 — 自适应策略切换
// 识别 Bull(牛市) / Bear(熊市) / Range(震荡) / Volatile(高波) 四种状态
const { SMA } = require("../indicators");

const REGIMES = {
  BULL: "bull",
  BEAR: "bear",
  RANGE: "range",
  VOLATILE: "volatile",
};

function detectRegime(klines, indexKlines = []) {
  if (klines.length < 60) return { regime: REGIMES.RANGE, confidence: 0, details: {} };

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const last = closes.length - 1;

  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);

  // 1. 趋势强度 (MA20 斜率)
  const ma20Slope = ma20[last] && ma20[last - 20]
    ? (ma20[last] - ma20[last - 20]) / ma20[last - 20]
    : 0;

  // 2. 价格位置 vs MA60
  const priceVsMA60 = ma60[last] ? closes[last] / ma60[last] - 1 : 0;

  // 3. 波动率 (20日)
  const rets = [];
  for (let i = last - 20; i <= last; i++) {
    if (closes[i - 1] > 0) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const volatility = Math.sqrt(rets.reduce((s, r) => s + r ** 2, 0) / rets.length) * Math.sqrt(252);

  // 4. 成交量趋势
  const avgVol20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const avgVol60 = volumes.slice(-61, -1).reduce((a, b) => a + b, 0) / 60;
  const volTrend = avgVol20 / (avgVol60 || 1);

  // 判定
  let regime, confidence;

  if (volatility > 0.45) {
    regime = REGIMES.VOLATILE;
    confidence = Math.min(90, 50 + volatility * 50);
  } else if (ma20Slope > 0.02 && priceVsMA60 > -0.05) {
    regime = REGIMES.BULL;
    confidence = Math.min(90, 40 + ma20Slope * 300 + (priceVsMA60 > 0 ? 20 : 0));
  } else if (ma20Slope < -0.02 && priceVsMA60 < 0.05) {
    regime = REGIMES.BEAR;
    confidence = Math.min(90, 40 + Math.abs(ma20Slope) * 300 + (priceVsMA60 < 0 ? 20 : 0));
  } else {
    regime = REGIMES.RANGE;
    confidence = Math.min(80, 30 + Math.abs(priceVsMA60 < 0.03 && priceVsMA60 > -0.03 ? 40 : 10));
  }

  return {
    regime,
    confidence: +confidence.toFixed(1),
    details: {
      ma20Slope: +(ma20Slope * 100).toFixed(2),
      priceVsMA60: +(priceVsMA60 * 100).toFixed(1),
      volatility: +volatility.toFixed(2),
      volTrend: +volTrend.toFixed(2),
    },
    suggestedStrategy: getSuggestedStrategy(regime),
  };
}

function getSuggestedStrategy(regime) {
  switch (regime) {
    case REGIMES.BULL: return "signal_follow";
    case REGIMES.BEAR: return "hold_cash";
    case REGIMES.RANGE: return "grid";
    case REGIMES.VOLATILE: return "reduce_position";
    default: return "signal_follow";
  }
}

module.exports = { detectRegime, getSuggestedStrategy, REGIMES };

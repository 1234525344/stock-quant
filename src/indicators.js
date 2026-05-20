// 技术指标计算引擎

// SMA — 简单移动平均
function SMA(data, period) {
  const result = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j];
    result[i] = sum / period;
  }
  return result;
}

// EMA — 指数移动平均
function EMA(data, period) {
  const result = new Array(data.length).fill(null);
  const k = 2 / (period + 1);
  let ema = data[0];
  result[0] = ema;
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

// MACD
function MACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = EMA(closes, fast);
  const emaSlow = EMA(closes, slow);
  const dif = emaFast.map((v, i) => v != null && emaSlow[i] != null ? v - emaSlow[i] : null);
  const validDifs = dif.filter(v => v != null);
  const deaRaw = EMA(validDifs, signal);
  const dea = new Array(dif.length).fill(null);
  const macd = new Array(dif.length).fill(null);
  let offset = dif.findIndex(v => v != null) + signal - 1;
  for (let i = 0; i < deaRaw.length; i++) {
    const idx = offset + i;
    if (idx < dea.length) {
      dea[idx] = deaRaw[i];
      macd[idx] = (dif[idx] - dea[idx]) * 2;
    }
  }
  return { dif, dea, macd };
}

// RSI — 相对强弱指标
function RSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (i <= period) {
      avgGain += Math.max(diff, 0);
      avgLoss += Math.max(-diff, 0);
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
      result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return result;
}

// KDJ
function KDJ(highs, lows, closes, n = 9) {
  const k = new Array(closes.length).fill(null);
  const d = new Array(closes.length).fill(null);
  const j = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    const sliceH = highs.slice(i - n + 1, i + 1);
    const sliceL = lows.slice(i - n + 1, i + 1);
    const hh = Math.max(...sliceH);
    const ll = Math.min(...sliceL);
    const rsv = ((closes[i] - ll) / (hh - ll)) * 100 || 50;
    k[i] = i === n - 1 ? 50 : (2 / 3) * k[i - 1] + (1 / 3) * rsv;
    d[i] = i === n - 1 ? 50 : (2 / 3) * d[i - 1] + (1 / 3) * k[i];
    j[i] = 3 * k[i] - 2 * d[i];
  }
  return { k, d, j };
}

// BOLL — 布林带
function BOLL(closes, period = 20, multiplier = 2) {
  const mid = SMA(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = mid[i];
    const variance = slice.reduce((s, v) => s + (v - avg) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper[i] = avg + multiplier * std;
    lower[i] = avg - multiplier * std;
  }
  return { mid, upper, lower };
}

// ATR — 平均真实波幅
function ATR(highs, lows, closes, period = 14) {
  const tr = [null];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  const atr = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 1; i < tr.length; i++) {
    if (i <= period) {
      sum += tr[i];
      if (i === period) atr[i] = sum / period;
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
  }
  return atr;
}

// WR — 威廉指标
function WR(highs, lows, closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    result[i] = ((hh - closes[i]) / (hh - ll)) * -100;
  }
  return result;
}

// OBV — 能量潮
function OBV(closes, volumes) {
  const result = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) result.push(result[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) result.push(result[i - 1] - volumes[i]);
    else result.push(result[i - 1]);
  }
  return result;
}

// 均线金叉死叉信号
function crossSignal(maFast, maSlow) {
  const signals = new Array(maFast.length).fill(0);
  for (let i = 1; i < maFast.length; i++) {
    if (maFast[i] == null || maSlow[i] == null || maFast[i - 1] == null || maSlow[i - 1] == null) continue;
    if (maFast[i] > maSlow[i] && maFast[i - 1] <= maSlow[i - 1]) signals[i] = 1;   // 金叉
    if (maFast[i] < maSlow[i] && maFast[i - 1] >= maSlow[i - 1]) signals[i] = -1;  // 死叉
  }
  return signals;
}

module.exports = { SMA, EMA, MACD, RSI, KDJ, BOLL, ATR, WR, OBV, crossSignal };

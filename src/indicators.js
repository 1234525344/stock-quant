/**
 * 技术指标计算引擎 — SMA/EMA/MACD/RSI/BOLL/KDJ/ATR/OBV
 */

/**
 * 简单移动平均 — 滑动窗口 O(n)
 * @param {number[]} data — 价格序列
 * @param {number} period — 周期
 * @returns {(number|null)[]} 等长数组，前 period-1 位为 null
 */
function SMA(data, period) {
  const result = new Array(data.length).fill(null);
  if (data.length < period) return result;
  // 初始化窗口和
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result[period - 1] = sum / period;
  // 滑动窗口: 加新值, 减旧值
  for (let i = period; i < data.length; i++) {
    sum += data[i] - data[i - period];
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

// SAR — 抛物转向 (停损点)
function SAR(highs, lows, afStep = 0.02, afMax = 0.2) {
  const result = new Array(highs.length).fill(null);
  let isUp = true;
  let af = afStep;
  let ep = highs[0];
  let sar = lows[0];

  for (let i = 1; i < highs.length; i++) {
    result[i] = +sar.toFixed(2);
    if (isUp) {
      sar += af * (ep - sar);
      if (lows[i] < sar) { isUp = false; af = afStep; sar = ep; ep = lows[i]; }
      else { if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + afStep, afMax); } }
    } else {
      sar += af * (ep - sar);
      if (highs[i] > sar) { isUp = true; af = afStep; sar = ep; ep = highs[i]; }
      else { if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + afStep, afMax); } }
    }
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

// ==================== 增量计算函数 ====================
// 用于实时引擎: 只计算最新一根K线，大幅降低CPU

function SMA_incremental(prevSMA, prevWindow, newVal, period) {
  if (!prevWindow || prevWindow.length < period) return null;
  const sum = prevWindow.reduce((a, b) => a + b, 0) - prevWindow[0] + newVal;
  return sum / period;
}

function EMA_incremental(prevEMA, newVal, period) {
  if (prevEMA == null || isNaN(prevEMA)) return newVal;
  const k = 2 / (period + 1);
  return newVal * k + prevEMA * (1 - k);
}

// IndicatorBuffer — 轻量滑动窗口,避免每次构建数组切片
class IndicatorBuffer {
  constructor(maxSize = 60) {
    this.maxSize = maxSize;
    this.closes = [];
    this.highs = [];
    this.lows = [];
    this.volumes = [];
    this.opens = [];
  }

  size() { return this.closes.length; }

  push(kline) {
    this.closes.push(kline.close !== undefined ? kline.close : kline.price);
    this.highs.push(kline.high || this.closes[this.closes.length - 1]);
    this.lows.push(kline.low || this.closes[this.closes.length - 1]);
    this.volumes.push(kline.volume || 0);
    this.opens.push(kline.open || this.closes[this.closes.length - 1]);

    while (this.closes.length > this.maxSize) {
      this.closes.shift(); this.highs.shift(); this.lows.shift();
      this.volumes.shift(); this.opens.shift();
    }
  }

  warmup(klines) {
    for (const k of klines) this.push(k);
  }

  toArrays() {
    return {
      closes: [...this.closes],
      highs: [...this.highs],
      lows: [...this.lows],
      volumes: [...this.volumes],
      opens: [...this.opens],
    };
  }
}

// calcReturns — 多周期收益率
function calcReturns(closes) {
  const rets = {};
  const i = closes.length - 1;
  if (i < 20) return rets;
  const periods = { d5: 5, d10: 10, d20: 20 };
  for (const [k, n] of Object.entries(periods)) {
    rets[k] = (i >= n && closes[i - n] > 0)
      ? +((closes[i] - closes[i - n]) / closes[i - n] * 100).toFixed(2)
      : 0;
  }
  return rets;
}

// calcVolatility — 20日年化波动率
function calcVolatility(closes) {
  const i = closes.length - 1;
  if (i < 20) return 0;
  const rets = [];
  for (let t = i - 19; t <= i; t++) {
    rets.push(closes[t - 1] > 0 ? (closes[t] - closes[t - 1]) / closes[t - 1] : 0);
  }
  const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
  return +(Math.sqrt(rets.reduce((s, r) => s + (r - avg) ** 2, 0) / rets.length) * 100 * Math.sqrt(252)).toFixed(1);
}

module.exports = { SMA, EMA, MACD, RSI, KDJ, BOLL, ATR, WR, OBV, SAR, crossSignal, SMA_incremental, EMA_incremental, IndicatorBuffer, calcReturns, calcVolatility };

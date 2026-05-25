// 回测引擎 + 策略框架
const { SMA, EMA, MACD, RSI, KDJ, BOLL, ATR, WR, OBV, crossSignal } = require("./indicators");

// 手续费率
const COMMISSION_BUY = 0.00025 + 0.00001;
const COMMISSION_SELL = 0.00025 + 0.0005 + 0.00001;

// ============ 自定义策略解析引擎 ============
const INDICATOR_NAMES = {
  ma_cross: "均线交叉", macd_cross: "MACD交叉", rsi_level: "RSI水平",
  boll_touch: "布林带突破", price_vs_ma: "价格穿均线", kdj_cross: "KDJ交叉",
  volume_spike: "成交量异动",
};

function parseCustomStrategy(config) {
  const conditions = config.conditions || [];
  const logic = config.logic || "AND";

  return function(closes, highs, lows, volumes, opens, dates) {
    const n = closes.length;
    const signals = new Array(n).fill(0);
    const signalScores = new Array(n).fill(0);

    const indicators = {};
    for (const cond of conditions) {
      const p = cond.params || {};
      const key = `${cond.type}_${cond.id}`;
      switch (cond.type) {
        case "ma_cross":
          indicators[key] = { fast: SMA(closes, p.fast || 5), slow: SMA(closes, p.slow || 20) };
          break;
        case "macd_cross":
          indicators[key] = MACD(closes, p.fast || 12, p.slow || 26, p.signal || 9);
          break;
        case "rsi_level":
          indicators[key] = { rsi: RSI(closes, p.period || 14) };
          break;
        case "boll_touch":
          indicators[key] = BOLL(closes, p.period || 20, p.multiplier || 2);
          break;
        case "price_vs_ma":
          indicators[key] = { ma: SMA(closes, p.period || 60) };
          break;
        case "kdj_cross":
          indicators[key] = KDJ(highs, lows, closes, p.period || 9);
          break;
        case "volume_spike":
          indicators[key] = { volMa: SMA(volumes, p.period || 20) };
          break;
        case "atr_breakout":
          indicators[key] = { atr: ATR(highs, lows, closes, p.period || 14) };
          break;
      }
    }

    for (let i = 1; i < n; i++) {
      let totalScore = 0, conditionsMet = 0;
      const totalConditions = conditions.length;
      for (const cond of conditions) {
        const ind = indicators[`${cond.type}_${cond.id}`];
        if (!ind) continue;
        const dir = cond.direction || "buy";
        const weight = cond.weight || 1;
        let condScore = 0;
        const p = cond.params || {};

        switch (cond.type) {
          case "ma_cross":
            if (ind.fast[i] == null || ind.slow[i] == null || ind.fast[i-1] == null || ind.slow[i-1] == null) break;
            if (ind.fast[i] > ind.slow[i] && ind.fast[i-1] <= ind.slow[i-1]) condScore = 1;
            if (ind.fast[i] < ind.slow[i] && ind.fast[i-1] >= ind.slow[i-1]) condScore = -1;
            break;
          case "macd_cross":
            if (ind.dif[i] == null || ind.dea[i] == null || ind.dif[i-1] == null || ind.dea[i-1] == null) break;
            if (ind.dif[i] > ind.dea[i] && ind.dif[i-1] <= ind.dea[i-1]) condScore = 1;
            if (ind.dif[i] < ind.dea[i] && ind.dif[i-1] >= ind.dea[i-1]) condScore = -1;
            break;
          case "rsi_level":
            if (ind.rsi[i] == null) break;
            if (dir === "buy" && ind.rsi[i] < (p.oversold || 30) && ind.rsi[i-1] >= (p.oversold || 30)) condScore = 1;
            if (dir === "sell" && ind.rsi[i] > (p.overbought || 70) && ind.rsi[i-1] <= (p.overbought || 70)) condScore = -1;
            break;
          case "boll_touch":
            if (ind.lower[i] == null || ind.upper[i] == null) break;
            if (closes[i] > ind.lower[i] && closes[i-1] <= ind.lower[i-1]) condScore = 1;
            if (closes[i] < ind.upper[i] && closes[i-1] >= ind.upper[i-1]) condScore = -1;
            break;
          case "price_vs_ma":
            if (ind.ma[i] == null || ind.ma[i-1] == null) break;
            if (closes[i] > ind.ma[i] && closes[i-1] <= ind.ma[i-1]) condScore = 1;
            if (closes[i] < ind.ma[i] && closes[i-1] >= ind.ma[i-1]) condScore = -1;
            break;
          case "kdj_cross":
            if (ind.k[i] == null || ind.d[i] == null || ind.k[i-1] == null || ind.d[i-1] == null) break;
            if (ind.k[i] > ind.d[i] && ind.k[i-1] <= ind.d[i-1] && ind.k[i] < 30) condScore = 1;
            if (ind.k[i] < ind.d[i] && ind.k[i-1] >= ind.d[i-1] && ind.k[i] > 70) condScore = -1;
            break;
          case "volume_spike":
            if (ind.volMa[i] == null) break;
            const ratio = volumes[i] / Math.max(1, ind.volMa[i]);
            if (ratio > (p.threshold || 1.5) && closes[i] > closes[i-1]) condScore = 1;
            if (ratio > (p.threshold || 1.5) && closes[i] < closes[i-1]) condScore = -1;
            break;
        }

        if (dir === "sell") condScore = -condScore;
        totalScore += condScore * weight;
        if (condScore !== 0) conditionsMet++;
      }
      signalScores[i] = totalScore;
      if (logic === "AND" && conditionsMet === totalConditions && totalConditions > 0) {
        signals[i] = totalScore > 0 ? 1 : totalScore < 0 ? -1 : 0;
      } else if (logic === "OR") {
        if (totalScore > 0) signals[i] = 1;
        else if (totalScore < 0) signals[i] = -1;
      } else { // VOTE
        const threshold = config.voteThreshold || 0.5;
        const totalWeight = conditions.reduce((s, c) => s + (c.weight || 1), 0);
        if (totalWeight > 0 && Math.abs(totalScore) / totalWeight >= threshold) {
          signals[i] = totalScore > 0 ? 1 : -1;
        }
      }
    }
    return { signals, signalScores };
  };
}

// ============ 回测引擎 ============
function backtest(klines, strategyInput, initialCapital = 100000) {
  const { opens, highs, lows, closes, volumes, dates } = klines;

  let signals, signalScores;
  if (typeof strategyInput === "function") {
    const result = strategyInput(closes, highs, lows, volumes, opens, dates);
    if (Array.isArray(result)) { signals = result; }
    else { signals = result.signals; signalScores = result.signalScores; }
  } else if (strategyInput && strategyInput.signals) {
    signals = strategyInput.signals;
    signalScores = strategyInput.signalScores;
  } else {
    signals = strategyInput || [];
  }

  if (!signals || !signals.length) return { error: "无法生成交易信号" };

  let capital = initialCapital;
  let position = 0, entryPrice = 0, entryIdx = -1;
  const trades = [];
  const equityCurve = [];
  let totalCommission = 0;

  // 收集信号点用于图表标记
  const signalPoints = [];
  for (let i = 0; i < signals.length; i++) {
    if (signals[i] === 1) signalPoints.push({ idx: i, date: dates[i], type: "buy", price: closes[i] });
    else if (signals[i] === -1) signalPoints.push({ idx: i, date: dates[i], type: "sell", price: closes[i] });
  }

  for (let i = 0; i < closes.length; i++) {
    const sig = signals[i];
    const price = closes[i];

    // 买入信号
    if (sig === 1 && position === 0) {
      position = Math.floor(capital / price);
      if (position === 0) continue;
      entryPrice = price;
      entryIdx = i;
      const cost = position * price;
      const comm = cost * COMMISSION_BUY;
      capital -= cost + comm;
      totalCommission += comm;
    }
    // 卖出信号
    else if (sig === -1 && position > 0) {
      const proceeds = position * price;
      const comm = proceeds * COMMISSION_SELL;
      totalCommission += comm;
      const rawPnl = proceeds - position * entryPrice;
      const pnl = rawPnl - comm;
      const pnlPct = +((pnl / (position * entryPrice)) * 100).toFixed(2);
      capital += proceeds - comm;
      trades.push({
        entryDate: dates[entryIdx],
        exitDate: dates[i],
        entryIdx, exitIdx: i,
        entryPrice,
        exitPrice: price,
        shares: position,
        pnlPct,
        pnl: +pnl.toFixed(2),
        holdDays: i - entryIdx,
      });
      position = 0; entryIdx = -1;
    }

    equityCurve.push({
      date: dates[i],
      equity: +(capital + position * price).toFixed(2),
      position,
    });
  }

  // 强制平仓
  if (position > 0) {
    const lastPrice = closes[closes.length - 1];
    const proceeds = position * lastPrice;
    const comm = proceeds * COMMISSION_SELL;
    totalCommission += comm;
    capital += proceeds - comm;
    trades.push({
      entryDate: dates[entryIdx],
      exitDate: dates[dates.length - 1],
      entryIdx, exitIdx: closes.length - 1,
      entryPrice,
      exitPrice: lastPrice,
      shares: position,
      pnlPct: +(((lastPrice - entryPrice) / entryPrice) * 100).toFixed(2),
      pnl: +((lastPrice - entryPrice) * position - comm).toFixed(2),
      holdDays: closes.length - 1 - entryIdx,
    });
  }

  const finalEquity = equityCurve[equityCurve.length - 1]?.equity || capital;
  const totalReturn = +(((finalEquity - initialCapital) / initialCapital) * 100).toFixed(2);
  const winTrades = trades.filter(t => t.pnlPct > 0);
  const loseTrades = trades.filter(t => t.pnlPct <= 0);

  // 最大回撤
  let maxDrawdown = 0, peak = equityCurve[0]?.equity || initialCapital;
  let ddStart = dates[0], ddEnd = dates[0];
  let peakIdx = 0, troughIdx = 0;
  for (let i = 0; i < equityCurve.length; i++) {
    const pt = equityCurve[i];
    if (pt.equity > peak) { peak = pt.equity; peakIdx = i; }
    const dd = (peak - pt.equity) / peak * 100;
    if (dd > maxDrawdown) { maxDrawdown = dd; ddStart = dates[peakIdx]; ddEnd = pt.date; troughIdx = i; }
  }

  // 每日收益率
  const dailyReturns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const r = (equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity;
    dailyReturns.push({ date: equityCurve[i].date, ret: r });
  }

  // 夏普比率
  const avgDR = dailyReturns.reduce((s, r) => s + r.ret, 0) / dailyReturns.length;
  const stdDR = Math.sqrt(dailyReturns.reduce((s, r) => s + (r.ret - avgDR) ** 2, 0) / dailyReturns.length);
  const sharpe = stdDR > 0 ? +(avgDR / stdDR * Math.sqrt(252)).toFixed(2) : 0;

  // Calmar比率
  const calmar = maxDrawdown > 0 ? +(totalReturn / maxDrawdown).toFixed(2) : 0;

  // 年化收益率
  const years = equityCurve.length / 252;
  const annualReturn = years > 0 ? +(((finalEquity / initialCapital) ** (1 / years) - 1) * 100).toFixed(2) : 0;

  return {
    initialCapital, finalEquity: +finalEquity.toFixed(2),
    totalReturn, annualReturn, maxDrawdown: +maxDrawdown.toFixed(2),
    sharpe, calmar,
    totalTrades: trades.length,
    winRate: trades.length > 0 ? +((winTrades.length / trades.length) * 100).toFixed(2) : 0,
    avgPnl: trades.length > 0 ? +(trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length).toFixed(2) : 0,
    avgWin: winTrades.length > 0 ? +(winTrades.reduce((s, t) => s + t.pnlPct, 0) / winTrades.length).toFixed(2) : 0,
    avgLoss: loseTrades.length > 0 ? +(loseTrades.reduce((s, t) => s + t.pnlPct, 0) / loseTrades.length).toFixed(2) : 0,
    maxWin: winTrades.length > 0 ? +Math.max(...winTrades.map(t => t.pnlPct)).toFixed(2) : 0,
    maxLoss: loseTrades.length > 0 ? +Math.min(...loseTrades.map(t => t.pnlPct)).toFixed(2) : 0,
    avgHoldDays: trades.length > 0 ? +(trades.reduce((s, t) => s + (t.holdDays || 0), 0) / trades.length).toFixed(0) : 0,
    totalCommission: +totalCommission.toFixed(2),
    ddStart, ddEnd, ddPeakIdx: peakIdx, ddTroughIdx: troughIdx,
    signalPoints,
    trades,
    equityCurve,
    dailyReturns,
  };
}

// ============ 内置策略 ============

function maCrossStrategy(closes, highs, lows, volumes, opens, dates) {
  return crossSignal(SMA(closes, 5), SMA(closes, 20));
}

function macdStrategy(closes) {
  const { dif, dea } = MACD(closes);
  return crossSignal(dif, dea);
}

function rsiStrategy(closes) {
  const rsi = RSI(closes, 14);
  const signals = new Array(closes.length).fill(0);
  for (let i = 1; i < rsi.length; i++) {
    if (rsi[i] == null || rsi[i - 1] == null) continue;
    if (rsi[i] > 30 && rsi[i - 1] <= 30) signals[i] = 1;
    if (rsi[i] < 70 && rsi[i - 1] >= 70) signals[i] = -1;
  }
  return signals;
}

function bollStrategy(closes) {
  const { mid, upper, lower } = BOLL(closes, 20, 2);
  const signals = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    if (lower[i] == null || upper[i] == null) continue;
    if (closes[i] > lower[i] && closes[i - 1] <= lower[i - 1]) signals[i] = 1;
    if (closes[i] < upper[i] && closes[i - 1] >= upper[i - 1]) signals[i] = -1;
  }
  return signals;
}

function multiFactorStrategy(closes, highs, lows, volumes) {
  const maSig = maCrossStrategy(closes, highs, lows, volumes);
  const macdSig = macdStrategy(closes);
  const rsiSig = rsiStrategy(closes);
  const signals = new Array(closes.length).fill(0);
  for (let i = 0; i < closes.length; i++) {
    const score = (maSig[i] || 0) + (macdSig[i] || 0) * 1.5 + (rsiSig[i] || 0);
    if (score >= 2) signals[i] = 1;
    else if (score <= -2) signals[i] = -1;
  }
  return signals;
}

// 新增: 趋势跟踪策略 (MA多头排列 + MACD确认)
function trendFollowingStrategy(closes) {
  const ma5 = SMA(closes, 5);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);
  const { dif, dea } = MACD(closes);
  const signals = new Array(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    if (ma5[i] == null || ma20[i] == null || ma60[i] == null || dif[i] == null || dea[i] == null) continue;
    const bullAlign = ma5[i] > ma20[i] && ma20[i] > ma60[i] && ma5[i-1] <= ma20[i-1];
    if (bullAlign && dif[i] > dea[i]) signals[i] = 1;
    const bearAlign = ma5[i] < ma20[i] && closes[i] < ma60[i];
    if (bearAlign && dif[i] < dea[i]) signals[i] = -1;
  }
  return signals;
}

// 新增: 突破策略 (放量突破N日高点)
function breakoutStrategy(closes, highs, lows, volumes) {
  const signals = new Array(closes.length).fill(0);
  const high20 = [];
  const volMa = SMA(volumes, 20);
  for (let i = 0; i < highs.length; i++) {
    if (i >= 20) {
      const slice = highs.slice(i - 20, i);
      high20.push(Math.max(...slice));
    } else {
      high20.push(null);
    }
  }
  for (let i = 1; i < closes.length; i++) {
    if (high20[i] == null || volMa[i] == null) continue;
    if (closes[i] > high20[i-1] && closes[i-1] <= high20[i-2] && volumes[i] > volMa[i] * 1.2) signals[i] = 1;
    if (closes[i] < closes[i-1] * 0.95 && closes[i-1] >= high20[i-2]) signals[i] = -1;
  }
  return signals;
}

const strategies = {
  maCrossStrategy, macdStrategy, rsiStrategy, bollStrategy,
  multiFactorStrategy, trendFollowingStrategy, breakoutStrategy,
};
const strategyNames = {
  maCrossStrategy: "双均线策略(MA5/MA20)",
  macdStrategy: "MACD策略",
  rsiStrategy: "RSI超买超卖策略",
  bollStrategy: "布林带策略",
  multiFactorStrategy: "多因子综合策略",
  trendFollowingStrategy: "趋势跟踪策略",
  breakoutStrategy: "突破策略",
};

module.exports = { backtest, strategies, strategyNames, parseCustomStrategy, INDICATOR_NAMES, COMMISSION_BUY, COMMISSION_SELL };

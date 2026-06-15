// Backtest Worker — 独立线程中运行回测引擎
// 接收 { strategyType, klines, config, code, startDate, endDate }
// 返回完整回测报告

const { parentPort } = require("worker_threads");

// ==================== 内联指标 (避免跨线程 require 问题) ====================

function SMA(arr, n) {
  const r = new Array(arr.length).fill(null);
  for (let i = n - 1; i < arr.length; i++) {
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += arr[j];
    r[i] = sum / n;
  }
  return r;
}

function EMA(arr, n) {
  const k = 2 / (n + 1);
  const r = [arr[0]];
  for (let i = 1; i < arr.length; i++) r.push(arr[i] * k + r[i - 1] * (1 - k));
  return r;
}

function MACD(closes) {
  const ema12 = EMA(closes, 12), ema26 = EMA(closes, 26);
  const dif = ema12.map((v, i) => v - ema26[i]);
  const dea = EMA(dif, 9);
  const macd = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, macd };
}

function RSI(closes, n = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length < n + 1) return rsi;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgG = gain / n, avgL = loss / n;
  rsi[n] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (n - 1) + (d > 0 ? d : 0)) / n;
    avgL = (avgL * (n - 1) + (d < 0 ? -d : 0)) / n;
    rsi[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return rsi;
}

// ==================== 绩效分析 ====================

function calcReturns(equityCurve) {
  const rets = [];
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i - 1] > 0) rets.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
  }
  return rets;
}

function fullReport(equityCurve, trades, initialCapital, tradingDays) {
  if (!equityCurve || equityCurve.length < 2) {
    return { error: "数据不足", totalReturn: 0, sharpe: 0, sortino: 0, maxDrawdown: 0 };
  }

  const rets = calcReturns(equityCurve);
  const totalReturn = (equityCurve[equityCurve.length - 1] - initialCapital) / initialCapital;
  const years = equityCurve.length / tradingDays;
  const annReturn = years > 0 ? ((1 + totalReturn) ** (1 / years) - 1) : 0;

  const avgRet = rets.reduce((a, b) => a + b, 0) / rets.length;
  const stdRet = Math.sqrt(rets.reduce((s, r) => s + (r - avgRet) ** 2, 0) / rets.length) || 1e-10;
  const sharpe = (avgRet * tradingDays - 0.02) / (stdRet * Math.sqrt(tradingDays));

  const downRets = rets.filter(r => r < 0);
  const downStd = downRets.length > 0
    ? Math.sqrt(downRets.reduce((s, r) => s + r ** 2, 0) / downRets.length) : 1e-10;
  const sortino = (avgRet * tradingDays - 0.02) / (downStd * Math.sqrt(tradingDays));

  let peak = -Infinity, maxDD = 0;
  for (const eq of equityCurve) {
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, (peak - eq) / peak);
  }

  const calmar = maxDD > 0 ? annReturn / maxDD : 0;

  // 交易统计
  const sellTrades = trades.filter(t => t.side === "sell");
  const winTrades = sellTrades.filter(t => (t.pnl || 0) > 0);
  const winRate = sellTrades.length > 0 ? winTrades.length / sellTrades.length : 0;
  const avgWin = winTrades.length > 0
    ? winTrades.reduce((s, t) => s + (t.pnl || 0), 0) / winTrades.length : 0;
  const loseTrades = sellTrades.filter(t => (t.pnl || 0) <= 0);
  const avgLoss = loseTrades.length > 0
    ? Math.abs(loseTrades.reduce((s, t) => s + (t.pnl || 0), 0) / loseTrades.length) : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

  return {
    totalReturn: +(totalReturn * 100).toFixed(2),
    annualizedReturn: +(annReturn * 100).toFixed(2),
    sharpe: +sharpe.toFixed(3),
    sortino: +sortino.toFixed(3),
    maxDrawdown: +(maxDD * 100).toFixed(2),
    calmar: +calmar.toFixed(3),
    winRate: +(winRate * 100).toFixed(1),
    profitFactor: +profitFactor.toFixed(2),
    tradeCount: trades.length,
    finalEquity: +equityCurve[equityCurve.length - 1].toFixed(2),
  };
}

// ==================== 策略评估 ====================

function evaluateSimple(type, closes, opens, highs, lows, volumes) {
  const last = closes.length - 1;

  if (type === "ma_cross") {
    const ma5 = SMA(closes, 5);
    const ma20 = SMA(closes, 20);
    if (ma5[last] > ma20[last] && ma5[last - 1] <= ma20[last - 1]) {
      return { action: "buy", strength: 3, reason: "MA5上穿MA20 金叉" };
    }
    if (ma5[last] < ma20[last] && ma5[last - 1] >= ma20[last - 1]) {
      return { action: "sell", strength: -3, reason: "MA5下穿MA20 死叉" };
    }
    return { action: "hold", strength: 0, reason: ma5[last] > ma20[last] ? "多头排列" : "空头排列" };
  }

  if (type === "signal_follow") {
    const { dif, dea } = MACD(closes);
    const rsi14 = RSI(closes, 14);
    const score = (dif[last] > dea[last] ? 1 : -1) + (rsi14[last] < 30 ? 1 : rsi14[last] > 70 ? -1 : 0);
    if (score >= 2) return { action: "buy", strength: score, reason: `MACD金叉+RSI超卖 score=${score}` };
    if (score <= -2) return { action: "sell", strength: score, reason: `MACD死叉+RSI超买 score=${score}` };
    return { action: "hold", strength: score, reason: `信号中性 score=${score}` };
  }

  if (type === "grid") {
    const recentHigh = Math.max(...closes.slice(-20));
    const recentLow = Math.min(...closes.slice(-20));
    const gridSize = (recentHigh - recentLow) / 5;
    const price = closes[last];
    if (price <= recentLow + gridSize * 0.5) return { action: "buy", strength: 1, reason: "网格下沿" };
    if (price >= recentHigh - gridSize * 0.5) return { action: "sell", strength: -1, reason: "网格上沿" };
    return { action: "hold", strength: 0, reason: "网格区间内" };
  }

  if (type === "t3pullback") {
    if (last < 30) return { action: "hold", strength: 0, reason: "数据不足" };
    for (let i = last; i >= last - 10 && i >= 3; i--) {
      const T0 = { open: opens[i-3], close: closes[i-3], high: highs[i-3], low: lows[i-3], volume: volumes[i-3] };
      const T1 = { open: opens[i-2], close: closes[i-2], high: highs[i-2], low: lows[i-2], volume: volumes[i-2] };
      const T2 = { open: opens[i-1], close: closes[i-1], high: highs[i-1], low: lows[i-1], volume: volumes[i-1] };
      const T3 = { open: opens[i],   close: closes[i],   high: highs[i],   low: lows[i],   volume: volumes[i]   };
      if (T0.close <= 0 || T1.close <= 0 || T2.close <= 0 || T3.close <= 0) continue;
      if (T3.close < 5.0) continue;
      let vol5Avg = 0;
      for (let j = i - 8; j < i - 3; j++) { if (j >= 0 && volumes[j]) vol5Avg += volumes[j]; }
      vol5Avg = vol5Avg > 0 ? vol5Avg / 5 : volumes[i-3];
      const volRatio = vol5Avg > 0 ? T0.volume / vol5Avg : 1;
      const t0Chg = (T0.close - T0.open) / T0.open * 100;
      if (volRatio < 0.8) continue;
      if (t0Chg >= 9.5) continue;
      const t1Chg = (T1.close - T1.open) / T1.open * 100;
      if (t1Chg < 9.5) continue;
      if (T2.close >= T2.open) continue;
      const buyPrice = (T0.close + T1.close) / 2;
      const score = Math.min(100, Math.round(
        55 + Math.min(volRatio, 3) * 5 + Math.min(t1Chg - 9.5, 5) * 2 +
        (T2.close < T2.open ? 10 : -20) + (T2.volume < T1.volume * 0.8 ? 10 : 0)
      ));
      if (i === last) {
        return { action: "buy", strength: Math.round(score / 20), reason: `T+3回调低吸 volRatio=${volRatio.toFixed(1)} t1Chg=${t1Chg.toFixed(1)}%` };
      }
      if (i < last && (last - i) >= 5) {
        return { action: "sell", strength: -3, reason: "T+3持有期满 平仓" };
      }
      return { action: "hold", strength: 2, reason: `T+3持仓中 ${last - i}天` };
    }
    return { action: "hold", strength: 0, reason: "无T+3信号" };
  }

  return { action: "hold", strength: 0, reason: "未知策略" };
}

// ==================== 回测主循环 ====================

function runBacktest(data) {
  const { klines, strategyType, config = {}, code = "" } = data;
  if (!klines || klines.length < 60) return { error: "数据不足" };

  const initialCapital = config.initialCapital || 1000000;
  const slippage = config.slippage || 0.001;
  const commission = config.commission || 0.00025;
  const stampTax = config.stampTax || 0.001;
  const minFee = config.minFee || 5;
  const positionSize = config.positionSize || 0.2;
  const tPlusOne = config.tPlusOne !== false;

  let cash = initialCapital;
  let position = 0;
  let avgCost = 0;
  const equityCurve = [];
  const trades = [];
  const signals = [];

  const closes = klines.map(k => k.close);
  const opens  = klines.map(k => k.open);
  const highs  = klines.map(k => k.high);
  const lows   = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const dates  = klines.map(k => k.date);

  for (let i = 60; i < klines.length; i++) {
    const sliceCloses = closes.slice(0, i + 1);
    const sliceOpens  = opens.slice(0, i + 1);
    const sliceHighs  = highs.slice(0, i + 1);
    const sliceLows   = lows.slice(0, i + 1);
    const sliceVols   = volumes.slice(0, i + 1);

    const price = closes[i];
    const signal = evaluateSimple(strategyType, sliceCloses, sliceOpens, sliceHighs, sliceLows, sliceVols);

    signals.push({ date: dates[i], price, action: signal.action, strength: signal.strength, reason: signal.reason });

    if (signal.action === "buy" && position === 0) {
      const buyAmount = cash * positionSize;
      const buyPrice = price * (1 + slippage);
      const qty = Math.floor(buyAmount / buyPrice / 100) * 100;
      if (qty >= 100) {
        const cost = buyPrice * qty;
        const fee = Math.max(minFee, cost * commission);
        if (cash >= cost + fee) {
          cash -= (cost + fee);
          position = qty;
          avgCost = buyPrice;
          trades.push({
            date: dates[i], code, side: "buy", quantity: qty,
            price: +buyPrice.toFixed(2), cost: +cost.toFixed(2), fee: +fee.toFixed(2), cash: +cash.toFixed(2),
          });
        }
      }
    } else if (signal.action === "sell" && position > 0) {
      if (tPlusOne && trades.length > 0) {
        const lastTrade = trades[trades.length - 1];
        if (lastTrade.side === "buy" && lastTrade.date === dates[i]) {
          equityCurve.push(cash + position * price);
          continue;
        }
      }
      const sellPrice = price * (1 - slippage);
      const proceeds = sellPrice * position;
      const fee = Math.max(minFee, proceeds * commission);
      const tax = proceeds * stampTax;
      const pnl = proceeds - avgCost * position - fee - tax;
      cash += (proceeds - fee - tax);
      trades.push({
        date: dates[i], code, side: "sell", quantity: position,
        price: +sellPrice.toFixed(2), proceeds: +proceeds.toFixed(2),
        fee: +fee.toFixed(2), tax: +tax.toFixed(2), pnl: +pnl.toFixed(2),
        pnlPct: avgCost > 0 ? +((sellPrice - avgCost) / avgCost * 100).toFixed(2) : 0,
        cash: +cash.toFixed(2),
      });
      position = 0;
      avgCost = 0;
    }

    equityCurve.push(+(cash + position * price).toFixed(2));
  }

  // 清仓
  if (position > 0) {
    const lastPrice = closes[closes.length - 1];
    cash += lastPrice * position;
    equityCurve.push(+cash.toFixed(2));
  }

  const report = fullReport(equityCurve, trades, initialCapital, 252);
  report.signals = signals.filter((_, i) => i % 5 === 0);
  report.tradeLog = trades;
  report.equityCurve = equityCurve.filter((_, i) => i % 3 === 0);

  return report;
}

// ==================== Worker 入口 ====================

parentPort.on("message", (msg) => {
  try {
    const result = runBacktest(msg.data);
    parentPort.postMessage(result);
  } catch (err) {
    parentPort.postMessage({ error: err.message, stack: err.stack });
  }
});

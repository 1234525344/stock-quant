// 绩效分析引擎 — Sharpe, Sortino, MaxDD, Calmar, Win Rate, Profit Factor
// 行业标准指标，用于策略评估和对比

function calcReturns(equityCurve) {
  const rets = [];
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i - 1] > 0) {
      rets.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }
  }
  return rets;
}

function annualizedReturn(equityCurve, tradingDays = 252) {
  if (equityCurve.length < 2) return 0;
  const totalReturn = (equityCurve[equityCurve.length - 1] - equityCurve[0]) / equityCurve[0];
  const years = equityCurve.length / tradingDays;
  return years > 0 ? ((1 + totalReturn) ** (1 / years) - 1) : 0;
}

function sharpeRatio(equityCurve, riskFreeRate = 0.02, tradingDays = 252) {
  const rets = calcReturns(equityCurve);
  if (rets.length < 2) return 0;
  const avgRet = rets.reduce((a, b) => a + b, 0) / rets.length;
  const stdRet = Math.sqrt(rets.reduce((s, r) => s + (r - avgRet) ** 2, 0) / rets.length) || 1e-10;
  return ((avgRet * tradingDays - riskFreeRate) / (stdRet * Math.sqrt(tradingDays)));
}

function sortinoRatio(equityCurve, riskFreeRate = 0.02, tradingDays = 252) {
  const rets = calcReturns(equityCurve);
  if (rets.length < 2) return 0;
  const avgRet = rets.reduce((a, b) => a + b, 0) / rets.length;
  const downRets = rets.filter(r => r < 0);
  const downStd = downRets.length > 0
    ? Math.sqrt(downRets.reduce((s, r) => s + r ** 2, 0) / downRets.length)
    : 1e-10;
  return ((avgRet * tradingDays - riskFreeRate) / (downStd * Math.sqrt(tradingDays)));
}

function maxDrawdown(equityCurve) {
  if (equityCurve.length < 2) return { mdd: 0, mddPct: 0, peak: equityCurve[0] || 0, trough: equityCurve[0] || 0 };
  let peak = equityCurve[0];
  let mddPct = 0, mdd = 0, trough = equityCurve[0];
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > mddPct) { mddPct = dd; mdd = peak - v; trough = v; }
  }
  return { mdd: +mdd.toFixed(2), mddPct: +(mddPct * 100).toFixed(2), peak, trough };
}

function calmarRatio(equityCurve, tradingDays = 252) {
  const annRet = annualizedReturn(equityCurve, tradingDays);
  const { mddPct } = maxDrawdown(equityCurve);
  return mddPct > 0 ? annRet / (mddPct / 100) : 0;
}

function winRate(trades) {
  if (!trades || trades.length === 0) return { winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, totalTrades: 0 };
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const totalWin = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0)) || 1;
  const profitFactor = totalLoss > 0 ? totalWin / totalLoss : 0;
  return {
    winRate: +(winRate * 100).toFixed(1),
    profitFactor: +profitFactor.toFixed(2),
    avgWin: wins.length > 0 ? +(totalWin / wins.length).toFixed(2) : 0,
    avgLoss: losses.length > 0 ? +(losses.reduce((s, t) => s + t.pnl, 0) / losses.length).toFixed(2) : 0,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
  };
}

function analyzeTrades(trades) {
  // trades: [{ code, side, price, quantity, timestamp }] 需要有pair匹配
  // 简化为按时间排序配对
  if (trades.length < 2) return [];

  const sorted = [...trades].sort((a, b) => new Date(a.created_at || a.date) - new Date(b.created_at || b.date));
  const positions = {}; // code -> { buys: [] }
  const completed = [];

  for (const t of sorted) {
    if (!positions[t.code]) positions[t.code] = { buys: [], name: t.name };
    if (t.side === "buy") {
      positions[t.code].buys.push({ qty: t.quantity, price: t.price, fee: t.fee || 0, time: t.created_at || t.date });
    } else {
      let sellQty = t.quantity;
      let sellProceeds = 0, costBasis = 0, totalFee = t.fee || 0;
      const matched = [];
      while (sellQty > 0 && positions[t.code].buys.length > 0) {
        const buy = positions[t.code].buys[0];
        const matchQty = Math.min(sellQty, buy.qty);
        costBasis += matchQty * buy.price;
        sellProceeds += matchQty * t.price;
        totalFee += (buy.fee || 0) * (matchQty / buy.qty);
        buy.qty -= matchQty;
        sellQty -= matchQty;
        if (buy.qty <= 0) positions[t.code].buys.shift();
      }
      if (costBasis > 0) {
        completed.push({
          code: t.code, name: t.name,
          pnl: +(sellProceeds - costBasis - totalFee).toFixed(2),
          pnlPct: +((sellProceeds - costBasis - totalFee) / costBasis * 100).toFixed(2),
          sellPrice: t.price, sellTime: t.created_at,
        });
      }
    }
  }

  return completed;
}

function fullReport(equityCurve, trades, initialCapital = 1000000, tradingDays = 252) {
  const completed = analyzeTrades(trades);
  const pnls = completed.map(t => t.pnl);
  const winStats = winRate(pnls.map(p => ({ pnl: p })));
  const { mdd, mddPct } = maxDrawdown(equityCurve);
  const sharpe = sharpeRatio(equityCurve, 0.02, tradingDays);
  const sortino = sortinoRatio(equityCurve, 0.02, tradingDays);
  const annRet = annualizedReturn(equityCurve, tradingDays);
  const calmar = calmarRatio(equityCurve, tradingDays);
  const finalEquity = equityCurve[equityCurve.length - 1] || initialCapital;
  const totalReturn = +((finalEquity - initialCapital) / initialCapital * 100).toFixed(2);

  let grade = "D";
  if (sharpe > 2 && mddPct < 15 && winStats.winRate > 50) grade = "A";
  else if (sharpe > 1.2 && mddPct < 25 && winStats.winRate > 42) grade = "B";
  else if (sharpe > 0.5 && mddPct < 35) grade = "C";

  return {
    summary: {
      initialCapital,
      finalEquity: +finalEquity.toFixed(2),
      totalReturn,
      annualizedReturn: +(annRet * 100).toFixed(2),
      totalTrades: completed.length,
      grade,
    },
    risk: {
      sharpeRatio: +sharpe.toFixed(2),
      sortinoRatio: +sortino.toFixed(2),
      calmarRatio: +calmar.toFixed(2),
      maxDrawdown: mdd,
      maxDrawdownPct: mddPct,
      volatility: equityCurve.length > 1
        ? +(Math.sqrt(calcReturns(equityCurve).reduce((s, r) => s + r ** 2, 0) / calcReturns(equityCurve).length || 0) * Math.sqrt(tradingDays) * 100).toFixed(2)
        : 0,
    },
    trades: winStats,
    equityCurve: equityCurve.slice(-100), // 最近100个点
    completedTrades: completed.slice(-30),
  };
}

module.exports = { calcReturns, sharpeRatio, sortinoRatio, maxDrawdown, calmarRatio, winRate, analyzeTrades, fullReport, annualizedReturn };

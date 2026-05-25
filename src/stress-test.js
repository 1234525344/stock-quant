// 压力测试 & 风险报告引擎 v1
// 复用 src/risk.js 分析层，增加 Monte Carlo / Sharpe / Beta / 报告生成

const {
  STRESS_SCENARIOS,
  stressTest,
  comprehensiveRiskReport,
  historicalVaR,
  historicalCVaR,
  parametricVaR,
  ledoitWolfCovariance,
  alignReturns,
  portfolioReturns,
} = require("./risk");

const { getIndexKline } = require("./data");

// ========== 最大回撤 ==========

function computeMaxDrawdown(equityCurve) {
  let peak = -Infinity, maxDD = 0, ddStart = null, ddEnd = null, peakIdx = 0;
  for (let i = 0; i < equityCurve.length; i++) {
    const val = equityCurve[i].equity || equityCurve[i];
    if (val > peak) { peak = val; peakIdx = i; }
    const dd = (peak - val) / peak;
    if (dd > maxDD) { maxDD = dd; ddStart = peakIdx; ddEnd = i; }
  }
  return {
    maxDrawdownPct: +(maxDD * 100).toFixed(2),
    maxDrawdownStart: equityCurve[ddStart]?.date || null,
    maxDrawdownEnd: equityCurve[ddEnd]?.date || null,
    recoveryDays: ddEnd > ddStart ? ddEnd - ddStart : 0,
  };
}

// ========== Sharpe 比率 ==========

function computeSharpeRatio(dailyReturns, riskFreeRate = 0.025) {
  if (dailyReturns.length < 5) return { sharpe: 0, annualReturn: 0, annualVol: 0 };
  const avgRet = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / dailyReturns.length;
  const stdRet = Math.sqrt(variance);
  const annRet = avgRet * 252;
  const annVol = stdRet * Math.sqrt(252);
  const sharpe = annVol > 0 ? (annRet - riskFreeRate) / annVol : 0;
  return { sharpe: +sharpe.toFixed(3), annualReturn: +(annRet * 100).toFixed(1), annualVol: +(annVol * 100).toFixed(1) };
}

// ========== Beta (组合 vs 沪深300) ==========

async function computePortfolioBeta(portfolioDailyReturns, benchmarkCode = "000300") {
  try {
    const idxKlines = await getIndexKline(benchmarkCode, 365);
    if (!idxKlines || idxKlines.length < 60) return { beta: 1, alpha: 0, rSquared: 0, correlation: 0 };

    const idxCloses = idxKlines.map(k => k.close);
    const idxReturns = [];
    for (let i = 1; i < idxCloses.length; i++) {
      idxReturns.push(idxCloses[i - 1] > 0 ? (idxCloses[i] - idxCloses[i - 1]) / idxCloses[i - 1] : 0);
    }

    const n = Math.min(portfolioDailyReturns.length, idxReturns.length);
    const portRets = portfolioDailyReturns.slice(-n);
    const idxRets = idxReturns.slice(-n);

    const pMean = portRets.reduce((s, r) => s + r, 0) / n;
    const iMean = idxRets.reduce((s, r) => s + r, 0) / n;

    let cov = 0, varIdx = 0, varPort = 0;
    for (let t = 0; t < n; t++) {
      cov += (portRets[t] - pMean) * (idxRets[t] - iMean);
      varIdx += (idxRets[t] - iMean) ** 2;
      varPort += (portRets[t] - pMean) ** 2;
    }

    const beta = varIdx > 0 ? cov / varIdx : 1;
    const alpha = pMean - beta * iMean;
    const corrNum = cov / n;
    const corrDen = Math.sqrt(varPort / n) * Math.sqrt(varIdx / n);
    const correlation = corrDen > 0 ? corrNum / corrDen : 0;
    const rSquared = correlation * correlation;

    return {
      beta: +beta.toFixed(3),
      alpha: +(alpha * 252 * 100).toFixed(2),
      rSquared: +rSquared.toFixed(3),
      correlation: +correlation.toFixed(3),
    };
  } catch (e) {
    return { beta: 1, alpha: 0, rSquared: 0, correlation: 0 };
  }
}

// ========== Monte Carlo VaR (参数法) ==========

function runMonteCarloVaR(returns, numSimulations = 10000, confidence = 0.95) {
  if (returns.length < 10) return { var95: 0, var99: 0, cvar95: 0, cvar99: 0 };

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(Math.max(0, variance));

  // Box-Muller 生成正态随机数
  const simulated = [];
  for (let i = 0; i < numSimulations; i++) {
    const u1 = Math.random() || 0.0001;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    simulated.push(mean + std * z);
  }

  simulated.sort((a, b) => a - b);

  const idx95 = Math.floor(numSimulations * 0.05);
  const idx99 = Math.floor(numSimulations * 0.01);
  const var95 = simulated[Math.max(0, idx95)];
  const var99 = simulated[Math.max(0, idx99)];

  const tail95 = simulated.slice(0, Math.max(1, idx95));
  const tail99 = simulated.slice(0, Math.max(1, idx99));
  const cvar95 = tail95.reduce((a, b) => a + b, 0) / tail95.length;
  const cvar99 = tail99.reduce((a, b) => a + b, 0) / tail99.length;

  return {
    var95: +(var95 * Math.sqrt(252) * 100).toFixed(2),
    var99: +(var99 * Math.sqrt(252) * 100).toFixed(2),
    cvar95: +(cvar95 * Math.sqrt(252) * 100).toFixed(2),
    cvar99: +(cvar99 * Math.sqrt(252) * 100).toFixed(2),
    distribution: { mean: +mean.toFixed(6), std: +std.toFixed(6) },
  };
}

// ========== 胜率分析 ==========

function computeWinRate(trades) {
  if (!trades || trades.length === 0) return { winRate: 0, totalTrades: 0, winningTrades: 0, avgWin: 0, avgLoss: 0, profitFactor: 0 };
  const wins = trades.filter(t => (t.pnl || 0) > 0);
  const losses = trades.filter(t => (t.pnl || 0) < 0);
  const totalWins = wins.length;
  const totalLosses = losses.length;
  const avgWin = totalWins > 0 ? wins.reduce((s, t) => s + (t.pnl || 0), 0) / totalWins : 0;
  const avgLoss = totalLosses > 0 ? Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0) / totalLosses) : 0;
  const grossProfit = wins.reduce((s, t) => s + (t.pnl || 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0));
  return {
    winRate: +(totalWins / trades.length * 100).toFixed(1),
    totalTrades: trades.length,
    winningTrades: totalWins,
    avgWin: +avgWin.toFixed(2),
    avgLoss: +avgLoss.toFixed(2),
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : totalWins > 0 ? Infinity : 0,
  };
}

// ========== 综合风控报告 ==========

async function generateRiskReport(positionTracker, getKlineFn, options = {}) {
  const posData = positionTracker.toJSON();
  const snapshots = posData.dailySnapshots;

  // 日收益率序列
  const dailyReturns = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1].equity;
    dailyReturns.push(prev > 0 ? (snapshots[i].equity - prev) / prev : 0);
  }

  const sharpe = computeSharpeRatio(dailyReturns);
  const maxDD = computeMaxDrawdown(snapshots);
  const winRate = computeWinRate(positionTracker.tradeLog.filter(t => t.action === "sell"));
  const portfolioBeta = dailyReturns.length > 20 ? await computePortfolioBeta(dailyReturns) : { beta: 1, alpha: 0, rSquared: 0, correlation: 0 };
  const mcVaR = runMonteCarloVaR(dailyReturns);
  const histVaR95 = dailyReturns.length > 20 ? historicalVaR(dailyReturns, 0.95) * Math.sqrt(252) * 100 : 0;
  const histVaR99 = dailyReturns.length > 20 ? historicalVaR(dailyReturns, 0.99) * Math.sqrt(252) * 100 : 0;

  // 压力测试 (基于当前持仓)
  let stressResults = [];
  if (getKlineFn && posData.positions.length > 0) {
    try {
      const codes = posData.positions.map(p => p.code);
      const weights = posData.positions.map(p => posData.equity > 0 ? (p.marketValue / posData.equity) : 0);
      const klinesData = await Promise.all(codes.map(c => getKlineFn(c, 250).catch(() => [])));
      const validData = klinesData.filter(k => k.length > 60);

      if (validData.length >= 2) {
        const { cov, codes: covCodes } = ledoitWolfCovariance(validData.map((k, idx) => ({
          code: codes[idx],
          returns: k.slice(1).map((bar, i) => k[i].close > 0 ? (bar.close - k[i].close) / k[i].close : 0),
        })));
        const stockBetas = validData.map(() => 1); // 简化
        const alignedWeights = weights.slice(0, covCodes.length);
        const sumW = alignedWeights.reduce((a, b) => a + b, 0);
        const normWeights = sumW > 0 ? alignedWeights.map(w => w / sumW) : alignedWeights;
        stressResults = stressTest(normWeights, cov, stockBetas, covCodes.slice(0, normWeights.length));
      }
    } catch (e) { /* stress test best-effort */ }
  }

  // 自动建议
  const recommendations = [];
  if (maxDD.maxDrawdownPct > 20) recommendations.push({ level: "danger", text: "最大回撤超过20%，建议降低仓位或设置强制止损线" });
  if (sharpe.sharpe < 0.5) recommendations.push({ level: "warning", text: "夏普比率偏低(<0.5)，风险调整后收益不足，建议优化持仓结构" });
  if (portfolioBeta.beta > 1.5) recommendations.push({ level: "warning", text: "组合Beta>1.5，系统性风险偏高，考虑增加防御性持仓" });
  if (posData.totalPositionRatio > 90) recommendations.push({ level: "danger", text: "仓位超过90%，几乎没有回旋余地，建议适当减仓" });
  const maxSingle = Math.max(0, ...posData.positions.map(p => posData.equity > 0 ? (p.marketValue / posData.equity * 100) : 0));
  if (maxSingle > 50) recommendations.push({ level: "danger", text: `单一持仓集中度过高(${maxSingle.toFixed(0)}%)，建议分散投资` });
  if (recommendations.length === 0) recommendations.push({ level: "info", text: "当前风险状况正常，未发现显著风险点" });

  return {
    period: {
      start: snapshots[0]?.date || null,
      end: snapshots[snapshots.length - 1]?.date || null,
      tradingDays: snapshots.length,
    },
    summary: {
      totalReturn: posData.pnlPct,
      annualReturn: sharpe.annualReturn,
      annualVol: sharpe.annualVol,
      sharpe: sharpe.sharpe,
      maxDrawdown: maxDD.maxDrawdownPct,
      maxDrawdownPeriod: { start: maxDD.maxDrawdownStart, end: maxDD.maxDrawdownEnd },
      winRate: winRate.winRate,
      profitFactor: winRate.profitFactor,
      beta: portfolioBeta.beta,
      alpha: portfolioBeta.alpha,
      rSquared: portfolioBeta.rSquared,
    },
    var: {
      historical95: +histVaR95.toFixed(1),
      historical99: +histVaR99.toFixed(1),
      monteCarlo95: mcVaR.var95,
      monteCarlo99: mcVaR.var99,
      mcCvar95: mcVaR.cvar95,
      mcCvar99: mcVaR.cvar99,
    },
    stressTests: stressResults.length > 0 ? stressResults : Object.entries(STRESS_SCENARIOS).map(([name, s]) => ({
      scenario: name,
      marketDrop: `${(s.marketDrop * 100).toFixed(0)}%`,
      stressedVol: 0,
      stressedVaR95: 0,
      expectedLoss: (posData.totalPositionRatio * s.marketDrop * 100).toFixed(1),
    })),
    positions: posData.positions,
    trades: {
      total: positionTracker.tradeLog.length,
      winRate: winRate.winRate,
      avgWin: winRate.avgWin,
      avgLoss: winRate.avgLoss,
      profitFactor: winRate.profitFactor,
    },
    recommendations,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  computeMaxDrawdown,
  computeSharpeRatio,
  computePortfolioBeta,
  runMonteCarloVaR,
  computeWinRate,
  generateRiskReport,
};

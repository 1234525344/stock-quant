// Covariance Worker — 独立线程中运行协方差矩阵计算
// 接收 { retMatrix, weights, codes, marketReturns, method }
// method: 'ledoit-wolf' (默认) | 'sample' | 'full-report'
// 返回协方差矩阵 + 风险指标

const { parentPort } = require("worker_threads");

// ==================== 样本协方差 ====================

function sampleCovariance(retMatrix) {
  const N = retMatrix.length;
  if (N < 2) return { cov: [[0]], codes: retMatrix.map(r => r.code) };

  const T = Math.min(...retMatrix.map(r => r.returns.length));
  const codes = retMatrix.map(r => r.code);

  const means = retMatrix.map(r => {
    const slice = r.returns.slice(-T);
    return slice.reduce((a, b) => a + b, 0) / T;
  });

  const cov = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      const ri = retMatrix[i].returns.slice(-T);
      const rj = retMatrix[j].returns.slice(-T);
      let sum = 0;
      for (let t = 0; t < T; t++) sum += (ri[t] - means[i]) * (rj[t] - means[j]);
      cov[i][j] = cov[j][i] = sum / (T - 1);
    }
  }
  return { cov, codes };
}

// ==================== Ledoit-Wolf 收缩 ====================

function ledoitWolfCovariance(retMatrix) {
  const { cov: S, codes } = sampleCovariance(retMatrix);
  const N = S.length;
  if (N < 3) return { cov: S, codes, shrinkage: 0 };

  const T = Math.min(...retMatrix.map(r => r.returns.length));

  // 收缩目标: 对角矩阵 (平均方差)
  const meanVar = S.reduce((s, row, i) => s + row[i], 0) / N;
  const target = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) target[i][i] = meanVar;

  // 收缩强度 lambda
  const lambda = Math.min(0.8, Math.max(0.05, N / (T * 0.5)));

  const shrunk = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      shrunk[i][j] = (1 - lambda) * S[i][j] + lambda * target[i][j];
    }
  }

  return { cov: shrunk, codes, shrinkage: +lambda.toFixed(3), sampleCov: S };
}

// ==================== 风险指标 ====================

function portfolioReturns(retMatrix, weights) {
  const T = Math.min(...retMatrix.map(r => r.returns.length));
  const portRets = [];
  for (let t = 0; t < T; t++) {
    let sum = 0;
    for (let i = 0; i < retMatrix.length; i++) {
      sum += (retMatrix[i].returns[retMatrix[i].returns.length - T + t] || 0) * (weights[i] || 0);
    }
    portRets.push(sum);
  }
  return portRets;
}

function historicalVaR(returns, confidence = 0.95) {
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * (1 - confidence));
  return sorted[Math.max(0, idx)];
}

function historicalCVaR(returns, confidence = 0.95) {
  const varVal = historicalVaR(returns, confidence);
  const tail = returns.filter(r => r <= varVal);
  return tail.length > 0 ? tail.reduce((a, b) => a + b, 0) / tail.length : varVal;
}

function parametricVaR(weights, covMatrix, confidence = 0.95) {
  let varP = 0;
  const N = weights.length;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      varP += weights[i] * weights[j] * (covMatrix[i][j] || 0);
    }
  }
  const volP = Math.sqrt(Math.max(0, varP));
  const zScores = { 0.90: 1.282, 0.95: 1.645, 0.99: 2.326, 0.999: 3.090 };
  const z = zScores[confidence] || 1.645;
  return -z * volP;
}

function riskBudget(weights, covMatrix) {
  const N = weights.length;
  let portVar = 0;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++)
      portVar += weights[i] * weights[j] * covMatrix[i][j];
  const portVol = Math.sqrt(Math.max(0, portVar));

  const mcr = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let j = 0; j < N; j++) sum += covMatrix[i][j] * weights[j];
    mcr[i] = portVol > 0 ? sum / portVol : 0;
  }

  const rc = mcr.map((m, i) => weights[i] * m);
  const rcPct = rc.map(r => portVol > 0 ? r / portVol : 0);

  return {
    portVol: +portVol.toFixed(6),
    mcr: mcr.map(v => +v.toFixed(6)),
    riskContribution: rc.map(v => +v.toFixed(6)),
    riskContributionPct: rcPct.map(v => +(v * 100).toFixed(1)),
  };
}

const STRESS_SCENARIOS = {
  "2008金融危机": { marketDrop: -0.30, volMultiplier: 3.0, correlationBoost: 0.3 },
  "2015股灾": { marketDrop: -0.25, volMultiplier: 2.5, correlationBoost: 0.25 },
  "2020疫情冲击": { marketDrop: -0.15, volMultiplier: 2.0, correlationBoost: 0.2 },
  "温和回调": { marketDrop: -0.10, volMultiplier: 1.5, correlationBoost: 0.1 },
  "极端事件": { marketDrop: -0.40, volMultiplier: 4.0, correlationBoost: 0.5 },
};

function stressTest(weights, covMatrix, stockBetas, stockNames) {
  const results = [];

  for (const [name, scenario] of Object.entries(STRESS_SCENARIOS)) {
    const stressedCov = covMatrix.map((row, i) =>
      row.map((v, j) => {
        if (i === j) return v * (scenario.volMultiplier ** 2);
        const volI = Math.sqrt(Math.max(0, covMatrix[i][i]));
        const volJ = Math.sqrt(Math.max(0, covMatrix[j][j]));
        const corr = volI > 0 && volJ > 0 ? covMatrix[i][j] / (volI * volJ) : 0;
        const stressedCorr = Math.min(0.99, corr + scenario.correlationBoost);
        return stressedCorr * volI * scenario.volMultiplier * volJ * scenario.volMultiplier;
      })
    );

    const stressedVol = Math.sqrt(
      weights.reduce((s, wi, i) =>
        s + weights.reduce((ss, wj, j) => ss + wi * wj * stressedCov[i][j], 0), 0)
    );

    results.push({
      scenario: name,
      marketDrop: `${(scenario.marketDrop * 100).toFixed(0)}%`,
      stressedVol: +(stressedVol * Math.sqrt(252) * 100).toFixed(1),
      stressedVaR95: +(-1.645 * stressedVol * Math.sqrt(252) * 100).toFixed(1),
      stressedVaR99: +(-2.326 * stressedVol * Math.sqrt(252) * 100).toFixed(1),
      expectedLoss: weights.reduce((s, w, i) =>
        s + w * (stockBetas[i] || 1) * scenario.marketDrop * 100, 0).toFixed(1),
    });
  }

  return results;
}

// ==================== 综合报告 ====================

function comprehensiveRiskReport(retMatrix, weights, codes, marketReturns) {
  const { cov, codes: covCodes, shrinkage, sampleCov } = ledoitWolfCovariance(retMatrix);
  const portRets = portfolioReturns(retMatrix, weights);

  const annVol = Math.sqrt(
    portRets.reduce((s, r) => s + r ** 2, 0) / portRets.length
  ) * Math.sqrt(252);

  const var95 = historicalVaR(portRets, 0.95) * Math.sqrt(252);
  const var99 = historicalVaR(portRets, 0.99) * Math.sqrt(252);
  const cvar95 = historicalCVaR(portRets, 0.95) * Math.sqrt(252);
  const paramVaR95 = parametricVaR(weights, cov, 0.95) * Math.sqrt(252);
  const budget = riskBudget(weights, cov);

  const stockBetas = retMatrix.map(r => {
    const n = Math.min(r.returns.length, marketReturns.length);
    const mr = marketReturns.slice(-n);
    const sr = r.returns.slice(-n);
    const mMean = mr.reduce((a, b) => a + b, 0) / n;
    const sMean = sr.reduce((a, b) => a + b, 0) / n;
    let cv = 0, vm = 0;
    for (let i = 0; i < n; i++) { cv += (sr[i] - sMean) * (mr[i] - mMean); vm += (mr[i] - mMean) ** 2; }
    return vm > 0 ? cv / vm : 1;
  });

  const portBeta = weights.reduce((s, w, i) => s + w * (stockBetas[i] || 1), 0);
  const stress = stressTest(weights, cov, stockBetas, codes);

  let peak = -Infinity, maxDD = 0;
  let cumRet = 1;
  for (const r of portRets) {
    cumRet *= (1 + r);
    peak = Math.max(peak, cumRet);
    maxDD = Math.max(maxDD, (peak - cumRet) / peak);
  }

  return {
    portfolioVolatility: +(annVol * 100).toFixed(1),
    var95: +(var95 * 100).toFixed(1),
    var99: +(var99 * 100).toFixed(1),
    cvar95: +(cvar95 * 100).toFixed(1),
    parametricVaR95: +(paramVaR95 * 100).toFixed(1),
    maxDrawdown: +(maxDD * 100).toFixed(1),
    portfolioBeta: +portBeta.toFixed(3),
    shrinkage: +shrinkage.toFixed(3),
    riskBudget: budget.riskContributionPct.map((pct, i) => ({
      code: codes[i],
      riskPct: pct,
      weight: weights[i] ? +(weights[i] * 100).toFixed(1) : 0,
    })),
    stressTests: stress,
    stockBetas: codes.map((c, i) => ({ code: c, beta: +(stockBetas[i] || 1).toFixed(3) })),
    covMatrix: cov,
  };
}

// ==================== Worker 入口 ====================

parentPort.on("message", (msg) => {
  try {
    const { retMatrix, weights, codes, marketReturns, method } = msg.data;
    const m = method || "ledoit-wolf";

    let result;

    if (m === "sample") {
      result = sampleCovariance(retMatrix);
    } else if (m === "full-report") {
      if (!weights || !codes || !marketReturns) {
        throw new Error("full-report method requires: weights, codes, marketReturns");
      }
      result = comprehensiveRiskReport(retMatrix, weights, codes, marketReturns);
    } else {
      // 默认: ledoit-wolf
      result = ledoitWolfCovariance(retMatrix);
    }

    parentPort.postMessage(result);
  } catch (err) {
    parentPort.postMessage({ error: err.message, stack: err.stack });
  }
});

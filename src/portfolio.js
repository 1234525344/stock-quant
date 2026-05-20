// 组合优化器 — Markowitz 均值方差 + Risk Parity + Black-Litterman
// 长仓约束 (无做空), 无杠杆

const { sampleCovariance, ledoitWolfCovariance } = require("./risk");

// ==================== 工具 ====================

function portfolioStats(weights, returns, covMatrix) {
  const N = weights.length;
  // 组合收益
  let portRet = 0;
  for (let i = 0; i < N; i++) {
    const meanRet = returns[i].reduce((a, b) => a + b, 0) / returns[i].length;
    portRet += weights[i] * meanRet;
  }
  // 组合方差
  let portVar = 0;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++)
      portVar += weights[i] * weights[j] * covMatrix[i][j];

  const portVol = Math.sqrt(Math.max(0, portVar));
  const sharpe = portVol > 0 ? portRet / portVol : 0;

  return { ret: portRet, vol: portVol, sharpe, weights };
}

// 约束投影 (长仓, 权重和=1)
function projectSimplex(weights) {
  // 先钳制到 >= 0
  const w = weights.map(v => Math.max(0, v));
  const sum = w.reduce((a, b) => a + b, 0);
  return sum > 0 ? w.map(v => v / sum) : w.map(() => 1 / w.length);
}

// ==================== 优化器 ====================

// 1. Max Sharpe — 随机搜索 + 梯度下降
function maxSharpe(returns, covMatrix, iterations = 2000) {
  const N = returns.length;
  if (N === 0) return [];
  if (N === 1) return [1];

  // 先用随机搜索找到好起点
  let bestWeights = new Array(N).fill(1 / N);
  let bestSharpe = -Infinity;

  for (let iter = 0; iter < 500; iter++) {
    const raw = new Array(N).fill(0).map(() => Math.random());
    const sum = raw.reduce((a, b) => a + b, 0);
    const w = raw.map(v => v / sum);
    const stats = portfolioStats(w, returns, covMatrix);
    if (stats.sharpe > bestSharpe) {
      bestSharpe = stats.sharpe;
      bestWeights = w;
    }
  }

  // 梯度下降精炼
  // maximize Sharpe = (w'r) / sqrt(w'Σw)
  // gradient ≈ (μ * σ - Sharpe * Σw) / σ²
  let currentW = bestWeights;
  for (let iter = 0; iter < 1500; iter++) {
    const stats = portfolioStats(currentW, returns, covMatrix);
    const mu = stats.ret;
    const sigma = stats.vol;
    if (sigma < 1e-10) break;

    const grad = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      const meanRet = returns[i].reduce((a, b) => a + b, 0) / returns[i].length;
      let covRow = 0;
      for (let j = 0; j < N; j++) covRow += covMatrix[i][j] * currentW[j];
      grad[i] = (meanRet * sigma - stats.sharpe * covRow) / (sigma * sigma);
    }

    // 步长 (自适应衰减)
    const rate = 0.01 / (1 + iter * 0.005);

    // 梯度上升 + 投影
    const newW = projectSimplex(currentW.map((wi, i) => wi + rate * grad[i]));
    const newStats = portfolioStats(newW, returns, covMatrix);

    if (newStats.sharpe > stats.sharpe) {
      currentW = newW;
    } else {
      // 缩小步长再试
      const newW2 = projectSimplex(currentW.map((wi, i) => wi + rate * 0.3 * grad[i]));
      const newStats2 = portfolioStats(newW2, returns, covMatrix);
      if (newStats2.sharpe > stats.sharpe) currentW = newW2;
      else break; // 收敛
    }
  }

  const finalStats = portfolioStats(currentW, returns, covMatrix);
  const annFactor = Math.sqrt(252);

  return currentW.map((w, i) => +w.toFixed(4));
}

// 2. Min Variance — 二次规划简化 (解析解 + 投影)
function minVariance(covMatrix, iterations = 1000) {
  const N = covMatrix.length;
  if (N <= 1) return N === 1 ? [1] : [];

  // 对于长仓约束的min variance, 使用梯度下降
  // minimize w'Σw subject to Σw=1, w>=0
  let w = new Array(N).fill(1 / N);

  for (let iter = 0; iter < iterations; iter++) {
    // gradient = 2 * Σw
    const grad = new Array(N).fill(0);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        grad[i] += 2 * covMatrix[i][j] * w[j];

    const rate = 0.05 / (1 + iter * 0.01);
    const newW = projectSimplex(w.map((wi, i) => wi - rate * grad[i]));

    // Check improvement
    let oldVar = 0, newVar = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        oldVar += w[i] * w[j] * covMatrix[i][j];
        newVar += newW[i] * newW[j] * covMatrix[i][j];
      }
    }
    if (newVar < oldVar) w = newW;
    else break;
  }

  return w.map(v => +v.toFixed(4));
}

// 3. Risk Parity (等风险贡献)
function riskParity(covMatrix, iterations = 200) {
  const N = covMatrix.length;
  if (N <= 1) return N === 1 ? [1] : [];

  // 初始: 等波动率倒数权重
  let w = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    w[i] = 1 / Math.sqrt(Math.max(1e-10, covMatrix[i][i]));
  }
  const initSum = w.reduce((a, b) => a + b, 0);
  w = w.map(v => v / initSum);

  // 迭代: w_i = w_i * targetRisk / marginalRiskContribution_i
  for (let iter = 0; iter < iterations; iter++) {
    // 组合方差
    let portVar = 0;
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        portVar += w[i] * w[j] * covMatrix[i][j];
    const portVol = Math.sqrt(Math.max(0, portVar));
    if (portVol < 1e-12) break;

    // 边际风险贡献
    const mrc = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let j = 0; j < N; j++) sum += covMatrix[i][j] * w[j];
      mrc[i] = sum / portVol;
    }

    // 风险贡献
    const rc = w.map((wi, i) => wi * mrc[i]);
    const targetRC = portVol / N;

    // 更新
    const newW = w.map((wi, i) => {
      const newWi = rc[i] > 0 ? wi * targetRC / rc[i] : wi;
      return newWi;
    });

    w = projectSimplex(newW);

    // 收敛检查
    const maxDev = Math.max(...rc.map(r => Math.abs(r - targetRC) / portVol));
    if (maxDev < 0.001) break;
  }

  return w.map(v => +v.toFixed(4));
}

// 4. Equal Weight (基准)
function equalWeight(N) {
  return new Array(N).fill(+(1 / N).toFixed(4));
}

// 5. 最大分散度 (Max Diversification Ratio)
function maxDiversification(covMatrix, iterations = 1000) {
  const N = covMatrix.length;
  if (N <= 1) return N === 1 ? [1] : [];

  // maximize (w'σ_diag) / sqrt(w'Σw) where σ_diag is individual volatilities
  const vols = covMatrix.map((row, i) => Math.sqrt(Math.max(1e-10, row[i])));

  // 随机搜索 + 梯度
  let bestW = new Array(N).fill(1 / N);
  let bestRatio = -Infinity;

  for (let iter = 0; iter < 200; iter++) {
    const raw = new Array(N).fill(0).map(() => Math.random());
    const sum = raw.reduce((a, b) => a + b, 0);
    const w = raw.map(v => v / sum);

    let wVol = 0, portVar = 0;
    for (let i = 0; i < N; i++) wVol += w[i] * vols[i];
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        portVar += w[i] * w[j] * covMatrix[i][j];
    const ratio = wVol / Math.sqrt(Math.max(1e-12, portVar));

    if (ratio > bestRatio) { bestRatio = ratio; bestW = w; }
  }

  return bestW.map(v => +v.toFixed(4));
}

// ==================== 有效前沿 ====================

function efficientFrontier(returns, covMatrix, points = 20) {
  const N = returns.length;
  if (N < 2) return [];

  const minVarW = minVariance(covMatrix);
  const maxSharpW = maxSharpe(returns, covMatrix);

  const minVarStats = portfolioStats(minVarW, returns, covMatrix);
  const maxSharpStats = portfolioStats(maxSharpW, returns, covMatrix);

  // 在最小方差和最大收益之间生成前沿点
  const frontier = [];

  // 目标波动率范围
  const minVol = minVarStats.vol;
  const maxVol = maxSharpStats.vol * 1.5;

  for (let i = 0; i < points; i++) {
    const targetVol = minVol + (maxVol - minVol) * (i / (points - 1));

    // 优化: max return subject to vol <= targetVol
    const w = optimizeReturnForVol(returns, covMatrix, targetVol);
    if (!w) continue;

    const stats = portfolioStats(w, returns, covMatrix);
    frontier.push({
      ret: +(stats.ret * 252 * 100).toFixed(2), // annualized %
      vol: +(stats.vol * Math.sqrt(252) * 100).toFixed(1), // annualized %
      sharpe: +(stats.sharpe * Math.sqrt(252)).toFixed(2),
      weights: w.map(v => +v.toFixed(4)),
    });
  }

  return frontier;
}

function optimizeReturnForVol(returns, covMatrix, targetVol, iterations = 500) {
  const N = returns.length;
  let w = new Array(N).fill(1 / N);

  for (let iter = 0; iter < iterations; iter++) {
    // 当前波动率
    let portVar = 0;
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        portVar += w[i] * w[j] * covMatrix[i][j];
    const currentVol = Math.sqrt(Math.max(0, portVar));

    // 梯度: maximize return
    const retGrad = returns.map(r => r.reduce((a, b) => a + b, 0) / r.length);

    // 波动率约束梯度 (penalty if vol > target)
    const volDiff = currentVol - targetVol;
    const penalty = volDiff > 0 ? volDiff / Math.max(1e-8, currentVol) : 0;

    const grad = retGrad.map((mu, i) => {
      let sum = 0;
      for (let j = 0; j < N; j++) sum += covMatrix[i][j] * w[j];
      return mu - penalty * (sum / Math.max(1e-8, currentVol));
    });

    const rate = 0.02 / (1 + iter * 0.005);
    w = projectSimplex(w.map((wi, i) => wi + rate * grad[i]));
  }

  return w;
}

// ==================== Black-Litterman ====================

// 结合先验(市场均衡权重)与投资者观点(Alpha信号)
function blackLitterman(
  marketWeights,     // 先验: 等权或市值权重
  alphaSignals,      // 观点: 每只股票的Alpha (Z-score)
  confidence = 0.5,  // 对观点的置信度 (0=完全信任先验, 1=完全信任Alpha)
  covMatrix = null,
) {
  const N = marketWeights.length;
  if (N === 0) return [];

  // 均衡超额收益: π = δ × Σ × w_market
  // 简化: 假设风险厌恶系数δ使均衡收益与先验权重一致
  const delta = 2.5; // 风险厌恶系数

  // 先验超额收益 (从先验权重反推)
  const priorReturns = new Array(N).fill(0);
  if (covMatrix) {
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let j = 0; j < N; j++) sum += covMatrix[i][j] * marketWeights[j];
      priorReturns[i] = delta * sum;
    }
  } else {
    // 无协方差: 假设等预期收益
    for (let i = 0; i < N; i++) priorReturns[i] = delta / N;
  }

  // 观点收益: Alpha信号 (标准化到与priorReturns可比)
  const maxAlpha = Math.max(...alphaSignals.map(Math.abs));
  const scale = maxAlpha > 0 ? Math.max(...priorReturns.map(Math.abs)) / maxAlpha * 0.5 : 0;

  // 后验收益 = (1-τ) × prior + τ × view
  // 其中 τ = confidence * scale_factor
  const tau = confidence * 0.5;

  const posteriorReturns = priorReturns.map((pr, i) => {
    const view = (alphaSignals[i] || 0) * (scale || 0.01);
    return (1 - tau) * pr + tau * view;
  });

  // 从后验收益得到权重 (使用风险平价 + 收益加权)
  const totalRet = posteriorReturns.reduce((a, b) => a + Math.max(0, b), 0);
  if (totalRet <= 0) {
    // 所有后验收益为负: 等权防御
    return new Array(N).fill(+(1 / N).toFixed(4));
  }

  const rawW = posteriorReturns.map(r => Math.max(0, r));
  const sum = rawW.reduce((a, b) => a + b, 0);
  return sum > 0 ? rawW.map(v => +(v / sum).toFixed(4)) : new Array(N).fill(+(1 / N).toFixed(4));
}

// ==================== 综合优化 ====================

function optimize(returns, covMatrix, method = "maxSharpe", alphaSignals = null) {
  const N = returns.length;
  if (N === 0) return { method, weights: [], stats: null };

  let weights;

  switch (method) {
    case "maxSharpe":
      weights = maxSharpe(returns, covMatrix);
      break;
    case "minVariance":
      weights = minVariance(covMatrix);
      break;
    case "riskParity":
      weights = riskParity(covMatrix);
      break;
    case "maxDiversification":
      weights = maxDiversification(covMatrix);
      break;
    case "equalWeight":
      weights = equalWeight(N);
      break;
    case "blackLitterman":
      const mktW = equalWeight(N);
      const alphas = alphaSignals || returns.map(r => {
        const mean = r.reduce((a, b) => a + b, 0) / r.length;
        const std = Math.sqrt(r.reduce((s, v) => s + (v - mean) ** 2, 0) / r.length);
        return std > 0 ? mean / std : 0;
      });
      weights = blackLitterman(mktW, alphas, 0.6, covMatrix);
      break;
    default:
      weights = maxSharpe(returns, covMatrix);
  }

  const stats = portfolioStats(weights, returns, covMatrix);
  const annStats = {
    annualReturn: +(stats.ret * 252 * 100).toFixed(2),
    annualVol: +(stats.vol * Math.sqrt(252) * 100).toFixed(1),
    sharpe: +(stats.sharpe * Math.sqrt(252)).toFixed(2),
  };

  return {
    method,
    weights: weights.map((w, i) => ({
      weight: +(w * 100).toFixed(1),
    })),
    stats: annStats,
  };
}

module.exports = {
  portfolioStats,
  projectSimplex,
  maxSharpe,
  minVariance,
  riskParity,
  equalWeight,
  maxDiversification,
  efficientFrontier,
  blackLitterman,
  optimize,
};

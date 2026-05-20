// 多因子Alpha引擎 — Fama-French + Barra 风格因子体系
// 参考: Fama-French 5-factor, Barra CNE5, 幻方AI因子框架
// 处理流程: 原始值 → Cross-section Z-score → Winsorize(±3σ) → 加权合成Alpha

// ==================== 工具函数 ====================

// 收益率计算
function returns(closes) {
  const r = new Array(closes.length).fill(null);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) r[i] = (closes[i] - closes[i - 1]) / closes[i - 1];
  }
  return r;
}

// 滚动求和
function rollingSum(arr, window) {
  const res = [];
  for (let i = window - 1; i < arr.length; i++) {
    let s = 0;
    for (let j = 0; j < window; j++) s += arr[i - j] || 0;
    res.push(s);
  }
  return res;
}

// 滚动均值
function rollingMean(arr, window) {
  const res = [];
  for (let i = window - 1; i < arr.length; i++) {
    let s = 0, c = 0;
    for (let j = 0; j < window; j++) {
      if (arr[i - j] != null) { s += arr[i - j]; c++; }
    }
    res.push(c > 0 ? s / c : null);
  }
  return res;
}

// 滚动标准差
function rollingStd(arr, window) {
  const res = [];
  for (let i = window - 1; i < arr.length; i++) {
    const slice = [];
    for (let j = 0; j < window; j++) {
      if (arr[i - j] != null) slice.push(arr[i - j]);
    }
    if (slice.length < 3) { res.push(null); continue; }
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
    res.push(Math.sqrt(variance));
  }
  return res;
}

// 截面Z-score标准化
function crossSectionalZScore(values) {
  const valid = values.filter(v => v != null && isFinite(v));
  if (valid.length < 3) return values.map(() => 0);
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const std = Math.sqrt(valid.reduce((s, v) => s + (v - mean) ** 2, 0) / valid.length);
  if (std === 0) return values.map(() => 0);
  return values.map(v => (v != null && isFinite(v)) ? (v - mean) / std : 0);
}

// Winsorize (缩尾)
function winsorize(values, sigma = 3) {
  return values.map(v => {
    if (v == null || !isFinite(v)) return 0;
    return Math.max(-sigma, Math.min(sigma, v));
  });
}

// ==================== 单因子计算 ====================

// 对单只股票, 基于日K线计算所有因子原始值
function computeStockFactors(klines) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const rets = returns(closes);
  const last = closes.length - 1;
  const D = closes.length; // total days

  const factors = {};

  // ---------- 1. 动量因子 ----------
  // 12-1月动量 (跳过最近1月, 避免短期反转干扰)
  const mom12_1 = last >= 250 && closes[last - 20] > 0
    ? (closes[last] - closes[Math.max(0, last - 240)]) / closes[Math.max(0, last - 240)]
    : (last >= 60 && closes[last - 5] > 0 ? (closes[last] - closes[Math.max(0, last - 60)]) / closes[Math.max(0, last - 60)] : 0);
  factors.mom12_1 = mom12_1;

  // 6月动量
  const mom6 = last >= 120 && closes[last - 120] > 0
    ? (closes[last] - closes[last - 120]) / closes[last - 120] : mom12_1;
  factors.mom6 = mom6;

  // 3月动量
  const mom3 = last >= 60 && closes[last - 60] > 0
    ? (closes[last] - closes[last - 60]) / closes[last - 60] : mom6;
  factors.mom3 = mom3;

  // 风险调整动量 (动量/波动率, 更稳健)
  const retSlice = rets.slice(-Math.min(120, rets.length)).filter(v => v != null);
  const retStd = retSlice.length > 10
    ? Math.sqrt(retSlice.reduce((s, v) => s + v ** 2, 0) / retSlice.length) : 0.02;
  factors.momRiskAdj = retStd > 0.001 ? mom6 / (retStd * Math.sqrt(120)) : mom6;

  // ---------- 2. 价值因子 ----------
  // 距52周(250日)高点回撤比
  const h52w = Math.max(...highs.slice(-Math.min(250, D)));
  factors.value52w = h52w > 0 ? (h52w - closes[last]) / h52w : 0;  // 正值=折价大=价值高

  // 距60日高点回撤
  const h60d = Math.max(...highs.slice(-60));
  factors.value60d = h60d > 0 ? (h60d - closes[last]) / h60d : 0;

  // 回撤恢复率 (当前价格 / 从最低点恢复程度)
  const l60 = Math.min(...lows.slice(-60));
  const recoveryRange = h60d - l60;
  factors.recovery = recoveryRange > 0 ? (closes[last] - l60) / recoveryRange : 0.5;

  // ---------- 3. 质量因子 ----------
  // 日收益Sharpe比率 (过去60交易日)
  const ret60 = rets.slice(-60).filter(v => v != null);
  if (ret60.length > 20) {
    const meanRet = ret60.reduce((a, b) => a + b, 0) / ret60.length;
    const stdRet = Math.sqrt(ret60.reduce((s, v) => s + (v - meanRet) ** 2, 0) / ret60.length);
    factors.sharpe = stdRet > 0.0001 ? meanRet / stdRet * Math.sqrt(252) : 0;
  } else {
    factors.sharpe = 0;
  }

  // 收益稳定性 (正收益天数占比)
  const upDays = ret60.filter(r => r > 0).length;
  factors.stability = ret60.length > 0 ? upDays / ret60.length : 0.5;

  // 最大回撤恢复天数
  let maxDD = 0, peak = closes[0], ddStart = 0, ddDuration = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > peak) { peak = closes[i]; ddStart = i; }
    const dd = (peak - closes[i]) / peak;
    if (dd > maxDD) { maxDD = dd; ddDuration = i - ddStart; }
  }
  factors.maxDrawdown = maxDD;
  factors.ddDuration = Math.min(1, ddDuration / Math.max(1, D)); // 归一化

  // ---------- 4. 低波动因子 ----------
  // 20日波动率
  const ret20 = rets.slice(-20).filter(v => v != null);
  const vol20 = ret20.length > 5
    ? Math.sqrt(ret20.reduce((s, v) => s + v ** 2, 0) / ret20.length) * Math.sqrt(252)
    : 0.3;
  factors.vol20 = vol20;

  // 60日波动率
  const vol60 = ret60.length > 20
    ? Math.sqrt(ret60.reduce((s, v) => s + v ** 2, 0) / ret60.length) * Math.sqrt(252)
    : vol20;
  factors.vol60 = vol60;

  // 下行波动率 (只计负收益)
  const downRets = ret60.filter(r => r < 0);
  const downVol = downRets.length > 5
    ? Math.sqrt(downRets.reduce((s, v) => s + v ** 2, 0) / downRets.length) * Math.sqrt(252)
    : vol60;
  factors.downVol = downVol;

  // ---------- 5. 规模因子 ----------
  // 市值代理: 价格 × 成交量(流动性代理)
  const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sizeProxy = avgPrice * avgVol; // 日成交额代理
  factors.size = sizeProxy > 0 ? Math.log(sizeProxy) : 0;  // 小盘股size值小

  // ---------- 6. 成长因子 ----------
  // 成交量增长 (近20日 vs 前20-40日)
  const avgV20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const avgV40_20 = volumes.slice(-40, -20).reduce((a, b) => a + b, 0) / 20;
  factors.volGrowth = avgV40_20 > 0 ? (avgV20 - avgV40_20) / avgV40_20 : 0;

  // 价格加速度 (近期涨速 vs 远期涨速)
  const chg20d = last >= 20 && closes[last - 20] > 0 ? (closes[last] - closes[last - 20]) / closes[last - 20] : 0;
  const chg40_20 = last >= 40 && closes[last - 20] > 0 && closes[last - 40] > 0
    ? (closes[last - 20] - closes[last - 40]) / closes[last - 40] : 0;
  factors.priceAccel = chg20d - chg40_20; // 正值=在加速涨

  // ---------- 7. 流动性因子 ----------
  // Amihud 非流动性比率: avg(|return| / volume)
  let amihudSum = 0, amihudCount = 0;
  for (let i = Math.max(1, rets.length - 60); i < rets.length; i++) {
    if (rets[i] != null && volumes[i] > 0) {
      amihudSum += Math.abs(rets[i]) / (volumes[i] * closes[i] / 1e8); // scaled
      amihudCount++;
    }
  }
  factors.amihud = amihudCount > 10 ? amihudSum / amihudCount : 0;

  // 换手率代理 (量/流通市值代理)
  factors.turnover = sizeProxy > 0 ? (avgVol * avgPrice) / sizeProxy : 1; // normalized

  // ---------- 8. 反转因子 ----------
  // 短期反转: 最近5日收益 (负相关: 跌多了会反弹)
  const ret5d = last >= 5 && closes[last - 5] > 0 ? (closes[last] - closes[last - 5]) / closes[last - 5] : 0;
  factors.rev5 = -ret5d; // 取反: 跌得越多, rev5越大, 预期反弹越强

  // 中期反转: 最近20日
  factors.rev20 = -chg20d;

  // 量价背离: 价跌量缩 → 反转信号
  const priceDir = chg20d >= 0 ? 1 : -1;
  const volDir = factors.volGrowth >= 0 ? 1 : -1;
  factors.divergence = priceDir !== volDir ? (priceDir < 0 ? 1 : -1) : 0; // 价跌量缩=看涨

  return factors;
}

// ==================== 全截面因子矩阵 ====================

// 因子方向配置: 1 = 越高越好, -1 = 越低越好
const FACTOR_DIRECTION = {
  mom12_1: 1, mom6: 1, mom3: 1, momRiskAdj: 1,
  value52w: 1, value60d: 1, recovery: -1, // recovery high → already recovered, less value
  sharpe: 1, stability: 1, maxDrawdown: -1, ddDuration: -1,
  vol20: -1, vol60: -1, downVol: -1,  // lower vol = better risk-adjusted
  size: -1,  // smaller size → lower raw → higher expected return → negate in composite
  volGrowth: 1, priceAccel: 1,
  amihud: 1,  // higher amihud = more illiquid = higher premium
  rev5: 1, rev20: 1, divergence: 1,
};

// 因子权重 (基于学术文献和经验IC)
const DEFAULT_FACTOR_WEIGHTS = {
  mom12_1: 0.10, mom6: 0.08, mom3: 0.05, momRiskAdj: 0.07,
  value52w: 0.10, value60d: 0.08, recovery: 0.0,
  sharpe: 0.08, stability: 0.05, maxDrawdown: -0.05, ddDuration: -0.03,
  vol20: -0.08, vol60: -0.05, downVol: -0.07,
  size: -0.05,
  volGrowth: 0.04, priceAccel: 0.03,
  amihud: 0.03,
  rev5: 0.04, rev20: 0.02, divergence: 0.03,
};

function computeCrossSectionalFactors(allStocksData) {
  // allStocksData: [{code, klines}, ...]
  // Step 1: compute raw factors per stock
  const rawFactors = allStocksData.map(s => ({
    code: s.code,
    factors: computeStockFactors(s.klines),
  }));

  // Step 2: collect factor names
  const factorNames = Object.keys(rawFactors[0]?.factors || {}).filter(k =>
    FACTOR_DIRECTION[k] !== undefined
  );

  // Step 3: cross-sectional Z-score for each factor
  const zScores = rawFactors.map(s => {
    const z = {};
    for (const name of factorNames) {
      z[name] = s.factors[name]; // will be overwritten
    }
    return { code: s.code, factors: z };
  });

  for (const name of factorNames) {
    const rawVals = rawFactors.map(s => {
      let v = s.factors[name];
      if (v == null || !isFinite(v)) v = 0;
      return v * FACTOR_DIRECTION[name]; // align direction before Z-score
    });
    const zVals = crossSectionalZScore(rawVals);
    const winVals = winsorize(zVals);
    for (let i = 0; i < zScores.length; i++) {
      zScores[i].factors[name] = winVals[i];
    }
  }

  // Step 4: composite Alpha
  const results = zScores.map(s => {
    let alpha = 0;
    let weightSum = 0;
    const exposures = {};
    for (const name of factorNames) {
      const w = DEFAULT_FACTOR_WEIGHTS[name] || 0;
      const absW = Math.abs(w);
      exposures[name] = s.factors[name];
      alpha += s.factors[name] * w;
      weightSum += absW;
    }
    // Normalize to [-100, 100] range
    const normAlpha = weightSum > 0 ? (alpha / weightSum) * 100 : 0;

    return {
      code: s.code,
      alpha: +normAlpha.toFixed(1),
      exposures,
    };
  });

  return results;
}

// 因子收益率时间序列 (用于分析因子表现)
function computeFactorReturns(allStocksData, lookback = 20) {
  const factorNames = Object.keys(DEFAULT_FACTOR_WEIGHTS);
  const series = [];

  for (let d = lookback; d >= 1; d--) {
    // For each day, compute the factor returns as the correlation
    // between factor exposures and next-period returns
    // Simplified: use daily cross-sectional regression
    const frame = [];
    for (const s of allStocksData) {
      const k = s.klines;
      if (k.length < d + 1) continue;
      const idx = k.length - 1 - d;
      const nextRet = k[idx + 1].close > 0 && k[idx].close > 0
        ? (k[idx + 1].close - k[idx].close) / k[idx].close : 0;
      if (Math.abs(nextRet) > 0.2) continue; // filter extreme moves

      // For factor exposures, use data up to idx
      const slicedKlines = k.slice(0, idx + 1);
      const factors = computeStockFactors(slicedKlines);

      const row = { code: s.code, ret: nextRet };
      for (const name of factorNames) {
        let v = factors[name];
        if (v == null || !isFinite(v)) v = 0;
        row[name] = v * (FACTOR_DIRECTION[name] || 1);
      }
      frame.push(row);
    }

    if (frame.length < 5) continue;

    // Cross-sectional Z-score the factors
    for (const name of factorNames) {
      const vals = frame.map(r => r[name]);
      const zVals = crossSectionalZScore(vals);
      const winVals = winsorize(zVals);
      for (let i = 0; i < frame.length; i++) frame[i][name] = winVals[i];
    }

    // Simple IC: correlation of each factor with forward returns
    const ic = {};
    for (const name of factorNames) {
      const xs = frame.map(r => r[name]);
      const ys = frame.map(r => r.ret);
      ic[name] = pearsonCorrelation(xs, ys);
    }

    // Composite IC
    let compositeIC = 0, wSum = 0;
    for (const name of factorNames) {
      const w = Math.abs(DEFAULT_FACTOR_WEIGHTS[name] || 0);
      compositeIC += (ic[name] || 0) * w;
      wSum += w;
    }
    ic.composite = wSum > 0 ? compositeIC / wSum : 0;

    series.push({
      date: allStocksData[0]?.klines[allStocksData[0].klines.length - 1 - d]?.date || `T-${d}`,
      ...ic,
    });
  }

  return series;
}

// Pearson相关系数
function pearsonCorrelation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const denom = Math.sqrt(varX * varY);
  return denom > 1e-10 ? cov / denom : 0;
}

// 因子IC统计
function factorICStats(factorReturns) {
  const stats = {};
  const factorNames = Object.keys(factorReturns[0] || {}).filter(k => k !== "date");
  for (const name of factorNames) {
    const ics = factorReturns.map(r => r[name]).filter(v => v != null && isFinite(v));
    if (ics.length < 3) { stats[name] = { meanIC: 0, icir: 0 }; continue; }
    const mean = ics.reduce((a, b) => a + b, 0) / ics.length;
    const std = Math.sqrt(ics.reduce((s, v) => s + (v - mean) ** 2, 0) / ics.length);
    stats[name] = {
      meanIC: +mean.toFixed(4),
      icir: std > 0 ? +(mean / std).toFixed(3) : 0, // Information Coefficient IR
      positiveRate: +(ics.filter(v => v > 0).length / ics.length * 100).toFixed(0),
    };
  }
  return stats;
}

module.exports = {
  computeStockFactors,
  computeCrossSectionalFactors,
  computeFactorReturns,
  factorICStats,
  DEFAULT_FACTOR_WEIGHTS,
  FACTOR_DIRECTION,
  crossSectionalZScore,
  winsorize,
  pearsonCorrelation,
};

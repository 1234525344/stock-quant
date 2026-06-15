// Genetic Algorithm Worker — 独立线程中运行 NSGA-II 进化
// 接收 { klines, opts, mode }
// mode: 'evolve' (权重进化) 或 'discover' (因子发现)
// 返回进化结果

const { parentPort } = require("worker_threads");

// ==================== 内联指标 ====================

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

function BOLL(closes, n = 20, mult = 2) {
  const mid = SMA(closes, n);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    let sumSq = 0;
    for (let j = i - n + 1; j <= i; j++) sumSq += (closes[j] - mid[i]) ** 2;
    const std = Math.sqrt(sumSq / n);
    upper[i] = mid[i] + mult * std;
    lower[i] = mid[i] - mult * std;
  }
  return { mid, upper, lower };
}

function KDJ(highs, lows, closes, n = 9) {
  const k = new Array(closes.length).fill(50);
  const d = new Array(closes.length).fill(50);
  const j = new Array(closes.length).fill(50);
  for (let i = n - 1; i < closes.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let t = i - n + 1; t <= i; t++) {
      hh = Math.max(hh, highs[t]);
      ll = Math.min(ll, lows[t]);
    }
    const rsv = hh !== ll ? (closes[i] - ll) / (hh - ll) * 100 : 50;
    k[i] = (i > n - 1) ? k[i - 1] * 2 / 3 + rsv / 3 : rsv;
    d[i] = (i > n - 1) ? d[i - 1] * 2 / 3 + k[i] / 3 : k[i];
    j[i] = 3 * k[i] - 2 * d[i];
  }
  return { k, d, j };
}

function MACD(closes) {
  const ema12 = EMA(closes, 12), ema26 = EMA(closes, 26);
  const dif = ema12.map((v, i) => v - ema26[i]);
  const dea = EMA(dif, 9);
  const macd = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, macd };
}

// ==================== 因子池 (30+) ====================

const FACTOR_POOL = [
  { name: "ma_trend",        fn: (ctx) => ctx.closes[ctx.i] > ctx.ma20[ctx.i] && ctx.ma20[ctx.i] > ctx.ma60[ctx.i] ? 100 : 30 },
  { name: "ma_slope",        fn: (ctx) => ctx.ma20[ctx.i] && ctx.ma20[ctx.i-10] ? (ctx.ma20[ctx.i]/ctx.ma20[ctx.i-10]-1)*1000 : 50 },
  { name: "price_vs_ma60",   fn: (ctx) => ctx.ma60[ctx.i] ? (ctx.closes[ctx.i]/ctx.ma60[ctx.i]-1)*100+50 : 50 },
  { name: "adx_proxy",       fn: (ctx) => ctx._directionalMove ? ctx._directionalMove(ctx, 14) : 50 },
  { name: "ma_convergence",  fn: (ctx) => ctx.ma5[ctx.i]&&ctx.ma20[ctx.i]&&ctx.ma60[ctx.i] ? 100-Math.abs(ctx.ma5[ctx.i]-ctx.ma20[ctx.i])/ctx.ma20[ctx.i]*100-Math.abs(ctx.ma20[ctx.i]-ctx.ma60[ctx.i])/ctx.ma60[ctx.i]*100 : 50 },
  { name: "roc_5",           fn: (ctx) => ctx.i>=5 ? (ctx.closes[ctx.i]/ctx.closes[ctx.i-5]-1)*100+50 : 50 },
  { name: "roc_10",          fn: (ctx) => ctx.i>=10 ? (ctx.closes[ctx.i]/ctx.closes[ctx.i-10]-1)*100+50 : 50 },
  { name: "roc_20",          fn: (ctx) => ctx.i>=20 ? (ctx.closes[ctx.i]/ctx.closes[ctx.i-20]-1)*100+50 : 50 },
  { name: "macd_divergence", fn: (ctx) => ctx.macdHist?.[ctx.i] ? Math.min(100,50+ctx.macdHist[ctx.i]/ctx.closes[ctx.i]*500) : 50 },
  { name: "macd_cross",      fn: (ctx) => ctx.macdDif?.[ctx.i]&&ctx.macdDea?.[ctx.i] ? (ctx.macdDif[ctx.i]-ctx.macdDea[ctx.i])/ctx.closes[ctx.i]*500+50 : 50 },
  { name: "boll_position",   fn: (ctx) => ctx.bollLower?.[ctx.i]&&ctx.bollUpper?.[ctx.i] ? (ctx.closes[ctx.i]-ctx.bollLower[ctx.i])/(ctx.bollUpper[ctx.i]-ctx.bollLower[ctx.i])*100 : 50 },
  { name: "boll_width",      fn: (ctx) => ctx.bollUpper?.[ctx.i]&&ctx.bollMid?.[ctx.i] ? (ctx.bollUpper[ctx.i]-ctx.bollLower[ctx.i])/ctx.bollMid[ctx.i]*100 : 50 },
  { name: "dist_from_high",  fn: (ctx) => ctx._high52w ? (1-ctx.closes[ctx.i]/ctx._high52w)*100 : 50 },
  { name: "dist_from_low",   fn: (ctx) => (ctx.closes[ctx.i]/ctx._low52w-1)*100 },
  { name: "rsi_zone",        fn: (ctx) => ctx.rsi14?.[ctx.i] || 50 },
  { name: "vol_ratio",       fn: (ctx) => ctx.i>=5 ? ctx.volumes[ctx.i]/ctx.volumes.slice(ctx.i-5,ctx.i).reduce((a,b)=>a+b,0)*5*50 : 50 },
  { name: "vol_trend",       fn: (ctx) => ctx.i>=20 ? ctx.volumes.slice(ctx.i-20,ctx.i).reduce((a,b)=>a+b,0)/ctx.volumes.slice(ctx.i-40,ctx.i-20).reduce((a,b)=>a+b||1,0)*50 : 50 },
  { name: "obv_divergence",  fn: (ctx) => ctx._obvDiv ? ctx._obvDiv(ctx) : 50 },
  { name: "vwap_position",   fn: (ctx) => ctx._vwap ? ctx._vwap(ctx) : 50 },
  { name: "mfi_proxy",       fn: (ctx) => ctx._mfi ? ctx._mfi(ctx, 14) : 50 },
  { name: "volatility_20",   fn: (ctx) => ctx._vol20 ? 100-ctx._vol20(ctx)*100 : 50 },
  { name: "volatility_cone", fn: (ctx) => ctx._volCone ? ctx._volCone(ctx) : 50 },
  { name: "atr_pct",         fn: (ctx) => ctx._atrPct ? ctx._atrPct(ctx, 14) : 50 },
  { name: "beta_proxy",      fn: (ctx) => ctx._beta ? ctx._beta(ctx) : 50 },
  { name: "rsi_reversal",    fn: (ctx) => ctx.rsi14?.[ctx.i] ? (ctx.rsi14[ctx.i]<30 ? 100-ctx.rsi14[ctx.i] : ctx.rsi14[ctx.i]>70 ? ctx.rsi14[ctx.i]-70 : 0) : 0 },
  { name: "boll_reversal",   fn: (ctx) => ctx.bollLower?.[ctx.i] ? (ctx.closes[ctx.i]<ctx.bollLower[ctx.i] ? 100 : ctx.closes[ctx.i]>ctx.bollUpper[ctx.i] ? 0 : 50) : 50 },
  { name: "kdj_reversal",    fn: (ctx) => ctx.kdjJ?.[ctx.i] ? (ctx.kdjJ[ctx.i]<0 ? 100 : ctx.kdjJ[ctx.i]>100 ? 0 : 50) : 50 },
  { name: "gap_fill",        fn: (ctx) => ctx._gapFill ? ctx._gapFill(ctx) : 50 },
  { name: "t3_pullback",     fn: (ctx) => ctx._t3Signal ? ctx._t3Signal(ctx) : 50 },
  { name: "pullback_depth",  fn: (ctx) => ctx.ma10?.[ctx.i] ? (1-ctx.closes[ctx.i]/ctx.ma10[ctx.i])*100+50 : 50 },
  { name: "sharpe_20",       fn: (ctx) => ctx._rollingSharpe ? ctx._rollingSharpe(ctx,20) : 50 },
  { name: "sortino_20",      fn: (ctx) => ctx._rollingSortino ? ctx._rollingSortino(ctx,20) : 50 },
];

// ==================== 上下文构建 ====================

function buildContext(klines) {
  const closes  = klines.map(k => k.close);
  const highs   = klines.map(k => k.high);
  const lows    = klines.map(k => k.low);
  const opens   = klines.map(k => k.open);
  const volumes = klines.map(k => k.volume);

  const ma5  = SMA(closes, 5);
  const ma10 = SMA(closes, 10);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);
  const { dif, dea, macd: macdHist } = MACD(closes);
  const rsi14 = RSI(closes, 14);
  const { mid, upper, lower } = BOLL(closes);
  const { k, d, j } = KDJ(highs, lows, closes);

  const _high52w = Math.max(...highs.slice(-252));
  const _low52w  = Math.min(...lows.slice(-252));

  function _vol20(ctx) {
    if (ctx.i < 20) return 0.3;
    const rets = [];
    for (let t = ctx.i-19; t <= ctx.i; t++) {
      if (closes[t-1] > 0) rets.push((closes[t]-closes[t-1])/closes[t-1]);
    }
    return Math.sqrt(rets.reduce((s,r)=>s+r*r,0)/rets.length)*Math.sqrt(252);
  }

  function _atrPct(ctx, n) {
    if (ctx.i < n) return 0.03;
    let tr = 0;
    for (let t = ctx.i-n+1; t <= ctx.i; t++) {
      tr += Math.max(highs[t]-lows[t], Math.abs(highs[t]-closes[t-1]), Math.abs(lows[t]-closes[t-1]));
    }
    return (tr/n)/closes[ctx.i];
  }

  function _mfi(ctx, n) {
    if (ctx.i < n) return 50;
    let posFlow = 0, negFlow = 0;
    for (let t = ctx.i-n+1; t <= ctx.i; t++) {
      const tp = (highs[t]+lows[t]+closes[t])/3;
      const prev = (highs[t-1]+lows[t-1]+closes[t-1])/3 || 1;
      const rmf = tp * volumes[t];
      if (tp > prev) posFlow += rmf; else negFlow += rmf;
    }
    return negFlow>0 ? 100-100/(1+posFlow/negFlow) : 100;
  }

  function _volCone(ctx) {
    const vols = [];
    for (let w = 5; w <= 60; w += 5) {
      if (ctx.i >= w) {
        const rets = [];
        for (let t = ctx.i-w+1; t <= ctx.i; t++) if (closes[t-1]>0) rets.push((closes[t]-closes[t-1])/closes[t-1]);
        vols.push(Math.sqrt(rets.reduce((s,r)=>s+r*r,0)/rets.length)*Math.sqrt(252));
      }
    }
    const currentVol = vols[vols.length-1] || 0;
    const sorted = [...vols].sort((a,b)=>a-b);
    const idx = sorted.findIndex(v=>v>=currentVol);
    return idx>=0 ? idx/sorted.length*100 : 50;
  }

  function _rollingSharpe(ctx, n) {
    if (ctx.i < n) return 0;
    const rets = [];
    for (let t = ctx.i-n+1; t <= ctx.i; t++) if (closes[t-1]>0) rets.push((closes[t]-closes[t-1])/closes[t-1]);
    const avg = rets.reduce((a,b)=>a+b,0)/rets.length;
    const std = Math.sqrt(rets.reduce((s,r)=>s+(r-avg)**2,0)/rets.length);
    return std>0 ? Math.min(3, avg/std*Math.sqrt(252)) : 0;
  }

  function _rollingSortino(ctx, n) {
    if (ctx.i < n) return 0;
    const rets = [];
    for (let t = ctx.i-n+1; t <= ctx.i; t++) if (closes[t-1]>0) rets.push((closes[t]-closes[t-1])/closes[t-1]);
    const avg = rets.reduce((a,b)=>a+b,0)/rets.length;
    const downs = rets.filter(r=>r<0).map(r=>r*r);
    const downStd = Math.sqrt(downs.reduce((a,b)=>a+b,0)/rets.length);
    return downStd>0 ? Math.min(3, avg/downStd*Math.sqrt(252)) : 0;
  }

  function _directionalMove(ctx, n) {
    if (ctx.i < n) return 50;
    let plusDM=0, minusDM=0, trSum=0;
    for (let t = ctx.i-n+1; t <= ctx.i; t++) {
      const up = highs[t]-highs[t-1];
      const dn = lows[t-1]-lows[t];
      plusDM += (up>dn && up>0) ? up : 0;
      minusDM += (dn>up && dn>0) ? dn : 0;
      trSum += Math.max(highs[t]-lows[t], Math.abs(highs[t]-closes[t-1]), Math.abs(lows[t]-closes[t-1]));
    }
    if (trSum===0) return 50;
    const pdi = plusDM/trSum*100;
    const ndi = minusDM/trSum*100;
    return (pdi+ndi)>0 ? Math.abs(pdi-ndi)/(pdi+ndi)*100 : 0;
  }

  function _obvDiv(ctx) {
    if (ctx.i < 20) return 50;
    const obv = [0];
    for (let t=1; t<=ctx.i; t++) {
      const sign = closes[t]>closes[t-1] ? volumes[t] : closes[t]<closes[t-1] ? -volumes[t] : 0;
      obv.push(obv[obv.length-1]+sign);
    }
    const obvSlope = (obv[obv.length-1]-obv[obv.length-21])/20;
    const priceSlope = (closes[ctx.i]-closes[ctx.i-20])/20;
    return priceSlope>0&&obvSlope<0 ? 20 : priceSlope<0&&obvSlope>0 ? 80 : 50;
  }

  function _vwap(ctx) {
    if (ctx.i < 5) return 50;
    let num=0, den=0;
    for (let t=ctx.i-4; t<=ctx.i; t++) { num+=closes[t]*volumes[t]; den+=volumes[t]; }
    const vwap = den>0 ? num/den : closes[ctx.i];
    return (closes[ctx.i]/vwap-1)*100+50;
  }

  function _beta(ctx) {
    if (ctx.i < 60) return 50;
    const rets=[], maRets=[];
    for (let t=ctx.i-59; t<=ctx.i; t++) {
      if (closes[t-1]>0) rets.push((closes[t]-closes[t-1])/closes[t-1]);
      if (ma60[t] && ma60[t-1]) maRets.push((ma60[t]-ma60[t-1])/ma60[t-1]);
    }
    const avgR = rets.reduce((a,b)=>a+b,0)/rets.length;
    const avgM = maRets.reduce((a,b)=>a+b,0)/maRets.length;
    let cov=0, mVar=0;
    for (let t=0; t<rets.length; t++) { cov+=(rets[t]-avgR)*(maRets[t]-avgM); mVar+=(maRets[t]-avgM)**2; }
    return mVar>0 ? Math.min(3, Math.max(0, cov/mVar)) : 1;
  }

  function _gapFill(ctx) {
    if (ctx.i<2) return 50;
    if (opens[ctx.i] > closes[ctx.i-1]*1.01) return 80;
    if (opens[ctx.i] < closes[ctx.i-1]*0.99) return 20;
    return 50;
  }

  function _t3Signal(ctx) {
    if (ctx.i < 4) return 50;
    const t0 = closes[ctx.i-3], t0o=opens[ctx.i-3], t0v=volumes[ctx.i-3];
    const t1o=opens[ctx.i-2], t1c=closes[ctx.i-2];
    const t2o=opens[ctx.i-1], t2c=closes[ctx.i-1];
    if (t0<=0||t1c<=0||t2c<=0) return 50;
    const t0chg = (t0-t0o)/t0o*100;
    const t1chg = (t1c-t1o)/t1o*100;
    const avgVol5 = ctx.i>=8 ? volumes.slice(ctx.i-8,ctx.i-3).reduce((a,b)=>a+b,0)/5 : t0v;
    const volRatio = avgVol5>0 ? t0v/avgVol5 : 1;
    let score = 50;
    if (volRatio>=0.8 && t0chg<9.5 && t1chg>=9.5 && t2c<t2o) score = 85;
    return score;
  }

  return {
    closes, highs, lows, opens, volumes,
    ma5, ma10, ma20, ma60,
    macdDif: dif, macdDea: dea, macdHist,
    rsi14,
    bollMid: mid, bollUpper: upper, bollLower: lower,
    kdjJ: j,
    _high52w, _low52w,
    _vol20, _atrPct, _mfi, _volCone, _rollingSharpe, _rollingSortino,
    _directionalMove, _obvDiv, _vwap, _beta, _gapFill, _t3Signal,
  };
}

// ==================== 工具函数 ====================

function pearsonCorr(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 10) return 0;
  const mx = x.slice(0,n).reduce((a,b)=>a+b,0)/n;
  const my = y.slice(0,n).reduce((a,b)=>a+b,0)/n;
  let cov=0, vx=0, vy=0;
  for (let i=0;i<n;i++) { const dx=x[i]-mx, dy=y[i]-my; cov+=dx*dy; vx+=dx*dx; vy+=dy*dy; }
  return vx>0&&vy>0 ? cov/Math.sqrt(vx*vy) : 0;
}

function deduplicateFactors(factorValues, factorNames, threshold = 0.85) {
  const keep = new Set(factorNames.map((_,i) => i));
  const removed = [];
  for (let i = 0; i < factorNames.length; i++) {
    if (!keep.has(i)) continue;
    for (let j = i + 1; j < factorNames.length; j++) {
      if (!keep.has(j)) continue;
      const corr = pearsonCorr(factorValues[i], factorValues[j]);
      if (Math.abs(corr) > threshold) {
        keep.delete(j);
        removed.push({ name: factorNames[j], correlatedWith: factorNames[i], corr: +corr.toFixed(3) });
      }
    }
  }
  return {
    keptIndices: [...keep].sort((a,b)=>a-b),
    keptNames: [...keep].sort((a,b)=>a-b).map(i => factorNames[i]),
    removed,
    nBefore: factorNames.length,
    nAfter: keep.size,
  };
}

// ==================== 模拟交易 ====================

function simulateTrade(klines, weights, activeFactorNames, ctx) {
  const activeIndices = activeFactorNames.map(n => FACTOR_POOL.findIndex(f => f.name === n)).filter(i => i >= 0);
  const n = klines.length;

  const factorValues = activeIndices.map(fi => {
    const def = FACTOR_POOL[fi];
    const vals = new Array(n).fill(50);
    for (let i = 60; i < n; i++) {
      try { vals[i] = def.fn({ ...ctx, i }); } catch(_) {}
    }
    return vals;
  });

  const normalized = factorValues.map(fv => {
    const valid = fv.slice(60).filter(v => isFinite(v));
    if (valid.length===0) return fv;
    const min = Math.min(...valid), max = Math.max(...valid);
    const range = max-min || 1;
    return fv.map(v => isFinite(v) ? (v-min)/range : 0.5);
  });

  const scores = new Array(n).fill(0);
  for (let i = 60; i < n; i++) {
    for (let j = 0; j < activeIndices.length; j++) {
      scores[i] += weights[j] * normalized[j][i];
    }
  }

  const signals = scores.map((s,i) => {
    if (i < 60) return 0;
    if (s > 0.55) return 1;
    if (s < 0.45) return -1;
    return 0;
  });

  let cash = 100000, position = 0, buyCost = 0;
  let peak = 100000, maxDD = 0; let equity = 100000;
  let pos = 0; let tradeCount = 0; let wins = 0;
  const dailyReturns = [];

  for (let i = 61; i < n; i++) {
    const price = ctx.closes[i];
    if (signals[i]===1 && pos===0) {
      buyCost = equity * 0.15;
      pos = buyCost / price;
      equity = 0;
      tradeCount++;
    } else if (signals[i]===-1 && pos>0) {
      const sellAmt = pos * price;
      if (sellAmt > buyCost) wins++;
      equity = sellAmt;
      pos = 0;
      dailyReturns.push((sellAmt - buyCost) / buyCost);
    }
    const eq = equity + pos * price;
    if (eq > peak) peak = eq;
    const dd = (peak-eq)/peak;
    if (dd > maxDD) maxDD = dd;
  }

  const finalVal = equity + pos * ctx.closes[n-1];
  const totalReturn = (finalVal/100000-1)*100;
  const sharpe = dailyReturns.length > 5
    ? (dailyReturns.reduce((a,b)=>a+b,0)/dailyReturns.length)/(Math.sqrt(dailyReturns.reduce((s,r)=>s+r*r,0)/dailyReturns.length)||0.01)*Math.sqrt(252)
    : 0;
  const sortino = dailyReturns.length > 5
    ? (dailyReturns.reduce((a,b)=>a+b,0)/dailyReturns.length)/(Math.sqrt(dailyReturns.filter(r=>r<0).map(r=>r*r).reduce((a,b)=>a+b,0)/dailyReturns.length)||0.01)*Math.sqrt(252)
    : 0;
  const winRate = tradeCount>0 ? wins/tradeCount*100 : 0;
  const turnoverPenalty = tradeCount>n*0.3 ? (tradeCount-n*0.3)*0.5 : 0;

  return {
    totalReturn: +totalReturn.toFixed(2),
    sharpe: +sharpe.toFixed(3),
    sortino: +sortino.toFixed(3),
    maxDD: +(maxDD*100).toFixed(2),
    tradeCount,
    winRate: +winRate.toFixed(1),
    turnoverPenalty: +turnoverPenalty.toFixed(2),
  };
}

// ==================== NSGA-II ====================

function nonDominatedSort(population) {
  const fronts = [[]];
  const n = population.length;
  const dominated = Array.from({ length: n }, () => []);
  const domCount = new Array(n).fill(0);

  for (let p = 0; p < n; p++) {
    for (let q = 0; q < n; q++) {
      if (p === q) continue;
      if (dominates(population[p], population[q])) {
        dominated[p].push(q);
      } else if (dominates(population[q], population[p])) {
        domCount[p]++;
      }
    }
    if (domCount[p] === 0) {
      population[p].rank = 0;
      fronts[0].push(p);
    }
  }

  let i = 0;
  while (fronts[i].length > 0) {
    const nextFront = [];
    for (const p of fronts[i]) {
      for (const q of dominated[p]) {
        domCount[q]--;
        if (domCount[q] === 0) {
          population[q].rank = i + 1;
          nextFront.push(q);
        }
      }
    }
    i++;
    fronts.push(nextFront);
  }
  return fronts.filter(f => f.length > 0);
}

function dominates(a, b) {
  const oa = a.objectives, ob = b.objectives;
  if (!oa || !ob) return false;
  let better = false;
  for (let i = 0; i < oa.length; i++) {
    if (oa[i] < ob[i]) return false;
    if (oa[i] > ob[i]) better = true;
  }
  return better;
}

function assignCrowdingDistance(population, fronts) {
  for (const ind of population) ind.crowdingDist = 0;
  const m = population[0]?.objectives?.length || 5;

  for (const front of fronts) {
    if (front.length <= 2) continue;
    for (let objIdx = 0; objIdx < m; objIdx++) {
      const sorted = [...front].sort((a,b) => population[a].objectives[objIdx] - population[b].objectives[objIdx]);
      const minObj = population[sorted[0]].objectives[objIdx];
      const maxObj = population[sorted[sorted.length-1]].objectives[objIdx];
      const range = maxObj - minObj || 1;
      population[sorted[0]].crowdingDist = Infinity;
      population[sorted[sorted.length-1]].crowdingDist = Infinity;
      for (let i = 1; i < sorted.length - 1; i++) {
        population[sorted[i]].crowdingDist +=
          (population[sorted[i+1]].objectives[objIdx] - population[sorted[i-1]].objectives[objIdx]) / range;
      }
    }
  }
}

function walkForwardValidate(klines, weights, activeFactorNames, ctx, nFolds = 4) {
  const totalLen = klines.length;
  const foldSize = Math.floor(totalLen / (nFolds + 1));
  if (foldSize < 60) return { trainScore: 0, testScore: 0, folds: [], overfitPenalty: 0 };

  const folds = [];
  for (let f = 0; f < nFolds; f++) {
    const trainEnd = foldSize * (f + 1);
    const testEnd  = Math.min(totalLen, foldSize * (f + 2));
    const trainKlines = klines.slice(0, trainEnd);
    const testKlines  = klines.slice(trainEnd, testEnd);
    if (trainKlines.length < 60 || testKlines.length < 30) continue;

    const trainCtx = buildContext(trainKlines);
    const testCtx = buildContext(testKlines);
    const trainResult = simulateTrade(trainKlines, weights, activeFactorNames, trainCtx);
    const testResult  = simulateTrade(testKlines, weights, activeFactorNames, testCtx);

    folds.push({
      trainReturn: trainResult.totalReturn,
      testReturn:  testResult.totalReturn,
      trainSharpe: trainResult.sharpe,
      testSharpe:  testResult.sharpe,
      trainMaxDD:  trainResult.maxDD,
      testMaxDD:   testResult.maxDD,
      overfit:     Math.max(0, trainResult.totalReturn - testResult.totalReturn),
    });
  }

  if (folds.length === 0) return { trainScore: 0, testScore: 0, folds: [], overfitPenalty: 0 };

  const avgTestReturn  = folds.reduce((s,f)=>s+f.testReturn,0)/folds.length;
  const avgTestSharpe  = folds.reduce((s,f)=>s+f.testSharpe,0)/folds.length;
  const avgTestMaxDD   = folds.reduce((s,f)=>s+f.testMaxDD,0)/folds.length;
  const avgOverfit     = folds.reduce((s,f)=>s+f.overfit,0)/folds.length;

  return {
    trainScore: folds.reduce((s,f)=>s+f.trainReturn,0)/folds.length,
    testScore: avgTestSharpe*0.5 + avgTestReturn*0.3 - avgTestMaxDD*0.2,
    folds,
    overfitPenalty: avgOverfit * 0.5,
    avgTestSharpe,
    avgTestReturn,
    avgTestMaxDD,
  };
}

// ==================== 权重进化 ====================

function evolveWeights(klines, opts = {}) {
  const popSize      = opts.popSize   || 60;
  const maxGen       = opts.maxGen    || 40;
  const baseMutRate  = opts.mutRate   || 0.15;
  const crossRate    = opts.crossRate || 0.7;
  const eliteCount   = Math.max(3, Math.floor(popSize * 0.1));

  const ctx = buildContext(klines);
  const n = klines.length;
  const allFactorValues = FACTOR_POOL.map(def => {
    const vals = new Array(n).fill(50);
    for (let i = 60; i < n; i++) {
      try { vals[i] = def.fn({ ...ctx, i }); } catch(_) {}
    }
    return vals;
  });

  const dedup = deduplicateFactors(allFactorValues, FACTOR_POOL.map(f=>f.name));
  const activeFactorNames = dedup.keptNames;
  const nFactors = activeFactorNames.length;

  const wfEnabled = opts.walkForward !== false && klines.length > 200;

  let population = [];
  for (let i = 0; i < popSize; i++) {
    const w = Array.from({ length: nFactors }, () => Math.random());
    const sum = w.reduce((a,b)=>a+b,0);
    const weights = sum>0 ? w.map(v=>v/sum) : w.map(()=>1/nFactors);
    population.push({ weights, objectives: null, crowdingDist: 0 });
  }

  let bestEver = { weights: [], fitness: -Infinity, objectives: null, generation: 0 };
  const history = [];
  let stagnationCounter = 0;
  let prevBestFitness = -Infinity;

  for (let gen = 0; gen < maxGen; gen++) {
    const mutRate = baseMutRate * (1 + stagnationCounter / 3);

    for (const ind of population) {
      const result = simulateTrade(klines, ind.weights, activeFactorNames, ctx);
      ind.objectives = [
        result.sharpe,
        result.totalReturn * 0.1,
        -result.maxDD * 0.01,
        result.sortino,
        -result.turnoverPenalty,
      ];
      const fitness = result.sharpe*0.4 + result.sortino*0.2 + result.totalReturn*0.02
        - result.maxDD*0.003 - result.turnoverPenalty*0.1 + result.winRate*0.01;
      ind.fitness = fitness;
      ind.tradeResult = result;

      if (fitness > bestEver.fitness) {
        bestEver = {
          weights: [...ind.weights],
          fitness,
          objectives: [...ind.objectives],
          generation: gen,
          tradeResult: result,
          weightsMap: Object.fromEntries(activeFactorNames.map((n,i) => [n, +ind.weights[i].toFixed(4)])),
        };
      }
    }

    if (gen > 0 && bestEver.fitness - prevBestFitness < 0.01) {
      stagnationCounter++;
    } else {
      stagnationCounter = Math.max(0, stagnationCounter - 1);
    }
    prevBestFitness = bestEver.fitness;

    const fronts = nonDominatedSort(population);
    assignCrowdingDistance(population, fronts);

    population.sort((a,b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return b.crowdingDist - a.crowdingDist;
    });

    history.push({
      gen,
      bestFitness: +bestEver.fitness.toFixed(4),
      avgFitness: +(population.reduce((s,i)=>s+(i.fitness||0),0)/popSize).toFixed(4),
      bestSharpe: bestEver.tradeResult?.sharpe,
      bestReturn: bestEver.tradeResult?.totalReturn,
      bestMaxDD:  bestEver.tradeResult?.maxDD,
      stagnation: stagnationCounter,
      nFactors,
      activeFactors: activeFactorNames.length,
    });

    if (gen === maxGen - 1) break;

    function tournament() {
      const k = 3; let best = null;
      for (let i = 0; i < k; i++) {
        const idx = Math.floor(Math.random() * popSize);
        const cand = population[idx];
        if (!best) { best = cand; continue; }
        if (cand.rank < best.rank || (cand.rank===best.rank && cand.crowdingDist > best.crowdingDist)) best = cand;
      }
      return best;
    }

    function crossover(p1, p2) {
      const child = [];
      const eta = 15;
      for (let i = 0; i < nFactors; i++) {
        if (Math.random() < 0.5) {
          let y1 = Math.min(p1.weights[i], p2.weights[i]);
          let y2 = Math.max(p1.weights[i], p2.weights[i]);
          if (y2 - y1 < 1e-6) { child.push(y1); continue; }
          const u = Math.random();
          const beta = u <= 0.5 ? Math.pow(2*u, 1/(eta+1)) : Math.pow(1/(2*(1-u)), 1/(eta+1));
          const c = 0.5*((y1+y2) - beta*(y2-y1));
          child.push(Math.max(0, Math.min(2, c)));
        } else {
          child.push(Math.random()<0.5 ? p1.weights[i] : p2.weights[i]);
        }
      }
      const sum = child.reduce((a,b)=>a+b,0);
      return sum>0 ? child.map(v=>v/sum) : child.map(()=>1/nFactors);
    }

    function mutate(ind) {
      const eta = 20;
      for (let i = 0; i < nFactors; i++) {
        if (Math.random() < mutRate) {
          const u = Math.random();
          const delta = u < 0.5
            ? Math.pow(2*u, 1/(eta+1)) - 1
            : 1 - Math.pow(2*(1-u), 1/(eta+1));
          ind.weights[i] += delta * 0.5;
          if (ind.weights[i] < 0) ind.weights[i] = 0;
          if (ind.weights[i] > 2) ind.weights[i] = 2;
        }
      }
      const sum = ind.weights.reduce((a,b)=>a+b,0);
      ind.weights = sum>0 ? ind.weights.map(v=>v/sum) : ind.weights.map(()=>1/nFactors);
    }

    function hammingDist(w1, w2) {
      return w1.reduce((d,v,i) => d + Math.abs(v-w2[i]), 0);
    }

    const nextGen = [];
    let elitesAdded = 0;
    for (let i = 0; i < population.length && elitesAdded < eliteCount; i++) {
      const candidate = population[i];
      const tooClose = nextGen.some(e => hammingDist(e.weights, candidate.weights) < 0.05);
      if (!tooClose) {
        nextGen.push({ weights: [...candidate.weights], objectives: null, crowdingDist: 0, fitness: candidate.fitness });
        elitesAdded++;
      }
    }
    while (nextGen.length < eliteCount) {
      const w = Array.from({length:nFactors},()=>Math.random());
      const sum = w.reduce((a,b)=>a+b,0);
      nextGen.push({ weights: sum>0?w.map(v=>v/sum):w.map(()=>1/nFactors), objectives:null, crowdingDist:0 });
    }

    while (nextGen.length < popSize) {
      const p1 = tournament();
      const p2 = tournament();
      if (Math.random() < crossRate) {
        const childWeights = crossover(p1, p2);
        const child = { weights: childWeights, objectives: null, crowdingDist: 0 };
        mutate(child);
        nextGen.push(child);
      } else {
        const parent = Math.random() < 0.5 ? p1 : p2;
        const child = { weights: [...parent.weights], objectives: null, crowdingDist: 0 };
        mutate(child);
        nextGen.push(child);
      }
    }
    population = nextGen.slice(0, popSize);
  }

  const paretoFront = population.filter(ind => ind.rank === 0).slice(0, 5);
  const wfResults = [];
  if (wfEnabled) {
    for (const ind of paretoFront) {
      const wf = walkForwardValidate(klines, ind.weights, activeFactorNames, ctx);
      wfResults.push({ weights: ind.weights, wf });
    }
    wfResults.sort((a,b) => b.wf.testScore - a.wf.testScore);
  }

  const finalBest = wfEnabled && wfResults.length > 0
    ? { ...bestEver, weights: wfResults[0].weights, weightsMap: Object.fromEntries(activeFactorNames.map((n,i) => [n, +wfResults[0].weights[i].toFixed(4)])), walkForward: wfResults[0].wf }
    : { ...bestEver };

  return {
    best: finalBest,
    paretoFront: paretoFront.map(ind => ({
      weights: ind.weights,
      objectives: ind.objectives,
      fitness: ind.fitness,
      weightsMap: Object.fromEntries(activeFactorNames.map((n,i) => [n, +ind.weights[i].toFixed(4)])),
    })),
    history,
    factorInfo: {
      total: FACTOR_POOL.length,
      active: activeFactorNames.length,
      activeNames: activeFactorNames,
      removed: dedup.removed,
    },
    walkForward: wfEnabled ? wfResults.map(r => r.wf) : null,
    converged: history.length >= 5 &&
      Math.abs(history[history.length-1].bestFitness - history[history.length-5].bestFitness) < 0.001,
  };
}

// ==================== GP 因子发现 ====================

const TERMINALS = [
  "close", "open", "high", "low", "volume", "turnover",
  "close_d1", "volume_d1", "close_d5", "close_d20",
  "const_1", "const_2", "const_05", "const_m1",
];
const FUNCTIONS = {
  "+":2, "-":2, "*":2, "/":2,
  "abs":1, "log":1, "max":2, "min":2,
  "sma5":1, "sma10":1, "sma20":1, "sma60":1,
  "ema5":1, "ema10":1, "ema20":1,
  "rsi":1, "roc5":1, "roc10":1, "roc20":1,
  "ifgt":3, "iflt":3, "divsafe":2,
  "sqrt":1, "square":1, "neg":1,
};

function geneToExpression(gene) {
  let idx = 0;
  function build() {
    if (idx >= gene.length) return "0";
    const token = gene[idx++];
    if (!(token in FUNCTIONS)) return token;
    const arity = FUNCTIONS[token];
    const args = [];
    for (let i = 0; i < arity; i++) args.push(build());
    return `(${token} ${args.join(" ")})`;
  }
  return build();
}

function evalGene(gene, row, smaCache, emaCache) {
  let idx = 0;
  function walk() {
    if (idx >= gene.length) return 0;
    const token = gene[idx++];
    const arity = FUNCTIONS[token];
    if (arity === undefined) {
      switch (token) {
        case "close": return row.close||0;
        case "open": return row.open||0;
        case "high": return row.high||0;
        case "low": return row.low||0;
        case "volume": return row.volume||0;
        case "turnover": return row.turnover||0;
        case "close_d1": return row.close_d1||row.close||0;
        case "volume_d1": return row.volume_d1||row.volume||0;
        case "close_d5": return row.close_d5||row.close||0;
        case "close_d20": return row.close_d20||row.close||0;
        case "const_1": return 1;
        case "const_2": return 2;
        case "const_05": return 0.5;
        case "const_m1": return -1;
        default: return parseFloat(token)||0;
      }
    }
    const args = [];
    for (let i=0;i<arity;i++) args.push(walk());
    switch (token) {
      case "+": return args[0]+args[1];
      case "-": return args[0]-args[1];
      case "*": return args[0]*args[1];
      case "/": case "divsafe": return args[1]!==0?args[0]/args[1]:0;
      case "abs": return Math.abs(args[0]);
      case "log": return args[0]>0?Math.log(args[0]):0;
      case "sqrt": return args[0]>0?Math.sqrt(args[0]):0;
      case "square": return args[0]*args[0];
      case "neg": return -args[0];
      case "max": return Math.max(args[0],args[1]);
      case "min": return Math.min(args[0],args[1]);
      case "sma5": return smaCache?.sma5||args[0];
      case "sma10": return smaCache?.sma10||args[0];
      case "sma20": return smaCache?.sma20||args[0];
      case "sma60": return smaCache?.sma60||args[0];
      case "ema5": return emaCache?.ema5||args[0];
      case "ema10": return emaCache?.ema10||args[0];
      case "ema20": return emaCache?.ema20||args[0];
      case "rsi": case "roc5": case "roc10": case "roc20": return args[0];
      case "ifgt": return args[0]>args[1]?args[0]:args[2];
      case "iflt": return args[0]<args[1]?args[0]:args[2];
      default: return 0;
    }
  }
  return walk();
}

function randomGene(maxDepth = 4) {
  const tokens = [];
  function grow(depth) {
    if (depth>=maxDepth||(depth>1&&Math.random()<0.3)) {
      tokens.push(TERMINALS[Math.floor(Math.random()*TERMINALS.length)]);
    } else {
      const fns = Object.keys(FUNCTIONS);
      const fn = fns[Math.floor(Math.random()*fns.length)];
      tokens.push(fn);
      for (let i=0;i<FUNCTIONS[fn];i++) grow(depth+1);
    }
  }
  grow(0);
  return tokens;
}

function mutateGene(gene) {
  const g = [...gene];
  const idx = Math.floor(Math.random()*g.length);
  if (g[idx] in FUNCTIONS) {
    const fns = Object.keys(FUNCTIONS);
    g[idx] = fns[Math.floor(Math.random()*fns.length)];
  } else {
    g[idx] = TERMINALS[Math.floor(Math.random()*TERMINALS.length)];
  }
  return g;
}

function crossoverGenes(g1, g2) {
  const p1 = Math.floor(Math.random()*g1.length);
  const p2 = Math.floor(Math.random()*g2.length);
  return [[...g1.slice(0,p1),...g2.slice(p2)], [...g2.slice(0,p2),...g1.slice(p1)]];
}

function discoverFactors(klines, opts = {}) {
  const popSize   = opts.popSize   || 30;
  const maxGen    = opts.maxGen    || 20;
  const mutRate   = opts.mutRate   || 0.2;
  const crossRate = opts.crossRate || 0.6;
  const topN      = opts.topN      || 5;

  const rows = klines.map((k,i)=>({
    ...k,
    close_d1: i>0?klines[i-1].close:k.close,
    volume_d1: i>0?klines[i-1].volume:k.volume,
    close_d5: i>=5?klines[i-5].close:k.close,
    close_d20: i>=20?klines[i-20].close:k.close,
  }));

  function fitness(gene) {
    try {
      const fv=[], fr=[];
      for (let i=0;i<rows.length-5;i++) {
        const v = evalGene(gene, rows[i], {}, {});
        if (isNaN(v)||!isFinite(v)) continue;
        fv.push(v);
        fr.push((rows[i+5].close-rows[i].close)/rows[i].close);
      }
      if (fv.length<20) return -999;
      const n=fv.length;
      const fm=fv.reduce((a,b)=>a+b,0)/n;
      const rm=fr.reduce((a,b)=>a+b,0)/n;
      let cov=0,fVar=0,rVar=0;
      for (let i=0;i<n;i++) { const fd=fv[i]-fm, rd=fr[i]-rm; cov+=fd*rd; fVar+=fd*fd; rVar+=rd*rd; }
      const ic = fVar>0&&rVar>0?cov/Math.sqrt(fVar*rVar):0;
      const penalty = gene.length>30?(gene.length-30)*0.02:0;
      return Math.abs(ic)*100+(ic>0?10:0)-penalty;
    } catch(e) { return -999; }
  }

  let population = [];
  for (let i=0;i<popSize;i++) {
    const gene=randomGene(Math.floor(Math.random()*3)+3);
    population.push({gene,fitness:fitness(gene),expression:geneToExpression(gene)});
  }

  let bestEver={gene:[],fitness:-Infinity,expression:"",generation:0};
  const history=[];
  let stagnation=0, prevBest=-Infinity;

  for (let gen=0;gen<maxGen;gen++) {
    const adaptiveMutRate = mutRate*(1+stagnation/4);
    for (const ind of population) {
      ind.fitness=fitness(ind.gene);
      ind.expression=geneToExpression(ind.gene);
      if (ind.fitness>bestEver.fitness) {
        bestEver={gene:[...ind.gene],fitness:ind.fitness,expression:ind.expression,generation:gen};
      }
    }

    if (bestEver.fitness-prevBest<0.01) stagnation++; else stagnation=Math.max(0,stagnation-1);
    prevBest=bestEver.fitness;

    population.sort((a,b)=>b.fitness-a.fitness);
    history.push({gen,best:+bestEver.fitness.toFixed(2),avg:+(population.reduce((s,i)=>s+i.fitness,0)/popSize).toFixed(2)});

    if (gen===maxGen-1) break;

    const ec = Math.max(2,Math.floor(popSize*0.1));
    const nextGen = population.slice(0,ec).map(p=>({gene:[...p.gene],fitness:p.fitness,expression:p.expression}));

    while (nextGen.length<popSize) {
      const p1=population[Math.floor(Math.random()*popSize*0.4)];
      const p2=population[Math.floor(Math.random()*popSize*0.4)];
      if (Math.random()<crossRate&&p1.gene.length>2&&p2.gene.length>2) {
        const [c1,c2]=crossoverGenes(p1.gene,p2.gene);
        nextGen.push({gene:c1,fitness:0,expression:""});
        if (nextGen.length<popSize) nextGen.push({gene:c2,fitness:0,expression:""});
      } else {
        const child=[...(Math.random()<0.5?p1.gene:p2.gene)];
        if (Math.random()<adaptiveMutRate) nextGen.push({gene:mutateGene(child),fitness:0,expression:""});
        else nextGen.push({gene:child,fitness:0,expression:""});
      }
    }
    population=nextGen.slice(0,popSize);
  }

  population.sort((a,b)=>b.fitness-a.fitness);
  return {
    best:{expression:bestEver.expression,fitness:+bestEver.fitness.toFixed(2),generation:bestEver.generation,gene:bestEver.gene.join(" ")},
    topFactors:population.slice(0,topN).map(p=>({expression:p.expression,fitness:+p.fitness.toFixed(2),gene:p.gene.join(" ")})),
    history,
  };
}

// ==================== Worker 入口 ====================

parentPort.on("message", (msg) => {
  try {
    const { mode, klines, opts } = msg.data;
    let result;
    if (mode === "discover") {
      result = discoverFactors(klines, opts || {});
    } else {
      // 默认: 权重进化
      result = evolveWeights(klines, opts || {});
    }
    parentPort.postMessage(result);
  } catch (err) {
    parentPort.postMessage({ error: err.message, stack: err.stack });
  }
});

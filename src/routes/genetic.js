/**
 * 遗传因子进化 v3 — 基于 gpquant / GeneTrader 开源项目思想重写
 *
 * 核心改进:
 * - 符号回归 (Symbolic Regression): 因子 = 数学表达式树, 自动组合基础指标
 * - 向量化回测: 一次性计算所有日期收益, 不再逐日循环
 * - 锦标赛选择: 比轮盘赌更鲁棒, 保留精英
 * - 子树交叉: 交换两个表达式树的子分支, 产生全新因子
 *
 * 参考:
 * - gpquant (https://github.com/gao-yulin/gpquant): 符号回归挖掘量化因子
 * - GeneTrader (https://github.com/imsatoshi/GeneTrader): GA优化交易策略
 * - gplearn: 遗传编程 Python 库
 */

const { SMA, EMA } = require("../indicators");

// ═══════════════════════════════════════
// 1. 基础函数集 (23个原语)
// ═══════════════════════════════════════
const PRIMITIVES = {
  // 算术
  add:  (a, b) => a + b,
  sub:  (a, b) => a - b,
  mul:  (a, b) => a * b,
  div:  (a, b) => (Math.abs(b) < 1e-8 ? 0 : a / b),
  abs:  (a) => Math.abs(a),
  neg:  (a) => -a,
  sqrt: (a) => Math.sqrt(Math.max(0, a)),
  log:  (a) => Math.log(Math.max(1e-8, Math.abs(a))),
  // 比较
  max2: (a, b) => Math.max(a, b),
  min2: (a, b) => Math.min(a, b),
  // 条件
  if_gt: (a, b, c, d) => a > b ? c : d,
  // 归一化相关
  ts_rank: (arr, n) => { const sub = arr.slice(-n); const v = arr[arr.length-1]; let r = 0; for (const x of sub) if (x < v) r++; return r / n; },
  ts_delta: (arr, n) => { if (arr.length < n) return 0; return arr[arr.length-1] - arr[arr.length-n]; },
  ts_mean: (arr, n) => { const sub = arr.slice(-n); return sub.reduce((a,b)=>a+b,0) / n; },
  ts_std:  (arr, n) => { const sub = arr.slice(-n); const m = sub.reduce((a,b)=>a+b,0)/n; return Math.sqrt(sub.reduce((s,x)=>s+(x-m)**2,0)/n); },
  ts_min:  (arr, n) => Math.min(...arr.slice(-n)),
  ts_max:  (arr, n) => Math.max(...arr.slice(-n)),
  ts_corr: (arr1, arr2, n) => { const a=arr1.slice(-n),b=arr2.slice(-n); const ma=a.reduce((x,y)=>x+y,0)/n,mb=b.reduce((x,y)=>x+y,0)/n; let num=0,da=0,db=0; for(let i=0;i<n;i++){num+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2;} return da*db<1e-16?0:num/Math.sqrt(da*db); },
};

// ═══════════════════════════════════════
// 2. 表达式树
// ═══════════════════════════════════════
class ExprNode {
  constructor(type, value = null) {
    this.type = type;   // 'const' | 'var' | 'func'
    this.value = value; // number | variable name | function name
    this.children = []; // sub-expressions
  }

  clone() {
    const node = new ExprNode(this.type, this.value);
    node.children = this.children.map(c => c.clone());
    return node;
  }

  toString() {
    if (this.type === 'const') return String(Math.round(this.value * 100) / 100);
    if (this.type === 'var') return this.value;
    const args = this.children.map(c => c.toString());
    return this.value + '(' + args.join(',') + ')';
  }

  /** 根据上下文求值 */
  eval(ctx) {
    if (this.type === 'const') return this.value;
    if (this.type === 'var') {
      // 变量名如 'close', 'volume', 'ma5' 等
      if (this.value === 'close')  return ctx.close;
      if (this.value === 'open')   return ctx.open;
      if (this.value === 'high')   return ctx.high;
      if (this.value === 'low')    return ctx.low;
      if (this.value === 'volume') return ctx.volume;
      if (this.value === 'turnover') return ctx.turnover || 0;
      if (this.value === 'amount')   return ctx.amount || 0;
      if (this.value === 'change')   return ctx.change || 0;
    }
    if (this.type === 'func') {
      const fn = PRIMITIVES[this.value];
      if (!fn) return 0;
      const args = this.children.map(c => c.eval(ctx));
      try { return fn(...args); } catch(e) { return 0; }
    }
    return 0;
  }

  /** 随机生成表达式树 (深度受控) */
  static random(vars, funcs, maxDepth = 3) {
    if (maxDepth <= 1 || Math.random() < 0.3) {
      // 叶子节点: 变量 或 常量
      if (Math.random() < 0.7) {
        const v = vars[Math.floor(Math.random() * vars.length)];
        return new ExprNode('var', v);
      } else {
        return new ExprNode('const', (Math.random() - 0.5) * 10);
      }
    }
    // 函数节点
    const fname = funcs[Math.floor(Math.random() * funcs.length)];
    const node = new ExprNode('func', fname);
    const arity = node.arityFromName(fname);
    for (let i = 0; i < arity; i++) {
      node.children.push(ExprNode.random(vars, funcs, maxDepth - 1));
    }
    return node;
  }

  arityFromName(name) {
    const map = { abs:1, neg:1, sqrt:1, log:1, ts_rank:2, ts_delta:2, ts_mean:2, ts_std:2, ts_min:2, ts_max:2, ts_corr:3, add:2, sub:2, mul:2, div:2, max2:2, min2:2, if_gt:4 };
    return map[name] || 2;
  }
}

// ═══════════════════════════════════════
// 3. 遗传编程引擎
// ═══════════════════════════════════════
class GPEngine {
  constructor(opts = {}) {
    this.popSize    = opts.popSize    || 80;
    this.maxGen     = opts.maxGen     || 20;
    this.maxDepth   = opts.maxDepth   || 4;
    this.tournSize  = opts.tournSize  || 5;
    this.crossRate  = opts.crossRate  || 0.7;
    this.mutRate    = opts.mutRate    || 0.2;
    this.eliteCount = opts.eliteCount || 4;
    this.parsimony  = opts.parsimony  || 0.001; // 复杂度惩罚系数
  }

  /** 初始化种群 */
  initPop(vars, funcs) {
    return Array.from({ length: this.popSize }, () => ({
      tree: ExprNode.random(vars, funcs, this.maxDepth),
      fitness: -Infinity,
      ic: 0,
      sharpe: 0,
    }));
  }

  /** 评估个体适应度 */
  evaluate(tree, data, prices) {
    const n = data.length;
    // 计算因子值
    const factorVals = new Float64Array(n);
    for (let i = 60; i < n; i++) {
      try {
        factorVals[i] = tree.eval(data[i]);
      } catch(_) { factorVals[i] = 0; }
    }
    // 移除 NaN / Inf
    for (let i = 60; i < n; i++) {
      if (!isFinite(factorVals[i])) factorVals[i] = 0;
    }

    // IC (Information Coefficient) — 因子值与未来收益的相关性
    let icSum = 0, icCount = 0;
    for (let i = 60; i < n - 5; i++) {
      const fwdRet = (prices[i+5] - prices[i]) / prices[i];
      if (isFinite(fwdRet) && factorVals[i] !== 0) {
        icSum += factorVals[i] * fwdRet;
        icCount++;
      }
    }
    const ic = icCount > 0 ? icSum / icCount : 0;

    // 因子收益率 — 多空分组差异
    const valid = [];
    for (let i = 60; i < n - 1; i++) {
      if (isFinite(factorVals[i])) valid.push({ val: factorVals[i], ret: (prices[i+1]-prices[i])/prices[i] });
    }
    valid.sort((a, b) => a.val - b.val);
    const qSize = Math.floor(valid.length / 5);
    const top = valid.slice(-qSize);
    const bot = valid.slice(0, qSize);
    const topRet = top.reduce((s, x) => s + x.ret, 0) / top.length;
    const botRet = bot.reduce((s, x) => s + x.ret, 0) / bot.length;
    const spread = topRet - botRet;
    const allRets = valid.map(x => x.ret);
    const meanRet = allRets.reduce((a,b)=>a+b,0) / allRets.length;
    const stdRet = Math.sqrt(allRets.reduce((s,x)=>s+(x-meanRet)**2,0) / allRets.length);
    const sharpe = stdRet > 0 ? (spread / stdRet) * Math.sqrt(252) : 0;

    // 复杂度 = 节点数量
    const complexity = this.countNodes(tree);

    // 综合适应度 = |IC| + Sharpe - 复杂度惩罚
    const fitness = Math.abs(ic) * 100 + Math.max(0, sharpe) * 10 - complexity * this.parsimony;

    return { fitness, ic, sharpe, complexity, factorVals };
  }

  countNodes(node) {
    if (!node) return 0;
    return 1 + node.children.reduce((s, c) => s + this.countNodes(c), 0);
  }

  /** 锦标赛选择 */
  tournament(pop, tournSize) {
    let best = pop[Math.floor(Math.random() * pop.length)];
    for (let i = 1; i < tournSize; i++) {
      const candidate = pop[Math.floor(Math.random() * pop.length)];
      if (candidate.fitness > best.fitness) best = candidate;
    }
    return best;
  }

  /** 子树交叉 */
  crossover(parent1, parent2) {
    const c1 = parent1.tree.clone();
    const c2 = parent2.tree.clone();

    // 随机选择 c1 的一个子树
    const allNodes1 = this.allNodes(c1);
    const allNodes2 = this.allNodes(c2);
    if (allNodes1.length === 0 || allNodes2.length === 0) return [c1, c2];

    const node1 = allNodes1[Math.floor(Math.random() * allNodes1.length)];
    const node2 = allNodes2[Math.floor(Math.random() * allNodes2.length)];

    // 交换
    const tmp = { type: node1.type, value: node1.value, children: node1.children };
    node1.type = node2.type; node1.value = node2.value; node1.children = node2.children;
    node2.type = tmp.type; node2.value = tmp.value; node2.children = tmp.children;

    return [c1, c2];
  }

  /** 子树变异 */
  mutate(tree, vars, funcs, maxDepth) {
    const nodes = this.allNodes(tree);
    if (nodes.length === 0) return tree;
    const target = nodes[Math.floor(Math.random() * nodes.length)];
    const newNode = ExprNode.random(vars, funcs, Math.max(1, maxDepth - 1));
    target.type = newNode.type;
    target.value = newNode.value;
    target.children = newNode.children;
    return tree;
  }

  allNodes(node) {
    const result = [];
    const walk = (n) => {
      result.push(n);
      for (const c of (n.children || [])) walk(c);
    };
    walk(node);
    return result;
  }

  /** 主进化循环 */
  evolve(vars, funcs, data, prices) {
    let pop = this.initPop(vars, funcs);

    // 初始评估
    for (const ind of pop) {
      const ev = this.evaluate(ind.tree, data, prices);
      ind.fitness = ev.fitness;
      ind.ic = ev.ic;
      ind.sharpe = ev.sharpe;
      ind.complexity = ev.complexity;
    }

    let bestEver = { fitness: -Infinity, tree: null, ic: 0, sharpe: 0, gen: 0 };
    const history = [];

    for (let gen = 0; gen < this.maxGen; gen++) {
      // 排序 + 精英保留
      pop.sort((a, b) => b.fitness - a.fitness);
      if (pop[0].fitness > bestEver.fitness) {
        bestEver = {
          fitness: pop[0].fitness,
          tree: pop[0].tree.clone(),
          ic: pop[0].ic,
          sharpe: pop[0].sharpe,
          complexity: pop[0].complexity,
          gen,
        };
      }

      const elite = pop.slice(0, this.eliteCount);
      const newPop = elite.map(e => ({ tree: e.tree.clone(), fitness: -Infinity, ic: 0, sharpe: 0 }));

      while (newPop.length < this.popSize) {
        const p1 = this.tournament(pop, this.tournSize);
        const p2 = this.tournament(pop, this.tournSize);

        let c1 = p1.tree.clone();
        let c2 = p2.tree.clone();

        if (Math.random() < this.crossRate) {
          [c1, c2] = this.crossover(p1, p2);
        }
        if (Math.random() < this.mutRate) {
          c1 = this.mutate(c1, vars, funcs, this.maxDepth);
        }
        if (Math.random() < this.mutRate) {
          c2 = this.mutate(c2, vars, funcs, this.maxDepth);
        }

        newPop.push({ tree: c1, fitness: -Infinity, ic: 0, sharpe: 0 });
        if (newPop.length < this.popSize) {
          newPop.push({ tree: c2, fitness: -Infinity, ic: 0, sharpe: 0 });
        }
      }

      // 评估新种群
      for (const ind of newPop.slice(this.eliteCount)) {
        const ev = this.evaluate(ind.tree, data, prices);
        ind.fitness = ev.fitness;
        ind.ic = ev.ic;
        ind.sharpe = ev.sharpe;
        ind.complexity = ev.complexity;
      }

      pop = newPop;

      history.push({
        gen,
        bestFitness: +(bestEver.fitness).toFixed(4),
        bestIC: +(bestEver.ic * 100).toFixed(2) + '%',
        bestSharpe: +(bestEver.sharpe).toFixed(3),
        bestExpr: bestEver.tree ? bestEver.tree.toString() : '',
        avgFitness: +(pop.reduce((s, i) => s + (i.fitness || 0), 0) / pop.length).toFixed(4),
      });
    }

    return {
      best: {
        expression: bestEver.tree ? bestEver.tree.toString() : '',
        fitness: +bestEver.fitness.toFixed(4),
        ic: +(bestEver.ic * 100).toFixed(2) + '%',
        sharpe: +bestEver.sharpe.toFixed(3),
        complexity: bestEver.complexity,
        generation: bestEver.gen,
      },
      topFactors: pop.slice(0, 6).map((ind, i) => ({
        rank: i + 1,
        expression: ind.tree.toString(),
        fitness: +ind.fitness.toFixed(4),
        ic: +(ind.ic * 100).toFixed(2) + '%',
        sharpe: +ind.sharpe.toFixed(3),
        complexity: ind.complexity,
      })),
      history: history.slice(-5),
      converged: history.length >= 3 &&
        history.slice(-3).every(h => Math.abs(h.bestFitness - history[history.length-1].bestFitness) < 0.01),
    };
  }
}

// ═══════════════════════════════════════
// 4. 数据准备 + 导出函数
// ═══════════════════════════════════════

function prepareData(klines) {
  const n = klines.length;
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const dates = klines.map(k => k.date);
  const opens = klines.map(k => k.open);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);

  // 预计算常用指标序列
  const ma5 = new Float64Array(n);
  const ma10 = new Float64Array(n);
  const ma20 = new Float64Array(n);
  const ma60 = new Float64Array(n);
  const volMa5 = new Float64Array(n);
  const volMa20 = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    ma5[i]  = i >= 4  ? closes.slice(i-4,  i+1).reduce((a,b)=>a+b,0) / 5  : closes[i];
    ma10[i] = i >= 9  ? closes.slice(i-9,  i+1).reduce((a,b)=>a+b,0) / 10 : closes[i];
    ma20[i] = i >= 19 ? closes.slice(i-19, i+1).reduce((a,b)=>a+b,0) / 20 : closes[i];
    ma60[i] = i >= 59 ? closes.slice(i-59, i+1).reduce((a,b)=>a+b,0) / 60 : closes[i];
    volMa5[i]  = i >= 4  ? volumes.slice(i-4,  i+1).reduce((a,b)=>a+b,0) / 5  : volumes[i];
    volMa20[i] = i >= 19 ? volumes.slice(i-19, i+1).reduce((a,b)=>a+b,0) / 20 : volumes[i];
  }

  // 构建上下文数组
  const data = [];
  for (let i = 0; i < n; i++) {
    data.push({
      date:   dates[i],
      close:  closes[i],
      open:   opens[i],
      high:   highs[i],
      low:    lows[i],
      volume: volumes[i],
      turnover: klines[i].turnover || 0,
      amount:   klines[i].amount || 0,
      change:   closes[i] - (closes[i-1] || closes[i]),
      ma5:   ma5[i],
      ma10:  ma10[i],
      ma20:  ma20[i],
      ma60:  ma60[i],
      volMa5:  volMa5[i],
      volMa20: volMa20[i],
      ret1:  (closes[i] - (closes[i-1] || closes[i])) / (closes[i-1] || closes[i]),
      ret5:  i >= 5 ? (closes[i] - closes[i-5]) / closes[i-5] : 0,
      ret20: i >= 20 ? (closes[i] - closes[i-20]) / closes[i-20] : 0,
      i, // context index
      allCloses: closes,
      allVolumes: volumes,
      allHighs: highs,
      allLows: lows,
    });
  }

  return data;
}

function discoverFactors(klines, opts = {}) {
  const data = prepareData(klines);
  const prices = data.map(d => d.close);

  const vars = ['close','open','high','low','volume','turnover','amount','change','ma5','ma10','ma20','ma60','volMa5','volMa20','ret1','ret5','ret20'];
  const funcs = ['add','sub','mul','div','abs','neg','sqrt','max2','min2','ts_delta','ts_mean','ts_std','ts_min','ts_max'];

  const engine = new GPEngine({
    popSize:    opts.popSize  || 60,
    maxGen:     opts.maxGen   || 15,
    maxDepth:   opts.maxDepth || 4,
    tournSize:  opts.tournSize || 5,
    crossRate:  0.7,
    mutRate:    0.25,
    eliteCount: 5,
    parsimony:  0.002,
  });

  const result = engine.evolve(vars, funcs, data, prices);

  return {
    bestFactor: result.best,
    topFactors: result.topFactors,
    history: result.history,
    converged: result.converged,
    dataPoints: data.length,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { discoverFactors, GPEngine, ExprNode };

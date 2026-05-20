// AI策略进化器 — 遗传算法参数优化引擎
// 自动搜索最优策略参数组合 (MA周期, RSI阈值, 权重分配等)

const { getKlineData } = require("./data");
const { backtest, parseCustomStrategy } = require("./strategy");

// ============ 遗传算法核心 ============

// 参数基因编码
function encodeGenome(config) {
  const genes = [];
  for (const cond of config.conditions) {
    for (const [key, val] of Object.entries(cond.params)) {
      genes.push({
        condId: cond.id,
        condType: cond.type,
        paramKey: key,
        value: val,
        min: getParamRange(cond.type, key).min,
        max: getParamRange(cond.type, key).max,
        step: getParamRange(cond.type, key).step,
      });
    }
    genes.push({
      condId: cond.id, condType: cond.type,
      paramKey: "weight",
      value: cond.weight,
      min: 0.5, max: 3, step: 0.5,
    });
  }
  return genes;
}

function getParamRange(condType, paramKey) {
  const ranges = {
    ma_cross: { fast: { min: 3, max: 60, step: 1 }, slow: { min: 10, max: 120, step: 1 }, weight: { min: 0.5, max: 3, step: 0.5 } },
    macd_cross: { fast: { min: 5, max: 30, step: 1 }, slow: { min: 15, max: 60, step: 1 }, signal: { min: 5, max: 20, step: 1 }, weight: { min: 0.5, max: 3, step: 0.5 } },
    rsi_level: { period: { min: 5, max: 30, step: 1 }, oversold: { min: 15, max: 40, step: 1 }, overbought: { min: 60, max: 85, step: 1 }, weight: { min: 0.5, max: 3, step: 0.5 } },
    boll_touch: { period: { min: 10, max: 50, step: 1 }, multiplier: { min: 1, max: 3.5, step: 0.1 }, weight: { min: 0.5, max: 3, step: 0.5 } },
    price_vs_ma: { period: { min: 10, max: 120, step: 1 }, weight: { min: 0.5, max: 3, step: 0.5 } },
    kdj_cross: { period: { min: 5, max: 20, step: 1 }, weight: { min: 0.5, max: 3, step: 0.5 } },
    volume_spike: { period: { min: 5, max: 40, step: 1 }, threshold: { min: 1.1, max: 3, step: 0.1 }, weight: { min: 0.5, max: 3, step: 0.5 } },
  };
  return (ranges[condType] || {})[paramKey] || { min: 5, max: 50, step: 1 };
}

// 基因 -> 策略配置
function decodeGenome(genes, baseConfig) {
  const condMap = {};
  for (const g of genes) {
    if (!condMap[g.condId]) condMap[g.condId] = { ...baseConfig.conditions.find(c => c.id === g.condId), params: {} };
    if (g.paramKey === "weight") {
      condMap[g.condId].weight = g.value;
    } else {
      condMap[g.condId].params[g.paramKey] = g.value;
    }
  }
  const config = { ...baseConfig, conditions: Object.values(condMap) };
  return config;
}

// 适应度函数 (综合评分)
function fitness(backtestResult) {
  const { totalReturn, maxDrawdown, sharpe, winRate, totalTrades } = backtestResult;
  if (totalTrades < 3) return -999; // 交易太少, 不可靠

  const retScore = Math.max(-50, Math.min(100, totalReturn));
  const ddPenalty = Math.max(0, 20 - maxDrawdown) * 2;
  const sharpeBonus = Math.max(0, (sharpe || 0) + 1) * 15;
  const winRateBonus = Math.max(0, (winRate || 0) - 40) * 0.5;
  const tradeBonus = Math.min(totalTrades * 1.5, 30);

  return +(retScore + ddPenalty + sharpeBonus + winRateBonus + tradeBonus).toFixed(1);
}

// ============ 进化主循环 ============

async function evolve(params) {
  const {
    code, baseConfig, days = 250,
    populationSize = 30,
    generations = 10,
    mutationRate = 0.2,
    crossoverRate = 0.7,
    eliteCount = 4,
    onProgress = null,
  } = params;

  // 获取数据
  const klines = await getKlineData(code, days);
  if (klines.length < 60) return { error: "数据不足" };

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const opens = klines.map(k => k.open);
  const dates = klines.map(k => k.date);
  const klineObj = { opens, highs, lows, closes, volumes, dates };

  const baseGenes = encodeGenome(baseConfig);
  const PARAM_COUNT = baseGenes.length;

  // 初始化种群
  let population = [];
  for (let i = 0; i < populationSize; i++) {
    const genes = baseGenes.map(g => ({
      ...g,
      value: +(g.min + Math.random() * (g.max - g.min)).toFixed(g.step < 1 ? 1 : 0),
    }));
    population.push({ id: i, genes, fitness: null });
  }
  // 保留原始配置
  population[0] = { id: 0, genes: baseGenes.map(g => ({ ...g })), fitness: null };

  // 评估初始种群
  for (const individual of population) {
    const config = decodeGenome(individual.genes, baseConfig);
    const stratFn = parseCustomStrategy(config);
    const result = backtest(klineObj, stratFn);
    individual.fitness = fitness(result);
    individual.result = result;
    individual.config = config;
  }

  population.sort((a, b) => b.fitness - a.fitness);

  const bestHistory = [];
  let globalBest = { ...population[0], generation: 0 };

  // 进化循环
  for (let gen = 0; gen < generations; gen++) {
    const sorted = [...population];
    const newPop = [];

    // 精英保留
    for (let i = 0; i < eliteCount; i++) {
      newPop.push({ ...sorted[i], genes: sorted[i].genes.map(g => ({ ...g })) });
    }

    // 交叉 + 变异
    while (newPop.length < populationSize) {
      // 锦标赛选择
      const parent1 = tournamentSelect(sorted, 3);
      const parent2 = tournamentSelect(sorted, 3);

      let childGenes;
      if (Math.random() < crossoverRate) {
        childGenes = crossover(parent1.genes, parent2.genes);
      } else {
        childGenes = parent1.genes.map(g => ({ ...g }));
      }

      // 变异
      if (Math.random() < mutationRate) {
        childGenes = mutate(childGenes, baseGenes, mutationRate);
      }

      newPop.push({ id: populationSize + gen * populationSize + newPop.length, genes: childGenes, fitness: null });
    }

    // 评估新种群
    for (const individual of newPop) {
      if (individual.fitness != null) continue;
      const config = decodeGenome(individual.genes, baseConfig);
      const stratFn = parseCustomStrategy(config);
      const result = backtest(klineObj, stratFn);
      individual.fitness = fitness(result);
      individual.result = result;
      individual.config = config;
    }

    population = newPop.sort((a, b) => b.fitness - a.fitness);

    if (population[0].fitness > globalBest.fitness) {
      globalBest = { ...population[0], generation: gen + 1 };
    }
    bestHistory.push({
      generation: gen + 1,
      bestFitness: population[0].fitness,
      avgFitness: +(population.reduce((s, i) => s + i.fitness, 0) / population.length).toFixed(1),
      bestReturn: population[0].result?.totalReturn || 0,
    });

    if (onProgress) onProgress({ generation: gen + 1, bestFitness: population[0].fitness, best: population[0] });
  }

  return {
    code,
    baseConfig,
    best: {
      fitness: globalBest.fitness,
      config: globalBest.config,
      result: {
        totalReturn: globalBest.result?.totalReturn,
        maxDrawdown: globalBest.result?.maxDrawdown,
        sharpe: globalBest.result?.sharpe,
        winRate: globalBest.result?.winRate,
        totalTrades: globalBest.result?.totalTrades,
        avgPnl: globalBest.result?.avgPnl,
      },
      params: globalBest.genes.map(g => ({
        condType: g.condType,
        param: g.paramKey,
        original: baseGenes.find(bg => bg.condId === g.condId && bg.paramKey === g.paramKey)?.value,
        evolved: g.value,
      })),
      generation: globalBest.generation,
    },
    history: bestHistory,
    paramsCount: PARAM_COUNT,
    totalEvaluations: populationSize * (generations + 1),
  };
}

// 锦标赛选择
function tournamentSelect(sortedPop, size) {
  let best = null;
  for (let i = 0; i < size; i++) {
    const idx = Math.floor(Math.random() * sortedPop.length);
    if (!best || sortedPop[idx].fitness > best.fitness) {
      best = sortedPop[idx];
    }
  }
  return best;
}

// 两点交叉
function crossover(genes1, genes2) {
  const len = genes1.length;
  if (len < 2) return genes1.map(g => ({ ...g }));
  const p1 = Math.floor(Math.random() * len);
  const p2 = Math.floor(Math.random() * len);
  const [start, end] = [Math.min(p1, p2), Math.max(p1, p2)];
  return genes1.map((g, i) => {
    if (i >= start && i <= end) return { ...genes2[i] };
    return { ...g };
  });
}

// 高斯变异
function mutate(genes, baseGenes, rate) {
  return genes.map((g, i) => {
    if (Math.random() < rate) {
      const base = baseGenes[i];
      const range = base.max - base.min;
      const delta = (Math.random() - 0.5) * 2 * range * 0.3;
      let newVal = g.value + delta;
      newVal = Math.max(base.min, Math.min(base.max, newVal));
      newVal = base.step >= 1 ? Math.round(newVal) : +newVal.toFixed(1);
      return { ...g, value: newVal };
    }
    return g;
  });
}

module.exports = { evolve, fitness, encodeGenome };

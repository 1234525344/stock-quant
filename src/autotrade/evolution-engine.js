// 三合一自进化引擎 v1
// 策略自进化 + 选股自进化 + 风控自进化
const { chatCompletion } = require("../ai-service");
const { getKlineData, getRealtimeQuotes } = require("../data");
const { backtestStrategy } = require("./backtest");
const { STRATEGY_TYPES } = require("./strategy");

class EvolutionEngine {
  constructor() {
    this.strategyEvolver = new StrategyEvolver();
    this.pickerEvolver = new PickerEvolver();
    this.riskEvolver = new RiskEvolver();
    this.logs = [];
    this.isRunning = false;
    this.evolutionCount = 0;
  }

  // 启动自进化循环
  async start(options = {}) {
    if (this.isRunning) return;
    this.isRunning = true;
    this._options = options;

    console.log("[自进化引擎] 启动");

    // 每小时执行一轮进化
    this._timer = setInterval(async () => {
      if (!this.isRunning) return;
      await this.evolve();
    }, 60 * 60 * 1000); // 1小时

    // 立即执行一次
    await this.evolve();
  }

  stop() {
    this.isRunning = false;
    if (this._timer) clearInterval(this._timer);
    console.log("[自进化引擎] 停止");
  }

  // 执行一轮进化
  async evolve() {
    this.evolutionCount++;
    console.log(`[自进化引擎] 第 ${this.evolutionCount} 轮进化开始`);

    try {
      // 1. 策略自进化
      const strategyResult = await this.strategyEvolver.evolve();
      this._log("strategy", strategyResult);

      // 2. 选股自进化
      const pickerResult = await this.pickerEvolver.evolve();
      this._log("picker", pickerResult);

      // 3. 风控自进化
      const riskResult = await this.riskEvolver.evolve();
      this._log("risk", riskResult);

      console.log("[自进化引擎] 第", this.evolutionCount, "轮进化完成");
    } catch (e) {
      console.error("[自进化引擎] 进化失败:", e.message);
    }
  }

  _log(type, data) {
    this.logs.push({
      time: new Date().toISOString(),
      type,
      data,
      round: this.evolutionCount,
    });
    // 只保留最近100条
    if (this.logs.length > 100) this.logs.shift();
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      evolutionCount: this.evolutionCount,
      lastLogs: this.logs.slice(-10),
      strategyStatus: this.strategyEvolver.getStatus(),
      pickerStatus: this.pickerEvolver.getStatus(),
      riskStatus: this.riskEvolver.getStatus(),
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 策略自进化器
// ═══════════════════════════════════════════════════════════
class StrategyEvolver {
  constructor() {
    this.history = []; // 进化历史
    this.bestParams = {}; // 当前最优参数
  }

  async evolve() {
    const strategies = Object.keys(STRATEGY_TYPES);
    const results = [];

    for (const strategyType of strategies.slice(0, 3)) { // 先优化前3种
      try {
        const result = await this._evolveStrategy(strategyType);
        results.push(result);
      } catch (e) {
        results.push({ strategy: strategyType, error: e.message });
      }
    }

    return { evolved: results.length, results };
  }

  async _evolveStrategy(strategyType) {
    const stockCode = "000001"; // 默认用平安银行测试
    const days = 180;

    // 1. 获取历史数据
    const klines = await getKlineData(stockCode, days);
    if (klines.length < 60) return { strategy: strategyType, error: "数据不足" };

    // 2. 分析市场特征
    const market特征 = this._analyzeMarket(klines);

    // 3. AI推荐参数
    const aiPrompt = `你是量化策略优化专家。当前市场特征：
- 20日波动率: ${(market特征.volatility * 100).toFixed(1)}%
- 趋势强度: ${market特征.trend > 0 ? "上升" : "下降"}
- 价格位置: ${market特征.pricePosition}

策略类型: ${strategyType}
当前默认参数: ${JSON.stringify(STRATEGY_TYPES[strategyType].defaultConfig)}

请推荐3组优化后的参数，每组给出理由。返回JSON格式：
{
  "recommendations": [
    {"params": {...}, "reason": "...", "expected_sharpe": 1.5}
  ]
}`;

    const aiResponse = await chatCompletion([
      { role: "user", content: aiPrompt }
    ], { model: "flash" });

    // 4. 解析AI推荐
    let recommendations;
    try {
      const match = aiResponse.match(/\{[\s\S]*\}/);
      recommendations = JSON.parse(match[0]).recommendations;
    } catch (e) {
      return { strategy: strategyType, error: "AI响应解析失败" };
    }

    // 5. 回测验证
    let bestResult = null;
    for (const rec of recommendations) {
      try {
        const btResult = await backtestStrategy(strategyType, stockCode, {
          ...STRATEGY_TYPES[strategyType].defaultConfig,
          ...rec.params,
        }, days);

        if (!bestResult || btResult.sharpe > bestResult.sharpe) {
          bestResult = { ...btResult, reason: rec.reason, params: rec.params };
        }
      } catch (e) { /* skip */ }
    }

    // 6. 记录结果
    if (bestResult) {
      this.bestParams[strategyType] = bestResult.params;
      this.history.push({
        time: new Date().toISOString(),
        strategy: strategyType,
        params: bestResult.params,
        sharpe: bestResult.sharpe,
        reason: bestResult.reason,
      });
    }

    return {
      strategy: strategyType,
      bestParams: bestResult?.params,
      sharpe: bestResult?.sharpe,
      reason: bestResult?.reason,
    };
  }

  _analyzeMarket(klines) {
    const closes = klines.map(k => k.close);
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i-1]) / closes[i-1]);
    }

    const volatility = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length) * Math.sqrt(250);
    const trend = (closes[closes.length-1] - closes[0]) / closes[0];
    const pricePosition = (closes[closes.length-1] - Math.min(...closes.slice(-60))) / (Math.max(...closes.slice(-60)) - Math.min(...closes.slice(-60)) || 1);

    return { volatility, trend, pricePosition };
  }

  getStatus() {
    return {
      historyCount: this.history.length,
      bestParams: this.bestParams,
      lastEvolution: this.history[this.history.length - 1],
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 选股自进化器
// ═══════════════════════════════════════════════════════════
class PickerEvolver {
  constructor() {
    this.stockPool = []; // 当前股票池
    this.history = [];
  }

  async evolve() {
    // 1. 获取市场数据
    const quotes = await getRealtimeQuotes(this.stockPool.slice(0, 10)).catch(() => []);

    // 2. AI分析市场环境
    const aiPrompt = `你是选股专家。当前市场数据摘要：
${quotes.map(q => `${q.name}(${q.code}): ${q.change}%`).join('\n') || '暂无数据'}

请分析：
1. 当前市场整体趋势
2. 哪些行业/板块有机会
3. 推荐5只值得关注的股票，给出理由

返回JSON格式：
{
  "market_trend": "牛市/熊市/震荡",
  "hot_sectors": ["行业1", "行业2"],
  "recommendations": [
    {"code": "000001", "name": "平安银行", "reason": "...", "score": 85}
  ]
}`;

    const aiResponse = await chatCompletion([
      { role: "user", content: aiPrompt }
    ], { model: "flash" });

    // 3. 解析AI推荐
    let result;
    try {
      const match = aiResponse.match(/\{[\s\S]*\}/);
      result = JSON.parse(match[0]);
    } catch (e) {
      return { error: "AI响应解析失败" };
    }

    // 4. 更新股票池
    if (result.recommendations) {
      const newCodes = result.recommendations.map(r => r.code);
      // 保留表现好的，添加新的
      this.stockPool = [...new Set([...this.stockPool.slice(-20), ...newCodes])].slice(0, 30);
    }

    this.history.push({
      time: new Date().toISOString(),
      trend: result.market_trend,
      hotSectors: result.hot_sectors,
      recommendations: result.recommendations?.length || 0,
    });

    return {
      marketTrend: result.market_trend,
      hotSectors: result.hot_sectors,
      poolSize: this.stockPool.length,
    };
  }

  getStatus() {
    return {
      poolSize: this.stockPool.length,
      stockPool: this.stockPool.slice(0, 10),
      historyCount: this.history.length,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 风控自进化器
// ═══════════════════════════════════════════════════════════
class RiskEvolver {
  constructor() {
    this.params = {
      stopLoss: -0.06,      // 止损线
      takeProfit: 0.15,     // 止盈线
      maxPosition: 0.15,    // 单票最大仓位
      maxPositions: 6,      // 最大持仓数
      dailyLossLimit: -0.05, // 日亏损限制
    };
    this.history = [];
  }

  async evolve() {
    // 1. AI分析当前风险环境
    const aiPrompt = `你是风控专家。当前风控参数：
- 止损线: ${(this.params.stopLoss * 100).toFixed(0)}%
- 止盈线: ${(this.params.takeProfit * 100).toFixed(0)}%
- 单票仓位上限: ${(this.params.maxPosition * 100).toFixed(0)}%
- 最大持仓数: ${this.params.maxPositions}

请根据以下原则调整：
1. 如果市场波动大，收紧风控
2. 如果市场平稳，可适当放宽
3. 如果连续亏损，收紧止损

返回JSON格式：
{
  "adjustments": {
    "stopLoss": -0.05,
    "takeProfit": 0.12,
    "maxPosition": 0.12,
    "maxPositions": 5
  },
  "reason": "...",
  "risk_level": "低/中/高"
}`;

    const aiResponse = await chatCompletion([
      { role: "user", content: aiPrompt }
    ], { model: "flash" });

    // 2. 解析AI建议
    let result;
    try {
      const match = aiResponse.match(/\{[\s\S]*\}/);
      result = JSON.parse(match[0]);
    } catch (e) {
      return { error: "AI响应解析失败" };
    }

    // 3. 应用调整（安全边界）
    if (result.adjustments) {
      const adj = result.adjustments;
      // 止损线：-3% 到 -10% 之间
      if (adj.stopLoss) this.params.stopLoss = Math.max(-0.10, Math.min(-0.03, adj.stopLoss));
      // 止盈线：8% 到 25% 之间
      if (adj.takeProfit) this.params.takeProfit = Math.max(0.08, Math.min(0.25, adj.takeProfit));
      // 仓位：8% 到 25% 之间
      if (adj.maxPosition) this.params.maxPosition = Math.max(0.08, Math.min(0.25, adj.maxPosition));
      // 持仓数：3 到 10 之间
      if (adj.maxPositions) this.params.maxPositions = Math.max(3, Math.min(10, adj.maxPositions));
    }

    this.history.push({
      time: new Date().toISOString(),
      params: { ...this.params },
      riskLevel: result.risk_level,
      reason: result.reason,
    });

    return {
      params: this.params,
      riskLevel: result.risk_level,
      reason: result.reason,
    };
  }

  getParams() {
    return { ...this.params };
  }

  getStatus() {
    return {
      currentParams: this.params,
      historyCount: this.history.length,
      lastAdjustment: this.history[this.history.length - 1],
    };
  }
}

module.exports = { EvolutionEngine };

const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");

// ── AI 服务 ──
const {
  isAiConfigured,
  getApiKey,
  streamChat,
  generateMarketSummary,
  explainBacktest,
  nlScreen,
  buildMarketContext,
  chatCompletion,
  getActiveModels,
} = require("../ai-service");

// ── AI 智能选股 ──
const { aiPickStocks } = require("../ai-picker");

// ── 共享辅助函数 ──
const {
  getStockAnalysis,
  getAdvice,
  getSignalsNow,
  detectMarketState,
} = require("../helpers");

// ── 数据层 ──
const { batchWithLimit, getKlineData, getFundFlow, getStockName } = require("../data");

// ── 选股器 ──
const { screen } = require("../screener");

// ── 状态 ──
const { STOCK_POOL } = require("../state");

// ── 指数 / 板块 ──
const { getIndexQuotes, getSectorPerformance, getSectorFlow } = require("../index");

// ==================== AI 路由 ====================

// AI 技术分析
router.get("/stock-analysis/:code", asyncHandler(async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(401).json({ error: "未配置 API Key" });

  const { code } = req.params;
  const analysis = await getStockAnalysis(code);
  if (analysis.error) return res.status(500).json({ error: analysis.error });

  const text = await chatCompletion(apiKey, {
    model: getActiveModels(apiKey).pro,
    maxTokens: 800,
    system: `你是A股技术分析师，用通俗易懂的白话中文分析股票。要求：1)先一句话总结当前状态 2)分析2-3个最关键的技术指标 3)指出风险和机会 4)控制在300字以内 5)不要给出具体买卖建议`,
    messages: [{ role: "user", content: `请分析这只股票：${JSON.stringify(analysis, null, 2)}` }],
  });
  res.json({ text, generatedAt: new Date().toISOString(), code: analysis.code, name: analysis.name });
}));

// AI 仓位建议
router.get("/advice/:code", asyncHandler(async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(401).json({ error: "未配置 API Key" });

  const { code } = req.params;
  const [adviceResp, analysisResp] = await Promise.all([
    getAdvice(code),
    getStockAnalysis(code).catch(() => null),
  ]);

  if (adviceResp.error) return res.status(500).json({ error: adviceResp.error });

  const text = await chatCompletion(apiKey, {
    model: getActiveModels(apiKey).pro,
    maxTokens: 600,
    system: "你是A股投资顾问。基于技术信号和仓位建议，用通俗中文给出是否建仓/加仓/减仓的判断和理由，150字内。不要说具体买卖建议，只分析仓位策略。",
    messages: [{ role: "user", content: `仓位建议数据：${JSON.stringify(adviceResp)}。增强分析：${JSON.stringify(analysisResp)}` }],
  });

  res.json({ text, code: adviceResp.code, name: adviceResp.name, action: adviceResp.action, suggestedPct: adviceResp.suggestedPct });
}));

// AI 状态
router.get("/status", (req, res) => {
  const configured = isAiConfigured(req);
  const models = configured ? getActiveModels(getApiKey(req)) : null;
  res.json({
    configured,
    model: configured ? `${models.flash} / ${models.pro}` : null,
    message: configured ? "AI 服务已就绪" : "未配置 API Key — 请在设置中填写或联系管理员",
  });
});

// AI 流式聊天 (SSE)
router.post("/chat", asyncHandler(async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(401).json({ error: "未配置 API Key" });

  const { message, history } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "请输入问题" });
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const marketContext = await buildMarketContext();
  const stream = streamChat(message, { history, marketContext }, apiKey);

  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.end();
}));

// AI 市场解读
router.get("/market-summary", asyncHandler(async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(401).json({ error: "未配置 API Key" });

  const [indices, sectors, sectorFlow] = await Promise.all([
    getIndexQuotes().catch(() => []),
    getSectorPerformance().catch(() => []),
    getSectorFlow().catch(() => []),
  ]);

  const marketData = {
    time: new Date().toISOString(),
    indices: (indices || []).slice(0, 8),
    sectors: (sectors || []).slice(0, 10),
    topFlows: (sectorFlow || []).slice(0, 5),
  };

  const summary = await generateMarketSummary(marketData, apiKey);
  res.json(summary);
}));

// AI 回测解读
router.post("/explain-backtest", asyncHandler(async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(401).json({ error: "未配置 API Key" });

  const { backtestResult } = req.body;
  if (!backtestResult) return res.status(400).json({ error: "缺少回测数据" });

  const explanation = await explainBacktest(backtestResult, apiKey);
  res.json(explanation);
}));

// AI 自然语言选股
router.post("/screen", asyncHandler(async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(401).json({ error: "未配置 API Key" });

  const { query } = req.body;
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "请输入选股条件描述" });
  }

  // Claude translates NL -> structured filters
  const filterResult = await nlScreen(query, apiKey);

  if (filterResult.error) {
    return res.json({ error: filterResult.error, explanation: filterResult.explanation });
  }

  // Run screen with Claude's parameters
  const mode = filterResult.mode || "all";
  const sectorHint = filterResult.sector || "";
  const filters = filterResult.filters || {};

  // 扫描全股票池
  const pool = STOCK_POOL.slice(0, 50);
  const scanResults = await batchWithLimit(pool, async (code) => {
    try {
      const [klines, fundFlow] = await Promise.all([
        getKlineData(code, 250),
        getFundFlow(code, 5).catch(() => null),
      ]);
      if (klines.length < 60) return null;
      const closes = klines.map(k => k.close);
      const highs = klines.map(k => k.high);
      const lows = klines.map(k => k.low);
      const volumes = klines.map(k => k.volume);
      const dates = klines.map(k => k.date);
      const opens = klines.map(k => k.open);

      const fundFlowData = fundFlow && fundFlow.length > 0
        ? { mainNet: fundFlow[fundFlow.length - 1].main,
            recentFlow: fundFlow.slice(-3).reduce((s, d) => s + d.main, 0) }
        : null;

      const r = screen({ opens, highs, lows, closes, volumes, dates }, filters, fundFlowData);
      if (!r.passed) return null;
      const name = await getStockName(code);
      return { code, name, score: r.score, grade: r.grade, gradeColor: r.gradeColor,
        launchStatus: r.launchStatus, positionScore: r.positionScore,
        launchScore: r.launchScore, qualityScore: r.qualityScore,
        lastPrice: r.lastPrice, chg5: r.chg5, reasons: r.reasons, details: r.details };
    } catch (e) { return null; }
  }, 8);

  const sorted = scanResults.sort((a, b) => b.score - a.score).slice(0, 20);

  res.json({
    understood: filterResult.explanation || "已理解选股条件",
    filters: filterResult.filters || [],
    mode: filterResult.mode || "all",
    sector: filterResult.sector || "",
    count: sorted.length,
    results: sorted,
  });
}));

// AI 策略推荐 - 根据市场状态推荐策略
router.get("/strategy-recommend", asyncHandler(async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(401).json({ error: "未配置 API Key" });

  // 获取市场数据
  const [indices, sectors, sectorFlow] = await Promise.all([
    getIndexQuotes().catch(() => []),
    getSectorPerformance().catch(() => []),
    getSectorFlow().catch(() => []),
  ]);

  const marketContext = {
    time: new Date().toISOString(),
    indices: (indices || []).slice(0, 5),
    topSectors: (sectors || []).slice(0, 5),
    topFlows: (sectorFlow || []).slice(0, 5),
  };

  const prompt = `你是一个专业的量化投资顾问。根据当前市场状况，推荐最适合的投资策略。

当前市场数据:
${JSON.stringify(marketContext, null, 2)}

可用策略列表:
1. 趋势跟踪 - MA金叉/死叉，适合趋势明显的市场
2. 均值回归 - 布林带策略，适合震荡市场
3. 动量策略 - RSI+MACD，适合强势股
4. 多因子选股 - 综合评分，适合稳健投资
5. 资金流向 - 跟踪主力资金，适合短线

请返回JSON格式:
{
  "marketState": "牛市/熊市/震荡",
  "recommended": [
    {
      "name": "策略名称",
      "reason": "推荐理由",
      "confidence": 85,
      "riskLevel": "低/中/高",
      "suitableFor": "适合人群"
    }
  ],
  "marketInsight": "市场洞察",
  "riskWarning": "风险提示"
}`;

  const result = await chatCompletion(apiKey, {
    model: getActiveModels(apiKey).pro,
    maxTokens: 1000,
    system: "你是一个专业的量化投资顾问，提供策略建议。",
    messages: [{ role: "user", content: prompt }],
  });

  if (!result) {
    return res.status(500).json({ error: "AI 服务暂时不可用" });
  }

  // 尝试解析JSON
  let recommendation;
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    recommendation = jsonMatch ? JSON.parse(jsonMatch[0]) : { rawText: result };
  } catch (e) {
    recommendation = { rawText: result };
  }

  res.json({
    ...recommendation,
    generatedAt: new Date().toISOString(),
  });
}));

// AI 智能选股推荐 v3
router.post("/pick", asyncHandler(async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(401).json({ error: "未配置 API Key，请在设置中配置" });

  const { query, topN, focus, style, industries, includeETF } = req.body;
  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "请输入选股需求描述" });
  }

  const result = await aiPickStocks(query, {
    topN: topN || 5,
    focus: focus || "balanced",
    style: style || "balanced",
    industries: industries || [],
    includeETF: includeETF !== false, // 默认包含ETF
    apiKey,
  });
  res.json(result);
}));

module.exports = router;

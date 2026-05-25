const OpenAI = require("openai");

// ── Cache ──────────────────────────────────────────
const CACHE = new Map();
const CACHE_TTL = {
  marketSummary: 5 * 60 * 1000,
  backtestExplain: 10 * 60 * 1000,
  nlScreen: 60 * 1000,
};

function getCache(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) { CACHE.delete(key); return null; }
  return entry.data;
}

function setCache(key, data, ttl) {
  CACHE.set(key, { data, expiry: Date.now() + ttl });
}

// ── Provider config ───────────────────────────────
const PROVIDERS = {
  aihubmix:  { baseURL: "https://api.aihubmix.com/v1", models: { flash: "DeepSeek-V3.1-Terminus", pro: "claude-sonnet-4-6" }, keyPrefix: "tp-" },
  deepseek:  { baseURL: "https://api.deepseek.com/v1", models: { flash: "deepseek-chat", pro: "deepseek-chat" }, keyPrefix: "sk-" },
  mimo:      { baseURL: "https://api.xiaomimimo.com/v1", models: { flash: "mimo-v2-flash", pro: "mimo-v2-pro" }, keyPrefix: "sk-" },
  anthropic: { baseURL: "https://api.anthropic.com/v1", models: { flash: "claude-haiku-4-5-20251001", pro: "claude-sonnet-4-6" }, keyPrefix: "sk-ant-" },
};

function detectProvider(apiKey) {
  if (!apiKey) return null;
  for (const [name, cfg] of Object.entries(PROVIDERS)) {
    if (apiKey.startsWith(cfg.keyPrefix)) return name;
  }
  return "deepseek"; // fallback for unknown key formats
}

// ── API Key ───────────────────────────────────────
function getApiKey(req) {
  if (req?.headers?.["x-api-key"]) return req.headers["x-api-key"];
  if (process.env.AIHUBMIX_API_KEY) return process.env.AIHUBMIX_API_KEY;
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  if (process.env.MIMO_API_KEY) return process.env.MIMO_API_KEY;
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  return null;
}

function isAiConfigured(req) {
  return !!getApiKey(req);
}

// ── Client ────────────────────────────────────────
function createClient(apiKey) {
  const provider = detectProvider(apiKey);
  const cfg = PROVIDERS[provider] || PROVIDERS.deepseek;
  return new OpenAI({ apiKey, baseURL: cfg.baseURL });
}

function getActiveModels(apiKey) {
  const provider = detectProvider(apiKey);
  return PROVIDERS[provider]?.models || PROVIDERS.deepseek.models;
}

// ── Unified chat completion (for server.js inline calls) ─
async function chatCompletion(apiKey, { model, system, messages, maxTokens = 800 }) {
  const client = createClient(apiKey);
  const allMessages = [];
  if (system) allMessages.push({ role: "system", content: system });
  allMessages.push(...messages);

  const resp = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: allMessages,
  });
  return resp.choices[0]?.message?.content || "";
}

// ── Error translation ─────────────────────────────
function translateError(err) {
  const msg = err?.message || String(err);
  if (err?.status === 401) {
    return "API Key 无效，请检查设置后重试";
  }
  if (err?.status === 429) {
    return "AI 请求过于频繁，请稍后重试";
  }
  if (err?.status >= 500) {
    return "AI 服务暂时不可用，请稍后重试";
  }
  if (msg.includes("max_tokens")) {
    return "分析内容过长，请缩小查询范围";
  }
  return msg || "未知错误，请稍后重试";
}

// ── System prompts (Chinese) ──────────────────────
const SYSTEM_PROMPTS = {
  chat: `你是量化交易平台"QuantLab"的 AI 智能助手。你的用户是普通投资者，不一定懂专业术语。

对话规则：
- 用通俗易懂的白话中文回答，像朋友聊天一样
- 遇到专业术语要解释（就像"MACD，简单说就是判断趋势变强还是变弱的指标"）
- 你可以分析股票、解释指标、给出学习建议，但不要给出具体的买卖建议
- 回答简洁，控制在 200-400 字
- 涉及具体数据时，提醒用户以平台实时数据为准
- 如果用户问的问题你无法回答，诚实说明，不要编造`,

  marketSummary: `你是一个专业的A股市场分析师。请根据以下实时市场数据，生成一份约300字的每日市场解读。

要求：
- 用通俗易懂的白话中文，让普通投资者也能看懂
- 像给朋友解释今天市场发生了什么
- 指出今天最强的板块和最弱的板块
- 提到资金流向的趋势（主力在买什么、卖什么）
- 语气平和客观，不要煽动情绪
- 最后加一个小小的学习提示（比如"今天表现好的板块往往有持续性的原因是..."这类小知识点）
- 不要给出买卖建议`,

  backtestExplain: `你是一个量化策略分析师。请用通俗易懂的白话解释以下回测结果，让不懂量化的普通投资者也能理解。

要求：
- 用"就像..."、"相当于..."、"简单说就是..."这类句式
- 先一句话总结：这个策略表现好还是不好
- 然后解释 2-3 个最关键指标的含义
- 如果回撤很大，解释回撤意味着什么
- 如果夏普比率低，解释为什么赚钱不稳定
- 控制在 200 字以内
- 不要给出买卖建议`,

  nlScreen: `你是一个选股条件解析器。用户会用大白话描述想找什么样的股票，你需要把它转换成结构化的筛选条件。

可用的筛选条件类型：
- sector: 板块名称（如"新能源"、"科技"、"医药"、"消费"、"金融"、"半导体"、"白酒"、"军工"、"光伏"、"锂电池"、"AI"、"汽车"）
- change_min: 最小涨跌幅（百分比，正数为上涨）
- change_max: 最大涨跌幅
- volume_ratio_min: 最小量比（成交量/5日均量，>1 放量，<1 缩量）
- ma_cross: 均线金叉（"golden"=短期上穿长期）或死叉（"death"=短期下穿长期）
- trend: 趋势方向（"up"=上升趋势，"down"=下降趋势）
- rsi_range: RSI范围（"oversold"=超卖<30，"overbought"=超买>70）
- market_cap: 市值（"large"=大盘股，"mid"=中盘股，"small"=小盘股）

请只返回一个 JSON 对象，不要任何其他文字。格式如下：
{"sector":"板块","filters":[{"type":"类型","params":{}}],"explanation":"用一句话解释你理解的条件","mode":"strong"}

mode 可选值：strong（强势股）、oversold（超跌股）、volume（放量股）、all（全市场扫描）

如果用户描述的条件无法匹配以上类型，返回：{"error":"无法理解的条件描述","explanation":"..."}`,
};

// ── Streaming Chat ───────────────────────────────
async function* streamChat(message, context, apiKey) {
  const client = createClient(apiKey);
  const { history = [] } = context || {};

  const messages = [];
  for (const h of history.slice(-10)) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: message });

  let systemPrompt = SYSTEM_PROMPTS.chat;
  if (context?.marketContext) {
    systemPrompt += `\n\n当前市场背景（供参考，回答时不要逐条复述）：${context.marketContext}`;
  }

  // Prepend system message at the front
  const allMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  const models = getActiveModels(apiKey);

  try {
    const stream = client.chat.completions.create({
      model: models.flash,
      max_tokens: 1024,
      messages: allMessages,
      stream: true,
    });

    let fullText = "";
    for await (const chunk of await stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        yield { type: "delta", text: delta };
      }
    }
    yield { type: "done", fullText };
  } catch (e) {
    yield { type: "error", error: translateError(e) };
  }
}

// ── Market Summary ────────────────────────────────
async function generateMarketSummary(marketData, apiKey) {
  const cacheKey = "marketSummary";
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = createClient(apiKey);
  const dataText = JSON.stringify(marketData, null, 2);

  const msg = await client.chat.completions.create({
    model: getActiveModels(apiKey).pro,
    max_tokens: 800,
    messages: [
      { role: "system", content: SYSTEM_PROMPTS.marketSummary },
      { role: "user", content: `以下是当前市场数据，请生成每日市场解读：\n${dataText}` },
    ],
  });

  const text = msg.choices[0]?.message?.content || "";
  const result = { text, generatedAt: new Date().toISOString() };
  setCache(cacheKey, result, CACHE_TTL.marketSummary);
  return result;
}

// ── Backtest Explanation ──────────────────────────
async function explainBacktest(backtestResult, apiKey) {
  const cacheKey = "backtest:" + JSON.stringify(backtestResult).slice(0, 200);
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const client = createClient(apiKey);

  const summary = {
    stockName: backtestResult.stockName,
    totalReturn: backtestResult.metrics?.totalReturn,
    annualReturn: backtestResult.metrics?.annualReturn,
    maxDrawdown: backtestResult.metrics?.maxDrawdown,
    winRate: backtestResult.metrics?.winRate,
    sharpeRatio: backtestResult.metrics?.sharpeRatio,
    totalTrades: backtestResult.metrics?.totalTrades,
    benchmarkReturn: backtestResult.metrics?.benchmarkReturn,
  };

  const msg = await client.chat.completions.create({
    model: getActiveModels(apiKey).pro,
    max_tokens: 600,
    messages: [
      { role: "system", content: SYSTEM_PROMPTS.backtestExplain },
      { role: "user", content: `请解读这个回测结果：${JSON.stringify(summary, null, 2)}` },
    ],
  });

  const text = msg.choices[0]?.message?.content || "";
  const result = { text, generatedAt: new Date().toISOString() };
  setCache(cacheKey, result, CACHE_TTL.backtestExplain);
  return result;
}

// ── Natural Language Screening ────────────────────
async function nlScreen(query, apiKey) {
  const client = createClient(apiKey);

  const msg = await client.chat.completions.create({
    model: getActiveModels(apiKey).flash,
    max_tokens: 400,
    messages: [
      { role: "system", content: SYSTEM_PROMPTS.nlScreen },
      { role: "user", content: query },
    ],
  });

  const text = msg.choices[0]?.message?.content || "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed;
    }
  } catch (e) { /* fall through */ }

  return { error: "无法解析 AI 返回的筛选条件", raw: text };
}

// ── Build market context for chat ─────────────────
async function buildMarketContext() {
  try {
    const { getIndexQuotes } = require("./index");
    const indices = await getIndexQuotes().catch(() => []);
    if (indices.length > 0) {
      const lines = indices.slice(0, 5).map(i =>
        `${i.name || i.code}: ${i.price} ${i.change >= 0 ? "+" : ""}${i.changePct}%`
      );
      return "当前主要指数：" + lines.join("；");
    }
  } catch (e) { /* ignore */ }
  return "";
}

module.exports = {
  getApiKey,
  isAiConfigured,
  streamChat,
  generateMarketSummary,
  explainBacktest,
  nlScreen,
  buildMarketContext,
  chatCompletion,
  createClient,
  getActiveModels,
  CACHE,
};

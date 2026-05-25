// AI 智能选股引擎 v3 — 多维度深度分析 + 预测预警
// 整合技术评分、因子分析、资金流向、基本面、行业分析、预测预警，通过AI生成综合推荐

const { screen } = require("./screener");
const { getKlineData, getFundFlow, getStockName, batchWithLimit } = require("./data");
const { chatCompletion, getActiveModels } = require("./ai-service");
const { getIndexQuotes } = require("./index");

// ========== 预测预警系统 ==========
const ALERT_TYPES = {
  // 技术面预警
  golden_cross: { level: "info", icon: "📈", msg: "MACD金叉" },
  death_cross: { level: "warning", icon: "📉", msg: "MACD死叉" },
  ma_bull: { level: "info", icon: "🔼", msg: "均线多头排列" },
  ma_bear: { level: "warning", icon: "🔽", msg: "均线空头排列" },
  breakout_up: { level: "bullish", icon: "🚀", msg: "突破压力位" },
  breakout_down: { level: "bearish", icon: "⬇️", msg: "跌破支撑位" },
  volume_surge: { level: "info", icon: "📊", msg: "放量上涨" },
  volume_shrink: { level: "neutral", icon: "📉", msg: "缩量整理" },

  // 资金面预警
  fund_inflow: { level: "bullish", icon: "💰", msg: "主力资金大幅流入" },
  fund_outflow: { level: "bearish", icon: "💸", msg: "主力资金大幅流出" },
  fund_accelerate: { level: "bullish", icon: "📈", msg: "资金加速流入" },

  // 风险预警
  high_volatility: { level: "danger", icon: "⚠️", msg: "波动率过高" },
  max_drawdown: { level: "danger", icon: "🔻", msg: "最大回撤过大" },
  overbought: { level: "warning", icon: "📊", msg: "RSI超买" },
  oversold: { level: "opportunity", icon: "📉", msg: "RSI超卖" },

  // 趋势预警
  trend_up: { level: "bullish", icon: "📈", msg: "趋势向上" },
  trend_down: { level: "bearish", icon: "📉", msg: "趋势向下" },
  trend_neutral: { level: "neutral", icon: "➡️", msg: "横盘震荡" },
};

// ETF潜力分析维度
const ETF_POTENTIAL_DIMENSIONS = {
  policy: { label: "政策支持", weight: 0.25 },
  industry: { label: "行业景气度", weight: 0.25 },
  technical: { label: "技术趋势", weight: 0.20 },
  fundFlow: { label: "资金关注度", weight: 0.15 },
  valuation: { label: "估值水平", weight: 0.15 },
};

// ========== ETF池 — 覆盖主流行业和主题 ==========
const ETF_POOL = {
  // 宽基指数ETF
  broad: [
    "510300", // 沪深300ETF
    "510500", // 中证500ETF
    "510050", // 上证50ETF
    "159919", // 沪深300ETF(深)
    "159901", // 深100ETF
    "159915", // 创业板ETF
    "588000", // 科创50ETF
    "512100", // 中证1000ETF
    "560010", // 中证2000ETF
  ],
  // 行业ETF
  sector: [
    "512010", // 医药ETF
    "512880", // 证券ETF
    "515030", // 新能源车ETF
    "515790", // 光伏ETF
    "512690", // 白酒ETF
    "512480", // 半导体ETF
    "515050", // 5GETF
    "159766", // 旅游ETF
    "512800", // 银行ETF
    "515210", // 钢铁ETF
    "512400", // 有色金属ETF
    "515220", // 煤炭ETF
    "512200", // 房地产ETF
    "159825", // 农业ETF
    "512660", // 军工ETF
    "512170", // 医疗ETF
    "516160", // 新能源ETF
    "515880", // 通信ETF
    "512000", // 券商ETF
  ],
  // 主题ETF
  theme: [
    "515070", // 人工智能ETF
    "159869", // 游戏ETF
    "516510", // 云计算ETF
    "515030", // 新能源车ETF
    "516160", // 碳中和ETF
    "159992", // 创新药ETF
    "512290", // 生物医药ETF
    "515790", // 光伏ETF
  ],
  // 跨境ETF
  overseas: [
    "513100", // 纳斯达克ETF
    "513500", // 标普500ETF
    "159920", // 恒生ETF
    "513060", // 恒生医疗ETF
    "513050", // 中概互联ETF
    "159941", // 纳指ETF
    "513030", // 德国ETF
    "513880", // 日经ETF
  ],
  get all() {
    return [...new Set([
      ...this.broad, ...this.sector, ...this.theme, ...this.overseas
    ])];
  }
};

// ETF行业映射
const ETF_INDUSTRY_MAP = {
  "510300": "宽基", "510500": "宽基", "510050": "宽基", "159919": "宽基",
  "512010": "医药", "512880": "金融", "515030": "新能源", "515790": "光伏",
  "512690": "消费", "512480": "科技", "515050": "通信", "159766": "旅游",
  "512800": "金融", "515210": "周期", "512400": "周期", "515220": "周期",
  "512200": "地产", "159825": "农业", "512660": "军工", "512170": "医药",
  "516160": "新能源", "515880": "通信", "512000": "金融",
  "515070": "科技", "159869": "游戏", "516510": "科技",
  "513100": "海外", "513500": "海外", "159920": "港股",
};

// ========== 扩大股票池 — 覆盖各行业龙头 ==========
const STOCK_POOLS = {
  // 金融龙头
  finance: [
    "000001","600000","600036","601166","601318","601398",
    "601328","601998","601288","601988","601939",
    "600016","600036","601818","601601","601336",
  ],
  // 消费龙头
  consumer: [
    "000858","002594","600276","600519","600887","601888","603259",
    "000568","000651","000661","002007","300015","300122",
    "600085","600132","600196","600809",
    "000333","002714","300433",
  ],
  // 科技龙头
  tech: [
    "000063","000725","002049","002230","002371","300059",
    "600570","600703","603986","688981",
    "002475","300124","300498","300760",
    "002415","300750","002459","002466","300014","300274",
  ],
  // 医药龙头
  medical: [
    "300015","300122","600196","600809",
    "002007","000661","000568",
    "300759","002001","300347","603259",
  ],
  // 新能源
  energy: [
    "300750","601012","600438","601615",
    "002459","002466","300014","300274",
    "600900","601899","603288",
  ],
  // 制造业
  manufacturing: [
    "000333","002714","300433","600745","601138",
    "002142","300498","600690","601088","603833",
    "000625","002916","600104","601225",
  ],
  // 周期股
  cyclical: [
    "601088","601899","601225","601615",
    "000977","002456","300450","600406","601360",
    "600183","601058","603160",
  ],
  // 股票池合并去重
  get all() {
    const merged = [
      ...this.finance, ...this.consumer, ...this.tech,
      ...this.medical, ...this.energy, ...this.manufacturing, ...this.cyclical,
    ];
    return [...new Set(merged)];
  }
};

// 兼容旧代码
const STOCK_POOL = STOCK_POOLS.all;

// ========== 行业分类映射 ==========
const INDUSTRY_MAP = {
  "000001": "银行", "600000": "银行", "600036": "银行", "601166": "银行",
  "601318": "保险", "601398": "银行", "601328": "银行", "601998": "银行",
  "000858": "白酒", "002594": "白酒", "600519": "白酒", "601888": "旅游",
  "000063": "通信", "000725": "电子", "300750": "电池", "002415": "电子",
  "601012": "光伏", "600438:": "光伏", "002459": "光伏", "002466": "光伏",
  "300015": "医疗", "300122": "医疗", "600196": "医药",
  "000333": "家电", "002714": "畜牧", "300433": "纺织",
  "601088": "煤炭", "601899": "黄金", "601225": "有色",
};

// ========== 风格标签 ==========
const STYLE_TYPES = {
  value: { label: "价值型", desc: "低PE/PB、高股息、稳定盈利", focus: ["pe", "pb", "dividendYield"] },
  growth: { label: "成长型", desc: "高增长、高ROE、高研发投入", focus: ["roe", "revenueGrowth", "profitGrowth"] },
  momentum: { label: "动量型", desc: "趋势向上、资金流入、强势突破", focus: ["momentum", "fundFlow", "technical"] },
  quality: { label: "质量型", desc: "现金流稳定、低负债、高毛利", focus: ["cashFlow", "debtRatio", "grossMargin"] },
  balanced: { label: "均衡型", desc: "多维度均衡、风险适中", focus: ["composite"] },
};

// ==================== 资金流向汇总 ====================

function aggregateFlow(fundFlow, days = 5) {
  if (!fundFlow || fundFlow.length === 0) return null;
  const recent = fundFlow.slice(-days);
  const mainNet = recent.reduce((s, d) => s + (d.main || 0), 0);
  const retailNet = recent.reduce((s, d) => s + (d.retail || 0), 0);
  const avgMain = mainNet / recent.length;
  const trend = recent.map(d => d.main || 0);
  const isAccelerating = trend.length >= 3 && trend[trend.length - 1] > trend[trend.length - 2] && trend[trend.length - 2] > trend[trend.length - 3];

  // 资金流入趋势分析
  const inflowDays = trend.filter(v => v > 0).length;
  const inflowRatio = inflowDays / trend.length;

  return { mainNet, retailNet, avgMain, isAccelerating, days: recent.length, inflowDays, inflowRatio };
}

function flowRating(flowSummary) {
  if (!flowSummary) return { score: 50, label: "无数据" };
  const { mainNet, avgMain, isAccelerating, inflowRatio } = flowSummary;
  let score = 50;

  // 主力资金净流入评分
  if (mainNet > 10e8) score = 95;
  else if (mainNet > 5e8) score = 85;
  else if (mainNet > 2e8) score = 75;
  else if (mainNet > 5e7) score = 65;
  else if (mainNet > 0) score = 55;
  else if (mainNet > -5e7) score = 45;
  else if (mainNet > -2e8) score = 35;
  else if (mainNet > -5e8) score = 25;
  else score = 15;

  // 加速流入加分
  if (isAccelerating) score = Math.min(100, score + 10);

  // 持续流入加分
  if (inflowRatio > 0.8) score = Math.min(100, score + 5);
  else if (inflowRatio < 0.3) score = Math.max(0, score - 5);

  const label = score >= 80 ? "大幅流入" : score >= 60 ? "温和流入" : score >= 40 ? "均衡" : score >= 20 ? "温和流出" : "大幅流出";
  return { score, label, isAccelerating, inflowRatio };
}

// ==================== 风险评分（改进版）====================

function computeRiskScore(closes, highs, lows) {
  if (closes.length < 60) return { score: 50, beta: null, volatility: null, riskLevel: "中等" };

  // 20日波动率
  const recent20 = closes.slice(-20);
  const avg20 = recent20.reduce((a, b) => a + b, 0) / 20;
  const var20 = recent20.reduce((s, v) => s + (v - avg20) ** 2, 0) / 20;
  const vol20 = Math.sqrt(var20) / avg20;

  // 60日波动率
  const recent60 = closes.slice(-60);
  const avg60 = recent60.reduce((a, b) => a + b, 0) / 60;
  const var60 = recent60.reduce((s, v) => s + (v - avg60) ** 2, 0) / 60;
  const vol60 = Math.sqrt(var60) / avg60;

  // 最大回撤
  let maxDrawdown = 0;
  let peak = closes[0];
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (peak - c) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // 计算Beta（相对大盘波动性，简化版）
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i-1]) / closes[i-1]);
  }
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252); // 年化波动率

  // 夏普比率（假设无风险利率3%）
  const riskFreeRate = 0.03;
  const annualReturn = avgReturn * 252;
  const sharpe = volatility > 0 ? (annualReturn - riskFreeRate) / volatility : 0;

  // 风险评分
  let score = 70;

  // 波动率评分
  if (vol20 < 0.015) score += 25;
  else if (vol20 < 0.025) score += 15;
  else if (vol20 < 0.035) score += 5;
  else if (vol20 > 0.06) score -= 15;
  else if (vol20 > 0.08) score -= 25;

  // 回撤评分
  if (maxDrawdown < 0.08) score += 15;
  else if (maxDrawdown < 0.15) score += 5;
  else if (maxDrawdown > 0.25) score -= 10;
  else if (maxDrawdown > 0.4) score -= 20;

  // 夏普比率评分
  if (sharpe > 2) score += 10;
  else if (sharpe > 1) score += 5;
  else if (sharpe < -0.5) score -= 10;

  score = Math.max(0, Math.min(100, score));

  // 风险等级
  let riskLevel;
  if (score >= 80) riskLevel = "低风险";
  else if (score >= 60) riskLevel = "中低风险";
  else if (score >= 40) riskLevel = "中等风险";
  else if (score >= 20) riskLevel = "中高风险";
  else riskLevel = "高风险";

  return {
    score,
    volatility: +(vol20 * 100).toFixed(1),
    volatility60: +(vol60 * 100).toFixed(1),
    maxDrawdown: +(maxDrawdown * 100).toFixed(1),
    annualVolatility: +(volatility * 100).toFixed(1),
    sharpe: +sharpe.toFixed(2),
    riskLevel,
  };
}

// ==================== 因子评分（改进版）====================

function computeFactorScore(klines) {
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume || 0);
  if (closes.length < 120) return { score: 50, alpha: 0, momentum: 0, volumeMomentum: 0 };

  const rets = [];
  for (let i = 1; i < closes.length; i++) {
    rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }

  // === 动量因子 ===
  // 近1月动量
  const mom1 = closes.length > 20
    ? (closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21]
    : 0;
  // 近3月动量
  const mom3 = closes.length > 60
    ? (closes[closes.length - 1] - closes[closes.length - 61]) / closes[closes.length - 61]
    : 0;
  // 近6月动量
  const mom6 = (closes[closes.length - 1] - closes[Math.max(0, closes.length - 120)]) / closes[Math.max(0, closes.length - 120)];

  // === 成交量动量 ===
  const volRecent = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volPrev = volumes.slice(-60, -20).reduce((a, b) => a + b, 0) / 40;
  const volumeMomentum = volPrev > 0 ? (volRecent - volPrev) / volPrev : 0;

  // === 夏普比率 ===
  const avgRet = rets.reduce((a, b) => a + b, 0) / rets.length;
  const stdRet = Math.sqrt(rets.reduce((s, r) => s + (r - avgRet) ** 2, 0) / rets.length);
  const sharpe = stdRet > 0 ? (avgRet * 252) / (stdRet * Math.sqrt(252)) : 0;

  // === 信息比率（相对大盘超额收益的稳定性）===
  // 简化版：用动量稳定性代替
  const momStability = Math.abs(mom6) > 0 ? Math.min(mom1 / mom6, 2) : 0;

  // === 综合因子分数 ===
  let score = 50;

  // 多周期动量评分
  if (mom1 > 0.1) score += 15;
  else if (mom1 > 0.05) score += 10;
  else if (mom1 > 0) score += 5;
  else if (mom1 < -0.1) score -= 10;
  else if (mom1 < -0.05) score -= 5;

  if (mom3 > 0.15) score += 15;
  else if (mom3 > 0.08) score += 10;
  else if (mom3 > 0) score += 5;
  else if (mom3 < -0.15) score -= 10;

  if (mom6 > 0.2) score += 10;
  else if (mom6 > 0.1) score += 5;
  else if (mom6 < -0.2) score -= 10;

  // 成交量动量评分
  if (volumeMomentum > 0.5) score += 10;
  else if (volumeMomentum > 0.2) score += 5;
  else if (volumeMomentum < -0.3) score -= 5;

  // 夏普比率评分
  if (sharpe > 2) score += 15;
  else if (sharpe > 1.5) score += 10;
  else if (sharpe > 0.8) score += 5;
  else if (sharpe < -0.5) score -= 10;
  else if (sharpe < -1) score -= 15;

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    alpha: +(mom6 * 100).toFixed(1),
    sharpe: +sharpe.toFixed(2),
    momentum: { m1: +(mom1 * 100).toFixed(1), m3: +(mom3 * 100).toFixed(1), m6: +(mom6 * 100).toFixed(1) },
    volumeMomentum: +(volumeMomentum * 100).toFixed(1),
  };
}

// ==================== 技术形态分析 ====================

function analyzeTechnicalPattern(klines) {
  if (klines.length < 60) return { pattern: "数据不足", trend: "未知", signals: [] };

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume || 0);

  // 均线系统
  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const ma60 = closes.length >= 60 ? closes.slice(-60).reduce((a, b) => a + b, 0) / 60 : ma20;

  const currentPrice = closes[closes.length - 1];

  // 趋势判断
  let trend = "震荡";
  const trendSignals = [];

  if (currentPrice > ma5 && ma5 > ma10 && ma10 > ma20) {
    trend = "强势上涨";
    trendSignals.push("均线多头排列");
  } else if (currentPrice > ma20 && ma20 > ma60) {
    trend = "温和上涨";
    trendSignals.push("站上中期均线");
  } else if (currentPrice < ma5 && ma5 < ma10 && ma10 < ma20) {
    trend = "弱势下跌";
    trendSignals.push("均线空头排列");
  } else if (currentPrice < ma20 && ma20 < ma60) {
    trend = "温和下跌";
    trendSignals.push("跌破中期均线");
  }

  // 金叉/死叉信号
  if (ma5 > ma10 && closes[closes.length - 6] <= closes[closes.length - 11]) {
    trendSignals.push("MA5/10金叉");
  } else if (ma5 < ma10 && closes[closes.length - 6] >= closes[closes.length - 11]) {
    trendSignals.push("MA5/10死叉");
  }

  // MACD计算
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const dif = ema12 - ema26;

  // 成交量分析
  const volAvg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volRecent = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volRatio = volAvg > 0 ? volRecent / volAvg : 1;

  if (volRatio > 2) trendSignals.push("放量上涨");
  else if (volRatio > 1.5) trendSignals.push("温和放量");
  else if (volRatio < 0.5) trendSignals.push("缩量整理");

  // 支撑/阻力位
  const recentHigh = Math.max(...highs.slice(-20));
  const recentLow = Math.min(...lows.slice(-20));

  return {
    pattern: trend,
    trend,
    signals: trendSignals,
    ma: { ma5: +ma5.toFixed(2), ma10: +ma10.toFixed(2), ma20: +ma20.toFixed(2), ma60: +ma60.toFixed(2) },
    macd: { dif: +dif.toFixed(2) },
    volume: { ratio: +volRatio.toFixed(2) },
    support: +recentLow.toFixed(2),
    resistance: +recentHigh.toFixed(2),
    pricePosition: currentPrice > ma20 ? "均线上方" : "均线下方",
  };
}

function calculateEMA(data, period) {
  if (data.length < period) return data[data.length - 1];
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

// ==================== 预测预警分析 ====================

function generateAlerts(klines, fundFlow, patternResult, riskResult, factorResult) {
  const alerts = [];
  if (!klines || klines.length < 20) return alerts;

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume || 0);

  // RSI计算
  const rsi = calculateRSI(closes, 14);
  const lastRSI = rsi[rsi.length - 1];

  // 技术面预警
  if (patternResult.signals.includes("MA5/10金叉")) {
    alerts.push({ type: "golden_cross", ...ALERT_TYPES.golden_cross, detail: "短期均线金叉，可能启动上涨" });
  }
  if (patternResult.signals.includes("MA5/10死叉")) {
    alerts.push({ type: "death_cross", ...ALERT_TYPES.death_cross, detail: "短期均线死叉，注意风险" });
  }
  if (patternResult.signals.includes("均线多头排列")) {
    alerts.push({ type: "ma_bull", ...ALERT_TYPES.ma_bull, detail: "均线呈多头排列，趋势向上" });
  }
  if (patternResult.signals.includes("均线空头排列")) {
    alerts.push({ type: "ma_bear", ...ALERT_TYPES.ma_bear, detail: "均线呈空头排列，趋势向下" });
  }
  if (patternResult.signals.includes("放量上涨")) {
    alerts.push({ type: "volume_surge", ...ALERT_TYPES.volume_surge, detail: "成交量明显放大，资金关注度提升" });
  }

  // RSI预警
  if (lastRSI > 80) {
    alerts.push({ type: "overbought", ...ALERT_TYPES.overbought, detail: `RSI=${lastRSI.toFixed(1)}，短期超买，注意回调风险` });
  } else if (lastRSI < 20) {
    alerts.push({ type: "oversold", ...ALERT_TYPES.oversold, detail: `RSI=${lastRSI.toFixed(1)}，短期超卖，可能有反弹机会` });
  }

  // 资金面预警
  if (factorResult?.fundFlowDetails?.isAccelerating) {
    alerts.push({ type: "fund_accelerate", ...ALERT_TYPES.fund_accelerate, detail: "主力资金加速流入，关注度提升" });
  }
  if (factorResult?.fundFlowDetails?.inflowRatio > 0.8) {
    alerts.push({ type: "fund_inflow", ...ALERT_TYPES.fund_inflow, detail: "近期主力资金持续流入" });
  } else if (factorResult?.fundFlowDetails?.inflowRatio < 0.2) {
    alerts.push({ type: "fund_outflow", ...ALERT_TYPES.fund_outflow, detail: "近期主力资金持续流出" });
  }

  // 风险预警
  if (riskResult?.volatility > 5) {
    alerts.push({ type: "high_volatility", ...ALERT_TYPES.high_volatility, detail: `年化波动率${riskResult.annualVolatility}%，波动较大` });
  }
  if (riskResult?.maxDrawdown > 20) {
    alerts.push({ type: "max_drawdown", ...ALERT_TYPES.max_drawdown, detail: `最大回撤${riskResult.maxDrawdown}%，注意控制仓位` });
  }

  // 趋势预警
  if (patternResult.trend === "强势上涨" || patternResult.trend === "温和上涨") {
    alerts.push({ type: "trend_up", ...ALERT_TYPES.trend_up, detail: `当前趋势：${patternResult.trend}` });
  } else if (patternResult.trend === "弱势下跌" || patternResult.trend === "温和下跌") {
    alerts.push({ type: "trend_down", ...ALERT_TYPES.trend_down, detail: `当前趋势：${patternResult.trend}` });
  } else {
    alerts.push({ type: "trend_neutral", ...ALERT_TYPES.trend_neutral, detail: "当前处于横盘震荡状态" });
  }

  return alerts;
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return closes.map(() => 50);

  const rsi = [];
  let gains = 0;
  let losses = 0;

  // 计算初始平均涨跌
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // 前period个RSI设为50
  for (let i = 0; i < period; i++) rsi.push(50);

  // 计算后续RSI
  for (let i = period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
    rsi.push(100 - (100 / (1 + rs)));
  }

  return rsi;
}

// ==================== ETF潜力分析 ====================

function analyzeETFPotential(klines, fundFlow, industry) {
  if (!klines || klines.length < 60) {
    return { score: 50, potential: "数据不足", dimensions: {} };
  }

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume || 0);

  // 1. 技术趋势分析
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const ma60 = closes.slice(-60).reduce((a, b) => a + b, 0) / 60;
  const currentPrice = closes[closes.length - 1];

  let technicalScore = 50;
  if (currentPrice > ma20 && ma20 > ma60) technicalScore = 80;
  else if (currentPrice > ma20) technicalScore = 65;
  else if (currentPrice < ma20 && ma20 < ma60) technicalScore = 30;
  else if (currentPrice < ma20) technicalScore = 40;

  // 2. 资金关注度分析
  let fundScore = 50;
  if (fundFlow && fundFlow.length > 0) {
    const recent5 = fundFlow.slice(-5);
    const mainNet = recent5.reduce((s, d) => s + (d.main || 0), 0);
    if (mainNet > 5e8) fundScore = 90;
    else if (mainNet > 2e8) fundScore = 75;
    else if (mainNet > 0) fundScore = 60;
    else if (mainNet > -2e8) fundScore = 40;
    else fundScore = 25;
  }

  // 3. 行业景气度（基于ETF类型推断）
  let industryScore = 50;
  const highPotentialIndustries = ["科技", "新能源", "医药", "军工", "半导体"];
  const mediumPotentialIndustries = ["消费", "金融", "光伏"];
  if (highPotentialIndustries.some(i => industry?.includes(i))) {
    industryScore = 75;
  } else if (mediumPotentialIndustries.some(i => industry?.includes(i))) {
    industryScore = 60;
  }

  // 4. 动量分析
  const mom20 = closes.length > 20
    ? (closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21] * 100
    : 0;
  let momentumScore = 50;
  if (mom20 > 10) momentumScore = 85;
  else if (mom20 > 5) momentumScore = 70;
  else if (mom20 > 0) momentumScore = 55;
  else if (mom20 > -5) momentumScore = 45;
  else if (mom20 > -10) momentumScore = 35;
  else momentumScore = 20;

  // 综合潜力评分
  const weights = ETF_POTENTIAL_DIMENSIONS;
  const totalScore = Math.round(
    technicalScore * weights.technical.weight +
    fundScore * weights.fundFlow.weight +
    industryScore * weights.industry.weight +
    momentumScore * 0.15 +
    50 * weights.valuation.weight // 估值暂用默认值
  );

  // 潜力等级
  let potential;
  if (totalScore >= 80) potential = "高潜力";
  else if (totalScore >= 65) potential = "中高潜力";
  else if (totalScore >= 50) potential = "中等潜力";
  else if (totalScore >= 35) potential = "中低潜力";
  else potential = "低潜力";

  return {
    score: totalScore,
    potential,
    dimensions: {
      technical: { score: technicalScore, label: "技术趋势", detail: currentPrice > ma20 ? "价格位于均线上方" : "价格位于均线下方" },
      fundFlow: { score: fundScore, label: "资金关注度", detail: fundScore > 60 ? "资金流入明显" : "资金关注一般" },
      industry: { score: industryScore, label: "行业景气度", detail: industryScore > 60 ? "行业景气度较高" : "行业景气度一般" },
      momentum: { score: momentumScore, label: "动量表现", detail: mom20 > 0 ? `近20日上涨${mom20.toFixed(1)}%` : `近20日下跌${Math.abs(mom20).toFixed(1)}%` },
    },
    mom20: +mom20.toFixed(1),
  };
}

// ==================== 核心: AI 智能选股 v3 ====================

async function aiPickStocks(query, options = {}) {
  const { topN = 5, focus = "balanced", apiKey, style = "balanced", industries = [], includeETF = true } = options;

  if (!apiKey) {
    throw new Error("需要配置 API Key");
  }

  // 1. 获取市场背景
  const indices = await getIndexQuotes().catch(() => []);

  // 2. 分析用户需求，确定选股策略
  const strategy = analyzeUserIntent(query, style);

  // 3. 根据策略选择股票池
  let stockPool = STOCK_POOL;
  let etfPool = includeETF ? ETF_POOL.all : [];

  // 如果用户指定了行业，优先从该行业选股/ETF
  if (strategy.industryFocus && strategy.industryFocus.length > 0) {
    const industryStocks = [];
    const industryETFs = [];
    for (const [code, industry] of Object.entries(INDUSTRY_MAP)) {
      if (strategy.industryFocus.some(i => industry.includes(i))) {
        industryStocks.push(code);
      }
    }
    for (const [code, industry] of Object.entries(ETF_INDUSTRY_MAP)) {
      if (strategy.industryFocus.some(i => industry.includes(i))) {
        industryETFs.push(code);
      }
    }
    if (industryStocks.length > 0) stockPool = [...new Set([...industryStocks, ...STOCK_POOL])];
    if (industryETFs.length > 0) etfPool = [...new Set([...industryETFs, ...etfPool])];
  }

  // 4. 并行采集所有候选股数据
  console.log(`[AI选股] 开始扫描 ${stockPool.length} 只股票 + ${etfPool.length} 只ETF...`);
  const candidates = await batchWithLimit([...stockPool, ...etfPool], async (code) => {
    try {
      const [klines, fundFlow, name] = await Promise.all([
        getKlineData(code, 250),
        getFundFlow(code, 10).catch(() => null),
        getStockName(code).catch(() => code),
      ]);

      if (klines.length < 60) return null;

      const closes = klines.map(k => k.close);
      const highs = klines.map(k => k.high);
      const lows = klines.map(k => k.low);
      const volumes = klines.map(k => k.volume);
      const dates = klines.map(k => k.date);
      const opens = klines.map(k => k.open);

      // 技术评分
      const screenResult = screen({ opens, highs, lows, closes, volumes, dates }, {});

      // 资金流向评分
      const flowSummary = aggregateFlow(fundFlow, 5);
      const flowResult = flowRating(flowSummary);

      // 因子评分
      const factorResult = computeFactorScore(klines);

      // 风险评分
      const riskResult = computeRiskScore(closes, highs, lows);

      // 技术形态分析
      const patternResult = analyzeTechnicalPattern(klines);

      // 动态权重（根据用户风格调整）
      const weights = getWeightsByStyle(strategy.style);

      // 综合评分
      const compositeScore = Math.round(
        screenResult.score * (weights.momentum + weights.quality + weights.position) +
        flowResult.score * weights.fundFlow +
        factorResult.score * weights.factor +
        riskResult.score * weights.risk
      );

      // 计算多周期涨跌
      const chg1 = closes.length > 1
        ? +((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100).toFixed(2)
        : 0;
      const chg5 = closes.length > 5
        ? +((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6] * 100).toFixed(2)
        : 0;
      const chg20 = closes.length > 20
        ? +((closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21] * 100).toFixed(2)
        : 0;

      // 判断是股票还是ETF
      const isETF = code.length === 6 && (ETF_INDUSTRY_MAP[code] || etfPool.includes(code));
      const itemType = isETF ? "ETF" : "股票";
      const industry = isETF ? (ETF_INDUSTRY_MAP[code] || "主题") : (INDUSTRY_MAP[code] || "未知");

      // 生成预警信息
      const alerts = generateAlerts(klines, fundFlow, patternResult, riskResult, { fundFlowDetails: flowResult });

      // ETF潜力分析
      let etfPotential = null;
      if (isETF) {
        etfPotential = analyzeETFPotential(klines, fundFlow, industry);
      }

      return {
        code, name,
        type: itemType,
        industry,
        lastPrice: closes[closes.length - 1],
        chg1, chg5, chg20,
        compositeScore,
        technicalScore: screenResult.score,
        fundFlowScore: flowResult.score,
        factorScore: factorResult.score,
        riskScore: riskResult.score,
        grade: compositeScore >= 70 ? "A+" : compositeScore >= 60 ? "A" : compositeScore >= 45 ? "B" : compositeScore >= 30 ? "C" : "D",
        flowLabel: flowResult.label,
        topReasons: (screenResult.reasons || []).slice(0, 4),
        launchStatus: screenResult.launchStatus || "未知",
        pattern: patternResult,
        factorDetails: factorResult,
        riskDetails: riskResult,
        fundFlowDetails: flowResult,
        alerts,
        etfPotential,
      };
    } catch (e) {
      return null;
    }
  }, 8);

  // 5. 筛选和排序（根据策略调整阈值）
  const minScore = strategy.style === "aggressive" ? 30 : strategy.style === "conservative" ? 45 : 35;
  const valid = candidates
    .filter(Boolean)
    .filter(c => c.compositeScore >= minScore)
    .sort((a, b) => {
      // 根据策略调整排序权重
      if (strategy.style === "momentum") {
        return b.factorScore - a.factorScore || b.compositeScore - a.compositeScore;
      } else if (strategy.style === "safety") {
        return b.riskScore - a.riskScore || b.compositeScore - a.compositeScore;
      } else {
        return b.compositeScore - a.compositeScore;
      }
    });

  const topCandidates = valid.slice(0, Math.min(20, valid.length));
  console.log(`[AI选股] 找到 ${valid.length} 只候选股，取 Top ${topCandidates.length} 送AI分析`);

  if (topCandidates.length === 0) {
    return {
      understanding: query,
      picks: [],
      marketContext: "",
      disclaimer: "以上分析仅供参考，不构成投资建议",
      generatedAt: new Date().toISOString(),
    };
  }

  // 6. 构建市场背景文本
  const marketText = indices.length > 0
    ? indices.slice(0, 4).map(i => `${i.name || i.code}: ${i.price} ${i.changePct >= 0 ? "+" : ""}${i.changePct}%`).join("；")
    : "";

  // 7. 构建 AI 输入数据（更丰富的维度）
  const aiInput = topCandidates.map(c => ({
    code: c.code,
    name: c.name,
    type: c.type || "股票",
    industry: c.industry,
    price: c.lastPrice,
    change: { "1d": c.chg1, "5d": c.chg5, "20d": c.chg20 },
    scores: {
      composite: c.compositeScore,
      technical: c.technicalScore,
      fundFlow: c.fundFlowScore,
      factor: c.factorScore,
      risk: c.riskScore,
    },
    grade: c.grade,
    flow: c.flowLabel,
    pattern: c.pattern,
    factorDetails: c.factorDetails,
    riskDetails: c.riskDetails,
    reasons: c.topReasons,
    launch: c.launchStatus,
    alerts: c.alerts || [],
    etfPotential: c.etfPotential,
  }));

  // 8. 调用 AI 生成推荐（更智能的提示词）
  const systemPrompt = buildSystemPrompt(strategy);
  const userMessage = buildUserMessage(query, strategy, marketText, aiInput, topN);

  console.log("[AI选股] 调用AI分析...");
  const aiResponse = await chatCompletion(apiKey, {
    model: getActiveModels(apiKey).pro,
    maxTokens: 2000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  // 9. 解析 AI 响应
  let parsed;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("无法解析AI返回的JSON");
    }
  } catch (e) {
    console.error("[AI选股] JSON解析失败:", e.message);
    parsed = {
      understanding: query,
      picks: topCandidates.slice(0, topN).map((c, i) => ({
        code: c.code,
        name: c.name,
        rank: i + 1,
        compositeScore: c.compositeScore,
        scores: { technical: c.technicalScore, fundFlow: c.fundFlowScore, factor: c.factorScore, risk: c.riskScore },
        grade: c.grade,
        price: c.lastPrice,
        change5d: c.chg5,
        summary: c.topReasons.join("；") || "综合评分靠前",
        risks: ["需结合基本面进一步分析"],
        highlights: c.topReasons,
      })),
    };
  }

  return {
    understanding: parsed.understanding || query,
    picks: parsed.picks || [],
    marketContext: marketText,
    strategy: strategy,
    disclaimer: "以上分析仅供参考，不构成投资建议",
    generatedAt: new Date().toISOString(),
  };
}

// ==================== 策略分析辅助函数 ====================

function analyzeUserIntent(query, style) {
  const intent = {
    style: style || "balanced",
    industryFocus: [],
    riskPreference: "medium",
    timeHorizon: "short", // short/medium/long
  };

  // 分析用户输入中的关键词
  const lowerQuery = query.toLowerCase();

  // ========== 风格判断（更全面的关键词）==========
  // 动量/趋势类
  if (lowerQuery.includes("涨") || lowerQuery.includes("强势") || lowerQuery.includes("突破") ||
      lowerQuery.includes("放量") || lowerQuery.includes("趋势") || lowerQuery.includes("追") ||
      lowerQuery.includes("启动") || lowerQuery.includes("牛")) {
    intent.style = "momentum";
  }
  // 价值/低估类
  else if (lowerQuery.includes("便宜") || lowerQuery.includes("低估") || lowerQuery.includes("价值") ||
           lowerQuery.includes("低pe") || lowerQuery.includes("低pb") || lowerQuery.includes("分红") ||
           lowerQuery.includes("股息") || lowerQuery.includes("蓝筹")) {
    intent.style = "value";
  }
  // 成长类
  else if (lowerQuery.includes("增长") || lowerQuery.includes("成长") || lowerQuery.includes("高增长") ||
           lowerQuery.includes("业绩") || lowerQuery.includes("利润") || lowerQuery.includes("高roe")) {
    intent.style = "growth";
  }
  // 安全/保守类
  else if (lowerQuery.includes("安全") || lowerQuery.includes("稳") || lowerQuery.includes("保守") ||
           lowerQuery.includes("低风险") || lowerQuery.includes("不亏") || lowerQuery.includes("稳健")) {
    intent.style = "conservative";
    intent.riskPreference = "low";
  }
  // 激进类
  else if (lowerQuery.includes("激进") || lowerQuery.includes("高收益") || lowerQuery.includes("大赚") ||
           lowerQuery.includes("翻倍") || lowerQuery.includes("暴")) {
    intent.style = "aggressive";
    intent.riskPreference = "high";
  }

  // ========== 行业判断（更全面的关键词）==========
  const industryKeywords = {
    "金融": ["金融", "银行", "保险", "券商", "证券", "信托"],
    "消费": ["消费", "白酒", "食品", "饮料", "家电", "零售", "食品饮料"],
    "科技": ["科技", "电子", "通信", "芯片", "半导体", "计算机", "软件", "人工智能", "ai", "5g"],
    "医药": ["医药", "医疗", "生物", "制药", "疫苗", "创新药", "CXO"],
    "新能源": ["新能源", "光伏", "电池", "锂电", "储能", "风电", "氢能", "碳中和"],
    "制造": ["制造", "工业", "机械", "汽车", "军工", "航空"],
    "周期": ["周期", "煤炭", "有色", "钢铁", "化工", "建材"],
  };

  // ETF相关关键词
  const etfKeywords = ["etf", "指数基金", "指数", "定投", "被动投资"];
  if (etfKeywords.some(kw => lowerQuery.includes(kw))) {
    intent.preferETF = true;
  }

  for (const [industry, keywords] of Object.entries(industryKeywords)) {
    if (keywords.some(kw => lowerQuery.includes(kw))) {
      intent.industryFocus.push(industry);
    }
  }

  // ========== 时间周期判断 ==========
  if (lowerQuery.includes("长期") || lowerQuery.includes("长线") || lowerQuery.includes("价值投资") ||
      lowerQuery.includes("半年") || lowerQuery.includes("一年")) {
    intent.timeHorizon = "long";
  } else if (lowerQuery.includes("中期") || lowerQuery.includes("波段") || lowerQuery.includes("月")) {
    intent.timeHorizon = "medium";
  }

  // ========== 特殊需求识别 ==========
  // 如果用户没有明确指定风格，根据其他线索推断
  if (intent.style === "balanced") {
    // 涨/跌相关的词暗示动量
    if (lowerQuery.includes("最近") || lowerQuery.includes("近期") || lowerQuery.includes("今天")) {
      intent.style = "momentum";
    }
  }

  return intent;
}

function getWeightsByStyle(style) {
  const weightMap = {
    balanced: { momentum: 0.30, quality: 0.25, position: 0.10, fundFlow: 0.20, factor: 0.10, risk: 0.05 },
    momentum: { momentum: 0.40, quality: 0.15, position: 0.05, fundFlow: 0.25, factor: 0.10, risk: 0.05 },
    value: { momentum: 0.15, quality: 0.35, position: 0.15, fundFlow: 0.15, factor: 0.10, risk: 0.10 },
    growth: { momentum: 0.30, quality: 0.25, position: 0.10, fundFlow: 0.20, factor: 0.10, risk: 0.05 },
    safety: { momentum: 0.15, quality: 0.30, position: 0.15, fundFlow: 0.15, factor: 0.10, risk: 0.15 },
    conservative: { momentum: 0.10, quality: 0.35, position: 0.15, fundFlow: 0.15, factor: 0.10, risk: 0.15 },
    aggressive: { momentum: 0.45, quality: 0.10, position: 0.05, fundFlow: 0.25, factor: 0.10, risk: 0.05 },
  };
  return weightMap[style] || weightMap.balanced;
}

function buildSystemPrompt(strategy) {
  const styleDesc = STYLE_TYPES[strategy.style] || STYLE_TYPES.balanced;

  return `你是一个股票和ETF分析师。用户会告诉你他想要什么样的投资标的，你需要根据提供的数据推荐最合适的。

## 用户的选股风格
${styleDesc.label}：${styleDesc.desc}

## 你的任务
1. 读懂用户想要什么（比如：要赚钱快的、要安全的、要便宜的、要涨得猛的等）
2. 从提供的股票和ETF数据中挑选最符合用户需求的
3. 用大白话告诉用户为什么选这些
4. 指出每只的风险
5. 根据预警信息提醒用户注意风险或机会
6. 对于ETF，要分析其发展潜力

## 关于ETF的说明
- ETF是指数基金，可以像股票一样买卖
- ETF适合看好某个行业/主题但不想选单只股票的用户
- ETF的优点：分散风险、交易方便、费率低
- ETF适合定投、长期持有、行业配置
- ETF潜力分析包括：技术趋势、资金关注度、行业景气度、动量表现

## 预警说明
- 技术面预警：金叉/死叉、均线排列、突破信号、量价关系
- 资金面预警：主力资金流入/流出、资金加速
- 风险预警：波动率过高、最大回撤过大、RSI超买/超卖
- 趋势预警：上涨/下跌/震荡趋势

## 回答要求
- 说人话，不要用专业术语
- 每只推荐理由要具体，不要空话
- 必须告诉用户风险是什么
- 根据预警信息提醒用户注意风险或机会
- 对于ETF，要说明其发展潜力和适合的投资方式
- 如果没有好标的就直说，不要硬推荐

## 必须返回JSON格式，不要其他文字：
{
  "understanding": "你理解的用户需求（一句话）",
  "marketAnalysis": "当前市场情况（50-100字）",
  "picks": [
    {
      "code": "股票代码",
      "name": "股票名称",
      "rank": 1,
      "compositeScore": 综合评分(0-100),
      "scores": {
        "technical": 技术面分数,
        "fundFlow": 资金面分数,
        "factor": 因子分数,
        "risk": 风险分数
      },
      "grade": "A+/A/B/C",
      "price": 最新价,
      "change": { "1d": 涨跌幅, "5d": 5日涨跌, "20d": 20日涨跌 },
      "summary": "80-120字推荐理由，包含技术面、资金面、风险三个方面的分析",
      "risks": ["风险1（具体说明）", "风险2（具体说明）"],
      "highlights": ["关键信号1", "关键信号2", "关键信号3"],
      "technicalAnalysis": {
        "trend": "趋势判断",
        "signals": ["信号1", "信号2"],
        "support": 支撑位,
        "resistance": 阻力位
      }
    }
  ]
}`;
}

function buildUserMessage(query, strategy, marketText, aiInput, topN) {
  const styleLabel = STYLE_TYPES[strategy.style]?.label || "均衡型";
  const industryHint = strategy.industryFocus.length > 0
    ? `用户想看的行业：${strategy.industryFocus.join("、")}`
    : "";

  // 构建用户需求的自然语言描述
  let userNeedDesc = "";
  if (strategy.style === "momentum") {
    userNeedDesc = "用户想找涨得猛、趋势向上的股票或ETF";
  } else if (strategy.style === "value") {
    userNeedDesc = "用户想找估值低、被低估的股票或ETF";
  } else if (strategy.style === "growth") {
    userNeedDesc = "用户想找业绩增长快、成长性好的股票或ETF";
  } else if (strategy.style === "conservative") {
    userNeedDesc = "用户想找风险小、走势稳的股票或ETF";
  } else if (strategy.style === "aggressive") {
    userNeedDesc = "用户想找收益高、波动大的股票或ETF（愿意承担高风险）";
  } else {
    userNeedDesc = "用户想找综合表现好的股票或ETF";
  }

  // 分类统计
  const stocks = aiInput.filter(i => i.type === "股票");
  const etfs = aiInput.filter(i => i.type === "ETF");

  return `用户说："${query}"

我的理解：${userNeedDesc}${industryHint ? '，' + industryHint : ''}

现在有以下可选（数据已经算好了，你直接用）：
- 股票 ${stocks.length} 只
- ETF ${etfs.length} 只

候选数据：
${JSON.stringify(aiInput.slice(0, 18), null, 2)}

请帮我：
1. 从上面选出 ${topN} 只最适合用户的（可以是股票也可以是ETF，哪个合适选哪个）
2. 每只用大白话说明为什么选它（2-3句话）
3. 每只要说清楚有什么风险（1-2条）
4. 如果有ETF，优先推荐适合定投或行业配置的ETF
5. 最后简单说说现在市场情况

注意：只返回JSON，不要说其他话。`;
}

module.exports = { aiPickStocks };

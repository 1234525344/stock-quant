// 量化交易平台 - 共享辅助函数模块
// 纯逻辑函数，不依赖 Express req/res，可被多个路由模块复用

const axios = require("axios");
const { getRealtimeQuotes, getKlineData, getStockName, batchWithLimit } = require("./data");
const { getIndexKline, getSectorFlow, getConceptFlow, ETF_MAP } = require("./index");
const { SMA, MACD, RSI, KDJ, BOLL } = require("./indicators");
const { FUND_SECTOR_MAP } = require("./state");

// ==================== 信号分析 ====================

async function getSignalsNow(code, preloadedKlines) {
  const klines = preloadedKlines || await getKlineData(code, 120);
  if (klines.length < 30) return { error: "数据不足" };

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const dates = klines.map(k => k.date);

  const ma5 = SMA(closes, 5);
  const ma10 = SMA(closes, 10);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);
  const { dif, dea } = MACD(closes);
  const rsi14 = RSI(closes, 14);
  const { k, d, j } = KDJ(highs, lows, closes);
  const { upper, lower } = BOLL(closes);

  const last = arr => arr[arr.length - 1];
  const prev = arr => arr[arr.length - 2];

  const signals = {};

  // 双均线
  if (last(ma5) && last(ma20) && prev(ma5) && prev(ma20)) {
    if (last(ma5) > last(ma20) && prev(ma5) <= prev(ma20)) {
      signals.maCross = "buy";
      signals.maCrossDetail = `★金叉 MA5(${last(ma5).toFixed(2)})↑上穿 MA20(${last(ma20).toFixed(2)})`;
    } else if (last(ma5) < last(ma20) && prev(ma5) >= prev(ma20)) {
      signals.maCross = "sell";
      signals.maCrossDetail = `★死叉 MA5(${last(ma5).toFixed(2)})↓下穿 MA20(${last(ma20).toFixed(2)})`;
    } else {
      signals.maCross = last(ma5) > last(ma20) ? "buy" : "sell";
      signals.maCrossDetail = `MA5(${last(ma5).toFixed(2)}) ${last(ma5) > last(ma20) ? ">" : "<"} MA20(${last(ma20).toFixed(2)})`;
    }
  }

  // MACD
  if (last(dif) != null && last(dea) != null) {
    if (last(dif) > last(dea) && prev(dif) <= prev(dea)) signals.macd = "buy";
    else if (last(dif) < last(dea) && prev(dif) >= prev(dea)) signals.macd = "sell";
    else signals.macd = last(dif) > last(dea) ? "buy" : "sell";
    signals.macdDetail = `DIF(${last(dif).toFixed(3)}) ${last(dif) > last(dea) ? ">" : "<"} DEA(${last(dea).toFixed(3)})`;
  }

  // RSI
  if (last(rsi14) != null) {
    signals.rsi = last(rsi14) < 30 ? "buy" : last(rsi14) > 70 ? "sell" : "neutral";
    signals.rsiDetail = `RSI=${last(rsi14).toFixed(1)}`;
  }

  // 布林带
  if (last(upper) && last(lower) && last(closes)) {
    const closePrice = last(closes);
    signals.boll = closePrice <= last(lower) * 1.02 ? "buy" : closePrice >= last(upper) * 0.98 ? "sell" : "neutral";
    signals.bollDetail = `收盘${closePrice.toFixed(2)} vs 上轨${last(upper).toFixed(2)}/下轨${last(lower).toFixed(2)}`;
  }

  // KDJ
  if (last(k) != null && last(d) != null) {
    if (last(k) > last(d) && prev(k) <= prev(d)) signals.kdj = "buy";
    else if (last(k) < last(d) && prev(k) >= prev(d)) signals.kdj = "sell";
    else signals.kdj = last(k) > last(d) ? "buy" : "sell";
    signals.kdjDetail = `K(${last(k).toFixed(1)}) ${last(k) > last(d) ? ">" : "<"} D(${last(d).toFixed(1)}) J=${last(j).toFixed(1)}`;
  }

  // 趋势
  if (last(ma60)) {
    signals.trend = last(closes) > last(ma60) ? "buy" : "sell";
    signals.trendDetail = `收盘${last(closes).toFixed(2)} ${last(closes) > last(ma60) ? ">" : "<"} MA60(${last(ma60).toFixed(2)})`;
  }

  // 成交量
  const avgVol20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const lastVol = last(volumes);
  const volRatio = lastVol / avgVol20;
  signals.volRatio = +volRatio.toFixed(2);
  signals.volumeConfirmed = volRatio > 1.2;

  // 综合投票
  const votes = { buy: 0, sell: 0, neutral: 0 };
  const voteKeys = ["maCross", "macd", "rsi", "boll", "kdj", "trend"];
  for (const key of voteKeys) {
    const v = signals[key];
    if (v === "buy" || v === "sell" || v === "neutral") {
      votes[v] = (votes[v] || 0) + 1;
    }
  }
  const buyVotes = votes.buy || 0;
  const sellVotes = votes.sell || 0;
  let consensus = buyVotes > sellVotes + 1 ? "strong_buy" :
    buyVotes > sellVotes ? "buy" :
    sellVotes > buyVotes + 1 ? "strong_sell" :
    sellVotes > buyVotes ? "sell" : "neutral";
  if (volRatio < 0.7 && consensus === "strong_buy") consensus = "buy";
  if (volRatio < 0.7 && consensus === "strong_sell") consensus = "sell";
  if (volRatio < 0.5) consensus = "neutral";
  signals.consensus = consensus;
  signals.votes = { buy: buyVotes, sell: sellVotes, neutral: votes.neutral || 0 };

  // 支撑/阻力位
  const recent20High = Math.max(...highs.slice(-20, -1));
  const recent20Low = Math.min(...lows.slice(-20, -1));
  const recent60High = highs.length >= 60 ? Math.max(...highs.slice(-60, -1)) : recent20High;
  const recent60Low = lows.length >= 60 ? Math.min(...lows.slice(-60, -1)) : recent20Low;
  signals.levels = {
    resistance: [
      { level: +last(ma20).toFixed(2), label: "MA20" },
      { level: +recent20High.toFixed(2), label: "20日高点" },
      { level: +recent60High.toFixed(2), label: "60日高点" },
    ].filter(l => l.level > last(closes)).sort((a, b) => a.level - b.level).slice(0, 3),
    support: [
      { level: +recent20Low.toFixed(2), label: "20日低点" },
      { level: +last(ma20).toFixed(2), label: "MA20" },
      { level: +last(ma60).toFixed(2), label: "MA60" },
    ].filter(l => l.level < last(closes)).sort((a, b) => b.level - a.level).slice(0, 3),
  };

  // 建议入场价
  const buyZone = +((last(ma20) + recent20Low) / 2).toFixed(2);
  signals.suggestedEntry = {
    buyZone,
    stopLoss: +(recent20Low * 0.97).toFixed(2),
    targetPrice: +(last(closes) * 1.05).toFixed(2),
    riskReward: +((last(closes) * 0.05) / (last(closes) - recent20Low * 0.97)).toFixed(1),
  };

  // 价格信息
  const name = await getStockName(code).catch(() => "");
  signals.price = last(closes);
  signals.prevClose = prev(closes);
  signals.changePct = prev(closes) ? +((last(closes) - prev(closes)) / prev(closes) * 100).toFixed(2) : 0;
  signals.date = last(dates);
  signals.code = code;
  signals.name = name;

  return signals;
}

// ==================== 市场状态 ====================

async function detectMarketState() {
  try {
    const indexData = await getIndexKline("000001", 60).catch(() => []);
    if (indexData.length < 30) return { state: "unknown", trend: 0, volatility: 0 };

    const closes = indexData.map(k => k.close);
    const ma20 = SMA(closes, 20);
    const ma60 = SMA(closes, 60);
    const last = arr => arr[arr.length - 1];
    const prev = arr => arr[arr.length - 2];

    const priceVsMA20 = last(closes) / last(ma20) - 1;
    const priceVsMA60 = last(closes) / last(ma60) - 1;
    const ma20Dir = last(ma20) > prev(ma20) ? 1 : -1;
    const trend = (priceVsMA20 + priceVsMA60) / 2 + ma20Dir * 0.02;

    const dailyRets = [];
    for (let i = 1; i < Math.min(30, closes.length); i++) {
      dailyRets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const avgRet = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
    const vol = Math.sqrt(dailyRets.reduce((s, r) => s + (r - avgRet) ** 2, 0) / dailyRets.length);

    let state;
    if (trend > 0.01) state = "uptrend";
    else if (trend < -0.01) state = "downtrend";
    else state = "ranging";

    return { state, trend: +trend.toFixed(4), volatility: +(vol * 100).toFixed(1) };
  } catch (e) {
    return { state: "unknown", trend: 0, volatility: 0 };
  }
}

function isMarketOpen() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const h = now.getHours(), m = now.getMinutes();
  const t = h * 60 + m;
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

function isTradingHours() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= 550 && minutes <= 905;
}

function matchETFToSector(item, etfMap) {
  const name = item.name || item.f14 || "";
  const etfs = [];
  const lower = name.toLowerCase();
  for (const [key, codes] of Object.entries(etfMap)) {
    const k = key.toLowerCase();
    if (name.includes(key) || lower.includes(k) || key.includes(name.replace(/[ETFLOF]/gi, "").slice(0, 3))) {
      etfs.push(...codes);
    }
  }
  return {
    code: item.code || item.f12, name,
    price: item.price || item.f2, changePct: item.changePct || item.f3,
    mainNet: item.mainNet || item.f62 || 0, hugeNet: item.hugeNet || item.f66 || 0,
    largeNet: item.largeNet || item.f69 || 0, mainPct: item.mainPct || item.f184 || 0,
    etfs: [...new Set(etfs)].slice(0, 3),
  };
}

async function getEtfFlow() {
  try {
    const ts = Date.now();
    const url = `https://push2.eastmoney.com/api/qt/clist/get?cb=jQuery_${ts}&pn=1&pz=30&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f62&fs=m:90+t:4&fields=f2,f3,f4,f12,f14,f62,f66,f69,f184&_=${ts}`;
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://data.eastmoney.com/bkzj/hy.html" },
    });
    const text = resp.data;
    const jsonStr = text.replace(/^jQuery\d+_\d+\(/, "").replace(/\);?$/, "");
    const obj = JSON.parse(jsonStr);
    const list = obj?.data?.diff || [];
    return list.map(d => matchETFToSector(d, ETF_MAP));
  } catch (e) {
    try {
      const sectors = await getSectorFlow().catch(() => []);
      return (sectors || []).slice(0, 20).map(s => ({
        ...matchETFToSector(s, ETF_MAP),
        _fallback: true,
      }));
    } catch (e2) {
      return [];
    }
  }
}

// ==================== 基金数据 ====================

async function getFundSectors() {
  const [sectors, concepts] = await Promise.all([
    getSectorFlow().catch(() => []),
    getConceptFlow().catch(() => []),
  ]);

  const sectorMap = {};
  for (const s of sectors) {
    let matched = null;
    for (const [key, cfg] of Object.entries(FUND_SECTOR_MAP)) {
      if (s.name.includes(key) || cfg.keywords.some(kw => s.name.includes(kw))) {
        matched = cfg; break;
      }
    }
    if (!matched) continue;
    const tag = matched.tag;
    if (!sectorMap[tag]) sectorMap[tag] = { tag, icon: matched.icon, totalMainNet: 0, totalAmount: 0, sectors: [], changePctSum: 0, count: 0 };
    sectorMap[tag].totalMainNet += s.mainNet || 0;
    sectorMap[tag].changePctSum += s.changePct || 0;
    sectorMap[tag].count++;
    sectorMap[tag].sectors.push(s.name);
    sectorMap[tag].totalAmount += s.amount || 0;
  }

  return Object.values(sectorMap).sort((a, b) => b.totalMainNet - a.totalMainNet);
}

async function getFundRanking(params = {}) {
  const { type = "all", sort = "1y", limit = 20 } = params;
  try {
    const fs = type === "stock" ? "gp" : type === "bond" ? "zq" : type === "qdii" ? "qdii" : "all";
    const url = `https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=${fs}&rs=&gs=0&sc=${sort}&st=desc&pi=1&pn=${limit}`;
    const resp = await axios.get(url, {
      timeout: 8000,
      headers: { "Referer": "https://fund.eastmoney.com/data/fundranking.html" }
    });
    const match = resp.data.match(/var rankData = \{datas:\[(.*?)\]/);
    if (!match) return { funds: [] };
    const items = match[1].split('","').map(s => s.replace(/"/g, '').split(','));
    const funds = items.filter(f => f.length > 5).map(f => ({
      code: f[0],
      name: f[1],
      type: f[2],
      date: f[3],
      nav: parseFloat(f[4]) || 0,
      navGrowth: parseFloat(f[5]) || 0,
    }));
    return { funds };
  } catch (e) {
    return { funds: [], error: e.message };
  }
}

// ==================== 投资建议 ====================

async function getAdvice(code) {
  const [sigResp, marketState, quoteArr] = await Promise.all([
    getSignalsNow(code).catch(() => null),
    detectMarketState(),
    getRealtimeQuotes([code]).catch(() => []),
  ]);

  const name = (quoteArr[0]?.name) || await getStockName(code).catch(() => code);
  const price = quoteArr[0]?.price || sigResp?.price || 0;

  if (!sigResp || sigResp.error) return { error: "信号数据获取失败" };

  const consensus = sigResp.consensus;
  const votes = sigResp.votes || {};
  const volRatio = sigResp.volRatio || 1;
  const buyVotes = votes.buy || 0;
  const sellVotes = votes.sell || 0;

  let basePct = 0;
  let action;
  switch (consensus) {
    case "strong_buy": basePct = 0.60; action = "build"; break;
    case "buy": basePct = 0.40; action = "build"; break;
    case "neutral": basePct = 0; action = "hold"; break;
    case "sell": basePct = -0.40; action = "reduce"; break;
    case "strong_sell": basePct = -0.80; action = "clear"; break;
    default: basePct = 0; action = "hold";
  }

  let marketModifier = 0;
  if (marketState.state === "uptrend") {
    marketModifier = action === "build" ? 0.10 : action === "reduce" ? -0.05 : 0;
  } else if (marketState.state === "downtrend") {
    marketModifier = action === "build" ? -0.15 : action === "reduce" ? 0.10 : 0;
  } else {
    marketModifier = action === "build" ? -0.05 : action === "reduce" ? 0.05 : 0;
  }

  let volModifier = 0;
  if (volRatio < 0.7) volModifier = action === "build" ? -0.10 : action === "reduce" ? 0.05 : 0;
  else if (volRatio > 1.5) volModifier = action === "build" ? 0.05 : action === "reduce" ? -0.05 : 0;

  let suggestedPct = Math.max(-1, Math.min(1, basePct + marketModifier + volModifier));
  suggestedPct = +suggestedPct.toFixed(2);

  if (suggestedPct > 0.4) action = "build";
  else if (suggestedPct > 0.15) action = "add";
  else if (suggestedPct >= -0.15) action = "hold";
  else if (suggestedPct > -0.5) action = "reduce";
  else action = "clear";

  const reasons = [];
  reasons.push(`${buyVotes}买${sellVotes}卖信号投票`);
  reasons.push(`市场状态: ${marketState.state === "uptrend" ? "趋势向上" : marketState.state === "downtrend" ? "趋势向下" : "震荡"}`);
  if (volRatio < 0.7) reasons.push("成交量萎缩，信号可靠性降低");
  else if (volRatio > 1.5) reasons.push("放量交易，信号强度增强");

  return {
    code, name, price,
    action,
    suggestedPct,
    confidence: Math.min(100, Math.round(Math.abs(suggestedPct) * 80 + (volRatio > 1 ? 15 : 0))),
    reasoning: reasons.join("；"),
    signals: consensus,
    marketState: marketState.state,
    updatedAt: new Date().toISOString(),
  };
}

// ==================== 股票分析 ====================

async function getStockAnalysis(code) {
  const [klines, quote, indexKlines] = await Promise.all([
    getKlineData(code, 365).catch(() => []),
    getRealtimeQuotes([code]).catch(() => []),
    getIndexKline("000001", 250).catch(() => []),
  ]);
  // 复用已拉取的K线，避免重复请求
  const signals = await getSignalsNow(code, klines.slice(-120)).catch(() => null);
  const name = (quote[0]?.name) || await getStockName(code);
  const price = quote[0]?.price || signals?.price || 0;
  const changePct = quote[0]?.change || signals?.changePct || 0;

  const closes = klines.map(k => k.close);
  const high52w = klines.length ? Math.max(...klines.map(k => k.high)) : 0;
  const low52w = klines.length ? Math.min(...klines.map(k => k.low)) : 0;
  const distFrom52wHigh = high52w ? +((high52w - price) / high52w * 100).toFixed(1) : null;
  const distFrom52wLow = low52w ? +((price - low52w) / low52w * 100).toFixed(1) : null;

  const rollingVols = [];
  for (let i = 20; i < closes.length; i++) {
    const slice = closes.slice(i - 20, i);
    const avg = slice.reduce((a, b) => a + b, 0) / 20;
    const variance = slice.reduce((s, v) => s + (v - avg) ** 2, 0) / 20;
    rollingVols.push(Math.sqrt(variance) / avg);
  }
  const currentVol = rollingVols[rollingVols.length - 1] || 0;
  const sortedVols = [...rollingVols].sort((a, b) => a - b);
  const volPercentile = sortedVols.length ? +(sortedVols.findIndex(v => v >= currentVol) / sortedVols.length * 100).toFixed(0) : null;

  const volumes = klines.map(k => k.volume).slice(-21);
  const avgVol20 = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / 20;
  const lastVol = volumes[volumes.length - 1];
  const volRatio = avgVol20 ? +(lastVol / avgVol20).toFixed(2) : null;

  let beta = null;
  if (indexKlines.length >= 60 && klines.length >= 60) {
    const stockRets = [];
    const idxRets = [];
    for (let i = 1; i < Math.min(klines.length, indexKlines.length); i++) {
      stockRets.push((klines[i].close - klines[i - 1].close) / klines[i - 1].close);
      idxRets.push((indexKlines[i].close - indexKlines[i - 1].close) / indexKlines[i - 1].close);
    }
    const avgS = stockRets.reduce((a, b) => a + b, 0) / stockRets.length;
    const avgI = idxRets.reduce((a, b) => a + b, 0) / idxRets.length;
    const cov = stockRets.reduce((s, r, i) => s + (r - avgS) * (idxRets[i] - avgI), 0) / stockRets.length;
    const varI = idxRets.reduce((s, r) => s + (r - avgI) ** 2, 0) / idxRets.length;
    beta = varI ? +(cov / varI).toFixed(2) : null;
  }

  return {
    code, name, price, changePct,
    fiftyTwoWeek: { high: high52w, low: low52w, distFromHigh: distFrom52wHigh, distFromLow: distFrom52wLow },
    volatility: { current: +(currentVol * 100).toFixed(1), percentile: volPercentile },
    volume: { lastVol, avgVol20, volRatio },
    risk: { beta },
    signals: signals || {},
  };
}

module.exports = {
  getSignalsNow,
  detectMarketState,
  isMarketOpen,
  isTradingHours,
  matchETFToSector,
  getEtfFlow,
  getFundSectors,
  getFundRanking,
  getAdvice,
  getStockAnalysis,
};

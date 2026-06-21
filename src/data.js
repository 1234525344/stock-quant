// 股票数据获取 — 新浪财经 + 腾讯接口 + 东方财富
// v6: HTTP连接池, keepAlive, 请求去重, 指数退避重试
const axios = require("axios");
const iconv = require("iconv-lite");
const http = require("http");
const https = require("https");
const { RequestQueue, fetchWithRetry, batchWithRetry } = require("./request-queue");

// ============ HTTP连接池 (复用TCP连接, 降低延迟) ============
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 10000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 10000,
});

const apiClient = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 8000,
  decompress: true,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Encoding": "gzip, deflate",
  },
});

// 请求去重 + 退避重试: 相同URL的并发请求复用同一个Promise
const inflightRequests = new Map();
/**
 * HTTP GET 请求去重 — 相同 URL 的并发请求复用同一个 Promise
 * @param {string} url
 * @param {object} opts — axios 配置项
 * @returns {Promise<object>} 响应 data
 */
function dedupedGet(url, opts = {}) {
  const key = url;
  if (inflightRequests.has(key)) {
    return inflightRequests.get(key);
  }
  const promise = fetchWithRetry(
    () => apiClient.get(url, opts),
    { maxRetries: 1, baseDelay: 2000, label: url.slice(0, 80), circuitKey: "eastmoney", circuitThreshold: 10, circuitCooldown: 120000, timeout: 10000 }
  ).finally(() => {
    inflightRequests.delete(key);
  });
  inflightRequests.set(key, promise);
  return promise;
}

function toSymbol(code) {
  if (code.startsWith("5") || code.startsWith("6")) return `sh${code}`;
  return `sz${code}`;
}

// 全局股票名称缓存 (LRU, 上限2000)
const nameCache = new Map();
const NAME_CACHE_MAX = 2000;

function cacheName(code, name) {
  if (nameCache.size >= NAME_CACHE_MAX) {
    const firstKey = nameCache.keys().next().value;
    nameCache.delete(firstKey);
  }
  nameCache.set(code, name);
}

// ============ 实时行情 ============

// 内联引用实时引擎 (延迟加载，避免循环依赖)
let _engine = null;
function _getEngine() {
  if (!_engine) {
    try { _engine = require("./realtime-engine").getRealtimeEngine(); } catch (e) {}
  }
  return _engine;
}

/**
 * 获取实时行情 — 优先引擎缓存 → 本地 TDX → HTTP
 * @param {string[]} codes — 6 位股票代码数组
 * @returns {Promise<Array<{code:string, name:string, price:number, change:number, changePercent:number, preClose:number, open:number, high:number, low:number, volume:number, amount:number}>>}
 */
async function getRealtimeQuotes(codes) {
  // 1. 优先从实时引擎缓存获取
  const engine = _getEngine();
  if (engine && engine.quoteCache) {
    const cached = [];
    const missed = [];
    for (const c of codes) {
      const q = engine.getQuote(c);
      if (q) { cached.push(q); }
      else { missed.push(c); }
    }
    if (missed.length === 0) return cached;
    codes = missed; // 只请求未缓存的
  }

  // 2. TDX TCP 优先 (pytdx, 非期权代码)
  const httpCodes = codes.filter(c => c.length <= 6);
  const optionCodes = codes.filter(c => c.length === 8);
  let results = [];

  if (httpCodes.length > 0) {
    // 先尝试 TDX (pytdx TCP, 速度快)
    try {
      const { getTdxQuotes } = require("./tdx-bridge");
      const tdxResults = await getTdxQuotes(httpCodes);
      if (tdxResults.length > 0) {
        results.push(...tdxResults.filter(q => q.price > 0));
        // 更新引擎缓存
        if (engine) tdxResults.forEach(q => engine.quoteCache.set(q.code, { time: Date.now(), data: { ...q, source: "tdx_tcp" } }));
        // 移除已获取的代码
        const gotCodes = new Set(tdxResults.filter(q => q.price > 0).map(q => q.code));
        const remaining = httpCodes.filter(c => !gotCodes.has(c));
        if (remaining.length === 0) {
          // 全部获取成功, 跳过 HTTP (期权仍然需要获取)
          if (optionCodes.length > 0) {
            try {
              const { getOptionQuotes } = require("./opt-bridge");
              const optData = await getOptionQuotes(optionCodes);
              if (optData.length) results.push(...optData.filter(q => q.price > 0));
            } catch(e) {}
          }
          return results;
        }
        httpCodes.length = 0;
        httpCodes.push(...remaining);
      }
    } catch(e) { /* TDX失败, 降级HTTP */ }
  }

  if (httpCodes.length > 0) {
    try {
      const symbols = httpCodes.map(c => toSymbol(c)).join(",");
      const url = `https://hq.sinajs.cn/list=${symbols}`;
      const resp = await dedupedGet(url, {
        timeout: 8000, responseType: "arraybuffer",
        headers: { Referer: "https://finance.sina.com.cn" },
      });
      const data = iconv.decode(Buffer.from(resp.data), "GBK");
      if (data) {
        const lines = data.split("\n").filter(Boolean);
        for (const line of lines) {
          const match = line.match(/hq_str_(.+)="(.+)"/);
          if (!match) continue;
          const [, symbol, raw] = match;
          const fields = raw.split(",");
          if (fields.length < 10) continue;
          const code = symbol.slice(2);
          const name = fields[0];
          cacheName(code, name);
          results.push({
            code, name,
            open: +fields[1], preClose: +fields[2], price: +fields[3],
            high: +fields[4], low: +fields[5],
            volume: +fields[8], amount: +fields[9],
            change: fields[3] && fields[2] ? +(((fields[3] - fields[2]) / fields[2]) * 100).toFixed(2) : null,
            changeAmount: fields[3] && fields[2] ? +(fields[3] - fields[2]).toFixed(2) : null,
            turnover: null, pe: null, totalValue: null, floatValue: null,
          });
        }
        if (engine) results.forEach(q => engine.quoteCache.set(q.code, { time: Date.now(), data: { ...q, source: "sina_http" } }));
      }
    } catch(e) { /* HTTP failed, will try TDX below */ }
  }

  // 3. 期权代码 → akshare (Sina SSE 实时行情, 免费)
  if (optionCodes.length > 0) {
    try {
      const { getOptionQuotes } = require("./opt-bridge");
      const optResults = await getOptionQuotes(optionCodes);
      const validOpts = optResults.filter(q => q.price > 0);
      if (validOpts.length > 0) {
        results.push(...validOpts);
        if (engine) validOpts.forEach(q => engine.quoteCache.set(q.code, { time: Date.now(), data: { ...q, source: "akshare" } }));
        // 补全缺失的期权代码（手动录入数据）
        const missingOpts = optionCodes.filter(c => !validOpts.find(q => q.code === c));
        if (missingOpts.length > 0) {
          try {
            const { getTDXSnapshot } = require("./tdx-reader");
            const tdxOpt = getTDXSnapshot(missingOpts);
            if (tdxOpt.length) results.push(...tdxOpt);
          } catch(e) {}
        }
      } else {
        // akshare失败, 尝试TDX本地
        try {
          const { getTDXSnapshot } = require("./tdx-reader");
          const tdxResults = getTDXSnapshot(optionCodes);
          if (tdxResults.length) {
            results.push(...tdxResults);
            if (engine) tdxResults.forEach(q => engine.quoteCache.set(q.code, { time: Date.now(), data: { ...q, source: "tdx_snapshot" } }));
          }
        } catch(e) {}
      }
    } catch(e) { /* 期权数据源全部失败 */ }
  }

  return results;
}

// ============ K线数据 ============

/**
 * 获取日K线数据 — 多级降级: TDX 本地 → 腾讯 → 东方财富
 * @param {string} code — 6 位股票代码
 * @param {number} days — 获取天数
 * @returns {Promise<Array<{date:string, open:number, close:number, high:number, low:number, volume:number}>>}
 */
async function getKlineData(code, days = 365) {
  const sym = toSymbol(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,,,${days},qfq`;
  try {
    const { data } = await dedupedGet(url, {
      timeout: 8000,
      headers: { Referer: "https://gu.qq.com" },
    });
    if (!data?.data?.[sym]) return getKlineFromSina(code, days);
    const klines = data.data[sym].qfqday || data.data[sym].day || [];
    return klines.map(k => ({
      date: k[0], open: +k[1], close: +k[2],
      high: +k[3], low: +k[4], volume: +k[5],
      amount: null, chg: null,
    }));
  } catch (e) {
    return getKlineFromSina(code, days);
  }
}

async function getKlineFromSina(code, days = 365) {
  const sym = toSymbol(code);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=${days}`;
  try {
    const { data } = await apiClient.get(url, { timeout: 8000 });
    if (!Array.isArray(data)) return [];
    return data.map(k => ({
      date: k.day, open: +k.open, close: +k.close,
      high: +k.high, low: +k.low, volume: +k.volume,
      amount: null, chg: null,
    }));
  } catch (e) { return []; }
}

// ============ 搜索 ============

async function searchStock(keyword) {
  try {
    const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(keyword)}&t=all&count=20`;
    const { data } = await apiClient.get(url, { timeout: 5000 });
    const match = data.match(/"(.*)"/);
    if (!match) return [];
    return match[1].split("^").map(item => {
      const p = item.split("~");
      return { code: p[1], name: p[2], market: p[0] };
    }).filter(s => s.code && s.name);
  } catch (e) { return []; }
}

// ============ 并发控制 (带退避重试) ============

async function batchWithLimit(items, fn, limit = 10) {
  const results = await batchWithRetry(items, fn, { concurrency: limit, label: "batchWithLimit" });
  return results.filter(Boolean);
}

// ============ 股票名称 ============

async function getStockName(code) {
  if (nameCache.has(code)) return nameCache.get(code);

  // 检查实时引擎
  const engine = _getEngine();
  if (engine) {
    const q = engine.getQuote(code);
    if (q?.name) { cacheName(code, q.name); return q.name; }
  }

  try {
    const quotes = await getRealtimeQuotes([code]);
    if (quotes[0]?.name) { cacheName(code, quotes[0].name); return quotes[0].name; }
  } catch (e) {}

  // 盘后回退: 腾讯搜索API (全天可用)
  try {
    const results = await searchStock(code);
    const match = results.find(r => r.code === code);
    if (match?.name) { cacheName(code, match.name); return match.name; }
  } catch (e) {}

  return "";
}

// ============ 资金流向 ============

// 东方财富 push2 API (HTTP 直连, 快速失败)
function nativeHttpsGet(url, timeoutMs = 5000) {
  const httpUrl = url.replace(/^https:\/\//, "http://");
  return new Promise((resolve, reject) => {
    const req = http.get(httpUrl, {
      timeout: timeoutMs,
      agent: httpAgent,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com" },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error("JSON parse failed")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// 东方财富 secid: 深市(0/2/3开头)=0. 沪市(5/6/9等)=1.
function toSecid(code) {
  return /^[023]/.test(code) ? `0.${code}` : `1.${code}`;
}

/**
 * 获取个股资金流向 (日级别) — 东方财富 push2 API
 * @param {string} code — 6 位股票代码
 * @param {number} days — 天数
 * @returns {Promise<Array<{date:string, mainNet:number, mainPct:number, hugeNet:number, largeNet:number, midNet:number, smallNet:number}>>}
 */
async function getFundFlow(code, days = 30) {
  const secid = toSecid(code);
  const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&lmt=${days}`;
  try {
    const data = await nativeHttpsGet(url);
    if (!data?.data?.klines) return [];
    return data.data.klines.map(line => {
      const p = line.split(",");
      const main = +p[1], mainPct = +p[6];
      // 东方财富API不直接返回总成交额, 由主力净额和占比反推
      const totalAmount = mainPct !== 0 ? Math.abs(main / mainPct * 100) : 0;
      return {
        date: p[0],
        main, retail: +p[2], mid: +p[3],
        large: +p[4], huge: +p[5],
        mainPct, retailPct: +p[7], midPct: +p[8],
        largePct: +p[9], hugePct: +p[10],
        totalAmount: +totalAmount.toFixed(0),
      };
    });
  } catch (e) { return []; }
}

async function getFundFlowMinute(code) {
  const secid = toSecid(code);
  const url = `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=1&lmt=240`;
  try {
    const data = await nativeHttpsGet(url);
    if (!data?.data?.klines) return null;
    const klines = data.data.klines;
    const latest = klines[klines.length - 1];
    if (!latest) return null;
    const p = latest.split(",");
    const items = klines.map(line => {
      const parts = line.split(",");
      return { time: parts[0], main: +parts[1], retail: +parts[2], mid: +parts[3], large: +parts[4], huge: +parts[5] };
    });
    return {
      time: p[0],
      main: +p[1], retail: +p[2], mid: +p[3],
      large: +p[4], huge: +p[5],
      mainPct: p[6] ? +p[6] : null,
      retailPct: p[7] ? +p[7] : null,
      midPct: p[8] ? +p[8] : null,
      trend: items,
    };
  } catch (e) { return null; }
}

// ============ 东方财富K线 ============

async function getKlineEastMoney(code, days = 365) {
  const secid = toSecid(code);
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&lmt=${days}`;
  try {
    const { data } = await dedupedGet(url, {
      timeout: 8000,
      headers: { Referer: "https://quote.eastmoney.com" },
    });
    if (!data?.data?.klines) return [];
    return data.data.klines.map(line => {
      const p = line.split(",");
      return {
        date: p[0], open: +p[1], close: +p[2],
        high: +p[3], low: +p[4], volume: +p[5],
        amount: +p[6], chg: p[7] ? +p[7] : null,
      };
    });
  } catch (e) { return []; }
}

// 获取日内走势数据 (东方财富 trends2, 每笔/每分钟价格)
// 收盘后自动回退到历史分钟K线，确保任何时候都能看到当日走势
async function getIntradayTrend(code) {
  const secid = toSecid(code);
  const url = `https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`;
  try {
    const data = await nativeHttpsGet(url);
    if (data?.data?.trends?.length) {
      return data.data.trends.map(line => {
        const p = line.split(",");
        return {
          time: p[0].split(" ")[1] || p[0],
          price: +p[1],
          open: +p[1], high: +p[1], low: +p[1], close: +p[1],
          volume: +p[5], amount: +p[6],
        };
      });
    }
  } catch (e) { /* fallback below */ }

  // 收盘后 push2 返回空数据，回退到历史1分钟K线
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const fallbackUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=1&fqt=0&beg=${today}&end=${today}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
  try {
    const data = await nativeHttpsGet(fallbackUrl);
    if (!data?.data?.klines) return [];
    return data.data.klines.map(line => {
      const p = line.split(",");
      return {
        time: p[0].split(" ")[1] || p[0],
        open: +p[1], close: +p[2], high: +p[3], low: +p[4],
        volume: +p[5], amount: +p[6],
        price: +p[2], // 收盘价作为价格
      };
    });
  } catch (e) { return []; }
}

async function getKlineDataEnhanced(code, days = 365) {
  // 优先TDX本地
  try {
    const { getTDXKline } = require("./tdx-reader");
    const tdx = getTDXKline(code, days);
    if (tdx.length > 0) return tdx;
  } catch (e) {}

  // 腾讯 → 东方财富
  try {
    const data = await getKlineData(code, days);
    if (data.length > 0) return data;
  } catch (e) {}
  return getKlineEastMoney(code, days);
}

// ============ 其他数据 ============

async function getLimitUpDown(date) {
  try {
    // 如果没传日期，自动取上一个交易日
    let tradeDate = date;
    if (!tradeDate) {
      const now = new Date();
      // 往前找最多7天
      for (let i = 1; i <= 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        // 跳过周末
        if (d.getDay() === 0 || d.getDay() === 6) continue;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        tradeDate = `${y}${m}${dd}`;
        break;
      }
    }
    const formattedDate = tradeDate ? `${tradeDate.slice(0,4)}-${tradeDate.slice(4,6)}-${tradeDate.slice(6,8)}` : "";

    // 优先使用选股宝API（更稳定）
    if (formattedDate) {
      const url = `https://data.eastmoney.com/dataapi/xuangu/list?st=CHANGE_RATE&sr=-1&ps=50&p=1&sty=SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,CHANGE_RATE,CLOSE_PRICE,HIGH_PRICE&filter=(TRADE_DATE='${formattedDate}')(CHANGE_RATE>=9.8)`;
      const { data } = await dedupedGet(url, {
        timeout: 8000,
        headers: { Referer: "https://data.eastmoney.com" },
      });
      if (data?.result?.data?.length) {
        const pool = data.result.data;
        return {
          up: pool.map(s => ({
            code: s.SECURITY_CODE, name: s.SECURITY_NAME_ABBR,
            price: s.CLOSE_PRICE || s.HIGH_PRICE, changePct: +s.CHANGE_RATE, limitUp: true,
          })).slice(0, 30),
          down: [],
        };
      }
    }
    // 回退到原API
    const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3b4bca0f43c9a2c3d7e7a6e70cf7&date=${tradeDate || ""}&pageSize=200`;
    const { data } = await dedupedGet(url, {
      timeout: 6000,
      headers: { Referer: "https://data.eastmoney.com" },
    });
    if (!data?.data?.pool) return { up: [], down: [] };
    const pool = data.data.pool;
    return {
      up: pool.filter(s => s.c > s.p).map(s => ({
        code: s.c, name: s.n, price: s.p, changePct: +s.zdp, limitUp: true,
      })).slice(0, 30),
      down: pool.filter(s => s.c < s.p).map(s => ({
        code: s.c, name: s.n, price: s.p, changePct: +s.zdp, limitDown: true,
      })).slice(0, 30),
    };
  } catch (e) { return { up: [], down: [] }; }
}

async function getMarginTrade(code) {
  try {
    const secid = toSecid(code);
    const url = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPTA_MARGIN_TRADING&columns=TRADE_DATE,RZYE,RQYE,RZMCJE,RQMCCL&filter=(SECURITY_CODE="${code}")&pageSize=30&sortTypes=-1&sortColumns=TRADE_DATE`;
    const { data } = await dedupedGet(url, {
      timeout: 6000,
      headers: { Referer: "https://data.eastmoney.com" },
    });
    if (!data?.result?.data) return [];
    return data.result.data.map(d => ({
      date: d.TRADE_DATE?.slice(0, 10),
      marginBalance: d.RZYE || 0,
      shortBalance: d.RQYE || 0,
      marginBuy: d.RZMCJE || 0,
      shortVol: d.RQMCCL || 0,
    }));
  } catch (e) { return []; }
}

async function getMarketBreadth() {
  // 优先尝试东方财富push2
  try {
    const url = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5000&np=1&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f12,f14";
    const resp = await dedupedGet(url, {
      timeout: 5000,
      headers: { Referer: "https://quote.eastmoney.com" },
    });
    const d = resp.data;
    const stocks = d?.data?.diff || d?.Data?.Diff || [];
    if (stocks.length > 100) {
      const total = stocks.length;
      let up = 0, down = 0, flat = 0, limitUp = 0, limitDown = 0;
      let totalChg = 0;
      stocks.forEach(s => {
        const chg = +s.f3 || 0;
        totalChg += chg;
        if (chg > 9.5) limitUp++;
        else if (chg < -9.5) limitDown++;
        else if (chg > 0) up++;
        else if (chg < 0) down++;
        else flat++;
      });
      return {
        total, up, down, flat, limitUp, limitDown,
        avgChg: +(totalChg / total).toFixed(2),
        upRatio: +(up / total * 100).toFixed(1),
        breadth: +((up - down) / total * 100).toFixed(1),
        source: "push2",
        timestamp: new Date().toISOString(),
      };
    }
  } catch (e) { /* fallback below */ }

  // Sina采样降级: 用150+代表性股票估算市场宽度
  try {
    const { BREADTH_SAMPLE } = require("./state");
    const quotes = await getRealtimeQuotes(BREADTH_SAMPLE.slice(0, 160));
    if (!quotes.length) return null;
    const total = quotes.length;
    let up = 0, down = 0, flat = 0, limitUp = 0, limitDown = 0;
    let totalChg = 0;
    quotes.forEach(q => {
      const chg = q.change || 0;
      totalChg += chg;
      if (chg > 9.5) limitUp++;
      else if (chg < -9.5) limitDown++;
      else if (chg > 0) up++;
      else if (chg < 0) down++;
      else flat++;
    });
    return {
      total, up, down, flat, limitUp, limitDown,
      avgChg: +(totalChg / total).toFixed(2),
      upRatio: +(up / total * 100).toFixed(1),
      breadth: +((up - down) / total * 100).toFixed(1),
      source: "sina_sample",
      timestamp: new Date().toISOString(),
    };
  } catch (e) { return null; }
}

// ============ 导出 ============
module.exports = {
  apiClient,
  nativeHttpsGet,
  getRealtimeQuotes, getKlineData, getKlineDataEnhanced,
  getIntradayTrend,
  searchStock, batchWithLimit, getStockName,
  getFundFlow, getFundFlowMinute,
  getMarginTrade, getMarketBreadth,
  getLimitUpDown,
  dedupedGet,
};

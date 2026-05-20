// 股票数据获取 — 新浪财经 + 腾讯接口, GBK解码
const axios = require("axios");
const iconv = require("iconv-lite");

function toSymbol(code) {
  if (code.startsWith("6")) return `sh${code}`;
  return `sz${code}`;
}

// 全局股票名称缓存
const nameCache = new Map();

// 批量获取实时行情 (新浪接口, GBK → UTF-8)
async function getRealtimeQuotes(codes) {
  const symbols = codes.map(c => toSymbol(c)).join(",");
  const url = `https://hq.sinajs.cn/list=${symbols}`;
  const resp = await axios.get(url, {
    timeout: 10000,
    responseType: "arraybuffer",
    headers: { Referer: "https://finance.sina.com.cn" },
  });
  const data = iconv.decode(Buffer.from(resp.data), "GBK");
  if (!data) return [];

  const results = [];
  const lines = data.split("\n").filter(Boolean);
  for (const line of lines) {
    const match = line.match(/hq_str_(.+)="(.+)"/);
    if (!match) continue;
    const [, symbol, raw] = match;
    const fields = raw.split(",");
    if (fields.length < 10) continue;
    const code = symbol.slice(2);
    const name = fields[0];
    nameCache.set(code, name);
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
  return results;
}

// K线 (腾讯前复权, JSON格式无编码问题)
async function getKlineData(code, days = 365) {
  const sym = toSymbol(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,,,${days},qfq`;
  const { data } = await axios.get(url, {
    timeout: 10000,
    headers: { Referer: "https://gu.qq.com" },
  });
  if (!data?.data?.[sym]) return getKlineFromSina(code, days);

  const klines = data.data[sym].qfqday || data.data[sym].day || [];
  return klines.map(k => ({
    date: k[0], open: +k[1], close: +k[2],
    high: +k[3], low: +k[4], volume: +k[5],
    amount: null, chg: null,
  }));
}

// 新浪K线备用 (GBK)
async function getKlineFromSina(code, days = 365) {
  const sym = toSymbol(code);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sym}&scale=240&ma=no&datalen=${days}`;
  const { data } = await axios.get(url, { timeout: 10000 });
  if (!Array.isArray(data)) return [];
  return data.map(k => ({
    date: k.day, open: +k.open, close: +k.close,
    high: +k.high, low: +k.low, volume: +k.volume,
    amount: null, chg: null,
  }));
}

// 搜索股票 (腾讯, UTF-8)
async function searchStock(keyword) {
  try {
    const url = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(keyword)}&t=all&count=20`;
    const { data } = await axios.get(url, { timeout: 8000 });
    const match = data.match(/"(.*)"/);
    if (!match) return [];
    return match[1].split("^").map(item => {
      const p = item.split("~");
      return { code: p[1], name: p[2], market: p[0] };
    }).filter(s => s.code && s.name);
  } catch (e) { return []; }
}

// 并发控制
async function batchWithLimit(items, fn, limit = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit).map(it => fn(it).catch(() => null));
    const batchResults = await Promise.all(batch);
    results.push(...batchResults.filter(Boolean));
  }
  return results;
}

// 获取股票名称
async function getStockName(code) {
  if (nameCache.has(code)) return nameCache.get(code);
  try {
    const quotes = await getRealtimeQuotes([code]);
    if (quotes[0]) return quotes[0].name;
  } catch (e) {}
  return "";
}

// 资金流向 — 日级别 (东方财富)
async function getFundFlow(code, days = 30) {
  const secid = code.startsWith("6") ? `1.${code}` : `0.${code}`;
  const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&lmt=${days}`;
  const { data } = await axios.get(url, { timeout: 8000 });
  if (!data?.data?.klines) return [];
  return data.data.klines.map(line => {
    const p = line.split(",");
    return {
      date: p[0],
      main: +p[1],          // 主力净流入(超大+大单)
      retail: +p[2],        // 小单净流入(散户)
      mid: +p[3],           // 中单净流入(机构)
      large: +p[4],         // 大单净流入
      huge: +p[5],          // 超大单净流入
      mainPct: +p[6],       // 主力占比%
      retailPct: +p[7],     // 散户占比%
      midPct: +p[8],        // 中单占比%
      largePct: +p[9],      // 大单占比%
      hugePct: +p[10],      // 超大单占比%
    };
  });
}

// 资金流向 — 分钟级别 (当日实时)
async function getFundFlowMinute(code) {
  const secid = code.startsWith("6") ? `1.${code}` : `0.${code}`;
  const url = `https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=1&lmt=240`;
  const { data } = await axios.get(url, { timeout: 8000 });
  if (!data?.data?.klines) return null;
  const klines = data.data.klines;
  // 返回最新一条(当前累计)
  const latest = klines[klines.length - 1];
  if (!latest) return null;
  const p = latest.split(",");
  const items = klines.map(line => {
    const parts = line.split(",");
    return { time: parts[0], main: +parts[1], retail: +parts[2], mid: +parts[3], large: +parts[4], huge: +parts[5] };
  });
  return {
    time: p[0],
    main: +p[1],
    retail: +p[2],
    mid: +p[3],
    large: +p[4],
    huge: +p[5],
    mainPct: p[6] ? +p[6] : null,
    retailPct: p[7] ? +p[7] : null,
    midPct: p[8] ? +p[8] : null,
    trend: items, // 分钟级趋势数据
  };
}

module.exports = { getRealtimeQuotes, getKlineData, searchStock, batchWithLimit, getStockName, getFundFlow, getFundFlowMinute };

// ==================== 数据源升级 ====================

// 东方财富日K (备用源, 数据更全)
async function getKlineEastMoney(code, days = 365) {
  const secid = code.startsWith("6") ? `1.${code}` : `0.${code}`;
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&lmt=${days}`;
  const { data } = await axios.get(url, {
    timeout: 10000,
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
}

// 增强K线获取 (多源fallback)
async function getKlineDataEnhanced(code, days = 365) {
  try {
    const data = await getKlineData(code, days);
    if (data.length > 0) return data;
  } catch (e) {}
  try {
    const emData = await getKlineEastMoney(code, days);
    if (emData.length > 0) return emData;
  } catch (e) {}
  return [];
}

// 涨停/跌停数据 (东方财富)
async function getLimitUpDown(date) {
  try {
    const url = `https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3b4bca0f43c9a2c3d7e7a6e70cf7&date=${date || ""}&pageSize=200`;
    const { data } = await axios.get(url, {
      timeout: 8000,
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

// 融资融券数据 (东方财富)
async function getMarginTrade(code) {
  try {
    const secid = code.startsWith("6") ? `1.${code}` : `0.${code}`;
    const url = `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPTA_MARGIN_TRADING&columns=TRADE_DATE,RZYE,RQYE,RZMCJE,RQMCCL&filter=(SECURITY_CODE="${code}")&pageSize=30&sortTypes=-1&sortColumns=TRADE_DATE`;
    const { data } = await axios.get(url, {
      timeout: 8000,
      headers: { Referer: "https://data.eastmoney.com" },
    });
    if (!data?.result?.data) return [];
    return data.result.data.map(d => ({
      date: d.TRADE_DATE?.slice(0, 10),
      marginBalance: d.RZYE || 0,    // 融资余额
      shortBalance: d.RQYE || 0,     // 融券余额
      marginBuy: d.RZMCJE || 0,      // 融资买入额
      shortVol: d.RQMCCL || 0,       // 融券卖出量
    }));
  } catch (e) { return []; }
}

// 市场宽度数据
async function getMarketBreadth() {
  try {
    const url = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5000&np=1&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f2,f3,f12,f14";
    const resp = await axios.get(url, {
      timeout: 10000,
      headers: { Referer: "https://quote.eastmoney.com" },
    });
    const d = resp.data;
    const stocks = d?.data?.diff || d?.Data?.Diff || [];
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
      timestamp: new Date().toISOString(),
    };
  } catch (e) { return null; }
}

// 覆盖原有导出
Object.assign(module.exports, {
  getKlineEastMoney, getKlineDataEnhanced, getLimitUpDown, getMarginTrade, getMarketBreadth,
});

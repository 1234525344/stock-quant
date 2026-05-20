// 大盘指数数据 — 新浪/腾讯接口
const axios = require("axios");
const iconv = require("iconv-lite");

// 主要指数列表
const INDEX_LIST = [
  { code: "000001", name: "上证指数", symbol: "sh000001", prefix: "s_sh" },
  { code: "399001", name: "深证成指", symbol: "sz399001", prefix: "s_sz" },
  { code: "399006", name: "创业板指", symbol: "sz399006", prefix: "s_sz" },
  { code: "000688", name: "科创50", symbol: "sh000688", prefix: "s_sh" },
  { code: "000300", name: "沪深300", symbol: "sh000300", prefix: "s_sh" },
  { code: "000016", name: "上证50", symbol: "sh000016", prefix: "s_sh" },
  { code: "399905", name: "中证500", symbol: "sz399905", prefix: "s_sz" },
  { code: "399673", name: "创业板50", symbol: "sz399673", prefix: "s_sz" },
];

// 行业板块列表 (新浪行业指数 — 名称与新浪实际返回一致)
const SECTOR_LIST = [
  { code: "sw2_640300", name: "中证军工", symbol: "sz399967", prefix: "s_sz" },
  { code: "sw2_610100", name: "中证银行", symbol: "sz399986", prefix: "s_sz" },
  { code: "sw2_650300", name: "中证医疗", symbol: "sz399989", prefix: "s_sz" },
  { code: "sw2_620200", name: "上证医药", symbol: "sh000037", prefix: "s_sh" },
  { code: "sw2_640400", name: "CS新能车", symbol: "sz399976", prefix: "s_sz" },
  { code: "sw2_650100", name: "基建工程", symbol: "sz399995", prefix: "s_sz" },
  { code: "sw2_610300", name: "证券公司", symbol: "sz399975", prefix: "s_sz" },
  { code: "sw2_630200", name: "地产等权", symbol: "sz399983", prefix: "s_sz" },
  { code: "sw2_610200", name: "A股资源", symbol: "sh000805", prefix: "s_sh" },
  { code: "sw2_640100", name: "新能源", symbol: "sh000941", prefix: "s_sh" },
];

// 获取指数实时行情 (新浪)
async function getIndexQuotes() {
  const symbols = INDEX_LIST.map(i => i.symbol).join(",");
  const url = `https://hq.sinajs.cn/list=${symbols}`;
  try {
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
      if (fields.length < 5) continue;
      const idx = INDEX_LIST.find(i => i.symbol === symbol);
      // 新浪指数格式: name, current, open, preClose, high, low, ...
      // (与个股格式不同: name, open, preClose, price, high, low, ...)
      const current = +fields[1];
      const preClose = +fields[3];
      results.push({
        code: idx ? idx.code : symbol.slice(2),
        name: fields[0],
        price: current,
        change: +(current - preClose).toFixed(2),
        changePct: preClose ? +((current - preClose) / preClose * 100).toFixed(2) : 0,
        high: +fields[4] || 0,
        low: +fields[5] || 0,
        volume: +fields[8] || 0,
        amount: +fields[9] || 0,
      });
    }
    return results;
  } catch (e) {
    return [];
  }
}

// 获取指数K线 (腾讯)
async function getIndexKline(code, days = 365) {
  const idx = INDEX_LIST.find(i => i.code === code);
  if (!idx) return [];
  // 腾讯K线API: sh000001 格式 (不是 s_sh000001)
  const tkPrefix = code.startsWith("6") || code === "000001" || code === "000016" || code === "000300" || code === "000688"
    ? "sh" + code : "sz" + code;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tkPrefix},day,,,${days},qfq`;
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { Referer: "https://gu.qq.com" },
    });
    const klines = data?.data?.[tkPrefix]?.day || data?.data?.[tkPrefix]?.qfqday || [];
    return klines.map(k => ({
      date: k[0], open: +k[1], close: +k[2],
      high: +k[3], low: +k[4], volume: +k[5],
    }));
  } catch (e) {
    return [];
  }
}

// 获取市场宽度 (涨跌家数 — 腾讯)
async function getMarketBreadth() {
  try {
    // 上证涨跌家数
    const url = "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001,0.399006,1.000688&fields=f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f14,f15,f16,f17,f18,f20,f21,f104,f105,f106,f107,f108,f152";
    const { data } = await axios.get(url, { timeout: 8000 });
    // 使用东方财富的涨跌统计接口
    const resp2 = await axios.get("https://push2.eastmoney.com/api/qt/stock/get?secid=1.000001&fields=f47,f48,f50,f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f170,f171,f172,f173,f174,f175,f176,f177,f178,f179", { timeout: 8000 });
    return {
      updateTime: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    };
  } catch (e) {
    return null;
  }
}

// 获取板块行情 (用于行业排名 — 东方财富)
async function getSectorPerformance() {
  try {
    // 东方财富行业板块行情
    const url = "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=30&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f2,f3,f4,f5,f6,f7,f8,f10,f12,f14,f15,f16,f17,f18,f20,f21";
    const { data } = await axios.get(url, { timeout: 8000 });
    if (!data?.data?.diff) return [];
    return data.data.diff.map(d => ({
      code: d.f12,
      name: d.f14,
      price: d.f2,
      changePct: d.f3,
      change: d.f4,
      volume: d.f5,
      amount: d.f6,
    }));
  } catch (e) {
    // Fallback: use Sina sector quotes (use s_ prefix for simplified format)
    try {
      // Build Sina symbols with s_ prefix for simplified sector format
      // Simplified format: name, preClose, changeAmt, changePct, volume, amount
      const sinaSymbols = SECTOR_LIST.map(s => s.prefix + s.symbol.slice(2)).join(",");
      const url = `https://hq.sinajs.cn/list=${sinaSymbols}`;
      const resp = await axios.get(url, {
        timeout: 10000,
        responseType: "arraybuffer",
        headers: { Referer: "https://finance.sina.com.cn" },
      });
      const raw = iconv.decode(Buffer.from(resp.data), "GBK");
      const results = [];
      const lines = raw.split("\n").filter(Boolean);
      for (const line of lines) {
        const match = line.match(/hq_str_(.+)="(.+)"/);
        if (!match) continue;
        const [, sym, dataStr] = match;
        const fields = dataStr.split(",");
        if (fields.length < 4) continue;
        // s_ prefix format: name, preClose(1), changeAmt(2), changePct(3), volume(4), amount(5)
        const preClose = +fields[1] || 0;
        const changeAmt = +fields[2] || 0;
        const changePct = +fields[3] || 0;
        const price = preClose + changeAmt;  // current = preClose + change
        // Find matching sector by decoding the s_ prefix from the returned symbol
        const rawSymbol = sym.replace(/^s_/, "");  // remove s_ prefix
        const sector = SECTOR_LIST.find(s => s.symbol.slice(2) === rawSymbol.slice(2));
        results.push({
          code: sector ? sector.code : rawSymbol,
          name: fields[0],
          price: +price.toFixed(4),
          changePct: changePct,
          change: changeAmt,
          volume: +fields[4] || 0,
          amount: +fields[5] || 0,
        });
      }
      return results;
    } catch (e2) {
      return [];
    }
  }
}

// 获取板块资金流向 (从东方财富网页抓取 + Sina/Tencent补充)
async function getSectorFlow() {
  try {
    // 方案1: 直接从东方财富数据页获取JSON
    const timestamp = Date.now();
    const url = `https://push2.eastmoney.com/api/qt/clist/get?cb=jQuery_${timestamp}&pn=1&pz=40&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f2,f3,f4,f12,f14,f62,f66,f69,f72,f75,f184,f124,f204,f205&_=${timestamp}`;
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://data.eastmoney.com/bkzj/hy.html",
        "Accept": "*/*",
      },
    });
    // Parse JSONP
    const jsonStr = data.replace(/^jQuery\d+_\d+\(/, "").replace(/\);?$/, "");
    const obj = JSON.parse(jsonStr);
    if (!obj?.data?.diff) {
      // Fallback: scrape web
      return await getSectorFlowWebScrape();
    }
    return obj.data.diff.map(d => ({
      code: d.f12,
      name: d.f14,
      price: d.f2,
      changePct: d.f3,
      change: d.f4,
      mainNet: d.f62 || 0,
      hugeNet: d.f66 || 0,
      largeNet: d.f69 || 0,
      midNet: d.f72 || 0,
      smallNet: d.f75 || 0,
      mainPct: d.f184 || 0,
      stockCount: d.f124 || 0,
    })).sort((a, b) => (b.mainNet || 0) - (a.mainNet || 0));
  } catch (e) {
    return await getSectorFlowWebScrape().catch(() => []);
  }
}

// 网页抓取备选方案
async function getSectorFlowWebScrape() {
  try {
    const { data: html } = await axios.get("https://data.eastmoney.com/bkzj/hy.html", {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    // 尝试从网页提取JSON数据
    const jsonMatch = html.match(/var\s+day_data\s*=\s*(\[[\s\S]*?\]);/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      return data.map(d => ({
        code: d.code || d.f12,
        name: d.name || d.f14,
        price: d.f2 || 0,
        changePct: d.f3 || 0,
        mainNet: d.f62 || d.mainNet || 0,
        mainPct: d.f184 || 0,
      }));
    }
  } catch (e) {}

  // 最终降级: 使用Sina行业数据 + 量价估算
  const sectors = await getSectorPerformance();
  if (sectors.length > 0) {
    return sectors.map(s => ({
      code: s.code,
      name: s.name,
      price: s.price,
      changePct: s.changePct,
      mainNet: (s.amount || 1) * (s.changePct || 0) / 100 * 0.3 * 10000, // 估算主力净额
      estimated: true,
    })).sort((a, b) => (b.mainNet || 0) - (a.mainNet || 0));
  }
  return [];
}

// 概念板块资金流向
async function getConceptFlow() {
  try {
    const timestamp = Date.now();
    const url = `https://push2.eastmoney.com/api/qt/clist/get?cb=jQuery_${timestamp}&pn=1&pz=40&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f62&fs=m:90+t:3&fields=f2,f3,f4,f12,f14,f62,f66,f69,f184&_=${timestamp}`;
    const { data } = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/bkzj/gn.html" },
    });
    const jsonStr = data.replace(/^jQuery\d+_\d+\(/, "").replace(/\);?$/, "");
    const obj = JSON.parse(jsonStr);
    if (!obj?.data?.diff) return [];
    return obj.data.diff.map(d => ({
      code: d.f12, name: d.f14, price: d.f2, changePct: d.f3,
      mainNet: d.f62 || 0, hugeNet: d.f66 || 0, largeNet: d.f69 || 0, mainPct: d.f184 || 0,
    })).sort((a, b) => (b.mainNet || 0) - (a.mainNet || 0));
  } catch (e) {
    // Fallback: use sector performance data as concept proxy
    try {
      const sectors = await getSectorPerformance();
      if (sectors.length > 0) {
        return sectors.map(s => ({
          code: s.code, name: s.name, price: s.price, changePct: s.changePct,
          mainNet: (s.amount || 1) * (s.changePct || 0) / 100 * 0.25 * 10000,
          hugeNet: 0, largeNet: 0, mainPct: (s.changePct || 0) * 0.15,
        })).sort((a, b) => (b.mainNet || 0) - (a.mainNet || 0));
      }
    } catch (e2) {}
    return [];
  }
}

// 获取个股评论/研报 (从新浪个股页抓取)
async function getStockComments(code) {
  const prefix = code.startsWith("6") ? "sh" : "sz";
  const url = `https://finance.sina.com.cn/realstock/company/${prefix}${code}/nc.shtml`;
  try {
    const resp = await axios.get(url, {
      timeout: 10000,
      responseType: "arraybuffer",
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.sina.com.cn" },
    });
    const html = iconv.decode(Buffer.from(resp.data), "GBK");

    // 提取公司资讯 (新闻)
    const newsBlock = html.match(/id="stockNews">([\s\S]*?)<\/div>/);
    const news = [];
    if (newsBlock) {
      const newsItems = newsBlock[1].match(/<li>[\s\S]*?<span>\((\d+-\d+)\)<\/span>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g);
      if (newsItems) {
        for (const item of newsItems.slice(0, 10)) {
          const dm = item.match(/<span>\((\d+-\d+)\)/);
          const ha = item.match(/href="([^"]*)"/);
          const ta = item.match(/<a[^>]*>([^<]*)</);
          if (ha && ta) {
            news.push({ date: dm ? dm[1] : "", title: ta[1].trim(), url: ha[1] });
          }
        }
      }
    }

    // 提取公司研究 (分析师研报)
    const reports = [];
    const reportBlock = html.match(/公司研究[\s\S]*?<ul>([\s\S]*?)<\/ul>/);
    if (reportBlock) {
      const reportItems = reportBlock[1].match(/<a[^>]*title="([^"]*)"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g);
      if (reportItems) {
        for (const item of reportItems.slice(0, 8)) {
          const ti = item.match(/title="([^"]*)"/);
          const hr = item.match(/href="([^"]*)"/);
          const tx = item.match(/>([^<]*)</);
          if (ti && hr) {
            reports.push({ title: ti[1], url: hr[1], summary: tx ? tx[1].trim() : ti[1] });
          }
        }
      }
    }

    // 提取行业研究
    const indReports = [];
    const indBlock = html.match(/行业研究[\s\S]*?<ul>([\s\S]*?)<\/ul>/);
    if (indBlock) {
      const indItems = indBlock[1].match(/<a[^>]*title="([^"]*)"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g);
      if (indItems) {
        for (const item of indItems.slice(0, 5)) {
          const ti = item.match(/title="([^"]*)"/);
          const hr = item.match(/href="([^"]*)"/);
          if (ti && hr) {
            indReports.push({ title: ti[1], url: hr[1] });
          }
        }
      }
    }

    return { code, news, reports, indReports, source: "新浪财经" };
  } catch (e) {
    return { code, news: [], reports: [], indReports: [], source: "新浪财经", error: e.message };
  }
}

module.exports = { INDEX_LIST, getIndexQuotes, getIndexKline, getMarketBreadth, getSectorPerformance, getSectorFlow, getConceptFlow, getStockComments };

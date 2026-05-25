const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const axios = require("axios");
const http = require("http");
const { INDEX_MAP, findIndexSecid, FUND_SECTOR_MAP, intradayKlineCache } = require("../state");
const { getRealtimeQuotes, getIntradayTrend, getKlineData } = require("../data");
const { getSectorFlow, getConceptFlow } = require("../index");
const { SMA, MACD, RSI, KDJ, BOLL } = require("../indicators");
const { chatCompletion, getActiveModels, getApiKey } = require("../ai-service");
const { matchETFToSector, getEtfFlow, getFundSectors, getFundRanking, isMarketOpen } = require("../helpers");

// ==================== ETF/基金板块资金流向 ====================
router.get("/api/market/etf-flow", asyncHandler(async (req, res) => {
    const result = await getEtfFlow();
    res.json(result);
}));

// ==================== 基金推荐 (规则 + AI) ====================
router.get("/api/market/etf-recommend", asyncHandler(async (req, res) => {
    const apiKey = getApiKey(req);
    const [etfFlow, sectorFlow] = await Promise.all([
      getEtfFlow().catch(() => []),
      getSectorFlow().catch(() => []),
    ]);
    // 规则推荐: top 5 ETF by mainNet with positive change
    const ruleRecs = (etfFlow || []).filter(e => e.changePct > 0 && e.mainNet > 0).slice(0, 6);

    let aiText = null;
    if (apiKey && etfFlow.length > 0) {
      try {
        aiText = await chatCompletion(apiKey, {
          model: getActiveModels(apiKey).flash, maxTokens: 500,
          system: "你是基金投资分析师。根据ETF资金流向数据，用白话推荐2-3个值得关注的基金方向，100字内。不要建议具体买卖。",
          messages: [{ role: "user", content: `ETF资金流向TOP10：${JSON.stringify(etfFlow.slice(0, 10))}。行业板块流向：${JSON.stringify((sectorFlow||[]).slice(0,5))}` }],
        });
      } catch (e) { /* fallback: no AI text */ }
    }

    res.json({ recommendations: ruleRecs, aiRecommendation: aiText, totalEtfs: etfFlow.length });
}));

// ==================== 基金板块资金流向 (从行业板块聚合) ====================
router.get("/api/market/fund-sectors", asyncHandler(async (req, res) => {
    const [sectors, concepts] = await Promise.all([
      getSectorFlow().catch(() => []),
      getConceptFlow().catch(() => []),
    ]);

    // 聚合到基金板块
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
      sectorMap[tag].sectors.push({ name: s.name, mainNet: s.mainNet, changePct: s.changePct, mainPct: s.mainPct });
    }

    const result = Object.values(sectorMap)
      .map(s => ({ ...s, avgChangePct: +(s.changePctSum / s.count).toFixed(1) }))
      .sort((a, b) => b.totalMainNet - a.totalMainNet);

    res.json(result);
}));

// ==================== 热门基金排行 (东方财富实时数据) ====================
router.get("/api/market/fund-ranking", asyncHandler(async (req, res) => {
    const type = req.query.type || "all"; // all, gp, hh, zq, zs
    const sortBy = req.query.sort || "1y"; // 1y, 6m, 3m, 1m
    const pageSize = Math.min(parseInt(req.query.limit) || 20, 30);

    const scMap = { "1y": "zzf", "6m": "6yzf", "3m": "3yzf", "1m": "1yzf" };
    const sc = scMap[sortBy] || "zzf";

    const today = new Date();
    const endDate = today.toISOString().slice(0, 10);
    const startDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString().slice(0, 10);
    const url = `http://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=${type}&rs=&gs=0&sc=${sc}&st=desc&sd=${startDate}&ed=${endDate}&qdii=&tabSubtype=,,,,,&pi=1&pn=${pageSize}&dx=1`;
    const resp = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0", Referer: "http://fund.eastmoney.com/data/fundranking.html" },
    });
    const text = resp.data;
    // Strip "var rankData = " prefix and trailing ";"
    const jsObj = text.replace(/^var\s+rankData\s*=\s*/, "").replace(/;\s*$/, "");
    if (!jsObj || jsObj === text) return res.json([]);
    // East Money returns JS object literal (unquoted keys), convert to valid JSON
    const jsonStr = jsObj.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    let rankData;
    try { rankData = JSON.parse(jsonStr); } catch (e) { return res.json({ error: "JSON parse failed", detail: jsonStr.slice(0, 100) }); }
    const datas = (rankData.datas || []).map(d => d.split(","));

    // Fetch real-time NAV for top 10
    const topCodes = datas.slice(0, 10).map(d => d[0]);
    const rtQuotes = {};
    await Promise.all(topCodes.map(async code => {
      try {
        const rtResp = await axios.get(`http://fundgz.1234567.com.cn/js/${code}.js`, {
          timeout: 3000,
          headers: { "User-Agent": "Mozilla/5.0", Referer: "http://fund.eastmoney.com/" },
        });
        const rtMatch = rtResp.data.match(/jsonpgz\((\{.*\})\);/);
        if (rtMatch) {
          const rt = JSON.parse(rtMatch[1]);
          rtQuotes[code] = { estNAV: +rt.gsz, estChange: +rt.gszzl, updateTime: rt.gztime };
        }
      } catch (e) { /* skip */ }
    }));

    const funds = datas.map(d => ({
      code: d[0],
      name: d[1],
      navDate: d[3],
      nav: +d[4],
      dailyReturn: +d[6],
      weeklyReturn: +d[7],
      monthlyReturn: +d[8],
      return3m: +d[9],
      return6m: +d[10],
      return1y: +d[11],
      return3y: +d[13],
      ytdReturn: +d[14],
      sinceInception: +d[15],
      size: +d[18] || 0,
      purchaseFee: d[19],
      realtime: rtQuotes[d[0]] || null,
    }));

    res.json({
      funds,
      total: rankData.allRecords,
      types: {
        equity: rankData.gp_count,
        hybrid: rankData.hh_count,
        bond: rankData.zq_count,
        index: rankData.zs_count,
        qdii: rankData.qdii_count,
        fof: rankData.fof_count,
      },
    });
}));

// ==================== AI 基金推荐 ====================
router.get("/api/market/ai-fund-recommend", asyncHandler(async (req, res) => {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(401).json({ error: "未配置 API Key" });

    const [fundSectors, fundRanking] = await Promise.all([
      getFundSectors().catch(() => []),
      getFundRanking({ type: "all", sort: "1y", limit: 10 }).catch(() => null),
    ]);

    const topFunds = (fundRanking?.funds || []).slice(0, 8);
    const text = await chatCompletion(apiKey, {
      model: getActiveModels(apiKey).pro,
      maxTokens: 600,
      system: "你是基金投资分析师。根据基金板块资金流向和热门基金排行，用通俗中文推荐2-3个值得关注的基金方向，说明理由。200字内。不说具体买卖建议，仅供参考。",
      messages: [{ role: "user", content: `基金板块资金流向：${JSON.stringify(fundSectors)}。近1年热门基金TOP10：${JSON.stringify(topFunds.map(f => ({ name: f.name, return1y: f.return1y, return3m: f.return3m, size: f.size })))}` }],
    });
    res.json({ text, generatedAt: new Date().toISOString() });
}));

// ==================== 基金搜索 ====================
router.get("/api/market/fund-search", asyncHandler(async (req, res) => {
    const q = (req.query.q || "").trim();
    if (!q || q.length < 1) return res.json({ funds: [] });

    const resp = await axios.get(
      `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(q)}`,
      { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0", Referer: "http://fund.eastmoney.com/" } }
    ).catch(() => null);

    if (!resp?.data) return res.json({ funds: [] });

    let data = resp.data;
    // If returned as string, parse it
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (e) { return res.json({ funds: [] }); }
    }

    const funds = (data.Datas || []).slice(0, 15).map(f => ({
      code: f.CODE,
      name: f.NAME,
      type: (f.FundBaseInfo?.FTYPE) || f.CATEGORYDESC || "",
      nav: f.FundBaseInfo?.DWJZ || null,
    }));

    res.json({ funds, query: q });
}));

// ==================== 基金净值走势 + 技术分析 + 买卖信号 ====================
router.get("/api/fund/nav/:code", asyncHandler(async (req, res) => {
    const { code } = req.params;
    const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js`;
    const resp = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0", Referer: "http://fund.eastmoney.com/" },
    });
    const text = resp.data;

    // Parse fund info
    const nameMatch = text.match(/var\s+fS_name\s*=\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : code;

    // Parse NAV history
    const navMatch = text.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
    if (!navMatch) return res.json({ error: "无法解析净值数据" });
    const navData = JSON.parse(navMatch[1]);
    if (!navData.length) return res.json({ error: "净值数据为空" });

    // Extract NAV arrays
    const dates = navData.map(d => {
      const dt = new Date(d.x);
      return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
    });
    const navs = navData.map(d => d.y);
    const dailyReturns = navData.map(d => d.equityReturn || 0);

    // Compute technical indicators on NAV (treat NAV like closing price)
    const closes = navs;
    const highs = navs.map((v, i) => {
      const start = Math.max(0, i - 4);
      return Math.max(...navs.slice(start, i + 1));
    });
    const lows = navs.map((v, i) => {
      const start = Math.max(0, i - 4);
      return Math.min(...navs.slice(start, i + 1));
    });
    const opens = navs.map((v, i) => i > 0 ? navs[i - 1] : v);
    const volumes = navs.map(() => 1); // Funds don't have volume

    const ma5 = SMA(closes, 5);
    const ma10 = SMA(closes, 10);
    const ma20 = SMA(closes, 20);
    const ma60 = SMA(closes, 60);
    const { dif, dea, macd: macdHist } = MACD(closes);
    const rsi14 = RSI(closes, 14);
    const { k, d, j } = KDJ(highs, lows, closes);
    const { upper, lower } = BOLL(closes);

    const last = arr => arr[arr.length - 1];
    const prev = arr => arr[arr.length - 2];

    // Signal computation (same as stock signals)
    const signals = {};

    if (last(ma5) && last(ma20) && prev(ma5) && prev(ma20)) {
      if (last(ma5) > last(ma20) && prev(ma5) <= prev(ma20)) {
        signals.maCross = "buy"; signals.maCrossDetail = "★金叉 MA5↑上穿MA20";
      } else if (last(ma5) < last(ma20) && prev(ma5) >= prev(ma20)) {
        signals.maCross = "sell"; signals.maCrossDetail = "★死叉 MA5↓下穿MA20";
      } else {
        signals.maCross = last(ma5) > last(ma20) ? "buy" : "sell";
        signals.maCrossDetail = `MA5 ${last(ma5) > last(ma20) ? ">" : "<"} MA20`;
      }
    }

    if (last(dif) != null && last(dea) != null) {
      if (last(dif) > last(dea) && prev(dif) <= prev(dea)) signals.macd = "buy";
      else if (last(dif) < last(dea) && prev(dif) >= prev(dea)) signals.macd = "sell";
      else signals.macd = last(dif) > last(dea) ? "buy" : "sell";
      signals.macdDetail = `DIF(${last(dif).toFixed(4)}) ${last(dif) > last(dea) ? ">" : "<"} DEA`;
    }

    if (last(rsi14) != null) {
      signals.rsi = last(rsi14) < 30 ? "buy" : last(rsi14) > 70 ? "sell" : "neutral";
      signals.rsiDetail = `RSI=${last(rsi14).toFixed(1)}`;
    }

    if (last(upper) && last(lower) && last(closes)) {
      signals.boll = last(closes) <= last(lower) * 1.02 ? "buy" : last(closes) >= last(upper) * 0.98 ? "sell" : "neutral";
      signals.bollDetail = `收盘vs上${last(upper).toFixed(4)}/下${last(lower).toFixed(4)}`;
    }

    if (last(k) != null && last(d) != null) {
      if (last(k) > last(d) && prev(k) <= prev(d)) signals.kdj = "buy";
      else if (last(k) < last(d) && prev(k) >= prev(d)) signals.kdj = "sell";
      else signals.kdj = last(k) > last(d) ? "buy" : "sell";
      signals.kdjDetail = `K${last(k).toFixed(1)} D${last(d).toFixed(1)} J${last(j).toFixed(1)}`;
    }

    if (last(ma60)) {
      signals.trend = last(closes) > last(ma60) ? "buy" : "sell";
      signals.trendDetail = `收盘${last(closes).toFixed(4)} ${last(closes) > last(ma60) ? ">" : "<"} MA60`;
    }

    // Vote consensus
    const votes = { buy: 0, sell: 0, neutral: 0 };
    const voteKeys = ["maCross", "macd", "rsi", "boll", "kdj", "trend"];
    for (const key of voteKeys) {
      const v = signals[key];
      if (v === "buy" || v === "sell" || v === "neutral") votes[v] = (votes[v] || 0) + 1;
    }
    const buyVotes = votes.buy || 0;
    const sellVotes = votes.sell || 0;
    let consensus = buyVotes > sellVotes + 1 ? "strong_buy" :
      buyVotes > sellVotes ? "buy" :
      sellVotes > buyVotes + 1 ? "strong_sell" :
      sellVotes > buyVotes ? "sell" : "neutral";
    signals.consensus = consensus;
    signals.votes = { buy: buyVotes, sell: sellVotes, neutral: votes.neutral || 0 };

    // Support/resistance levels
    const recent20High = Math.max(...highs.slice(-20));
    const recent20Low = Math.min(...lows.slice(-20));
    signals.levels = {
      resistance: [
        { level: +last(ma20).toFixed(4), label: "MA20" },
        { level: +recent20High.toFixed(4), label: "20日高点" },
      ].filter(l => l.level > last(closes)).sort((a, b) => a.level - b.level).slice(0, 2),
      support: [
        { level: +recent20Low.toFixed(4), label: "20日低点" },
        { level: +last(ma20).toFixed(4), label: "MA20" },
        { level: +last(ma60).toFixed(4), label: "MA60" },
      ].filter(l => l.level < last(closes)).sort((a, b) => b.level - a.level).slice(0, 3),
    };

    // Return only recent 2 years for chart performance
    const sliceStart = Math.max(0, dates.length - 500);

    res.json({
      code, name,
      nav: last(closes),
      navDate: last(dates),
      returns: {
        daily: last(dailyReturns),
        week: navs.length >= 5 ? +((last(closes) / navs[navs.length - 6] - 1) * 100).toFixed(2) : null,
        month: navs.length >= 22 ? +((last(closes) / navs[navs.length - 23] - 1) * 100).toFixed(2) : null,
        year: navs.length >= 250 ? +((last(closes) / navs[navs.length - 251] - 1) * 100).toFixed(2) : null,
      },
      indicators: {
        dates: dates.slice(sliceStart),
        navs: navs.slice(sliceStart),
        opens: opens.slice(sliceStart),
        highs: highs.slice(sliceStart),
        lows: lows.slice(sliceStart),
        ma5: ma5.slice(sliceStart),
        ma10: ma10.slice(sliceStart),
        ma20: ma20.slice(sliceStart),
        ma60: ma60.slice(sliceStart),
        macd: { dif: dif.slice(sliceStart), dea: dea.slice(sliceStart), macd: macdHist.slice(sliceStart) },
        rsi: rsi14.slice(sliceStart),
        kdj: { k: k.slice(sliceStart), d: d.slice(sliceStart), j: j.slice(sliceStart) },
        boll: { upper: upper.slice(sliceStart), lower: lower.slice(sliceStart) },
      },
      signals,
    });
}));

// ==================== 基金实时估值 (盘中估算净值) ====================
router.get("/api/fund/intraday/:code", asyncHandler(async (req, res) => {
    const { code } = req.params;
    // Fetch fund data + real-time NAV + holdings in parallel
    const [fundResp, fundGzResp] = await Promise.all([
      axios.get(`https://fund.eastmoney.com/pingzhongdata/${code}.js`, {
        timeout: 8000,
        headers: { "User-Agent": "Mozilla/5.0", Referer: "http://fund.eastmoney.com/" },
      }).catch(() => null),
      axios.get(`http://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`, {
        timeout: 5000,
        headers: { "User-Agent": "Mozilla/5.0", Referer: "http://fund.eastmoney.com/" },
      }).catch(() => null),
    ]);

    if (!fundResp) return res.json({ error: "无法获取基金数据" });

    const text = fundResp.data;
    const nameMatch = text.match(/var\s+fS_name\s*=\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : code;

    // Parse holdings stock codes (new format with market prefix)
    const stocksMatch = text.match(/var\s+stockCodesNew\s*=\s*(\[[^\]]*\]);/);
    let stockCodes = [];
    if (stocksMatch) {
      try {
        const raw = stocksMatch[1].replace(/'/g, '"');
        stockCodes = JSON.parse(raw).map(s => String(s).replace(/^["']|["']$/g, ""));
      } catch (e) { /* ignore */ }
    }

    // Parse positions (stock allocation estimates)
    const posMatch = text.match(/var\s+Data_fundSharesPositions\s*=\s*(\[[\s\S]*?\]);/);
    let positions = [];
    if (posMatch) {
      try { positions = JSON.parse(posMatch[1]); } catch (e) { /* ignore */ }
    }

    // Get real-time quotes for holdings
    let holdingsRT = [];
    if (stockCodes.length > 0) {
      // Convert codes: "1.688409" → "688409" (SH), "0.002371" → "002371" (SZ)
      const cleanCodes = stockCodes.map(c => {
        const parts = c.split(".");
        return parts.length > 1 ? parts[1] : c;
      }).filter(Boolean).slice(0, 10);

      try {
        const quotes = await getRealtimeQuotes(cleanCodes);
        // Calculate weighted NAV change from holdings
        let totalWeight = 0, weightedChg = 0;
        const holdingDetails = [];

        for (let i = 0; i < cleanCodes.length; i++) {
          const q = (quotes || []).find(x => x.code === cleanCodes[i]);
          if (!q || !q.price) continue;
          const weight = positions.length > i ? 1 : 1; // Equal weight if no position data
          totalWeight += weight;
          weightedChg += (q.change || 0) * weight;
          holdingDetails.push({
            code: cleanCodes[i],
            name: q.name || cleanCodes[i],
            price: q.price,
            change: q.change,
          });
        }

        holdingsRT = {
          weightedChg: totalWeight > 0 ? +(weightedChg / totalWeight).toFixed(2) : 0,
          details: holdingDetails.slice(0, 10),
        };
      } catch (e) { /* holdings RT failed, use fundgz only */ }
    }

    // Parse real-time estimated NAV from fundgz
    let rtEstimate = null;
    if (fundGzResp) {
      const gzMatch = fundGzResp.data.match(/jsonpgz\((\{.*\})\);/);
      if (gzMatch) {
        const gz = JSON.parse(gzMatch[1]);
        rtEstimate = {
          estNAV: +gz.gsz,
          estChange: +gz.gszzzl,
          lastNAV: +gz.dwjz,
          lastDate: gz.jzrq,
          updateTime: gz.gztime,
        };
      }
    }

    // Get previous close NAV from fund data
    const navMatch = text.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
    let prevClose = null;
    if (navMatch) {
      const navData = JSON.parse(navMatch[1]);
      if (navData.length > 0) {
        const last = navData[navData.length - 1];
        prevClose = last.y;
      }
    }

    res.json({
      code, name,
      prevClose,
      rtEstimate,
      holdingsRT,
      isTrading: isMarketOpen(),
      updateTime: new Date().toISOString(),
    });
}));

// ==================== 基金盘中K线 (基于持仓股分时合成) ====================
router.get("/api/fund/intraday-kline/:code", asyncHandler(async (req, res) => {
    const { code } = req.params;
    const cacheKey = code;
    const cached = intradayKlineCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 60000) {
      return res.json(cached.data);
    }

    // Fetch fund data for holdings
    const fundResp = await axios.get(
      `https://fund.eastmoney.com/pingzhongdata/${code}.js`,
      { timeout: 8000, headers: { "User-Agent": "Mozilla/5.0", Referer: "http://fund.eastmoney.com/" } }
    ).catch(() => null);
    if (!fundResp) return res.json({ error: "无法获取基金数据" });

    const text = fundResp.data;
    const nameMatch = text.match(/var\s+fS_name\s*=\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : code;

    // Parse holdings
    const stocksMatch = text.match(/var\s+stockCodesNew\s*=\s*(\[[^\]]*\]);/);
    let stockCodes = [];
    if (stocksMatch) {
      try {
        const raw = stocksMatch[1].replace(/'/g, '"');
        stockCodes = JSON.parse(raw);
      } catch (e) { /* ignore */ }
    }

    // Parse positions for weights
    const posMatch = text.match(/var\s+Data_fundSharesPositions\s*=\s*(\[[\s\S]*?\]);/);
    let positions = [];
    if (posMatch) {
      try { positions = JSON.parse(posMatch[1]); } catch (e) { /* ignore */ }
    }

    // Get previous close NAV
    const navMatch = text.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
    let prevClose = null;
    if (navMatch) {
      const navData = JSON.parse(navMatch[1]);
      if (navData.length > 0) prevClose = navData[navData.length - 1].y;
    }

    // Clean stock codes and limit to top 8
    const cleanCodes = stockCodes.map(c => {
      const parts = String(c).split(".");
      return parts.length > 1 ? parts[1] : String(c);
    }).filter(Boolean).slice(0, 8);

    if (cleanCodes.length === 0) {
      // ETF feeder funds (联接基金) & other no-holding funds → use tracking index intraday as proxy
      const fetchIntradayViaHttp = (secid) => new Promise((resolve) => {
        const url = `http://push2.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1`;
        http.get(url, { timeout: 6000, headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
          let body = "";
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => {
            try { resolve(JSON.parse(body)); }
            catch (e) { resolve(null); }
          });
        }).on("error", () => resolve(null)).on("timeout", function() { this.destroy(); resolve(null); });
      });

      const buildIndexKline = async (indexSecid, sourceLabel) => {
        const data = await fetchIntradayViaHttp(indexSecid);
        const trends = data?.data?.trends;
        if (trends && trends.length >= 2 && prevClose) {
          const basePrice = +trends[0].split(",")[1];
          const klinePoints = trends.map(line => {
            const p = line.split(",");
            const time = p[0].split(" ")[1] || p[0];
            const idxChg = (+p[1] - basePrice) / basePrice;
            return { time, estNAV: +((1 + idxChg) * prevClose).toFixed(4), change: +(idxChg * 100).toFixed(2) };
          });
          const result = { code, name, prevClose, kline: klinePoints,
            holdingCount: 0, source: sourceLabel,
            isTrading: isMarketOpen(), updateTime: new Date().toISOString() };
          intradayKlineCache.set(cacheKey, { ts: Date.now(), data: result });
          return res.json(result);
        }
        return null;
      };

      // Step 1: Look up tracking index from fund name via INDEX_MAP
      const idxSecid = findIndexSecid(name);
      if (idxSecid) {
        const done = await buildIndexKline(idxSecid, `指数代理 ${idxSecid}`);
        if (done) return;
      }

      // Step 2: Try Shanghai Composite Index as universal proxy
      if (await buildIndexKline('1.000001', '上证指数代理')) return;

      // Step 3: fundgz single-point estimate as final fallback
      try {
        const fundGzResp = await axios.get(
          `http://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`,
          { timeout: 5000, headers: { "User-Agent": "Mozilla/5.0", Referer: "http://fund.eastmoney.com/" } }
        ).catch(() => null);
        if (fundGzResp) {
          const gzMatch = String(fundGzResp.data).match(/jsonpgz\((\{.*\})\);/);
          if (gzMatch) {
            const gz = JSON.parse(gzMatch[1]);
            const result = { code, name, prevClose,
              kline: [{ time: gz.gztime || "15:00", estNAV: +gz.gsz, change: +gz.gszzl || 0 }],
              holdingCount: 0, source: "fundgz",
              isTrading: isMarketOpen(), updateTime: new Date().toISOString() };
            intradayKlineCache.set(cacheKey, { ts: Date.now(), data: result });
            return res.json(result);
          }
        }
      } catch (e) { /* ignore */ }

      return res.json({ error: "该基金无持仓数据", name, prevClose });
    }

    // Get intraday data for all holdings
    const intradayResults = await Promise.all(
      cleanCodes.map(c => getIntradayTrend(c).catch(() => []))
    );

    // Build time-indexed price changes
    // For each holding, normalize to change from previous close
    const prevCloses = {};
    for (let i = 0; i < cleanCodes.length; i++) {
      const trends = intradayResults[i];
      if (trends.length > 0) {
        // Find first price as reference point
        const firstPrice = trends[0].price;
        prevCloses[cleanCodes[i]] = firstPrice / (1 + (trends[0].change || 0) / 100 || 0);
        // If no change data, use first price as prevClose approximation
        if (!prevCloses[cleanCodes[i]] || prevCloses[cleanCodes[i]] === firstPrice) {
          // Try to estimate from the trend
          prevCloses[cleanCodes[i]] = firstPrice;
        }
      }
    }

    // Get actual previous close from realtime quotes
    try {
      const quotes = await getRealtimeQuotes(cleanCodes);
      for (const q of quotes) {
        if (q.preClose) prevCloses[q.code] = q.preClose;
      }
    } catch (e) { /* use estimated prev closes */ }

    // Collect all unique time points
    const timeMap = new Map();
    for (let i = 0; i < cleanCodes.length; i++) {
      const trends = intradayResults[i];
      if (!trends.length) continue;
      for (const t of trends) {
        const time = t.time;
        if (!timeMap.has(time)) timeMap.set(time, {});
        timeMap.get(time)[cleanCodes[i]] = t.price;
      }
    }

    // Sort times
    const sortedTimes = [...timeMap.keys()].sort();
    if (sortedTimes.length === 0) {
      return res.json({ error: "暂无分时数据", name, prevClose });
    }

    // Calculate weighted estimated NAV at each time point
    // Use position weights if available, otherwise equal weight
    let totalWeight = 0;
    const weights = {};
    for (let i = 0; i < cleanCodes.length; i++) {
      const w = positions[i] ? (positions[i].jzbl || positions[i].ratio || 1) : 1;
      weights[cleanCodes[i]] = w;
      totalWeight += w;
    }

    const klinePoints = [];
    for (const time of sortedTimes) {
      const prices = timeMap.get(time);
      let weightedChg = 0, weightSum = 0;
      for (const [c, price] of Object.entries(prices)) {
        const prevC = prevCloses[c];
        if (!prevC || prevC === 0) continue;
        const chg = (price - prevC) / prevC;
        const w = weights[c] || 1;
        weightedChg += chg * w;
        weightSum += w;
      }
      if (weightSum === 0) continue;
      const avgChg = weightedChg / weightSum;
      const estNAV = prevClose != null ? prevClose * (1 + avgChg) : null;
      klinePoints.push({
        time,
        estNAV: estNAV != null ? +estNAV.toFixed(4) : null,
        change: +(avgChg * 100).toFixed(2),
      });
    }

    const result = {
      code, name, prevClose,
      kline: klinePoints,
      holdingCount: cleanCodes.length,
      isTrading: isMarketOpen(),
      updateTime: new Date().toISOString(),
    };

    intradayKlineCache.set(cacheKey, { ts: Date.now(), data: result });
    res.json(result);
}));

module.exports = router;

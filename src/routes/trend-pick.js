const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { getKlineData, getRealtimeQuotes } = require("../data");
const { SMA } = require("../indicators");

// ---- 行业/概念板块 → 代表股票池 ----
const SECTOR_STOCKS = {
  "半导体芯片": {
    desc: "半导体、芯片、集成电路",
    stocks: ["688981","688012","688396","002049","002371","002475","300059","300124","300408",
             "600703","603986","603160","600584","002185","002156","603005","600183","002436"],
  },
  "新能源光储": {
    desc: "光伏、储能、锂电池",
    stocks: ["601012","002459","300274","300014","600438","601615","688599","688005",
             "300750","002466","300450","002460","600406","601058"],
  },
  "消费白酒": {
    desc: "白酒、食品、消费龙头",
    stocks: ["600519","000858","002594","600887","603288","600809","000333","002714",
             "600690","000568","600132","002007","300015","300122"],
  },
  "医药生物": {
    desc: "创新药、医疗器械、CXO",
    stocks: ["600276","603259","600085","600196","300760","002353","000651","600079",
             "300003","688180","002223","600763"],
  },
  "金融银行": {
    desc: "银行、证券、保险",
    stocks: ["601398","600036","601166","601318","601688","000001","600000",
             "000002","002142","600570","601360"],
  },
  "军工航天": {
    desc: "军工、航天、船舶",
    stocks: ["600893","600760","600391","000768","002013","600685","600118",
             "000547","300424","601989"],
  },
  "AI算力": {
    desc: "人工智能、云计算、大数据",
    stocks: ["002230","688111","688095","603019","300474","300212","000977",
             "002236","688561","600536"],
  },
  "汽车智驾": {
    desc: "汽车制造、智能驾驶",
    stocks: ["600104","000625","601225","002916","601138","600745","300433",
             "601633","002594","000338"],
  },
  "有色资源": {
    desc: "有色金属、煤炭、石油",
    stocks: ["601899","601088","603833","000657","000960","000807","600673",
             "601857","600028"],
  },
  "电力设备": {
    desc: "电力设备、特高压、电网",
    stocks: ["600900","601615","600406","601179","002202","600875",
             "300274","601012"],
  },
};

// 展开所有股票代码 (去重)
const ALL_TREND_STOCKS = [...new Set(
  Object.values(SECTOR_STOCKS).flatMap(s => s.stocks)
)];

// ---- 个股打分 (85分制) ----
function scoreStock(klines) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const i = closes.length - 1;
  if (i < 120 || !closes[i]) return null;
  const last = closes[i];

  const ma5 = SMA(closes, 5);
  const ma10 = SMA(closes, 10);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);
  const ma120 = SMA(closes, 120);
  const ma250 = SMA(closes, 250);

  const aboveMA250 = ma250[i] != null && last > ma250[i];
  const aboveMA120 = ma120[i] != null && last > ma120[i];
  const aboveMA60 = ma60[i] != null && last > ma60[i];

  const maAlign = ma5[i] != null && ma10[i] != null && ma20[i] != null && ma60[i] != null
    && ma5[i] > ma10[i] && ma10[i] > ma20[i] && ma20[i] > ma60[i];
  const nearAlign = ma5[i] != null && ma10[i] != null && ma20[i] != null
    && ma5[i] > ma10[i] && ma10[i] > ma20[i];

  let alignScore = 0;
  if (maAlign) alignScore = 30;
  else if (nearAlign) alignScore = 22;
  else if (ma5[i] != null && ma10[i] != null && ma5[i] > ma10[i]) alignScore = 12;
  if (aboveMA250) alignScore += 5;
  else alignScore = Math.max(0, alignScore - 15);
  if (aboveMA120) alignScore += 3;
  alignScore = Math.max(0, Math.min(30, alignScore));

  let pullbackScore = 0;
  const gap5 = ma5[i] != null ? (last - ma5[i]) / ma5[i] * 100 : 999;
  const gap10 = ma10[i] != null ? (last - ma10[i]) / ma10[i] * 100 : 999;
  const gap20 = ma20[i] != null ? (last - ma20[i]) / ma20[i] * 100 : 999;

  if (nearAlign && gap10 >= -2 && gap10 <= 4) pullbackScore += 10;
  else if (nearAlign && gap10 >= -5 && gap10 <= 6) pullbackScore += 6;
  if (gap20 >= -3 && gap20 <= 5) pullbackScore += 5;
  else if (gap20 >= -6 && gap20 <= 8) pullbackScore += 3;

  if (i >= 2 && volumes[i] < volumes[i - 1] && volumes[i - 1] < volumes[i - 2] && gap10 < 4) {
    pullbackScore += 3;
  }
  pullbackScore = Math.max(0, Math.min(15, pullbackScore));

  let pullbackLabel = "";
  if (gap10 >= -2 && gap10 <= 3) pullbackLabel = "回踩MA10 ✓";
  else if (gap20 >= -2 && gap20 <= 4) pullbackLabel = "回踩MA20 ✓";
  else if (gap10 > 10) pullbackLabel = "远离均线";
  else if (gap10 < -5) pullbackLabel = "跌破均线";

  let momentumScore = 0;
  if (i >= 5 && closes[i - 5] > 0) {
    const chg5 = (last - closes[i - 5]) / closes[i - 5] * 100;
    if (chg5 > 8) momentumScore += 10;
    else if (chg5 > 3) momentumScore += 6;
    else if (chg5 > 0) momentumScore += 3;
    if (chg5 < -5) momentumScore -= 5;
  }
  if (i >= 20 && closes[i - 20] > 0) {
    const chg20 = (last - closes[i - 20]) / closes[i - 20] * 100;
    if (chg20 > 15) momentumScore += 8;
    else if (chg20 > 5) momentumScore += 5;
    else if (chg20 > 0) momentumScore += 2;
  }
  if (i >= 10 && ma5[i] != null && ma20[i] != null) {
    const slope5 = (ma5[i] - ma5[i - 5]) / Math.abs(ma5[i - 5] || 1) * 100;
    const slope20 = (ma20[i] - ma20[i - 5]) / Math.abs(ma20[i - 5] || 1) * 100;
    if (slope5 > slope20 && slope5 > 0) momentumScore += 5;
  }
  momentumScore = Math.max(0, Math.min(25, momentumScore));

  let volScore = 0;
  if (volumes[i] > 0 && i >= 5) {
    const avgV5 = volumes.slice(i - 5, i).reduce((a, b) => a + b, 0) / 5;
    const avgV20 = volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
    if (avgV5 > 0) {
      const vr = volumes[i] / avgV5;
      if (vr > 1.5) volScore += 7;
      else if (vr > 1.2) volScore += 4;
      else if (vr > 0.9) volScore += 2;
    }
    if (avgV20 > 0 && volumes[i] > avgV20) volScore += 4;
    const chg = closes[i - 1] > 0 ? (last - closes[i - 1]) / closes[i - 1] : 0;
    if (chg > 0 && volumes[i] > volumes[i - 1]) volScore += 4;
  }
  volScore = Math.max(0, Math.min(15, volScore));

  const total = alignScore + pullbackScore + momentumScore + volScore;

  let grade, gradeColor;
  if (total >= 65) { grade = "强势"; gradeColor = "#f87171"; }
  else if (total >= 50) { grade = "偏多"; gradeColor = "#f59e0b"; }
  else if (total >= 35) { grade = "关注"; gradeColor = "#60a5fa"; }
  else { grade = "观望"; gradeColor = "#94a3b8"; }

  const signalTypes = [];
  if (pullbackLabel.includes("回踩")) signalTypes.push("回踩买点");
  if (maAlign) signalTypes.push("多头排列");
  else if (nearAlign) signalTypes.push("短中均线多头");
  if (aboveMA250) signalTypes.push("年线上方");
  if (volScore >= 10) signalTypes.push("放量确认");

  return {
    score: total, grade, gradeColor,
    alignScore, pullbackScore, momentumScore, volScore,
    pullbackLabel,
    maStatus: { aboveMA250, aboveMA60, isAligned: maAlign, nearAligned: nearAlign },
    gaps: { gap5: +gap5.toFixed(1), gap10: +gap10.toFixed(1), gap20: +gap20.toFixed(1) },
    signals: signalTypes.length > 0 ? signalTypes : ["待观察"],
    price: last,
  };
}

// ---- 获取板块聚合数据 (基于实时行情) ----
async function getSectorSnapshot(sectorName, stockCodes) {
  try {
    const quotes = await getRealtimeQuotes(stockCodes);
    if (!quotes.length) return null;
    const upStocks = quotes.filter(q => q.change > 0);
    const totalAmount = quotes.reduce((s, q) => s + (q.amount || 0), 0);
    const avgChg = quotes.reduce((s, q) => s + (q.change || 0), 0) / quotes.length;
    return {
      name: sectorName,
      stockCount: quotes.length,
      upCount: upStocks.length,
      avgChg: +avgChg.toFixed(2),
      upRatio: +(upStocks.length / quotes.length * 100).toFixed(1),
      totalAmount,
      stocks: quotes,
    };
  } catch (e) { return null; }
}

// ---- API ----

// 行业板块总览 (实时行情聚合)
router.get("/api/trend/boards", asyncHandler(async (req, res) => {
  const entries = Object.entries(SECTOR_STOCKS);
  const limit = Math.min(parseInt(req.query.limit) || 10, 20);

  const snapshots = await Promise.all(
    entries.map(([name, cfg]) => getSectorSnapshot(name, cfg.stocks))
  );

  const valid = snapshots.filter(Boolean);
  valid.sort((a, b) => (Math.abs(b.avgChg) * Math.log10(b.totalAmount + 1)) -
                       (Math.abs(a.avgChg) * Math.log10(a.totalAmount + 1)));

  // 为前5个板块采样MA250
  const topForMA = valid.slice(0, 5);
  for (const sector of topForMA) {
    const topStocks = [...sector.stocks].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 5);
    let aboveCount = 0;
    for (const s of topStocks) {
      try {
        const klines = await getKlineData(s.code, 300);
        if (klines.length >= 250) {
          const closes = klines.map(k => k.close);
          const i = closes.length - 1;
          const ma250 = closes.slice(i - 249, i + 1).reduce((a, b) => a + b, 0) / 250;
          if (closes[i] > ma250) aboveCount++;
        }
      } catch (e) {}
    }
    sector.aboveMA250 = aboveCount >= 3;
    sector.ma250Sample = aboveCount;
  }
  // 其余板块默认false（跳过MA250检查以节省时间）
  for (const sector of valid.slice(5)) {
    sector.aboveMA250 = false;
    sector.ma250Sample = 0;
  }

  const ma250Count = valid.filter(b => b.aboveMA250).length;

  res.json({
    boards: valid.slice(0, limit),
    ma250Count,
    totalCount: valid.length,
    topByTurnover: valid.slice(0, 10).map(b => ({
      code: b.name, name: b.name, totalAmount: b.totalAmount,
      avgChg: b.avgChg, aboveMA250: b.aboveMA250,
    })),
    timestamp: new Date().toISOString(),
  });
}));

// 行业内个股扫描
router.get("/api/trend/board-stocks", asyncHandler(async (req, res) => {
  const { board } = req.query;
  if (!board) return res.status(400).json({ error: "需要板块名称" });

  const sectorCfg = SECTOR_STOCKS[board];
  if (!sectorCfg) return res.json({ board, name: board, stocks: [], message: "未知板块" });

  const stockCodes = sectorCfg.stocks;
  const results = [];

  for (const code of stockCodes) {
    try {
      const klines = await getKlineData(code, 300);
      if (!klines || klines.length < 120) continue;
      const scores = scoreStock(klines);
      if (!scores) continue;
      const quotes = await getRealtimeQuotes([code]);
      const quote = quotes[0] || {};
      results.push({
        code, name: quote.name || code,
        price: quote.price, chgPct: quote.change,
        ...scores,
      });
    } catch (e) { /* skip */ }
    await new Promise(r => setTimeout(r, 150));
  }

  results.sort((a, b) => b.score - a.score);

  const strong = results.filter(r => r.score >= 50);
  const pullbackBuys = results.filter(r => r.pullbackLabel.includes("回踩") && r.score >= 40);

  res.json({
    board, name: board,
    totalStocks: stockCodes.length,
    analyzed: results.length,
    strong: strong.length,
    pullbackBuys: pullbackBuys.length,
    results: results.slice(0, 20),
    pullbackBuys: pullbackBuys.slice(0, 10),
    timestamp: new Date().toISOString(),
  });
}));

// 一键扫描: 全板块 → 个股打分 → 回踩信号
router.get("/api/trend/scan", asyncHandler(async (req, res) => {
  const boardLimit = Math.min(parseInt(req.query.boards) || 8, 10);
  const entries = Object.entries(SECTOR_STOCKS);

  // Step 1: 获取所有板块实时行情快照
  const snapshots = await Promise.all(
    entries.map(([name, cfg]) => getSectorSnapshot(name, cfg.stocks))
  );
  const validSnapshots = snapshots.filter(Boolean);

  // 按活跃度排序 (成交额 × 涨跌幅)
  validSnapshots.sort((a, b) => (Math.abs(b.avgChg) * Math.log10(b.totalAmount + 1)) -
                                (Math.abs(a.avgChg) * Math.log10(a.totalAmount + 1)));
  const topSnapshots = validSnapshots.slice(0, boardLimit);

  // Step 2: 对top板块做MA250快速检测
  for (const sector of topSnapshots) {
    const topStocks = [...sector.stocks].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 5);
    let aboveCount = 0;
    for (const s of topStocks) {
      try {
        const klines = await getKlineData(s.code, 300);
        if (klines.length >= 250) {
          const closes = klines.map(k => k.close);
          const i = closes.length - 1;
          const ma250 = closes.slice(i - 249, i + 1).reduce((a, b) => a + b, 0) / 250;
          if (closes[i] > ma250) aboveCount++;
        }
      } catch (e) {}
    }
    sector.aboveMA250 = aboveCount >= 3;
    sector.ma250Sample = aboveCount;
  }

  // Step 3: MA250上方的行业 → 个股评分
  const strongSectors = topSnapshots.filter(b => b.aboveMA250).slice(0, 5);
  const allPicks = [];

  for (const sector of strongSectors) {
    const sectorCfg = SECTOR_STOCKS[sector.name];
    if (!sectorCfg) continue;
    for (const code of sectorCfg.stocks) {
      try {
        const klines = await getKlineData(code, 300);
        if (!klines || klines.length < 120) continue;
        const scores = scoreStock(klines);
        if (!scores) continue;
        const stockInfo = sector.stocks.find(s => s.code === code);
        allPicks.push({
          code, name: stockInfo?.name || code,
          board: sector.name,
          ...scores,
        });
      } catch (e) { /* skip */ }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  allPicks.sort((a, b) => b.score - a.score);

  const buySignals = allPicks.filter(r => r.pullbackLabel.includes("回踩") && r.score >= 40);
  const strongPicks = allPicks.filter(r => r.score >= 50);

  res.json({
    boardsScanned: topSnapshots.length,
    strongBoards: strongSectors.map(b => ({
      code: b.name, name: b.name, turnover: b.totalAmount,
      avgChg: b.avgChg, aboveMA250: b.aboveMA250,
    })),
    allBoards: topSnapshots.map(b => ({
      code: b.name, name: b.name, avgChg: b.avgChg,
      totalAmount: b.totalAmount, aboveMA250: b.aboveMA250,
    })),
    totalPicks: allPicks.length,
    strongPicks: strongPicks.slice(0, 20),
    buySignals: buySignals.slice(0, 15),
    results: allPicks.slice(0, 30),
    timestamp: new Date().toISOString(),
  });
}));

// 行业列表 (前端下拉/切换用)
router.get("/api/trend/industries", (req, res) => {
  const list = Object.entries(SECTOR_STOCKS).map(([name, cfg]) => ({
    code: name, name, desc: cfg.desc, count: cfg.stocks.length,
  }));
  res.json(list);
});

module.exports = router;

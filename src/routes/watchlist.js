const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const database = require("../database");

// 获取自选股组列表
router.get("/api/watchlist/groups", asyncHandler(async (req, res) => {
  const groups = database.getWatchlistGroups();
  res.json({ groups });
}));

// 创建自选股组
router.post("/api/watchlist/groups", asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "需要组名" });
  }
  const id = database.createWatchlistGroup(name);
  res.json({ success: true, id });
}));

// 删除自选股组
router.delete("/api/watchlist/groups/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const deleted = database.deleteWatchlistGroup(id);
  res.json({ success: true, deleted });
}));

// 获取自选股列表（支持分组）
router.get("/api/watchlist", asyncHandler(async (req, res) => {
  const { getRealtimeQuotes, getStockName } = require("../data");
  const { group_id } = req.query;

  const rows = database.getWatchlistItems(group_id || null);

  if (!rows || rows.length === 0) {
    return res.json({ items: [] });
  }

  // 获取实时行情
  const codes = rows.map(r => r.code);
  let quotes = [];
  try {
    quotes = await getRealtimeQuotes(codes);
  } catch (e) {
    console.error("获取行情失败:", e);
  }

  // 构建行情映射
  const quoteMap = {};
  quotes.forEach(q => { quoteMap[q.code] = q; });

  // 合并数据
  const items = rows.map(row => {
    const quote = quoteMap[row.code] || {};
    // 价格: API实时价优先, 无数据时用手动录入价
    const manualPrice = (row.type === 'option' && row.last_price) ? row.last_price : 0;
    const apiPrice = quote.price || 0;
    const price = apiPrice > 0 ? apiPrice : (manualPrice > 0 ? manualPrice : 0);
    // 昨结算: API优先, 无数据时用手动录入值
    const apiPreClose = quote.preClose || 0;
    const manualPreClose = (row.type === 'option' && row.last_preclose) ? row.last_preclose : 0;
    const preCloseVal = apiPreClose > 0 ? apiPreClose : (manualPreClose > 0 ? manualPreClose : 0);
    const quantity = row.quantity || 0;
    const direction = row.direction || 1;
    // 计算当日收益
    let dailyPnl = 0;
    if (row.type === 'option') {
      dailyPnl = direction * quantity * (price - preCloseVal);
    } else {
      dailyPnl = quantity * (price - preCloseVal);
    }

    return {
      ...row,
      price: price,
      change: quote.change || 0,
      changePercent: quote.changePercent || 0,
      volume: quote.volume || 0,
      amount: quote.amount || 0,
      high: quote.high || 0,
      low: quote.low || 0,
      open: quote.open || 0,
      preClose: preCloseVal,
      dailyPnl: dailyPnl,
    };
  });

  res.json({ items });
}));

// 添加自选股
router.post("/api/watchlist", asyncHandler(async (req, res) => {
  const { code, name, type, quantity, direction, group_id } = req.body;

  if (!code) {
    return res.status(400).json({ error: "需要股票代码" });
  }

  // 验证代码格式
  const cleanCode = code.replace(/\s/g, '');
  if (!/^\d{6,8}$/.test(cleanCode)) {
    return res.status(400).json({ error: "代码格式错误，需要6-8位数字" });
  }

  const { getStockName } = require("../data");
  const stockName = name || await getStockName(cleanCode).catch(() => cleanCode);

  try {
    const id = database.addWatchlistItem({
      code: cleanCode,
      name: stockName,
      type: type || "stock",
      quantity: quantity || 0,
      direction: direction || 1,
      groupId: group_id || 1
    });
    res.json({ success: true, id });
  } catch (err) {
    return res.status(500).json({ error: "添加失败" });
  }
}));

// 批量添加自选股
router.post("/api/watchlist/batch", asyncHandler(async (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: "需要items数组" });
  }

  const { getStockName } = require("../data");
  let added = 0;

  for (const item of items) {
    const code = item.code?.replace(/\s/g, '');
    if (!code || !/^\d{6,8}$/.test(code)) continue;

    const name = item.name || await getStockName(code).catch(() => code);
    const type = item.type || "stock";

    try {
      database.addWatchlistItem({ code, name, type });
      added++;
    } catch (e) {
      // 忽略重复添加错误
    }
  }

  res.json({ success: true, added });
}));

// 删除自选股
router.delete("/api/watchlist/:code", asyncHandler(async (req, res) => {
  const { code } = req.params;
  const deleted = database.deleteWatchlistItem(code);
  res.json({ success: true, deleted });
}));

// 更新自选股（持股数量、方向、现价、昨结算）
router.put("/api/watchlist/:code", asyncHandler(async (req, res) => {
  const { code } = req.params;
  const { quantity, direction, price, preClose } = req.body;

  // 更新现价/昨结算（手动录入）
  if (price !== undefined || preClose !== undefined) {
    if (price !== undefined) database.updateWatchlistPrice(code, parseFloat(price));
    if (preClose !== undefined) database.updateWatchlistPreClose(code, parseFloat(preClose));
    return res.json({ success: true, price: parseFloat(price) || 0, preClose: parseFloat(preClose) || 0 });
  }

  const fields = {};
  if (quantity !== undefined) fields.quantity = quantity;
  if (direction !== undefined) fields.direction = direction;

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: "需要更新的字段" });
  }

  const updated = database.updateWatchlistItem(code, fields);
  res.json({ success: true, updated });
}));

// 更新排序
router.put("/api/watchlist/sort", asyncHandler(async (req, res) => {
  const { codes } = req.body;

  if (!codes || !Array.isArray(codes)) {
    return res.status(400).json({ error: "需要codes数组" });
  }

  const updated = database.updateWatchlistSort(codes);
  res.json({ success: true, updated });
}));

// 清空自选股
router.delete("/api/watchlist", asyncHandler(async (req, res) => {
  const deleted = database.clearWatchlist();
  res.json({ success: true, deleted });
}));

// 收益月历 — 获取月度收益数据
router.get("/api/watchlist/calendar", asyncHandler(async (req, res) => {
  const { month } = req.query; // e.g. "2026-06"
  if (!month) return res.status(400).json({ error: "需要month参数" });

  const rows = database.getMonthlyPnl(month);

  // 按日期聚合: 每天的各分组 + 期权汇总
  const dayMap = {};
  rows.forEach(r => {
    if (!dayMap[r.date]) dayMap[r.date] = { date: r.date, groups: {}, total_pnl: 0, stock_pnl: 0, option_pnl: 0 };
    dayMap[r.date].groups[r.group_name || ('group_' + r.group_id)] = r.total_pnl;
    dayMap[r.date].total_pnl += r.total_pnl;
    dayMap[r.date].stock_pnl += r.stock_pnl;
    dayMap[r.date].option_pnl += r.option_pnl;
  });

  res.json({
    month,
    days: Object.values(dayMap).sort((a,b) => a.date.localeCompare(b.date)),
    raw: rows
  });
}));

// 收益月历 — 保存今日快照
router.post("/api/watchlist/calendar/snapshot", asyncHandler(async (req, res) => {
  const { getRealtimeQuotes } = require("../data");
  const today = new Date().toISOString().slice(0, 10);

  // 遍历所有分组 + 期权组(99)
  const groups = database.getWatchlistGroups();
  let saved = 0;

  for (const group of groups) {
    const items = database.getWatchlistItems(group.id);
    if (!items.length) continue;

    // 计算股票收益
    let stockPnl = 0, optionPnl = 0, stockCount = 0, optionCount = 0;
    const stockCodes = items.filter(i => i.type !== 'option').map(i => i.code);
    const optionCodes = items.filter(i => i.type === 'option').map(i => i.code);

    if (stockCodes.length) {
      try {
        const quotes = await getRealtimeQuotes(stockCodes);
        const qMap = {}; quotes.forEach(q => { qMap[q.code] = q; });
        items.filter(i => i.type !== 'option').forEach(item => {
          const q = qMap[item.code] || {};
          const daily = (item.quantity || 0) * ((q.price || 0) - (q.preClose || 0));
          stockPnl += daily;
          stockCount++;
        });
      } catch(e) {}
    }

    if (optionCodes.length) {
      try {
        const quotes = await getRealtimeQuotes(optionCodes);
        const qMap = {}; quotes.forEach(q => { qMap[q.code] = q; });
        items.filter(i => i.type === 'option').forEach(item => {
          const q = qMap[item.code] || {};
          const daily = (item.direction || 1) * (item.quantity || 0) * ((q.price || 0) - (q.preClose || 0));
          optionPnl += daily;
          optionCount++;
        });
      } catch(e) {}
    }

    database.saveDailyPnl(today, group.id, group.name, stockPnl, optionPnl, stockPnl + optionPnl, stockCount, optionCount);
    saved++;
  }

  res.json({ success: true, saved, date: today });
}));

module.exports = router;

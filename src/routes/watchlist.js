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
    const price = quote.price || 0;
    const preClose = quote.preClose || 0;
    const quantity = row.quantity || 0;
    const direction = row.direction || 1;

    // 计算当日收益
    let dailyPnl = 0;
    if (row.type === 'option') {
      dailyPnl = direction * quantity * (price - preClose);
    } else {
      dailyPnl = quantity * (price - preClose);
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
      preClose: preClose,
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

// 更新自选股（持股数量、方向）
router.put("/api/watchlist/:code", asyncHandler(async (req, res) => {
  const { code } = req.params;
  const { quantity, direction } = req.body;

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

module.exports = router;

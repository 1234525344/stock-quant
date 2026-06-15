/**
 * 遗传因子进化 v3 — API 路由
 * 基于 gpquant 符号回归思想
 */
const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { discoverFactors } = require("./genetic");
const { getKlineData, getStockName } = require("../data");

// 发现新因子 (GP 符号回归)
router.post("/api/ga/discover-factors", asyncHandler(async (req, res) => {
  const { code, opts } = req.body || {};
  if (!code) return res.status(400).json({ error: "股票代码必填" });

  const name = await getStockName(code);
  const klines = await getKlineData(code, 365);
  if (!klines || klines.length < 60) {
    return res.json({ error: "K线数据不足 (需要≥60条)", hint: "请尝试其他股票" });
  }

  const result = discoverFactors(klines, opts || {});
  res.json({ code, name, ...result });
}));

// 快速演示 (模拟数据)
router.get("/api/ga/demo", asyncHandler(async (req, res) => {
  // 生成真实感K线
  const n = 200;
  let price = 50;
  const klines = [];
  for (let i = 0; i < n; i++) {
    const trend = 0.0002;
    const vol = 0.015;
    price *= (1 + trend + (Math.random() - 0.48) * vol * 2);
    price = Math.max(5, price);
    klines.push({
      date:   `2026-${String(Math.floor(i/22)+1).padStart(2,'0')}-${String(i%22+1).padStart(2,'0')}`,
      open:   price * (1 + (Math.random()-0.5)*0.005),
      close:  price,
      high:   price * (1 + Math.random()*0.015),
      low:    price * (1 - Math.random()*0.015),
      volume: Math.random() * 1e7 + 5e6,
      turnover: Math.random() * 3 + 1,
      amount: price * (Math.random()*1e7 + 5e6),
    });
  }

  const result = discoverFactors(klines, { popSize: 40, maxGen: 10, maxDepth: 4 });

  res.json({
    code: "DEMO",
    name: "模拟演示数据",
    ...result,
  });
}));

module.exports = router;

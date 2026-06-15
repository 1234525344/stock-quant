// 市场新闻路由
const router = require("express").Router();
const newsEngine = require("../news-engine");
const { asyncHandler } = require("../middleware/errorHandler");

// 最新新闻列表
router.get("/api/news/latest", asyncHandler(async (req, res) => {
  const { page, pageSize, sentiment, source } = req.query;
  res.json(newsEngine.getLatest({
    page: parseInt(page) || 1,
    pageSize: parseInt(pageSize) || 20,
    sentiment, source,
  }));
}));

// 市场情绪指标
router.get("/api/news/sentiment", asyncHandler(async (req, res) => {
  res.json(newsEngine.getSentiment());
}));

// 个股相关新闻
router.get("/api/news/stock/:code", asyncHandler(async (req, res) => {
  res.json({ items: newsEngine.getStockNews(req.params.code) });
}));

// 手动触发抓取
router.post("/api/news/refresh", asyncHandler(async (req, res) => {
  await newsEngine.fetch();
  res.json({ ok: true, count: newsEngine.news.length });
}));

// 市场分析汇总 — AI综合研判
router.get("/api/news/analysis", asyncHandler(async (req, res) => {
  const analysis = await newsEngine.generateAnalysis();
  res.json(analysis);
}));

module.exports = router;

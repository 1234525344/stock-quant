const express = require("express");
const router = express.Router();
const path = require("path");
const database = require("../database");
const { generateDailyArticle } = require("../article-generator");
const { asyncHandler } = require("../middleware/errorHandler");

// ==================== 量化工厂页面 ====================

router.get("/quantlab", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "quantlab.html"));
});

// 内容分享中心
router.get("/share", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "share.html"));
});

// 一键发布页
router.get("/publish", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "publish.html"));
});

// ==================== 公众号文章素材生成 API ====================

// 每日量化分析文章（完整版 + 精简版）
router.get("/api/article/daily", asyncHandler(async (req, res) => {
  const article = await generateDailyArticle();
  res.json(article);
}));

// HTML格式文章预览页
router.get("/article", asyncHandler(async (req, res) => {
  const article = await generateDailyArticle();
  const html = renderArticleHTML(article);
  res.send(html);
}));

// 文章HTML渲染辅助函数
function renderArticleHTML(a) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const fullText = esc(a.full).replace(/\n/g, "<br>");
  const shortText = esc(a.short).replace(/\n/g, "<br>");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>每日量化分析 — ${a.date}</title>
<style>
body { max-width: 680px; margin: 0 auto; padding: 20px; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f5f5; color: #333; line-height: 1.8; }
.article-box { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
.copy-btn { display: block; width: 100%; padding: 14px; background: #07c160; color: #fff; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; margin-bottom: 20px; }
.copy-btn:active { opacity: .8; }
.preview-section { margin-bottom: 24px; }
.preview-section h3 { color: #666; font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
.short-version { background: #f9f9f9; border-radius: 8px; padding: 16px; font-size: 14px; }
.tabs { display: flex; gap: 8px; margin-bottom: 20px; }
.tab-btn { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 8px; background: #fff; cursor: pointer; font-size: 14px; }
.tab-btn.active { background: #07c160; color: #fff; border-color: #07c160; }
</style>
</head>
<body>
<div class="tabs">
  <button class="tab-btn active" data-tab="full">📰 公众号完整版</button>
  <button class="tab-btn" data-tab="short">📱 雪球/知乎精简版</button>
</div>
<div id="tabFull" class="preview-section">
  <button class="copy-btn" data-copy="fullText">📋 一键复制全文</button>
  <div class="article-box" id="fullText">${fullText}</div>
</div>
<div id="tabShort" class="preview-section" style="display:none">
  <button class="copy-btn" data-copy="shortText">📋 一键复制精简版</button>
  <div class="short-version" id="shortText">${shortText}</div>
</div>
	<script>
	document.addEventListener("click", function(event) {
	  var tabBtn = event.target.closest("[data-tab]");
	  if (tabBtn) {
	    var tab = tabBtn.getAttribute("data-tab");
	    document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
	    tabBtn.classList.add("active");
	    document.getElementById("tabFull").style.display = tab === "full" ? "block" : "none";
	    document.getElementById("tabShort").style.display = tab === "short" ? "block" : "none";
	    return;
	  }
	  var copyBtn = event.target.closest("[data-copy]");
	  if (copyBtn) {
	    var id = copyBtn.getAttribute("data-copy");
	    var el = document.getElementById(id);
	    var text = el.innerText;
	    navigator.clipboard.writeText(text).then(function() {
	      copyBtn.textContent = "✅ 已复制！去公众号粘贴发布";
	      setTimeout(function() { copyBtn.textContent = "📋 一键复制全文"; }, 2000);
	    }).catch(function() {
	      var range = document.createRange();
	      range.selectNode(el);
	      window.getSelection().removeAllRanges();
	      window.getSelection().addRange(range);
	      alert("请按 Ctrl+C 复制");
	    });
	  }
});
</script>
</body>
</html>`;
}

// ==================== 股票池 & 策略对比 ====================

const { STOCK_POOL } = require("../state");

router.get("/api/pool", (req, res) => {
  res.json({ count: STOCK_POOL.length, codes: STOCK_POOL });
});

router.get("/api/compare", asyncHandler(async (req, res) => {
  const { code, days } = req.query;
  if (!code) return res.status(400).json({ error: "code 必填" });
  const backtest = require("../autotrade/backtest");
  const { STRATEGY_TYPES } = require("../autotrade/strategy");
  const endDate = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - (parseInt(days) || 365));
  const startDate = start.toISOString().slice(0, 10);

  const results = {};
  for (const [key, cfg] of Object.entries(STRATEGY_TYPES)) {
    try {
      const result = await backtest.runStrategy(key, code, startDate, endDate);
      results[key] = {
        strategy: cfg.name || cfg || key,
        totalReturn: result.summary?.totalReturn || 0,
        annualizedReturn: result.summary?.annualizedReturn || 0,
        sharpe: result.risk?.sharpeRatio ?? 0,
        maxDrawdown: result.risk?.maxDrawdownPct ?? 0,
        winRate: result.trades?.winRate ?? 0,
        totalTrades: result.summary?.totalTrades || 0,
        grade: result.summary?.grade || "D",
      };
    } catch (e) {
      results[key] = { strategy: cfg.name || cfg || key, error: e.message };
    }
  }
  res.json({ code, startDate, endDate, results });
}));

// ==================== 数据库统计 API ====================

router.get("/api/db/stats", asyncHandler(async (req, res) => {
    await database.ready;
    const stats = database.getStats();
    res.json(stats);
}));

// 健康检查 — 微信小程序/负载均衡器探测
router.get("/api/health", (req, res) => {
  // Lazy-resolve wss/realtimeEngine from server.js to avoid circular require
  let wssOk = false;
  let realtimeOk = "stopped";
  try {
    const serverExports = require("../../server");
    if (serverExports.wss) wssOk = true;
    if (serverExports.realtimeEngine && serverExports.realtimeEngine._running) realtimeOk = "ok";
  } catch (_) {
    // server.js not yet fully loaded or circular dependency — degrade gracefully
  }

  // 运行时指标
  let metricsSummary = {};
  try {
    const { metrics } = require("../metrics");
    metricsSummary = metrics.toJSON();
  } catch (_) {}

  const health = {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "2.0.0",
    environment: process.env.NODE_ENV || "development",
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + "MB",
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + "MB",
    },
    components: {
      database: "ok",
      websocket: wssOk ? "ok" : "error",
      realtimeEngine: realtimeOk,
    },
    metrics: metricsSummary,
  };
  res.json(health);
});

// ==================== 交易记录 API ====================

router.get("/api/db/trades", asyncHandler(async (req, res) => {
    await database.ready;
    const { code, limit = 100, offset = 0 } = req.query;
    const trades = database.getTrades({ code, limit: parseInt(limit), offset: parseInt(offset) });
    res.json(trades);
}));

router.get("/api/db/trades/stats", asyncHandler(async (req, res) => {
    await database.ready;
    const stats = database.getTradeStats();
    res.json(stats);
}));

// 每日快照 API
router.get("/api/db/snapshots", asyncHandler(async (req, res) => {
    await database.ready;
    const { days = 30 } = req.query;
    const snapshots = database.getSnapshots({ days: parseInt(days) });
    res.json(snapshots);
}));

// ==================== 策略配置 API ====================

router.get("/api/db/strategies", asyncHandler(async (req, res) => {
    await database.ready;
    const strategies = database.getStrategies();
    res.json(strategies);
}));

router.post("/api/db/strategies", asyncHandler(async (req, res) => {
    await database.ready;
    const { name, config, active } = req.body;
    database.saveStrategy(name, config, active);
    res.json({ ok: true });
}));

// ==================== 告警记录 API ====================

router.get("/api/db/alerts", asyncHandler(async (req, res) => {
    await database.ready;
    const { limit = 50, unreadOnly } = req.query;
    const alerts = database.getAlerts({ limit: parseInt(limit), unreadOnly: unreadOnly === "true" });
    res.json(alerts);
}));

router.post("/api/db/alerts/:id/read", asyncHandler(async (req, res) => {
    await database.ready;
    database.markAlertRead(parseInt(req.params.id));
    res.json({ ok: true });
}));

module.exports = router;

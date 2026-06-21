// 长线分析路由 — 基本面 + 多年K线 + 估值指标
const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { getKlineData, getRealtimeQuotes, getStockName } = require("../data");
const { SMA, EMA, MACD } = require("../indicators");
const { execFile } = require("child_process");
const path = require("path");

// 长线综合分析
router.get("/api/stock/longterm/:code", asyncHandler(async (req, res) => {
  const { code } = req.params;
  if (!code) return res.status(400).json({ error: "需要股票代码" });

  // 并行获取: 长线K线(3年) + 短线K线(1年) + 实时报价
  const [klines, klines1y, quotes] = await Promise.all([
    getKlineData(code, 750).catch(() => []),
    getKlineData(code, 250).catch(() => []),
    getRealtimeQuotes([code]).catch(() => []),
  ]);

  const q = quotes[0] || {};
  const name = q.name || await getStockName(code).catch(() => code);
  const price = q.price || (klines.length > 0 ? klines[klines.length - 1].close : 0);

  if (!klines.length) return res.json({ code, name, error: "无K线数据" });

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);

  // 长线指标
  const ma60 = SMA(closes, 60);
  const ma120 = SMA(closes, 120);
  const ma250 = SMA(closes, 250);

  // 价格相对MA的位置
  const pos60 = ma60[ma60.length - 1] ? ((price / ma60[ma60.length - 1]) - 1) * 100 : null;
  const pos120 = ma120[ma120.length - 1] ? ((price / ma120[ma120.length - 1]) - 1) * 100 : null;
  const pos250 = ma250[ma250.length - 1] ? ((price / ma250[ma250.length - 1]) - 1) * 100 : null;

  // 高点/低点分析
  const max1y = Math.max(...highs.slice(-250));
  const min1y = Math.min(...lows.slice(-250));
  const max3y = Math.max(...highs);
  const min3y = Math.min(...lows);
  const from1yHigh = ((price / max1y) - 1) * 100;
  const from1yLow = ((price / min1y) - 1) * 100;

  // 年化波动率
  const returns = [];
  for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i-1]) / closes[i-1]);
  const avgRet = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - avgRet) ** 2, 0) / returns.length;
  const annualVol = Math.sqrt(variance) * Math.sqrt(250) * 100;

  // 收益分析
  const ret1y = closes.length >= 250 ? ((price / closes[closes.length - 250]) - 1) * 100 : null;
  const ret3y = closes.length >= 750 ? ((price / closes[closes.length - 750]) - 1) * 100 : null;
  const ret5y = closes.length >= 1250 ? ((price / closes[closes.length - 1250]) - 1) * 100 : null;

  // 最大回撤
  let maxDD = 0, peak = closes[0];
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (c - peak) / peak * 100;
    if (dd < maxDD) maxDD = dd;
  }

  // 均线多头/空头排列
  const maBullish = pos60 > 0 && pos120 > 0 && pos250 > 0;
  const maBearish = pos60 < 0 && pos120 < 0 && pos250 < 0;

  // 估值等级
  let valuation = "合理";
  if (from1yHigh > -10) valuation = "偏高";
  if (from1yHigh > -5) valuation = "高估";
  if (from1yLow < 10) valuation = "偏低";
  if (from1yLow < 5) valuation = "低估";

  // 综合评分 (0-100)
  let score = 50;
  if (pos60 > 0) score += 5; else score -= 5;
  if (pos120 > 0) score += 5; else score -= 5;
  if (pos250 > 0) score += 8; else score -= 8;
  if (ret1y > 0) score += 10; else score -= 5;
  if (maxDD > -20) score += 5;
  if (annualVol < 30) score += 5;
  score = Math.max(0, Math.min(100, score));

  const scoreLabel = score >= 70 ? "强烈看好" : score >= 55 ? "看好" : score >= 45 ? "中性" : score >= 30 ? "看淡" : "回避";

  // 月线数据 (压缩K线到月)
  const months = {};
  klines.forEach(k => {
    const m = k.date.substring(0, 7);
    if (!months[m]) months[m] = { date: m, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume };
    months[m].high = Math.max(months[m].high, k.high);
    months[m].low = Math.min(months[m].low, k.low);
    months[m].close = k.close;
    months[m].volume += k.volume;
  });
  const monthly = Object.values(months).slice(-36);

  // 基本面 (akshare, 异步)
  let fundamental = null;
  try {
    const { execPython } = require("../python-bin");
    const fundData = await execPython(
      path.join(__dirname, "../fund-bridge.py"), [code],
      { timeout: 15000, expectJson: true }
    );
    if (fundData && !fundData.error) fundamental = fundData.summary;
  } catch(e) {}

  res.json({
    code, name, price,
    fundamental,
    metrics: {
      ret1y, ret3y, ret5y, annualVol, maxDD,
      from1yHigh, from1yLow,
      pos60, pos120, pos250,
      maBullish, maBearish,
      valuation, score, scoreLabel
    },
    monthly,
    yearly: { max1y, min1y, max3y, min3y },
    klines: klines.slice(-750),
  });
}));

module.exports = router;

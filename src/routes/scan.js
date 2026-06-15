const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");
const { STOCK_POOL, SCAN_MODES, BREADTH_SAMPLE } = require("../state");
const { getKlineData, getRealtimeQuotes, getStockName, batchWithLimit } = require("../data");
const { detectRegime } = require("../autotrade/regime");
const { detectPattern } = require("./t3-strategy");
const { SMA, EMA, MACD, RSI, BOLL } = require("../indicators");

// 动态因子权重 — 根据市场状态自动调整评分侧重点
const REGIME_WEIGHTS = {
  bull:     { pos: 0.7,  launch: 1.2, trend: 1.2 },  // 趋势市: 重动能和趋势
  bear:     { pos: 1.3,  launch: 0.6, trend: 0.5 },  // 熊市: 重安全边际
  range:    { pos: 1.0,  launch: 1.0, trend: 1.0 },  // 震荡: 均衡
  volatile: { pos: 1.2,  launch: 0.5, trend: 0.6 },  // 高波: 保守防御
};

// K线缓存 (2分钟TTL, 大幅减少重复扫描的API调用)
const klineCache = new Map();
const CACHE_TTL = 2 * 60 * 1000;

function getCachedKline(code) {
  const entry = klineCache.get(code);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  klineCache.delete(code);
  return null;
}

function setCachedKline(code, data) {
  klineCache.set(code, { data, ts: Date.now() });
}

// ---- 综合评分 ----

function scoreStock(klines, weights = null) {
  const w = weights || REGIME_WEIGHTS.range;
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  const i = closes.length - 1;
  const last = closes[i];
  if (!last || last <= 0) return null;

  // 均线
  const ma5 = SMA(closes, 5);
  const ma10 = SMA(closes, 10);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);
  const ma120 = SMA(closes, 120);

  // MACD
  const macd = MACD(closes);

  // RSI
  const rsi = RSI(closes, 14);

  // 布林
  const boll = BOLL(closes, 20);

  // KDJ (完整计算, 包含历史趋势)
  let kVal = 50, dVal = 50, jVal = 50;
  let kPrev = 50, dPrev = 50;
  const n2 = 9;
  if (closes.length >= n2) {
    const hh = Math.max(...highs.slice(i - n2 + 1, i + 1));
    const ll = Math.min(...lows.slice(i - n2 + 1, i + 1));
    const rsv = hh !== ll ? ((last - ll) / (hh - ll)) * 100 : 50;
    // 用前一日值做平滑
    if (i >= n2 + 1) {
      const hhP = Math.max(...highs.slice(i - n2, i));
      const llP = Math.min(...lows.slice(i - n2, i));
      const rsvP = hhP !== llP ? ((closes[i - 1] - llP) / (hhP - llP)) * 100 : 50;
      kPrev = 2 / 3 * 50 + 1 / 3 * rsvP;
      dPrev = 2 / 3 * 50 + 1 / 3 * kPrev;
    }
    kVal = 2 / 3 * kPrev + 1 / 3 * rsv;
    dVal = 2 / 3 * dPrev + 1 / 3 * kVal;
    jVal = 3 * kVal - 2 * dVal;
  }

  // 关键衍生指标
  const high20 = Math.max(...highs.slice(Math.max(0, i - 19), i + 1));
  const low20 = Math.min(...lows.slice(Math.max(0, i - 19), i + 1));
  const high60 = i >= 59 ? Math.max(...highs.slice(i - 59, i + 1)) : high20;
  const fromLow20 = low20 > 0 ? (last - low20) / low20 * 100 : 0;
  const nearHigh20 = high20 > 0 ? last / high20 : 1;
  const gap20 = ma20[i] != null ? (last - ma20[i]) / ma20[i] * 100 : 0;
  const gap60 = ma60[i] != null ? (last - ma60[i]) / ma60[i] * 100 : 0;
  const chg5 = i >= 5 && closes[i - 5] > 0 ? (last - closes[i - 5]) / closes[i - 5] * 100 : 0;
  const chg10 = i >= 10 && closes[i - 10] > 0 ? (last - closes[i - 10]) / closes[i - 10] * 100 : 0;
  const chg20 = i >= 20 && closes[i - 20] > 0 ? (last - closes[i - 20]) / closes[i - 20] * 100 : 0;

  // 量比
  let volRatio = 1, volRatio20 = 1;
  if (volumes[i] > 0 && i >= 5) {
    const avgV5 = volumes.slice(i - 5, i).reduce((a, b) => a + b, 0) / 5;
    if (avgV5 > 0) volRatio = volumes[i] / avgV5;
  }
  if (volumes[i] > 0 && i >= 20) {
    const avgV20 = volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
    if (avgV20 > 0) volRatio20 = volumes[i] / avgV20;
  }

  // 连阳天数 + 连阴天数
  let upDays = 0, downDays = 0;
  for (let j = i; j > 0 && closes[j] > closes[j - 1]; j--) upDays++;
  for (let j = i; j > 0 && closes[j] < closes[j - 1]; j--) downDays++;

  // 布林带宽 (收窄=潜在突破)
  let bbWidth = 1;
  if (boll.upper[i] != null && boll.mid[i] != null) {
    bbWidth = (boll.upper[i] - boll.lower[i]) / boll.mid[i];
  }

  // MA20 斜率
  let ma20Slope = 0;
  if (ma20[i] != null && ma20[i - 5] != null && ma20[i - 5] > 0) {
    ma20Slope = (ma20[i] - ma20[i - 5]) / ma20[i - 5] * 100;
  }

  // ═══════════════════════════════════════════════
  // 位置分 (0-30): 低位安全边际 + 回踩确认 + 缩量筑底
  // ═══════════════════════════════════════════════
  let posScore = 0;

  // 距MA20偏离 (连续化, 0-8)
  if (gap20 < -20) posScore += 8;
  else if (gap20 < -15) posScore += 7;
  else if (gap20 < -10) posScore += 5;
  else if (gap20 < -5) posScore += 3;
  else if (gap20 < 0) posScore += 1;

  // 距MA60偏离 (0-7)
  if (gap60 < -30) posScore += 7;
  else if (gap60 < -20) posScore += 5;
  else if (gap60 < -10) posScore += 3;
  else if (gap60 < -5) posScore += 1;

  // 距20日最低点的距离 (贴近支撑, 0-5)
  if (fromLow20 < 3) posScore += 5;
  else if (fromLow20 < 8) posScore += 3;
  else if (fromLow20 < 15) posScore += 1;

  // 布林下轨附近 (0-6)
  if (boll.lower[i] != null && last <= boll.lower[i] * 1.02) posScore += 6;
  else if (boll.lower[i] != null && last <= boll.lower[i] * 1.05) posScore += 4;
  else if (boll.lower[i] != null && last <= boll.lower[i] * 1.10) posScore += 2;

  // 布林带收窄 (潜在变盘点, 0-3)
  if (bbWidth < 0.08) posScore += 3;
  else if (bbWidth < 0.12) posScore += 1;

  // RSI 超卖 (0-6)
  if (rsi[i] != null && rsi[i] < 25) posScore += 6;
  else if (rsi[i] != null && rsi[i] < 30) posScore += 4;
  else if (rsi[i] != null && rsi[i] < 35) posScore += 2;
  else if (rsi[i] != null && rsi[i] < 40) posScore += 1;

  // KDJ 低位 (0-4)
  if (jVal < 10) posScore += 4;
  else if (jVal < 20) posScore += 2;
  else if (jVal < 30) posScore += 1;

  // 缩量筑底 (0-5)
  if (volRatio20 < 0.5 && fromLow20 < 10) posScore += 5;
  else if (volRatio20 < 0.7 && fromLow20 < 15) posScore += 3;
  else if (volRatio20 < 0.85) posScore += 1;

  // ═══════════════════════════════════════════════
  // 启动分 (0-30): 量价突破 + 金叉共振 + 资金介入
  // ═══════════════════════════════════════════════
  let launchScore = 0;

  // MACD 金叉 (区分零轴上/下, 0-8)
  if (macd.dif[i] != null && macd.dea[i] != null) {
    if (macd.dif[i] > macd.dea[i]) {
      if (macd.dif[i] > 0) launchScore += 8;       // 零轴上金叉: 强势
      else if (macd.dif[i] > macd.dea[i]) launchScore += 5;  // 零轴下金叉: 反弹启动
    }
    // 金叉刚形成 (今日DIF上穿DEA)
    if (macd.dif[i] > macd.dea[i] && macd.dif[i - 1] != null && macd.dea[i - 1] != null
        && macd.dif[i - 1] <= macd.dea[i - 1]) launchScore += 2;
  }
  // MACD 红柱 (0-3)
  if (macd.macd[i] != null && macd.macd[i] > 0) launchScore += 2;
  // MACD 红柱放大 (加速, 0-3)
  if (macd.macd[i] != null && macd.macd[i - 1] != null && macd.macd[i] > macd.macd[i - 1] && macd.macd[i] > 0) launchScore += 3;

  // 均线金叉 (0-6)
  if (ma5[i] != null && ma10[i] != null && ma5[i] > ma10[i]) launchScore += 3;
  if (ma10[i] != null && ma20[i] != null && ma10[i] > ma20[i]) launchScore += 2;
  // MA5 刚上穿 MA10 (今日金叉)
  if (ma5[i] > ma10[i] && ma5[i - 1] != null && ma10[i - 1] != null && ma5[i - 1] <= ma10[i - 1]) launchScore += 1;

  // 放量 vs 5日均量 (0-8)
  if (volRatio > 2.5) launchScore += 8;
  else if (volRatio > 2.0) launchScore += 6;
  else if (volRatio > 1.5) launchScore += 4;
  else if (volRatio > 1.2) launchScore += 2;

  // 放量 vs 20日均量 (0-4)
  if (volRatio20 > 2.5) launchScore += 4;
  else if (volRatio20 > 1.8) launchScore += 2;

  // 突破20日高点 (0-6)
  if (nearHigh20 >= 1.0) launchScore += 6;
  else if (nearHigh20 >= 0.97) launchScore += 4;
  else if (nearHigh20 >= 0.95) launchScore += 2;

  // KDJ 金叉 (0-4)
  if (kVal > dVal) launchScore += 2;
  if (kVal > dVal && kPrev <= dPrev) launchScore += 2; // 刚金叉
  if (jVal > 80) launchScore += 1;

  // RSI 强势 (0-3)
  if (rsi[i] != null && rsi[i] > 65) launchScore += 3;
  else if (rsi[i] != null && rsi[i] > 55) launchScore += 1;

  // 连阳 (资金持续介入, 0-3)
  if (upDays >= 4) launchScore += 3;
  else if (upDays >= 2) launchScore += 1;

  // ═══════════════════════════════════════════════
  // 趋势分 (0-30): 多头排列 + 趋势强度 + 持续性
  // ═══════════════════════════════════════════════
  let trendScore = 0;

  // 均线多头排列 (0-12)
  if (ma5[i] != null && ma10[i] != null && ma20[i] != null && ma60[i] != null) {
    if (ma5[i] > ma10[i] && ma10[i] > ma20[i] && ma20[i] > ma60[i]) trendScore += 12;
    else if (ma5[i] > ma10[i] && ma10[i] > ma20[i]) trendScore += 8;
    else if (ma5[i] > ma10[i]) trendScore += 5;
  } else if (ma5[i] != null && ma10[i] != null && ma20[i] != null) {
    if (ma5[i] > ma10[i] && ma10[i] > ma20[i]) trendScore += 8;
    else if (ma5[i] > ma10[i]) trendScore += 5;
  }

  // 长期均线 (0-5)
  if (ma20[i] != null && ma60[i] != null && ma20[i] > ma60[i]) trendScore += 4;
  if (ma60[i] != null && ma120[i] != null && ma60[i] > ma120[i]) trendScore += 1;

  // 价格站上均线 (0-6)
  if (ma5[i] != null && last > ma5[i]) trendScore += 2;
  if (ma10[i] != null && last > ma10[i]) trendScore += 2;
  if (ma20[i] != null && last > ma20[i]) trendScore += 2;

  // MA20 斜率 (0-5)
  if (ma20Slope > 3) trendScore += 5;
  else if (ma20Slope > 2) trendScore += 4;
  else if (ma20Slope > 1) trendScore += 2;
  else if (ma20Slope > 0) trendScore += 1;
  else if (ma20Slope < -3) trendScore -= 4;
  else if (ma20Slope < -1) trendScore -= 2;

  // 5日涨幅 (0-6)
  if (chg5 > 15) trendScore += 6;
  else if (chg5 > 8) trendScore += 5;
  else if (chg5 > 5) trendScore += 3;
  else if (chg5 > 2) trendScore += 2;
  else if (chg5 > 0) trendScore += 1;
  if (chg5 < -15) trendScore -= 6;
  else if (chg5 < -10) trendScore -= 4;
  else if (chg5 < -5) trendScore -= 2;

  // 10日涨幅 (0-4)
  if (chg10 > 15) trendScore += 4;
  else if (chg10 > 8) trendScore += 2;
  else if (chg10 > 3) trendScore += 1;
  if (chg10 < -15) trendScore -= 3;

  // MACD 红柱持续天数 (0-4)
  if (macd.macd[i] != null && macd.macd[i] > 0) {
    let redCount = 0;
    for (let j = i; j >= 0 && macd.macd[j] != null && macd.macd[j] > 0; j--) redCount++;
    if (redCount >= 10) trendScore += 4;
    else if (redCount >= 5) trendScore += 2;
    else if (redCount >= 3) trendScore += 1;
  }

  // 站上MA20持续天数 (趋势稳定性, 0-3)
  if (ma20[i] != null && last > ma20[i]) {
    let above20Days = 0;
    for (let j = i; j >= 0 && closes[j] > ma20[j]; j--) above20Days++;
    if (above20Days >= 20) trendScore += 3;
    else if (above20Days >= 10) trendScore += 2;
    else if (above20Days >= 5) trendScore += 1;
  }

  // ═══════════════════════════════════════════════
  // 波动率惩罚 (高波动的低位不靠谱)
  // ═══════════════════════════════════════════════
  let volPenalty = 0;
  if (i >= 20) {
    const rets = [];
    for (let t = i - 19; t <= i; t++) {
      if (closes[t - 1] > 0) rets.push((closes[t] - closes[t - 1]) / closes[t - 1]);
    }
    if (rets.length > 0) {
      const avgRet = rets.reduce((a, b) => a + b, 0) / rets.length;
      const stdRet = Math.sqrt(rets.reduce((s, r) => s + (r - avgRet) ** 2, 0) / rets.length);
      const dailyVol = stdRet * 100;
      if (dailyVol > 6) volPenalty = 10;
      else if (dailyVol > 5) volPenalty = 8;
      else if (dailyVol > 4) volPenalty = 5;
      else if (dailyVol > 3) volPenalty = 2;
    }
  }

  // ═══════════════════════════════════════════════
  // 合成: 先应用波动率惩罚，再加权，再封顶
  // ═══════════════════════════════════════════════
  posScore = Math.max(0, posScore - volPenalty);

  // 应用体制权重
  const weightedPos = Math.min(30, posScore * w.pos);
  const weightedLaunch = Math.min(30, launchScore * w.launch);
  const weightedTrend = Math.min(30, Math.max(0, trendScore * w.trend));

  const finalScore = Math.round(weightedPos + weightedLaunch + weightedTrend);

  // 等级
  let grade, gradeColor;
  if (finalScore >= 60) { grade = "A"; gradeColor = "#f87171"; }
  else if (finalScore >= 45) { grade = "B"; gradeColor = "#f59e0b"; }
  else if (finalScore >= 30) { grade = "C"; gradeColor = "#3b82f6"; }
  else { grade = "D"; gradeColor = "#94a3b8"; }

  // ═══════════════════════════════════════════════
  // 信号摘要 (更丰富)
  // ═══════════════════════════════════════════════
  const signals = [];

  // MACD
  if (macd.dif[i] != null && macd.dea[i] != null) {
    if (macd.dif[i] > macd.dea[i] && macd.dif[i] > 0) signals.push("MACD金叉");
    else if (macd.dif[i] > macd.dea[i]) signals.push("MACD底叉");
  }
  if (macd.macd[i] != null && macd.macd[i - 1] != null && macd.macd[i] > macd.macd[i - 1] && macd.macd[i] > 0) {
    signals.push("MACD红柱放大");
  }

  // RSI
  if (rsi[i] != null && rsi[i] < 30) signals.push("RSI超卖");
  if (rsi[i] != null && rsi[i] > 75) signals.push("RSI过热");

  // 布林
  if (boll.lower[i] != null && last <= boll.lower[i] * 1.02) signals.push("触布林下轨");
  if (boll.upper[i] != null && last >= boll.upper[i] * 0.98) signals.push("触布林上轨");
  if (bbWidth < 0.08) signals.push("布林收窄");

  // 均线
  if (ma5[i] != null && ma10[i] != null && ma5[i] > ma10[i]) signals.push("MA5>MA10");
  if (ma5[i] != null && ma10[i] != null && ma20[i] != null
      && ma5[i] > ma10[i] && ma10[i] > ma20[i]) signals.push("均线多头");

  // 放量
  if (volRatio > 2.0) signals.push("明显放量");
  else if (volRatio > 1.5) signals.push("放量");

  // 缩量
  if (volRatio20 < 0.6 && volRatio20 > 0) signals.push("缩量");

  // 突破
  if (nearHigh20 >= 1.0) signals.push("突破前高");
  else if (nearHigh20 >= 0.97) signals.push("逼近前高");

  // KDJ
  if (kVal > dVal && kPrev <= dPrev) signals.push("KDJ金叉");
  if (jVal < 15) signals.push("KDJ超卖");

  // 连阳/连阴
  if (upDays >= 5) signals.push(`${upDays}连阳`);
  else if (upDays >= 3) signals.push("连续上涨");
  if (downDays >= 5) signals.push(`${downDays}连阴`);

  // 缩量筑底
  if (volRatio20 < 0.7 && fromLow20 < 10) signals.push("缩量筑底");

  // 涨幅
  if (chg5 > 15) signals.push("强势拉升");
  else if (chg5 > 8) signals.push("温和上涨");
  if (chg5 < -10) signals.push("短期超跌");

  const signalSummary = signals.length > 0 ? signals.slice(0, 4).join("·") : "信号中性";

  return {
    score: finalScore,
    grade,
    gradeColor,
    positionScore: Math.round(weightedPos),
    launchScore: Math.round(weightedLaunch),
    trendScore: Math.round(weightedTrend),
    chg5: +chg5.toFixed(2),
    chg10: +chg10.toFixed(2),
    chg20: +chg20.toFixed(2),
    volRatio: +volRatio.toFixed(2),
    volRatio20: +volRatio20.toFixed(2),
    upDays,
    nearHigh20: +nearHigh20.toFixed(3),
    signalSummary,
    signals,
  };
}

// ---- API ----

// 单股扫描评分
router.get("/api/screen", asyncHandler(async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).json({ error: "需要股票代码" });
  const klines = await getKlineData(code, 120);
  if (!klines || klines.length < 60) return res.json({ error: "K线数据不足" });
  // 检测市场状态
  let weights = REGIME_WEIGHTS.range;
  try {
    const idxKlines = await getKlineData("000001", 120);
    if (idxKlines?.length >= 60) {
      const regime = detectRegime(idxKlines).regime;
      weights = REGIME_WEIGHTS[regime] || REGIME_WEIGHTS.range;
    }
  } catch (_) {}
  const scores = scoreStock(klines, weights);
  if (!scores) return res.json({ error: "评分失败" });
  const name = await getStockName(code).catch(() => code);
  res.json({ code, name, ...scores });
}));

// 批量扫描评分
router.get("/api/scan", asyncHandler(async (req, res) => {
  const mode = req.query.mode || "all";
  const minScore = parseInt(req.query.minScore) || SCAN_MODES[mode]?.minScore || 20;
  const limit = Math.min(parseInt(req.query.limit) || 30, 50);
  const codes = STOCK_POOL.slice(0, 200);

  // === T+3回调低吸模式 ===
  if (mode === "t3pullback") {
    const results = [];
    const pool = [...new Set([...BREADTH_SAMPLE, ...STOCK_POOL])];

    for (const code of pool) {
      try {
        let klines = getCachedKline(code);
        if (!klines) {
          klines = await getKlineData(code, 120);
          if (klines?.length >= 60) setCachedKline(code, klines);
        }
        if (!klines || klines.length < 30) continue;
        klines.forEach(k => { k.code = code; k.name = ''; });

        // 滑动窗口: 检查最近15个交易日
        for (let day = klines.length - 1; day >= Math.max(4, klines.length - 15); day--) {
          const window = klines.slice(0, day + 1);
          const result = detectPattern(window, { limitUpPct: 7.0, volRatioMin: 0.5 });
          if (result && result.score >= minScore) {
            const name = await getStockName(code).catch(() => code);
            result.name = name;
            result.signalDate = klines[day].date;
            result.code = code;
            results.push(result);
            break;
          }
        }
      } catch (e) { /* skip */ }
    }

    results.sort((a, b) => b.score - a.score);
    const limited = results.slice(0, limit);

    return res.json({
      mode: SCAN_MODES[mode]?.label || "T+3回调低吸",
      desc: "T日放量→T+1大涨→T+2阴线→T+3买入 (放宽版: 涨幅>=7%, 量比>=0.5, 近15日)",
      totalScanned: pool.length,
      totalPassed: results.length,
      count: limited.length,
      results: limited,
      hint: limited.length === 0 ? "近期(15交易日)无信号。T+3形态在震荡市中稀少, 周一~周五盘中效果更好。已放宽阈值(涨幅>=7%, 量比>=0.5)并扩大扫描至近15日。" : null,
      timestamp: new Date().toISOString(),
    });
  }

  // === 默认模式: 技术评分 ===
  // 检测当前市场状态，动态调整因子权重
  let regime = "range";
  let weights = REGIME_WEIGHTS.range;
  try {
    const idxKlines = await getKlineData("000001", 120);
    if (idxKlines?.length >= 60) {
      const detected = detectRegime(idxKlines);
      regime = detected.regime;
      weights = REGIME_WEIGHTS[regime] || REGIME_WEIGHTS.range;
    }
  } catch (_) {}

  // 并行获取K线 + 评分 (concurrency=10)
  const scored = await batchWithLimit(codes, async (code) => {
    try {
      let klines = getCachedKline(code);
      if (!klines) {
        klines = await getKlineData(code, 120);
        if (klines?.length >= 60) setCachedKline(code, klines);
      }
      if (!klines || klines.length < 60) return null;
      const scores = scoreStock(klines, weights);
      if (!scores || scores.score < minScore) return null;
      const name = await getStockName(code).catch(() => code);
      return { code, name, ...scores };
    } catch (e) { return null; }
  }, 10);

  // 按模式排序
  const sortBy = SCAN_MODES[mode]?.sortBy || "score";
  scored.sort((a, b) => b[sortBy] - a[sortBy]);

  const limited = scored.slice(0, limit);

  res.json({
    mode: SCAN_MODES[mode]?.label || "批量选股",
    totalScanned: codes.length,
    totalPassed: scored.length,
    count: limited.length,
    results: limited,
    regime,
    regimeWeights: {
      pos: +weights.pos.toFixed(1),
      launch: +weights.launch.toFixed(1),
      trend: +weights.trend.toFixed(1),
    },
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;

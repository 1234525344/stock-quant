// 实时信号一致性追踪引擎
// 追踪策略信号发出后的实际走势，计算准确率、方向正确率、盈亏一致性

const { SMA } = require("./indicators");

// 追踪单个信号的结果 (N日后验证)
function trackSignal(signal, klines, forwardDays = 5) {
  const { closes, dates } = klines;
  const idx = signal.idx;
  if (idx >= closes.length - forwardDays) return null;

  const entryPrice = closes[idx];
  const exitPrice = closes[idx + forwardDays];
  const actualReturn = +(((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2);
  const direction = signal.type === "buy" ? 1 : -1;
  const effectiveReturn = actualReturn * direction;

  // 判断信号是否正确
  let verdict;
  if (effectiveReturn > 1) verdict = "correct";
  else if (effectiveReturn > 0) verdict = "weak_correct";
  else if (effectiveReturn > -1) verdict = "weak_wrong";
  else verdict = "wrong";

  return {
    signalDate: dates[idx],
    verifyDate: dates[idx + forwardDays],
    signal: signal.type,
    entryPrice,
    exitPrice,
    actualReturn,
    effectiveReturn,
    verdict,
    forwardDays,
  };
}

// 批量追踪历史信号
function batchTrack(signals, klines, forwardDays = 5) {
  return signals.map(s => trackSignal(s, klines, forwardDays)).filter(Boolean);
}

// 一致性报告
function consistencyReport(tracked) {
  if (!tracked.length) return { error: "无追踪数据" };

  const total = tracked.length;
  const correct = tracked.filter(t => t.verdict === "correct" || t.verdict === "weak_correct").length;
  const buySignals = tracked.filter(t => t.signal === "buy");
  const sellSignals = tracked.filter(t => t.signal === "sell");

  const buyCorrect = buySignals.filter(t => t.verdict === "correct" || t.verdict === "weak_correct").length;
  const sellCorrect = sellSignals.filter(t => t.verdict === "correct" || t.verdict === "weak_correct").length;

  const avgEffReturn = +(tracked.reduce((s, t) => s + t.effectiveReturn, 0) / total).toFixed(2);
  const avgReturn = +(tracked.reduce((s, t) => s + t.actualReturn, 0) / total).toFixed(2);

  // 连续统计 (最近N次)
  const recent = tracked.slice(-10);
  const recentCorrect = recent.filter(t => t.verdict === "correct" || t.verdict === "weak_correct").length;

  // 趋势: 准确率在上升还是下降
  const half = Math.floor(tracked.length / 2);
  const firstHalf = tracked.slice(0, half);
  const secondHalf = tracked.slice(half);
  const firstRate = firstHalf.filter(t => t.verdict === "correct" || t.verdict === "weak_correct").length / Math.max(1, firstHalf.length);
  const secondRate = secondHalf.filter(t => t.verdict === "correct" || t.verdict === "weak_correct").length / Math.max(1, secondHalf.length);
  const trend = secondRate - firstRate > 0.05 ? "improving" : secondRate - firstRate < -0.05 ? "declining" : "stable";

  return {
    total,
    accuracy: +((correct / total) * 100).toFixed(1),
    buyAccuracy: buySignals.length ? +((buyCorrect / buySignals.length) * 100).toFixed(1) : 0,
    sellAccuracy: sellSignals.length ? +((sellCorrect / sellSignals.length) * 100).toFixed(1) : 0,
    avgEffectiveReturn: avgEffReturn,
    avgActualReturn: avgReturn,
    recentAccuracy: +(recentCorrect / Math.max(1, recent.length) * 100).toFixed(1),
    trend,
    buyCount: buySignals.length,
    sellCount: sellSignals.length,
  };
}

// 实时一致性快照 — 滚动窗口追踪
function rollingConsistency(klines, strategyFn, windowSize = 60, forwardDays = 5) {
  const { closes, highs, lows, volumes, opens, dates } = klines;
  const raw = strategyFn(closes, highs, lows, volumes, opens, dates);
  const signals = Array.isArray(raw) ? { signals: raw } : raw;
  const sigs = signals.signals || [];

  // 找信号点
  const signalPoints = [];
  for (let i = 0; i < sigs.length - forwardDays; i++) {
    if (sigs[i] !== 0) {
      signalPoints.push({
        idx: i,
        date: dates[i],
        type: sigs[i] === 1 ? "buy" : "sell",
        price: closes[i],
      });
    }
  }

  // 只取最近windowSize个信号
  const recentSignals = signalPoints.slice(-windowSize);
  const tracked = batchTrack(recentSignals, klines, forwardDays);
  return {
    report: consistencyReport(tracked),
    tracked: tracked.slice(-30),
    signalCount: signalPoints.length,
    windowSize,
    forwardDays,
  };
}

module.exports = { trackSignal, batchTrack, consistencyReport, rollingConsistency };

const path = require("path");
const fs = require("fs");
const state = require("../state");
const { monitorCache, pushedAlertIds } = state;
const { getRealtimeQuotes, getKlineData, getStockName, batchWithLimit } = require("../data");
const { getSignalsNow, detectMarketState, getAdvice } = require("../helpers");
const { alignReturns, ledoitWolfCovariance, portfolioReturns, riskDecomposition, stressTest } = require("../risk");
const { getIndexKline } = require("../index");

const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");

// ==================== 仓位建议 API ====================

// 实时信号查询
router.get("/api/signals/now", asyncHandler(async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: "需要股票代码" });
    const sigResp = await getSignalsNow(code).catch(() => null);
    if (!sigResp || sigResp.error) return res.json({ error: sigResp?.error || "信号数据获取失败" });
    res.json(sigResp);
}));

// 单只股票仓位建议
router.get("/api/advice/:code", asyncHandler(async (req, res) => {
    const { code } = req.params;

    // 并行获取信号和市场状态
    const [sigResp, marketState, quoteArr] = await Promise.all([
      getSignalsNow(code).catch(() => null),
      detectMarketState(),
      getRealtimeQuotes([code]).catch(() => []),
    ]);

    const name = (quoteArr[0]?.name) || await getStockName(code).catch(() => code);
    const price = quoteArr[0]?.price || sigResp?.price || 0;

    if (!sigResp || sigResp.error) return res.json({ error: "信号数据获取失败" });

    const consensus = sigResp.consensus;
    const votes = sigResp.votes || {};
    const volRatio = sigResp.volRatio || 1;
    const buyVotes = votes.buy || 0;
    const sellVotes = votes.sell || 0;

    // 基础仓位计算
    let basePct = 0;
    let action;
    switch (consensus) {
      case "strong_buy": basePct = 0.60; action = "build"; break;
      case "buy": basePct = 0.40; action = "build"; break;
      case "neutral": basePct = 0; action = "hold"; break;
      case "sell": basePct = -0.40; action = "reduce"; break;
      case "strong_sell": basePct = -0.80; action = "clear"; break;
      default: basePct = 0; action = "hold";
    }

    // 市场状态修正
    let marketModifier = 0;
    if (marketState.state === "uptrend") {
      marketModifier = action === "build" ? 0.10 : action === "reduce" ? -0.05 : 0;
    } else if (marketState.state === "downtrend") {
      marketModifier = action === "build" ? -0.15 : action === "reduce" ? 0.10 : 0;
    } else {
      marketModifier = action === "build" ? -0.05 : action === "reduce" ? 0.05 : 0;
    }

    // 成交量修正
    let volModifier = 0;
    if (volRatio < 0.7) volModifier = action === "build" ? -0.10 : action === "reduce" ? 0.05 : 0;
    else if (volRatio > 1.5) volModifier = action === "build" ? 0.05 : action === "reduce" ? -0.05 : 0;

    // 综合建议仓位百分比
    let suggestedPct = Math.max(-1, Math.min(1, basePct + marketModifier + volModifier));
    suggestedPct = +suggestedPct.toFixed(2);

    // 重新判定action
    if (suggestedPct > 0.4) action = "build";
    else if (suggestedPct > 0.15) action = "add";
    else if (suggestedPct >= -0.15) action = "hold";
    else if (suggestedPct > -0.5) action = "reduce";
    else action = "clear";

    // 推理文案
    const reasons = [];
    reasons.push(`${buyVotes}买${sellVotes}卖信号投票`);
    reasons.push(`市场状态: ${marketState.state === "uptrend" ? "趋势向上" : marketState.state === "downtrend" ? "趋势向下" : "震荡"}`);
    if (volRatio < 0.7) reasons.push("成交量萎缩，信号可靠性降低");
    else if (volRatio > 1.5) reasons.push("放量交易，信号强度增强");

    res.json({
      code, name, price,
      action,
      suggestedPct,
      confidence: Math.min(100, Math.round(Math.abs(suggestedPct) * 80 + (volRatio > 1 ? 15 : 0))),
      reasoning: reasons.join("；"),
      signals: consensus,
      marketState: marketState.state,
      updatedAt: new Date().toISOString(),
    });
}));

// 组合级仓位建议
router.get("/api/advice/portfolio", asyncHandler(async (req, res) => {
    const codes = (req.query.codes || "600519,000858,600036").split(",").filter(Boolean);
    const results = await batchWithLimit(codes, (code) => getAdvice(code).catch(() => null), 3);
    const valid = results.filter(r => r && !r.error);
    const marketState = await detectMarketState();

    // 组合平均建议
    const avgPct = valid.length ? +(valid.reduce((s, r) => s + r.suggestedPct, 0) / valid.length).toFixed(2) : 0;
    const actions = valid.map(r => r.action);
    const modeAction = actions.sort((a, b) =>
      actions.filter(v => v === a).length - actions.filter(v => v === b).length
    ).pop() || "hold";

    res.json({
      stocks: valid,
      portfolioAdvice: {
        action: modeAction,
        avgSuggestedPct: avgPct,
        stockCount: valid.length,
        recommendation: avgPct > 0.2 ? "整体偏多，可适当增加仓位" :
          avgPct < -0.2 ? "整体偏空，建议减仓或观望" :
          "信号中性，保持现有仓位，精选个股操作",
      },
      marketState: marketState.state,
      updatedAt: new Date().toISOString(),
    });
}));

// ==================== 风险分析 API ====================

// 风险分解
router.get("/api/risk/decompose", asyncHandler(async (req, res) => {
    const { code, benchmark } = req.query;
    if (!code) return res.status(400).json({ error: "需要股票代码" });

    const [klines, idxKlines] = await Promise.all([
      getKlineData(code, 365),
      getIndexKline(benchmark || "000001", 365).catch(() => []),
    ]);

    if (klines.length < 60) return res.json({ error: "数据不足" });
    const closes = klines.map(k => k.close);
    const rets = [];
    for (let i = 1; i < closes.length; i++) {
      rets.push(closes[i - 1] > 0 ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);
    }

    let mktRets = null;
    if (idxKlines.length >= 60) {
      const idxCloses = idxKlines.map(k => k.close);
      mktRets = [];
      for (let i = 1; i < idxCloses.length; i++) {
        mktRets.push(idxCloses[i - 1] > 0 ? (idxCloses[i] - idxCloses[i - 1]) / idxCloses[i - 1] : 0);
      }
    }

    let riskReport;
    if (mktRets && mktRets.length >= 20) {
      riskReport = riskDecomposition(rets, mktRets);
    } else {
      const totalVar = rets.reduce((s, r) => s + r ** 2, 0) / rets.length;
      const totalRisk = Math.sqrt(totalVar * 252);
      riskReport = { totalRisk: +totalRisk.toFixed(4), systematicRisk: 0, specificRisk: 0, beta: 0, rSquared: 0 };
    }

    const var95 = [...rets].sort((a, b) => a - b)[Math.floor(rets.length * 0.05)] * Math.sqrt(252);

    res.json({
      code,
      name: await getStockName(code),
      ...riskReport,
      var95: +(var95 * 100).toFixed(1),
    });
}));

// 协方差矩阵
router.get("/api/risk/covariance", asyncHandler(async (req, res) => {
    const { codes } = req.query;
    if (!codes) return res.json({ error: "需要股票代码列表" });
    const codeList = codes.split(",").filter(Boolean).slice(0, 15);
    if (codeList.length < 2) return res.json({ error: "至少需要2只股票" });

    const batchData = await batchWithLimit(codeList, async (code) => {
      try {
        const klines = await getKlineData(code, 250);
        if (klines.length < 60) return null;
        return { code, closes: klines.map(k => k.close), klines };
      } catch (e) { return null; }
    }, 5);

    const validData = batchData.filter(Boolean);
    const aligned = alignReturns(validData);
    const { cov, codes: covCodes, shrinkage } = ledoitWolfCovariance(aligned.matrix);

    // 转为相关性矩阵
    const corr = covCodes.map((_, i) =>
      covCodes.map((_, j) => {
        const s = Math.sqrt(Math.max(0, cov[i][i] * cov[j][j]));
        return s > 0 ? +(cov[i][j] / s).toFixed(3) : 0;
      })
    );

    res.json({
      codes: covCodes,
      covariance: cov,
      correlation: corr,
      shrinkage: +shrinkage.toFixed(3),
      annualVol: covCodes.map((_, i) => +(Math.sqrt(Math.max(0, cov[i][i])) * Math.sqrt(252) * 100).toFixed(1)),
    });
}));

module.exports = router;

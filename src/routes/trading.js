const path = require("path");
const fs = require("fs");
const state = require("../state");
const { riskEngine, paperTradingManager, monitorCache, pushedAlertIds } = state;
const { getRealtimeQuotes, getKlineData, getStockName, batchWithLimit } = require("../data");
const { getSignalsNow, detectMarketState, getAdvice } = require("../helpers");
const { parseCustomStrategy } = require("../strategy");
const { alignReturns, ledoitWolfCovariance, portfolioReturns, riskDecomposition, stressTest } = require("../risk");
const { generateRiskReport, runMonteCarloVaR } = require("../stress-test");
const { getIndexKline } = require("../index");

const router = require("express").Router();
const { asyncHandler } = require("../middleware/errorHandler");

// ==================== 仓位建议 API ====================

// 单只股票仓位建议
router.get("/advice/:code", asyncHandler(async (req, res) => {
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
router.get("/advice/portfolio", asyncHandler(async (req, res) => {
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
router.get("/risk/decompose", asyncHandler(async (req, res) => {
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

    const var95 = rets.sort((a, b) => a - b)[Math.floor(rets.length * 0.05)] * Math.sqrt(252);

    res.json({
      code,
      name: await getStockName(code),
      ...riskReport,
      var95: +(var95 * 100).toFixed(1),
    });
}));

// 协方差矩阵
router.get("/risk/covariance", asyncHandler(async (req, res) => {
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

// ==================== 风控 API ====================

// 获取限额配置
router.get("/risk/limits", (req, res) => {
  try {
    res.json(riskEngine.limits.toJSON());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新限额配置
router.post("/risk/limits", (req, res) => {
  try {
    const errors = riskEngine.limits.validate();
    if (errors.length > 0) return res.status(400).json({ error: "配置验证失败", details: errors });
    const updated = riskEngine.limits.update(req.body);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 风控仪表盘
router.get("/risk/status", (req, res) => {
  try {
    const posData = riskEngine.positions.toJSON();
    const alertSummary = riskEngine.alerts.getAlertSummary();
    const limits = riskEngine.limits.limits;

    // 检查违规
    const violations = [];
    const eq = posData.equity || 1;
    for (const pos of posData.positions) {
      const weight = pos.marketValue / eq;
      if (weight > limits.maxSinglePosition) violations.push({ code: pos.code, type: "single_position", actual: +(weight * 100).toFixed(1), limit: +(limits.maxSinglePosition * 100).toFixed(0) });
    }
    if (posData.totalPositionRatio > limits.maxTotalPosition * 100) violations.push({ type: "total_position", actual: posData.totalPositionRatio, limit: +(limits.maxTotalPosition * 100).toFixed(0) });

    res.json({
      positions: posData,
      pnl: { total: posData.pnl, pct: posData.pnlPct, daily: posData.dailySnapshots.slice(-1)[0]?.pnl || 0 },
      exposure: { total: posData.totalPositionRatio, byIndustry: posData.exposureByIndustry },
      alerts: alertSummary,
      limits: { totalPositionUsed: posData.totalPositionRatio, singlePositionMax: Math.max(0, ...posData.positions.map(p => eq > 0 ? (p.marketValue / eq * 100) : 0)), violations },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 预警列表
router.get("/risk/alerts", (req, res) => {
  try {
    const { type, severity, code, since, limit } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (severity) filter.severity = severity;
    if (code) filter.code = code;
    if (since) filter.since = since;
    filter.limit = parseInt(limit) || 50;
    res.json(riskEngine.alerts.getAlerts(filter));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 清除预警
router.post("/risk/alerts/clear", (req, res) => {
  try {
    riskEngine.alerts.clearAlerts();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 事前交易检查
router.post("/risk/check", asyncHandler(async (req, res) => {
    const { code, action, shares, price } = req.body;
    if (!code) return res.status(400).json({ error: "需要股票代码" });

    const checks = [];

    // 标的过滤
    const filterResult = await riskEngine.filter.check(
      code,
      (c) => getStockName(c).catch(() => null),
      (codes) => getRealtimeQuotes(codes).catch(() => []),
      (c, days) => getKlineData(c, days).catch(() => [])
    );
    checks.push({ name: "标的过滤", passed: filterResult.passed, reason: filterResult.reason, severity: filterResult.severity });

    // 如果买入，检查仓位限额
    if (action === "buy" && shares && price && filterResult.passed) {
      const testResult = await riskEngine.positions.openPosition(code, parseInt(shares), +price, await getStockName(code).catch(() => code));
      checks.push({ name: "仓位检查", passed: testResult.success, reason: testResult.reason, severity: testResult.success ? "info" : "blocked" });
      // 不实际执行，回滚
      if (testResult.success) riskEngine.positions.closePosition(code, +price);
    }

    const allPassed = checks.every(c => c.passed);
    res.json({
      code, passed: allPassed,
      checks,
      limits: riskEngine.limits.limits,
    });
}));

// 压力测试
router.post("/risk/stress-test", asyncHandler(async (req, res) => {
    const { codes, weights, scenarios } = req.body;

    let testCodes, testWeights;
    if (codes && weights && codes.length > 0) {
      testCodes = codes;
      testWeights = weights;
    } else {
      // 使用当前持仓
      const posData = riskEngine.positions.toJSON();
      testCodes = posData.positions.map(p => p.code);
      const eq = posData.equity || 1;
      testWeights = posData.positions.map(p => p.marketValue / eq);
    }

    if (testCodes.length < 2) return res.json({ error: "至少需要2只股票进行压力测试", suggestion: "请先添加模拟持仓或手动指定股票代码" });

    // 获取K线数据
    const klinesData = await batchWithLimit(testCodes, async (code) => {
      try {
        const klines = await getKlineData(code, 250);
        if (klines.length < 60) return null;
        return { code, closes: klines.map(k => k.close), klines };
      } catch (e) { return null; }
    }, 5);

    const validData = klinesData.filter(Boolean);
    if (validData.length < 2) return res.json({ error: "有效数据不足" });

    const aligned = alignReturns(validData);
    const { cov, codes: covCodes } = ledoitWolfCovariance(aligned.matrix);

    const validWeights = [];
    for (let i = 0; i < covCodes.length; i++) {
      const idx = testCodes.indexOf(covCodes[i]);
      validWeights.push(idx >= 0 ? (testWeights[idx] || 1 / covCodes.length) : (1 / covCodes.length));
    }
    const sumW = validWeights.reduce((a, b) => a + b, 0);
    const normWeights = validWeights.map(w => sumW > 0 ? w / sumW : 0);

    // 计算每只股票相对于上证指数的Beta
    const idxKlines = await getIndexKline("000001", 250).catch(() => []);
    const idxCloses = idxKlines.map(k => k.close);
    const idxRets = [];
    for (let i = 1; i < idxCloses.length; i++)
      idxRets.push(idxCloses[i - 1] > 0 ? (idxCloses[i] - idxCloses[i - 1]) / idxCloses[i - 1] : 0);

    const stockBetas = validData.map(k => {
      const closes = k.closes;
      if (closes.length < 60 || idxRets.length < 60) return 1;
      const stockRets = [];
      for (let i = 1; i < closes.length; i++)
        stockRets.push(closes[i - 1] > 0 ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);
      const n = Math.min(stockRets.length, idxRets.length);
      const sr = stockRets.slice(-n);
      const mr = idxRets.slice(-n);
      const sMean = sr.reduce((a, b) => a + b, 0) / n;
      const mMean = mr.reduce((a, b) => a + b, 0) / n;
      let cov = 0, varM = 0;
      for (let i = 0; i < n; i++) {
        cov += (sr[i] - sMean) * (mr[i] - mMean);
        varM += (mr[i] - mMean) ** 2;
      }
      return varM > 0 ? +((cov / varM)).toFixed(3) : 1;
    });

    // 根据所选场景过滤压力测试
    let allStressResults = stressTest(normWeights, cov, stockBetas, covCodes);
    if (scenarios && scenarios.length > 0) {
      allStressResults = allStressResults.filter(s => scenarios.includes(s.scenario));
    }

    // Monte Carlo VaR
    const portRets = portfolioReturns(aligned.matrix, normWeights);
    const mcVaR = runMonteCarloVaR(portRets);

    res.json({
      codes: covCodes,
      weights: normWeights.map((w, i) => ({ code: covCodes[i], weight: +(w * 100).toFixed(1) })),
      stressTests: allStressResults,
      monteCarlo: mcVaR,
      portfolioVol: +(Math.sqrt(normWeights.reduce((s, wi, i) =>
        s + normWeights.reduce((ss, wj, j) => ss + wi * wj * cov[i][j], 0), 0)) * Math.sqrt(252) * 100).toFixed(1),
      timestamp: new Date().toISOString(),
    });
}));

// 风控报告
router.get("/risk/report", asyncHandler(async (req, res) => {
    const report = await generateRiskReport(
      riskEngine.positions,
      (code, days) => getKlineData(code, days).catch(() => []),
      { period: req.query.period || "daily" }
    );

    if (req.query.export === "true") {
      const reportDir = path.join(__dirname, "..", "..", "reports");
      if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
      const filename = `risk-report-${new Date().toISOString().slice(0, 10)}.json`;
      fs.writeFileSync(path.join(reportDir, filename), JSON.stringify(report, null, 2));
      report.exportPath = filename;
    }

    res.json(report);
}));

// 风控Tick (手动触发检测)
router.post("/risk/tick", asyncHandler(async (req, res) => {
    const posData = riskEngine.positions.toJSON();
    const codes = posData.positions.map(p => p.code);

    if (codes.length > 0) {
      const quotes = await getRealtimeQuotes(codes).catch(() => []);
      riskEngine.positions.updatePrices(quotes);

      const newAlerts = [];
      for (const q of quotes) {
        const pos = riskEngine.positions.positions.get(q.code);
        if (!pos) continue;
        const alert1 = riskEngine.alerts.checkPriceLimit(q, q.preClose);
        if (alert1) newAlerts.push(alert1);
      }
      riskEngine.alerts.addAlerts(newAlerts);

      const pnlPct = riskEngine.positions.getTotalPnlPct() * 100;
      const lossAlert = riskEngine.alerts.checkPortfolioLoss(pnlPct);
      if (lossAlert) { riskEngine.alerts.addAlert(lossAlert); newAlerts.push(lossAlert); }

      riskEngine.positions._takeSnapshot();

      res.json({
        pnlUpdate: { pnl: riskEngine.positions.getTotalPnl().toFixed(2), pnlPct: pnlPct.toFixed(2) },
        newAlerts,
        violations: [],
        timestamp: new Date().toISOString(),
      });
    } else {
      res.json({ message: "当前无持仓", pnlUpdate: null, newAlerts: [], timestamp: new Date().toISOString() });
    }
}));

// 风控持仓操作 — 开仓
router.post("/risk/position/open", asyncHandler(async (req, res) => {
    const { code, shares, price } = req.body;
    if (!code || !shares || !price) return res.status(400).json({ error: "需要 code/shares/price" });
    const name = await getStockName(code).catch(() => code);
    const result = await riskEngine.positions.openPosition(code, parseInt(shares), +price, name);
    if (!result.success) return res.status(400).json({ error: result.reason });
    res.json({ success: true, ...riskEngine.positions.toJSON() });
}));

// 风控持仓操作 — 平仓
router.post("/risk/position/close", asyncHandler(async (req, res) => {
    const { code, price } = req.body;
    if (!code || !price) return res.status(400).json({ error: "需要 code/price" });
    const result = riskEngine.positions.closePosition(code, +price);
    if (!result.success) return res.status(400).json({ error: result.reason });
    res.json({ success: true, pnl: result.pnl, pnlPct: result.pnlPct, ...riskEngine.positions.toJSON() });
}));

// ==================== 实时信号监控 ====================

router.post("/monitor/start", asyncHandler(async (req, res) => {
    const { codes, config } = req.body;
    if (!codes || !config) return res.status(400).json({ error: "需要股票代码和策略" });
    const codeList = codes.split(",").filter(Boolean).slice(0, 20);
    monitorCache.stocks = codeList;
    monitorCache.config = config;

    // 首次扫描
    const results = await batchWithLimit(codeList, async (code) => {
      try {
        const klines = await getKlineData(code, 120);
        if (klines.length < 60) return null;
        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const volumes = klines.map(k => k.volume);
        const opens = klines.map(k => k.open);
        const dates = klines.map(k => k.date);
        const stratFn = parseCustomStrategy(config);
        const raw = stratFn(closes, highs, lows, volumes, opens, dates);
        const sigs = raw.signals;
        const lastSig = sigs[sigs.length - 1];
        const prevSig = sigs[sigs.length - 2];
        if (lastSig !== 0 && lastSig !== prevSig) {
          const name = await getStockName(code);
          const quote = await getRealtimeQuotes([code]).catch(() => []);
          return {
            code, name,
            price: quote[0]?.price || closes[closes.length - 1],
            signal: lastSig === 1 ? "BUY" : "SELL",
            signalType: lastSig,
            date: dates[dates.length - 1],
          };
        }
        return null;
      } catch (e) { return null; }
    }, 3);

    monitorCache.signals = results.filter(Boolean);
    monitorCache.lastCheck = new Date().toISOString();
    res.json({ stocks: codeList, signals: monitorCache.signals, lastCheck: monitorCache.lastCheck });
}));

router.get("/monitor/check", asyncHandler(async (req, res) => {
    if (!monitorCache.stocks.length) return res.json({ signals: [], message: "未启动监控" });
    const codeList = monitorCache.stocks;
    const config = monitorCache.config;

    const results = await batchWithLimit(codeList, async (code) => {
      try {
        const klines = await getKlineData(code, 5);
        if (klines.length < 2) return null;
        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const volumes = klines.map(k => k.volume);
        const opens = klines.map(k => k.open);
        const dates = klines.map(k => k.date);
        const stratFn = parseCustomStrategy(config);
        const raw = stratFn(closes, highs, lows, volumes, opens, dates);
        const sigs = raw.signals;
        const lastSig = sigs[sigs.length - 1];
        const prevSig = sigs[sigs.length - 2];
        if (lastSig !== 0 && lastSig !== prevSig) {
          const name = await getStockName(code);
          const quote = await getRealtimeQuotes([code]).catch(() => []);
          return {
            code, name,
            price: quote[0]?.price || closes[closes.length - 1],
            signal: lastSig === 1 ? "BUY" : "SELL",
            signalType: lastSig,
            date: dates[dates.length - 1],
            timestamp: new Date().toISOString(),
          };
        }
        return null;
      } catch (e) { return null; }
    }, 3);

    const newSignals = results.filter(Boolean);
    const oldKeys = new Set(monitorCache.signals.map(s => `${s.code}_${s.signal}_${s.date}`));
    const alerts = newSignals.filter(s => !oldKeys.has(`${s.code}_${s.signal}_${s.date}`));
    monitorCache.signals = newSignals;
    monitorCache.lastCheck = new Date().toISOString();
    res.json({ signals: newSignals, alerts, lastCheck: monitorCache.lastCheck, monitoredStocks: codeList.length });
}));

router.post("/monitor/stop", (req, res) => {
  monitorCache.stocks = [];
  monitorCache.signals = {};
  monitorCache.config = null;
  monitorCache.lastCheck = null;
  res.json({ status: "stopped" });
});

// ==================== 自动化纸交易 (模拟交易) ====================

router.get("/paper/status", (req, res) => {
  const pa = paperTradingManager.getState();
  const positions = Object.values(pa.positions);
  const totalMarketValue = positions.reduce((s, p) => s + p.shares * p.currentPrice, 0);
  const totalEquity = pa.balance + totalMarketValue;
  const totalReturn = +(((totalEquity - pa.initialCapital) / pa.initialCapital) * 100).toFixed(2);

  res.json({
    active: pa.active,
    balance: +pa.balance.toFixed(2),
    initialCapital: pa.initialCapital,
    totalEquity: +totalEquity.toFixed(2),
    totalReturn,
    positions,
    trades: pa.trades.slice(-20),
    config: pa.config,
    stocks: pa.stocks,
    startDate: pa.startDate,
    dailySnapshots: pa.dailySnapshots.slice(-60),
  });
});

router.post("/paper/start", asyncHandler(async (req, res) => {
    const { codes, config, initialCapital } = req.body;
    if (!codes || !config) return res.status(400).json({ error: "需要股票代码和策略配置" });
    const codeList = codes.split(",").filter(Boolean).slice(0, 10);

    state.paperAccount = {
      balance: initialCapital || 1000000,
      initialCapital: initialCapital || 1000000,
      positions: {},
      orders: [], trades: [], tradeId: 1,
      active: true, config, stocks: codeList,
      dailySnapshots: [],
      startDate: new Date().toISOString().slice(0, 10),
    };

    // 初始化: 获取所有持仓的当前价格
    for (const code of codeList) {
      try {
        const quotes = await getRealtimeQuotes([code]);
        const name = await getStockName(code);
        state.paperAccount.positions[code] = { code, name, shares: 0, avgCost: 0, currentPrice: quotes[0]?.price || 0 };
      } catch (e) {}
    }

    res.json({ status: "started", stocks: codeList, initialCapital: state.paperAccount.initialCapital });
}));

router.post("/paper/stop", (req, res) => {
  state.paperAccount.active = false;
  paperTradingManager.save();
  res.json({ status: "stopped", trades: state.paperAccount.trades.length });
});

router.post("/paper/tick", asyncHandler(async (req, res) => {
    if (!state.paperAccount.active) return res.json({ error: "纸交易未启动" });

    const events = [];
    const codeList = state.paperAccount.stocks;

    // 更新价格 & 检查信号
    for (const code of codeList) {
      try {
        const [klines, quotes] = await Promise.all([
          getKlineData(code, 120),
          getRealtimeQuotes([code]).catch(() => []),
        ]);

        if (klines.length < 60) continue;
        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const volumes = klines.map(k => k.volume);
        const opens = klines.map(k => k.open);
        const dates = klines.map(k => k.date);
        const price = quotes[0]?.price || closes[closes.length - 1];

        // 更新持仓价格
        if (state.paperAccount.positions[code]) {
          state.paperAccount.positions[code].currentPrice = price;
        }

        // 生成信号
        const stratFn = parseCustomStrategy(state.paperAccount.config);
        const raw = stratFn(closes, highs, lows, volumes, opens, dates);
        const sigs = raw.signals;
        const lastSig = sigs[sigs.length - 1];
        const prevSig = sigs[sigs.length - 2];

        if (lastSig !== 0 && lastSig !== prevSig) {
          const pos = state.paperAccount.positions[code];
          if (!pos) continue;

          if (lastSig === 1 && pos.shares === 0) {
            // 买入
            const buyAmount = state.paperAccount.balance * 0.95; // 单只最多95%仓位
            const shares = Math.floor(buyAmount / price / 100) * 100;
            if (shares >= 100) {
              const cost = shares * price;
              const comm = cost * 0.00026;
              state.paperAccount.balance -= cost + comm;
              pos.shares = shares;
              pos.avgCost = price;
              const trade = {
                id: state.paperAccount.tradeId++, code, name: pos.name,
                action: "BUY", price, shares, cost: cost + comm,
                date: dates[dates.length - 1], time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
              };
              state.paperAccount.trades.push(trade);
              paperTradingManager.save();
              events.push({ type: "TRADE", trade });
            }
          } else if (lastSig === -1 && pos.shares > 0) {
            // 卖出
            const proceeds = pos.shares * price;
            const comm = proceeds * 0.00126;
            const pnl = proceeds - pos.shares * pos.avgCost - comm;
            const pnlPct = +((pnl / (pos.shares * pos.avgCost)) * 100).toFixed(2);
            state.paperAccount.balance += proceeds - comm;
            const trade = {
              id: state.paperAccount.tradeId++, code, name: pos.name,
              action: "SELL", price, shares: pos.shares,
              cost: proceeds - comm, pnl: +pnl.toFixed(2), pnlPct,
              date: dates[dates.length - 1], time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
            };
            state.paperAccount.trades.push(trade);
            paperTradingManager.save();
            pos.shares = 0; pos.avgCost = 0;
            events.push({ type: "TRADE", trade });
          }
        }
      } catch (e) {}
    }

    // 日终快照
    const now = new Date();
    if (now.getHours() >= 15 && !state.paperAccount._snapshotToday) {
      state.paperAccount._snapshotToday = true;
      const posVals = Object.values(state.paperAccount.positions);
      const totalMkt = posVals.reduce((s, p) => s + p.shares * p.currentPrice, 0);
      const totalEq = state.paperAccount.balance + totalMkt;
      state.paperAccount.dailySnapshots.push({
        date: now.toISOString().slice(0, 10),
        equity: +totalEq.toFixed(2),
        balance: +state.paperAccount.balance.toFixed(2),
        marketValue: +totalMkt.toFixed(2),
      });
      paperTradingManager.save();
    }
    if (now.getHours() < 15) state.paperAccount._snapshotToday = false;

    res.json({ events, balance: +state.paperAccount.balance.toFixed(2), timestamp: new Date().toISOString() });
}));

router.post("/paper/reset", (req, res) => {
  paperTradingManager.reset();
  state.paperAccount = paperTradingManager.getState();
  res.json({ status: "reset" });
});

module.exports = router;

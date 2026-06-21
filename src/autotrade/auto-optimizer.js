// 自动优化器 — 参数网格搜索 + 自动回测调度 + 日报生成
const { getKlineData } = require("../data");
const backtest = require("./backtest");
const performance = require("./performance");
const { detectRegime } = require("./regime");
const tradeDB = require("../database/trades.db");
const fs = require("fs");
const path = require("path");

// ===== 参数网格搜索 =====

function buildGrid(paramRanges) {
  const keys = Object.keys(paramRanges);
  if (keys.length === 0) return [{}];
  const grids = [[]];
  for (const key of keys) {
    const values = paramRanges[key];
    const next = [];
    for (const combo of grids) {
      for (const v of values) {
        next.push({ ...combo, [key]: v });
      }
    }
    grids.length = 0;
    grids.push(...next);
  }
  return grids;
}

async function optimizeStrategy(strategyType, code, paramRanges, startDate, endDate) {
  const grids = buildGrid(paramRanges);
  const results = [];

  for (const params of grids) {
    // 修改 backtest 的默认配置来使用自定义参数
    const originalConfig = { ...backtest.positionSize };
    if (params.positionSize) backtest.positionSize = params.positionSize;

    const report = await backtest.runStrategy(strategyType, code, startDate, endDate);
    if (!report.error) {
      results.push({
        params: { ...params },
        totalReturn: report.summary.totalReturn,
        sharpeRatio: report.risk.sharpeRatio,
        maxDrawdownPct: report.risk.maxDrawdownPct,
        winRate: report.trades.winRate,
        profitFactor: report.trades.profitFactor,
        totalTrades: report.summary.totalTrades,
        grade: report.summary.grade,
      });
    }
    backtest.positionSize = originalConfig;
  }

  results.sort((a, b) => b.sharpeRatio - a.sharpeRatio || b.totalReturn - a.totalReturn);
  return {
    strategyType,
    code,
    startDate,
    endDate,
    totalCombinations: grids.length,
    tested: results.length,
    best: results[0] || null,
    top5: results.slice(0, 5),
    worst: results[results.length - 1] || null,
  };
}

// ===== 自动回测调度 =====

async function scheduledBacktest(strategyType, code, days = 60) {
  const endDate = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startDate = start.toISOString().slice(0, 10);

  const report = await backtest.runStrategy(strategyType, code, startDate, endDate);
  return {
    ...report,
    meta: { strategyType, code, startDate, endDate, runAt: new Date().toISOString() },
  };
}

async function backtestAllEnabled() {
  const strategies = tradeDB.all("SELECT * FROM strategies WHERE enabled=1");
  const results = [];
  for (const s of strategies) {
    const codes = s.config ? (JSON.parse(s.config).stockPool || ["515050"]) : ["515050"];
    for (const code of codes.slice(0, 3)) {
      const r = await scheduledBacktest(s.type, code, 120);
      results.push({ strategyId: s.id, strategyName: s.name, strategyType: s.type, code, ...r });
    }
  }
  return results;
}

// ===== 日报生成 =====

function generateDailyReport() {
  const today = new Date().toISOString().slice(0, 10);
  const equity = tradeDB.getEquity();
  const trades = tradeDB.all("SELECT * FROM trades WHERE date(created_at)=?", [today]);
  const orders = tradeDB.all("SELECT * FROM orders WHERE date(created_at)=?", [today]);
  const positions = tradeDB.all("SELECT * FROM positions WHERE quantity > 0");
  const dailyPnl = tradeDB.all("SELECT * FROM daily_pnl ORDER BY date DESC LIMIT 60");

  const equityCurve = dailyPnl.map(d => d.equity);
  if (equityCurve.length === 0) equityCurve.push(equity.initialCapital || 1000000);

  const perfReport = performance.fullReport(equityCurve, tradeDB.all("SELECT * FROM trades ORDER BY created_at"), equity.initialCapital || 1000000);

  const buyTrades = trades.filter(t => t.side === "buy");
  const sellTrades = trades.filter(t => t.side === "sell");
  const dayPnl = sellTrades.reduce((s, t) => s + (t.realized_pnl || 0), 0);

  return {
    date: today,
    generatedAt: new Date().toISOString(),
    account: equity,
    daySummary: {
      buys: buyTrades.length,
      sells: sellTrades.length,
      orders: orders.length,
      realizedPnl: +dayPnl.toFixed(2),
    },
    positions: positions.map(p => ({
      code: p.code, name: p.name, quantity: p.quantity,
      avgCost: p.avg_cost, currentPrice: p.current_price,
      marketValue: p.market_value, unrealizedPnl: p.unrealized_pnl,
      pnlPct: p.avg_cost > 0 ? +((p.current_price - p.avg_cost) / p.avg_cost * 100).toFixed(2) : 0,
    })),
    performance: {
      totalReturn: perfReport.summary.totalReturn,
      sharpeRatio: perfReport.risk.sharpeRatio,
      maxDrawdownPct: perfReport.risk.maxDrawdownPct,
      winRate: perfReport.trades.winRate,
      profitFactor: perfReport.trades.profitFactor,
      grade: perfReport.summary.grade,
    },
    recentTrades: trades.slice(-20),
  };
}

function saveDailyReport(report) {
  const dir = path.join(require("../data-dir").getDataDir(), "reports");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `report_${report.date}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(report, null, 2), "utf8");
  return path.join(dir, filename);
}

// ===== 策略健康检查 =====

async function strategyHealthCheck() {
  const strategies = tradeDB.all("SELECT * FROM strategies WHERE enabled=1");
  const warnings = [];

  for (const s of strategies) {
    const config = s.config ? JSON.parse(s.config) : {};
    const codes = config.stockPool || ["515050"];

    for (const code of codes.slice(0, 2)) {
      const bt = await scheduledBacktest(s.type, code, 60);
      if (bt.error) continue;

      if (bt.summary.totalReturn < -10) {
        warnings.push({
          strategyId: s.id, strategyName: s.name, code,
          severity: "high",
          message: `${s.name}(${code}) 近60日回测收益 ${bt.summary.totalReturn}%，建议停用或调整参数`,
        });
      } else if (bt.risk.sharpeRatio < -0.5) {
        warnings.push({
          strategyId: s.id, strategyName: s.name, code,
          severity: "medium",
          message: `${s.name}(${code}) Sharpe ${bt.risk.sharpeRatio}，策略表现不佳`,
        });
      }

      if (bt.summary.totalTrades < 2) {
        warnings.push({
          strategyId: s.id, strategyName: s.name, code,
          severity: "low",
          message: `${s.name}(${code}) 近60日仅${bt.summary.totalTrades}笔交易，信号过少`,
        });
      }
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    totalStrategies: strategies.length,
    warnings,
    healthy: warnings.filter(w => w.severity === "high").length === 0,
  };
}

module.exports = {
  buildGrid,
  optimizeStrategy,
  scheduledBacktest,
  backtestAllEnabled,
  generateDailyReport,
  saveDailyReport,
  strategyHealthCheck,
};

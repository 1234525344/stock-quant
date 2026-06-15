/**
 * 因子 IC 数据导出 — 供 Python 因子研究管线使用
 *
 * 用法: node scripts/export-factor-ic.js [--days 250] [--pool-size 50]
 * 输出: data/factor_research/factor_ic.json
 *
 * 输出格式 (Python factor_loader.load_from_json 可直接解析):
 * {
 *   "factors": { "mom12_1": [[stock_dates...]], ... },   // 每个因子的 IC 时间序列
 *   "factor_meta": { "mom12_1": {"meanIC": 0.04, "icir": 0.5}, ... },
 *   "dates": ["2024-01-02", ...],
 *   "stocks": ["000001", ...]
 * }
 */

const path = require("path");
const fs = require("fs");

const { STOCK_POOL } = require("../src/state");
const { getKlineData, batchWithLimit } = require("../src/data");
const { computeFactorReturns, factorICStats, DEFAULT_FACTOR_WEIGHTS } = require("../src/factors");

const OUTPUT_DIR = path.join(__dirname, "..", "data", "factor_research");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "factor_ic.json");

async function main() {
  const args = process.argv.slice(2);
  const days = parseInt(args[args.indexOf("--days") + 1] || "250");
  const poolSize = parseInt(args[args.indexOf("--pool-size") + 1] || "50");

  console.log(`[export] Fetching ${poolSize} stocks × ${days} days of kline data...`);

  const pool = STOCK_POOL.slice(0, poolSize);

  // Fetch kline data for each stock in the pool
  const batchData = await batchWithLimit(pool, async (code) => {
    try {
      const klines = await getKlineData(code, days);
      if (klines && klines.length >= 60) return { code, klines };
      return null;
    } catch (e) { return null; }
  }, 5);

  const allStocksData = batchData.filter(Boolean);
  console.log(`[export] ${allStocksData.length}/${pool.length} stocks valid`);

  if (allStocksData.length < 5) {
    console.error("[export] Not enough valid stocks. Aborting.");
    process.exit(1);
  }

  // Compute factor IC time series
  const lookback = Math.min(days - 1, 60); // up to 60 trading days of IC
  console.log(`[export] Computing factor IC series (${lookback} day window)...`);
  const factorReturns = computeFactorReturns(allStocksData, lookback);

  if (!factorReturns || factorReturns.length < 10) {
    console.error("[export] Not enough IC data points. Aborting.");
    process.exit(1);
  }

  // Compute factor stats
  const icStats = factorICStats(factorReturns);

  // Pivot from [{date, mom12_1, mom6, ...}] to {mom12_1: [ic1, ic2, ...], ...}
  const factorNames = Object.keys(DEFAULT_FACTOR_WEIGHTS);
  const factors = {};
  for (const name of factorNames) {
    factors[name] = factorReturns.map(r => r[name] ?? null);
  }

  const dates = factorReturns.map(r => r.date);
  const stocks = allStocksData.map(s => s.code);

  const output = {
    factors,
    factor_meta: icStats,
    dates,
    stocks,
    metadata: {
      generated: new Date().toISOString(),
      n_factors: factorNames.length,
      n_dates: dates.length,
      n_stocks: stocks.length,
      lookback,
      description: "Cross-sectional factor IC time series exported from factors.js",
    },
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`[export] Saved ${Object.keys(factors).length} factors × ${dates.length} days → ${OUTPUT_FILE}`);

  // Print factor quality summary
  console.log("\nFactor Performance (mean IC / ICIR):");
  const sorted = Object.entries(icStats)
    .filter(([name]) => name !== "composite")
    .sort((a, b) => Math.abs(b[1].meanIC) - Math.abs(a[1].meanIC));
  for (const [name, stat] of sorted.slice(0, 10)) {
    const sign = stat.meanIC > 0 ? "+" : "";
    console.log(`  ${name.padEnd(14)} ${sign}${stat.meanIC.toFixed(3)}  IR=${stat.icir.toFixed(3)}  (+${stat.positiveRate}%)`);
  }
}

main().catch(e => {
  console.error("[export] Error:", e.message);
  process.exit(1);
});

// 数据交叉验证模块 — 多源价格校验
// 对比新浪/腾讯/东方财富/TDX等数据源的收盘价，发现异常时告警
// v1.0

const { logger } = require("./logger");

// ============ 工具函数 ============

/**
 * 计算数值数组的中位数
 */
function median(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ============ 1. crossCheckPrice ============

/**
 * 对比多个数据源的收盘/当前价格，返回中位数和质量分
 *
 * @param {string} code - 股票代码
 * @param {Array<{source: string, price: number}>} sources -
 *   各数据源的价格数据，至少包含 source 和 price 字段
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.01] - 偏离阈值 (1%)
 * @returns {{ canonicalPrice: number, quality: number, warnings: string[] }}
 */
function crossCheckPrice(code, sources, opts = {}) {
  const threshold = opts.threshold ?? 0.01;

  if (!Array.isArray(sources) || sources.length === 0) {
    return { canonicalPrice: 0, quality: 0, warnings: ["no sources provided"] };
  }

  // 过滤无效价格
  const valid = sources.filter(s => s && typeof s.price === "number" && s.price > 0);
  if (valid.length === 0) {
    return { canonicalPrice: 0, quality: 0, warnings: ["all sources have invalid price"] };
  }

  const prices = valid.map(s => s.price);
  const med = median(prices);

  // 质量分: 有多少源在阈值内
  const warnings = [];
  let agreeCount = 0;

  for (const s of valid) {
    const diff = med > 0 ? Math.abs(s.price - med) / med : 0;
    if (diff <= threshold) {
      agreeCount++;
    } else {
      const msg = `[${code}] ${s.source} price ${s.price} deviates ${(diff * 100).toFixed(2)}% from median ${med.toFixed(2)}`;
      logger.warn(msg);
      warnings.push(msg);
    }
  }

  return {
    canonicalPrice: med,
    quality: +(agreeCount / valid.length).toFixed(2),
    warnings,
  };
}

// ============ 2. crossCheckKlines ============

/**
 * 对比两组K线数据，按日期匹配后检查收盘价偏差
 *
 * @param {Array<{date: string, close: number}>} klinesA
 * @param {Array<{date: string, close: number}>} klinesB
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.01] - 偏离阈值
 * @returns {{ mismatches: Array<{date, closeA, closeB, diff}>, agreement: number, total: number }}
 */
function crossCheckKlines(klinesA, klinesB, opts = {}) {
  const threshold = opts.threshold ?? 0.01;

  if (!Array.isArray(klinesA) || !Array.isArray(klinesB)) {
    return { mismatches: [], agreement: 0, total: 0 };
  }

  // 按日期建索引
  const mapB = new Map();
  for (const k of klinesB) {
    if (k && k.date) mapB.set(k.date, k);
  }

  const mismatches = [];
  let matched = 0;

  for (const ka of klinesA) {
    if (!ka || !ka.date) continue;
    const kb = mapB.get(ka.date);
    if (!kb) continue;

    matched++;
    const a = ka.close;
    const b = kb.close;
    if (a <= 0 || b <= 0) continue;

    const diff = Math.abs(a - b) / Math.min(a, b);
    if (diff > threshold) {
      mismatches.push({
        date: ka.date,
        closeA: a,
        closeB: b,
        diff: +(diff * 100).toFixed(2),
      });
    }
  }

  const agreement = matched > 0 ? +((matched - mismatches.length) / matched).toFixed(4) : 0;

  return { mismatches, agreement, total: matched };
}

// ============ 3. fetchWithCrossCheck ============

/**
 * 从主源+备源拉取K线，交叉验证后返回可信数据
 *
 * 数据源优先级:
 *   Primary: TDX本地 → 腾讯
 *   Fallback: 东方财富
 *
 * @param {string} code - 股票代码
 * @param {number} [days=60] - 天数
 * @returns {Promise<{data: Array, source: string, quality: number, mismatches: Array}>}
 */
async function fetchWithCrossCheck(code, days = 60) {
  const { getKlineData, getKlineEastMoney } = require("./data");

  // ---- 拉取主源 ----
  let primaryData = [];
  let primarySource = "unknown";

  // 尝试 TDX 本地
  try {
    const { getTDXKline } = require("./tdx-reader");
    const tdx = getTDXKline(code, days);
    if (tdx && tdx.length > 0) {
      primaryData = tdx;
      primarySource = "tdx_local";
    }
  } catch (_) {}

  // TDX 不可用则用腾讯
  if (primaryData.length === 0) {
    try {
      const qq = await getKlineData(code, days);
      if (qq && qq.length > 0) {
        primaryData = qq;
        primarySource = "tencent";
      }
    } catch (_) {}
  }

  // ---- 拉取备源 (东方财富) ----
  let fallbackData = [];
  try {
    fallbackData = await getKlineEastMoney(code, days);
  } catch (_) {}

  // ---- 只有主源, 无法交叉验证 ----
  if (primaryData.length === 0 && fallbackData.length === 0) {
    logger.warn(`[crossCheck] ${code}: no data from any source`);
    return { data: [], source: "none", quality: 0, mismatches: [] };
  }

  if (primaryData.length === 0) {
    return { data: fallbackData, source: "eastmoney", quality: 0.5, mismatches: [] };
  }

  if (fallbackData.length === 0) {
    return { data: primaryData, source: primarySource, quality: 0.5, mismatches: [] };
  }

  // ---- 交叉验证 ----
  const result = crossCheckKlines(primaryData, fallbackData);

  // 记录差异
  if (result.mismatches.length > 0) {
    const pct = (result.mismatches.length / result.total * 100).toFixed(1);
    logger.warn(
      `[crossCheck] ${code}: ${result.mismatches.length}/${result.total} bars (${pct}%) differ between ${primarySource} and eastmoney`
    );
    // 输出前3条差异明细
    for (const m of result.mismatches.slice(0, 3)) {
      logger.warn(`  ${m.date}: ${primarySource}=${m.closeA} eastmoney=${m.closeB} diff=${m.diff}%`);
    }
  }

  return {
    data: primaryData,
    source: primarySource,
    quality: result.agreement,
    mismatches: result.mismatches,
  };
}

module.exports = { crossCheckPrice, crossCheckKlines, fetchWithCrossCheck };

// 数据清洗 & 缺失补全
// 统一清洗 K 线数据: NaN/零值/负值过滤、日期排序去重、交易日补全

const { logger } = require("./logger");

// A 股交易日历 (2024-2026 简化版, 按需扩展)
// 实际使用时可从 API 或文件加载
const TRADING_HOURS = { open: "09:30", close: "15:00" };

/**
 * 清洗 K 线数组
 * - 过滤无效数据 (NaN, 零价, 负价, 缺字段)
 * - 按日期升序排序
 * - 去除重复日期 (保留最后一条)
 * @param {Array} klines - [{date, open, high, low, close, volume}, ...]
 * @returns {Array} 清洗后的 K 线
 */
function sanitizeKlines(klines) {
  if (!Array.isArray(klines) || klines.length === 0) return [];

  // 1. 过滤无效数据
  const valid = klines.filter(k => {
    if (!k || !k.date) return false;
    if (k.close == null || isNaN(k.close) || k.close <= 0) return false;
    if (k.open != null && (isNaN(k.open) || k.open < 0)) return false;
    if (k.high != null && (isNaN(k.high) || k.high < 0)) return false;
    if (k.low != null && (isNaN(k.low) || k.low < 0)) return false;
    if (k.volume != null && isNaN(k.volume)) return false;
    return true;
  });

  if (valid.length === 0) return [];

  // 2. 按日期排序
  valid.sort((a, b) => {
    const da = typeof a.date === "string" ? a.date : String(a.date);
    const db = typeof b.date === "string" ? b.date : String(b.date);
    return da.localeCompare(db);
  });

  // 3. 去重 (保留每日期最后一条)
  const deduped = new Map();
  for (const k of valid) {
    deduped.set(k.date, k);
  }
  const result = [...deduped.values()];

  if (result.length < klines.length) {
    logger.debug(`[data-sanitizer] 清洗: ${klines.length} → ${result.length} 条 (过滤 ${klines.length - result.length} 条无效/重复)`);
  }

  return result;
}

/**
 * 检测并标记缺失的交易日
 * @param {Array} klines - 已清洗的 K 线 (日期升序)
 * @returns {{ cleaned: Array, gaps: Array<{date, prevDate, nextDate}> }}
 */
function detectGaps(klines) {
  if (klines.length < 2) return { cleaned: klines, gaps: [] };

  const gaps = [];
  for (let i = 1; i < klines.length; i++) {
    const prev = parseDate(klines[i - 1].date);
    const curr = parseDate(klines[i].date);
    if (!prev || !curr) continue;

    const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
    // A 股正常间隔: 1 天 (T+1), 周末 2-3 天, 节假日最多 ~10 天
    // 超过 10 个自然日视为异常缺失
    if (diffDays > 10) {
      gaps.push({
        date: klines[i].date,
        prevDate: klines[i - 1].date,
        missingDays: Math.floor(diffDays) - getWeekendDays(prev, curr),
      });
    }
  }

  return { cleaned: klines, gaps };
}

/**
 * 补全缺失交易日 (用前一日数据填充, 标记 interpolated)
 * @param {Array} klines - 已清洗的 K 线
 * @param {number} maxGapDays - 最大补全天数 (超过则跳过)
 * @returns {Array} 补全后的 K 线
 */
function fillGaps(klines, maxGapDays = 5) {
  if (klines.length < 2) return klines;

  const filled = [klines[0]];
  for (let i = 1; i < klines.length; i++) {
    const prev = parseDate(klines[i - 1].date);
    const curr = parseDate(klines[i].date);
    if (!prev || !curr) { filled.push(klines[i]); continue; }

    const diffDays = Math.floor((curr - prev) / (1000 * 60 * 60 * 24));
    if (diffDays > 1 && diffDays <= maxGapDays + 5) {
      // 在 prev 和 curr 之间插入交易日
      for (let d = 1; d < diffDays; d++) {
        const fillDate = new Date(prev.getTime() + d * 86400000);
        if (isWeekend(fillDate)) continue;
        filled.push({
          ...klines[i - 1],
          date: formatDate(fillDate),
          interpolated: true,
          volume: 0, // 补全日成交量为 0
        });
      }
    }
    filled.push(klines[i]);
  }

  const interpCount = filled.filter(k => k.interpolated).length;
  if (interpCount > 0) {
    logger.info(`[data-sanitizer] 补全 ${interpCount} 个交易日 (标记 interpolated)`);
  }
  return filled;
}

/**
 * 完整清洗管道: sanitize → detectGaps → fillGaps
 * @param {Array} klines - 原始 K 线
 * @param {Object} opts
 * @param {boolean} opts.fillGaps - 是否补全缺失日 (默认 true)
 * @param {number} opts.maxGapDays - 最大补全天数 (默认 5)
 * @returns {{ klines: Array, gaps: Array, stats: Object }}
 */
function cleanPipeline(klines, opts = {}) {
  const { fillGaps: shouldFill = true, maxGapDays = 5 } = opts;
  const before = klines.length;

  const sanitized = sanitizeKlines(klines);
  const { cleaned, gaps } = detectGaps(sanitized);
  const result = shouldFill ? fillGaps(cleaned, maxGapDays) : cleaned;

  const stats = {
    input: before,
    afterSanitize: sanitized.length,
    afterFill: result.length,
    removed: before - sanitized.length,
    gaps: gaps.length,
    interpolated: result.filter(k => k.interpolated).length,
  };

  return { klines: result, gaps, stats };
}

// ============ 辅助函数 ============

function parseDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr);
  // 支持 "2024-01-15", "20240115", "2024/01/15"
  const m = s.match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function getWeekendDays(start, end) {
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    if (isWeekend(d)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

module.exports = { sanitizeKlines, detectGaps, fillGaps, cleanPipeline };

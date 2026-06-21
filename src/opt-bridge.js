// 期权行情桥接 — 调用 Python akshare → 返回 JSON
const { execPython } = require("./python-bin");
const path = require("path");

const SCRIPT = path.join(__dirname, "opt-bridge.py");

function _exec(mode, extraArgs = []) {
  return execPython(SCRIPT, [mode, ...extraArgs], { timeout: 15000, maxBuffer: 4 * 1024 * 1024, expectJson: true }).then(data => data || []);
}

/** 获取50ETF期权实时行情 (批量，默认模式) */
function getOptionQuotes(codes) {
  if (!codes || codes.length === 0) return Promise.resolve([]);
  return _exec('quotes', [codes.join(",")]).then(data =>
    data.map(q => ({
      code: q.code,
      name: q.name || q.code,
      price: q.price || 0,
      open: q.open || 0,
      high: q.high || 0,
      low: q.low || 0,
      preClose: q.preClose || 0,
      volume: q.volume || 0,
      amount: q.amount || 0,
      buy: q.buy || 0,
      sell: q.sell || 0,
      strike: q.strike || 0,
      change: q.price && q.preClose ? +(((q.price - q.preClose) / q.preClose) * 100).toFixed(2) : 0,
      changePercent: q.price && q.preClose ? +(((q.price - q.preClose) / q.preClose) * 100).toFixed(2) : 0,
      changeAmount: q.price && q.preClose ? +(q.price - q.preClose).toFixed(2) : 0,
      source: "akshare",
    }))
  );
}

/** 获取上交所期权合约基本信息 (所有到期月份) */
function getOptionInfo() {
  return _exec('info');
}

/** 获取单合约实时分钟行情 */
function getOptionMinute(symbol) {
  if (!symbol) return Promise.resolve([]);
  return _exec('minute', [symbol]);
}

/** 获取单合约日线历史行情 */
function getOptionDaily(symbol) {
  if (!symbol) return Promise.resolve([]);
  return _exec('daily', [symbol]);
}

module.exports = { getOptionQuotes, getOptionInfo, getOptionMinute, getOptionDaily };

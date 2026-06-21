// TDX 行情桥接 — 调用 Python pytdx → 返回 JSON
const { execPython } = require("./python-bin");
const path = require("path");

const SCRIPT = path.join(__dirname, "tdx-bridge.py");

/** 通过 TDX TCP 获取实时行情 (pytdx) */
function getTdxQuotes(codes) {
  return new Promise((resolve) => {
    if (!codes || codes.length === 0) return resolve([]);
    execPython(SCRIPT, [codes.join(",")], { timeout: 8000, maxBuffer: 1024 * 1024, expectJson: true }).then(data => {
      if (!data || !Array.isArray(data)) return resolve([]);
      // 转换为统一格式
      const results = data.map(q => ({
        code: q.code,
        name: q.name || "",
        price: q.price || 0,
        open: q.open || 0,
        high: q.high || 0,
        low: q.low || 0,
        preClose: q.preClose || 0,
        volume: q.volume || 0,
        amount: q.amount || 0,
        change: q.price && q.preClose ? +(((q.price - q.preClose) / q.preClose) * 100).toFixed(2) : 0,
        changePercent: q.price && q.preClose ? +(((q.price - q.preClose) / q.preClose) * 100).toFixed(2) : 0,
        changeAmount: q.price && q.preClose ? +(q.price - q.preClose).toFixed(2) : 0,
      }));
      resolve(results);
    });
  });
}

module.exports = { getTdxQuotes };

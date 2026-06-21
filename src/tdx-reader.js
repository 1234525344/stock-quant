// 通达信本地数据文件读取器
// 解析 .day 日线 (32字节/条) 和 .lc5 分时线
// 支持文件监控实时推送增量更新

const fs = require("fs");
const path = require("path");

// 通达信安装目录候选
const TDX_CANDIDATE_DIRS = [
  "C:\\new_tdx64",
  "C:\\new_tdx",
  "C:\\zd_zsone",
  "D:\\new_tdx64",
  "D:\\new_tdx",
  "D:\\zd_zsone",
  "C:\\Program Files\\new_tdx",
];

let TDX_ROOT = null;

function detectTDXRoot() {
  // TDX_ROOT 环境变量优先 (Docker/Linux 部署)
  if (process.env.TDX_ROOT && fs.existsSync(process.env.TDX_ROOT)) {
    return process.env.TDX_ROOT;
  }
  for (const dir of TDX_CANDIDATE_DIRS) {
    // vipdoc exists if TDX has downloaded data; otherwise check signature files
    const vipdoc = path.join(dir, "vipdoc");
    const tdxExe = path.join(dir, "TdxW.exe");
    const connectCfg = path.join(dir, "connect.cfg");
    if (fs.existsSync(vipdoc) || fs.existsSync(tdxExe) || fs.existsSync(connectCfg)) {
      return dir;
    }
  }
  return null;
}

function getTDXRoot() {
  if (!TDX_ROOT) {
    TDX_ROOT = detectTDXRoot();
  }
  return TDX_ROOT;
}

function toTDXSymbol(code) {
  // 8位期权代码 (上海期权 1000xxxx)
  if (code.length === 8 && code.startsWith("1")) return { market: "ot", tdxCode: `ot${code}` };
  if (code.startsWith("6") || code.startsWith("5") || code.startsWith("9")) return { market: "sh", tdxCode: `sh${code}` };
  return { market: "sz", tdxCode: `sz${code}` };
}

// ==================== 日线 .day 文件解析 ====================
// .day 文件格式: 每条记录 32 字节, little-endian
// struct {
//   int32 date;      // YYYYMMDD
//   int32 open;      // 开盘价 * 100
//   int32 high;      // 最高价 * 100
//   int32 low;       // 最低价 * 100
//   int32 close;     // 收盘价 * 100
//   float amount;    // 成交额 (元)
//   int32 volume;    // 成交量 (股)
//   int32 reserved;  // 保留
// }

function readDayFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const records = [];
    const recordSize = 32;
    for (let offset = 0; offset + recordSize <= buf.length; offset += recordSize) {
      const date = buf.readInt32LE(offset);
      const open = buf.readInt32LE(offset + 4) / 100;
      const high = buf.readInt32LE(offset + 8) / 100;
      const low = buf.readInt32LE(offset + 12) / 100;
      const close = buf.readInt32LE(offset + 16) / 100;
      const amount = buf.readFloatLE(offset + 20);
      const volume = buf.readInt32LE(offset + 24);

      // 过滤无效数据 (全0或负价格)
      if (open <= 0 || close <= 0) continue;
      if (date < 19900101 || date > 20991231) continue;

      records.push({
        date: `${String(date).slice(0, 4)}-${String(date).slice(4, 6)}-${String(date).slice(6, 8)}`,
        open, close, high, low, volume, amount: +amount.toFixed(0),
      });
    }
    return records;
  } catch (e) {
    return [];
  }
}

// 只读最后N条记录 (快速)
function readDayFileTail(filePath, n = 250) {
  try {
    const stat = fs.statSync(filePath);
    const recordSize = 32;
    const totalRecords = Math.floor(stat.size / recordSize);
    if (totalRecords === 0) return [];

    const startOffset = Math.max(0, (totalRecords - n) * recordSize);
    const readLen = Math.min(n, totalRecords) * recordSize;

    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(readLen);
    fs.readSync(fd, buf, 0, readLen, startOffset);
    fs.closeSync(fd);

    const records = [];
    for (let offset = 0; offset + recordSize <= buf.length; offset += recordSize) {
      const date = buf.readInt32LE(offset);
      const open = buf.readInt32LE(offset + 4) / 100;
      const high = buf.readInt32LE(offset + 8) / 100;
      const low = buf.readInt32LE(offset + 12) / 100;
      const close = buf.readInt32LE(offset + 16) / 100;
      const amount = buf.readFloatLE(offset + 20);
      const volume = buf.readInt32LE(offset + 24);

      if (open <= 0 || close <= 0) continue;
      if (date < 19900101 || date > 20991231) continue;

      records.push({
        date: `${String(date).slice(0, 4)}-${String(date).slice(4, 6)}-${String(date).slice(6, 8)}`,
        open, close, high, low, volume, amount: +amount.toFixed(0),
      });
    }
    return records;
  } catch (e) {
    return [];
  }
}

// ==================== 分时线 .lc5 文件解析 ====================
// .lc5 文件格式与 .day 相同 (32字节/条)

function readMinuteFile(filePath, n = 240) {
  return readDayFileTail(filePath, n);
}

// ==================== 通达信K线获取 ====================

function getTDXKline(code, days = 365) {
  const root = getTDXRoot();
  if (!root) return [];

  const { market } = toTDXSymbol(code);
  const filePath = path.join(root, "vipdoc", market, "lday", `${market}${code}.day`);

  if (!fs.existsSync(filePath)) return [];

  if (days <= 250) {
    return readDayFileTail(filePath, days);
  }
  return readDayFile(filePath);
}

function getTDXMinute(code, count = 240) {
  const root = getTDXRoot();
  if (!root) return [];

  const { market } = toTDXSymbol(code);
  const filePath = path.join(root, "vipdoc", market, "minline", `${market}${code}.lc5`);

  if (!fs.existsSync(filePath)) return [];
  return readMinuteFile(filePath, count);
}

// ==================== 实时文件监控 ====================

const fileWatchers = new Map();

function watchTDXFile(code, onUpdate) {
  const root = getTDXRoot();
  if (!root) return false;

  const { market } = toTDXSymbol(code);
  const filePath = path.join(root, "vipdoc", market, "lday", `${market}${code}.day`);

  if (!fs.existsSync(filePath)) return false;

  const key = `${market}${code}`;
  if (fileWatchers.has(key)) {
    fileWatchers.get(key).close();
  }

  try {
    const watcher = fs.watch(filePath, (eventType) => {
      if (eventType === "change") {
        const records = readDayFileTail(filePath, 1);
        if (records.length > 0) {
          const latest = records[records.length - 1];
          const { market: mkt } = toTDXSymbol(code);
          const minutePath = path.join(root, "vipdoc", mkt, "minline", `${mkt}${code}.lc5`);
          let minutePrice = null;
          if (fs.existsSync(minutePath)) {
            const mins = readMinuteFile(minutePath, 1);
            if (mins.length > 0) {
              minutePrice = mins[mins.length - 1].close;
            }
          }
          onUpdate({
            code,
            price: minutePrice || latest.close,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,  // 日线收盘价
            volume: latest.volume,
            amount: latest.amount,
            time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
            source: "tdx_file",
          });
        }
      }
    });

    fileWatchers.set(key, watcher);
    return true;
  } catch (e) {
    return false;
  }
}

function unwatchAll() {
  for (const [key, watcher] of fileWatchers) {
    try { watcher.close(); } catch (e) {}
    fileWatchers.delete(key);
  }
}

// ==================== 批量行情快照 (从最近K线推断) ====================

function getTDXSnapshot(codes) {
  const root = getTDXRoot();
  if (!root) return [];

  const results = [];
  for (const code of codes) {
    const { market } = toTDXSymbol(code);
    const filePath = path.join(root, "vipdoc", market, "lday", `${market}${code}.day`);

    if (!fs.existsSync(filePath)) continue;

    const tail = readDayFileTail(filePath, 2);
    if (tail.length === 0) continue;

    const last = tail[tail.length - 1];
    const prev = tail.length >= 2 ? tail[tail.length - 2] : null;

    // 尝试读取分时数据获取最新价
    const minutePath = path.join(root, "vipdoc", market, "minline", `${market}${code}.lc5`);
    let minutePrice = null;
    if (fs.existsSync(minutePath)) {
      const mins = readMinuteFile(minutePath, 1);
      if (mins.length > 0) {
        minutePrice = mins[mins.length - 1].close;
      }
    }

    results.push({
      code,
      name: "", // TDX本地文件不含名称, 需要从别处获取
      price: minutePrice || last.close,
      open: last.open,
      high: last.high,
      low: last.low,
      preClose: prev ? prev.close : last.open,
      volume: last.volume,
      amount: last.amount,
      change: prev ? +((last.close - prev.close) / prev.close * 100).toFixed(2) : null,
      changeAmount: prev ? +(last.close - prev.close).toFixed(2) : null,
      source: "tdx_file",
    });
  }
  return results;
}

module.exports = {
  detectTDXRoot, getTDXRoot, getTDXKline, getTDXMinute,
  watchTDXFile, unwatchAll, getTDXSnapshot, readDayFileTail,
};

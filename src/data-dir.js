// 统一数据目录解析
// Electron (打包): 使用 process.env.DATA_DIR (由 electron-main.js 设置)
// 普通 Node.js: 使用项目根目录下的 data/
const path = require("path");
const fs = require("fs");

let _dataDir = null;

function getDataDir() {
  if (_dataDir) return _dataDir;

  // Electron 打包环境: electron-main.js 通过环境变量传入
  if (process.env.DATA_DIR) {
    _dataDir = process.env.DATA_DIR;
  } else if (__dirname.includes(".asar")) {
    // 运行在 asar 中但 DATA_DIR 未设置 -> 使用 exe 旁的可写目录
    _dataDir = path.join(path.dirname(process.resourcesPath || process.cwd()), "data");
  } else {
    // 普通 Node.js 环境: 项目根目录下的 data/
    _dataDir = path.join(__dirname, "..", "data");
  }

  // 确保目录存在
  try {
    if (!fs.existsSync(_dataDir)) {
      fs.mkdirSync(_dataDir, { recursive: true });
    }
  } catch (e) {
    // 回退到临时目录
    _dataDir = path.join(require("os").tmpdir(), "stock-quant-data");
    if (!fs.existsSync(_dataDir)) fs.mkdirSync(_dataDir, { recursive: true });
  }
  return _dataDir;
}

module.exports = { getDataDir };

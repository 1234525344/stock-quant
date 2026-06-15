// 生产级日志系统
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  constructor(options = {}) {
    const levelKey = options.level || process.env.LOG_LEVEL || "info";
    this.level = LOG_LEVELS[levelKey] != null ? LOG_LEVELS[levelKey] : 1;
    this.toFile = options.toFile !== false;
    this.toConsole = options.toConsole !== false;
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;
    this.currentFile = null;
    this.fileSize = 0;

    // 异步写入缓冲
    this._writeQueue = [];
    this._flushTimer = null;
    this._flushing = false;

    if (this.toFile) {
      this._initLogFile();
    }
  }

  _initLogFile() {
    try {
      if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
      }
      const date = new Date().toISOString().slice(0, 10);
      this.currentFile = path.join(LOG_DIR, `app-${date}.log`);
      if (fs.existsSync(this.currentFile)) {
        this.fileSize = fs.statSync(this.currentFile).size;
      }
    } catch (e) {
      console.warn("[Logger] 初始化日志文件失败:", e.message);
    }
  }

  _rotateFile() {
    if (!this.currentFile || this.fileSize < this.maxFileSize) return;

    try {
      // 删除最旧的日志文件
      const files = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith("app-") && f.endsWith(".log"))
        .sort()
        .slice(0, -this.maxFiles);

      for (const file of files) {
        fs.unlinkSync(path.join(LOG_DIR, file));
      }

      // 创建新日志文件
      const date = new Date().toISOString().slice(0, 10);
      this.currentFile = path.join(LOG_DIR, `app-${date}.log`);
      this.fileSize = 0;
    } catch (e) {
      console.warn("[Logger] 日志轮转失败:", e.message);
    }
  }

  _format(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const log = {
      timestamp,
      level,
      message,
      ...meta,
    };
    return JSON.stringify(log);
  }

  _write(level, message, meta) {
    if (LOG_LEVELS[level] < this.level) return;

    const formatted = this._format(level, message, meta);

    if (this.toConsole) {
      const color = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" };
      console.log(`${color[level] || ""}[${level.toUpperCase()}]\x1b[0m ${message}`);
    }

    if (this.toFile && this.currentFile) {
      this._enqueueWrite(formatted);
    }
  }

  _enqueueWrite(formatted) {
    this._rotateFile();
    this._writeQueue.push(formatted);
    this.fileSize += formatted.length + 1;

    // 满50条立即刷盘, 否则100ms后批量刷
    if (this._writeQueue.length >= 50) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
      this._flush();
    } else if (!this._flushTimer && !this._flushing) {
      this._flushTimer = setTimeout(() => this._flush(), 100);
    }
  }

  async _flush() {
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
    if (this._writeQueue.length === 0 || !this.currentFile) return;
    const batch = this._writeQueue.splice(0).join("\n") + "\n";
    this._flushing = true;
    try {
      await fs.promises.appendFile(this.currentFile, batch, "utf8");
    } catch (e) {
      // 降级: 同步写入 (避免丢失关键日志)
      try { fs.appendFileSync(this.currentFile, batch); } catch (_) {}
    }
    this._flushing = false;
  }

  // 同步刷盘 (SIGINT/exit 时调用)
  flushSync() {
    if (this._flushTimer) { clearTimeout(this._flushTimer); this._flushTimer = null; }
    if (this._writeQueue.length > 0 && this.currentFile) {
      const batch = this._writeQueue.splice(0).join("\n") + "\n";
      try { fs.appendFileSync(this.currentFile, batch); } catch (_) {}
    }
  }

  debug(message, meta) {
    this._write("debug", message, meta);
  }

  info(message, meta) {
    this._write("info", message, meta);
  }

  warn(message, meta) {
    this._write("warn", message, meta);
  }

  error(message, meta) {
    this._write("error", message, meta);
  }

  // 创建子日志器（带前缀）
  child(prefix) {
    const parent = this;
    return {
      debug: (msg, meta) => parent.debug(`[${prefix}] ${msg}`, meta),
      info: (msg, meta) => parent.info(`[${prefix}] ${msg}`, meta),
      warn: (msg, meta) => parent.warn(`[${prefix}] ${msg}`, meta),
      error: (msg, meta) => parent.error(`[${prefix}] ${msg}`, meta),
    };
  }
}

// 单例
const logger = new Logger();

module.exports = { Logger, logger };

// 交易数据库 — better-sqlite3 持久化（磁盘直写，原子事务）
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { logger } = require("../logger");

class TradeDB {
  constructor() {
    this.db = null;
    this.ready = false;
  }

  init() {
    if (this.ready) return;
    const dataDir = path.join(__dirname, "../..", "data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const dbPath = path.join(dataDir, "trades.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this._createTables();
    this.ready = true;
    logger.info("[TradeDB] better-sqlite3 初始化完成 (WAL)");
    return this;
  }

  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT,
        enabled INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        name TEXT,
        side TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL,
        order_type TEXT DEFAULT 'limit',
        status TEXT DEFAULT 'pending',
        filled_qty INTEGER DEFAULT 0,
        filled_price REAL,
        strategy_id TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS positions (
        code TEXT PRIMARY KEY,
        name TEXT,
        quantity INTEGER NOT NULL,
        avg_cost REAL NOT NULL,
        current_price REAL,
        market_value REAL,
        unrealized_pnl REAL,
        realized_pnl REAL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT,
        code TEXT NOT NULL,
        name TEXT,
        side TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        amount REAL NOT NULL,
        fee REAL DEFAULT 0,
        strategy_id TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS account (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS daily_pnl (
        date TEXT PRIMARY KEY,
        pnl REAL,
        pnl_pct REAL,
        equity REAL,
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now','localtime'))
      );
    `);
    // 初始化默认设置
    this._initDefaults();
  }

  _initDefaults() {
    const defaults = {
      initial_capital: "100000",
      wxpusher_appToken: "",
      wxpusher_uids: "[]",
      notify_on_trade: "true",
      notify_on_daily: "true",
      auto_stock_pick: "true",
      stock_pool: "[]",
      risk_per_trade: "2",
      max_positions: "5",
    };
    for (const [key, value] of Object.entries(defaults)) {
      const existing = this.get("SELECT value FROM settings WHERE key=?", [key]);
      if (!existing) {
        this.run("INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
      }
    }
  }

  run(sql, params = []) {
    try {
      const stmt = this.db.prepare(sql);
      const info = stmt.run(params);
      return { success: true, changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  get(sql, params = []) {
    try {
      return this.db.prepare(sql).get(params) || null;
    } catch (e) {
      return null;
    }
  }

  all(sql, params = []) {
    try {
      return this.db.prepare(sql).all(params);
    } catch (e) {
      return [];
    }
  }

  getAccount() {
    const rows = this.all("SELECT key, value FROM account");
    const acc = { cash: 1000000 };
    for (const r of rows) {
      acc[r.key] = isNaN(parseFloat(r.value)) ? r.value : parseFloat(r.value);
    }
    return acc;
  }

  setAccount(key, value) {
    const existing = this.get("SELECT value FROM account WHERE key=?", [key]);
    if (existing) {
      this.run("UPDATE account SET value=? WHERE key=?", [String(value), key]);
    } else {
      this.run("INSERT INTO account (key, value) VALUES (?, ?)", [key, String(value)]);
    }
  }

  getEquity() {
    const acc = this.getAccount();
    const pos = this.all("SELECT * FROM positions WHERE quantity > 0");
    let marketValue = 0;
    for (const p of pos) {
      marketValue += (p.market_value || 0);
    }
    return {
      cash: acc.cash || 0,
      marketValue,
      totalEquity: (acc.cash || 0) + marketValue,
      initialCapital: acc.initial_capital || 1000000,
    };
  }

  // ========== 设置管理 ==========
  getSettings() {
    const rows = this.all("SELECT key, value FROM settings");
    const settings = {};
    for (const r of rows) {
      // 尝试解析 JSON 值
      try { settings[r.key] = JSON.parse(r.value); } catch { settings[r.key] = r.value; }
    }
    return settings;
  }

  getSetting(key, defaultVal = null) {
    const row = this.get("SELECT value FROM settings WHERE key=?", [key]);
    if (!row) return defaultVal;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  setSetting(key, value) {
    const strVal = typeof value === "string" ? value : JSON.stringify(value);
    const existing = this.get("SELECT value FROM settings WHERE key=?", [key]);
    if (existing) {
      this.run("UPDATE settings SET value=?, updated_at=datetime('now','localtime') WHERE key=?", [strVal, key]);
    } else {
      this.run("INSERT INTO settings (key, value) VALUES (?, ?)", [key, strVal]);
    }
  }

  setSettings(obj) {
    for (const [key, value] of Object.entries(obj)) {
      this.setSetting(key, value);
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.ready = false;
    }
  }
}

module.exports = new TradeDB();

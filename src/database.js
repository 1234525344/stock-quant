// SQLite 数据库模块 (基于 sql.js)
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "stock-quant.db");

class Database {
  constructor() {
    this.db = null;
    this.ready = this.init();
  }

  async init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const SQL = await initSqlJs();

      if (fs.existsSync(DB_FILE)) {
        const buffer = fs.readFileSync(DB_FILE);
        this.db = new SQL.Database(buffer);
        console.log("[数据库] SQLite 已加载:", DB_FILE);
      } else {
        this.db = new SQL.Database();
        console.log("[数据库] SQLite 已创建:", DB_FILE);
      }

      this.createTables();
      this.save();
    } catch (e) {
      console.error("[数据库] 初始化失败:", e.message);
      throw e;
    }
  }

  createTables() {
    // 交易记录表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id TEXT UNIQUE,
        code TEXT NOT NULL,
        name TEXT,
        action TEXT NOT NULL CHECK(action IN ('buy', 'sell')),
        price REAL NOT NULL CHECK(price > 0),
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        amount REAL NOT NULL CHECK(amount > 0),
        commission REAL DEFAULT 0 CHECK(commission >= 0),
        timestamp TEXT DEFAULT (datetime('now', 'localtime')),
        strategy TEXT,
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);

    // 每日快照表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS daily_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE NOT NULL,
        balance REAL NOT NULL,
        positions TEXT DEFAULT '{}',
        total_value REAL NOT NULL,
        pnl REAL DEFAULT 0,
        pnl_pct REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);

    // 策略配置表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS strategies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        config TEXT DEFAULT '{}',
        active INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);

    // 告警记录表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        read INTEGER DEFAULT 0
      )
    `);

    // 性能监控表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lcp INTEGER,
        fid INTEGER,
        cls REAL,
        ttfb INTEGER,
        url TEXT,
        user_agent TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);

    // 创建索引
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_trades_code ON trades(code)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_trades_action ON trades(action)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_date ON daily_snapshots(date)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_strategies_name ON strategies(name)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_code ON alerts(code)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(read)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_performance_created ON performance(created_at)`);
  }

  save() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_FILE, buffer);
    } catch (e) {
      console.warn("[数据库] 保存失败:", e.message);
    }
  }

  // ============ 交易记录 ============
  insertTrade(trade) {
    this.db.run(
      `INSERT INTO trades (trade_id, code, name, action, price, quantity, amount, commission, strategy, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trade.tradeId || `T${Date.now()}`,
        trade.code,
        trade.name || "",
        trade.action,
        trade.price,
        trade.quantity,
        trade.amount,
        trade.commission || 0,
        trade.strategy || "",
        trade.reason || "",
      ]
    );
    this.save();
  }

  getTrades({ code, limit = 100, offset = 0 } = {}) {
    let sql = "SELECT * FROM trades";
    const params = [];
    if (code) {
      sql += " WHERE code = ?";
      params.push(code);
    }
    sql += " ORDER BY timestamp DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const result = this.db.exec(sql, params);
    if (!result.length) return [];
    return result[0].values.map((row) => ({
      id: row[0],
      tradeId: row[1],
      code: row[2],
      name: row[3],
      action: row[4],
      price: row[5],
      quantity: row[6],
      amount: row[7],
      commission: row[8],
      timestamp: row[9],
      strategy: row[10],
      reason: row[11],
    }));
  }

  getTradeStats() {
    const result = this.db.exec(`
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN action = 'buy' THEN amount ELSE 0 END) as total_buy,
        SUM(CASE WHEN action = 'sell' THEN amount ELSE 0 END) as total_sell,
        SUM(commission) as total_commission
      FROM trades
    `);
    if (!result.length) return { totalTrades: 0, totalBuy: 0, totalSell: 0, totalCommission: 0 };
    const row = result[0].values[0];
    return {
      totalTrades: row[0],
      totalBuy: row[1],
      totalSell: row[2],
      totalCommission: row[3],
    };
  }

  // ============ 每日快照 ============
  insertSnapshot(snapshot) {
    this.db.run(
      `INSERT OR REPLACE INTO daily_snapshots (date, balance, positions, total_value, pnl, pnl_pct)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        snapshot.date,
        snapshot.balance,
        JSON.stringify(snapshot.positions || {}),
        snapshot.totalValue,
        snapshot.pnl,
        snapshot.pnlPct,
      ]
    );
    this.save();
  }

  getSnapshots({ days = 30 } = {}) {
    const result = this.db.exec(
      `SELECT * FROM daily_snapshots ORDER BY date DESC LIMIT ?`,
      [days]
    );
    if (!result.length) return [];
    return result[0].values.map((row) => ({
      date: row[1],
      balance: row[2],
      positions: JSON.parse(row[3] || "{}"),
      totalValue: row[4],
      pnl: row[5],
      pnlPct: row[6],
    }));
  }

  // ============ 策略配置 ============
  saveStrategy(name, config, active = false) {
    this.db.run(
      `INSERT OR REPLACE INTO strategies (name, config, active, updated_at)
       VALUES (?, ?, ?, datetime('now', 'localtime'))`,
      [name, JSON.stringify(config), active ? 1 : 0]
    );
    this.save();
  }

  getStrategies() {
    const result = this.db.exec("SELECT * FROM strategies ORDER BY name");
    if (!result.length) return [];
    return result[0].values.map((row) => ({
      id: row[0],
      name: row[1],
      config: JSON.parse(row[2] || "{}"),
      active: row[3] === 1,
      createdAt: row[4],
      updatedAt: row[5],
    }));
  }

  // ============ 告警记录 ============
  insertAlert(alert) {
    this.db.run(
      `INSERT INTO alerts (code, type, message, data) VALUES (?, ?, ?, ?)`,
      [alert.code, alert.type, alert.message, JSON.stringify(alert.data || {})]
    );
    this.save();
  }

  getAlerts({ limit = 50, unreadOnly = false } = {}) {
    let sql = "SELECT * FROM alerts";
    if (unreadOnly) sql += " WHERE read = 0";
    sql += " ORDER BY created_at DESC LIMIT ?";

    const result = this.db.exec(sql, [limit]);
    if (!result.length) return [];
    return result[0].values.map((row) => ({
      id: row[0],
      code: row[1],
      type: row[2],
      message: row[3],
      data: JSON.parse(row[4] || "{}"),
      createdAt: row[5],
      read: row[6] === 1,
    }));
  }

  markAlertRead(id) {
    this.db.run("UPDATE alerts SET read = 1 WHERE id = ?", [id]);
    this.save();
  }

  // ============ 性能监控 ============
  insertPerformance(data) {
    this.db.run(
      `INSERT INTO performance (lcp, fid, cls, ttfb, url, user_agent) VALUES (?, ?, ?, ?, ?, ?)`,
      [data.lcp, data.fid, data.cls, data.ttfb, data.url, data.userAgent]
    );
    this.save();
  }

  getPerformanceStats() {
    const result = this.db.exec(`
      SELECT
        AVG(lcp) as avg_lcp,
        AVG(fid) as avg_fid,
        AVG(cls) as avg_cls,
        AVG(ttfb) as avg_ttfb,
        COUNT(*) as total_samples
      FROM performance
      WHERE created_at > datetime('now', '-7 days')
    `);
    if (!result.length) return null;
    const row = result[0].values[0];
    return {
      avgLcp: Math.round(row[0] || 0),
      avgFid: Math.round(row[1] || 0),
      avgCls: Math.round((row[2] || 0) * 1000) / 1000,
      avgTtfb: Math.round(row[3] || 0),
      totalSamples: row[4],
    };
  }

  // ============ 数据清理 ============
  cleanup({ days = 90 } = {}) {
    const safeDays = Math.max(1, Math.min(365, parseInt(days) || 90));
    const tables = [
      { name: "trades", column: "timestamp" },
      { name: "alerts", column: "created_at" },
      { name: "performance", column: "created_at" },
    ];

    for (const { name, column } of tables) {
      this.db.run(
        `DELETE FROM ${name} WHERE ${column} < datetime('now', ?)`,
        [`-${safeDays} days`]
      );
    }
    this.save();
    console.log(`[数据库] 已清理 ${safeDays} 天前的数据`);
  }

  // ============ 数据库维护 ============
  vacuum() {
    this.db.run("VACUUM");
    console.log("[数据库] VACUUM 完成");
  }

  getStats() {
    const tables = ["trades", "daily_snapshots", "strategies", "alerts", "performance"];
    const stats = {};
    for (const table of tables) {
      const result = this.db.exec(`SELECT COUNT(*) FROM ${table}`);
      stats[table] = result.length ? result[0].values[0][0] : 0;
    }
    return stats;
  }

  close() {
    this.save();
    if (this.db) this.db.close();
  }
}

// 单例
const database = new Database();

module.exports = database;

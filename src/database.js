// SQLite 数据库模块 (基于 sql.js)
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const { logger } = require("./logger");

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
        logger.info("[数据库] SQLite 已加载:", DB_FILE);
      } else {
        this.db = new SQL.Database();
        logger.info("[数据库] SQLite 已创建:", DB_FILE);
      }

      this.createTables();
      this.save();
    } catch (e) {
      logger.error("[数据库] 初始化失败:", e.message);
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

    // 自选股分组表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS watchlist_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);

    // 自选股表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        name TEXT,
        type TEXT DEFAULT 'stock',
        quantity INTEGER DEFAULT 0,
        direction INTEGER DEFAULT 1,
        group_id INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        added_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(code, group_id)
      )
    `);

    // 新闻缓存表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS news_cache (
        hash TEXT PRIMARY KEY,
        title TEXT,
        summary TEXT,
        source TEXT,
        url TEXT,
        published_at TEXT,
        sentiment REAL DEFAULT 0,
        sectors TEXT DEFAULT '[]',
        impact TEXT,
        conclusion TEXT,
        related_codes TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_news_created ON news_cache(created_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_news_sentiment ON news_cache(sentiment)`);

      // 尝试添加列 (兼容旧表)
    try { this.db.run("ALTER TABLE watchlist ADD COLUMN last_price REAL DEFAULT 0"); } catch(e) {}
    try { this.db.run("ALTER TABLE watchlist ADD COLUMN last_preclose REAL DEFAULT 0"); } catch(e) {}

    // 每日收益快照表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS daily_pnl (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        group_id INTEGER NOT NULL,
        group_name TEXT,
        stock_pnl REAL DEFAULT 0,
        option_pnl REAL DEFAULT 0,
        total_pnl REAL DEFAULT 0,
        stock_count INTEGER DEFAULT 0,
        option_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(date, group_id)
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_daily_pnl_date ON daily_pnl(date)`);

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
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_watchlist_code ON watchlist(code)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_watchlist_group ON watchlist(group_id)`);

  }

  save() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_FILE, buffer);
    } catch (e) {
      logger.warn("[数据库] 保存失败:", e.message);
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

  // ============ 新闻缓存 ============
  insertNewsItems(items) {
    for (const item of items) {
      this.db.run(
        `INSERT OR REPLACE INTO news_cache
         (hash, title, summary, source, url, published_at, sentiment, sectors, impact, conclusion, related_codes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.hash, item.title || '', item.summary || '', item.source || '',
         item.url || '', item.publishedAt || '', item.sentiment || 0,
         JSON.stringify(item.sectors || []), item.impact || '',
         item.conclusion || '', JSON.stringify(item.relatedCodes || [])]
      );
    }
    this.save();
  }

  getRecentNews(limit = 500) {
    const result = this.db.exec(
      "SELECT * FROM news_cache ORDER BY created_at DESC LIMIT ?", [limit]
    );
    if (!result.length || !result[0].values.length) return [];
    return result[0].values.map(row => ({
      hash: row[0], title: row[1], summary: row[2], source: row[3],
      url: row[4], publishedAt: row[5], sentiment: row[6],
      sectors: JSON.parse(row[7] || '[]'),
      impact: row[8], conclusion: row[9],
      relatedCodes: JSON.parse(row[10] || '[]'),
    }));
  }

  pruneNewsCache(keep = 2000) {
    this.db.run("DELETE FROM news_cache WHERE hash NOT IN (SELECT hash FROM news_cache ORDER BY created_at DESC LIMIT ?)", [keep]);
    this.save();
  }

  // ============ 每日收益快照 ============
  saveDailyPnl(date, groupId, groupName, stockPnl, optionPnl, totalPnl, stockCount, optionCount) {
    this.db.run(
      `INSERT OR REPLACE INTO daily_pnl (date, group_id, group_name, stock_pnl, option_pnl, total_pnl, stock_count, option_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, groupId, groupName, stockPnl, optionPnl, totalPnl, stockCount, optionCount]
    );
    this.save();
  }

  getMonthlyPnl(yearMonth) {
    const result = this.db.exec(
      "SELECT date, group_id, group_name, stock_pnl, option_pnl, total_pnl, stock_count, option_count FROM daily_pnl WHERE date LIKE ? ORDER BY date, group_id",
      [yearMonth + '%']
    );
    if (!result.length || !result[0].values.length) return [];
    return result[0].values.map(row => ({
      date: row[0], group_id: row[1], group_name: row[2],
      stock_pnl: row[3], option_pnl: row[4], total_pnl: row[5],
      stock_count: row[6], option_count: row[7]
    }));
  }

  // ============ 自选股分组 ============
  getWatchlistGroups() {
    const result = this.db.exec("SELECT * FROM watchlist_groups ORDER BY sort_order");
    if (!result.length || !result[0].values.length) return [];
    return result[0].values.map(row => ({
      id: row[0], name: row[1], sort_order: row[2], created_at: row[3]
    }));
  }

  createWatchlistGroup(name) {
    this.db.run("INSERT INTO watchlist_groups (name) VALUES (?)", [name]);
    this.save();
    const result = this.db.exec("SELECT last_insert_rowid()");
    return result[0]?.values[0]?.[0] || 0;
  }

  deleteWatchlistGroup(id) {
    this.db.run("DELETE FROM watchlist WHERE group_id = ?", [id]);
    const result = this.db.exec("DELETE FROM watchlist_groups WHERE id = ?", [id]);
    this.save();
    return this.db.getRowsModified();
  }

  // ============ 自选股 CRUD ============
  getWatchlistItems(groupId) {
    let sql = "SELECT id, code, name, type, quantity, direction, group_id, sort_order, added_at, COALESCE(last_price,0), COALESCE(last_preclose,0) FROM watchlist";
    const params = [];
    if (groupId) {
      sql += " WHERE group_id = ?";
      params.push(groupId);
    }
    sql += " ORDER BY sort_order, added_at";
    const result = this.db.exec(sql, params);
    if (!result.length || !result[0].values.length) return [];
    return result[0].values.map(row => ({
      id: row[0], code: row[1], name: row[2], type: row[3],
      quantity: row[4], direction: row[5], group_id: row[6],
      sort_order: row[7], added_at: row[8], last_price: row[9] || 0,
      last_preclose: row[10] || 0
    }));
  }

  updateWatchlistPrice(code, price) {
    this.db.run("UPDATE watchlist SET last_price = ? WHERE code = ?", [price, code]);
    this.save();
    return this.db.getRowsModified();
  }

  updateWatchlistPreClose(code, preClose) {
    this.db.run("UPDATE watchlist SET last_preclose = ? WHERE code = ?", [preClose, code]);
    this.save();
    return this.db.getRowsModified();
  }

  addWatchlistItem({ code, name, type, quantity, direction, groupId }) {
    this.db.run(
      `INSERT OR REPLACE INTO watchlist (code, name, type, quantity, direction, group_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, name || code, type || "stock", quantity || 0, direction || 1, groupId || 1]
    );
    this.save();
    const result = this.db.exec("SELECT last_insert_rowid()");
    return result[0]?.values[0]?.[0] || 0;
  }

  deleteWatchlistItem(code) {
    const result = this.db.exec("DELETE FROM watchlist WHERE code = ?", [code]);
    this.save();
    return this.db.getRowsModified();
  }

  updateWatchlistItem(code, fields) {
    const updates = [];
    const params = [];
    if (fields.quantity !== undefined) { updates.push("quantity = ?"); params.push(fields.quantity); }
    if (fields.direction !== undefined) { updates.push("direction = ?"); params.push(fields.direction); }
    if (fields.group_id !== undefined) { updates.push("group_id = ?"); params.push(fields.group_id); }
    if (updates.length === 0) return 0;
    params.push(code);
    this.db.run(`UPDATE watchlist SET ${updates.join(", ")} WHERE code = ?`, params);
    this.save();
    return this.db.getRowsModified();
  }

  updateWatchlistSort(codes) {
    let updated = 0;
    for (let i = 0; i < codes.length; i++) {
      this.db.run("UPDATE watchlist SET sort_order = ? WHERE code = ?", [i, codes[i]]);
      updated += this.db.getRowsModified();
    }
    this.save();
    return updated;
  }

  clearWatchlist() {
    this.db.run("DELETE FROM watchlist");
    this.save();
    return this.db.getRowsModified();
  }

  // ============ 数据清理 ============
  cleanup({ days = 90 } = {}) {
    const safeDays = Math.max(1, Math.min(365, parseInt(days) || 90));
    const tables = [
      { name: "trades", column: "timestamp" },
      { name: "alerts", column: "created_at" },
    ];

    for (const { name, column } of tables) {
      this.db.run(
        `DELETE FROM ${name} WHERE ${column} < datetime('now', ?)`,
        [`-${safeDays} days`]
      );
    }
    this.save();
    logger.info(`[数据库] 已清理 ${safeDays} 天前的数据`);
  }

  // ============ 数据库维护 ============
  vacuum() {
    this.db.run("VACUUM");
    logger.info("[数据库] VACUUM 完成");
  }

  getStats() {
    const tables = ["trades", "daily_snapshots", "strategies", "alerts"];
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

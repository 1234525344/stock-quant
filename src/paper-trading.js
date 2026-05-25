const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_FILE = path.join(DATA_DIR, "paper-state.json");

// 默认状态
const DEFAULT_STATE = {
  balance: 1000000,
  initialCapital: 1000000,
  positions: {},
  orders: [],
  trades: [],
  tradeId: 1,
  active: false,
  config: null,
  stocks: [],
  dailySnapshots: [],
  startDate: null,
};

class PaperTradingManager {
  constructor() {
    this.state = { ...DEFAULT_STATE };
    this.db = null;
    this.load();
    this.initDB();
  }

  async initDB() {
    try {
      this.db = require("./database");
      await this.db.ready;
      console.log("[模拟交易] SQLite 数据库已连接");
    } catch (e) {
      console.warn("[模拟交易] SQLite 不可用，使用 JSON 文件:", e.message);
    }
  }

  /**
   * 从文件加载状态
   */
  load() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const data = fs.readFileSync(STATE_FILE, "utf8");
        const saved = JSON.parse(data);
        this.state = { ...DEFAULT_STATE, ...saved };
        console.log("[模拟交易] 状态已恢复");
      }
    } catch (e) {
      console.warn("[模拟交易] 状态加载失败:", e.message);
    }
  }

  /**
   * 保存状态到文件
   */
  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.warn("[模拟交易] 状态保存失败:", e.message);
    }
  }

  /**
   * 获取当前状态
   */
  getState() {
    return this.state;
  }

  /**
   * 更新状态
   */
  updateState(newState) {
    this.state = { ...this.state, ...newState };
    this.save();
  }

  /**
   * 记录交易到 SQLite
   */
  recordTrade(trade) {
    if (this.db) {
      try {
        this.db.insertTrade(trade);
      } catch (e) {
        console.warn("[模拟交易] SQLite 记录失败:", e.message);
      }
    }
    // 同时保存到内存状态
    this.state.trades.push(trade);
    this.save();
  }

  /**
   * 保存每日快照到 SQLite
   */
  saveSnapshot(snapshot) {
    if (this.db) {
      try {
        this.db.insertSnapshot(snapshot);
      } catch (e) {
        console.warn("[模拟交易] SQLite 快照失败:", e.message);
      }
    }
    this.state.dailySnapshots.push(snapshot);
    this.save();
  }

  /**
   * 获取交易历史（优先从 SQLite）
   */
  getTrades(options) {
    if (this.db) {
      try {
        return this.db.getTrades(options);
      } catch (e) {
        console.warn("[模拟交易] SQLite 查询失败:", e.message);
      }
    }
    return this.state.trades.slice().reverse().slice(0, options?.limit || 100);
  }

  /**
   * 获取交易统计
   */
  getTradeStats() {
    if (this.db) {
      try {
        return this.db.getTradeStats();
      } catch (e) {
        console.warn("[模拟交易] SQLite 统计失败:", e.message);
      }
    }
    const trades = this.state.trades;
    return {
      totalTrades: trades.length,
      totalBuy: trades.filter((t) => t.action === "buy").reduce((s, t) => s + t.amount, 0),
      totalSell: trades.filter((t) => t.action === "sell").reduce((s, t) => s + t.amount, 0),
      totalCommission: trades.reduce((s, t) => s + (t.commission || 0), 0),
    };
  }

  /**
   * 获取历史快照（优先从 SQLite）
   */
  getSnapshots(options) {
    if (this.db) {
      try {
        return this.db.getSnapshots(options);
      } catch (e) {
        console.warn("[模拟交易] SQLite 快照查询失败:", e.message);
      }
    }
    return this.state.dailySnapshots.slice(-(options?.days || 30));
  }

  /**
   * 重置状态
   */
  reset() {
    this.state = { ...DEFAULT_STATE };
    this.save();
  }

  /**
   * 序列化为JSON
   */
  toJSON() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * 从JSON恢复
   */
  fromJSON(data) {
    this.state = { ...DEFAULT_STATE, ...data };
    this.save();
  }
}

module.exports = { PaperTradingManager };

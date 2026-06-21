// 自动交易引擎 v3 — 自适应市场状态 + 动态仓位 + 自动日报
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const { logger } = require("../logger");
const tradeDB = require("../database/trades.db");
const paperBroker = require("./paper-broker");
const { StrategyEngine, STRATEGY_TYPES } = require("./strategy");
const { RiskManager } = require("./risk-manager");
const { getRealtimeQuotes, getKlineData } = require("../data");
const { STOCK_POOL } = require("../state");
const { isTradingHours } = require("../helpers");
const { detectRegime, getSuggestedStrategy, REGIMES } = require("./regime");
const { generateDailyReport, saveDailyReport, strategyHealthCheck } = require("./auto-optimizer");
const { getWxPusherConfig, sendWxPusher, formatTradeMessage, formatDailySummary } = require("../services/notify");

// 不同市场状态下的仓位系数
const REGIME_POSITION_FACTOR = {
  bull: 1.0,      // 牛市满仓
  range: 0.8,     // 震荡8成
  volatile: 0.5,  // 高波半仓
  bear: 0.2,      // 熊市2成(几乎空仓)
};

class AutoTradeEngine extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.wss = null;
    this.strategies = new Map();
    this.strategyEngine = new StrategyEngine();
    this.riskManager = new RiskManager();
    this._timer = null;
    this._tickInterval = 10000;
    this._dailyResetDone = null;
    this._cooldowns = new Map();
    this._cooldownMs = 300000;
    this._tradeCount = 0;
    this._logPath = null;

    // v3 新增：市场状态自适应
    this._currentRegime = null;
    this._regimeCheckedAt = null;
    this._regimeCheckInterval = 300000; // 每5分钟检查市场状态
    this._lastRegimeCheck = 0;
    this._dailyReportGenerated = null;

    // v4 新增：策略集成投票 + Kelly仓位
    this._ensembleMode = false;
    this._kellyParams = new Map(); // strategyId -> { winRate, avgWin, avgLoss }
  }

  async start(wsServer) {
    await tradeDB.init();
    this.wss = wsServer || null;
    this._logPath = path.join(require("../data-dir").getDataDir(), "trades.log");
    this._loadStrategies();

    if (!tradeDB.getAccount().initial_capital) {
      tradeDB.setAccount("initial_capital", 1000000);
      tradeDB.setAccount("cash", 1000000);
    }
    this.running = true;
    this._log("INFO", "引擎启动 v3 (自适应市场状态)");
    this._broadcast({ type: "autotrade_status", running: true, version: 3 });
    this.emit("status", { running: true });
    // 通知监控股票列表
    this._notifyEngineStart();
    this._tick();
  }

  stop() {
    this.running = false;
    if (this._timer) clearTimeout(this._timer);
    this._log("INFO", "引擎已停止");
    this._broadcast({ type: "autotrade_status", running: false });
    this.emit("status", { running: false });
  }

  _loadStrategies() {
    const rows = tradeDB.all("SELECT * FROM strategies WHERE enabled=1");
    for (const r of rows) {
      r.config = r.config ? JSON.parse(r.config) : {};
      this.strategies.set(r.id, r);
    }
    if (rows.length === 0) {
      tradeDB.run("INSERT INTO strategies (id, name, type, config, enabled) VALUES (?,?,?,?,0)",
        ["default_signal", "默认信号跟随", "signal_follow", JSON.stringify(STRATEGY_TYPES.signal_follow.defaultConfig)]);
    }
  }

  // ===== 策略管理 =====

  createStrategy(name, type, config = {}) {
    if (!STRATEGY_TYPES[type]) return { success: false, error: "未知策略类型" };
    const id = `STG_${Date.now()}`;
    const merged = { ...STRATEGY_TYPES[type].defaultConfig, ...config };
    tradeDB.run("INSERT INTO strategies (id, name, type, config, enabled) VALUES (?,?,?,?,0)",
      [id, name, type, JSON.stringify(merged)]);
    this.strategies.set(id, { id, name, type, config: merged, enabled: 0 });
    return { success: true, id };
  }

  enableStrategy(id) {
    tradeDB.run("UPDATE strategies SET enabled=1 WHERE id=?", [id]);
    const s = tradeDB.get("SELECT * FROM strategies WHERE id=?", [id]);
    if (s) { s.config = s.config ? JSON.parse(s.config) : {}; this.strategies.set(id, s); }
    return { success: true };
  }

  disableStrategy(id) {
    tradeDB.run("UPDATE strategies SET enabled=0 WHERE id=?", [id]);
    this.strategies.delete(id);
    return { success: true };
  }

  deleteStrategy(id) {
    tradeDB.run("DELETE FROM strategies WHERE id=?", [id]);
    this.strategies.delete(id);
    return { success: true };
  }

  listStrategies() {
    return tradeDB.all("SELECT * FROM strategies").map(s => ({ ...s, config: s.config ? JSON.parse(s.config) : {} }));
  }

  // ===== 主循环 =====

  async _tick() {
    if (!this.running) return;
    try {
      if (isTradingHours()) {
        // 定期检查市场状态
        await this._checkRegime();
        await this._runStrategies();
      } else {
        // 盘后自动生成日报
        await this._autoDailyReport();
      }
      this._recordDailyPnl();
    } catch (e) {
      this._log("ERROR", "tick: " + e.message);
    }

    const interval = isTradingHours() ? 3000 : 30000;
    this._tickInterval = interval;
    this._timer = setTimeout(() => this._tick(), interval);
  }

  // ===== v3: 市场状态自适应 =====

  async _checkRegime() {
    const now = Date.now();
    if (now - this._lastRegimeCheck < this._regimeCheckInterval) return;
    this._lastRegimeCheck = now;

    try {
      const klines = await getKlineData("000001", 120).catch(() => []);
      if (klines.length < 60) return;
      const result = detectRegime(klines);
      const prevRegime = this._currentRegime;
      this._currentRegime = result;
      this._regimeCheckedAt = new Date().toISOString();

      if (prevRegime !== result.regime) {
        this._log("REGIME", `市场状态切换: ${prevRegime || "初始"} → ${result.regime} (置信度 ${result.confidence}%) 建议: ${result.suggestedStrategy}`);
        this._broadcast({
          type: "autotrade_regime",
          prev: prevRegime,
          current: result.regime,
          confidence: result.confidence,
          details: result.details,
          suggestedStrategy: result.suggestedStrategy,
        });
      }
    } catch (_) {}
  }

  _getRegimeFactor() {
    if (!this._currentRegime) return 1.0;
    return REGIME_POSITION_FACTOR[this._currentRegime.regime] || 1.0;
  }

  // ===== v3: 动态仓位计算 =====

  _calcDynamicPositionSize(baseSize, volatility, strategyId) {
    const regimeFactor = this._getRegimeFactor();
    // 高波动时进一步降低仓位
    let volAdjust = 1.0;
    if (volatility > 0.5) volAdjust = 0.5;
    else if (volatility > 0.35) volAdjust = 0.7;
    else if (volatility < 0.2) volAdjust = 1.2;

    // v4: Kelly 仓位调整 (如果有历史数据则用Kelly, 否则用默认)
    let kellyFactor = 1.0;
    const kp = this._kellyParams.get(strategyId);
    if (kp && kp.trades >= 5) {
      const kellySize = this.riskManager.calcKellyPosition(kp.winRate, kp.avgWin, kp.avgLoss);
      kellyFactor = kellySize / baseSize;
    }

    return Math.min(0.3, baseSize * regimeFactor * volAdjust * kellyFactor);
  }

  // ===== v4: 信号处理 (统一买入/卖出入口) =====

  async _processSignal(strategy, code, name, price, signal, volatility) {
    if (signal.action === "buy") {
      await this._handleBuySignal(strategy, code, name, price, signal, volatility);
    } else if (signal.action === "sell") {
      await this._handleSellSignal(strategy, code, name, price, signal);
    }
  }

  // ===== v4: 统一卖出 (供风控和信号共用) =====

  async _executeSell(pos, price, reason, strategyName) {
    const result = await paperBroker.sell(pos.code, pos.name, pos.quantity, price, "stop_condition");
    if (result.success) {
      // 记录盈亏用于Kelly
      if (result.realizedPnl !== undefined) {
        const strategyId = strategyName || "stop";
        const kp = this._kellyParams.get(strategyId) || { winRate: 0, avgWin: 0, avgLoss: 0, trades: 0 };
        kp.trades++;
        if (result.realizedPnl > 0) {
          kp.avgWin = (kp.avgWin * (kp.trades - 1) + result.realizedPnl) / kp.trades;
          this.riskManager.recordWin(strategyId);
        } else {
          kp.avgLoss = (kp.avgLoss * (kp.trades - 1) + Math.abs(result.realizedPnl || 0)) / kp.trades;
          const lossStatus = this.riskManager.recordLoss(strategyId);
          if (lossStatus.paused) {
            this._log("WARN", `策略 ${strategyId} 连续止损${lossStatus.count}次, 暂停${this.riskManager.config.pauseMinutes}分钟`);
          }
        }
        kp.winRate = kp.trades > 0 ? (kp.winRate * (kp.trades - 1) + (result.realizedPnl > 0 ? 100 : 0)) / kp.trades : 0;
        this._kellyParams.set(strategyId, kp);
      }

      this._setCooldown(pos.code);
      this._onTrade(result, reason, strategyName || "风控");
      this._log("TRADE", `风控卖出 ${pos.code} ${pos.name} ${pos.quantity}股 @${price} ${reason}`);
    }
    return result;
  }

  // ===== 策略执行 =====

  async _runStrategies() {
    const enabled = [...this.strategies.values()];
    if (enabled.length === 0) return;

    const allStocks = new Set();
    for (const s of enabled) {
      const codes = s.config?.stockPool || STOCK_POOL.slice(0, 20);
      codes.forEach(c => allStocks.add(c));
    }
    if (allStocks.size === 0) return;

    const quotes = await getRealtimeQuotes([...allStocks]).catch(() => []);
    if (quotes.length === 0) return;

    paperBroker.updatePositionPrices(quotes);

    // 止损止盈（不受冷却限制, 统一处理）
    const stopTriggers = this.riskManager.checkStopConditions();
    for (const trigger of stopTriggers) {
      const pos = tradeDB.get("SELECT * FROM positions WHERE code=? AND quantity>0", [trigger.code]);
      if (!pos) continue;
      const quote = quotes.find(q => q.code === trigger.code);
      if (!quote) continue;
      await this._executeSell(pos, quote.price, trigger.reason, "风控");
    }

    // 获取波动率用于动态仓位
    const volatility = this._currentRegime?.details?.volatility || 0.3;

    // v4: 策略集成投票 (≥2个策略启用时自动开启)
    this._ensembleMode = enabled.length >= 2;

    if (this._ensembleMode) {
      // 集成投票模式：多策略独立打分, ≥2/3一致才执行
      for (const code of [...allStocks]) {
        const quote = quotes.find(q => q.code === code);
        if (!quote || !quote.price) continue;

        const activeStrategies = enabled.filter(s => {
          if (this.riskManager.isPaused(s.id)) return false;
          const codes = s.config?.stockPool || [...allStocks];
          return codes.includes(code);
        });

        if (activeStrategies.length === 0) continue;

        // 检查策略暂停
        const pausedIds = new Set();
        for (const s of activeStrategies) {
          if (this.riskManager.isPaused(s.id)) pausedIds.add(s.id);
        }

        const voteCandidates = activeStrategies.filter(s => !pausedIds.has(s.id));
        if (voteCandidates.length < 2) {
          // 不够投票, 每个独立评估
          for (const strategy of voteCandidates) {
            const signal = await this.strategyEngine.evaluate(strategy, code, quote.price);
            await this._processSignal(strategy, code, signal.name || quote.name, quote.price, signal, volatility);
          }
          continue;
        }

        // 集成投票
        const vote = await this.strategyEngine.ensembleVote(voteCandidates, code, quote.price);
        const strategy = voteCandidates[0]; // 用第一个策略作为代表配置
        await this._processSignal(strategy, code, vote.name || quote.name, quote.price, vote, volatility);
      }
    } else {
      // 单策略模式
      for (const strategy of enabled) {
        if (this.riskManager.isPaused(strategy.id)) {
          const remaining = this.riskManager.getPauseRemaining(strategy.id);
          if (remaining % 30 === 0) { // 偶尔提醒
            this._broadcast({ type: "autotrade_paused", strategyId: strategy.id, reason: `连续止损暂停中, ${remaining}分钟后恢复` });
          }
          continue;
        }

        const codes = strategy.config?.stockPool || [...allStocks];
        for (const code of codes) {
          try {
            const quote = quotes.find(q => q.code === code);
            if (!quote || !quote.price) continue;

            const signal = await this.strategyEngine.evaluate(strategy, code, quote.price);
            await this._processSignal(strategy, code, signal.name || quote.name, quote.price, signal, volatility);
          } catch (stockErr) {}
        }
      }
    }
  }

  _inCooldown(code) {
    const last = this._cooldowns.get(code);
    if (!last) return false;
    return Date.now() - last < this._cooldownMs;
  }

  _setCooldown(code) {
    this._cooldowns.set(code, Date.now());
    if (this._cooldowns.size > 200) this._cooldowns.clear();
  }

  async _handleBuySignal(strategy, code, name, price, signal, volatility = 0.3) {
    if (this._inCooldown(code)) return;
    const pos = tradeDB.get("SELECT * FROM positions WHERE code=? AND quantity>0", [code]);
    if (pos) return;

    const equity = tradeDB.getEquity();
    const basePositionSize = strategy.config?.positionSize || 0.15;
    const positionSize = this._calcDynamicPositionSize(basePositionSize, volatility, strategy.id);

    // 熊市/高波时提高买入门槛
    const regime = this._currentRegime?.regime;
    if (regime === "bear") {
      this._broadcast({ type: "autotrade_rejected", code, name, action: "buy", reason: "熊市模式，暂停买入" });
      return;
    }
    if (regime === "volatile" && (signal.strength || 0) < 3) {
      this._broadcast({ type: "autotrade_rejected", code, name, action: "buy", reason: "高波模式，仅强信号买入" });
      return;
    }

    const buyAmount = equity.totalEquity * positionSize;
    const quantity = Math.floor(buyAmount / price / 100) * 100;
    if (quantity < 100) return;

    const riskCheck = this.riskManager.canBuy(code, quantity, price);
    if (!riskCheck.allowed) {
      this._broadcast({ type: "autotrade_rejected", code, name, action: "buy", reason: riskCheck.reason });
      return;
    }

    const result = await paperBroker.buy(code, name, quantity, price, strategy.id);
    if (result.success) {
      this._setCooldown(code);
      const regimeInfo = this._currentRegime ? ` [${this._currentRegime.regime}:${positionSize.toFixed(2)}]` : "";
      this._onTrade(result, signal.reason + regimeInfo, strategy.name);
      this._log("TRADE", `买入 ${code} ${name} ${quantity}股 @${price} 金额¥${result.amount.toFixed(2)} [${signal.reason}]${regimeInfo}`);
    }
  }

  async _handleSellSignal(strategy, code, name, price, signal) {
    if (this._inCooldown(code)) return;
    const pos = tradeDB.get("SELECT * FROM positions WHERE code=? AND quantity>0", [code]);
    if (!pos) return;

    const riskCheck = this.riskManager.canSell(code, pos.quantity);
    if (!riskCheck.allowed) return;

    const result = await paperBroker.sell(code, name, pos.quantity, price, strategy.id);
    if (result.success) {
      this._setCooldown(code);

      // v4: 记录盈亏用于Kelly
      if (result.realizedPnl !== undefined) {
        const kp = this._kellyParams.get(strategy.id) || { winRate: 0, avgWin: 0, avgLoss: 0, trades: 0 };
        kp.trades++;
        if (result.realizedPnl > 0) {
          kp.avgWin = kp.trades > 1 ? (kp.avgWin * (kp.trades - 1) + result.realizedPnl) / kp.trades : result.realizedPnl;
          this.riskManager.recordWin(strategy.id);
        } else {
          kp.avgLoss = kp.trades > 1 ? (kp.avgLoss * (kp.trades - 1) + Math.abs(result.realizedPnl || 0)) / kp.trades : Math.abs(result.realizedPnl || 0);
          const lossStatus = this.riskManager.recordLoss(strategy.id);
          if (lossStatus.paused) {
            this._log("WARN", `策略 ${strategy.name || strategy.id} 连续止损${lossStatus.count}次, 暂停${this.riskManager.config.pauseMinutes}分钟`);
            this._broadcast({ type: "autotrade_paused", strategyId: strategy.id, strategyName: strategy.name, reason: `连续${lossStatus.count}次止损, 暂停${this.riskManager.config.pauseMinutes}分钟` });
          }
        }
        kp.winRate = kp.trades > 0 ? ((kp.winRate * (kp.trades - 1) + (result.realizedPnl > 0 ? 100 : 0)) / kp.trades) : 0;
        this._kellyParams.set(strategy.id, kp);
      }

      this._onTrade(result, signal.reason, strategy.name);
      this._log("TRADE", `卖出 ${code} ${name} ${pos.quantity}股 @${price} 盈亏¥${result.realizedPnl?.toFixed(2) || 0} [${signal.reason}]`);
    }
  }

  _onTrade(result, reason, strategyName) {
    this._tradeCount++;
    const payload = {
      type: "autotrade_trade",
      ...result,
      reason,
      strategy: strategyName,
      regime: this._currentRegime?.regime || "unknown",
      timestamp: Date.now(),
    };
    this._broadcast(payload);
    this.emit("trade", payload);
    // 微信通知
    this._notifyTrade(result, strategyName);
  }

  async _notifyTrade(result, strategyName) {
    try {
      const settings = tradeDB.getSettings();
      if (settings.notify_on_trade !== "true") return;
      const config = getWxPusherConfig(settings);
      if (!config) return;
      const msg = formatTradeMessage({
        code: result.code,
        name: result.name,
        side: result.side,
        price: result.price || result.filledPrice,
        quantity: result.quantity,
        pnl: result.realizedPnl,
        pnlPercent: result.pnlPercent,
        time: new Date().toLocaleString("zh-CN"),
      }, strategyName);
      await sendWxPusher(config, msg);
    } catch (e) {
      this._log("WARN", `微信通知失败: ${e.message}`);
    }
  }

  async _notifyEngineStart() {
    try {
      const settings = tradeDB.getSettings();
      const config = getWxPusherConfig(settings);
      this._log("INFO", `[通知] settings: notify=${settings.notify_on_trade}, appToken=${config?.appToken?.slice(0,10) || "none"}..., uids=${JSON.stringify(config?.uids || [])}`);
      if (settings.notify_on_trade !== "true") return;
      if (!config) {
        this._log("WARN", `[通知] 缺少 appToken 或 uid`);
        return;
      }
      const stockCodes = new Set();
      for (const s of this.strategies.values()) {
        const codes = s.config?.stockPool || [];
        codes.forEach(c => stockCodes.add(c));
      }
      // 如果策略没有配置股票池，使用默认池
      if (stockCodes.size === 0) {
        STOCK_POOL.slice(0, 20).forEach(c => stockCodes.add(c));
      }
      const stocks = [...stockCodes].slice(0, 10).map(c => `> - **${c}**`).join("\n");
      const strategyList = [...this.strategies.values()].slice(0, 5).map(s =>
        `> - ${s.name || s.id} (${s.type})`
      ).join("\n");
      await sendWxPusher(config, {
        title: `🚀 引擎启动 — 监控 ${stockCodes.size} 只股票`,
        content: `> 监控股票: **${stockCodes.size} 只**\n> 启用策略: **${this.strategies.size} 个**\n> 启动时间: ${new Date().toLocaleString("zh-CN")}\n\n**📋 监控股票**\n${stocks}\n\n**⚙️ 启用策略**\n${strategyList}\n\n> 系统将自动盯盘，出现买卖信号时通知您`,
      });
      this._log("INFO", `[通知] 引擎启动通知已发送`);
    } catch (e) {
      this._log("WARN", `引擎启动通知失败: ${e.message}`);
    }
  }

  async _notifyDailySummary(report) {
    try {
      const settings = tradeDB.getSettings();
      if (settings.notify_on_daily !== "true") return;
      const config = getWxPusherConfig(settings);
      if (!config) return;
      const equity = tradeDB.getEquity();
      const todayTrades = tradeDB.all("SELECT * FROM trades WHERE date(created_at)=date('now','localtime')");
      const positions = tradeDB.all("SELECT * FROM positions WHERE quantity > 0");
      const msg = formatDailySummary({
        date: new Date().toLocaleDateString("zh-CN"),
        trades: todayTrades.map(t => ({ ...t, name: t.name })),
        pnl: report?.dailyPnl || 0,
        winRate: report?.winRate || 0,
        positions: positions.map(p => ({
          code: p.code, name: p.name, quantity: p.quantity,
          avgCost: p.avg_cost, currentPrice: p.current_price || p.avg_cost,
          unrealizedPnl: p.unrealized_pnl || 0,
        })),
        equity: equity.totalEquity,
      });
      await sendWxPusher(config, msg);
    } catch (e) {
      this._log("WARN", `微信每日汇总通知失败: ${e.message}`);
    }
  }

  // ===== v3: 自动日报 =====

  async _autoDailyReport() {
    const today = new Date().toISOString().slice(0, 10);
    if (this._dailyReportGenerated === today) return;

    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    // 在15:00-15:30之间生成日报
    if (hour === 15 && minute < 30) {
      try {
        const report = generateDailyReport();
        const filepath = saveDailyReport(report);
        this._log("REPORT", `日报已生成: ${filepath}`);
        this._broadcast({ type: "autotrade_report", report });
        this._dailyReportGenerated = today;

        // 盘后策略健康检查
        const health = await strategyHealthCheck();
        if (health.warnings.length > 0) {
          for (const w of health.warnings) {
            this._log("WARN", w.message);
          }
          this._broadcast({ type: "autotrade_health", health });
        }

        // 微信每日汇总通知
        this._notifyDailySummary(report);
      } catch (e) {
        this._log("ERROR", "日报生成失败: " + e.message);
      }
    }
  }

  // ===== WebSocket 广播 =====

  _broadcast(data) {
    if (!this.wss) return;
    const msg = JSON.stringify(data);
    for (const ws of this.wss.clients) {
      try { if (ws.readyState === 1) ws.send(msg); } catch (_) {}
    }
  }

  // ===== 日志 =====

  _log(level, msg) {
    const line = `[${new Date().toISOString().slice(0, 19).replace("T", " ")}] [${level}] ${msg}`;
    logger.info(`[AutoTrade] ${msg}`);
    if (this._logPath) {
      try { fs.appendFileSync(this._logPath, line + "\n", "utf8"); } catch (_) {}
    }
  }

  // ===== 日终记录 =====

  _recordDailyPnl() {
    const today = new Date().toISOString().slice(0, 10);
    if (this._dailyResetDone === today) return;
    const equity = tradeDB.getEquity();
    const initial = equity.initialCapital || 1000000;
    const pnl = equity.totalEquity - initial;
    const pnlPct = +((pnl / initial) * 100).toFixed(2);
    tradeDB.run(
      "INSERT OR REPLACE INTO daily_pnl (date, pnl, pnl_pct, equity, updated_at) VALUES (?,?,?,?,datetime('now','localtime'))",
      [today, +pnl.toFixed(2), pnlPct, equity.totalEquity]
    );
    this._dailyResetDone = today;
    this._broadcast({ type: "autotrade_account", ...tradeDB.getEquity() });
  }

  // ===== 查询 =====

  getStatus() {
    const riskStatus = this.riskManager.getStatus();
    return {
      running: this.running,
      version: 4,
      tickInterval: this._tickInterval,
      tradingHours: isTradingHours(),
      tradeCount: this._tradeCount,
      regime: this._currentRegime,
      regimeFactor: this._getRegimeFactor(),
      ensembleMode: this._ensembleMode,
      ...riskStatus,
      kellyParams: [...this._kellyParams.entries()].map(([id, kp]) => ({ strategyId: id, ...kp })),
      strategies: this.listStrategies(),
      recentOrders: tradeDB.all("SELECT * FROM orders ORDER BY created_at DESC LIMIT 20"),
      recentTrades: tradeDB.all("SELECT * FROM trades ORDER BY created_at DESC LIMIT 50"),
      positions: tradeDB.all("SELECT * FROM positions WHERE quantity > 0"),
      dailyPnl: tradeDB.all("SELECT * FROM daily_pnl ORDER BY date DESC LIMIT 30"),
    };
  }

  getRecentLogs(n = 50) {
    if (!this._logPath) return [];
    try {
      const content = fs.readFileSync(this._logPath, "utf8");
      return content.trim().split("\n").slice(-n);
    } catch (_) { return []; }
  }
}

module.exports = new AutoTradeEngine();

// 风控管理器 v3 — 动态风控: ATR止损/波动率仓位/熔断机制/动态滑点
const tradeDB = require("../database/trades.db");
const { ATR } = require("../indicators");
const { logger } = require("../logger");

const DEFAULTS = {
  maxPositionRatio: 0.3,
  maxTotalPositions: 6,
  stopLossRatio: -0.06,
  takeProfitRatio: 0.15,
  trailingStopRatio: 0.05,
  minTrailingGain: 0.08,
  dailyLossLimit: -0.05,
  weeklyLossLimit: -0.10,
  minCashReserve: 0.1,
  singleBuyRatio: 0.15,
  dynamicSizing: true,
  kellyFraction: 0.5,
  maxConsecutiveLosses: 3,
  pauseMinutes: 120,
  // 动态风控参数
  atrStopMultiplier: 2.0,        // 止损 = -2×ATR
  atrTakeProfitMultiplier: 4.0,  // 止盈 = +4×ATR
  volPositionScale: true,         // 根据波动率缩放仓位
  circuitBreakerDrop: -0.03,     // 日内急跌3%触发熔断
  circuitBreakerPauseMin: 30,    // 熔断暂停30分钟
  dynamicSlippage: true,          // 动态滑点
  baseSlippage: 0.001,           // 基础滑点 0.1%
};

class RiskManager {
  constructor(config = {}) {
    this.config = { ...DEFAULTS, ...config };
    this._peakPrices = new Map();      // code -> peakPrice 用于移动止损
    this._consecutiveLosses = new Map(); // strategyId -> count
    this._pausedStrategies = new Map();  // strategyId -> resumeAfter timestamp
  }

  // ===== 买入检查 =====

  canBuy(code, quantity, price) {
    const equity = tradeDB.getEquity();
    const totalCapital = equity.totalEquity;

    // 日亏损检查
    const today = new Date().toISOString().slice(0, 10);
    const dailyRecord = tradeDB.get("SELECT * FROM daily_pnl WHERE date=?", [today]);
    if (dailyRecord && (dailyRecord.pnl_pct * 100) <= this.config.dailyLossLimit * 100) {
      return { allowed: false, reason: `日亏损达限 ${(dailyRecord.pnl_pct*100).toFixed(1)}%` };
    }

    // 周亏损检查
    const weekStart = this._getWeekStart();
    const weekPnl = tradeDB.all(
      "SELECT COALESCE(SUM(pnl),0) as total FROM daily_pnl WHERE date >= ?",
      [weekStart]
    );
    if (weekPnl.length > 0 && weekPnl[0].total) {
      const weekPnlPct = weekPnl[0].total / equity.initialCapital;
      if (weekPnlPct <= this.config.weeklyLossLimit) {
        return { allowed: false, reason: `周亏损达限 ${(weekPnlPct*100).toFixed(1)}%` };
      }
    }

    // 现金储备
    const buyAmount = quantity * price;
    if (buyAmount > equity.cash * (1 - this.config.minCashReserve)) {
      return { allowed: false, reason: `现金不足(保留${(this.config.minCashReserve*100).toFixed(0)}%)` };
    }

    // 单次买入比例
    if (buyAmount > totalCapital * this.config.singleBuyRatio) {
      return { allowed: false, reason: `超单次上限 ${(this.config.singleBuyRatio*100).toFixed(0)}%` };
    }

    // 单票仓位
    const afterBuy = buyAmount + this._getPositionValue(code);
    if (afterBuy > totalCapital * this.config.maxPositionRatio) {
      return { allowed: false, reason: `${code} 仓位超单票上限` };
    }

    // 持仓数量
    const currentPositions = tradeDB.all("SELECT * FROM positions WHERE quantity > 0");
    if (currentPositions.length >= this.config.maxTotalPositions && !currentPositions.find(p => p.code === code)) {
      return { allowed: false, reason: `持仓达上限 ${this.config.maxTotalPositions}` };
    }

    return { allowed: true };
  }

  canSell(code, quantity) {
    const pos = tradeDB.get("SELECT * FROM positions WHERE code=?", [code]);
    if (!pos || pos.quantity < quantity) {
      return { allowed: false, reason: `持仓不足: ${code}` };
    }
    return { allowed: true };
  }

  // ===== 移动止损检查 =====

  updatePeakPrice(code, currentPrice) {
    if (!currentPrice) return;
    const peak = this._peakPrices.get(code) || 0;
    if (currentPrice > peak) {
      this._peakPrices.set(code, currentPrice);
    }
  }

  checkTrailingStop(code, currentPrice, avgCost) {
    const peak = this._peakPrices.get(code);
    if (!peak || !currentPrice || !avgCost || avgCost <= 0) return null;

    const gainPct = (currentPrice - avgCost) / avgCost;
    // 只有盈利超过 minTrailingGain 才启动移动止损
    if (gainPct < this.config.minTrailingGain) return null;

    const drawdownFromPeak = (peak - currentPrice) / peak;
    if (drawdownFromPeak >= this.config.trailingStopRatio) {
      return {
        code,
        action: "trailing_stop",
        changePct: gainPct,
        reason: `移动止损: 盈利+${(gainPct*100).toFixed(1)}% 从高点${peak.toFixed(2)}回撤${(drawdownFromPeak*100).toFixed(1)}%`
      };
    }
    return null;
  }

  // ===== 止盈止损 (固定) =====

  checkStopConditions() {
    const positions = tradeDB.all("SELECT * FROM positions WHERE quantity > 0");
    const triggered = [];

    for (const pos of positions) {
      if (!pos.current_price || !pos.avg_cost || pos.avg_cost <= 0) continue;
      this.updatePeakPrice(pos.code, pos.current_price);

      const changePct = (pos.current_price - pos.avg_cost) / pos.avg_cost;

      // 动态止损: 优先使用 ATR 计算的动态值, 否则用静态值
      let stopLoss = this.config.stopLossRatio;
      let takeProfit = this.config.takeProfitRatio;
      if (pos.closes && pos.highs && pos.lows) {
        const dynSL = this.calcDynamicStopLoss(pos.closes, pos.highs, pos.lows);
        const dynTP = this.calcDynamicTakeProfit(pos.closes, pos.highs, pos.lows);
        if (dynSL !== this.config.stopLossRatio) stopLoss = dynSL;
        if (dynTP !== this.config.takeProfitRatio) takeProfit = dynTP;
      }

      // 止损
      if (changePct <= stopLoss) {
        triggered.push({
          code: pos.code, name: pos.name, action: "stop_loss", changePct,
          reason: `止损: ${(changePct*100).toFixed(1)}% (阈值 ${(stopLoss*100).toFixed(1)}%)`,
        });
        continue;
      }

      // 止盈
      if (changePct >= takeProfit) {
        triggered.push({
          code: pos.code, name: pos.name, action: "take_profit", changePct,
          reason: `止盈: +${(changePct*100).toFixed(1)}% (阈值 +${(takeProfit*100).toFixed(1)}%)`,
        });
        continue;
      }

      // 移动止损
      const trailing = this.checkTrailingStop(pos.code, pos.current_price, pos.avg_cost);
      if (trailing) {
        triggered.push(trailing);
      }
    }

    return triggered;
  }

  // ===== 连续止损暂停策略 =====

  recordLoss(strategyId) {
    const count = (this._consecutiveLosses.get(strategyId) || 0) + 1;
    this._consecutiveLosses.set(strategyId, count);
    if (count >= this.config.maxConsecutiveLosses) {
      const resumeAt = Date.now() + this.config.pauseMinutes * 60 * 1000;
      this._pausedStrategies.set(strategyId, resumeAt);
      return { paused: true, count, resumeAt };
    }
    return { paused: false, count };
  }

  recordWin(strategyId) {
    this._consecutiveLosses.set(strategyId, 0);
  }

  isPaused(strategyId) {
    const resumeAt = this._pausedStrategies.get(strategyId);
    if (!resumeAt) return false;
    if (Date.now() >= resumeAt) {
      this._pausedStrategies.delete(strategyId);
      this._consecutiveLosses.set(strategyId, 0);
      return false;
    }
    return true;
  }

  getPauseRemaining(strategyId) {
    const resumeAt = this._pausedStrategies.get(strategyId);
    if (!resumeAt) return 0;
    return Math.max(0, Math.ceil((resumeAt - Date.now()) / 60000));
  }

  // ===== Kelly 最优仓位计算 =====

  calcKellyPosition(winRate, avgWin, avgLoss) {
    if (!winRate || !avgWin || !avgLoss || avgLoss === 0) return this.config.singleBuyRatio;
    const winLossRatio = avgWin / Math.abs(avgLoss);
    const kellyFrac = Math.max(0, winRate/100 - (1-winRate/100) / winLossRatio);
    return Math.min(this.config.maxPositionRatio, kellyFrac * this.config.kellyFraction);
  }

  // ===== 动态风控: ATR 止损止盈 =====

  calcDynamicStopLoss(closes, highs, lows) {
    if (!this.config.atrStopMultiplier || closes.length < 20) return this.config.stopLossRatio;
    const atr = ATR(highs, lows, closes, 14);
    const lastATR = atr[atr.length - 1];
    if (!lastATR || lastATR <= 0) return this.config.stopLossRatio;
    const price = closes[closes.length - 1];
    return -(lastATR * this.config.atrStopMultiplier) / price;
  }

  calcDynamicTakeProfit(closes, highs, lows) {
    if (!this.config.atrTakeProfitMultiplier || closes.length < 20) return this.config.takeProfitRatio;
    const atr = ATR(highs, lows, closes, 14);
    const lastATR = atr[atr.length - 1];
    if (!lastATR || lastATR <= 0) return this.config.takeProfitRatio;
    const price = closes[closes.length - 1];
    return (lastATR * this.config.atrTakeProfitMultiplier) / price;
  }

  // ===== 动态风控: 波动率缩放仓位 =====

  calcVolAdjustedPosition(baseRatio, closes, period = 20) {
    if (!this.config.volPositionScale || closes.length < period + 1) return baseRatio;
    const rets = [];
    for (let i = closes.length - period; i < closes.length; i++) {
      if (closes[i - 1] > 0) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    if (rets.length === 0) return baseRatio;
    const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
    const vol = Math.sqrt(rets.reduce((s, r) => s + (r - avg) ** 2, 0) / rets.length);
    // 年化波动率
    const annualVol = vol * Math.sqrt(252);
    // 基准: 20% 年化波动率对应满仓位，高波动按比例缩减
    const scale = Math.min(1.0, 0.20 / Math.max(annualVol, 0.05));
    return Math.max(0.05, baseRatio * scale); // 最低 5%
  }

  // ===== 熔断机制 =====

  _circuitBreakerUntil = 0;

  checkCircuitBreaker(dailyDropPct) {
    if (dailyDropPct <= this.config.circuitBreakerDrop) {
      this._circuitBreakerUntil = Date.now() + this.config.circuitBreakerPauseMin * 60 * 1000;
      logger.warn(`[RiskManager] 熔断触发! 日内跌幅 ${(dailyDropPct*100).toFixed(2)}%, 暂停 ${this.config.circuitBreakerPauseMin} 分钟`);
      return true;
    }
    return Date.now() < this._circuitBreakerUntil;
  }

  getCircuitBreakerRemaining() {
    return Math.max(0, Math.ceil((this._circuitBreakerUntil - Date.now()) / 60000));
  }

  // ===== 动态滑点模型 =====

  calcDynamicSlippage(volume, avgVolume20, spread = 0) {
    if (!this.config.dynamicSlippage) return this.config.baseSlippage;
    let slippage = this.config.baseSlippage;
    // 成交量越低, 滑点越大
    if (avgVolume20 > 0 && volume > 0) {
      const volRatio = volume / avgVolume20;
      if (volRatio < 0.3) slippage *= 3;       // 极度缩量
      else if (volRatio < 0.5) slippage *= 2;  // 缩量
      else if (volRatio < 0.8) slippage *= 1.5;
      else if (volRatio > 2.0) slippage *= 0.7; // 放量减少滑点
    }
    // 盘口价差额外加成
    if (spread > 0) slippage += spread * 0.5;
    return Math.min(slippage, 0.005); // 上限 0.5%
  }

  // ===== 统计 =====

  _getPositionValue(code) {
    const pos = tradeDB.get("SELECT * FROM positions WHERE code=? AND quantity>0", [code]);
    return pos ? (pos.market_value || 0) : 0;
  }

  _getWeekStart() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // 周一
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().slice(0, 10);
  }

  getStatus() {
    const equity = tradeDB.getEquity();
    const positions = tradeDB.all("SELECT * FROM positions WHERE quantity > 0");
    const totalCost = positions.reduce((s, p) => s + p.avg_cost * p.quantity, 0);
    const upnl = positions.reduce((s, p) => s + (p.unrealized_pnl || 0), 0);
    const rpnl = positions.reduce((s, p) => s + (p.realized_pnl || 0), 0);

    return {
      ...equity,
      positionCount: positions.length,
      maxPositions: this.config.maxTotalPositions,
      totalCost: +totalCost.toFixed(2),
      unrealizedPnl: +upnl.toFixed(2),
      realizedPnl: +rpnl.toFixed(2),
      totalPnl: +(upnl + rpnl).toFixed(2),
      totalReturn: equity.initialCapital > 0 ? +((equity.totalEquity - equity.initialCapital) / equity.initialCapital * 100).toFixed(2) : 0,
      pausedStrategies: [...this._pausedStrategies.entries()].map(([id, ts]) => ({ id, resumeInMin: Math.ceil((ts - Date.now()) / 60000) })),
    };
  }
}

module.exports = { RiskManager, DEFAULTS };

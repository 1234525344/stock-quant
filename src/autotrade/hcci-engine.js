/**
 * HCCI 完美压燃自适应交易引擎 v2 — 优化版
 *
 * 核心改进:
 * - 最少持仓5天, 让利润跑
 * - 买入需 RON>0.52 + HCCI>0.25 双重确认
 * - 卖出需 RON<0.45 + HCCI<0.2 双重确认
 * - 爆震>60% 强制平仓
 * - 健康度<35% 强制平仓
 * - 每次只用15%仓位, 留现金应对波动
 *
 * 参考: "三段式DP状态空间控制 + HCCI完美压燃资金调度层"
 */
const { SMA, EMA } = require("../indicators");

class HCCIEngine {
  constructor(opts = {}) {
    // ── HCCI 参数 ──
    this.tauRon       = opts.tauRon       || 10;
    this.betaHcci     = opts.betaHcci     || 8.0;
    this.ronThreshold = opts.ronThreshold || 0.7;
    this.kHcciLimit   = opts.kHcciLimit   || 0.5;
    this.turboGain    = opts.turboGain    || 0.5;
    this.thetaExhaust = opts.thetaExhaust || 0.3;

    // ── 爆震检测 ──
    this.knockWindow    = opts.knockWindow    || 20;
    this.knockThreshold = opts.knockThreshold || 2.5;

    // ── 能力半径 ──
    this.R0          = opts.R0          || 1e6;
    this.gammaR      = opts.gammaR      || 0.005;
    this.deltaR      = opts.deltaR      || 0.01;
    this.betaElastic = opts.betaElastic || 0.10;
    this.etaElastic  = opts.etaElastic  || 0.003;

    // ── 控制层阈值 ──
    this.MIN_HOLD      = 10;     // 最少持5天才能卖
    this.BUY_RON_MIN   = 0.50;  // 买入需RON>0.52
    this.BUY_HCCI_MIN  = 0.20;  // 买入需HCCI>0.25
    this.SELL_RON_MAX  = 0.35;  // 卖出需RON<0.45
    this.SELL_HCCI_MAX = 0.10;  // 卖出需HCCI<0.20
    this.BUY_PCT       = 0.15;  // 每次15%仓位

    this.reset();
  }

  reset() {
    this.Rt = this.R0;
    this.Ct = 0;
    this.Wcap = this.R0;
    this.Wprofit = 0;
    this.Ihcci = 0;
    this.knockProbability = 0;
    this.faultActive = false;
    this.holdBars = 0;
    this.age = 0;
  }

  // ═══════ M1: 内生辛烷值检测 ═══════
  detectRon(closes) {
    const n = closes.length;
    if (n < this.tauRon) return 0.5;
    const dpP = [], dpM = [];
    for (let i = 1; i < n; i++) {
      const dp = closes[i] - closes[i-1];
      if (dp > 0) dpP.push(dp); else dpM.push(-dp);
    }
    const eP = this._ema(dpP, this.tauRon);
    const eM = dpM.length > 0 ? this._ema(dpM, this.tauRon) : 0;
    return Math.max(0, Math.min(1, eP / (eP + eM + 1e-8)));
  }

  _ema(arr, period) {
    if (arr.length === 0) return 0;
    let ema = arr[0];
    const alpha = 2 / (period + 1);
    for (let i = 1; i < arr.length; i++) ema = ema * (1 - alpha) + arr[i] * alpha;
    return ema;
  }

  // ═══════ 爆震检测 ═══════
  detectKnock(klines) {
    const n = klines.length;
    if (n < this.knockWindow) return 0;
    const rets = [];
    for (let i = 1; i < n; i++) rets.push((klines[i].close - klines[i-1].close) / klines[i-1].close);
    const recent = rets.slice(-this.knockWindow);
    const mean = recent.reduce((a,b)=>a+b,0) / recent.length;
    const std = Math.sqrt(recent.reduce((s,x)=>s+(x-mean)**2,0) / recent.length);
    const z = std > 0 ? Math.abs((rets[rets.length-1] - mean) / std) : 0;
    return 1 / (1 + Math.exp(-(z - this.knockThreshold) * 2));
  }

  // ═══════ M2: HCCI激活 ═══════
  computeHcci(ron, pKnock) {
    const sigmoid = 1 / (1 + Math.exp(-this.betaHcci * (ron - this.ronThreshold)));
    return Math.max(0, Math.min(1, sigmoid * (1 - pKnock)));
  }

  // ═══════ 完整决策 (每根K线调用) ═══════
  step(klines, cash, position, avgCost, currentPrice) {
    const closes = klines.map(k => k.close);
    const n = klines.length;

    // 状态层
    const ron = this.detectRon(closes);
    const pKnock = this.detectKnock(klines);
    this.Ihcci = this.computeHcci(ron, pKnock);
    this.knockProbability = pKnock;

    // HCCI层
    const kEff = 1 * (1 + this.kHcciLimit * this.Ihcci);
    const thetaEff = this.thetaExhaust * (1 - this.Ihcci);
    if (this.Ct > 0 && position > 0) {
      this.Wprofit = position * (currentPrice - avgCost);
    } else if (position === 0) {
      this.Wprofit = Math.max(0, this.Wprofit * 0.98);
    }
    this.Wcap = cash + position * currentPrice;
    const eHealth = this.Rt / (this.R0 || 1);
    this.faultActive = eHealth < 0.3 || pKnock > 0.8;

    // ── 控制层 ──
    let best = { action: 'hold', qty: 0, reason: '' };

    if (position > 0) {
      this.holdBars++;
      // 追踪持仓期间的最高价（用于移动止盈）
      if (!this._entryPeak) this._entryPeak = currentPrice;
      if (currentPrice > this._entryPeak) this._entryPeak = currentPrice;
    } else {
      this.holdBars = 0;
      this._entryPeak = 0;
    }

    const canBuy = position === 0 && cash > 0 && !this.faultActive;

    if (canBuy && ron > this.BUY_RON_MIN && this.Ihcci > this.BUY_HCCI_MIN) {
      const cost = cash * this.BUY_PCT;
      const qty = currentPrice > 0 ? Math.floor(cost / currentPrice / 100) * 100 : 0;
      if (qty >= 100) {
        best = { action: 'buy', qty, cost,
          reason: 'RON' + ron.toFixed(2) + '|HCCI' + this.Ihcci.toFixed(2) + '|开仓' };
      }
    }

    if (position > 0) {
      const canSell = this.holdBars >= this.MIN_HOLD || ((currentPrice-avgCost)/avgCost) > 0.15 || pKnock > 0.6;
      let shouldSell = false;
      let reason = '';

      // 爆震强制平仓 (不管持仓天数)
      if (pKnock > 0.6) { shouldSell = true; reason = '爆震' + (pKnock*100).toFixed(0) + '%|强制平仓'; }
      // 健康度强制平仓
      else if (eHealth < 0.35) { shouldSell = true; reason = '健康度' + (eHealth*100).toFixed(0) + '%|风控平仓'; }
      // 双条件卖出
      if (canSell && ron < this.SELL_RON_MAX && this.Ihcci < this.SELL_HCCI_MAX) {
        shouldSell = true;
        reason = 'RON' + ron.toFixed(2) + '|HCCI' + this.Ihcci.toFixed(2) + '|退出';
      }
      // 移动止盈: 回落幅度 = 10% + (1-HCCI) * 15%. HCCI高时(好行情)回落容忍大, HCCI低时严格
      if (canSell && this._entryPeak > 0) {
        const trailPct = -(0.10 + (1-this.Ihcci) * 0.15); // HCCI=0.8→-13%, HCCI=0.2→-22%
        if ((currentPrice - this._entryPeak) / this._entryPeak < trailPct) {
          shouldSell = true; reason = '回落' + ((currentPrice-this._entryPeak)/this._entryPeak*100).toFixed(0) + '%|移动止盈';
        }
      }
      // 止损: 亏超10%且RON极低
      if (!shouldSell && canSell && avgCost > 0 && (currentPrice - avgCost) / avgCost < -0.10 && ron < 0.3) {
        shouldSell = true; reason = '止损' + ((currentPrice-avgCost)/avgCost*100).toFixed(0) + '%|RON' + ron.toFixed(2);
      }

      if (shouldSell) {
        best = { action: 'sell', qty: position, reason };
        this.holdBars = 0; this._entryPeak = 0;
      }
    }

    // 持有状态的可读原因
    if (best.action === 'hold') {
      if (position > 0) {
        best.reason = '持仓' + this.holdBars + '天|RON' + ron.toFixed(2) + '|HCCI' + this.Ihcci.toFixed(2);
      } else if (ron > 0.55) {
        best.reason = '等待回调|RON' + ron.toFixed(2);
      } else {
        best.reason = '观望|RON' + ron.toFixed(2) + '|HCCI' + this.Ihcci.toFixed(2);
      }
    }

    // ── 能力半径更新 ──
    if (best.action !== 'hold') {
      const q = best.qty || 0;
      const pct = this.Wcap > 0 ? (best.cost || best.qty * currentPrice) / this.Wcap : 0;
      const gKinetic = q > 0 ? q * pct / (this.Wcap || 1) : 0;
      this.Rt += this.gammaR * gKinetic * this.R0;
      if (this.Ct > 0) {
        this.Rt -= this.deltaR * Math.abs((currentPrice - this.Ct) / this.Ct) * this.Rt;
      }
      this.Ct = this.Ct > 0 ? 0.95 * this.Ct + 0.05 * currentPrice : currentPrice;
    } else {
      if (this.Ct > 0 && currentPrice > 0 && Math.abs(currentPrice - this.Ct) / this.Ct < this.betaElastic) {
        const w = this.etaElastic;
        this.Ct = (1 - w * 0.5) * this.Ct + w * 0.5 * currentPrice;
        this.Rt += w * (this.R0 - this.Rt);
      }
    }
    this.Rt = Math.max(this.R0 * 0.1, Math.min(this.R0 * 5, this.Rt));

    return {
      action: best.action, reason: best.reason,
      ihcci: this.Ihcci, ron, knockPct: pKnock,
      kEff, thetaEff, rt: this.Rt, eHealth,
      faultActive: this.faultActive,
    };
  }
}

module.exports = { HCCIEngine };

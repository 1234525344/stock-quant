// 回测引擎 — 基于历史K线模拟策略表现
// 支持滑点、手续费、T+1、涨跌停
const { getKlineData } = require("../data");
const { getSignalsNow, detectMarketState } = require("../helpers");
const { SMA, MACD, RSI } = require("../indicators");
const performance = require("./performance");

class BacktestEngine {
  constructor(config = {}) {
    this.initialCapital = config.initialCapital || 1000000;
    this.slippage = config.slippage || 0.001;       // 0.1%
    this.commission = config.commission || 0.00025; // 万2.5
    this.stampTax = config.stampTax || 0.001;       // 0.1% 卖出印花税
    this.minFee = config.minFee || 5;
    this.positionSize = config.positionSize || 0.2;
    this.tPlusOne = config.tPlusOne !== false;      // A股T+1
  }

  async runStrategy(strategyType, code, startDate, endDate) {
    const klines = await getKlineData(code, 500).catch(() => []);
    if (klines.length < 60) return { error: "数据不足" };

    // 按日期过滤
    const filtered = klines.filter(k => k.date >= startDate && k.date <= endDate);
    if (filtered.length < 20) return { error: `区间内数据不足 (${filtered.length}条)` };

    let cash = this.initialCapital;
    let position = 0;
    let avgCost = 0;
    const equityCurve = [];
    const trades = [];
    const signals = [];
    let _positionAge = 0;  // 持仓天数跟踪

    const closes = filtered.map(k => k.close);
    const highs = filtered.map(k => k.high);
    const lows = filtered.map(k => k.low);
    const volumes = filtered.map(k => k.volume);
    const dates = filtered.map(k => k.date);
    const opens = filtered.map(k => k.open);

    // 预计算全部指标 (O(n) 一次性, 避免循环内重复 slice+计算)
    const indMA5 = SMA(closes, 5);
    const indMA20 = SMA(closes, 20);
    const indMACD = MACD(closes);
    const indRSI = RSI(closes, 14);

    for (let i = 60; i < filtered.length; i++) {
      const price = closes[i];
      const prevPrice = closes[i - 1];
      const signal = this._evaluateFromIndicators(strategyType, i, closes, opens, highs, lows, volumes, indMA5, indMA20, indMACD, indRSI, _positionAge);

      signals.push({
        date: dates[i],
        price,
        action: signal.action,
        strength: signal.strength,
        reason: signal.reason,
      });

      // 执行交易
      if (signal.action === "buy" && position === 0) {
        const buyAmount = cash * this.positionSize;
        const buyPrice = price * (1 + this.slippage);
        const qty = Math.floor(buyAmount / buyPrice / 100) * 100;
        if (qty >= 100) {
          const cost = buyPrice * qty;
          const fee = Math.max(this.minFee, cost * this.commission);
          if (cash >= cost + fee) {
            cash -= (cost + fee);
            position = qty;
            avgCost = buyPrice;
            _positionAge = 0;
            trades.push({
              date: dates[i], code, side: "buy", quantity: qty,
              price: +buyPrice.toFixed(2), cost: +cost.toFixed(2), fee: +fee.toFixed(2), cash: +cash.toFixed(2),
            });
          }
        }
      } else if (signal.action === "sell" && position > 0) {
        if (this.tPlusOne && trades.length > 0) {
          const lastTrade = trades[trades.length - 1];
          if (lastTrade.side === "buy" && lastTrade.date === dates[i]) {
            // T+1: 当天买入不能当天卖出
            equityCurve.push(cash + position * price);
            continue;
          }
        }
        const sellPrice = price * (1 - this.slippage);
        const proceeds = sellPrice * position;
        const fee = Math.max(this.minFee, proceeds * this.commission);
        const tax = proceeds * this.stampTax;
        const pnl = proceeds - avgCost * position - fee - tax;
        cash += (proceeds - fee - tax);
        trades.push({
          date: dates[i], code, side: "sell", quantity: position,
          price: +sellPrice.toFixed(2), proceeds: +proceeds.toFixed(2),
          fee: +fee.toFixed(2), tax: +tax.toFixed(2), pnl: +pnl.toFixed(2),
          pnlPct: avgCost > 0 ? +((sellPrice - avgCost) / avgCost * 100).toFixed(2) : 0,
          cash: +cash.toFixed(2),
        });
        position = 0;
        avgCost = 0;
        _positionAge = 0;
      }

      _positionAge++;
      const equity = cash + position * price;
      equityCurve.push(+equity.toFixed(2));
    }

    // 清仓
    if (position > 0) {
      const lastPrice = closes[closes.length - 1];
      cash += lastPrice * position;
      equityCurve.push(+cash.toFixed(2));
    }

    const report = performance.fullReport(equityCurve, trades, this.initialCapital, 252);
    report.signals = signals.filter((_, i) => i % 5 === 0); // 抽样
    report.tradeLog = trades;
    report.equityCurve = equityCurve.filter((_, i) => i % 3 === 0);
    report.equityDates = dates.filter((_, i) => i % 3 === 0);

    return report;
  }

  // 使用预计算指标评估信号 (O(1) per bar, 替代原来的 O(n) slice+重算)
  _evaluateFromIndicators(type, i, closes, opens, highs, lows, volumes, ma5, ma20, macd, rsi, positionAge) {
    const last = i;

    if (type === "ma_cross") {
      if (ma5[last] != null && ma20[last] != null && ma5[last - 1] != null && ma20[last - 1] != null) {
        if (ma5[last] > ma20[last] && ma5[last - 1] <= ma20[last - 1])
          return { action: "buy", strength: 3, reason: "MA5上穿MA20 金叉" };
        if (ma5[last] < ma20[last] && ma5[last - 1] >= ma20[last - 1])
          return { action: "sell", strength: -3, reason: "MA5下穿MA20 死叉" };
      }
      return { action: "hold", strength: 0, reason: (ma5[last] || 0) > (ma20[last] || 0) ? "多头排列" : "空头排列" };
    }

    if (type === "signal_follow") {
      const dif = macd.dif[last] || 0;
      const dea = macd.dea[last] || 0;
      const rsiVal = rsi[last] || 50;
      const score = (dif > dea ? 1 : -1) + (rsiVal < 30 ? 1 : rsiVal > 70 ? -1 : 0);
      if (score >= 2) return { action: "buy", strength: score, reason: `MACD金叉+RSI超卖 score=${score}` };
      if (score <= -2) return { action: "sell", strength: score, reason: `MACD死叉+RSI超买 score=${score}` };
      return { action: "hold", strength: score, reason: `信号中性 score=${score}` };
    }

    if (type === "grid") {
      let recentHigh = -Infinity, recentLow = Infinity;
      for (let j = Math.max(0, last - 19); j <= last; j++) {
        if (closes[j] > recentHigh) recentHigh = closes[j];
        if (closes[j] < recentLow) recentLow = closes[j];
      }
      const gridSize = (recentHigh - recentLow) / 5;
      const price = closes[last];
      if (price <= recentLow + gridSize * 0.5) return { action: "buy", strength: 1, reason: "网格下沿" };
      if (price >= recentHigh - gridSize * 0.5) return { action: "sell", strength: -1, reason: "网格上沿" };
      return { action: "hold", strength: 0, reason: "网格区间内" };
    }

    if (type === "t3pullback") {
      if (last < 30) return { action: "hold", strength: 0, reason: "数据不足" };
      for (let idx = last; idx >= last - 10 && idx >= 3; idx--) {
        const T0 = { open: opens[idx-3], close: closes[idx-3], high: highs[idx-3], low: lows[idx-3], volume: volumes[idx-3] };
        const T1 = { open: opens[idx-2], close: closes[idx-2], high: highs[idx-2], low: lows[idx-2], volume: volumes[idx-2] };
        const T2 = { open: opens[idx-1], close: closes[idx-1], high: highs[idx-1], low: lows[idx-1], volume: volumes[idx-1] };
        const T3 = { open: opens[idx],   close: closes[idx],   high: highs[idx],   low: lows[idx],   volume: volumes[idx]   };
        if (T0.close <= 0 || T1.close <= 0 || T2.close <= 0 || T3.close <= 0) continue;
        if (T3.close < 5.0) continue;
        let vol5Avg = 0;
        for (let j = idx - 8; j < idx - 3; j++) { if (j >= 0 && volumes[j]) vol5Avg += volumes[j]; }
        vol5Avg = vol5Avg > 0 ? vol5Avg / 5 : volumes[idx-3];
        const volRatio = vol5Avg > 0 ? T0.volume / vol5Avg : 1;
        const t0Chg = (T0.close - T0.open) / T0.open * 100;
        if (volRatio < 0.8 || t0Chg >= 9.5) continue;
        const t1Chg = (T1.close - T1.open) / T1.open * 100;
        if (t1Chg < 9.5) continue;
        if (T2.close >= T2.open) continue;
        const buyPrice = (T0.close + T1.close) / 2;
        const score = Math.min(100, Math.round(
          55 + Math.min(volRatio, 3) * 5 + Math.min(t1Chg - 9.5, 5) * 2 +
          (T2.close < T2.open ? 10 : -20) + (T2.volume < T1.volume * 0.8 ? 10 : 0)
        ));
        if (idx === last) {
          return { action: "buy", strength: Math.round(score / 20),
            reason: `T+3回调低吸·T日放量${volRatio.toFixed(1)}x·T+1涨停${t1Chg.toFixed(1)}%·T+2阴线·买入价${buyPrice.toFixed(2)}` };
        }
        if (idx < last && (last - idx) >= 5) return { action: "sell", strength: -3, reason: "T+3持有期满·平仓" };
        return { action: "hold", strength: 2, reason: `T+3持仓中·${last-idx}天` };
      }
      return { action: "hold", strength: 0, reason: "无T+3信号" };
    }

    // 突破策略: 价格突破N日高点买入, 跌破N日低点卖出
    if (type === "breakout") {
      const N = 20;
      if (last < N) return { action: "hold", strength: 0, reason: "数据不足" };
      let highN = -Infinity, lowN = Infinity;
      for (let j = last - N; j <= last; j++) { if (closes[j] > highN) highN = closes[j]; if (closes[j] < lowN) lowN = closes[j]; }
      if (closes[last] > highN * 0.98 && volumes[last] > volumes[last-1] * 1.5)
        return { action: "buy", strength: 3, reason: `突破${N}日高点放量确认` };
      if (closes[last] < lowN * 1.02)
        return { action: "sell", strength: -2, reason: `跌破${N}日低点` };
      return { action: "hold", strength: 0, reason: "区间震荡" };
    }

    // 动量轮动: RSI趋势+成交量确认
    if (type === "momentum_rotation") {
      const rsiVal = rsi[last] || 50;
      const volMA5 = volumes.slice(last-4, last+1).reduce((a,b)=>a+b,0)/5;
      const volRatio = volMA5 > 0 ? volumes[last]/volMA5 : 1;
      if (rsiVal > 55 && rsiVal < 75 && volRatio > 1.2)
        return { action: "buy", strength: 2, reason: `RSI动量${rsiVal.toFixed(0)}·放量${volRatio.toFixed(1)}x` };
      if (rsiVal > 80 || (rsiVal < 45 && volRatio < 0.8))
        return { action: "sell", strength: -1, reason: `RSI${rsiVal.toFixed(0)}·动量衰减` };
      return { action: "hold", strength: 0, reason: `RSI${rsiVal.toFixed(0)}` };
    }

    // 均值回归: RSI超卖买入, 超买卖出
    if (type === "mean_reversion") {
      const rsiVal = rsi[last] || 50;
      if (rsiVal < 30) return { action: "buy", strength: 3, reason: `RSI超卖${rsiVal.toFixed(0)}·均值回归` };
      if (rsiVal > 70) return { action: "sell", strength: -3, reason: `RSI超买${rsiVal.toFixed(0)}·高位减仓` };
      return { action: "hold", strength: 0, reason: `RSI中性${rsiVal.toFixed(0)}` };
    }

    // 追涨停: 涨停次日高开追入, 持有2天
    if (type === "limit_up_chase") {
      if (last < 2) return { action: "hold", strength: 0, reason: "数据不足" };
      const prevChg = (closes[last-1] - opens[last-1]) / opens[last-1] * 100;
      const prevIsLimitUp = prevChg >= 9.5 && closes[last-1] >= highs[last-1] * 0.99;
      const todayGap = opens[last] > 0 ? (opens[last] - closes[last-1]) / closes[last-1] : 0;
      if (prevIsLimitUp && todayGap > 0.01 && todayGap < 0.07)
        return { action: "buy", strength: 2, reason: `涨停次日高开${(todayGap*100).toFixed(1)}%追入` };
      if (positionAge >= 3)
        return { action: "sell", strength: -2, reason: "持有3日·止盈出局" };
      return { action: "hold", strength: 0, reason: "等待信号" };
    }

    // 趋势波段: MA多头排列+回踩买入
    if (type === "trend_band") {
      if (last < 20) return { action: "hold", strength: 0, reason: "数据不足" };
      const ma5v = ma5[last], ma20v = ma20[last];
      const isBullish = ma5v > ma20v && closes[last] > ma20v;
      const pullback = closes[last] < ma5v && closes[last] > ma20v * 0.98;
      if (isBullish && pullback && volumes[last] < volumes[last-1])
        return { action: "buy", strength: 2, reason: "多头回踩MA5缩量·低吸" };
      if (!isBullish && closes[last] < ma20v)
        return { action: "sell", strength: -1, reason: "跌破MA20转空" };
      return { action: "hold", strength: 0, reason: isBullish ? "多头趋势" : "空头趋势" };
    }

    // 恐慌抄底: 连续大跌后RSI极低买入
    if (type === "panic_buy") {
      if (last < 5) return { action: "hold", strength: 0, reason: "数据不足" };
      const chg3d = (closes[last] - closes[Math.max(0,last-3)]) / closes[Math.max(0,last-3)] * 100;
      const rsiVal = rsi[last] || 50;
      if (chg3d < -8 && rsiVal < 25 && volumes[last] > volumes[last-1] * 1.5)
        return { action: "buy", strength: 4, reason: `恐慌超跌${chg3d.toFixed(1)}%·RSI${rsiVal.toFixed(0)}·放量抄底` };
      if (chg3d > 5)
        return { action: "sell", strength: -2, reason: "反弹止盈" };
      return { action: "hold", strength: 0, reason: "等待恐慌信号" };
    }

    if (type === "hcci") {
      // HCCI 完美压燃自适应策略
      const { HCCIEngine } = require("./hcci-engine");
      if (!this._hcciEngines) this._hcciEngines = new Map();
      const klineSlice = closes.map((_,i) => ({ close:closes[i], open:opens[i], high:highs[i], low:lows[i], volume:volumes[i] }));
      if (!this._hcciEng) {
        this._hcciEng = new HCCIEngine({ R0: 1000000 });
      }
      const result = this._hcciEng.step(klineSlice.slice(0, last+1), 1000000, this._hcciPos||0, this._hcciAvgCost||0, closes[last]);
      if (result.action === 'buy') return { action: "buy", strength: 3, reason: result.reason };
      if (result.action === 'sell') return { action: "sell", strength: -3, reason: result.reason };
      return { action: "hold", strength: 0, reason: result.reason || "HCCI怠速" };
    }

    return { action: "hold", strength: 0, reason: "未知策略" };
  }

}

module.exports = new BacktestEngine();

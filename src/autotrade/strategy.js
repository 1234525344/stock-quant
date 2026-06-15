// 策略引擎 v2 — 7种策略 + 集成投票
// 新增: 突破策略、动量轮动、均值回归、T+3回调低吸
const { getSignalsNow, detectMarketState } = require("../helpers");
const { getKlineData, getRealtimeQuotes, getStockName } = require("../data");
const { SMA, EMA, MACD, RSI, KDJ, BOLL } = require("../indicators");
const { isLimitUp } = require("../hotmoney");

const STRATEGY_TYPES = {
  signal_follow: {
    name: "信号跟随",
    desc: "跟随技术信号投票结果: strong_buy买入, strong_sell卖出",
    defaultConfig: {
      buyThreshold: "strong_buy",
      sellThreshold: "strong_sell",
      maxPositions: 5,
      positionSize: 0.15,
      requireVolumeConfirm: true,
    },
  },
  ma_cross: {
    name: "均线交叉",
    desc: "5/20均线金叉买入，死叉卖出",
    defaultConfig: {
      fastMA: 5,
      slowMA: 20,
      positionSize: 0.15,
    },
  },
  grid: {
    name: "网格交易",
    desc: "震荡市自动高抛低吸",
    defaultConfig: {
      gridLevels: 5,
      gridSpacing: 0.03,
      basePosition: 0.15,
    },
  },
  breakout: {
    name: "突破策略",
    desc: "突破N日最高点买入，跌破M日最低点卖出",
    defaultConfig: {
      breakoutDays: 20,
      stopDays: 10,
      positionSize: 0.15,
      requireVolumeConfirm: true,
    },
  },
  momentum_rotation: {
    name: "动量轮动",
    desc: "从候选池中选动量最强的持有，动量减弱换仓",
    defaultConfig: {
      momentumDays: 20,
      topN: 3,
      rotationInterval: 5,
      positionSize: 0.20,
    },
  },
  mean_reversion: {
    name: "均值回归",
    desc: "布林带下轨+RSI超卖买入，回归中轨卖出",
    defaultConfig: {
      bollPeriod: 20,
      rsiOversold: 30,
      rsiOverbought: 70,
      positionSize: 0.15,
    },
  },
  t3pullback: {
    name: "T+3回调低吸",
    desc: "T日放量→T+1涨停确认→T+2阴线洗盘→T+3回调买入",
    defaultConfig: {
      positionSize: 0.20,
      holdDays: 5,
      volumeThreshold: 0.8,
      stopLoss: 0.05,
    },
  },
  // ── 游资风格策略 ──
  limit_up_chase: {
    name: "打板接力",
    desc: "赵老哥/涅槃重升风格: 首板放量→次日高开追入→次次日溢价必走",
    defaultConfig: {
      positionSize: 0.15,
      maxGap: 0.05,       // 次日高开不超过5% (太高不追)
      minGap: 0.005,       // 最少高开0.5%确认强势
      stopLoss: 0.03,      // 止损: 买入价下方3%
      maxHoldDays: 2,      // 最多持有2个交易日
    },
  },
  trend_band: {
    name: "趋势波段",
    desc: "方新侠/章盟主风格: MA多头排列→回踩MA20不破→沿MA20持有→破MA60止损",
    defaultConfig: {
      positionSize: 0.25,
      pullbackTolerance: 0.03, // 回踩距MA20在3%以内视为买点
      stopLoss: 0.08,          // 破MA60或亏8%止损
      takeProfit: 0.25,        // 前高1.25x止盈
    },
  },
  panic_buy: {
    name: "恐慌低吸",
    desc: "炒股养家/歌神风格: 连跌缩量→十字星企稳→RSI超卖→分批低吸",
    defaultConfig: {
      positionSize: 0.10,     // 每次只买10%仓位
      batches: 3,              // 分3批买入
      batchGap: 0.05,          // 每跌5%补一批
      stopLoss: 0.08,          // 均价下方8%止损
      takeProfit: 0.12,        // 反弹12%止盈
    },
  },
  hcci: {
    name: "HCCI自适应",
    desc: "基于发动机控制哲学: 辛烷值检测行情平顺度, 动能涡轮动态调仓, 爆震FAULT保护",
    defaultConfig: {
      tauRon: 10, betaHcci: 8.0, ronThreshold: 0.7,
      kHcciLimit: 0.5, turboGain: 0.3, thetaExhaust: 0.5,
    },
  },
};

class StrategyEngine {
  constructor() {
    this.signalsCache = new Map();
    this._ensembleVotes = new Map();
  }

  async evaluate(strategy, code, currentPrice) {
    switch (strategy.type) {
      case "signal_follow":    return this._evaluateSignalFollow(strategy, code, currentPrice);
      case "ma_cross":         return this._evaluateMACross(strategy, code, currentPrice);
      case "grid":             return this._evaluateGrid(strategy, code, currentPrice);
      case "breakout":         return this._evaluateBreakout(strategy, code, currentPrice);
      case "momentum_rotation":return this._evaluateMomentumRotation(strategy, code, currentPrice);
      case "mean_reversion":   return this._evaluateMeanReversion(strategy, code, currentPrice);
      case "t3pullback":       return this._evaluateT3Pullback(strategy, code, currentPrice);
      case "limit_up_chase":   return this._evaluateLimitUpChase(strategy, code, currentPrice);
      case "trend_band":       return this._evaluateTrendBand(strategy, code, currentPrice);
      case "panic_buy":        return this._evaluatePanicBuy(strategy, code, currentPrice);
      default: return { action: "hold", reason: "未知策略" };
    }
  }

  // ===== 集成投票 =====

  async ensembleVote(activeStrategies, code, currentPrice) {
    const signals = [];
    for (const strategy of activeStrategies) {
      try {
        const sig = await this.evaluate(strategy, code, currentPrice);
        signals.push({ strategy: strategy.name || strategy.id, ...sig });
      } catch (_) { }
    }

    const buyVotes  = signals.filter(s => s.action === "buy").length;
    const sellVotes = signals.filter(s => s.action === "sell").length;
    const total = signals.length;
    if (total === 0) return { action: "hold", ensemble: signals, reason: "无有效信号" };

    // ≥2/3策略一致才执行 (至少需要2票)
    if (buyVotes >= Math.max(2, Math.ceil(total * 0.67))) {
      const reasons = signals.filter(s => s.action === "buy").map(s => s.reason).join(" | ");
      return { action: "buy", strength: buyVotes, ensemble: signals, name: signals[0]?.name, price: currentPrice, reason: `集成投票 ${buyVotes}/${total} → 买入: ${reasons}` };
    }
    if (sellVotes >= Math.max(2, Math.ceil(total * 0.67))) {
      const reasons = signals.filter(s => s.action === "sell").map(s => s.reason).join(" | ");
      return { action: "sell", strength: sellVotes, ensemble: signals, name: signals[0]?.name, price: currentPrice, reason: `集成投票 ${sellVotes}/${total} → 卖出: ${reasons}` };
    }

    return { action: "hold", ensemble: signals, reason: `投票分散: ${buyVotes}买/${sellVotes}卖/${total}总 → 观望` };
  }

  // ===== 信号跟随 =====

  async _evaluateSignalFollow(strategy, code, price) {
    const cacheKey = `${code}_${Date.now() / 60000 | 0}`;
    let sigResp = this.signalsCache.get(cacheKey);
    if (!sigResp) {
      sigResp = await getSignalsNow(code).catch(() => null);
      this.signalsCache.set(cacheKey, sigResp);
      if (this.signalsCache.size > 100) this.signalsCache.clear();
    }

    if (!sigResp || sigResp.error) return { action: "hold", reason: "信号数据获取失败" };

    const config = strategy.config || STRATEGY_TYPES.signal_follow.defaultConfig;
    const consensus = sigResp.consensus;
    const volRatio = sigResp.volRatio || 1;
    const name = sigResp.name || await getStockName(code).catch(() => code);

    const volumeOk = !config.requireVolumeConfirm || volRatio >= 0.7;
    if (!volumeOk && (consensus === "strong_buy" || consensus === "buy")) {
      return { action: "hold", reason: `信号${consensus}但量能不足(换手率=${volRatio.toFixed(2)})` };
    }

    const score = (sigResp.votes?.buy || 0) - (sigResp.votes?.sell || 0);

    if (consensus === config.buyThreshold || (consensus === "buy" && score >= 2)) {
      return { action: "buy", strength: score, name, price, reason: sigResp.reasoning };
    }
    if (consensus === config.sellThreshold) {
      return { action: "sell", strength: score, name, price, reason: sigResp.reasoning };
    }
    return { action: "hold", strength: score, name, price, reason: `信号: ${consensus}` };
  }

  // ===== 均线交叉 =====

  async _evaluateMACross(strategy, code, price) {
    const config = strategy.config || STRATEGY_TYPES.ma_cross.defaultConfig;
    const klines = await getKlineData(code, 60).catch(() => []);
    if (klines.length < 30) return { action: "hold", reason: "K线数据不足" };

    const closes = klines.map(k => k.close);
    const fastMA = this._sma(closes, config.fastMA);
    const slowMA = this._sma(closes, config.slowMA);
    const last = closes.length - 1;
    const prev = last - 1;

    if (fastMA[last] == null || slowMA[last] == null) return { action: "hold", reason: "均线数据不足" };
    const name = await getStockName(code).catch(() => code);

    if (fastMA[last] > slowMA[last] && fastMA[prev] <= slowMA[prev]) {
      return { action: "buy", name, price, reason: `金叉: MA${config.fastMA}(${fastMA[last].toFixed(2)})↑穿 MA${config.slowMA}(${slowMA[last].toFixed(2)})` };
    }
    if (fastMA[last] < slowMA[last] && fastMA[prev] >= slowMA[prev]) {
      return { action: "sell", name, price, reason: `死叉: MA${config.fastMA}(${fastMA[last].toFixed(2)})↓穿 MA${config.slowMA}(${slowMA[last].toFixed(2)})` };
    }
    const trend = fastMA[last] > slowMA[last] ? "多头" : "空头";
    return { action: "hold", name, price, reason: `${trend}排列` };
  }

  // ===== 网格交易 =====

  async _evaluateGrid(strategy, code, price) {
    const config = strategy.config || STRATEGY_TYPES.grid.defaultConfig;
    const klines = await getKlineData(code, 90).catch(() => []);
    if (klines.length < 20) return { action: "hold", reason: "K线数据不足" };

    const closes = klines.map(k => k.close);
    const recentHigh = Math.max(...closes.slice(-20));
    const recentLow = Math.min(...closes.slice(-20));
    const range = recentHigh - recentLow;
    if (range < recentHigh * 0.03) return { action: "hold", reason: "窄幅震荡，不适合网格" };

    const gridSize = range / config.gridLevels;
    const grids = [];
    for (let i = 0; i <= config.gridLevels; i++) {
      grids.push({ level: recentLow + gridSize * i, price: +(recentLow + gridSize * i).toFixed(2) });
    }

    const name = await getStockName(code).catch(() => code);
    const bucket = Math.floor((price - recentLow) / gridSize);

    if (bucket <= 0) {
      return { action: "buy", name, price, reason: `网格下沿 ${grids[0].price}` };
    }
    if (bucket >= config.gridLevels) {
      return { action: "sell", name, price, reason: `网格上沿 ${grids[config.gridLevels].price}` };
    }

    const prevPrice = closes[closes.length - 2] || price;
    const prevBucket = Math.floor((prevPrice - recentLow) / gridSize);
    if (bucket > prevBucket) {
      return { action: "sell", name, price, reason: `上穿网格线` };
    }
    if (bucket < prevBucket) {
      return { action: "buy", name, price, reason: `下穿网格线` };
    }

    return { action: "hold", name, price, reason: `网格区间 [${recentLow.toFixed(2)}-${recentHigh.toFixed(2)}]` };
  }

  // ===== 突破策略 (新增) =====

  async _evaluateBreakout(strategy, code, price) {
    const config = strategy.config || STRATEGY_TYPES.breakout.defaultConfig;
    const klines = await getKlineData(code, 90).catch(() => []);
    if (klines.length < 30) return { action: "hold", reason: "数据不足" };

    const closes = klines.map(k => k.close);
    const highs  = klines.map(k => k.high);
    const lows   = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume);
    const last = closes.length - 1;

    const breakoutHigh = Math.max(...highs.slice(last - config.breakoutDays, last));
    const stopLow = Math.min(...lows.slice(last - config.stopDays, last));

    const avgVol = volumes.slice(last - 20, last).reduce((a, b) => a + b, 0) / 20;
    const volRatio = volumes[last] / (avgVol || 1);

    const name = await getStockName(code).catch(() => code);

    if (price >= breakoutHigh && (!config.requireVolumeConfirm || volRatio > 1.2)) {
      return { action: "buy", strength: 4, name, price, reason: `突破${config.breakoutDays}日高点 ${breakoutHigh.toFixed(2)} 量比${volRatio.toFixed(1)}x` };
    }
    if (price < stopLow) {
      return { action: "sell", strength: -3, name, price, reason: `跌破${config.stopDays}日低点 ${stopLow.toFixed(2)}` };
    }
    return { action: "hold", strength: price > breakoutHigh * 0.97 ? 1 : 0, name, price, reason: `${((price/breakoutHigh-1)*100).toFixed(1)}%距突破位` };
  }

  // ===== 动量轮动 (新增) =====

  async _evaluateMomentumRotation(strategy, code, price) {
    const config = strategy.config || STRATEGY_TYPES.momentum_rotation.defaultConfig;
    const pool = config.stockPool || [code];
    const klines = await getKlineData(code, 90).catch(() => []);
    if (klines.length < 30) return { action: "hold", reason: "数据不足" };

    const closes = klines.map(k => k.close);
    const last = closes.length - 1;
    const momentum = (closes[last] / closes[Math.max(0, last - config.momentumDays)] - 1) * 100;
    const name = await getStockName(code).catch(() => code);

    // 动量转负卖出
    if (momentum < -3) {
      return { action: "sell", strength: -2, name, price, reason: `动量转负 ${momentum.toFixed(1)}%` };
    }
    // 动量强 + 趋势向上买入
    if (momentum > 5) {
      const ma20 = this._sma(closes, 20);
      if (price > (ma20[last] || price)) {
        return { action: "buy", strength: 3, name, price, reason: `动量+${momentum.toFixed(1)}% 站上MA20` };
      }
    }
    return { action: "hold", strength: momentum > 0 ? 1 : -1, name, price, reason: `动量${momentum.toFixed(1)}% — 观察` };
  }

  // ===== 均值回归 (新增) =====

  async _evaluateMeanReversion(strategy, code, price) {
    const config = strategy.config || STRATEGY_TYPES.mean_reversion.defaultConfig;
    const klines = await getKlineData(code, 90).catch(() => []);
    if (klines.length < 30) return { action: "hold", reason: "数据不足" };

    const closes = klines.map(k => k.close);
    const { mid, upper, lower } = BOLL(closes, config.bollPeriod);
    const rsi14 = RSI(closes, 14);
    const last = closes.length - 1;

    const name = await getStockName(code).catch(() => code);

    // 布林下轨 + RSI超卖 → 买入
    if (lower[last] && price <= lower[last] * 1.02 && (rsi14[last] || 50) < config.rsiOversold) {
      return { action: "buy", strength: 3, name, price, reason: `布林下轨+RSI超卖(${rsi14[last]?.toFixed(1)}) — 均值回归买入` };
    }
    // 回归中轨 → 卖出
    if (mid[last] && price >= mid[last] && (rsi14[last] || 50) > 50) {
      return { action: "sell", strength: -2, name, price, reason: `回归中轨 ${mid[last].toFixed(2)} — 止盈` };
    }
    // 布林上轨 → 也可能卖出
    if (upper[last] && price >= upper[last] * 0.98 && (rsi14[last] || 50) > config.rsiOverbought) {
      return { action: "sell", strength: -3, name, price, reason: `布林上轨+RSI超买(${rsi14[last]?.toFixed(1)}) — 减仓` };
    }
    return { action: "hold", name, price, reason: `布林中轨 ${mid[last]?.toFixed(2)} RSI${rsi14[last]?.toFixed(1)}` };
  }

  // ===== T+3 回调低吸 (新增) =====

  async _evaluateT3Pullback(strategy, code, price) {
    const config = strategy.config || STRATEGY_TYPES.t3pullback.defaultConfig;
    const klines = await getKlineData(code, 60).catch(() => []);
    if (klines.length < 30) return { action: "hold", reason: "数据不足" };

    const opens   = klines.map(k => k.open);
    const closes  = klines.map(k => k.close);
    const highs   = klines.map(k => k.high);
    const lows    = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume);
    const last = klines.length - 1;
    const name = await getStockName(code).catch(() => code);

    // 回溯查找T+3模式
    for (let i = last; i >= last - 8 && i >= 3; i--) {
      const T0 = { open: opens[i-3], close: closes[i-3], high: highs[i-3], low: lows[i-3], volume: volumes[i-3] };
      const T1 = { open: opens[i-2], close: closes[i-2], high: highs[i-2], low: lows[i-2], volume: volumes[i-2] };
      const T2 = { open: opens[i-1], close: closes[i-1], high: highs[i-1], low: lows[i-1], volume: volumes[i-1] };

      if (T0.close <= 0 || T1.close <= 0 || T2.close <= 0) continue;
      if (price < 5.0) continue;

      // 5日均量
      let vol5Avg = 0;
      for (let j = i-8; j < i-3; j++) { if (j>=0 && volumes[j]) vol5Avg += volumes[j]; }
      vol5Avg = vol5Avg > 0 ? vol5Avg/5 : volumes[i-3];
      const volRatio = vol5Avg > 0 ? T0.volume/vol5Avg : 1;

      // T日: 放量 且 不涨停
      const t0Chg = (T0.close - T0.open) / T0.open * 100;
      if (volRatio < config.volumeThreshold) continue;
      if (t0Chg >= 9.5) continue;

      // T+1: 涨停
      const t1Chg = (T1.close - T1.open) / T1.open * 100;
      if (t1Chg < 9.5) continue;

      // T+2: 阴线
      if (T2.close >= T2.open) continue;

      // T+3 信号!
      if (i === last) {
        return {
          action: "buy", strength: 4, name, price,
          reason: `T+3回调低吸·放量${volRatio.toFixed(1)}x·涨停${t1Chg.toFixed(1)}%·阴线洗盘`
        };
      }

      // 持仓中, 持有期满卖出
      if (i < last && (last - i) >= config.holdDays) {
        return { action: "sell", strength: -3, name, price, reason: `T+3持有期满${config.holdDays}天` };
      }
      return { action: "hold", strength: 2, name, price, reason: `T+3观察中·${last-i}天` };
    }

    return { action: "hold", name, price, reason: "无T+3信号" };
  }

  // ===== 打板接力 (赵老哥/涅槃重升) =====

  async _evaluateLimitUpChase(strategy, code, price) {
    const config = strategy.config || STRATEGY_TYPES.limit_up_chase.defaultConfig;
    const klines = await getKlineData(code, 30).catch(() => []);
    if (klines.length < 10) return { action: "hold", reason: "数据不足" };

    const closes = klines.map(k => k.close);
    const opens = klines.map(k => k.open);
    const highs = klines.map(k => k.high);
    const volumes = klines.map(k => k.volume);
    const last = klines.length - 1;
    const name = await getStockName(code).catch(() => code);

    const cur = klines[last];
    const yesterday = klines[last - 1];
    const dayBefore = klines[last - 2];

    if (!yesterday || !dayBefore) return { action: "hold", reason: "数据不足" };

    // 条件1: 昨天首板 (昨天涨停, 前天未涨停)
    const yesterdayIsLU = isLimitUp(yesterday.close, dayBefore.close, yesterday.high);
    const dayBeforeIsLU = isLimitUp(dayBefore.close,
      klines[last - 3]?.close || dayBefore.close, dayBefore.high);
    const isFirstBoard = yesterdayIsLU && !dayBeforeIsLU;

    if (!isFirstBoard) return { action: "hold", reason: "非首板" };

    // 条件2: 封板质量 — 实体小 = 封得死
    const bodyRatio = Math.abs(yesterday.close - yesterday.open)
      / (yesterday.high - yesterday.low || 1);
    const volMA5 = volumes.slice(last - 6, last - 1).reduce((a, b) => a + b, 0) / 5;
    const volRatio = yesterday.volume / (volMA5 || 1);

    if (bodyRatio > 0.5) return { action: "hold", reason: "烂板(开板多次)" };
    if (volRatio < 1.3) return { action: "hold", reason: "封板量不足" };

    // 条件3: 今日高开确认
    const todayGap = (cur.open - yesterday.close) / yesterday.close;
    if (todayGap < config.minGap) return { action: "hold",
      reason: `未高开(${(todayGap*100).toFixed(1)}%)待观察` };
    if (todayGap > config.maxGap) return { action: "hold",
      reason: `高开过大(${(todayGap*100).toFixed(1)}%)追高风险` };

    // 条件4: 今日没崩 — 开盘后价格不能跌破昨日涨停价
    if (price < yesterday.close * 0.98) return { action: "sell",
      reason: "破板! 止损离场" };

    const sealQuality = bodyRatio < 0.15 ? "秒封" : bodyRatio < 0.3 ? "强封" : "换手封";
    return {
      action: "buy", strength: 5, name, price,
      reason: `打板接力·${sealQuality}·量比${volRatio.toFixed(1)}x·高开${(todayGap*100).toFixed(1)}%·明日溢价必走`
    };
  }

  // ===== 趋势波段 (方新侠/章盟主) =====

  async _evaluateTrendBand(strategy, code, price) {
    const config = strategy.config || STRATEGY_TYPES.trend_band.defaultConfig;
    const klines = await getKlineData(code, 250).catch(() => []);
    if (klines.length < 120) return { action: "hold", reason: "需要至少120根K线" };

    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume);
    const last = closes.length - 1;
    const name = await getStockName(code).catch(() => code);

    // 均线系统
    const ma20 = this._sma(closes, 20);
    const ma60 = this._sma(closes, 60);
    const ma120 = this._sma(closes, 120);

    const curMA20 = ma20[last];
    const curMA60 = ma60[last];
    const curMA120 = ma120[last];
    if (!curMA20 || !curMA60 || !curMA120) return { action: "hold", reason: "均线数据不足" };

    const isBullAlign = curMA20 > curMA60 && curMA60 > curMA120;

    if (!isBullAlign) return { action: "hold", reason: "均线非多头排列" };

    // 回踩MA20距离
    const distToMA20 = (price - curMA20) / curMA20;
    const isPullback = distToMA20 < config.pullbackTolerance && distToMA20 > -0.02;

    // 缩量回踩加分
    const volMA5 = volumes.slice(last - 5, last).reduce((a, b) => a + b, 0) / 5;
    const volMA20 = volumes.slice(last - 20, last).reduce((a, b) => a + b, 0) / 20;
    const isVolShrink = volMA5 < volMA20 * 0.85;

    // 趋势斜率
    const ma20Slope = ma20.length > 20
      ? (curMA20 - ma20[ma20.length - 21]) / ma20[ma20.length - 21] : 0;

    // 破MA60止损
    if (price < curMA60 * 0.98) {
      return { action: "sell", strength: -4, name, price,
        reason: `跌破MA60(${curMA60.toFixed(2)})趋势止损` };
    }

    // 买点: 回踩MA20不破
    if (isPullback && isVolShrink) {
      return { action: "buy", strength: 4, name, price,
        reason: `趋势回踩·距MA20${(distToMA20*100).toFixed(1)}%·缩量·斜率${(ma20Slope*100).toFixed(1)}%` };
    }
    if (isPullback) {
      return { action: "buy", strength: 3, name, price,
        reason: `趋势回踩·距MA20${(distToMA20*100).toFixed(1)}%` };
    }

    // 已有仓位且远离MA20 → 趋势运行中, 持有
    if (distToMA20 > 0.03 && distToMA20 < 0.15) {
      return { action: "hold", strength: 2, name, price,
        reason: `趋势持有·MA20上方${(distToMA20*100).toFixed(1)}%` };
    }

    // 高位远离 → 减仓提示
    if (distToMA20 > 0.20) {
      return { action: "sell", strength: -2, name, price,
        reason: `高位偏离MA20 ${(distToMA20*100).toFixed(1)}% — 考虑减仓` };
    }

    return { action: "hold", name, price,
      reason: `多头排列·距MA20 ${(distToMA20*100).toFixed(1)}%·等待回踩` };
  }

  // ===== 恐慌低吸 (炒股养家/歌神) =====

  async _evaluatePanicBuy(strategy, code, price) {
    const config = strategy.config || STRATEGY_TYPES.panic_buy.defaultConfig;
    const klines = await getKlineData(code, 120).catch(() => []);
    if (klines.length < 60) return { action: "hold", reason: "需要至少60根K线" };

    const closes = klines.map(k => k.close);
    const opens = klines.map(k => k.open);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume);
    const last = closes.length - 1;
    const name = await getStockName(code).catch(() => code);

    const cur = klines[last];

    // 条件1: 连跌 — 近5日至少3日收阴
    const recent5 = klines.slice(last - 5, last);
    const bearDays = recent5.filter(k => k.close < k.open).length;
    if (bearDays < 3) return { action: "hold", reason: "未连跌" };

    // 条件2: 跌幅 — 5日跌够
    const chg5 = (cur.close - closes[last - 5]) / closes[last - 5];
    if (chg5 > -0.06) return { action: "hold", reason: `跌幅不够(${(chg5*100).toFixed(1)}%)` };

    // 条件3: 缩量 — 今日量 < 20日均量 * 0.7
    const volMA20 = volumes.slice(last - 21, last - 1).reduce((a, b) => a + b, 0) / 20;
    const volRatio = cur.volume / (volMA20 || 1);
    if (volRatio > 0.8) return { action: "hold", reason: `尚未缩量(量比${volRatio.toFixed(2)})` };

    // 条件4: 企稳形态 — 十字星或长下影
    const body = Math.abs(cur.close - cur.open);
    const totalRange = cur.high - cur.low || 1;
    const lowerShadow = Math.min(cur.open, cur.close) - cur.low;
    const isDoji = body / totalRange < 0.25;
    const isHammer = lowerShadow > totalRange * 0.5;
    if (!isDoji && !isHammer) return { action: "hold", reason: "未企稳" };

    // 条件5: RSI超卖
    const rsi14 = RSI(closes, 14);
    const curRSI = rsi14[last];
    if (curRSI > 40) return { action: "hold", reason: `RSI=${curRSI.toFixed(0)}未超卖` };

    // 条件6: 不再创新低 — 今日低点 > 前3日低点的最低值
    const low3 = Math.min(...lows.slice(last - 3, last));
    if (cur.low < low3 * 0.99) return { action: "hold", reason: "仍在创新低" };

    // 信号强度
    let strength = 2;
    if (volRatio < 0.5) strength++;     // 极致缩量
    if (curRSI < 30) strength++;        // 深度超卖
    if (chg5 < -0.12) strength++;       // 跌透了
    if (isDoji && isHammer) strength++; // 双形态

    const pattern = isDoji && isHammer ? "十字星+长下影" : isDoji ? "地量十字星" : "锤子线";
    return {
      action: "buy", strength, name, price,
      reason: `恐慌低吸·${pattern}·跌${(chg5*100).toFixed(1)}%·量比${volRatio.toFixed(2)}·RSI${curRSI.toFixed(0)}`
    };
  }

  // ===== HCCI 完美压燃自适应策略 =====

  async _evaluateHCCI(strategy, code, price) {
    const { HCCIEngine } = require("./hcci-engine");
    if (!this._hcciEngines) this._hcciEngines = new Map();
    let eng = this._hcciEngines.get(code);
    if (!eng) { eng = new HCCIEngine(); this._hcciEngines.set(code, eng); }

    const klines = await getKlineData(code, 120).catch(() => []);
    if (klines.length < 60) return { action: "hold", name: code, price, reason: "数据不足" };

    const cash = 1000000;
    const position = this._hcciPositions?.get(code) || 0;
    const avgCost = this._hcciAvgCosts?.get(code) || 0;

    const result = eng.step(klines, cash, position, avgCost, price);
    return {
      action: result.action, strength: result.action === "buy" ? 3 : result.action === "sell" ? -3 : 0,
      name: code, price,
      reason: `${result.reason} | RON=${result.ron.toFixed(2)} HCCI=${result.ihcci.toFixed(2)} Rt=${(result.rt/eng.R0*100).toFixed(0)}%`
    };
  }

  _sma(arr, n) {
    const result = new Array(arr.length).fill(null);
    for (let i = n - 1; i < arr.length; i++) {
      result[i] = arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n;
    }
    return result;
  }
}

module.exports = { StrategyEngine, STRATEGY_TYPES };

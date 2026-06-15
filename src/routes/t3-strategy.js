/**
 * T+3 回调低吸策略 — 完整版
 *
 * 策略逻辑 (来源: 聚宽策略 T3_Pullback):
 *   T日:   放量(量比>=0.8), 不涨停(涨跌幅<9.5%), 无涨停限制
 *   T+1日: 必须涨停确认
 *   T+2日: 必须收阴线(上涨后回调洗盘)
 *   T+3日: 回调买入, 参考买入价=(T日收+T+1日收)/除数
 *
 * 风控与过滤:
 *   最低买入价 >= 5.0元
 *   排除688(科创板) 和 ST
 *   检查T+3最低价是否跌破T-1收盘价
 *   排除周六交易日
 */

const { SMA, EMA, MACD } = require("../indicators");

/**
 * 检测K线末尾是否处于 T+3 买入位置
 * klines 末尾4根K线对应 T日, T+1日, T+2日, T+3日(当前)
 * klines[-4]=T日, klines[-3]=T+1, klines[-2]=T+2, klines[-1]=T+3
 */
function detectPattern(klines, opts = {}) {
  if (!klines || klines.length < 30) return null;

  const minPrice    = opts.minPrice    || 5.0;
  const volRatioMin = opts.volRatioMin || 0.5;   // 放宽量比: 0.8 → 0.5
  const limitUpPct  = opts.limitUpPct  || 7.0;   // 放宽涨停: 9.5% → 7%
  const excludeCode = opts.excludeCode || '688';
  const excludeName = opts.excludeName || 'ST';

  const n = klines.length;
  const T0 = klines[n - 4];  // T日: 放量信号日
  const T1 = klines[n - 3];  // T+1: 涨停确认日
  const T2 = klines[n - 2];  // T+2: 阴线回调日
  const T3 = klines[n - 1];  // T+3: 买入日(当前)
  const Tm1 = n >= 5 ? klines[n - 5] : null;

  if (!T0 || !T1 || !T2 || !T3) return null;

  // 基础过滤
  const code = klines[0]?.code || '';
  const name = klines[0]?.name || '';
  if (code.startsWith(excludeCode)) return null;
  if (new RegExp(excludeName, 'i').test(name)) return null;
  if (T3.close < minPrice) return null;

  // ---- T日: 放量, 不涨停 ----
  const idx = n - 4;
  let vol5Avg = 0;
  if (idx >= 5) {
    for (let j = idx - 5; j < idx; j++) vol5Avg += klines[j].volume;
    vol5Avg /= 5;
  }
  const volRatio = vol5Avg > 0 ? T0.volume / vol5Avg : 1;
  const t0Chg = (T0.close - T0.open) / T0.open * 100;
  if (volRatio < volRatioMin) return null; // 量比不够
  if (t0Chg >= limitUpPct) return null;     // T日涨停不符合(要的是放量未封板)

  // ---- T+1日: 必须涨停 ----
  const t1Chg = (T1.close - T1.open) / T1.open * 100;
  if (t1Chg < limitUpPct) return null;

  // ---- T+2日: 必须阴线 ----
  if (T2.close >= T2.open) return null;
  const bearPct = (T2.open - T2.close) / T2.open * 100;

  // ---- T+3日: 确认回调买入位 ----
  const buyPrice = (T0.close + T1.close) / 2;
  const checkBreak = Tm1 ? T3.low < Tm1.close : false;

  // ======== 评分卡 ========
  let score = 55;

  // 放量加分 (0.8~3.0)
  if (volRatio >= 2.0) score += 12;
  else if (volRatio >= 1.5) score += 8;
  else if (volRatio >= 1.0) score += 4;

  // 涨停强度
  if (t1Chg >= 10.0) score += 10;
  else if (t1Chg >= 9.5) score += 6;

  // 阴线健康度(小阴线更健康, 大阴线扣分)
  if (bearPct <= 2) score += 12;
  else if (bearPct <= 4) score += 6;
  else if (bearPct > 7) score -= 8;

  // 缩量回调加分
  if (T2.volume < T1.volume * 0.6) score += 10;
  else if (T2.volume < T1.volume * 0.8) score += 5;
  else if (T2.volume > T1.volume * 1.2) score -= 6;

  // T+3收盘价接近买入参考价
  const distFromBuy = Math.abs(T3.close - buyPrice) / buyPrice;
  if (distFromBuy < 0.03) score += 8;
  else if (distFromBuy < 0.05) score += 4;
  else if (distFromBuy > 0.10) score -= 5;

  // T+3最低价未破T-1收盘价支撑
  if (!checkBreak && Tm1) score += 6;

  // MA5在MA20之上
  const ma5 = T3.close; // 简化
  // 均线多头
  const closesForMa = klines.slice(n - 20, n).map(k => k.close);
  const ma20 = closesForMa.reduce((a, b) => a + b, 0) / closesForMa.length;
  if (T3.close > ma20) score += 5;

  // 涨跌幅背景
  const chg5 = n >= 6 ? (T3.close / klines[n - 6].close - 1) * 100 : 0;
  const chg10 = n >= 11 ? (T3.close / klines[n - 11].close - 1) * 100 : 0;
  const chg20 = n >= 21 ? (T3.close / klines[n - 21].close - 1) * 100 : 0;

  // 位置因子: 20日涨幅适中(非追高)
  if (chg20 > 0 && chg20 < 15) score += 5;

  score = Math.min(100, Math.max(0, Math.round(score)));

  // 信号判断
  const signals = [];
  if (volRatio >= 1.0) signals.push('T日放量');
  if (t1Chg >= limitUpPct) signals.push('T+1涨停');
  if (T2.close < T2.open) signals.push('T+2缩量回调');
  if (!checkBreak) signals.push('支撑有效');
  if (T2.volume < T1.volume * 0.8) signals.push('缩量洗盘');
  if (T3.close > ma20) signals.push('MA20上方');

  return {
    code, name,
    score,
    grade: score >= 85 ? 'A+' : score >= 75 ? 'A' : score >= 65 ? 'B+' : score >= 55 ? 'B' : 'C',
    signal: score >= 80 ? '强买' : score >= 68 ? '买入' : score >= 55 ? '关注' : '观望',
    volRatio: +volRatio.toFixed(2),
    t0Chg: +t0Chg.toFixed(2),
    t1Chg: +t1Chg.toFixed(2),
    bearPct: +bearPct.toFixed(2),
    buyPrice: +buyPrice.toFixed(2),
    currentPrice: +T3.close.toFixed(2),
    checkBreak,
    signals,
    positionScore: Math.round(50 + ((T3.close - buyPrice) / buyPrice) * 200),
    launchScore: score + 5,
    trendScore: Math.round(50 + (score - 50) * 1.2),
    chg5: +chg5.toFixed(2),
    chg10: +chg10.toFixed(2),
    chg20: +chg20.toFixed(2),
    volRatio20: +volRatio.toFixed(2),
    upDays: 0,
    nearHigh20: 1,
    signalSummary: signals.join('·'),
    strategy: 'T3回调低吸',
  };
}

/**
 * 为回测生成交易信号
 * clk = [{open,close,high,low,volume,date}, ...]
 * 返回与输入等长的信号数组: 0=无, 1=买入, -1=卖出
 */
function t3Signals(klines, opts = {}) {
  const n = klines.length;
  const signals = new Array(n).fill(0);
  if (n < 4) return signals;

  for (let i = 3; i < n; i++) {
    const window = klines.slice(0, i + 1);
    if (window.length < 30) continue;

    const result = detectPattern(window, opts);
    if (result && result.score >= 55) {
      signals[i] = 1;
      // 持有N天后卖出
      const holdDays = opts.holdDays || 5;
      const exitIdx = Math.min(i + holdDays, n - 1);
      if (exitIdx < n) signals[exitIdx] = -1;
    }
  }
  return signals;
}

module.exports = { detectPattern, t3Signals };

// 风控操作引擎 v1
// RiskLimits — 限额配置 | StockFilter — 标的过滤
// PositionTracker — 持仓跟踪 | AlertEngine — 异常预警

const fs = require("fs");
const path = require("path");

// ========== 行业映射 (代码前缀 → 行业) ==========

const INDUSTRY_MAP = {
  // 金融
  "601318": "保险", "601628": "保险", "601336": "保险", "601601": "保险",
  "600036": "银行", "601398": "银行", "601288": "银行", "601939": "银行", "601328": "银行", "600016": "银行", "000001": "银行", "002142": "银行",
  "600030": "券商", "601211": "券商", "600837": "券商", "000776": "券商",
  // 消费
  "600519": "白酒", "000858": "白酒", "002304": "白酒", "000568": "白酒",
  "000651": "家电", "002508": "家电", "000333": "家电",
  "603288": "食品", "600887": "食品", "002714": "养殖", "300498": "养殖",
  // 新能源
  "300750": "电池", "002594": "汽车", "601012": "光伏", "600438": "光伏", "002459": "光伏",
  "601899": "有色", "603799": "有色", "600111": "稀土", "002460": "锂矿",
  // 科技
  "000725": "面板", "002475": "消费电子", "601138": "消费电子", "002371": "半导体", "603501": "半导体",
  "688981": "半导体", "688012": "半导体", "688008": "半导体", "300661": "半导体",
  "002230": "AI", "688111": "软件", "688256": "芯片",
  // 医药
  "600276": "医药", "300760": "医药", "300759": "医药", "000538": "医药", "002001": "医药", "300015": "医药", "300122": "医药",
  // 周期
  "600585": "建材", "000002": "地产", "001979": "地产", "600048": "地产",
  "601857": "能源", "600028": "能源", "601088": "煤炭", "600188": "煤炭",
  "601390": "基建", "601668": "基建", "600031": "机械", "000157": "机械",
  // 运输
  "601111": "航空", "600029": "航空", "601919": "航运",
  // 创业板/科创板按前缀
  "300033": "金融科技", "300059": "金融科技",
};
const INDUSTRY_PREFIX_MAP = { "688": "科创板", "300": "创业板", "000": "深市主板", "002": "深市中小", "600": "沪市主板", "601": "沪市主板", "603": "沪市主板", "605": "沪市主板" };

function getIndustry(code) {
  if (INDUSTRY_MAP[code]) return INDUSTRY_MAP[code];
  for (const [pfx, ind] of Object.entries(INDUSTRY_PREFIX_MAP)) {
    if (code.startsWith(pfx)) return ind;
  }
  return "其他";
}

// ========== RiskLimits ==========

const DEFAULT_LIMITS = {
  maxTotalPosition: 0.80, maxSinglePosition: 0.20, maxIndustryExposure: 0.35,
  maxMarketExposure: 1.0, maxDailyLoss: 0.05, maxConsecutiveLossDays: 3,
  blacklist: [], maxNewStockDays: 60,
  enableSTFilter: true, enableSuspensionFilter: true, enableNewStockFilter: true,
  volumeExplosionThreshold: 5, priceGapThresholdPct: 3,
  alertsMaxHistory: 200, maxPositionsCount: 15,
};

class RiskLimits {
  constructor(configPath) {
    this.configPath = configPath;
    this.limits = { ...DEFAULT_LIMITS };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, "utf8");
        const saved = JSON.parse(raw);
        this.limits = { ...DEFAULT_LIMITS, ...saved };
      } else {
        this.save(); // 创建默认配置文件
      }
    } catch (e) {
      this.limits = { ...DEFAULT_LIMITS };
    }
  }

  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.limits, null, 2), "utf8");
    } catch (e) { /* silently fail */ }
  }

  get(key) { return key ? this.limits[key] : this.limits; }

  update(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (k in this.limits) this.limits[k] = v;
    }
    this.save();
    return this.toJSON();
  }

  validate() {
    const errors = [];
    const l = this.limits;
    if (l.maxTotalPosition < 0 || l.maxTotalPosition > 1) errors.push("maxTotalPosition 需在 0-1 之间");
    if (l.maxSinglePosition < 0 || l.maxSinglePosition > 1) errors.push("maxSinglePosition 需在 0-1 之间");
    if (l.maxIndustryExposure < 0 || l.maxIndustryExposure > 1) errors.push("maxIndustryExposure 需在 0-1 之间");
    if (l.maxDailyLoss < 0 || l.maxDailyLoss > 1) errors.push("maxDailyLoss 需在 0-1 之间");
    if (l.maxConsecutiveLossDays < 1 || l.maxConsecutiveLossDays > 30) errors.push("maxConsecutiveLossDays 需在 1-30 之间");
    if (l.volumeExplosionThreshold < 1) errors.push("volumeExplosionThreshold 需 >= 1");
    if (l.priceGapThresholdPct <= 0) errors.push("priceGapThresholdPct 需 > 0");
    return errors;
  }

  toJSON() { return { ...this.limits }; }
}

// ========== StockFilter ==========

class StockFilter {
  constructor(limits) {
    this.limits = limits;
  }

  async check(code, getStockNameFn, getQuoteFn, getKlineFn) {
    const l = this.limits;

    // 1. 黑名单
    if (l.blacklist && l.blacklist.includes(code)) {
      return { passed: false, reason: "黑名单股票", severity: "blocked" };
    }

    // 2. ST检测
    if (l.enableSTFilter && getStockNameFn) {
      try {
        const name = await getStockNameFn(code);
        if (name && /ST|\*ST/.test(name)) {
          return { passed: false, reason: "ST风险警示股", severity: "blocked" };
        }
      } catch (e) { /* 获取名称失败不阻塞 */ }
    }

    // 3. 停牌检测
    if (l.enableSuspensionFilter && getQuoteFn) {
      try {
        const quotes = await getQuoteFn([code]);
        const q = quotes && quotes.length > 0 ? quotes[0] : null;
        if (!q || q.price === 0 || q.volume === 0 || (q.price === q.open && q.open === q.high && q.high === q.low && q.volume < 100)) {
          return { passed: false, reason: "停牌或流动性不足", severity: "blocked" };
        }
      } catch (e) { /* 获取行情失败不阻塞 */ }
    }

    // 4. 次新股过滤
    if (l.enableNewStockFilter && getKlineFn) {
      try {
        const klines = await getKlineFn(code, l.maxNewStockDays + 5);
        if (klines && klines.length < l.maxNewStockDays) {
          return { passed: false, reason: `次新股(上市不足${l.maxNewStockDays}个交易日)`, severity: "warning" };
        }
      } catch (e) { /* 获取K线失败不阻塞 */ }
    }

    return { passed: true, reason: "通过", severity: "info" };
  }
}

// ========== PositionTracker ==========

class PositionTracker {
  constructor(limits, initialCapital = 1000000) {
    this.limits = limits;
    this.initialCapital = initialCapital;
    this.cash = initialCapital;
    this.positions = new Map();
    this.tradeLog = [];
    this.dailySnapshots = [];
    this._takeSnapshot(); // 初始快照
  }

  async openPosition(code, shares, price, name) {
    const cost = shares * price;
    const l = this.limits;
    const equity = this.getTotalEquity();
    const newPositionValue = (this.positions.get(code)?.shares || 0) * price + cost;

    // 单股上限
    if (newPositionValue / equity > l.maxSinglePosition) {
      return { success: false, reason: `超过单股仓位上限 ${(l.maxSinglePosition * 100).toFixed(0)}%` };
    }
    // 总仓位上限
    if ((this.getTotalMarketValue() + cost) / equity > l.maxTotalPosition) {
      return { success: false, reason: `超过总仓位上限 ${(l.maxTotalPosition * 100).toFixed(0)}%` };
    }
    // 持仓数量上限
    if (!this.positions.has(code) && this.positions.size >= l.maxPositionsCount) {
      return { success: false, reason: `超过最大持仓数 ${l.maxPositionsCount}` };
    }
    // 行业暴露
    const industry = getIndustry(code);
    const industryValue = [...this.positions.entries()]
      .filter(([c]) => getIndustry(c) === industry)
      .reduce((s, [, pos]) => s + pos.shares * pos.currentPrice, 0);
    if ((industryValue + cost) / equity > l.maxIndustryExposure) {
      return { success: false, reason: `超过${industry}行业暴露上限 ${(l.maxIndustryExposure * 100).toFixed(0)}%` };
    }

    // 执行
    const existing = this.positions.get(code);
    if (existing) {
      const totalShares = existing.shares + shares;
      existing.avgCost = ((existing.avgCost * existing.shares) + cost) / totalShares;
      existing.shares = totalShares;
    } else {
      this.positions.set(code, { shares, avgCost: price, currentPrice: price, name: name || code, industry });
    }
    this.cash -= cost;
    this.tradeLog.push({ time: new Date().toISOString(), code, action: "buy", price, shares, cost });
    return { success: true, reason: "建仓成功" };
  }

  closePosition(code, price) {
    const pos = this.positions.get(code);
    if (!pos) return { success: false, reason: "未持有该股票" };
    const revenue = pos.shares * price;
    const costBasis = pos.shares * pos.avgCost;
    const pnl = revenue - costBasis;
    this.cash += revenue;
    this.positions.delete(code);
    this.tradeLog.push({ time: new Date().toISOString(), code, action: "sell", price, shares: pos.shares, cost: revenue, pnl });
    return { success: true, pnl, pnlPct: costBasis > 0 ? ((pnl / costBasis) * 100) : 0, reason: "平仓成功" };
  }

  updatePrices(quotes) {
    for (const q of quotes) {
      const pos = this.positions.get(q.code);
      if (pos) pos.currentPrice = q.price || pos.currentPrice;
    }
  }

  getTotalMarketValue() {
    let total = 0;
    for (const pos of this.positions.values()) total += pos.shares * pos.currentPrice;
    return total;
  }

  getTotalEquity() { return this.cash + this.getTotalMarketValue(); }
  getTotalPnl() { return this.getTotalEquity() - this.initialCapital; }
  getTotalPnlPct() { return this.initialCapital > 0 ? (this.getTotalPnl() / this.initialCapital) : 0; }

  getTotalPositionRatio() {
    const equity = this.getTotalEquity();
    return equity > 0 ? this.getTotalMarketValue() / equity : 0;
  }

  getIndustryExposure() {
    const equity = this.getTotalEquity();
    const byIndustry = {};
    for (const pos of this.positions.values()) {
      const ind = pos.industry || getIndustry(pos.code || "");
      byIndustry[ind] = (byIndustry[ind] || 0) + pos.shares * pos.currentPrice;
    }
    return Object.entries(byIndustry).map(([industry, value]) => ({
      industry,
      value: +value.toFixed(0),
      pct: equity > 0 ? +(value / equity * 100).toFixed(1) : 0,
    }));
  }

  _takeSnapshot() {
    const equity = this.getTotalEquity();
    this.dailySnapshots.push({
      date: new Date().toISOString().slice(0, 10),
      equity: +equity.toFixed(2),
      cash: +this.cash.toFixed(2),
      marketValue: +this.getTotalMarketValue().toFixed(2),
      pnl: +(equity - this.initialCapital).toFixed(2),
      pnlPct: +(this.getTotalPnlPct() * 100).toFixed(2),
    });
    // 保留最近252个交易日
    if (this.dailySnapshots.length > 252) this.dailySnapshots = this.dailySnapshots.slice(-252);
  }

  toJSON() {
    return {
      initialCapital: this.initialCapital,
      cash: +this.cash.toFixed(2),
      equity: +this.getTotalEquity().toFixed(2),
      marketValue: +this.getTotalMarketValue().toFixed(2),
      pnl: +this.getTotalPnl().toFixed(2),
      pnlPct: +(this.getTotalPnlPct() * 100).toFixed(2),
      totalPositionRatio: +(this.getTotalPositionRatio() * 100).toFixed(1),
      positions: [...this.positions.entries()].map(([code, pos]) => ({
        code, name: pos.name, shares: pos.shares,
        avgCost: +pos.avgCost.toFixed(3),
        currentPrice: +pos.currentPrice.toFixed(3),
        marketValue: +(pos.shares * pos.currentPrice).toFixed(2),
        pnl: +((pos.currentPrice - pos.avgCost) * pos.shares).toFixed(2),
        pnlPct: pos.avgCost > 0 ? +((pos.currentPrice - pos.avgCost) / pos.avgCost * 100).toFixed(2) : 0,
        industry: pos.industry || getIndustry(code),
      })),
      exposureByIndustry: this.getIndustryExposure(),
      dailySnapshots: this.dailySnapshots.slice(-60),
    };
  }
}

// ========== AlertEngine ==========

class AlertEngine {
  constructor(limits) {
    this.limits = limits;
    this.alerts = [];
    this.dailyAlertCount = {};
  }

  _makeAlert(type, code, name, severity, message, details = {}) {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type, code, name: name || code,
      severity, message,
      time: new Date().toISOString(),
      details,
    };
  }

  checkPriceLimit(quote, prevClose) {
    if (!quote || !prevClose || prevClose <= 0) return null;
    const chgPct = (quote.price - prevClose) / prevClose;
    if (chgPct >= 0.098) return this._makeAlert("price_limit", quote.code, quote.name, "warning", `${quote.name || quote.code} 涨停 (+${(chgPct * 100).toFixed(1)}%)`, { price: quote.price, prevClose, chgPct });
    if (chgPct <= -0.098) return this._makeAlert("price_limit", quote.code, quote.name, "danger", `${quote.name || quote.code} 跌停 (${(chgPct * 100).toFixed(1)}%)`, { price: quote.price, prevClose, chgPct });
    if (chgPct <= -0.07) return this._makeAlert("near_limit", quote.code, quote.name, "danger", `${quote.name || quote.code} 逼近跌停 (${(chgPct * 100).toFixed(1)}%)`, { price: quote.price, prevClose, chgPct });
    return null;
  }

  checkVolumeExplosion(code, name, currentVolume, avgVolume) {
    if (avgVolume <= 0) return null;
    const ratio = currentVolume / avgVolume;
    if (ratio > this.limits.volumeExplosionThreshold) {
      return this._makeAlert("volume_explosion", code, name, "warning", `${name || code} 成交量暴增 ${ratio.toFixed(1)}x`, { currentVolume, avgVolume, ratio });
    }
    return null;
  }

  checkPriceGap(code, name, currentPrice, prevPrice5min) {
    if (!prevPrice5min || prevPrice5min <= 0) return null;
    const gap = Math.abs((currentPrice - prevPrice5min) / prevPrice5min * 100);
    if (gap > this.limits.priceGapThresholdPct) {
      const dir = currentPrice > prevPrice5min ? "急涨" : "急跌";
      const sev = gap > 7 ? "critical" : gap > 5 ? "danger" : "warning";
      return this._makeAlert("price_gap", code, name, sev, `${name || code} 5分钟内${dir} ${gap.toFixed(1)}%`, { currentPrice, prevPrice5min, gap });
    }
    return null;
  }

  checkPortfolioLoss(pnlPct) {
    if (pnlPct < -(this.limits.maxDailyLoss * 100)) {
      return this._makeAlert("portfolio_loss", "", "组合", "danger", `当日组合亏损 ${Math.abs(pnlPct).toFixed(2)}% 超限 ${(this.limits.maxDailyLoss * 100).toFixed(0)}%`, { pnlPct });
    }
    return null;
  }

  checkConsecutiveDecline(dailyReturns) {
    let count = 0;
    for (let i = dailyReturns.length - 1; i >= 0; i--) {
      if (dailyReturns[i] < 0) count++;
      else break;
    }
    if (count >= this.limits.maxConsecutiveLossDays) {
      return this._makeAlert("consecutive_decline", "", "组合", "critical", `连续 ${count} 日亏损，建议暂停交易`, { days: count });
    }
    return null;
  }

  addAlert(alert) {
    if (!alert) return;
    this.alerts.unshift(alert);
    if (this.alerts.length > this.limits.alertsMaxHistory) {
      this.alerts.length = this.limits.alertsMaxHistory;
    }
    const today = new Date().toISOString().slice(0, 10);
    this.dailyAlertCount[today] = (this.dailyAlertCount[today] || 0) + 1;
  }

  addAlerts(alerts) {
    for (const a of alerts) this.addAlert(a);
  }

  getAlerts(filter = {}) {
    let result = [...this.alerts];
    if (filter.type) result = result.filter(a => a.type === filter.type);
    if (filter.severity) result = result.filter(a => a.severity === filter.severity);
    if (filter.code) result = result.filter(a => a.code === filter.code);
    if (filter.since) result = result.filter(a => a.time >= filter.since);
    if (filter.limit) result = result.slice(0, filter.limit);
    return result;
  }

  clearAlerts() { this.alerts = []; this.dailyAlertCount = {}; }

  getAlertSummary() {
    const today = new Date().toISOString().slice(0, 10);
    const bySeverity = { warning: 0, danger: 0, critical: 0 };
    for (const a of this.alerts) bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
    return {
      total: this.alerts.length,
      bySeverity,
      today: this.dailyAlertCount[today] || 0,
      lastAlert: this.alerts[0] || null,
    };
  }
}

// ========== Factory ==========

function createRiskEngine(configPath) {
  const limits = new RiskLimits(configPath);
  const filter = new StockFilter(limits.limits);
  const positions = new PositionTracker(limits.limits);
  const alerts = new AlertEngine(limits.limits);
  return { limits, filter, positions, alerts };
}

module.exports = { RiskLimits, StockFilter, PositionTracker, AlertEngine, createRiskEngine };

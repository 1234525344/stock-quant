// 实时数据引擎 v6 — 核心
// 数据融合: TDX本地文件 → TDX TCP → 新浪HTTP (fallback链)
// WebSocket per-client订阅 + 自适应轮询 + 请求去重 + 增量指标

const EventEmitter = require("events");
const { logger } = require("./logger");
const { IndicatorBuffer } = require("./indicators");
const { getTDXSnapshot, watchTDXFile, getTDXKline, getTDXRoot, unwatchAll } = require("./tdx-reader");
const { getTDXTCPClient } = require("./tdx-tcp");
const { dedupedGet } = require("./data");
const iconv = require("iconv-lite");

const CACHE_TTL = 500;

const { isTradingHours } = require("./helpers");

// ============ 交易时段判断 ============
function isNearOpen() {
  const now = new Date();
  const t = now.getHours() * 60 + now.getMinutes();
  return (t >= 555 && t < 575) || (t >= 870 && t < 890);
}

class RealtimeEngine extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.quoteCache = new Map();
    this.indicatorCache = new Map();
    this.subscribedCodes = new Set();
    this.tdxAvailable = false;
    this.tcpConnected = false;
    this.tcpClient = null;
    this._pollTimer = null;
    this._running = false;
    this._pollInterval = 3000;
    this._clientCount = 0;
    this._inflightFetch = null; // 去重: 飞行中的批量请求
  }

  // ================== 生命周期 ==================

  start(wsServer, opts = {}) {
    this._running = true;
    this.wss = wsServer;
    if (this.wss) this._setupWebSocket();

    this.tdxAvailable = getTDXRoot() !== null;
    if (this.tdxAvailable) {
      logger.info("[实时引擎] 通达信本地数据已启用:", getTDXRoot());
    } else {
      logger.info("[实时引擎] 未检测到通达信, 使用HTTP数据源");
    }

    this._startAdaptivePolling();
    return this;
  }

  stop() {
    this._running = false;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    unwatchAll();
    if (this.tcpClient) this.tcpClient.disconnect();
    this.quoteCache.clear();
    this.indicatorCache.clear();
    this.subscribedCodes.clear();
  }

  // ================== WebSocket (per-client订阅) ==================

  _setupWebSocket() {
    this.wss.on("connection", (ws) => {
      this._clientCount++;
      ws._subscribedCodes = new Set();
      ws._isAlive = true;

      ws.on("pong", () => { ws._isAlive = true; });

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "subscribe" && Array.isArray(msg.codes)) {
            ws._subscribedCodes = new Set(msg.codes);
            this.subscribeCodes(msg.codes);
          } else if (msg.type === "unsubscribe" && Array.isArray(msg.codes)) {
            for (const c of msg.codes) ws._subscribedCodes.delete(c);
          } else if (msg.type === "ping") {
            this._safeSend(ws, { type: "pong", timestamp: Date.now() });
          }
        } catch (e) {}
      });

      ws.on("close", () => {
        this._clientCount--;
        if (this._clientCount <= 0) {
          // 无客户端时降频
          this._pollInterval = 30000;
        }
      });

      // 发送当前缓存行情快照
      const snapshot = [];
      for (const [code, entry] of this.quoteCache) {
        snapshot.push(entry.data);
      }
      if (snapshot.length > 0) {
        this._safeSend(ws, { type: "snapshot", quotes: snapshot, timestamp: Date.now() });
      }
    });

    // 每30秒心跳检测
    this._heartbeatTimer = setInterval(() => {
      if (!this.wss) return;
      this.wss.clients.forEach((ws) => {
        if (ws._isAlive === false) return ws.terminate();
        ws._isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  // 只向订阅了该code的客户端推送
  _broadcastFiltered(code, data) {
    if (!this.wss) return;
    const msg = JSON.stringify({ type: "quote", code, data, timestamp: Date.now() });
    for (const ws of this.wss.clients) {
      if (ws.readyState === 1 && (!ws._subscribedCodes || ws._subscribedCodes.has(code))) {
        try { ws.send(msg); } catch (e) {}
      }
    }
  }

  _broadcastAll(data) {
    if (!this.wss) return;
    const msg = JSON.stringify(data);
    for (const ws of this.wss.clients) {
      try { if (ws.readyState === 1) ws.send(msg); } catch (e) {}
    }
  }

  _safeSend(ws, data) {
    try { if (ws.readyState === 1) ws.send(JSON.stringify(data)); } catch (e) {}
  }

  // ================== 订阅管理 ==================

  subscribeCodes(codes) {
    const newCodes = [];
    for (const code of codes) {
      if (!this.subscribedCodes.has(code)) {
        this.subscribedCodes.add(code);
        newCodes.push(code);
      }
    }
    if (newCodes.length === 0) return;

    // TDX文件监控
    if (this.tdxAvailable) {
      for (const code of newCodes) {
        watchTDXFile(code, (quote) => this._updateQuote(quote.code, quote));
      }
    }

    // TCP订阅
    if (this.tcpClient && this.tcpConnected) {
      this.tcpClient.subscribe(newCodes);
    }

    // 立即拉取
    this._fetchQuotes(newCodes);
  }

  getQuote(code) {
    const entry = this.quoteCache.get(code);
    if (entry && Date.now() - entry.time < CACHE_TTL) return entry.data;
    return null;
  }

  getQuotes(codes) {
    return codes.map(c => this.getQuote(c)).filter(Boolean);
  }

  // ================== 行情获取 (请求去重) ==================

  async _fetchQuotes(codes) {
    // 1. TDX本地
    if (this.tdxAvailable) {
      const tdxData = getTDXSnapshot(codes);
      for (const q of tdxData) {
        if (q.price > 0) this._updateQuote(q.code, q);
      }
    }

    // 2. 需要HTTP补充的
    const needFetch = codes.filter(c => {
      const entry = this.quoteCache.get(c);
      return !entry || Date.now() - entry.time >= CACHE_TTL;
    });
    if (needFetch.length === 0) return;

    // 请求去重: 如果已有飞行中的请求，等待其结果
    if (this._inflightFetch) {
      await this._inflightFetch;
      return;
    }

    this._inflightFetch = this._fetchSinaQuotes(needFetch).catch(() => {});
    await this._inflightFetch;
    this._inflightFetch = null;
  }

  async _fetchSinaQuotes(codes) {
    const symbols = codes.map(c =>
      (c.startsWith("5") || c.startsWith("6")) ? `sh${c}` : `sz${c}`
    ).join(",");

    try {
      const url = `https://hq.sinajs.cn/list=${symbols}`;
      const resp = await dedupedGet(url, {
        timeout: 5000,
        responseType: "arraybuffer",
        headers: { Referer: "https://finance.sina.com.cn" },
      });
      const data = iconv.decode(Buffer.from(resp.data), "GBK");
      if (!data) return;

      const lines = data.split("\n").filter(Boolean);
      for (const line of lines) {
        const match = line.match(/hq_str_(.+)="(.+)"/);
        if (!match) continue;
        const [, symbol, raw] = match;
        const fields = raw.split(",");
        if (fields.length < 10) continue;
        const code = symbol.slice(2);
        const quote = {
          code, name: fields[0],
          open: +fields[1], preClose: +fields[2], price: +fields[3],
          high: +fields[4], low: +fields[5],
          volume: +fields[8], amount: +fields[9],
          change: fields[3] && fields[2] ? +(((fields[3] - fields[2]) / fields[2]) * 100).toFixed(2) : null,
          changeAmount: fields[3] && fields[2] ? +(fields[3] - fields[2]).toFixed(2) : null,
          source: "sina_http",
        };
        this._updateQuote(code, quote);
      }
    } catch (e) {}
  }

  // ================== 行情更新 ==================

  _updateQuote(code, quote) {
    quote.timestamp = Date.now();
    this.quoteCache.set(code, { time: Date.now(), data: quote });
    this._updateIndicator(code, quote);

    // 只推送给订阅了该code的客户端
    this._broadcastFiltered(code, quote);
    this.emit("quote", quote);
  }

  // ================== 增量指标 ==================

  _updateIndicator(code, quote) {
    let buf = this.indicatorCache.get(code);
    if (!buf) {
      buf = new IndicatorBuffer(60);
      this.indicatorCache.set(code, buf);
    }

    // 预热：仅首次调用时从TDX本地文件加载历史K线，避免重复同步I/O
    if (this.tdxAvailable && buf.size() === 0 && !buf._warmed) {
      buf._warmed = true;
      setImmediate(() => {
        try {
          const klines = getTDXKline(code, 60);
          if (klines.length > 0) buf.warmup(klines);
        } catch (_) {}
      });
    }

    buf.push({
      close: quote.price,
      high: quote.high,
      low: quote.low,
      volume: quote.volume,
      open: quote.open || quote.price,
    });
  }

  getIndicatorSnapshot(code) {
    const buf = this.indicatorCache.get(code);
    if (!buf) return null;
    return buf.snapshot ? buf.snapshot() : buf.toArrays();
  }

  // ================== 自适应轮询 ==================

  _startAdaptivePolling() {
    const poll = async () => {
      if (!this._running) return;

      const codes = [...this.subscribedCodes];
      if (codes.length > 0 && this._clientCount > 0) {
        await this._fetchQuotes(codes).catch(() => {});
      }

      // 自适应间隔计算
      let interval;
      if (this._clientCount === 0) {
        interval = 30000; // 无客户端, 30秒
      } else if (isTradingHours()) {
        if (isNearOpen()) {
          interval = 1500; // 开盘/收盘附近, 1.5秒
        } else {
          interval = 3000; // 交易中, 3秒
        }
      } else {
        interval = 15000; // 非交易时段, 15秒
      }

      this._pollInterval = interval;
      this._pollTimer = setTimeout(poll, interval);
    };
    poll();
  }
}

// ============ 单例 ============
let engineInstance = null;
function getRealtimeEngine() {
  if (!engineInstance) engineInstance = new RealtimeEngine();
  return engineInstance;
}

module.exports = { RealtimeEngine, getRealtimeEngine, CACHE_TTL };

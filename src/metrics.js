// Prometheus 指标 & 运行时监控
// 暴露 /api/metrics 端点, 供 Grafana / 监控系统抓取

const logger = require("./logger");

class MetricsCollector {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.startTime = Date.now();
  }

  // ===== Counters (只增不减) =====
  inc(name, labels = {}, value = 1) {
    const key = this._key(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  // ===== Gauges (可增可减) =====
  gauge(name, value, labels = {}) {
    const key = this._key(name, labels);
    this.gauges.set(key, value);
  }

  // ===== Histograms (延迟分布) =====
  observe(name, value, labels = {}) {
    const key = this._key(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, { sum: 0, count: 0, buckets: {} });
    }
    const h = this.histograms.get(key);
    h.sum += value;
    h.count++;
    // 固定桶: 10ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s
    for (const boundary of [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]) {
      if (value <= boundary) {
        h.buckets[boundary] = (h.buckets[boundary] || 0) + 1;
      }
    }
  }

  // ===== Express 中间件: 请求指标 =====
  requestMiddleware() {
    return (req, res, next) => {
      const start = Date.now();
      const method = req.method;
      const route = req.route?.path || req.path;

      this.inc("http_requests_total", { method, route });

      res.on("finish", () => {
        const duration = Date.now() - start;
        this.observe("http_request_duration_ms", duration, { method, route, status: res.statusCode });
        if (res.statusCode >= 400) {
          this.inc("http_errors_total", { method, route, status: res.statusCode });
        }
      });
      next();
    };
  }

  // ===== 交易指标 =====
  recordTrade(code, side, amount, slippage) {
    this.inc("trades_total", { side });
    this.inc("trades_volume", { side }, amount);
    if (slippage != null) {
      this.observe("trade_slippage_pct", slippage * 100, { side });
    }
  }

  recordAPIRequest(source, success) {
    this.inc("data_api_requests_total", { source });
    if (!success) this.inc("data_api_failures_total", { source });
  }

  // ===== 导出 Prometheus 格式 =====
  toPrometheus() {
    const lines = [];
    const uptime = (Date.now() - this.startTime) / 1000;

    lines.push("# HELP app_uptime_seconds Application uptime in seconds");
    lines.push("# TYPE app_uptime_seconds gauge");
    lines.push(`app_uptime_seconds ${uptime.toFixed(0)}`);

    for (const [key, val] of this.counters) {
      const { name, labels } = this._parseKey(key);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}${labels} ${val}`);
    }

    for (const [key, val] of this.gauges) {
      const { name, labels } = this._parseKey(key);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name}${labels} ${val}`);
    }

    for (const [key, h] of this.histograms) {
      const { name, labels } = this._parseKey(key);
      lines.push(`# TYPE ${name} histogram`);
      for (const [boundary, count] of Object.entries(h.buckets)) {
        lines.push(`${name}_bucket{le="${boundary}"${labels.slice(1)} ${count}`);
      }
      lines.push(`${name}_sum${labels} ${h.sum.toFixed(2)}`);
      lines.push(`${name}_count${labels} ${h.count}`);
    }

    return lines.join("\n") + "\n";
  }

  // ===== JSON 格式 (给 /api/health 用) =====
  toJSON() {
    const uptime = (Date.now() - this.startTime) / 1000;
    const mem = process.memoryUsage();
    return {
      uptime: +uptime.toFixed(0),
      memory: {
        rss: +(mem.rss / 1024 / 1024).toFixed(1),
        heapUsed: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        heapTotal: +(mem.heapTotal / 1024 / 1024).toFixed(1),
      },
      counters: Object.fromEntries(this.counters),
      activeGauges: Object.fromEntries(this.gauges),
    };
  }

  _key(name, labels) {
    const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(",");
    return `${name}|{${labelStr}}`;
  }

  _parseKey(key) {
    const [name, labels] = key.split("|");
    return { name, labels: labels ? labels : "" };
  }
}

// 单例
const metrics = new MetricsCollector();

module.exports = { MetricsCollector, metrics };

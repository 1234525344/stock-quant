// 前端性能监控 - Core Web Vitals
const PerfMonitor = {
  _metrics: {},
  _observers: [],

  init() {
    this._observeLCP();
    this._observeFID();
    this._observeCLS();
    this._observeNavigation();
    this._observeResources();

    // 每60秒上报一次
    setInterval(() => this._report(), 60000);
  },

  // Largest Contentful Paint
  _observeLCP() {
    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        this._metrics.lcp = Math.round(last.startTime);
        this._metrics.lcpElement = last.element?.tagName || "unknown";
      });
      observer.observe({ type: "largest-contentful-paint", buffered: true });
      this._observers.push(observer);
    } catch (e) {}
  },

  // First Input Delay
  _observeFID() {
    try {
      const observer = new PerformanceObserver((list) => {
        const entry = list.getEntries()[0];
        this._metrics.fid = Math.round(entry.processingStart - entry.startTime);
      });
      observer.observe({ type: "first-input", buffered: true });
      this._observers.push(observer);
    } catch (e) {}
  },

  // Cumulative Layout Shift
  _observeCLS() {
    try {
      let clsValue = 0;
      let sessionValue = 0;
      let sessionEntries = [];

      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            const firstEntry = sessionEntries[0];
            const lastEntry = sessionEntries[sessionEntries.length - 1];
            if (
              sessionValue &&
              entry.startTime - lastEntry.startTime < 1000 &&
              entry.startTime - firstEntry.startTime < 5000
            ) {
              sessionValue += entry.value;
              sessionEntries.push(entry);
            } else {
              sessionValue = entry.value;
              sessionEntries = [entry];
            }
            if (sessionValue > clsValue) {
              clsValue = sessionValue;
              this._metrics.cls = Math.round(clsValue * 1000) / 1000;
            }
          }
        }
      });
      observer.observe({ type: "layout-shift", buffered: true });
      this._observers.push(observer);
    } catch (e) {}
  },

  // Navigation Timing
  _observeNavigation() {
    try {
      const observer = new PerformanceObserver((list) => {
        const entry = list.getEntries()[0];
        this._metrics.ttfb = Math.round(entry.responseStart - entry.requestStart);
        this._metrics.domContentLoaded = Math.round(entry.domContentLoadedEventEnd - entry.startTime);
        this._metrics.loadComplete = Math.round(entry.loadEventEnd - entry.startTime);
      });
      observer.observe({ type: "navigation", buffered: true });
      this._observers.push(observer);
    } catch (e) {}
  },

  // Resource Timing
  _observeResources() {
    try {
      const observer = new PerformanceObserver((list) => {
        const resources = list.getEntries();
        this._metrics.totalResources = resources.length;
        this._metrics.totalTransferSize = resources.reduce((s, r) => s + (r.transferSize || 0), 0);
      });
      observer.observe({ type: "resource", buffered: true });
      this._observers.push(observer);
    } catch (e) {}
  },

  // 手动记录自定义指标
  mark(name) {
    try {
      performance.mark(`perf_${name}_start`);
    } catch (e) {}
  },

  measure(name) {
    try {
      performance.mark(`perf_${name}_end`);
      performance.measure(`perf_${name}`, `perf_${name}_start`, `perf_${name}_end`);
      const measure = performance.getEntriesByName(`perf_${name}`)[0];
      this._metrics[name] = Math.round(measure.duration);
      performance.clearMarks(`perf_${name}_start`);
      performance.clearMarks(`perf_${name}_end`);
      performance.clearMeasures(`perf_${name}`);
    } catch (e) {}
  },

  // 上报指标
  _report() {
    if (Object.keys(this._metrics).length === 0) return;

    const report = {
      ...this._metrics,
      url: location.pathname,
      timestamp: Date.now(),
      userAgent: navigator.userAgent.slice(0, 100),
    };

    // 使用 sendBeacon 上报（不阻塞页面）
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/perf", JSON.stringify(report));
    } else {
      fetch("/api/perf", {
        method: "POST",
        body: JSON.stringify(report),
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    }

    // 重置指标
    this._metrics = {};
  },

  // 获取当前指标
  getMetrics() {
    return { ...this._metrics };
  },

  destroy() {
    this._observers.forEach((o) => o.disconnect());
    this._observers = [];
  },
};

// 自动初始化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => PerfMonitor.init());
} else {
  PerfMonitor.init();
}

window.PerfMonitor = PerfMonitor;

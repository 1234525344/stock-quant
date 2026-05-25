// 量化交易平台 - ChartManager 和 TimerManager 模块

// ============ ECharts 实例管理器 (防止内存泄漏) ============
const ChartManager = {
  _instances: new Map(),
  _pageMap: new Map(),

  getChart(domId, pageId) {
    const dom = typeof domId === 'string' ? document.getElementById(domId) : domId;
    if (!dom) return null;

    if (this._instances.has(dom)) {
      try {
        const chart = this._instances.get(dom);
        if (chart && !chart.isDisposed()) return chart;
      } catch (_) {}
      this._instances.delete(dom);
      this._pageMap.delete(dom);
    }

    try {
      const chart = echarts.init(dom);
      this._instances.set(dom, chart);
      if (pageId) this._pageMap.set(dom, pageId);
      return chart;
    } catch (e) {
      console.warn('[ChartManager] 创建图表失败:', e);
      return null;
    }
  },

  // 注册 resize 监听器（自动去重 + 随图表销毁清理）
  manageResize(chart) {
    if (!chart || !chart.getDom) return;
    const dom = chart.getDom();
    if (!dom || dom._resizeBound) return;
    const handler = () => { try { chart.resize(); } catch (e) {} };
    dom._resizeHandler = handler;
    dom._resizeBound = true;
    window.addEventListener("resize", handler);
  },

  disposePage(pageId) {
    for (const [dom, chart] of this._instances.entries()) {
      if (this._pageMap.get(dom) === pageId) {
        if (dom._resizeBound) {
          window.removeEventListener("resize", dom._resizeHandler);
          dom._resizeBound = false;
        }
        try { chart.dispose(); } catch (e) {}
        this._instances.delete(dom);
        this._pageMap.delete(dom);
      }
    }
  },

  disposeAll() {
    for (const [dom, chart] of this._instances.entries()) {
      if (dom._resizeBound) {
        window.removeEventListener("resize", dom._resizeHandler);
        dom._resizeBound = false;
      }
      try { chart.dispose(); } catch (e) {}
    }
    this._instances.clear();
    this._pageMap.clear();
  },

  get size() {
    return this._instances.size;
  }
};

// ============ 定时器管理器 (防止幽灵定时器) ============
const TimerManager = {
  _timers: new Map(),

  register(id, intervalId, pageId) {
    if (this._timers.has(id)) {
      clearInterval(this._timers.get(id).intervalId);
    }
    this._timers.set(id, { intervalId, pageId });
  },

  clearByPage(pageId) {
    for (const [id, timer] of this._timers.entries()) {
      if (timer.pageId === pageId) {
        clearInterval(timer.intervalId);
        this._timers.delete(id);
      }
    }
  },

  clear(id) {
    const timer = this._timers.get(id);
    if (timer) {
      clearInterval(timer.intervalId);
      this._timers.delete(id);
    }
  },

  clearAll() {
    for (const timer of this._timers.values()) {
      clearInterval(timer.intervalId);
    }
    this._timers.clear();
  }
};

// 导出到全局
window.ChartManager = ChartManager;
window.TimerManager = TimerManager;

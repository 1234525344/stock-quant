// TradingView Lightweight Charts 封装模块
// 用于个股分析页的K线图展示

class TradingViewChart {
  constructor(containerId) {
    this.containerId = containerId;
    this.chart = null;
    this.candleSeries = null;
    this.volumeSeries = null;
    this.maSeries = [];
    this.bollSeries = [];
    this.signalSeries = null;
  }

  // 初始化图表
  init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error('[TradingView] Container not found:', this.containerId);
      return;
    }

    // 清空容器 (安全方式)
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // 确保容器有尺寸
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 400;

    // 创建图表
    this.chart = LightweightCharts.createChart(container, {
      width: width,
      height: height,
      layout: {
        background: { type: 'solid', color: '#1a1a2e' },
        textColor: '#e0e0e0',
      },
      grid: {
        vertLines: { color: '#2a2a3e' },
        horzLines: { color: '#2a2a3e' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: '#4a9eff', width: 1, style: 0 },
        horzLine: { color: '#4a9eff', width: 1, style: 0 },
      },
      rightPriceScale: {
        borderColor: '#2a2a3e',
      },
      timeScale: {
        borderColor: '#2a2a3e',
        timeVisible: false,
      },
    });

    // K线系列
    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: '#ef5350',
      downColor: '#26a69a',
      borderUpColor: '#ef5350',
      borderDownColor: '#26a69a',
      wickUpColor: '#ef5350',
      wickDownColor: '#26a69a',
    });

    // 成交量系列
    this.volumeSeries = this.chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    this.chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // 响应式调整
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(container);

    return this;
  }

  // 设置K线数据
  setData(klines) {
    if (!this.candleSeries || !klines.length) return;

    const candleData = klines.map(k => ({
      time: k.time || k.date,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));

    const volumeData = klines.map(k => ({
      time: k.time || k.date,
      value: k.volume || 0,
      color: k.close >= k.open ? 'rgba(239,83,80,0.5)' : 'rgba(38,166,154,0.5)',
    }));

    this.candleSeries.setData(candleData);
    this.volumeSeries.setData(volumeData);

    // 自动适配
    this.chart.timeScale().fitContent();
  }

  // 添加MA均线
  addMA(data, color, name) {
    if (!data || !data.length) return;

    const series = this.chart.addLineSeries({
      color: color,
      lineWidth: 1,
      title: name,
      priceLine: { visible: false },
      lastValueVisible: false,
    });

    series.setData(data.map(v => ({
      time: v.time || v.date,
      value: v.value,
    })));

    this.maSeries.push(series);
  }

  // 添加布林带
  addBoll(upper, lower) {
    if (upper && upper.length) {
      const upperSeries = this.chart.addLineSeries({
        color: '#ef5350',
        lineWidth: 1,
        lineStyle: 2,
        title: 'BOLL上轨',
        priceLine: { visible: false },
        lastValueVisible: false,
      });
      upperSeries.setData(upper.map(v => ({ time: v.time, value: v.value })));
      this.bollSeries.push(upperSeries);
    }

    if (lower && lower.length) {
      const lowerSeries = this.chart.addLineSeries({
        color: '#26a69a',
        lineWidth: 1,
        lineStyle: 2,
        title: 'BOLL下轨',
        priceLine: { visible: false },
        lastValueVisible: false,
      });
      lowerSeries.setData(lower.map(v => ({ time: v.time, value: v.value })));
      this.bollSeries.push(lowerSeries);
    }
  }

  // 添加买卖信号
  setSignals(signals) {
    if (!this.candleSeries || !signals.length) return;

    this.candleSeries.setMarkers(signals.map(s => ({
      time: s.time,
      position: s.type === 'buy' ? 'belowBar' : 'aboveBar',
      color: s.type === 'buy' ? '#ef5350' : '#26a69a',
      shape: s.type === 'buy' ? 'arrowUp' : 'arrowDown',
      text: s.type === 'buy' ? 'B' : 'S',
    })));
  }

  // 清除所有叠加层
  clearOverlays() {
    this.maSeries.forEach(s => {
      this.chart.removeSeries(s);
    });
    this.maSeries = [];

    this.bollSeries.forEach(s => {
      this.chart.removeSeries(s);
    });
    this.bollSeries = [];
  }

  // 销毁图表
  destroy() {
    if (this.chart) {
      this.chart.remove();
      this.chart = null;
    }
  }
}

// 导出
window.TradingViewChart = TradingViewChart;

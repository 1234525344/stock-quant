// 量化交易平台 v4 — 实时资金流 + 动态界面
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

// ============ 工具 ============
function toast(msg) {
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  document.body.appendChild(t); setTimeout(() => t.remove(), 2500);
}
function fmtFund(val) {
  if (val == null || val === 0) return "0";
  const abs = Math.abs(val);
  if (abs >= 1e8) return (val / 1e8).toFixed(1) + "亿";
  if (abs >= 1e4) return (val / 1e4).toFixed(0) + "万";
  return val.toFixed(0);
}
function fmtFlowRate(val) {
  if (!val) return "0";
  const abs = Math.abs(val);
  const sign = val > 0 ? "+" : "";
  if (abs >= 1e8) return sign + (val / 1e8).toFixed(2) + "亿/分";
  if (abs >= 1e6) return sign + (val / 1e6).toFixed(1) + "万/分";
  return sign + (val / 1e4).toFixed(1) + "万/分";
}

// 数字滚动动画
function animateNumber(el, target, duration = 600) {
  const start = parseFloat(el.textContent.replace(/[^0-9.-]/g, "")) || 0;
  if (Math.abs(target - start) < 0.01) { el.textContent = formatNum(target, el); return; }
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = start + (target - start) * eased;
    el.textContent = formatNum(current, el);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function formatNum(val, el) {
  if (el.classList.contains("idx-price") || el.id === "ffVWAP") return val.toFixed(0);
  if (el.id?.startsWith("ff") || el.classList.contains("ff-value")) {
    if (Math.abs(val) >= 1e8) return (val / 1e8).toFixed(1) + "亿";
    if (Math.abs(val) >= 1e4) return (val / 1e4).toFixed(0) + "万";
    return val.toFixed(0);
  }
  return val.toFixed(2);
}

// ============ 页面切换 ============
function switchPage(page) {
  $$(".nav-btn").forEach(b => b.classList.remove("active"));
  const btn = $(`.nav-btn[data-page="${page}"]`);
  if (btn) btn.classList.add("active");
  $$(".page").forEach(p => { p.classList.remove("active"); p.style.animation = "none"; });
  const pageEl = $(`#page-${page}`);
  if (pageEl) { pageEl.classList.add("active"); pageEl.style.animation = "pageIn .4s ease"; }

  clearInterval(ffLiveTimer);
  clearInterval(marketRefreshTimer);

  if (page === "market") { loadMarketOverview(); startMarketRefresh(); }
  if (page === "stock") { initStockChart(); loadStockAnalysis(); }
  if (page === "backtest") initBTChart();
  if (page === "fundflow") { initFFChart(); loadFundFlow(); }
}
$$(".nav-btn").forEach(btn => btn.addEventListener("click", () => switchPage(btn.dataset.page)));

// ============ 搜索 ============
let searchTimer;
$("#searchInput").addEventListener("input", function() {
  clearTimeout(searchTimer);
  const q = this.value.trim();
  if (!q) { $("#searchResults").classList.remove("show"); return; }
  searchTimer = setTimeout(async () => {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => []);
    const box = $("#searchResults");
    box.innerHTML = res.map(s => `<div class="item" data-code="${s.code}" data-name="${s.name}"><span class="code">${s.code}</span>${s.name}</div>`).join("");
    box.classList.add("show");
    box.querySelectorAll(".item").forEach(el => el.addEventListener("click", () => {
      $("#searchInput").value = `${el.dataset.code} ${el.dataset.name}`;
      box.classList.remove("show");
      navigateToStock(el.dataset.code);
    }));
  }, 300);
});
$("#searchInput").addEventListener("keydown", e => {
  if (e.key === "Enter") { $("#searchResults").classList.remove("show"); navigateToStock(e.target.value.trim().split(" ")[0]); }
});
document.addEventListener("click", e => { if (!e.target.closest(".search-box")) $("#searchResults").classList.remove("show"); });

function navigateToStock(code) { switchPage("stock"); $("#stockCode").value = code; loadStockAnalysis(); }

// ====================================================================
//  1. 市场总览 (实时量化仪表盘)
// ====================================================================
let indexTrendChart, sectorFlowChart, sectorHeatChart, marketRefreshTimer;

function fmtFlowYuan(val) {
  if (val == null || val === 0) return "0";
  const abs = Math.abs(val);
  const sign = val > 0 ? "+" : "";
  if (abs >= 1e8) return sign + (val / 1e8).toFixed(2) + "亿";
  if (abs >= 1e4) return sign + (val / 1e4).toFixed(0) + "万";
  return sign + val.toFixed(0);
}

async function loadMarketOverview() {
  if (!indexTrendChart) {
    indexTrendChart = echarts.init($("#chartIndexTrend"));
    sectorFlowChart = echarts.init($("#chartSectorFlow"));
    sectorHeatChart = echarts.init($("#chartSectorHeat"));
    window.addEventListener("resize", () => {
      indexTrendChart?.resize(); sectorFlowChart?.resize(); sectorHeatChart?.resize();
    });
  }
  try {
    const [summary, northDaily, sectorFlow, conceptFlow] = await Promise.all([
      fetch("/api/market/summary").then(r => r.json()).catch(() => null),
      fetch("/api/fundflow/northbound/daily").then(r => r.json()).catch(() => []),
      fetch("/api/market/sector-flow").then(r => r.json()).catch(() => []),
      fetch("/api/market/concept-flow").then(r => r.json()).catch(() => []),
    ]);
    if (!summary?.indices?.length) { toast("市场数据加载失败"); return; }

    // 实时状态条
    updateLiveStatus(summary);

    // 天气报告
    updateWeatherBanner(summary);

    // 指数卡片
    renderIndexCards(summary);

    // 板块资金流向
    if (sectorFlow?.length) {
      renderSectorFlowLists(sectorFlow);
      renderSectorFlowChart(sectorFlow);
    }

    // 概念板块
    if (conceptFlow?.length) renderConceptFlow(conceptFlow);

    // 行业涨跌
    $("#topSectors").innerHTML = (summary.topSectors || []).map(s =>
      `<div class="sector-row"><span class="sct-name">${s.name}</span><span class="sct-chg ${(s.changePct||0)>=0?'up':'down'}">${(s.changePct>=0?'+':'')}${(s.changePct||0).toFixed(2)}%</span></div>`
    ).join("") || '<div style="color:#5f6b8a;text-align:center;padding:16px;">暂无数据</div>';
    $("#bottomSectors").innerHTML = (summary.bottomSectors || []).map(s =>
      `<div class="sector-row"><span class="sct-name">${s.name}</span><span class="sct-chg ${(s.changePct||0)>=0?'up':'down'}">${(s.changePct>=0?'+':'')}${(s.changePct||0).toFixed(2)}%</span></div>`
    ).join("") || '<div style="color:#5f6b8a;text-align:center;padding:16px;">暂无数据</div>';

    renderSectorHeat(summary.sectors);
    if (northDaily?.length) renderNorthboundChart(northDaily);
    loadIndexTrend("000001", "上证指数");
    const firstCard = $("#indexCards")?.querySelector(".index-card");
    if (firstCard) firstCard.classList.add("selected");

  } catch (e) { toast("市场总览加载失败: " + e.message); }
}

function updateLiveStatus(summary) {
  const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  $("#liveTime").innerHTML = `<span class="live-dot"></span>实时 · ${now}`;
  const mood = summary.marketMood?.mood || "--";
  $("#liveMarketMood").textContent = "市场: " + mood;
}

function updateWeatherBanner(summary) {
  const weather = summary.marketMood;
  const weatherEl = $("#marketWeather");
  weatherEl.className = "market-weather " + ((weather.moodColor === "#e53e3e") ? "up" : (weather.moodColor === "#38a169") ? "down" : "neutral");
  const icons = { "强势上涨": "🔥", "温和上涨": "📈", "小幅回调": "📉", "明显下跌": "⚠️", "横盘震荡": "📊" };
  $("#weatherIcon").textContent = icons[weather.mood] || "📊";
  $("#weatherTitle").textContent = "市场状态：" + weather.mood;
  $("#weatherSummary").textContent = weather.summary;
}

function renderIndexCards(summary) {
  const cardsEl = $("#indexCards");
  cardsEl.innerHTML = summary.indices.map(i => {
    const cls = i.changePct >= 0 ? "up" : "down";
    const sign = i.changePct >= 0 ? "+" : "";
    return `<div class="index-card ${cls}" data-code="${i.code}" data-name="${i.name}">
      <div class="idx-name">${i.name}</div>
      <div class="idx-price">${i.price?.toFixed(2)}</div>
      <div class="idx-change ${cls}">${sign}${i.changePct?.toFixed(2)}%</div>
    </div>`;
  }).join("");
  cardsEl.querySelectorAll(".index-card").forEach(card => card.addEventListener("click", function() {
    loadIndexTrend(this.dataset.code, this.dataset.name);
    cardsEl.querySelectorAll(".index-card").forEach(c => c.classList.remove("selected"));
    this.classList.add("selected");
  }));
}

function renderSectorFlowLists(data) {
  const top5 = data.slice(0, 6);
  const bottom5 = [...data].sort((a, b) => (a.mainNet || 0) - (b.mainNet || 0)).slice(0, 6);
  const item = (s, cls) => `<div class="flow-item ${cls}">
    <span class="fi-name">${s.name}</span>
    <span class="fi-flow ${(s.mainNet||0)>=0?'flow-in':'flow-out'}">${fmtFlowYuan(s.mainNet)}</span>
    <span class="fi-pct ${(s.changePct||0)>=0?'up':'down'}">${(s.changePct>=0?'+':'')+(s.changePct||0).toFixed(2)}%</span>
  </div>`;
  $("#topFlowSectors").innerHTML = top5.map(s => item(s, "top")).join("");
  $("#bottomFlowSectors").innerHTML = bottom5.map(s => item(s, "bottom")).join("");
}

function renderSectorFlowChart(data) {
  if (!sectorFlowChart) return;
  const top15 = data.slice(0, 15);
  sectorFlowChart.setOption({
    backgroundColor: "transparent",
    title: { text: "行业板块主力资金净流入排行", left: 16, top: 10, textStyle: { color: "#c8cdf0", fontSize: 13, fontWeight: 600 } },
    grid: { left: 90, right: 60, top: 48, bottom: 30 },
    xAxis: { type: "value", axisLabel: { color: "#5f6b8a", fontSize: 10, formatter: v => (v/1e8).toFixed(0)+"亿" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
    yAxis: { type: "category", data: top15.map(s => s.name), axisLabel: { color: "#8890b5", fontSize: 11 }, inverse: true },
    tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" },
      formatter: ps => `${ps[0].axisValue}<br/>主力净流入: <b>${fmtFlowYuan(ps[0].data.value)}</b><br/>超大单: ${fmtFlowYuan(ps[0].data.hugeNet)} | 大单: ${fmtFlowYuan(ps[0].data.largeNet)}` },
    series: [{
      type: "bar", barMaxWidth: 20,
      data: top15.map(s => ({
        value: s.mainNet || 0, hugeNet: s.hugeNet, largeNet: s.largeNet,
        itemStyle: { color: (s.mainNet||0) >= 0 ? "rgba(248,113,113,.75)" : "rgba(74,222,128,.75)", borderRadius: (s.mainNet||0) >= 0 ? [4,4,0,0] : [0,0,4,4] },
      })),
    }],
  }, true);
}

function renderConceptFlow(data) {
  const top8 = data.slice(0, 8);
  $("#conceptFlowList").innerHTML = top8.map(s => `<div class="flow-item concept">
    <span class="fi-name">${s.name}</span>
    <span class="fi-flow ${(s.mainNet||0)>=0?'flow-in':'flow-out'}">${fmtFlowYuan(s.mainNet)}</span>
    <span class="fi-pct ${(s.changePct||0)>=0?'up':'down'}">${(s.changePct>=0?'+':'')+(s.changePct||0).toFixed(2)}%</span>
  </div>`).join("") || '<div style="color:#5f6b8a;padding:12px;">暂无数据</div>';
}

function startMarketRefresh() {
  clearInterval(marketRefreshTimer);
  // 每15秒刷新 (交易时段更频繁，非交易时段每60秒)
  const interval = isTradingHours() ? 15000 : 60000;
  marketRefreshTimer = setInterval(async () => {
    try {
      const [summary, sectorFlow, conceptFlow] = await Promise.all([
        fetch("/api/market/summary").then(r => r.json()).catch(() => null),
        fetch("/api/market/sector-flow").then(r => r.json()).catch(() => []),
        fetch("/api/market/concept-flow").then(r => r.json()).catch(() => []),
      ]);
      if (summary?.indices?.length) {
        updateLiveStatus(summary);
        // 静默更新指数卡片
        const cards = $$("#indexCards .index-card");
        summary.indices.forEach((i, idx) => {
          if (cards[idx]) {
            const priceEl = cards[idx].querySelector(".idx-price");
            const chgEl = cards[idx].querySelector(".idx-change");
            const newPrice = i.price?.toFixed(2);
            const sign = i.changePct >= 0 ? "+" : "";
            const newChg = `${sign}${i.changePct?.toFixed(2)}%`;
            if (priceEl.textContent !== newPrice) priceEl.textContent = newPrice;
            if (chgEl.textContent !== newChg) {
              chgEl.textContent = newChg;
              chgEl.className = "idx-change " + (i.changePct >= 0 ? "up" : "down");
            }
            cards[idx].className = "index-card " + (i.changePct >= 0 ? "up" : "down");
            if (cards[idx].classList.contains("selected")) cards[idx].classList.add("selected");
          }
        });
      }
      if (sectorFlow?.length) {
        renderSectorFlowLists(sectorFlow);
        renderSectorFlowChart(sectorFlow);
      }
      if (conceptFlow?.length) renderConceptFlow(conceptFlow);
    } catch(e) {}
  }, interval);
}

async function loadIndexTrend(code, name) {
  if (!indexTrendChart) return;
  indexTrendChart.showLoading();
  try {
    const data = await fetch(`/api/index/kline?code=${code}&days=250`).then(r => r.json());
    if (data.error) { toast(data.error); return; }
    indexTrendChart.setOption({
      backgroundColor: "transparent",
      title: { text: `${name} 走势与技术指标`, left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14, fontWeight: 600 } },
      grid: { left: 12, right: 12, top: 55, bottom: 35 },
      xAxis: { type: "category", data: data.dates, axisLabel: { color: "#5f6b8a", fontSize: 11 }, axisLine: { lineStyle: { color: "rgba(255,255,255,.06)" } } },
      yAxis: { type: "value", scale: true, axisLabel: { color: "#5f6b8a", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" } },
      legend: { right: 16, top: 10, textStyle: { color: "#8890b5", fontSize: 11 } },
      series: [
        { name: "收盘", type: "line", data: data.closes, lineStyle: { color: "#818cf8", width: 1.5 }, symbol: "none", smooth: true },
        { name: "MA5", type: "line", data: data.ma5, lineStyle: { color: "#f87171", width: 1 }, symbol: "none" },
        { name: "MA10", type: "line", data: data.ma10, lineStyle: { color: "#fbbf24", width: 1 }, symbol: "none" },
        { name: "MA20", type: "line", data: data.ma20, lineStyle: { color: "#a78bfa", width: 1 }, symbol: "none" },
        { name: "MA60", type: "line", data: data.ma60, lineStyle: { color: "#38bdf8", width: 1 }, symbol: "none" },
        { name: "BOLL上", type: "line", data: data.boll?.upper, lineStyle: { color: "#f87171", width: 1, type: "dashed" }, symbol: "none" },
        { name: "BOLL下", type: "line", data: data.boll?.lower, lineStyle: { color: "#4ade80", width: 1, type: "dashed" }, symbol: "none" },
      ],
    }, true);
  } catch (e) {} finally { indexTrendChart.hideLoading(); }
}

function renderSectorHeat(sectors) {
  if (!sectorHeatChart || !sectors?.length) return;
  const sorted = [...sectors].sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
  sectorHeatChart.setOption({
    backgroundColor: "transparent",
    title: { text: "行业涨跌一览", left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14, fontWeight: 600 } },
    grid: { left: 12, right: 30, top: 50, bottom: 60 },
    xAxis: { type: "category", data: sorted.map(s => s.name?.length > 5 ? s.name.slice(0, 5) : s.name), axisLabel: { color: "#5f6b8a", fontSize: 11, rotate: 60 } },
    yAxis: { type: "value", axisLabel: { color: "#5f6b8a", fontSize: 11, formatter: v => v.toFixed(1) + "%" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
    tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" }, formatter: p => `<b>${sorted[p[0].dataIndex].name}</b><br/>涨跌幅: ${p[0].data > 0 ? '+' : ''}${p[0].data.toFixed(2)}%` },
    series: [{ type: "bar", barMaxWidth: 24,
      data: sorted.map(s => ({ value: s.changePct || 0, itemStyle: { color: (s.changePct||0) >= 0 ? "#f87171" : "#4ade80", borderRadius: (s.changePct||0) >= 0 ? [6, 6, 0, 0] : [0, 0, 6, 6] } })),
    }],
  }, true);
}

function renderNorthboundChart(data) {
  if (!data?.length) return;
  // 如果已有北向图则复用, 否则在sectorHeat下面创建
  let nbChart = echarts.getInstanceByDom($("#chartNorthbound"));
  if (!nbChart && $("#chartNorthbound")) nbChart = echarts.init($("#chartNorthbound"));
  if (!nbChart) return;

  nbChart.setOption({
    backgroundColor: "transparent",
    title: { text: "北向资金 (沪深港通)", left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14, fontWeight: 600 } },
    grid: { left: 12, right: 12, top: 50, bottom: 35 },
    xAxis: { type: "category", data: data.map(d => d.date.slice(5)), axisLabel: { color: "#5f6b8a", fontSize: 11, rotate: 45 } },
    yAxis: { type: "value", axisLabel: { color: "#5f6b8a", fontSize: 11, formatter: v => (v / 1e8).toFixed(0) + "亿" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
    tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" }, formatter: p => `<b>${p[0].axisValue}</b><br/>北向净流入: ${(p[0].data/1e8).toFixed(2)}亿` },
    series: [{
      type: "bar", data: data.map(d => ({ value: d.netFlow,
        itemStyle: { color: d.netFlow >= 0 ? "rgba(248,113,113,.7)" : "rgba(74,222,128,.7)", borderRadius: d.netFlow >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] }
      })),
      barMaxWidth: 10,
    }],
  }, true);
}

// ====================================================================
//  2. 个股分析
// ====================================================================
let stockKlineChart, stockMacdChart, stockRsiChart;

function initStockChart() {
  if (stockKlineChart) return;
  stockKlineChart = echarts.init($("#chartStockKline"));
  stockMacdChart = echarts.init($("#chartStockMacd"));
  stockRsiChart = echarts.init($("#chartStockRsi"));
  window.addEventListener("resize", () => { stockKlineChart?.resize(); stockMacdChart?.resize(); stockRsiChart?.resize(); });
}

async function loadStockAnalysis() {
  if (!stockKlineChart) initStockChart();
  const code = $("#stockCode").value.trim() || "600519";
  const period = [...$$("#page-stock .tag")].find(t => t.classList.contains("active"))?.dataset?.period || 365;
  stockKlineChart.showLoading();
  try {
    const [indData, scrData, btData] = await Promise.all([
      fetch(`/api/indicators?code=${code}&days=${period}`).then(r => r.json()).catch(() => null),
      fetch(`/api/screen?code=${code}`).then(r => r.json()).catch(() => null),
      fetch(`/api/backtest?code=${code}&strategy=maCrossStrategy&days=${period}`).then(r => r.json()).catch(() => null),
    ]);
    if (!indData || indData.error) { toast(indData?.error || "加载失败"); return; }

    if (scrData && !scrData.error) { generateStockInsight(scrData, indData); renderScoreStrip(scrData); }
    else { generateSimpleInsight(indData); $("#stockScore").style.display = "none"; }

    // 加载研报评论
    loadStockComments(code);

    const showMA = $(".ind-toggle[data-ind=ma]")?.checked;
    const showBOLL = $(".ind-toggle[data-ind=boll]")?.checked;
    const showMACD = $(".ind-toggle[data-ind=macd]")?.checked;
    const showRSI = $(".ind-toggle[data-ind=rsi]")?.checked;
    const showKDJ = $(".ind-toggle[data-ind=kdj]")?.checked;

    const ohlc = indData.opens.map((o, i) => [indData.opens[i], indData.closes[i], indData.lows[i], indData.highs[i]]);
    const klineSeries = [{
      name: "K线", type: "candlestick", data: ohlc,
      itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e" },
    }];
    if (showMA) {
      [[indData.ma5, "MA5", "#f87171"], [indData.ma10, "MA10", "#fbbf24"], [indData.ma20, "MA20", "#a78bfa"], [indData.ma60, "MA60", "#38bdf8"]]
        .forEach(([d, n, c]) => d && klineSeries.push({ name: n, type: "line", data: d, lineStyle: { color: c, width: 1 }, symbol: "none" }));
    }
    if (showBOLL && indData.boll) {
      klineSeries.push({ name: "BOLL上", type: "line", data: indData.boll.upper, lineStyle: { color: "#f87171", width: 1, type: "dashed" }, symbol: "none" });
      klineSeries.push({ name: "BOLL下", type: "line", data: indData.boll.lower, lineStyle: { color: "#4ade80", width: 1, type: "dashed" }, symbol: "none" });
    }

    // 信号标记: 在K线图上显示买卖点
    const signalPoints = btData?.signalPoints || [];
    if (signalPoints.length) {
      const buyPoints = signalPoints.filter(p => p.type === "buy");
      const sellPoints = signalPoints.filter(p => p.type === "sell");
      if (buyPoints.length) {
        klineSeries.push({
          name: "买入信号", type: "scatter",
          data: buyPoints.map(p => [p.date, p.price * 0.98]),
          symbolSize: 10,
          symbol: "arrow",
          symbolRotate: 0,
          itemStyle: { color: "#ef4444" },
          label: { show: true, position: "bottom", formatter: "买", color: "#ef4444", fontSize: 10, fontWeight: 700 },
        });
      }
      if (sellPoints.length) {
        klineSeries.push({
          name: "卖出信号", type: "scatter",
          data: sellPoints.map(p => [p.date, p.price * 1.03]),
          symbolSize: 10,
          symbol: "arrow",
          symbolRotate: 180,
          itemStyle: { color: "#22c55e" },
          label: { show: true, position: "top", formatter: "卖", color: "#22c55e", fontSize: 10, fontWeight: 700 },
        });
      }
    }

    stockKlineChart.setOption({
      backgroundColor: "transparent",
      grid: { left: 12, right: 16, top: 20, bottom: 30 },
      xAxis: { type: "category", data: indData.dates, axisLabel: { color: "#5f6b8a", fontSize: 11 }, axisLine: { lineStyle: { color: "rgba(255,255,255,.06)" } } },
      yAxis: { type: "value", scale: true, axisLabel: { color: "#5f6b8a", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      series: klineSeries,
      legend: { right: 16, top: 4, textStyle: { color: "#8890b5", fontSize: 11 } },
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" }, formatter: ps => {
        const main = ps.find(p => p.seriesName === "K线"); if (!main) return "";
        const d = main.data; return `${main.axisValue}<br/>开: ${d[1]} 收: ${d[2]}<br/>低: ${d[3]} 高: ${d[4]}`;
      }},
    }, true);

    if (showMACD && indData.macd) {
      stockMacdChart.setOption({
        backgroundColor: "transparent", grid: { left: 12, right: 12, top: 10, bottom: 25 },
        xAxis: { type: "category", data: indData.dates, axisLabel: { color: "#5f6b8a", fontSize: 11 } },
        yAxis: { axisLabel: { color: "#5f6b8a", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
        series: [
          { name: "DIF", type: "line", data: indData.macd.dif, lineStyle: { color: "#38bdf8", width: 1 }, symbol: "none" },
          { name: "DEA", type: "line", data: indData.macd.dea, lineStyle: { color: "#fbbf24", width: 1 }, symbol: "none" },
          { name: "MACD", type: "bar", data: indData.macd.macd, itemStyle: { color: p => p.data >= 0 ? "#ef4444" : "#22c55e" } },
        ],
        legend: { right: 16, top: 4, textStyle: { color: "#8890b5", fontSize: 11 } }, tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" } },
      }, true);
      $("#chartStockMacd").style.display = "block";
    } else { $("#chartStockMacd").style.display = "none"; }

    if (showRSI && indData.rsi) {
      stockRsiChart.setOption({
        backgroundColor: "transparent", grid: { left: 12, right: 12, top: 10, bottom: 25 },
        xAxis: { type: "category", data: indData.dates, axisLabel: { color: "#5f6b8a", fontSize: 11 } },
        yAxis: { min: 0, max: 100, axisLabel: { color: "#5f6b8a", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
        series: [{ name: "RSI(14)", type: "line", data: indData.rsi, lineStyle: { color: "#a78bfa", width: 1.5 }, symbol: "none",
          markLine: { silent: true, symbol: "none", data: [{ yAxis: 70, lineStyle: { color: "#ef4444", type: "dashed" } }, { yAxis: 30, lineStyle: { color: "#22c55e", type: "dashed" } }] }
        }],
        tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" } },
      }, true);
      $("#chartStockRsi").style.display = "block";
    } else if (showKDJ && indData.kdj) {
      stockRsiChart.setOption({
        backgroundColor: "transparent", grid: { left: 12, right: 12, top: 10, bottom: 25 },
        xAxis: { type: "category", data: indData.dates, axisLabel: { color: "#5f6b8a", fontSize: 11 } },
        yAxis: { axisLabel: { color: "#5f6b8a", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
        series: [
          { name: "K", type: "line", data: indData.kdj.k, lineStyle: { color: "#38bdf8", width: 1 }, symbol: "none" },
          { name: "D", type: "line", data: indData.kdj.d, lineStyle: { color: "#fbbf24", width: 1 }, symbol: "none" },
          { name: "J", type: "line", data: indData.kdj.j, lineStyle: { color: "#a78bfa", width: 1 }, symbol: "none" },
        ],
        legend: { right: 16, top: 4, textStyle: { color: "#8890b5", fontSize: 11 } }, tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" } },
      }, true);
      $("#chartStockRsi").style.display = "block";
    } else { $("#chartStockRsi").style.display = "none"; }

  } catch (e) { toast("分析失败: " + e.message); }
  finally { stockKlineChart.hideLoading(); }
}

function generateStockInsight(scr, ind) {
  const el = $("#stockInsight");
  let mood, icon, title, detail;
  const posS = scr.positionScore || 0;
  const lauS = scr.launchScore || 0;
  const qualS = scr.qualityScore || 0;

  if (scr.score >= 55) {
    mood = "bullish"; icon = "🔥";
    title = `低位启动信号明确 (${scr.grade || scr.score + "分"})`;
    detail = `${scr.launchStatus || ""}。位置${posS}分 + 启动${lauS}分 + 质量${qualS}分。` + (scr.reasons || []).join("、") + `。5日涨幅${scr.chg5}%。`;
  } else if (scr.score >= 40) {
    mood = "bullish"; icon = "📈";
    title = `筑底中有启动迹象 (${scr.grade || scr.score + "分"})`;
    detail = `${scr.launchStatus || ""}。位置${posS}分 + 启动${lauS}分 + 质量${qualS}分。` + (scr.reasons || []).join("、") + `。`;
  } else if (scr.score >= 25) {
    mood = "neutral"; icon = "📊";
    title = `低位盘整, 等待启动信号 (${scr.grade || scr.score + "分"})`;
    detail = `位置${posS}分(低位优势) + 启动${lauS}分(尚待确认)。` + (scr.reasons || []).join("、") + `。5日涨幅${scr.chg5}%。`;
  } else {
    mood = "bearish"; icon = "💡";
    title = `高位或弱势, 建议观望 (${scr.grade || scr.score + "分"})`;
    detail = (scr.reasons?.length ? scr.reasons.join("、") : "暂无明确看多信号") + `。5日涨幅${scr.chg5}%。`;
  }

  if (ind?.macd) {
    const lastMacd = ind.macd.macd[ind.macd.macd.length - 1];
    const lastDif = ind.macd.dif[ind.macd.dif.length - 1];
    const lastDea = ind.macd.dea[ind.macd.dea.length - 1];
    if (lastDif > lastDea && lastMacd > 0) detail += " MACD零轴上多头。";
    else if (lastDif < lastDea) detail += " MACD零轴下空头主导。";
  }
  if (ind?.rsi) {
    const lastRsi = ind.rsi[ind.rsi.length - 1];
    if (lastRsi > 70) detail += ` RSI=${lastRsi.toFixed(0)}偏高。`;
    else if (lastRsi < 30) detail += ` RSI=${lastRsi.toFixed(0)}超卖。`;
  }
  el.className = "plain-insight " + mood;
  el.innerHTML = `<div class="insight-icon">${icon}</div><div class="insight-body"><h3>${title}</h3><p>${detail}</p></div>`;
}
function generateSimpleInsight(ind) {
  const el = $("#stockInsight");
  el.className = "plain-insight neutral";
  el.innerHTML = `<div class="insight-icon">📊</div><div class="insight-body"><h3>技术面概览</h3><p>已加载K线和技术指标数据，请参考下方图表分析。</p></div>`;
}
function renderScoreStrip(scr) {
  $("#stockScore").style.display = "";
  const posS = scr.positionScore || 0;
  const lauS = scr.launchScore || 0;
  const qualS = scr.qualityScore || 0;

  const cls = (s, hi, lo) => s >= hi ? "good" : s >= lo ? "warn" : "bad";
  const setScore = (id, val, cl) => { const el = $(id); el.textContent = val; el.className = "sVal " + cl; };

  // 位置
  let posLabel, posCls;
  if (posS >= 20) { posLabel = "深度低位"; posCls = "good"; }
  else if (posS >= 12) { posLabel = "中低位"; posCls = "warn"; }
  else { posLabel = "偏高位"; posCls = "bad"; }
  setScore("#sTrend", posLabel + " (" + posS + "/35)", posCls);

  // 启动
  let lauLabel, lauCls;
  if (lauS >= 25) { lauLabel = "启动中"; lauCls = "good"; }
  else if (lauS >= 15) { lauLabel = "蓄力中"; lauCls = "warn"; }
  else { lauLabel = "未启动"; lauCls = "bad"; }
  setScore("#sMomentum", lauLabel + " (" + lauS + "/40)", lauCls);

  // 质量
  let qualLabel, qualCls;
  if (qualS >= 18) { qualLabel = "质地优良"; qualCls = "good"; }
  else if (qualS >= 10) { qualLabel = "质地一般"; qualCls = "warn"; }
  else { qualLabel = "需谨慎"; qualCls = "bad"; }
  setScore("#sVolume", qualLabel + " (" + qualS + "/25)", qualCls);

  // 综合
  setScore("#sOverall", (scr.grade || scr.score + "分"), scr.score >= 55 ? "good" : scr.score >= 40 ? "warn" : "bad");
}

// ============ 加载个股研报评论 ============
async function loadStockComments(code) {
  const section = $("#stockComments");
  try {
    const data = await fetch(`/api/stock/comments?code=${code}`).then(r => r.json()).catch(() => null);
    if (!data || data.error) { section.style.display = "none"; return; }

    section.style.display = "";
    $("#commentsSource").textContent = "来源: " + (data.source || "新浪财经");

    // 分析师研报
    if (data.reports?.length) {
      $("#reportList").innerHTML = data.reports.map(r =>
        `<a class="comment-link" href="${r.url}" target="_blank" title="${r.title}">${r.summary || r.title}</a>`
      ).join("");
    } else {
      $("#reportList").innerHTML = '<div class="comment-empty">暂无研报数据</div>';
    }

    // 行业研究
    if (data.indReports?.length) {
      $("#indReportList").innerHTML = data.indReports.map(r =>
        `<a class="comment-link" href="${r.url}" target="_blank" title="${r.title}">${r.title}</a>`
      ).join("");
    } else {
      $("#indReportList").innerHTML = '<div class="comment-empty">暂无行业研报</div>';
    }

    // 公司资讯
    if (data.news?.length) {
      $("#newsList").innerHTML = data.news.map(n =>
        `<a class="comment-link news-item" href="${n.url}" target="_blank"><span class="news-date">${n.date}</span>${n.title}</a>`
      ).join("");
    } else {
      $("#newsList").innerHTML = '<div class="comment-empty">暂无公司资讯</div>';
    }
  } catch (e) {
    section.style.display = "none";
  }
}

$("#btnLoadStock")?.addEventListener("click", loadStockAnalysis);
$("#stockCode")?.addEventListener("keydown", e => { if (e.key === "Enter") loadStockAnalysis(); });
$$("#page-stock .tag").forEach(t => t.addEventListener("click", function() {
  $$("#page-stock .tag").forEach(x => x.classList.remove("active"));
  this.classList.add("active"); loadStockAnalysis();
}));
$$(".ind-toggle").forEach(cb => cb?.addEventListener("change", loadStockAnalysis));

// ====================================================================
//  3. 策略回测
// ====================================================================
let equityChart;
function initBTChart() { if (!equityChart) { equityChart = echarts.init($("#chartEquity")); window.addEventListener("resize", () => equityChart?.resize()); } }

$("#btnBacktest")?.addEventListener("click", async () => {
  const code = $("#btCode").value.trim() || "600519";
  const btn = $("#btnBacktest");
  btn.textContent = "回测中..."; btn.disabled = true;
  try {
    const data = await fetch(`/api/backtest?code=${code}&strategy=${$("#btStrategy").value}&days=${$("#btDays").value || 365}`).then(r => r.json());
    if (data.error) { toast(data.error); return; }
    $("#btRet").textContent = data.totalReturn + "%";
    $("#btRet").style.color = data.totalReturn >= 0 ? "#f87171" : "#4ade80";
    $("#btDD").textContent = data.maxDrawdown + "%";
    $("#btSharpe").textContent = data.sharpe + (data.calmar ? " / " + data.calmar : "");
    $("#btTrades").textContent = data.totalTrades;
    $("#btWinRate").textContent = data.winRate + "%";
    $("#btAvgPnl").textContent = data.avgPnl + "%";
    $("#btCommission").textContent = "¥" + (data.totalCommission || 0).toFixed(0);
    if (!equityChart) initBTChart();
    equityChart.setOption({
      backgroundColor: "transparent", grid: { left: 14, right: 16, top: 20, bottom: 30 },
      xAxis: { type: "category", data: data.equityCurve.map(e => e.date), axisLabel: { color: "#5f6b8a", fontSize: 11 } },
      yAxis: { axisLabel: { color: "#5f6b8a", fontSize: 11, formatter: v => "¥" + (v / 10000).toFixed(0) + "万" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      series: [{
        name: "权益", type: "line", data: data.equityCurve.map(e => e.equity), lineStyle: { color: "#818cf8", width: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(99,102,241,.25)" }, { offset: 1, color: "rgba(99,102,241,0)" }]) },
        symbol: "none", markLine: { silent: true, symbol: "none", data: [{ yAxis: data.initialCapital, lineStyle: { color: "#5f6b8a", type: "dashed" } }] },
        markPoint: {
          symbolSize: 8,
          data: [
            ...(data.signalPoints || []).filter(p => p.type === "buy").slice(0, 25).map(p => {
              const eq = data.equityCurve.find(e => e.date === p.date);
              return { coord: [p.date, eq ? eq.equity : 0], value: "买", itemStyle: { color: "#ef4444" } };
            }),
            ...(data.signalPoints || []).filter(p => p.type === "sell").slice(0, 25).map(p => {
              const eq = data.equityCurve.find(e => e.date === p.date);
              return { coord: [p.date, eq ? eq.equity : 0], value: "卖", itemStyle: { color: "#22c55e" } };
            }),
          ],
        },
      }],
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" }, formatter: p => `${p[0].axisValue}<br/>权益: ¥${p[0].data.toLocaleString()}` },
    }, true);
    $("#btTradeList").innerHTML = "<h3 style='margin-bottom:8px;color:#c8cdf0;'>交易明细</h3>" + (data.trades.length ? data.trades.map(t =>
      `<div class="bt-trade"><span>${t.entryDate} → ${t.exitDate}</span><span>入场 ${t.entryPrice?.toFixed(2)} | 出场 ${t.exitPrice?.toFixed(2)} | ${t.shares}股</span><span class="${t.pnlPct>=0?'profit':'loss'}">${t.pnlPct>0?'+':''}${t.pnlPct}% (¥${t.pnl})</span></div>`
    ).join("") : '<div style="padding:12px;color:#5f6b8a;">该周期内无交易信号</div>');
  } catch (e) { toast("回测失败: " + e.message); }
  finally { btn.textContent = "运行回测"; btn.disabled = false; }
});
$("#btCode")?.addEventListener("keydown", e => { if (e.key === "Enter") $("#btnBacktest").click(); });

// ====================================================================
//  4. 策略对比
// ====================================================================
$("#btnCompare")?.addEventListener("click", async () => {
  const code = $("#cmpCode").value.trim() || "600519";
  const btn = $("#btnCompare"); btn.textContent = "对比中..."; btn.disabled = true;
  try {
    const data = await fetch(`/api/compare?code=${code}`).then(r => r.json());
    if (data.error) { toast(data.error); return; }
    $("#cmpResults").innerHTML = Object.entries(data.results).map(([k, v]) => {
      const good = v.totalReturn >= 0;
      return `<div class="cmp-card ${good?'good':'bad'}"><h4>${v.strategy}</h4>
        <div class="val">收益率: <b style="color:${good?'#f87171':'#4ade80'}">${v.totalReturn}%</b></div>
        <div class="val">最大回撤: ${v.maxDrawdown}%</div><div class="val">夏普: ${v.sharpe}</div>
        <div class="val">交易: ${v.totalTrades}次 | 胜率: ${v.winRate}%</div>
        <div class="val">手续费: ¥${(v.totalCommission||0).toFixed(0)}</div></div>`;
    }).join("");
  } catch (e) { toast("对比失败: " + e.message); }
  finally { btn.textContent = "对比所有策略"; btn.disabled = false; }
});
$("#cmpCode")?.addEventListener("keydown", e => { if (e.key === "Enter") $("#btnCompare").click(); });

// ====================================================================
//  5. 资金流向 — 实时版
// ====================================================================
let ffDailyChart, ffVWAPChart, ffLiveTimer;

function initFFChart() {
  if (ffDailyChart) return;
  ffDailyChart = echarts.init($("#chartFFDaily"));
  ffVWAPChart = echarts.init($("#chartFFVWAP"));
  window.addEventListener("resize", () => { ffDailyChart?.resize(); ffVWAPChart?.resize(); });
}

// 实时资金流 + 北向资金
async function loadFundFlow() {
  const code = $("#ffCode").value.trim() || "600519";
  if (!ffDailyChart) initFFChart();
  ffDailyChart.showLoading();
  ffVWAPChart.showLoading();

  try {
    // 并行加载: 综合量化流 + 实时分钟流 + 北向资金
    const [quantData, liveData, northData] = await Promise.all([
      fetch(`/api/quantflow?code=${code}`).then(r => r.json()).catch(() => null),
      fetch(`/api/fundflow/live?code=${code}`).then(r => r.json()).catch(() => null),
      fetch("/api/fundflow/northbound").then(r => r.json()).catch(() => null),
    ]);
    if (!quantData?.dailyFlow?.length) { toast("数据加载失败"); return; }

    // 时间 + 价格 + live dot
    const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const updateHtml = `<span class="live-dot"></span> 实时 · ${now}`;
    $("#ffRefreshTime").innerHTML = updateHtml;
    const chgColor = quantData.change >= 0 ? "#f87171" : "#4ade80";
    $("#ffPrice").innerHTML = `${quantData.name || code} &nbsp;<span style="color:${chgColor};font-size:24px;">${quantData.price?.toFixed(2)}</span>`;

    // 实时资金流速指示器
    updateLiveFlowIndicator(liveData);

    // 北向资金卡片
    updateNorthboundCard(northData);

    // AI解读
    const insight = generateFFInsight(quantData, liveData);
    const banner = $("#ffInsight");
    banner.className = "insight-banner " + insight.mood;
    banner.innerHTML = `<div class="insight-icon">${insight.icon}</div><div class="insight-text"><h2>${insight.msg}</h2><p>${insight.detail}</p></div>`;

    // 资金卡片
    const setCard = (id, val, el) => {
      if (!el) el = $(id);
      if (!el) return;
      el.textContent = fmtFund(val);
      el.className = "ff-value " + (val > 0 ? "up" : val < 0 ? "down" : "neutral");
    };
    setCard("#ffMain", (quantData.summary.mainNet || 0) + (quantData.summary.institutionNet || 0));
    setCard("#ffInst", quantData.summary.institutionNet);
    setCard("#ffRetail", quantData.summary.retailNet);

    // VWAP
    if (quantData.lastVWAP) {
      const vwapEl = $("#ffVWAP");
      vwapEl.textContent = (+quantData.lastVWAP).toFixed(0);
      const delta = quantData.price ? ((quantData.price - quantData.lastVWAP) / quantData.lastVWAP * 100) : 0;
      if (delta > 0) { vwapEl.className = "ff-value up"; $("#ffVWAPHint").textContent = `现价高于线 ${delta.toFixed(1)}% → 偏多`; }
      else if (delta < 0) { vwapEl.className = "ff-value down"; $("#ffVWAPHint").textContent = `现价低于线 ${Math.abs(delta).toFixed(1)}% → 偏空`; }
      else { vwapEl.className = "ff-value neutral"; $("#ffVWAPHint").textContent = "等于多空线"; }
    }

    // OFI
    const ofi = quantData.lastOFI;
    if (ofi != null) { const e = $("#ffOFI"); e.textContent = (ofi > 0 ? "+" : "") + ofi + "%"; e.className = "ff-value " + (ofi > 10 ? "up" : ofi < -10 ? "down" : "neutral"); }

    // MFI
    if (quantData.mfi?.length) {
      const lastMfi = quantData.mfi[quantData.mfi.length - 1];
      if (lastMfi != null) { const e = $("#ffMFI"); e.textContent = lastMfi.toFixed(0); e.className = "ff-value " + (lastMfi > 80 ? "down" : lastMfi < 20 ? "up" : "neutral"); }
    }

    // 大单信号
    const sig = quantData.signalSummary;
    if (sig?.signals?.length) {
      $("#ffSignalList").innerHTML = `<div class="section-title">🔔 近期大单交易信号</div>` + sig.signals.map(s =>
        `<div class="signal-item"><span style="color:#5f6b8a;min-width:80px">${s.date}</span><span class="signal-badge ${s.direction}">${s.direction==="buy"?"大单买入":"大单卖出"}</span><span style="color:#8890b5">价格 <b>${s.price?.toFixed(2)}</b></span><span style="color:#5f6b8a;font-size:12px">${s.intensity==="heavy"?"大幅放量":"温和放量"} · ${s.confidence==="high"?"高确信":"中确信"}</span></div>`
      ).join("");
    } else {
      $("#ffSignalList").innerHTML = `<div class="section-title">🔔 近期大单交易信号</div><div style="padding:16px;color:#5f6b8a;text-align:center">近20日未检测到显著大单信号</div>`;
    }

    // 图表
    const dayFlow = quantData.dailyFlow.slice(-40);
    ffDailyChart.setOption({
      backgroundColor: "transparent",
      title: { text: "每日资金流向", left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14, fontWeight: 600 } },
      grid: { left: 12, right: 16, top: 50, bottom: 35 },
      xAxis: { type: "category", data: dayFlow.map(d => d.date.slice(5)), axisLabel: { color: "#5f6b8a", fontSize: 11, rotate: 45 } },
      yAxis: { axisLabel: { color: "#5f6b8a", fontSize: 11, formatter: v => (v / 1e8).toFixed(0) + "亿" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" }, formatter: ps => {
        let s = `<b>${ps[0].axisValue}</b><br/>`; ps.forEach(p => { s += `${p.marker} ${p.seriesName}: <b>${fmtFund(p.data)}</b><br/>`; }); return s;
      }},
      legend: { right: 16, top: 10, textStyle: { color: "#8890b5", fontSize: 11 } },
      series: [
        { name: "大资金", type: "bar", stack: "flow", data: dayFlow.map(d => (d.main || 0) + (d.institution || 0)), itemStyle: { color: "#6366f1", borderRadius: [0, 0, 0, 0] }, emphasis: { focus: "series" } },
        { name: "散户", type: "bar", stack: "flow", data: dayFlow.map(d => d.retail || 0), itemStyle: { color: "rgba(148,163,184,.5)", borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "series" } },
      ],
    }, true);

    if (quantData.indicators?.vwap?.length) {
      const indSlice = 60;
      const indDates = quantData.dailyFlow.slice(-indSlice).map(d => d.date.slice(5));
      ffVWAPChart.setOption({
        backgroundColor: "transparent",
        title: { text: "多空分界线 (VWAP) + 买卖力量 (OFI)", left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14, fontWeight: 600 } },
        grid: { left: 12, right: 60, top: 50, bottom: 35 },
        xAxis: { type: "category", data: indDates, axisLabel: { color: "#5f6b8a", fontSize: 11, rotate: 30 } },
        yAxis: [
          { type: "value", axisLabel: { color: "#5f6b8a", fontSize: 11, formatter: v => v.toFixed(0) }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
          { type: "value", min: -100, max: 100, axisLabel: { color: "#5f6b8a", fontSize: 11, formatter: v => v + "%" }, splitLine: { show: false } },
        ],
        tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" } },
        legend: { right: 16, top: 10, textStyle: { color: "#8890b5", fontSize: 11 } },
        series: [
          { name: "VWAP", type: "line", data: quantData.indicators.vwap.slice(-indSlice), lineStyle: { color: "#818cf8", width: 2 }, symbol: "none", smooth: true },
          { name: "上轨", type: "line", data: quantData.indicators.vwapUpper.slice(-indSlice), lineStyle: { color: "#f87171", width: 1, type: "dashed", opacity: .5 }, symbol: "none" },
          { name: "下轨", type: "line", data: quantData.indicators.vwapLower.slice(-indSlice), lineStyle: { color: "#4ade80", width: 1, type: "dashed", opacity: .5 }, symbol: "none" },
          { name: "OFI", type: "line", yAxisIndex: 1, data: quantData.indicators.ofi.slice(-indSlice), lineStyle: { color: "#fbbf24", width: 1.5 }, symbol: "none", smooth: true,
            areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(251,191,36,.15)" }, { offset: 1, color: "rgba(251,191,36,0)" }]) },
            markLine: { silent: true, symbol: "none", data: [{ yAxis: 0, lineStyle: { color: "rgba(255,255,255,.1)" } }] },
          },
        ],
      }, true);
    }
  } catch (e) { toast("数据加载失败: " + e.message); }
  finally { ffDailyChart.hideLoading(); ffVWAPChart.hideLoading(); }
}

function updateLiveFlowIndicator(liveData) {
  let container = $("#liveFlowRow");
  if (!container) {
    container = document.createElement("div");
    container.id = "liveFlowRow";
    container.className = "live-flow-row";
    const ffSummary = $("#ffSummary");
    if (ffSummary && ffSummary.parentNode) ffSummary.parentNode.insertBefore(container, ffSummary);
  }
  if (!liveData) { container.innerHTML = ""; return; }

  const rate = liveData.flowRate || 0;
  const mood = liveData.flowMood || "steady";
  const moodLabels = { rapid_in: "资金快速流入", slow_in: "资金缓慢流入", rapid_out: "资金快速流出", slow_out: "资金缓慢流出", steady: "资金平稳" };

  container.innerHTML = `
    <div class="live-flow-indicator">
      <div class="flow-rate ${mood}">${fmtFlowRate(rate)}</div>
      <div class="flow-label">实时资金流速</div>
    </div>
    <div class="live-flow-indicator">
      <div class="flow-rate ${mood}" style="font-size:22px;">${moodLabels[mood]}</div>
      <div class="flow-label">当前状态</div>
    </div>
    <div class="live-flow-indicator">
      <div class="flow-rate ${liveData.minute.main >= 0 ? 'slow_in' : 'slow_out'}" style="font-size:22px;">${fmtFund(liveData.minute.main)}</div>
      <div class="flow-label">大单净流入(累计)</div>
    </div>
    <div class="live-flow-indicator">
      <div class="flow-rate" style="font-size:20px;color:#8890b5;">${liveData.timestamp}</div>
      <div class="flow-label"><span class="live-dot"></span> 实时更新</div>
    </div>
  `;
}

function updateNorthboundCard(northData) {
  let card = $("#northboundCard");
  if (!card && northData) {
    card = document.createElement("div");
    card.id = "northboundCard";
    card.className = "northbound-card";
    const liveRow = $("#liveFlowRow");
    if (liveRow && liveRow.parentNode) liveRow.parentNode.insertBefore(card, liveRow.nextSibling);
  }
  if (!northData || !card) return;

  const sign = northData.todayNet >= 0 ? "+" : "";
  const netColor = northData.todayNet >= 0 ? "#f87171" : "#4ade80";
  const moodIcon = northData.mood.includes("流入") ? "📈" : northData.mood.includes("流出") ? "📉" : "➡️";

  card.innerHTML = `
    <div class="nb-icon">${moodIcon}</div>
    <div class="nb-info">
      <div class="nb-title">北向资金 (沪深港通) · ${northData.mood}</div>
      <div class="nb-value" style="color:${netColor}">${sign}${(northData.todayNet/1e8).toFixed(2)}亿</div>
    </div>
    <div style="color:#5f6b8a;font-size:12px;">今日累计净流入</div>
  `;
}

function generateFFInsight(quantData, liveData) {
  const s = quantData.summary;
  const ofi = quantData.lastOFI || 0;
  const vwapDelta = quantData.price && quantData.lastVWAP ? ((quantData.price - quantData.lastVWAP) / quantData.lastVWAP * 100) : 0;
  const totalBig = (s.mainNet || 0) + (s.institutionNet || 0);
  const sigBuy = quantData.signalSummary?.buyCount || 0;
  const sigSell = quantData.signalSummary?.sellCount || 0;
  const flowRate = liveData?.flowRate || 0;

  let mood, icon, msg, detail;
  if (totalBig > 5e7 && (ofi > 10 || flowRate > 3e6)) {
    mood = "bullish"; icon = "🔥";
    msg = "大资金正在积极买入，多方力量强势";
    detail = `近5日大单净流入 <b>${fmtFund(totalBig)}</b>，实时流速 <b>${fmtFlowRate(flowRate)}</b>。${vwapDelta > 0 ? "现价站上VWAP多空线，短期偏强。" : "留意是否能突破VWAP线。"}`;
  } else if (totalBig < -5e7 && (ofi < -10 || flowRate < -3e6)) {
    mood = "bearish"; icon = "⚠️";
    msg = "大资金在撤退，注意风险管控";
    detail = `近5日大单净流出 <b>${fmtFund(Math.abs(totalBig))}</b>，实时流速 <b>${fmtFlowRate(flowRate)}</b>。${vwapDelta < 0 ? "现价低于VWAP线，短期偏弱。" : "表面平稳但资金在流出。"}`;
  } else if (ofi < -20 || flowRate < -5e6) {
    mood = "caution"; icon = "👀";
    msg = "多空分歧较大，建议暂时观望";
    detail = `买卖力量偏向卖方，但大单无明确动作。${sigBuy > sigSell ? "买入信号略多于卖出。" : sigSell > sigBuy ? "卖出信号偏多，谨慎为宜。" : "暂时没有明显的方向。"}`;
  } else {
    mood = "neutral"; icon = "📊";
    msg = "资金面平稳，正常波动区间";
    detail = `近5日大单净流 <b>${fmtFund(totalBig)}</b>，实时流速 <b>${fmtFlowRate(flowRate)}</b>。${sigBuy > sigSell ? "买入信号略多。" : sigSell > sigBuy ? "卖出信号略多。" : "暂无方向性信号。"}`;
  }
  return { mood, icon, msg, detail };
}

// 自动刷新
function isTradingHours() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), day = now.getDay();
  if (day === 0 || day === 6) return false;
  const t = h * 100 + m;
  return (t >= 930 && t <= 1130) || (t >= 1300 && t <= 1505);
}

function toggleAutoRefresh() {
  clearInterval(ffLiveTimer);
  if ($("#ffAutoRefreshCb")?.checked) {
    loadFundFlow();
    ffLiveTimer = setInterval(loadFundFlow, isTradingHours() ? 15000 : 60000);
  }
}

$("#btnLoadFF")?.addEventListener("click", loadFundFlow);
$("#ffCode")?.addEventListener("keydown", e => { if (e.key === "Enter") loadFundFlow(); });
$("#ffAutoRefreshCb")?.addEventListener("change", toggleAutoRefresh);

// ====================================================================
//  6. 批量选股
// ====================================================================
$("#btnScan")?.addEventListener("click", async () => {
  const btn = $("#btnScan"); btn.textContent = "扫描中..."; btn.disabled = true;
  const progress = $("#scanProgress"); if (progress) progress.style.display = "block";
  try {
    const data = await fetch("/api/scan").then(r => r.json());
    const el = $("#scanResults");
    el.innerHTML = `<h3 style="color:#c8cdf0;margin-bottom:12px;">扫描结果 — 低位启动优质股 (${data.length} 只通过)</h3>
      <table><thead><tr>
        <th>代码</th><th>名称</th><th>评级</th><th>总分</th><th>位置</th><th>启动</th><th>质量</th>
        <th>价格</th><th>状态</th><th>信号</th>
      </tr></thead>
      <tbody>${data.map(d => `<tr class="clickable" data-code="${d.code}">
        <td>${d.code}</td>
        <td>${d.name||d.code}</td>
        <td><span class="grade-badge" style="background:${d.gradeColor||'#6b7280'}">${d.grade||d.score+'分'}</span></td>
        <td><b style="color:${d.score>=55?'#f87171':d.score>=40?'#f59e0b':'#94a3b8'}">${d.score}分</b></td>
        <td><span class="dim-badge dim-pos">${d.positionScore||0}</span></td>
        <td><span class="dim-badge dim-launch">${d.launchScore||0}</span></td>
        <td><span class="dim-badge dim-qual">${d.qualityScore||0}</span></td>
        <td>${d.lastPrice?.toFixed(2)}</td>
        <td style="font-size:13px;">${d.launchStatus||''}</td>
        <td style="font-size:11px;color:#8890b5;max-width:200px;">${(d.reasons||[]).slice(0,3).join(" · ")}</td>
      </tr>`).join("")}</tbody></table>
      <div style="margin-top:12px;font-size:11px;color:#5f6b8a;">
        <span class="dim-badge dim-pos">位置</span> 越低越好(满35) &nbsp;
        <span class="dim-badge dim-launch">启动</span> 越高越强(满40) &nbsp;
        <span class="dim-badge dim-qual">质量</span> 越高越稳(满25)
      </div>`;
    if (!data.length) el.innerHTML += '<div style="padding:12px;color:#5f6b8a;">当前无符合条件的低位优质股，可能市场整体高位，建议耐心等待回调。</div>';
    el.querySelectorAll("tr.clickable").forEach(tr => tr.addEventListener("click", () => navigateToStock(tr.dataset.code)));
  } catch (e) { toast("扫描失败: " + e.message); }
  finally { btn.textContent = "开始批量扫描"; btn.disabled = false; if (progress) progress.style.display = "none"; }
});

// ============ 启动 ============
loadMarketOverview();
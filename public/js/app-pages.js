// ====================================================================
//  5. 资金流向 — 实时版
// ====================================================================
let ffDailyChart, ffVWAPChart, ffRtChart, ffLiveTimer;

function initFFChart() {
  if (ffDailyChart && !ffDailyChart.isDisposed()) return;
  ffDailyChart = ChartManager.getChart("chartFFDaily", "fundflow");
  ffVWAPChart = ChartManager.getChart("chartFFVWAP", "fundflow");
  const rtDom = $("#chartFFRealtime");
  if (rtDom) ffRtChart = ChartManager.getChart(rtDom, "fundflow");
  ChartManager.manageResize(ffDailyChart);
  ChartManager.manageResize(ffVWAPChart);
  ChartManager.manageResize(ffRtChart);
}

// 加载实时K线+资金流叠加图
async function loadRtChart(code) {
  if (!ffRtChart || ffRtChart.isDisposed()) {
    if (!$("#chartFFRealtime")) return;
    ffRtChart = ChartManager.getChart("chartFFRealtime", "fundflow");
  }
  try {
    const resp = await fetch(`/api/fundflow/rtchart?code=${code}`);
    const data = await resp.json();
    if (!data.candles?.length) {
      const st = $("#ffRtStatus"); if (st) st.textContent = "暂无分钟数据";
      ffRtChart?.setOption({
        title: { text: "实时K线 + 资金流", left: 16, top: 10, textStyle: { color: "#666666", fontSize: 13 } },
        graphic: [{ type: "text", left: "center", top: "center", style: { text: "分钟K线数据暂不可用\n(请确认是否交易日)", fill: "#999999", fontSize: 13, textAlign: "center" } }],
      }, true);
      return;
    }

    const st = $("#ffRtStatus");
    if (st) st.textContent = `${data.timestamp} 更新 · ${data.candles.length} 根K线`;

    // 构建价格线数据
    const dates = data.candles.map(c => c.time);
    const prices = data.candles.map(c => c.close);
    const mainFlows = data.candles.map(c => c.mainFlow);
    const volumes = data.candles.map(c => c.volume);

    // 价格涨跌颜色
    const upColor = "#E53935", downColor = "#43A047";
    const priceChange = prices.length >= 2 ? prices[prices.length - 1] - prices[0] : 0;
    const lineColor = priceChange >= 0 ? upColor : downColor;

    // 主力资金颜色
    const flowColors = mainFlows.map(v => v >= 0 ? "rgba(248,113,113,0.45)" : "rgba(74,222,128,0.45)");
    const flowBorders = mainFlows.map(v => v >= 0 ? "#E53935" : "#43A047");

    ffRtChart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(15,18,40,0.95)",
        borderColor: "#2a2d3e",
        textStyle: { color: "#333333", fontSize: 12 },
        formatter: (params) => {
          const idx = params[0]?.dataIndex;
          const c = data.candles[idx];
          if (!c) return "";
          const mf = c.mainFlow >= 0 ? "+" : "";
          return `<b>${c.time}</b><br/>
            价格: <b style="color:${lineColor}">${c.close.toFixed(2)}</b><br/>
            成交量: ${(c.volume/10000).toFixed(0)}万手<br/>
            成交额: ${(c.amount/1e8).toFixed(2)}亿<br/>
            主力净流: <b style="color:${c.mainFlow>=0?upColor:downColor}">${mf}${(c.mainFlow/10000).toFixed(0)}万</b>`;
        },
      },
      grid: [
        { left: 65, right: 20, top: 40, height: 210 },
        { left: 65, right: 20, top: 278, height: 80 },
        { left: 65, right: 20, top: 375, height: 32 },
      ],
      xAxis: [
        { type: "category", data: dates, gridIndex: 0,
          axisLine: { lineStyle: { color: "#2a2d3e" } },
          axisLabel: { color: "#999999", fontSize: 10, interval: Math.max(1, Math.floor(dates.length / 6)) },
          axisTick: { show: false } },
        { type: "category", data: dates, gridIndex: 1,
          axisLine: { lineStyle: { color: "#2a2d3e" } },
          axisLabel: { show: false }, axisTick: { show: false } },
        { type: "category", data: dates, gridIndex: 2,
          axisLine: { lineStyle: { color: "#2a2d3e" } },
          axisLabel: { color: "#999999", fontSize: 9, interval: Math.max(1, Math.floor(dates.length / 4)) } },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, scale: true,
          splitLine: { lineStyle: { color: "#F0F0F0" } },
          axisLabel: { color: "#666666", fontSize: 10, formatter: v => v.toFixed(0) } },
        { type: "value", gridIndex: 1,
          splitLine: { show: false },
          axisLabel: { color: "#999999", fontSize: 9, formatter: v => (v / 1e4).toFixed(0) + "万" } },
        { type: "value", gridIndex: 2,
          splitLine: { show: false },
          axisLabel: { color: "#999999", fontSize: 9, formatter: v => (v / 1e6).toFixed(1) + "M" } },
      ],
      series: [
        // 第一格: 价格曲线 + 面积填充
        {
          name: "价格", type: "line", xAxisIndex: 0, yAxisIndex: 0,
          data: prices,
          smooth: true, symbol: "none",
          lineStyle: { color: lineColor, width: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: priceChange >= 0 ? "rgba(248,113,113,0.15)" : "rgba(74,222,128,0.15)" },
              { offset: 1, color: "rgba(0,0,0,0)" },
            ]),
          },
          markLine: { silent: true, symbol: "none",
            data: [{ yAxis: data.price, lineStyle: { color: "#fbbf24", type: "dashed", width: 1 } }],
            label: { formatter: `现价 ${data.price?.toFixed(2)}`, color: "#fbbf24", fontSize: 10 },
          },
        },
        // 第二格: 主力资金流柱状图
        {
          name: "主力资金", type: "bar", xAxisIndex: 1, yAxisIndex: 1,
          data: mainFlows,
          itemStyle: {
            color: (p) => flowColors[p.dataIndex],
            borderColor: (p) => flowBorders[p.dataIndex],
            borderWidth: 0.5,
          },
          tooltip: { valueFormatter: v => (v / 1e4).toFixed(0) + "万" },
        },
        // 第三格: 成交量柱
        {
          name: "成交量", type: "bar", xAxisIndex: 2, yAxisIndex: 2,
          data: volumes.map((v, i) => ({
            value: v,
            itemStyle: {
              color: prices[i] >= (prices[i - 1] || prices[i]) ? "rgba(248,113,113,0.5)" : "rgba(74,222,128,0.5)",
            },
          })),
        },
      ],
    }, true);
  } catch (e) {
    console.error("加载实时资金流图表失败:", e);
    toast("加载实时资金流图表失败: " + (e.message || "网络错误"));
    const st = $("#ffRtStatus"); if (st) st.textContent = "加载失败";
  }
}

// 实时资金流
async function loadFundFlow() {
  const code = $("#ffCode").value.trim() || "600519";
  if (!ffDailyChart) initFFChart();
  if (!ffDailyChart) return;
  ffDailyChart.showLoading();
  if (ffVWAPChart) ffVWAPChart.showLoading();

  try {
    // 并行加载: 综合量化流 + 实时分钟流 + 实时K线
    const [quantData, liveData] = await Promise.all([
      fetch(`/api/quantflow?code=${code}`).then(r => r.json()).catch(() => null),
      fetch(`/api/fundflow/live?code=${code}`).then(r => r.json()).catch(() => null),
    ]);

    // 实时K线叠加图 (独立加载, 不阻塞主流程)
    loadRtChart(code);
    if (!quantData?.mergedFlow?.length) { toast("数据加载失败"); return; }

    // 时间 + 价格 + live dot
    const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const updateHtml = `<span class="live-dot"></span> 实时 · ${now}`;
    $("#ffRefreshTime").innerHTML = updateHtml;
    const chgColor = quantData.change >= 0 ? "#E53935" : "#43A047";
    $("#ffPrice").innerHTML = `${quantData.name || code} &nbsp;<span style="color:${chgColor};font-size:24px;">${quantData.price?.toFixed(2)}</span>`;

    // 实时资金流速指示器
    updateLiveFlowIndicator(liveData);

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
    setCard("#ffMain", quantData.summary.mainNet || 0);
    setCard("#ffInst", quantData.summary.largeNet || 0);
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
        `<div class="signal-item"><span style="color:#999999;min-width:80px">${s.date}</span><span class="signal-badge ${s.direction}">${s.direction==="buy"?"大单买入":"大单卖出"}</span><span style="color:#666666">价格 <b>${s.price?.toFixed(2)}</b></span><span style="color:#999999;font-size:12px">${s.intensity==="heavy"?"大幅放量":"温和放量"} · ${s.confidence==="high"?"高确信":"中确信"}</span></div>`
      ).join("");
    } else {
      $("#ffSignalList").innerHTML = `<div class="section-title">🔔 近期大单交易信号</div><div style="padding:16px;color:#999999;text-align:center">近20日未检测到显著大单信号</div>`;
    }

    // 图表
    const dayFlow = quantData.mergedFlow.slice(-40);
    ffDailyChart.setOption({
      backgroundColor: "transparent",
      title: { text: "每日资金流向", left: 16, top: 14, textStyle: { color: "#1A1A2E", fontSize: 14, fontWeight: 600 } },
      grid: { left: 12, right: 16, top: 50, bottom: 35 },
      xAxis: { type: "category", data: dayFlow.map(d => d.date.slice(5)), axisLabel: { color: "#999999", fontSize: 11, rotate: 45 } },
      yAxis: { axisLabel: { color: "#999999", fontSize: 11, formatter: v => (v / 1e8).toFixed(0) + "亿" }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
      tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" }, formatter: ps => {
        let s = `<b>${ps[0].axisValue}</b><br/>`; ps.forEach(p => { s += `${p.marker} ${p.seriesName}: <b>${fmtFund(p.data)}</b><br/>`; }); return s;
      }},
      legend: { right: 16, top: 10, textStyle: { color: "#666666", fontSize: 11 } },
      series: [
        { name: "大资金", type: "bar", stack: "flow", data: dayFlow.map(d => (d.main || 0)), itemStyle: { color: "#1E88E5", borderRadius: [0, 0, 0, 0] }, emphasis: { focus: "series" } },
        { name: "散户", type: "bar", stack: "flow", data: dayFlow.map(d => d.retail || 0), itemStyle: { color: "rgba(148,163,184,.5)", borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "series" } },
      ],
    }, true);

    if (quantData.indicators?.vwap?.length) {
      const indSlice = 60;
      const indDates = quantData.mergedFlow.slice(-indSlice).map(d => d.date.slice(5));
      ffVWAPChart.setOption({
        backgroundColor: "transparent",
        title: { text: "多空分界线 (VWAP) + 买卖力量 (OFI)", left: 16, top: 14, textStyle: { color: "#1A1A2E", fontSize: 14, fontWeight: 600 } },
        grid: { left: 12, right: 60, top: 50, bottom: 35 },
        xAxis: { type: "category", data: indDates, axisLabel: { color: "#999999", fontSize: 11, rotate: 30 } },
        yAxis: [
          { type: "value", axisLabel: { color: "#999999", fontSize: 11, formatter: v => v.toFixed(0) }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
          { type: "value", min: -100, max: 100, axisLabel: { color: "#999999", fontSize: 11, formatter: v => v + "%" }, splitLine: { show: false } },
        ],
        tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" },
        axisPointer: { type: "cross", lineStyle: { color: "#EAEAEA", type: "dashed" } } },
        legend: { right: 16, top: 10, textStyle: { color: "#666666", fontSize: 11 } },
        series: [
          { name: "VWAP", type: "line", data: quantData.indicators.vwap.slice(-indSlice), lineStyle: { color: "#1E88E5", width: 2 }, symbol: "none", smooth: true },
          { name: "上轨", type: "line", data: quantData.indicators.vwapUpper.slice(-indSlice), lineStyle: { color: "#E53935", width: 1, type: "dashed", opacity: .5 }, symbol: "none" },
          { name: "下轨", type: "line", data: quantData.indicators.vwapLower.slice(-indSlice), lineStyle: { color: "#43A047", width: 1, type: "dashed", opacity: .5 }, symbol: "none" },
          { name: "OFI", type: "line", yAxisIndex: 1, data: quantData.indicators.ofi.slice(-indSlice), lineStyle: { color: "#fbbf24", width: 1.5 }, symbol: "none", smooth: true,
            areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(251,191,36,.15)" }, { offset: 1, color: "rgba(251,191,36,0)" }]) },
            markLine: { silent: true, symbol: "none", data: [{ yAxis: 0, lineStyle: { color: "rgba(255,255,255,.1)" } }] },
          },
        ],
      }, true);
    }
  } catch (e) { toast("数据加载失败: " + e.message); }
  finally { try { ffDailyChart?.hideLoading(); ffVWAPChart?.hideLoading(); } catch (_) {} }
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
  const isZero = !rate && (liveData.minute?.main || 0) === 0;
  const ds = liveData.dataSource || {};
  const isRealDaily = ds.hasRealDaily;
  const hasMinute = ds.hasMinuteData;

  // 数据新鲜度标签
  let freshnessBadge = "";
  if (hasMinute) {
    freshnessBadge = `<span style="font-size:10px;background:rgba(74,222,128,0.15);color:#43A047;padding:2px 6px;border-radius:3px;margin-left:4px;" title="来自东方财富实时分钟数据">● 实时</span>`;
  } else if (isRealDaily) {
    freshnessBadge = `<span style="font-size:10px;background:rgba(250,204,21,0.15);color:#facc15;padding:2px 6px;border-radius:3px;margin-left:4px;" title="日级数据来自东方财富API，分钟数据暂不可用(可能已收盘)">● 日级</span>`;
  } else {
    freshnessBadge = `<span style="font-size:10px;background:rgba(148,163,184,0.12);color:#999999;padding:2px 6px;border-radius:3px;margin-left:4px;" title="东方财富API暂不可用，使用K线估算数据">● 估算</span>`;
  }

  container.innerHTML = `
    <div class="live-flow-indicator">
      <div class="flow-rate ${mood}">${fmtFlowRate(rate)}</div>
      <div class="flow-label">实时资金流速 ${isZero ? '(暂无交易)' : ''}</div>
    </div>
    <div class="live-flow-indicator">
      <div class="flow-rate ${mood}" style="font-size:22px;">${moodLabels[mood]}</div>
      <div class="flow-label">当前状态${isZero ? ' · 等待开盘' : ''}</div>
    </div>
    <div class="live-flow-indicator">
      <div class="flow-rate ${(liveData.minute?.main || 0) >= 0 ? 'slow_in' : 'slow_out'}" style="font-size:22px;">${fmtFund(liveData.minute?.main || 0)}</div>
      <div class="flow-label">大单净流入(累计)</div>
    </div>
    <div class="live-flow-indicator">
      <div class="flow-rate" style="font-size:20px;color:#666666;">${liveData.timestamp || '--:--:--'}${freshnessBadge}</div>
      <div class="flow-label"><span class="live-dot"></span> 实时更新</div>
    </div>
    <div class="live-flow-indicator">
      <div class="flow-rate" style="font-size:18px;color:${(liveData.acceleration||0) > 0 ? '#E53935' : (liveData.acceleration||0) < 0 ? '#43A047' : '#8890b5'};">${(liveData.acceleration||0) > 0 ? '▲ 加速流入' : (liveData.acceleration||0) < 0 ? '▼ 加速流出' : isZero ? '─ 未开盘' : '─ 匀速'}</div>
      <div class="flow-label">流速变化趋势</div>
    </div>
  `;
}


// Phase 4: Fund page rendering (Alipay-style)
let fundCurrentType = "all";
let fundCurrentSort = "1y";

async function loadFundPage() {
  const sectorGrid = $("#fundSectorGrid");
  const etfBody = $("#etfFlowBody");
  const rankBody = $("#fundRankBody");
  const rankFooter = $("#fundRankFooter");
  sectorGrid.innerHTML = '<div style="color:#999999;text-align:center;padding:20px;grid-column:1/-1;">加载中...</div>';
  etfBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999999;">加载中...</td></tr>';
  rankBody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#999999;">加载中...</td></tr>';

  try {
    const [sectors, etfFlow, ranking, aiRec] = await Promise.all([
      fetch("/api/market/fund-sectors").then(r => r.json()).catch(() => []),
      fetch("/api/market/etf-flow").then(r => r.json()).catch(() => []),
      fetch(`/api/market/fund-ranking?type=${fundCurrentType}&sort=${fundCurrentSort}&limit=20`).then(r => r.json()).catch(() => null),
      fetch("/api/market/ai-fund-recommend").then(r => r.json()).catch(() => null),
    ]);

    // Render sector flow cards
    if (Array.isArray(sectors) && sectors.length > 0) {
      sectorGrid.innerHTML = sectors.map(s => {
        const flowColor = s.totalMainNet >= 0 ? "#E53935" : "#43A047";
        const flowSign = s.totalMainNet >= 0 ? "+" : "";
        const chgColor = s.avgChangePct >= 0 ? "#E53935" : "#43A047";
        const chgSign = s.avgChangePct >= 0 ? "+" : "";
        const subSectors = s.sectors.slice(0, 3).map(ss =>
          `${ss.name} ${(ss.changePct||0)>=0?'+':''}${(ss.changePct||0).toFixed(1)}%`
        ).join(" · ");
        return `<div class="fund-sector-card">
          <div class="fs-icon">${s.icon}</div>
          <div class="fs-tag">${s.tag}</div>
          <div class="fs-flow" style="color:${flowColor}">${flowSign}${fmtFund(s.totalMainNet)}</div>
          <div class="fs-change" style="color:${chgColor}">板块均涨 ${chgSign}${s.avgChangePct}%</div>
          <div class="fs-sectors">${subSectors}</div>
        </div>`;
      }).join("");
    } else {
      sectorGrid.innerHTML = '<div style="color:#999999;text-align:center;padding:20px;grid-column:1/-1;">暂无板块数据</div>';
    }

    // Render ETF flow table
    if (Array.isArray(etfFlow) && etfFlow.length > 0) {
      etfBody.innerHTML = etfFlow.map(function(e) {
        var chgCls = e.changePct >= 0 ? "rank-up" : "rank-down";
        var chgSign = e.changePct >= 0 ? "+" : "";
        var flowCls = e.mainNet >= 0 ? "rank-up" : "rank-down";
        var flowSign = e.mainNet >= 0 ? "+" : "";
        var pctCls = e.mainPct >= 0 ? "rank-up" : "rank-down";
        var pctSign = e.mainPct >= 0 ? "+" : "";
        // ETF code tags from the etf-flow endpoint (or use ETF_MAP from server)
        var etfTags = (e.etfs || []).map(function(c) {
          return '<span class="etf-code-tag" data-etf-code="' + c + '" title="点击查看 ' + c + ' 详情">' + c + '</span>';
        }).join("");
        return '<tr class="etf-row-clickable" data-etf-name="' + (e.name || "") + '">' +
          '<td><span class="etf-name">' + (e.name || "?") + '</span></td>' +
          '<td class="' + chgCls + '">' + chgSign + (e.changePct != null ? e.changePct.toFixed(2) : "--") + '%</td>' +
          '<td class="' + flowCls + '">' + flowSign + fmtFund(e.mainNet) + '</td>' +
          '<td style="color:' + (e.hugeNet >= 0 ? '#E53935' : '#43A047') + '">' + (e.hugeNet >= 0 ? '+' : '') + fmtFund(e.hugeNet) + '</td>' +
          '<td style="color:' + (e.largeNet >= 0 ? '#E53935' : '#43A047') + '">' + (e.largeNet >= 0 ? '+' : '') + fmtFund(e.largeNet) + '</td>' +
          '<td class="' + pctCls + '">' + pctSign + (e.mainPct != null ? e.mainPct.toFixed(2) : "--") + '%</td>' +
          '<td>' + (etfTags || '<span style="color:#999999;">--</span>') + '</td>' +
        '</tr>';
      }).join("");
    } else {
      etfBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999999;">暂无ETF板块数据</td></tr>';
    }

    // Render fund ranking table
    const funds = ranking?.funds || [];
    if (funds.length > 0) {
      rankBody.innerHTML = funds.map((f, i) => {
        const dailyCls = f.dailyReturn >= 0 ? "rank-up" : "rank-down";
        const m1Cls = f.monthlyReturn >= 0 ? "rank-up" : "rank-down";
        const m3Cls = f.return3m >= 0 ? "rank-up" : "rank-down";
        const m6Cls = f.return6m >= 0 ? "rank-up" : "rank-down";
        const y1Cls = f.return1y >= 0 ? "rank-up" : "rank-down";
        const rtBadge = f.realtime ? `<span class="fund-rt-badge">实时 ${(f.realtime.estChange>=0?'+':'')}${f.realtime.estChange}%</span>` : "";
        const sign = (v) => v >= 0 ? "+" : "";
        return `<tr class="fund-rank-clickable" data-fund-code="${f.code}" data-fund-name="${f.name}" style="cursor:pointer;">
          <td>${i + 1}</td>
          <td><span style="color:#c8cdf0;font-weight:500;">${f.name}</span>${rtBadge} <span style="font-size:10px;color:#999999;">${f.code}</span></td>
          <td style="color:#c8cdf0;">${f.nav.toFixed(4)}</td>
          <td class="${dailyCls}">${sign(f.dailyReturn)}${f.dailyReturn.toFixed(2)}%</td>
          <td class="${m1Cls}">${sign(f.monthlyReturn)}${f.monthlyReturn.toFixed(2)}%</td>
          <td class="${m3Cls}">${sign(f.return3m)}${f.return3m.toFixed(2)}%</td>
          <td class="${m6Cls}">${sign(f.return6m)}${f.return6m.toFixed(2)}%</td>
          <td class="${y1Cls}">${sign(f.return1y)}${f.return1y.toFixed(2)}%</td>
          <td style="color:#666666;font-size:12px;">${f.size > 0 ? f.size.toFixed(1) : "--"}</td>
        </tr>`;
      }).join("");
      rankFooter.textContent = `共 ${ranking.total} 只基金 · 股票型${ranking.types?.equity||0} 混合型${ranking.types?.hybrid||0} 指数型${ranking.types?.index||0} 债券型${ranking.types?.bond||0}`;
    }

    // AI recommendation
    const aiBox = $("#fundAIRecommend");
    if (aiRec?.text) {
      aiBox.style.display = "block";
      $("#fundAIRecommendText").textContent = aiRec.text;
    } else {
      aiBox.style.display = "none";
    }
  } catch (e) {
    sectorGrid.innerHTML = '<div style="color:#E53935;text-align:center;padding:20px;grid-column:1/-1;">加载失败: ' + e.message + '</div>';
    rankBody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#E53935;">加载失败</td></tr>';
  }
}

// Fund type/sort toggle handlers
document.addEventListener("click", function(e) {
  const typeBtn = e.target.closest(".fund-type-btn");
  const sortBtn = e.target.closest(".fund-sort-btn");
  if (typeBtn) {
    $$(".fund-type-btn").forEach(b => b.classList.remove("active"));
    typeBtn.classList.add("active");
    fundCurrentType = typeBtn.dataset.ft;
    loadFundPage();
  }
  if (sortBtn) {
    $$(".fund-sort-btn").forEach(b => b.classList.remove("active"));
    sortBtn.classList.add("active");
    fundCurrentSort = sortBtn.dataset.sort;
    loadFundPage();
  }
  // Fund row click → show detail
  const fundRow = e.target.closest(".fund-rank-clickable");
  if (fundRow) {
    const code = fundRow.dataset.fundCode;
    const name = fundRow.dataset.fundName;
    showFundDetail(code, name);
  }
  // Close fund detail
  if (e.target.closest("#btnFundDetailClose") || e.target.closest("#fundDetailOverlay") && !e.target.closest(".fund-detail-modal")) {
    closeFundDetail();
  }
  // Fund search item click
  const searchItem = e.target.closest(".fund-search-item");
  if (searchItem) {
    showFundDetail(searchItem.dataset.fundCode, searchItem.dataset.fundName);
    $("#fundSearchDropdown").style.display = "none";
    $("#fundSearchInput").value = "";
  }
  // ETF code tag click → search and show detail
  const etfTag = e.target.closest(".etf-code-tag");
  if (etfTag) {
    e.stopPropagation();
    var etfCode = etfTag.dataset.etfCode;
    if (etfCode) {
      showFundDetail(etfCode, etfCode);
    }
  }
  // Close search dropdown when clicking outside
  if (!e.target.closest(".fund-search-wrap")) {
    $("#fundSearchDropdown").style.display = "none";
  }
});

// Fund search with debounce
let fundSearchTimer = null;
var fundSearchEl = $("#fundSearchInput");
if (fundSearchEl) {
fundSearchEl.addEventListener("input", function() {
  clearTimeout(fundSearchTimer);
  var q = this.value.trim();
  if (!q) { $("#fundSearchDropdown").style.display = "none"; return; }
  var dropdown = $("#fundSearchDropdown");
  dropdown.innerHTML = '<div style="padding:12px 14px;color:#999999;font-size:13px;">搜索中...</div>';
  dropdown.style.display = "block";
  fundSearchTimer = setTimeout(async function() {
    try {
      var resp = await fetch("/api/market/fund-search?q=" + encodeURIComponent(q));
      var data = await resp.json();
      if (!data.funds || data.funds.length === 0) {
        dropdown.innerHTML = '<div style="padding:12px 14px;color:#999999;font-size:13px;">未找到相关基金</div>';
        return;
      }
      dropdown.innerHTML = data.funds.filter(function(f) { return f.nav != null; }).map(function(f) {
        return '<div class="fund-search-item" data-fund-code="' + f.code + '" data-fund-name="' + f.name + '">' +
          '<div><div class="fsi-name">' + f.name + '</div><div class="fsi-code">' + f.code + ' · ' + (f.type || "") + '</div></div>' +
          '<div class="fsi-return" style="color:#c8cdf0;font-size:11px;">净值 ' + (f.nav != null ? Number(f.nav).toFixed(4) : "--") + '</div>' +
        '</div>';
      }).join("");
    } catch(e) {
      dropdown.innerHTML = '<div style="padding:12px 14px;color:#E53935;font-size:13px;">搜索失败，请重试</div>';
    }
  }, 300);
});
fundSearchEl.addEventListener("keydown", function(e) {
  if (e.key === "Escape") { $("#fundSearchDropdown").style.display = "none"; this.blur(); }
});
} // end if fundSearchEl

// Fund detail: NAV chart + signals + intraday
let fundNAVChart, fundMACDChart, fundRSIChart, fundIntradayChart;
let fundIntradayPoll = null;
let fundIntradayPoints = [];

function initFundCharts() {
  if (!fundNAVChart) fundNAVChart = ChartManager.getChart("chartFundNAV", "fund");
  if (!fundMACDChart) fundMACDChart = ChartManager.getChart("chartFundMACD", "fund");
  if (!fundRSIChart) fundRSIChart = ChartManager.getChart("chartFundRSI", "fund");
  // fundIntradayChart is initialized lazily in startFundIntradayPoll
}

async function showFundDetail(code, name) {
  const overlay = $("#fundDetailOverlay");
  overlay.style.display = "flex";
  $("#fundDetailTitle").textContent = "📈 " + name + " (" + code + ")";
  $("#fundDetailSignal").style.display = "none";
  $("#fundDetailInfo").innerHTML = '<div style="color:#999999;text-align:center;grid-column:1/-1;">加载中...</div>';

  initFundCharts();
  if (fundNAVChart) fundNAVChart.showLoading();
  if (fundMACDChart) fundMACDChart.showLoading();
  if (fundRSIChart) fundRSIChart.showLoading();

  try {
    const resp = await fetch("/api/fund/nav/" + code);
    const data = await resp.json();
    if (data.error) { toast(data.error); closeFundDetail(); return; }

    // Render signal bar
    const sig = data.signals;
    if (sig && sig.consensus) {
      const config = {
        strong_buy: { color: "#E53935", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", icon: "🔥", text: "强烈看多" },
        buy: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", icon: "📈", text: "偏多" },
        sell: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.3)", icon: "📉", text: "偏空" },
        strong_sell: { color: "#43A047", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.3)", icon: "⚠️", text: "强烈看空" },
        neutral: { color: "#666666", bg: "rgba(136,144,181,0.08)", border: "rgba(136,144,181,0.2)", icon: "📊", text: "方向不明" },
      };
      const c = config[sig.consensus] || config.neutral;
      const v = sig.votes || {};
      const signalEl = $("#fundDetailSignal");
      signalEl.style.display = "block";
      signalEl.style.background = c.bg;
      signalEl.style.border = "1px solid " + c.border;
      signalEl.style.color = c.color;
      signalEl.innerHTML = `<span style="font-size:22px;">${c.icon}</span> <b>${c.text}</b> · ${v.buy||0}买 ${v.sell||0}卖`;
    }

    // Render NAV K-line chart
    const ind = data.indicators;
    const ohlc = ind.opens.map((o, i) => [ind.opens[i], ind.navs[i], ind.lows[i], ind.highs[i]]);

    // Live signal marker for funds
    const fundLiveMarkers = [];
    if (sig && sig.consensus && (sig.consensus === "strong_buy" || sig.consensus === "buy" || sig.consensus === "sell" || sig.consensus === "strong_sell")) {
      const lastDate = ind.dates[ind.dates.length - 1];
      const lastNAV = ind.navs[ind.navs.length - 1];
      const isBuy = sig.consensus === "strong_buy" || sig.consensus === "buy";
      fundLiveMarkers.push({
        name: "实时信号", type: "scatter",
        data: [{ value: [lastDate, lastNAV], symbolSize: 30 }],
        symbol: isBuy ? "arrow" : "arrow",
        symbolRotate: isBuy ? 0 : 180,
        symbolOffset: [0, isBuy ? 16 : -16],
        itemStyle: { color: isBuy ? "#E53935" : "#43A047", shadowBlur: 12, shadowColor: isBuy ? "rgba(239,68,68,0.7)" : "rgba(34,197,94,0.7)" },
        label: { show: true, position: isBuy ? "bottom" : "top", formatter: isBuy ? "🔥买入" : "📉卖出", color: isBuy ? "#E53935" : "#43A047", fontSize: 12, fontWeight: 800, distance: 6 },
      });
    }

    fundNAVChart.setOption({
      backgroundColor: "transparent",
      title: { text: name + " 净值走势", left: 16, top: 14, textStyle: { color: "#1A1A2E", fontSize: 14 } },
      grid: { left: 12, right: 16, top: 50, bottom: 60 },
      xAxis: { type: "category", data: ind.dates, axisLabel: { color: "#999999", fontSize: 10 } },
      yAxis: { type: "value", scale: true, axisLabel: { color: "#999999", fontSize: 11, formatter: v => v.toFixed(3) }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
      dataZoom: [
        { type: "inside", start: 60, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: "slider", start: 60, end: 100, height: 20, bottom: 6, borderColor: "#F0F0F0", backgroundColor: "rgba(255,255,255,.6)", dataBackground: { lineStyle: { color: "#EAEAEA" }, areaStyle: { color: "rgba(0,0,0,.02)" } }, selectedDataBackground: { lineStyle: { color: "#8E24AA" }, areaStyle: { color: "rgba(142,36,170,.1)" } }, handleStyle: { color: "#666666" }, textStyle: { color: "#999999" } },
      ],
      tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" }, formatter: ps => {
        const main = ps.find(p => p.seriesName === "净值"); if (!main) return "";
        return `${main.axisValue}<br/>净值: ${main.data[1]?.toFixed(4)}`;
      }},
      series: [
        { name: "净值", type: "candlestick", data: ohlc, itemStyle: { color: "#E53935", color0: "#43A047", borderColor: "#E53935", borderColor0: "#43A047" } },
        { name: "MA5", type: "line", data: ind.ma5, lineStyle: { color: "#E53935", width: 1 }, symbol: "none" },
        { name: "MA10", type: "line", data: ind.ma10, lineStyle: { color: "#fbbf24", width: 1 }, symbol: "none" },
        { name: "MA20", type: "line", data: ind.ma20, lineStyle: { color: "#8E24AA", width: 1 }, symbol: "none" },
        { name: "MA60", type: "line", data: ind.ma60, lineStyle: { color: "#38bdf8", width: 1 }, symbol: "none" },
        ...fundLiveMarkers,
      ],
      legend: { right: 16, top: 4, textStyle: { color: "#666666", fontSize: 10 } },
    }, true);

    // MACD chart
    fundMACDChart.setOption({
      backgroundColor: "transparent", grid: { left: 12, right: 12, top: 10, bottom: 25 },
      xAxis: { type: "category", data: ind.dates, axisLabel: { color: "#999999", fontSize: 10, interval: Math.floor(ind.dates.length / 8) } },
      yAxis: { axisLabel: { color: "#999999", fontSize: 10 }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
      series: [
        { name: "DIF", type: "line", data: ind.macd.dif, lineStyle: { color: "#38bdf8", width: 1 }, symbol: "none" },
        { name: "DEA", type: "line", data: ind.macd.dea, lineStyle: { color: "#fbbf24", width: 1 }, symbol: "none" },
        { name: "MACD", type: "bar", data: ind.macd.macd, itemStyle: { color: p => p.data >= 0 ? "#E53935" : "#43A047" } },
      ],
      legend: { right: 16, top: 4, textStyle: { color: "#666666", fontSize: 10 } },
      tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" } },
    }, true);

    // RSI chart
    fundRSIChart.setOption({
      backgroundColor: "transparent", grid: { left: 12, right: 12, top: 10, bottom: 25 },
      xAxis: { type: "category", data: ind.dates, axisLabel: { color: "#999999", fontSize: 10, interval: Math.floor(ind.dates.length / 8) } },
      yAxis: { min: 0, max: 100, axisLabel: { color: "#999999", fontSize: 10 }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
      series: [{ name: "RSI(14)", type: "line", data: ind.rsi, lineStyle: { color: "#8E24AA", width: 1.5 }, symbol: "none",
        markLine: { silent: true, symbol: "none", data: [{ yAxis: 70, lineStyle: { color: "#E53935", type: "dashed" } }, { yAxis: 30, lineStyle: { color: "#43A047", type: "dashed" } }] }
      }],
    }, true);

    // Info grid
    const ret = data.returns;
    const retCls = v => v >= 0 ? "rank-up" : "rank-down";
    const retSign = v => v >= 0 ? "+" : "";
    $("#fundDetailInfo").innerHTML = `
      <div class="fdi-item"><div class="fdi-label">最新净值</div><div class="fdi-val" style="color:#c8cdf0;">${data.nav.toFixed(4)}</div></div>
      <div class="fdi-item"><div class="fdi-label">日涨跌</div><div class="fdi-val ${retCls(ret.daily)}">${retSign(ret.daily)}${ret.daily}%</div></div>
      <div class="fdi-item"><div class="fdi-label">近1月收益</div><div class="fdi-val ${retCls(ret.month)}">${ret.month!=null ? retSign(ret.month)+ret.month+'%' : '--'}</div></div>
      <div class="fdi-item"><div class="fdi-label">近1年收益</div><div class="fdi-val ${retCls(ret.year)}">${ret.year!=null ? retSign(ret.year)+ret.year+'%' : '--'}</div></div>
    `;

    // Start intraday live polling
    startFundIntradayPoll(code);

  } catch (e) { toast("加载基金详情失败: " + e.message); }
  finally { fundNAVChart.hideLoading(); fundMACDChart.hideLoading(); fundRSIChart.hideLoading(); }
}

function closeFundDetail() {
  $("#fundDetailOverlay").style.display = "none";
  stopFundIntradayPoll();
  if (fundNAVChart) { fundNAVChart.clear(); }
  if (fundMACDChart) { fundMACDChart.clear(); }
  if (fundRSIChart) { fundRSIChart.clear(); }
  if (fundIntradayChart) { fundIntradayChart.clear(); }
}

// --- Fund intraday live chart (like 养基宝) ---

function startFundIntradayPoll(code) {
  stopFundIntradayPoll();
  fundIntradayPoints = [];

  $("#fdiUpdateTime").textContent = "加载中...";
  $("#fdiBadge").textContent = "";
  $("#fdiBadge").className = "fdi-badge";

  // Lazy-init chart so the container is visible and has proper dimensions
  try {
    if (!fundIntradayChart) {
      var container = $("#chartFundIntraday");
      if (!container) throw new Error("chart container not found");
      // Reset container from any previous text-display state
      container.style.display = "";
      container.style.alignItems = "";
      container.style.justifyContent = "";
      container.style.flexDirection = "";
      container.innerHTML = "";
      fundIntradayChart = ChartManager.getChart(container, "fund");
      fundIntradayChart.resize();
    }
  } catch (e) {
    $("#fdiUpdateTime").textContent = "图表初始化失败";
    return;
  }
  if (!fundIntradayChart) return;
  fundIntradayChart.showLoading({ text: "正在获取实时估算..." });

  // Step 1: Fetch full intraday K-line from holdings
  fetch("/api/fund/intraday-kline/" + code)
    .then(r => r.json())
    .then(kdata => {
      if (kdata.error && !kdata.kline) {
        fundIntradayChart.hideLoading();
        // Show a helpful message instead of just error text
        var container = $("#chartFundIntraday");
        if (container) {
          container.style.display = "flex";
          container.style.alignItems = "center";
          container.style.justifyContent = "center";
          container.style.flexDirection = "column";
          container.innerHTML = '<div style="text-align:center;color:#999999;padding:20px;">' +
            '<div style="font-size:14px;color:#666666;margin-bottom:8px;">⏳ ' + (kdata.error || "暂无数据") + '</div>' +
            '<div style="font-size:12px;">交易时间: 周一至周五 9:30-15:00</div>' +
            '<div style="font-size:12px;color:#999999;">开盘后将显示完整分时K线图</div>' +
            '</div>';
          fundIntradayChart.dispose();
          fundIntradayChart = null;
        }
        return;
      }

      // Load full intraday points
      if (kdata.kline && kdata.kline.length > 0) {
        fundIntradayPoints = kdata.kline.map(p => ({
          time: p.time,
          nav: p.estNAV,
          chg: p.change
        }));
      }

      // Update header
      const lastPt = fundIntradayPoints[fundIntradayPoints.length - 1];
      if (lastPt && lastPt.chg != null) {
        const isUp = lastPt.chg >= 0;
        const badge = $("#fdiBadge");
        badge.textContent = (isUp ? "+" : "") + lastPt.chg + "%";
        badge.className = "fdi-badge " + (isUp ? "up" : "down");
      }
      $("#fdiUpdateTime").textContent = (fundIntradayPoints.length > 0 && !kdata.isTrading)
        ? "已收盘 · " + fundIntradayPoints.length + "个数据点"
        : fundIntradayPoints.length + "个数据点";

      // When only 1-2 data points (e.g. fundgz fallback), show text overlay
      if (fundIntradayPoints.length < 2) {
        var container = $("#chartFundIntraday");
        if (container) {
          var chg = lastPt.chg || 0;
          var chgColor = chg >= 0 ? "#E53935" : "#43A047";
          var chgSign = chg >= 0 ? "+" : "";
          container.style.display = "flex";
          container.style.alignItems = "center";
          container.style.justifyContent = "center";
          container.style.flexDirection = "column";
          container.style.color = "#c8cdf0";
          container.innerHTML = '<div style="text-align:center;">' +
            '<div style="font-size:36px;font-weight:800;color:' + chgColor + ';margin-bottom:4px;">' +
            (lastPt.nav || kdata.prevClose || 1).toFixed(4) + '</div>' +
            '<div style="font-size:16px;color:' + chgColor + ';">' + chgSign + chg + '%</div>' +
            '<div style="font-size:10px;color:#999999;margin-top:6px;">盘后估值 · 基于' + (kdata.source || "fundgz") + '</div>' +
            '<div style="font-size:10px;color:#999999;">交易时段将显示完整分时K线</div>' +
            '</div>';
          fundIntradayChart.hideLoading();
          fundIntradayChart.dispose();
          fundIntradayChart = null;
          return;
        }
      } else {
        // Restore chart container for normal chart rendering
        var container = $("#chartFundIntraday");
        if (container) {
          container.style.display = "";
          container.style.alignItems = "";
          container.style.justifyContent = "";
          container.style.flexDirection = "";
          container.innerHTML = "";
        }
      }

      renderIntradayChart(kdata.prevClose);
      fundIntradayChart.hideLoading();

      // Step 2: poll for live updates during market hours
      if (kdata.isTrading) {
        fundIntradayPoll = setInterval(() => {
          fetch("/api/fund/intraday/" + code)
            .then(r => r.json())
            .then(idata => {
              if (idata.error || !idata.isTrading) return;
              const now = new Date();
              const timeStr = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
              let estChg = idata.rtEstimate?.estChange;
              if (estChg == null && idata.holdingsRT) estChg = idata.holdingsRT.weightedChg;
              let estNAV = idata.rtEstimate?.estNAV;

              // Append live point to kline
              fundIntradayPoints.push({ time: timeStr, nav: estNAV, chg: estChg });
              if (fundIntradayPoints.length > 300) fundIntradayPoints.shift();

              const badge = $("#fdiBadge");
              if (estChg != null) {
                badge.textContent = (estChg >= 0 ? "+" : "") + estChg + "%";
                badge.className = "fdi-badge " + (estChg >= 0 ? "up" : "down");
              }
              $("#fdiUpdateTime").textContent = "实时 " + timeStr;
              renderIntradayChart(idata.prevClose);
            }).catch(() => {});
        }, 60000);
        TimerManager.register('fundIntradayPoll', fundIntradayPoll, 'fund');
      }
    })
    .catch(e => {
      fundIntradayChart.hideLoading();
      $("#fdiUpdateTime").textContent = "加载失败";
    });
}

function stopFundIntradayPoll() {
  if (fundIntradayPoll) { clearInterval(fundIntradayPoll); fundIntradayPoll = null; }
}

function renderIntradayChart(prevClose) {
  var pts = fundIntradayPoints;
  if (!pts.length) return;

  var times = pts.map(function(p) { return p.time; });
  var navs = pts.map(function(p) { return p.nav; });
  var changes = pts.map(function(p) { return p.chg; });

  // Determine interval for x-axis labels (show ~6 labels)
  var xInterval = Math.max(1, Math.floor(times.length / 6));

  // Color based on overall change
  var lastChg = changes[changes.length - 1];
  var lineColor = lastChg >= 0 ? "#E53935" : "#43A047";
  var areaTop = lastChg >= 0 ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.25)";

  fundIntradayChart.setOption({
    backgroundColor: "transparent",
    grid: { left: 14, right: 20, top: 16, bottom: 60 },
    xAxis: {
      type: "category", data: times,
      axisLabel: { color: "#999999", fontSize: 10, interval: xInterval },
      axisLine: { lineStyle: { color: "#EAEAEA" } },
      splitLine: { show: false }
    },
    yAxis: [
      { type: "value", scale: true,
        axisLabel: { color: "#999999", fontSize: 10, formatter: function(v) { return v.toFixed(4); } },
        splitLine: { lineStyle: { color: "#F0F0F0" } }
      },
      { type: "value", scale: true,
        axisLabel: { color: "#999999", fontSize: 10, formatter: function(v) { return v.toFixed(2) + "%"; } },
        splitLine: { show: false }
      }
    ],
    dataZoom: [
      { type: "inside", start: 30, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true },
      { type: "slider", start: 30, end: 100, height: 20, bottom: 6, borderColor: "#F0F0F0", backgroundColor: "rgba(255,255,255,.6)", dataBackground: { lineStyle: { color: "#EAEAEA" }, areaStyle: { color: "rgba(0,0,0,.02)" } }, selectedDataBackground: { lineStyle: { color: "#8E24AA" }, areaStyle: { color: "rgba(142,36,170,.1)" } }, handleStyle: { color: "#666666" }, textStyle: { color: "#999999" } },
    ],
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.97)", borderColor: "rgba(255,255,255,0.1)", textStyle: { color: "#333333", fontSize: 12 },
      formatter: function(ps) {
        var p = null;
        for (var i = 0; i < (ps||[]).length; i++) {
          if (ps[i].seriesName === "估算净值") { p = ps[i]; break; }
        }
        if (!p) return "";
        var idx = p.dataIndex;
        var chg = changes[idx];
        var chgColor = chg >= 0 ? "#E53935" : "#43A047";
        var chgSign = chg >= 0 ? "+" : "";
        return "<b>" + times[idx] + "</b><br/>" +
               "估算净值: <b>" + Number(p.data).toFixed(4) + "</b><br/>" +
               "涨跌幅: <b style=\"color:" + chgColor + "\">" + chgSign + chg + "%</b>";
      }
    },
    series: [
      { name: "昨收", type: "line", yAxisIndex: 0, data: new Array(times.length).fill(prevClose),
        lineStyle: { color: "#666666", type: "dashed", width: 1 }, symbol: "none",
        markLine: prevClose != null ? { silent: true, symbol: "none", lineStyle: { color: "#666666", type: "dashed", width: 1 },
          label: { formatter: "昨收 " + prevClose.toFixed(4), color: "#666666", fontSize: 10, position: "end" },
          data: [{ yAxis: prevClose }] } : undefined
      },
      { name: "估算净值", type: "line", yAxisIndex: 0, data: navs, smooth: times.length >= 2,
        lineStyle: { color: lineColor, width: 2 },
        symbol: times.length < 5 ? "circle" : "none",
        symbolSize: times.length < 5 ? 8 : 0,
        areaStyle: times.length >= 2 ? { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: areaTop }, { offset: 1, color: "rgba(0,0,0,0)" }
        ]) } : undefined
      },
    ],
    legend: { show: false },
  }, true);
  if (fundIntradayChart) fundIntradayChart.resize();
}

function generateFFInsight(quantData, liveData) {
  const s = quantData.summary;
  const ofi = quantData.lastOFI || 0;
  const vwapDelta = quantData.price && quantData.lastVWAP ? ((quantData.price - quantData.lastVWAP) / quantData.lastVWAP * 100) : 0;
  const totalBig = (s.mainNet || 0);
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
function toggleAutoRefresh() {
  clearInterval(ffLiveTimer);
  TimerManager.clear('ffLive');
  if ($("#ffAutoRefreshCb")?.checked) {
    loadFundFlow();
    ffLiveTimer = setInterval(loadFundFlow, isTradingHours() ? 8000 : 60000);
    TimerManager.register('ffLive', ffLiveTimer, 'fundflow');
  }
}

$("#btnLoadFF")?.addEventListener("click", loadFundFlow);
$("#ffCode")?.addEventListener("keydown", e => { if (e.key === "Enter") loadFundFlow(); });
$("#ffAutoRefreshCb")?.addEventListener("change", toggleAutoRefresh);

// 资金流向时间维度切换
$$(".ff-tf-btn").forEach(btn => btn.addEventListener("click", function() {
  $$(".ff-tf-btn").forEach(b => b.classList.remove("active"));
  this.classList.add("active");
  const tf = this.dataset.tf;
  // 不同维度调整图表显示范围
  if (ffDailyChart) {
    const zoomMap = { realtime: 20, minute5: 40, daily: 60 };
    const end = 100; // percentage
    ffDailyChart.dispatchAction({ type: "dataZoom", start: Math.max(0, end - (zoomMap[tf] || 40)), end });
  }
}));

// ====================================================================
//  6. 批量选股
// ====================================================================

// 扫描模式按钮切换
document.querySelectorAll("#page-scan .scan-mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#page-scan .scan-mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    // 同步更新快捷预设按钮状态
    document.querySelectorAll("#page-scan [data-preset]").forEach(b => b.classList.remove("active"));
    const matchingPreset = document.querySelector(`#page-scan [data-preset="${btn.dataset.mode}"]`);
    if (matchingPreset) matchingPreset.classList.add("active");
    // 更新提示
    const hint = $("#scanStatusHint");
    if (hint) hint.textContent = `已选：${btn.textContent.trim().split('\n')[0]}`;
  });
});

// 快捷预设按钮
document.querySelectorAll("#page-scan [data-preset]").forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.preset;
    // 切换模式按钮
    document.querySelectorAll("#page-scan .scan-mode-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.mode === mode);
    });
    document.querySelectorAll("#page-scan [data-preset]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    // 触发扫描
    $("#btnScan")?.click();
  });
});

let scanAbortController = null;

// 信号白话解释 — 让普通人也看得懂
const SIGNAL_PLAIN = {
  "MACD金叉": "短期趋势转强",
  "MACD底叉": "底部出现反弹苗头",
  "MACD红柱放大": "上涨动力在增强",
  "RSI超卖": "跌太多了，有反弹需求",
  "RSI过热": "涨太多了，小心回调",
  "触布林下轨": "跌到支撑位附近",
  "触布林上轨": "涨到压力位附近",
  "布林收窄": "波动变小，快要变盘了",
  "MA5>MA10": "短线方向向上",
  "均线多头": "均线齐头向上，趋势好",
  "明显放量": "成交量显著放大，大资金在动",
  "放量": "成交量放大，有资金关注",
  "缩量": "成交量萎缩，交易清淡",
  "缩量筑底": "缩量整理，可能是在筑底",
  "突破前高": "突破近期最高点，打开上涨空间",
  "逼近前高": "快到前期高点了，看能不能过去",
  "KDJ金叉": "短线反弹信号",
  "KDJ超卖": "短线超跌，有反弹需求",
  "强势拉升": "短期涨幅大，势头猛",
  "温和上涨": "慢慢涨，比较稳",
  "短期超跌": "短期跌太多，可能反弹",
};

function explainStock(d) {
  const parts = [];
  // 位置解读
  if (d.positionScore >= 15) parts.push("股价在相对低位");
  else if (d.positionScore >= 8) parts.push("位置不算高");
  else if (d.positionScore <= 2) parts.push("已脱离底部区域");
  // 动能解读
  if (d.launchScore >= 24) parts.push("上攻动能很强");
  else if (d.launchScore >= 16) parts.push("有启动迹象");
  // 趋势解读
  if (d.trendScore >= 27) parts.push("上升趋势明确");
  else if (d.trendScore >= 18) parts.push("趋势向好");
  // 涨跌幅
  if (d.chg5 > 15) parts.push("但短线涨幅已大，追高需谨慎");
  else if (d.chg5 > 8) parts.push("短线涨幅较大");
  else if (d.chg5 < -5) parts.push("短线回调中");
  // 量能
  if (d.volRatio > 2) parts.push("今天明显放量");
  else if (d.volRatio > 1.5) parts.push("成交量有放大");
  // 综合
  if (parts.length === 0) parts.push("各项指标较为均衡");
  return parts.join("，") + "。";
}

$("#btnScan")?.addEventListener("click", async () => {
  // 取消上一次扫描
  if (scanAbortController) { scanAbortController.abort(); }
  scanAbortController = new AbortController();
  const signal = scanAbortController.signal;

  const btn = $("#btnScan");
  btn.textContent = "⏳ 扫描中..."; btn.disabled = true;

  // 读取参数
  const activeMode = document.querySelector("#page-scan .scan-mode-btn.active");
  const mode = activeMode?.dataset.mode || "all";
  const minScore = $("#scanMinScore")?.value || "30";
  const limit = $("#scanLimit")?.value || "30";

  // 进度条
  const progress = $("#scanProgress");
  const progressFill = progress?.querySelector(".progress-fill");
  const progressText = $("#scanProgressText");
  if (progress) progress.style.display = "block";

  // 进度模拟 (后端没有实时进度，用动画模拟等待)
  let simProgress = 0;
  const simTimer = setInterval(() => {
    simProgress = Math.min(90, simProgress + Math.random() * 15);
    if (progressFill) progressFill.style.width = simProgress + "%";
    if (progressText && simProgress < 30) progressText.textContent = "正在获取K线数据...";
    else if (progressText && simProgress < 60) progressText.textContent = "计算技术指标中...";
    else if (progressText && simProgress < 85) progressText.textContent = "综合评分排序...";
  }, 400);

  try {
    const resp = await fetch(`/api/scan?mode=${mode}&minScore=${minScore}&limit=${limit}`, { signal });
    const data = await resp.json();

    if (signal.aborted) return;
    clearInterval(simTimer);
    if (progressFill) progressFill.style.width = "100%";
    if (progressText) progressText.textContent = "完成!";
    setTimeout(() => { if (progress) progress.style.display = "none"; }, 600);

    const results = data.results || data; // 兼容旧格式
    const resultsArray = Array.isArray(data) ? data : results;
    const el = $("#scanResults");

    if (!resultsArray.length) {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:#999999;">
        <div style="font-size:48px;margin-bottom:12px;">🔍</div>
        <b style="color:#666666;">没有符合当前筛选条件的股票</b>
        <p style="margin-top:6px;">试试降低"最低分"阈值，或切换到"全面扫描"模式</p>
      </div>`;
      return;
    }

    // 扫描信息头
    const modeLabel = data.mode || "批量选股";
    const totalPassed = data.totalPassed || resultsArray.length;
    const totalScanned = data.totalScanned || "?";

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div>
          <b style="color:#c8cdf0;font-size:15px;">${modeLabel} — 扫描结果</b>
          <span style="font-size:11px;color:#999999;margin-left:8px;">扫描 ${totalScanned} 只 → 通过 ${totalPassed} 只</span>
          ${data.regime ? `<span class="regime-tag regime-${data.regime}">${data.regime === 'bull' ? '牛市' : data.regime === 'bear' ? '熊市' : data.regime === 'range' ? '震荡' : '高波动'}</span>` : ''}
        </div>
        <span style="font-size:11px;color:#999999;">点击任意结果查看详情</span>
      </div>
      <div class="scan-results-list">
        ${resultsArray.map((d, i) => {
          const scoreColor = d.score >= 60 ? '#E53935' : d.score >= 45 ? '#f59e0b' : d.score >= 30 ? '#3b82f6' : '#999999';
          const ringBg = d.score >= 60 ? 'rgba(248,113,113,.12)' : d.score >= 45 ? 'rgba(245,158,11,.12)' : d.score >= 30 ? 'rgba(59,130,246,.12)' : 'rgba(148,163,184,.08)';
          const chgColor = d.chg5 >= 0 ? '#E53935' : '#43A047';
          const chgStr = (d.chg5 >= 0 ? '+' : '') + (d.chg5?.toFixed(1) || '0.0');
          const signals = d.signals || [];
          const chipColors = ['rgba(245,158,11,.12)', 'rgba(239,68,68,.10)', 'rgba(139,92,246,.10)', 'rgba(34,197,94,.10)', 'rgba(59,130,246,.10)'];
          const chipTextColors = ['#f59e0b', '#E53935', '#8E24AA', '#43A047', '#60a5fa'];
          return `
          <div class="scan-result-card clickable" data-code="${d.code}" title="点击查看 ${d.name || d.code} 的详细分析">
            <div class="scan-result-header">
              <span class="scan-rank" style="color:${scoreColor}">#${i + 1}</span>
              <span class="scan-grade" style="background:${d.gradeColor || '#6b7280'}20;color:${d.gradeColor || scoreColor}">${d.grade || 'C'}</span>
              <div class="scan-score-ring" style="background:${ringBg};color:${scoreColor};border:2px solid ${scoreColor}33">${d.score}</div>
              <div class="scan-info">
                <div class="scan-name-row">
                  <b>${d.name || d.code}</b>
                  <span class="scan-code">${d.code}</span>
                  ${d.lastPrice ? `<span class="scan-price">¥${d.lastPrice.toFixed(2)}</span>` : ''}
                  <span class="scan-chg" style="color:${chgColor}">${chgStr}%</span>
                </div>
                <div class="scan-oneliner">${d.signalSummary || ''}</div>
              </div>
            </div>
            ${signals.length > 0 ? `
            <div class="scan-signals">
              ${signals.slice(0, 5).map((s, si) => {
                const tip = SIGNAL_PLAIN[s] || "";
                return `<span class="signal-chip" title="${tip}" style="background:${chipColors[si % 5]};color:${chipTextColors[si % 5]}">${s}</span>`;
              }).join("")}
            </div>` : ''}
            <div class="scan-explain">${explainStock(d)}</div>
            <div class="scan-metrics">
              <span title="是否在低位：分越高越便宜"><span class="dim-badge dim-pos">位置</span>${d.positionScore || 0}</span>
              <span title="上涨动力：分越高动能越强"><span class="dim-badge dim-launch">启动</span>${d.launchScore || 0}</span>
              <span title="趋势强度：分越高趋势越好"><span class="dim-badge dim-trend">趋势</span>${d.trendScore || 0}</span>
              ${d.volRatio ? `<span title="今天成交量是平时的几倍"><span class="dim-badge dim-vol">量比</span>${d.volRatio.toFixed(1)}x</span>` : ''}
              ${d.upDays >= 3 ? `<span title="连续上涨天数"><span class="dim-badge dim-up">连阳</span>${d.upDays}天</span>` : ''}
              ${d.nearHigh20 >= 0.97 ? `<span title="距离20天最高价"><span class="dim-badge dim-high">近高</span>${(d.nearHigh20 * 100).toFixed(0)}%</span>` : ''}
            </div>
          </div>`;
        }).join("")}
      </div>
      <div style="margin-top:12px;font-size:11px;color:#999999;display:flex;gap:14px;flex-wrap:wrap;">
        <span><span class="dim-badge dim-pos">位置</span> 越低越便宜，买点更好</span>
        <span><span class="dim-badge dim-launch">启动</span> 越高说明涨的动力越足</span>
        <span><span class="dim-badge dim-trend">趋势</span> 越高说明趋势越稳</span>
        <span><span class="dim-badge dim-vol">量比</span> 1x=正常，2x以上=放量</span>
        <span>💡 鼠标悬停信号标签看解释</span>
      </div>`;

    // 显示导出按钮
    const exportBtn = $("#btnExportScan");
    if (exportBtn) {
      exportBtn.style.display = "inline-block";
      exportBtn._scanData = resultsArray;
    }

    // 绑定点击事件 - 点击显示K线图弹窗
    el.querySelectorAll(".scan-result-card.clickable").forEach(card => {
      card.addEventListener("click", (e) => {
        console.log("[Scan] card clicked", card.dataset.code, "perf-now:", performance.now().toFixed(0));
        const code = card.dataset.code;
        const name = card.querySelector("b")?.textContent || code;
        showKlineModal(code, name);
      });
    });
  } catch (e) {
    if (e.name === "AbortError") return;
    clearInterval(simTimer);
    if (progress) progress.style.display = "none";
    toast("扫描失败: " + e.message);
  } finally {
    btn.textContent = "🔍 开始扫描"; btn.disabled = false;
    scanAbortController = null;
  }
});

// 导出扫描结果CSV
$("#btnExportScan")?.addEventListener("click", () => {
  const data = $("#btnExportScan")._scanData;
  if (!data?.length) { toast("没有可导出的数据"); return; }
  exportCSV("scan-results.csv",
    ["排名", "代码", "名称", "评分", "等级", "位置分", "启动分", "趋势分", "5日涨幅", "10日涨幅", "量比", "信号摘要"],
    data.map((d, i) => ({ "排名": i+1, "代码": d.code, "名称": d.name, "评分": d.score, "等级": d.grade, "位置分": d.positionScore, "启动分": d.launchScore, "趋势分": d.trendScore, "5日涨幅": d.chg5, "10日涨幅": d.chg10, "量比": d.volRatio, "信号摘要": d.signalSummary }))
  );
  toast("导出成功: scan-results.csv");
});

// ============ ETF轮动 ============

async function loadEtfRotate() {
  const pool = $("#etfPool")?.value || "momentum";
  await runEtfScan(pool);
}

async function runEtfScan(pool) {
  const btn = $("#btnEtfScan");
  const status = $("#etfStatus");
  if (btn) { btn.textContent = "⏳ 分析中..."; btn.disabled = true; }
  if (status) status.textContent = "正在获取ETF数据...";

  try {
    const resp = await fetch(`/api/etf/rotate?pool=${pool}`);
    const data = await resp.json();

    if (status) status.textContent = `更新于 ${new Date(data.timestamp).toLocaleTimeString("zh-CN", {hour12: false})}`;
    if (btn) { btn.textContent = "刷新分析"; btn.disabled = false; }

    renderEtfResults(data);
  } catch (e) {
    if (status) status.textContent = "加载失败";
    if (btn) { btn.textContent = "重试"; btn.disabled = false; }
  }
}

function renderEtfResults(data) {
  // 轮动信号条
  const bar = $("#etfRotationBar");
  if (bar && data.topPick) {
    bar.style.display = "flex";
    const sigColors = { strong_hold: "rgba(248,113,113,.12)", hold: "rgba(74,222,128,.12)", watch: "rgba(251,191,36,.12)" };
    const sigEmoji = { strong_hold: "🔥", hold: "✅", watch: "👀" };
    bar.style.background = sigColors[data.rotation.signal] || sigColors.hold;
    bar.innerHTML = `<span style="font-size:20px;">${sigEmoji[data.rotation.signal] || "✅"}</span>
      <div style="flex:1;"><b style="color:#1A1A2E;">${data.topPick.name}</b> <span style="color:${data.topPick.grade === '强配' ? '#E53935' : '#f59e0b'};">${data.topPick.score}分 · ${data.topPick.grade}</span>
      <div style="font-size:12px;color:#666666;margin-top:2px;">${data.rotation.reason}</div></div>`;
  }

  // 排名卡片
  const list = $("#etfRankList");
  if (!list) return;
  if (!data.results.length) {
    list.innerHTML = `<div style="grid-column:1/-1;padding:24px;text-align:center;color:#999999;">暂无数据</div>`;
    return;
  }

  list.innerHTML = data.results.map((d, i) => {
    const isTop = i === 0;
    return `<div style="background:rgba(255,255,255,${isTop ? '.05' : '.02'});border:1px solid rgba(255,255,255,${isTop ? '.1' : '.04'});border-radius:12px;padding:14px 16px;${isTop ? 'box-shadow:0 0 20px rgba(99,102,241,.08);' : ''}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;color:#999999;min-width:16px;">#${i + 1}</span>
          <span style="font-weight:600;color:#1A1A2E;">${d.name}</span>
          <span style="font-size:11px;color:#999999;">${d.code}</span>
        </div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:800;color:${d.score >= 70 ? '#E53935' : d.score >= 55 ? '#f59e0b' : d.score >= 40 ? '#60a5fa' : '#999999'};">${d.score}</div>
          <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${d.gradeColor}20;color:${d.gradeColor};">${d.grade}</span>
        </div>
      </div>
      <!-- 分项得分条 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:11px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;"><span style="color:#666666;">动量</span><span style="color:#1A1A2E;">${d.momentumScore}/35</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:#666666;">趋势</span><span style="color:#1A1A2E;">${d.trendScore}/30</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:#666666;">量能</span><span style="color:#1A1A2E;">${d.volumeScore}/20</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:#666666;">低波</span><span style="color:#1A1A2E;">${d.stabilityScore}/15</span></div>
      </div>
      <!-- 收益 + 波动 -->
      <div style="display:flex;gap:10px;font-size:11px;margin-bottom:6px;">
        ${d.returns && d.returns.d5 != null ? `<span style="color:${d.returns.d5 >= 0 ? '#E53935' : '#43A047'};">5日 ${d.returns.d5 > 0 ? '+' : ''}${d.returns.d5}%</span>` : ''}
        ${d.returns && d.returns.d20 != null ? `<span style="color:${d.returns.d20 >= 0 ? '#E53935' : '#43A047'};">20日 ${d.returns.d20 > 0 ? '+' : ''}${d.returns.d20}%</span>` : ''}
        <span style="color:#999999;">波动 ${d.volatility}%</span>
        <span style="color:#999999;">回撤 ${d.drawdown}%</span>
      </div>
      <div style="font-size:10px;color:#999999;">${(d.signals || []).join(' · ')}</div>
    </div>`;
  }).join("");

  // 更新池切换pills
  fetch("/api/etf/pools").then(r => r.json()).then(pools => {
    const pills = $("#etfPoolPills");
    if (!pills) return;
    pills.innerHTML = pools.map(p => {
      const active = p.key === data.pool.key;
      return `<button class="small-btn" data-etf-pool="${p.key}" style="${active ? 'background:rgba(99,102,241,.3);color:#fff;' : ''}">${p.label}<span style="font-size:10px;color:#999999;margin-left:4px;">${p.count}只</span></button>`;
    }).join("");
    pills.querySelectorAll("[data-etf-pool]").forEach(b => b.addEventListener("click", () => {
      $("#etfPool").value = b.dataset.etfPool;
      runEtfScan(b.dataset.etfPool);
    }));
  }).catch(() => {});
}

$("#btnEtfScan")?.addEventListener("click", () => {
  const pool = $("#etfPool")?.value || "momentum";
  runEtfScan(pool);
});

$("#etfPool")?.addEventListener("change", function() {
  runEtfScan(this.value);
});

// ============ 遗传因子进化 ============

// ============ 游资分析 ============

async function runHotmoneyScan() {
  const btn = $("#btnHMScan");
  const status = $("#hmStatus");
  const progress = $("#hmProgress");
  const progressFill = $("#hmProgressFill");
  const pool = parseInt($("#hmPoolSize")?.value) || 50;

  btn.disabled = true; btn.textContent = "扫描中...";
  status.textContent = "正在扫描游资特征...";
  status.style.color = "#f59e0b";
  if (progress) { progress.style.display = "block"; progressFill.style.width = "30%"; }

  try {
    const resp = await fetch(`/api/hotmoney/scan?pool=${pool}`);
    const data = await resp.json();
    if (data.error) { toast(data.error); return; }
    if (progressFill) progressFill.style.width = "80%";

    // 摘要卡片
    const summary = $("#hmSummary");
    if (summary) {
      summary.style.display = "flex";
      summary.innerHTML = [
        { label: "扫描数", val: data.scanned, color: "#1A1A2E" },
        { label: "短线A级", val: data.summary.shortTermA, color: "#fbbf24" },
        { label: "短线B级", val: data.summary.shortTermB, color: "#f59e0b" },
        { label: "长线A级", val: data.summary.longTermA, color: "#34d399" },
        { label: "长线B级", val: data.summary.longTermB, color: "#43A047" },
      ].map(s => `<div style="text-align:center;padding:10px;background:#F5F5F5;border-radius:8px;flex:1;min-width:80px;">
        <div style="font-size:20px;font-weight:700;color:${s.color}">${s.val}</div>
        <div style="font-size:11px;color:#999999">${s.label}</div>
      </div>`).join("");
    }

    // 短线标的
    renderHMPickList("#hmShortList", data.topShortTerm, "shortTerm", "#fbbf24");
    // 长线标的
    renderHMPickList("#hmLongList", data.topLongTerm, "longTerm", "#34d399");
    // 特殊形态（静默自动加载，不显示进度按钮状态变化）
    runHotmoneyPatterns(true);
    // 全部表格
    renderHMAllTable(data.all);
    // 游资风格矩阵
    renderHMStyleMatrix(data.all);

    status.textContent = `完成! 扫描${data.scanned}只`;
    status.style.color = "#43A047";
    if (progressFill) progressFill.style.width = "100%";
  } catch (e) {
    status.textContent = "网络错误"; status.style.color = "#E53935";
    toast("游资扫描失败: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "🔍 一键扫描";
    if (progress) setTimeout(() => progress.style.display = "none", 1500);
  }
}

async function runHotmoneyPatterns(silent) {
  const btn = $("#btnHMPatterns");
  const status = $("#hmStatus");
  const pool = parseInt($("#hmPoolSize")?.value) || 50;

  if (!silent) {
    btn.disabled = true; btn.textContent = "分析中...";
    status.textContent = "正在识别形态...";
    status.style.color = "#f59e0b";
  }

  try {
    const resp = await fetch(`/api/hotmoney/patterns?pool=${pool}`);
    const data = await resp.json();
    if (data.error) { toast(data.error); return; }

    const el = $("#hmPatternList");
    if (el) {
      const groups = [
        { key: "consecutiveLimitUps", label: "🔥 连板", color: "#E53935" },
        { key: "blownUps", label: "💥 炸板", color: "#f59e0b" },
        { key: "bottomFishing", label: "🎣 翘板", color: "#43A047" },
        { key: "extremeReversal", label: "⚡ 地天板", color: "#8E24AA" },
      ];
      el.innerHTML = groups.map(g => {
        const items = data.patterns[g.key] || [];
        if (!items.length) return "";
        return `<div style="margin-bottom:10px;">
          <div style="font-size:12px;font-weight:600;color:${g.color};margin-bottom:6px;">${g.label} (${items.length})</div>
          ${items.slice(0, 10).map(i => `<div style="padding:4px 0;font-size:12px;color:#333;cursor:pointer" onclick="navigateToStock('${i.code}')">
            <span style="color:${g.color}">${i.code}</span> ${i.name || ""}
          </div>`).join("")}
        </div>`;
      }).join("");
    }

    // 摘要
    const summary = $("#hmSummary");
    if (summary) {
      summary.style.display = "flex";
      summary.innerHTML = [
        { label: "连板", val: data.summary.totalLimitingUp, color: "#E53935" },
        { label: "炸板", val: data.summary.totalBlownUps, color: "#f59e0b" },
        { label: "翘板", val: data.summary.totalBottomFishing, color: "#43A047" },
        { label: "地天板", val: data.summary.totalExtremeReversal, color: "#8E24AA" },
      ].map(s => `<div style="text-align:center;padding:10px;background:#F5F5F5;border-radius:8px;flex:1;min-width:80px;">
        <div style="font-size:20px;font-weight:700;color:${s.color}">${s.val}</div>
        <div style="font-size:11px;color:#999999">${s.label}</div>
      </div>`).join("");
    }

    status.textContent = "完成!"; status.style.color = "#43A047";
  } catch (e) {
    if (!silent) { status.textContent = "网络错误"; status.style.color = "#E53935"; }
    toast("形态识别失败: " + e.message);
  } finally {
    if (!silent && btn) { btn.disabled = false; btn.textContent = "📋 只看形态"; }
  }
}

function renderHMPickList(selector, items, type, color) {
  const el = $(selector);
  if (!el || !items) return;
  const traderIcons = { "赵老哥":"⚡","涅槃重升":"🌳","作手新一":"🎯","北京炒家":"💰","章盟主":"👑","方新侠":"🏰","小鳄鱼":"🐊","92科比":"🔄","炒股养家":"🧘","歌神":"🚀" };
  const traderDesc = { "赵老哥":"二板定龙头, -5%减仓/-8%全清","涅槃重升":"树式心法, 四周期精准定位","作手新一":"连板接力90%+, 单次回撤≤2%","北京炒家":"10:30首板, T+1隔日9:45清仓","章盟主":"30日线建仓锁仓, 只做第二波加速","方新侠":"200亿+大票趋势, 三日不破五日线","小鳄鱼":"深水区低吸反包, 熊市空仓","92科比":"高低切换不做中位, 主跌第二天低吸","炒股养家":"情绪四阶段, 赢面定仓位","歌神":"翘板反核, 错杀股3日内获利走" };

  el.innerHTML = items.length ? items.map(r => {
    const t = r[type];
    const trader = t.topTrader || t.primaryTrader || "";
    const icon = traderIcons[trader] || "📊";
    const desc = traderDesc[trader] || "";
    const scorePct = Math.min(100, Math.round(t.score / 8 * 100));
    const barColor = scorePct >= 75 ? "#E53935" : scorePct >= 50 ? "#FFB300" : "#999999";
    return `<div style="padding:10px 12px;border-bottom:1px solid #F0F0F0;cursor:pointer;transition:background .15s"
         onmouseover="this.style.background='#F8FAFF'" onmouseout="this.style.background=''"
         onclick="navigateToStock('${r.code}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <div>
          <span style="color:#1E88E5;font-weight:700;font-size:14px">${r.code}</span>
          <span style="font-size:12px;color:#1A1A2E;margin-left:8px;font-weight:600">${r.name}</span>
          <span style="font-size:11px;color:${color};margin-left:6px;background:${color}15;padding:2px 8px;border-radius:10px;">${t.grade} ${t.score}</span>
        </div>
        <span style="font-size:11px;color:#1A1A2E;background:#F5F5F5;padding:2px 8px;border-radius:4px;">${icon} ${trader}</span>
      </div>
      <div style="font-size:11px;color:#666666;margin-bottom:4px;">${t.suggestion || ""}</div>
      <div style="font-size:10px;color:#999999;margin-bottom:4px;">${desc}</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;height:3px;background:#F0F0F0;border-radius:2px;">
          <div style="height:100%;width:${scorePct}%;background:${barColor};border-radius:2px;transition:width .3s;"></div>
        </div>
        <span style="font-size:10px;color:${barColor};font-weight:600;">${scorePct}%</span>
      </div>
    </div>`;
  }).join("") : '<div style="color:#999999;font-size:12px;text-align:center;padding:20px;">暂无标的</div>';
}

function renderHMAllTable(items) {
  const tbody = $("#hmAllBody");
  if (!tbody || !items) return;
  tbody.innerHTML = items.map(r => {
    const sc = r.signals ? r.signals.score : (r.shortTerm?.score || 0);
    const scColor = sc >= 70 ? "#43A047" : sc >= 50 ? "#FFB300" : "#999999";
    const trader = r.signals?.topMatch || r.signals?.primaryTrader || r.styleMatch || "";
    const sug = r.signals?.suggestion || r.shortTerm?.suggestion || "";
    const tf = r.signals?.timeframe || r.shortTerm?.timeframe || "";
    return `<tr style="border-bottom:1px solid #F0F0F0;cursor:pointer;transition:background .15s"
        onmouseover="this.style.background='#F8FAFF'" onmouseout="this.style.background=''"
        onclick="navigateToStock('${r.code}')">
      <td style="padding:8px 10px;color:#1E88E5;font-weight:600;font-size:13px">${r.code}</td>
      <td style="padding:8px 10px;color:#1A1A2E;font-size:13px;font-weight:500">${r.name}</td>
      <td style="padding:8px 10px;font-size:12px;color:#FFB300;font-weight:600">${r.shortTerm?.grade || "-"} ${r.shortTerm?.score || ""}</td>
      <td style="padding:8px 10px;font-size:12px;color:#43A047;font-weight:600">${r.longTerm?.grade || "-"} ${r.longTerm?.score || ""}</td>
      <td style="padding:8px 10px;font-size:13px;font-weight:700;color:${scColor}">${sc}</td>
      <td style="padding:8px 10px;font-size:11px;color:#999999">${trader}</td>
      <td style="padding:8px 10px;font-size:11px;color:#1E88E5">${sug}</td>
      <td style="padding:8px 10px;font-size:11px;color:#8E24AA">${tf}</td>
    </tr>`;
  }).join("");
}

function renderHMStyleMatrix(items) {
  const el = $("#hmStyleMatrix");
  if (!el || !items) return;
  const traders = [
    { name:"赵老哥", icon:"⚡", style:"二板定龙头", color:"#E53935", desc:"只做主线龙头, 二板确认后打板介入, -5%减仓50%/-8%全清, 盈利10%-20%即撤" },
    { name:"涅槃重升", icon:"🌳", style:"树式心法", color:"#8E24AA", desc:"四周期(低位试错→主升分歧→高位轻仓→主跌空仓), 100万→1亿实盘验证" },
    { name:"作手新一", icon:"🎯", style:"连板接力王", color:"#1E88E5", desc:"连板接力占90%+, 4-6板都敢做无高度限制, 反包板追涨停-跌停-涨停形态" },
    { name:"北京炒家", icon:"💰", style:"首板套利", color:"#FFB300", desc:"10:30前封板首板, 流通市值30-100亿/<20元, T+1隔日9:45前全部清仓" },
    { name:"章盟主", icon:"👑", style:"波段主升浪", color:"#059669", desc:"30日线建仓锁仓做T压成本, 只做第二波加速, 不砸盘被称为善庄" },
    { name:"方新侠", icon:"🏰", style:"大成交趋势", color:"#D97706", desc:"只做流通盘200亿+大票, 龙头分歧加仓, 三日不破五日线坚决锁仓" },
    { name:"小鳄鱼", icon:"🐊", style:"反包板核心", color:"#DC2626", desc:"龙头大跌深水区低吸博反包涨停, 高开7%+下杀最佳, 隔日快出, 熊市空仓" },
    { name:"92科比", icon:"🔄", style:"高低切换", color:"#7C3AED", desc:"绝对高位(龙头)和绝对低位(补涨)才做, 绝不碰中位股, 情绪退潮果断撤" },
    { name:"炒股养家", icon:"🧘", style:"情绪周期", color:"#0EA5E9", desc:"启动→发酵→高潮→衰退四阶段, 赢面<60%空仓>90%满仓, 买入分歧卖出一致" },
    { name:"歌神", icon:"🚀", style:"翘板反核", color:"#F97316", desc:"被错杀跌停股大手笔撬板, 博情绪修复反弹, 3日内获利走, 小仓位试错" },
  ];

  // Build matched stocks per trader
  const matchedStocks = {};
  traders.forEach(t => { matchedStocks[t.name] = []; });
  items.forEach(r => {
    const t = r.signals?.topMatch || r.styleMatch || "";
    if (t && matchedStocks[t]) {
      matchedStocks[t].push(r);
    }
  });

  el.innerHTML = traders.map(t => {
    const stocks = matchedStocks[t.name];
    const cnt = stocks.length;
    const score = Math.min(100, cnt * 8 + 20);
    const barColor = cnt > 5 ? "#43A047" : cnt > 2 ? "#FFB300" : "#999999";
    const stockList = stocks.slice(0, 6).map(s =>
      `<span style="white-space:nowrap;cursor:pointer;color:#1E88E5;font-size:11px;" onclick="event.stopPropagation();navigateToStock('${s.code}')">${s.code} ${s.name||''}</span>`
    ).join(" · ");
    const more = stocks.length > 6 ? ` +${stocks.length - 6}只` : "";

    return `<div style="background:#FFFFFF;border:1px solid #EAEAEA;border-radius:10px;padding:14px;transition:box-shadow .15s"
         onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,.06)'" onmouseout="this.style.boxShadow=''">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="font-size:20px;">${t.icon}</span>
        <span style="font-size:14px;font-weight:700;color:#1A1A2E;">${t.name}</span>
        <span style="font-size:11px;padding:2px 8px;border-radius:10px;color:${t.color};background:${t.color}15;">${t.style}</span>
      </div>
      <div style="font-size:11px;color:#666666;margin-bottom:6px;line-height:1.5;">${t.desc}</div>
      ${cnt > 0 ? `<div style="margin-bottom:6px;line-height:1.8;">${stockList}${more}</div>` : '<div style="font-size:11px;color:#ccc;margin-bottom:6px;">暂无匹配标的</div>'}
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;height:3px;background:#F0F0F0;border-radius:2px;">
          <div style="height:100%;width:${score}%;background:${barColor};border-radius:2px;"></div>
        </div>
        <span style="font-size:11px;font-weight:600;color:${barColor};">${cnt}只</span>
      </div>
    </div>`;
  }).join("");
}

// 游资按钮绑定
$("#btnHMScan")?.addEventListener("click", runHotmoneyScan);
$("#btnHMPatterns")?.addEventListener("click", runHotmoneyPatterns);

// ============ 趋势选股 ============

async function loadTrendScan() {
  // 页面打开时自动扫描
  if (!$("#trendResults")?.children.length) {
    await runTrendScan();
  }
}

async function runTrendScan() {
  const btn = $("#btnTrendScan");
  const status = $("#trendStatus");
  const progress = $("#trendProgress");
  const progressFill = $("#trendProgressFill");
  const boardLimit = $("#trendBoardLimit")?.value || 8;

  if (btn) { btn.textContent = "⏳ 扫描中..."; btn.disabled = true; }
  if (progress) progress.style.display = "block";
  if (progressFill) progressFill.style.width = "10%";
  if (status) status.textContent = "正在获取行业板块数据...";

  try {
    const resp = await fetch(`/api/trend/scan?boards=${boardLimit}`);
    const data = await resp.json();

    if (progressFill) progressFill.style.width = "100%";
    if (status) status.textContent = `扫描 ${data.boardsScanned} 个板块 → ${data.totalPicks} 只个股 | ${new Date(data.timestamp).toLocaleTimeString("zh-CN", {hour12: false})}`;
    if (btn) { btn.textContent = "刷新扫描"; btn.disabled = false; }
    setTimeout(() => { if (progress) progress.style.display = "none"; }, 600);

    renderTrendResults(data);
  } catch (e) {
    if (status) status.textContent = "扫描失败: " + e.message;
    if (btn) { btn.textContent = "重试"; btn.disabled = false; }
    if (progress) progress.style.display = "none";
  }
}

function renderTrendResults(data) {
  // 板块概览
  const boardEl = $("#trendBoardSummary");
  if (boardEl && data.strongBoards) {
    boardEl.innerHTML = data.strongBoards.map(b => {
      const t = b.turnover || 0;
      const tStr = t > 1e8 ? (t / 1e8).toFixed(1) + "亿" : (t / 1e4).toFixed(0) + "万";
      return `<span style="padding:4px 10px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.2);border-radius:14px;font-size:12px;color:#fbbf24;">${b.name} <span style="color:#999999;font-size:10px;">${tStr}</span></span>`;
    }).join("") || '<span style="font-size:12px;color:#999999;">无MA250上方板块</span>';
    if (data.strongBoards.length === 0) {
      boardEl.innerHTML += '<span style="font-size:12px;color:#ef4444;margin-left:8px;">⚠ 当前无板块站上年线，建议观望</span>';
    }
  }

  // 回踩买点
  const buyEl = $("#trendBuySignals");
  if (buyEl && data.buySignals?.length) {
    buyEl.innerHTML = `<div style="padding:12px 16px;background:rgba(74,222,128,.06);border:1px solid rgba(74,222,128,.15);border-radius:10px;margin-bottom:4px;">
      <div style="font-weight:600;color:#43A047;margin-bottom:8px;">🎯 回踩买点信号 (${data.buySignals.length}只)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${data.buySignals.map(s => `<span class="clickable" data-code="${s.code}" style="padding:4px 10px;background:rgba(74,222,128,.1);border-radius:12px;font-size:12px;color:#1A1A2E;cursor:pointer;" title="${s.board} · ${s.pullbackLabel}">${s.name} <span style="color:#43A047;">${s.score}分</span></span>`).join("")}
      </div></div>`;
    buyEl.querySelectorAll(".clickable[data-code]").forEach(el => {
      el.addEventListener("click", () => navigateToStock(el.dataset.code));
    });
  } else if (buyEl) {
    buyEl.innerHTML = "";
  }

  // 全部结果
  const results = $("#trendResults");
  if (!results) return;
  if (!data.results?.length) {
    results.innerHTML = `<div style="grid-column:1/-1;padding:24px;text-align:center;color:#999999;">暂无符合条件的个股</div>`;
    return;
  }

  results.innerHTML = data.results.map((d, i) => {
    const isPullback = d.pullbackLabel.includes("回踩");
    const isStrong = d.score >= 50;
    return `<div class="clickable" data-code="${d.code}" style="background:rgba(255,255,255,${isStrong ? '.05' : '.02'});border:1px solid ${isPullback ? 'rgba(74,222,128,.25)' : '#F0F0F0'};border-radius:12px;padding:14px 16px;cursor:pointer;${isStrong ? 'box-shadow:0 0 16px rgba(248,113,113,.06);' : ''}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:10px;color:#999999;min-width:14px;">#${i+1}</span>
          <span style="font-weight:600;color:#1A1A2E;">${d.name}</span>
          <span style="font-size:10px;color:#999999;">${d.code}</span>
        </div>
        <div style="text-align:right;">
          <div style="font-size:20px;font-weight:800;color:${d.score >= 65 ? '#E53935' : d.score >= 50 ? '#f59e0b' : d.score >= 35 ? '#60a5fa' : '#999999'};">${d.score}</div>
          <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${d.gradeColor}20;color:${d.gradeColor};">${d.grade}</span>
        </div>
      </div>
      <!-- 分项得分 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;font-size:11px;margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;"><span style="color:#666666;">均线</span><span style="color:#1A1A2E;">${d.alignScore}/30</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:#666666;">动量</span><span style="color:#1A1A2E;">${d.momentumScore}/25</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:#666666;">回踩</span><span style="color:${d.pullbackScore >= 8 ? '#43A047' : '#e0e4f0'};">${d.pullbackScore}/15</span></div>
        <div style="display:flex;justify-content:space-between;"><span style="color:#666666;">量能</span><span style="color:#1A1A2E;">${d.volScore}/15</span></div>
      </div>
      <!-- 状态标签 -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:10px;margin-bottom:4px;">
        ${d.maStatus?.isAligned ? '<span style="color:#E53935;background:rgba(248,113,113,.1);padding:2px 6px;border-radius:4px;">多头排列</span>' : d.maStatus?.nearAligned ? '<span style="color:#f59e0b;background:rgba(245,158,11,.1);padding:2px 6px;border-radius:4px;">短中多头</span>' : ''}
        ${d.maStatus?.aboveMA250 ? '<span style="color:#60a5fa;background:rgba(96,165,250,.1);padding:2px 6px;border-radius:4px;">年线上方</span>' : '<span style="color:#ef4444;background:rgba(239,68,68,.1);padding:2px 6px;border-radius:4px;">年线下方</span>'}
        ${isPullback ? '<span style="color:#43A047;background:rgba(74,222,128,.1);padding:2px 6px;border-radius:4px;">'+d.pullbackLabel+'</span>' : `<span style="color:#999999;background:#F0F0F0;padding:2px 6px;border-radius:4px;">${d.pullbackLabel}</span>`}
        <span style="color:#666666;padding:2px 6px;">${d.board||''}</span>
      </div>
      <!-- 均线距离 -->
      <div style="font-size:10px;color:#999999;">
        MA5:${d.gaps?.gap5}% MA10:${d.gaps?.gap10}% MA20:${d.gaps?.gap20}% | ${(d.signals||[]).join(' · ')}
      </div>
    </div>`;
  }).join("");

  // 点击卡片跳转个股分析
  results.querySelectorAll(".clickable[data-code]").forEach(el => {
    el.addEventListener("click", () => navigateToStock(el.dataset.code));
  });
}

$("#btnTrendScan")?.addEventListener("click", () => runTrendScan());

// AI 自然语言选股
$("#btnNLScreen")?.addEventListener("click", async () => {
  const input = $("#nlScreenInput");
  const query = input?.value?.trim();
  if (!query) { toast("请输入选股条件描述"); return; }

  const btn = $("#btnNLScreen");
  btn.textContent = "⏳ AI 理解中..."; btn.disabled = true;
  const understoodEl = $("#nlUnderstood");
  if (understoodEl) { understoodEl.style.display = "none"; understoodEl.textContent = ""; }

  try {
    const resp = await fetch("/api/ai/screen", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": localStorage.getItem("stockquant_ai_key") || "",
      },
      body: JSON.stringify({ query }),
    });
    const data = await resp.json();

    if (data.error) {
      toast("AI 无法理解: " + data.error);
      if (data.explanation && understoodEl) {
        understoodEl.style.display = "block";
        understoodEl.textContent = "💬 " + data.explanation;
      }
      return;
    }

    // 显示 AI 理解结果
    if (understoodEl && data.understood) {
      understoodEl.style.display = "block";
      understoodEl.innerHTML = "🤖 理解：" + data.understood +
        (data.sector ? ' · 板块：<b style="color:#c8cdf0;">' + data.sector + '</b>' : "") +
        (data.mode ? ' · 模式：<b style="color:#c8cdf0;">' + data.mode + '</b>' : "") +
        (data.count !== undefined ? ' · 结果：<b style="color:#a5b4fc;">' + data.count + '只</b>' : "");
    }

    // 渲染扫描结果
    const results = data.results || [];
    const el = $("#scanResults");
    if (!results.length) {
      el.innerHTML = `<div style="padding:24px;text-align:center;color:#999999;">
        <div style="font-size:48px;margin-bottom:12px;">🔍</div>
        <b style="color:#666666;">没有符合 AI 理解的股票</b>
        <p style="margin-top:6px;">AI 理解的筛选条件可能太严格，试试换个说法</p>
      </div>`;
      return;
    }

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div>
          <b style="color:#c8cdf0;font-size:15px;">🤖 AI 筛选结果</b>
          <span style="font-size:11px;color:#999999;margin-left:8px;">共 ${results.length} 只</span>
        </div>
      </div>
      <div class="scan-results-list">
        ${results.map((d, i) => {
          const scoreColor = d.score >= 55 ? '#E53935' : d.score >= 40 ? '#f59e0b' : d.score >= 30 ? '#3b82f6' : '#999999';
          const ringBg = d.score >= 55 ? 'rgba(248,113,113,.12)' : d.score >= 40 ? 'rgba(245,158,11,.12)' : d.score >= 30 ? 'rgba(59,130,246,.12)' : 'rgba(148,163,184,.08)';
          return `
          <div class="scan-result-card clickable" data-code="${d.code}" title="点击查看 ${d.name || d.code} 的详细分析">
            <div class="scan-result-header">
              <span style="font-size:10px;color:#999999;min-width:18px;">#${i + 1}</span>
              <div class="scan-score-ring" style="background:${ringBg};color:${scoreColor};border:2px solid ${scoreColor}33">${d.score || '?'}</div>
              <div style="flex:1;">
                <b style="color:#1A1A2E;font-size:14px;">${d.name || d.code}</b>
                <span style="font-size:11px;color:#999999;margin-left:6px;">${d.code}</span>
                ${d.lastPrice !== undefined ? '<span style="font-size:13px;color:#c8cdf0;margin-left:8px;">' + d.lastPrice.toFixed(2) + '</span>' : ''}
              </div>
            </div>
          </div>`;
        }).join("")}
      </div>`;

    el.querySelectorAll(".scan-result-card.clickable").forEach(card => {
      card.addEventListener("click", () => navigateToStock(card.dataset.code));
    });

  } catch (e) {
    toast("AI 选股失败: " + (e.message || "未知错误"));
  } finally {
    btn.textContent = "🔍 AI 筛选"; btn.disabled = false;
  }
});

// AI 智能推荐 v2
$("#btnAIPick")?.addEventListener("click", async () => {
  const input = $("#nlScreenInput");
  const query = input?.value?.trim() || "帮我推荐几只近期值得关注的股票";

  const btn = $("#btnAIPick");
  const originalText = btn.textContent;
  btn.textContent = "⏳ AI 深度分析中..."; btn.disabled = true;

  const resultsEl = $("#aiPickResults");
  const cardsEl = $("#aiPickCards");
  const understandingEl = $("#aiPickUnderstanding");
  const marketAnalysisEl = $("#aiPickMarketAnalysis");

  // 获取选股风格、行业筛选和ETF开关
  const styleSelect = $("#aiPickStyle");
  const industrySelect = $("#aiPickIndustry");
  const etfCheckbox = $("#aiPickIncludeETF");
  const style = styleSelect?.value || "balanced";
  const industry = industrySelect?.value || "";
  const includeETF = etfCheckbox?.checked !== false;

  try {
    const resp = await fetch("/api/ai/pick", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": localStorage.getItem("stockquant_ai_key") || "",
      },
      body: JSON.stringify({
        query,
        topN: 5,
        focus: style,
        style: style,
        industries: industry ? [industry] : [],
        includeETF: includeETF,
      }),
    });
    const data = await resp.json();

    if (data.error) {
      toast("AI 推荐失败: " + data.error);
      return;
    }

    // 显示理解
    if (understandingEl && data.understanding) {
      understandingEl.textContent = `"${data.understanding}"`;
    }

    // 显示市场分析
    if (marketAnalysisEl && data.marketContext) {
      marketAnalysisEl.innerHTML = `<div style="padding:10px 14px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:8px;margin-bottom:10px;">
        <div style="font-size:12px;color:#1E88E5;font-weight:600;margin-bottom:6px;">📊 市场环境</div>
        <div style="font-size:12px;color:#c8cdf0;line-height:1.6;">${data.marketContext}</div>
      </div>`;
      marketAnalysisEl.style.display = "block";
    }

    // 渲染推荐卡片
    const picks = data.picks || [];
    if (!picks.length) {
      cardsEl.innerHTML = `<div style="padding:16px;text-align:center;color:#92400e;">
        <div style="font-size:36px;margin-bottom:8px;">🤖</div>
        <b>暂无符合条件的推荐</b>
        <p style="margin-top:4px;font-size:12px;">AI 未找到满足条件的股票，试试换个描述</p>
      </div>`;
    } else {
      cardsEl.innerHTML = picks.map((pick, i) => {
        const scores = pick.scores || {};
        const technical = scores.technical || 0;
        const fundFlow = scores.fundFlow || 0;
        const factor = scores.factor || 0;
        const risk = scores.risk || 0;

        // 雷达图数据 (4个维度)
        const radarData = [
          { label: "技术", value: technical },
          { label: "资金", value: fundFlow },
          { label: "因子", value: factor },
          { label: "风险", value: risk },
        ];

        // 构建迷你雷达图 SVG
        const size = 80;
        const center = size / 2;
        const radius = 30;
        const radarPoints = radarData.map((d, j) => {
          const angle = (Math.PI * 2 * j) / 4 - Math.PI / 2;
          const r = (d.value / 100) * radius;
          return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
        }).join(" ");

        // 多周期涨跌
        const change = pick.change || {};
        const chg1d = change["1d"] || 0;
        const chg5d = change["5d"] || pick.change5d || 0;
        const chg20d = change["20d"] || 0;

        // 技术分析信息
        const techAnalysis = pick.technicalAnalysis || {};

        return `
        <div class="ai-pick-card" style="padding:14px 16px;background:#F5F5F5;border:1px solid rgba(245,158,11,.15);border-radius:10px;cursor:pointer;" data-code="${pick.code}">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <!-- 排名和评分 -->
            <div style="text-align:center;min-width:50px;">
              <div style="font-size:11px;color:#92400e;">#${pick.rank}</div>
              <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,rgba(245,158,11,.15),rgba(217,119,6,.1));border:2px solid ${pick.compositeScore >= 70 ? '#f59e0b' : pick.compositeScore >= 50 ? '#3b82f6' : '#999999'}33;display:flex;align-items:center;justify-content:center;margin:4px auto;">
                <span style="font-size:16px;font-weight:700;color:${pick.compositeScore >= 70 ? '#f59e0b' : pick.compositeScore >= 50 ? '#3b82f6' : '#999999'};">${pick.compositeScore}</span>
              </div>
              <div style="font-size:10px;color:${pick.grade === 'A+' || pick.grade === 'A' ? '#f59e0b' : pick.grade === 'B' ? '#3b82f6' : '#999999'};font-weight:600;">${pick.grade}级</div>
            </div>

            <!-- 迷你雷达图 -->
            <svg width="${size}" height="${size}" style="flex-shrink:0;">
              <!-- 背景网格 -->
              <polygon points="${[0,1,2,3].map(j => { const angle = (Math.PI * 2 * j) / 4 - Math.PI / 2; return `${center + radius * Math.cos(angle)},${center + radius * Math.sin(angle)}`; }).join(" ")}" fill="none" stroke="rgba(245,158,11,.1)" stroke-width="1"/>
              <polygon points="${[0,1,2,3].map(j => { const angle = (Math.PI * 2 * j) / 4 - Math.PI / 2; return `${center + radius * 0.5 * Math.cos(angle)},${center + radius * 0.5 * Math.sin(angle)}`; }).join(" ")}" fill="none" stroke="rgba(245,158,11,.08)" stroke-width="1"/>
              <!-- 数据 -->
              <polygon points="${radarPoints}" fill="rgba(245,158,11,.15)" stroke="#f59e0b" stroke-width="1.5"/>
              <!-- 标签 -->
              ${radarData.map((d, j) => {
                const angle = (Math.PI * 2 * j) / 4 - Math.PI / 2;
                const lx = center + (radius + 14) * Math.cos(angle);
                const ly = center + (radius + 14) * Math.sin(angle);
                return `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" fill="#92400e" font-size="9">${d.label}</text>`;
              }).join("")}
            </svg>

            <!-- 详情 -->
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:4px;">
                <b style="color:#fbbf24;font-size:14px;">${pick.name}</b>
                <span style="font-size:11px;color:#92400e;">${pick.code}</span>
                ${pick.type === 'ETF' ? '<span style="font-size:10px;padding:1px 5px;background:rgba(59,130,246,.2);border:1px solid rgba(59,130,246,.4);border-radius:4px;color:#60a5fa;margin-left:4px;">ETF</span>' : ''}
                ${pick.industry ? `<span style="font-size:10px;padding:1px 5px;background:rgba(148,163,184,.15);border-radius:4px;color:#999999;margin-left:4px;">${pick.industry}</span>` : ''}
                ${pick.price ? `<span style="font-size:13px;color:#f59e0b;margin-left:4px;">¥${typeof pick.price === 'number' ? pick.price.toFixed(2) : pick.price}</span>` : ''}
              </div>
              <!-- 多周期涨跌 -->
              <div style="display:flex;gap:10px;margin-bottom:6px;font-size:11px;">
                <span style="color:${chg1d >= 0 ? '#E53935' : '#34d399'};">日${chg1d >= 0 ? '+' : ''}${chg1d}%</span>
                <span style="color:${chg5d >= 0 ? '#E53935' : '#34d399'};">周${chg5d >= 0 ? '+' : ''}${chg5d}%</span>
                <span style="color:${chg20d >= 0 ? '#E53935' : '#34d399'};">月${chg20d >= 0 ? '+' : ''}${chg20d}%</span>
              </div>
              <div style="font-size:12px;color:#b45309;line-height:1.6;margin-bottom:6px;">${pick.summary || ''}</div>
              ${techAnalysis.trend ? `<div style="font-size:11px;color:#1E88E5;margin-bottom:4px;">📊 趋势：${techAnalysis.trend} ${techAnalysis.signals?.length ? '· ' + techAnalysis.signals.join(' ') : ''}</div>` : ''}
              ${pick.type === 'ETF' ? '<div style="font-size:11px;color:#60a5fa;margin-bottom:4px;">💡 ETF适合定投、行业配置，分散单股风险</div>' : ''}
              ${pick.highlights?.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;">${pick.highlights.map(h => `<span style="font-size:10px;padding:2px 6px;background:rgba(245,158,11,.1);border-radius:4px;color:#d97706;">${h}</span>`).join("")}</div>` : ''}
              ${pick.risks?.length ? `<div style="font-size:11px;color:#92400e;margin-bottom:4px;">⚠️ ${pick.risks.join(' · ')}</div>` : ''}
              ${pick.alerts?.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;">${pick.alerts.map(a => {
                // 根据level确定颜色
                const levelColors = { 'bullish': '#22c55e', 'info': '#1E88E5', 'warning': '#fbbf24', 'bearish': '#E53935', 'danger': '#ef4444', 'opportunity': '#34d399', 'neutral': '#999999' };
                const levelBgs = { 'bullish': '34,197,94', 'info': '129,140,248', 'warning': '251,191,36', 'bearish': '248,113,113', 'danger': '239,68,68', 'opportunity': '52,211,153', 'neutral': '148,163,184' };
                const color = levelColors[a.level] || '#999999';
                const bgRgb = levelBgs[a.level] || '148,163,184';
                return `<span style="font-size:10px;padding:2px 6px;background:rgba(${bgRgb},.12);border:1px solid rgba(${bgRgb},.3);border-radius:4px;color:${color};">${a.icon || '📌'} ${a.msg || ''}</span>`;
              }).join("")}</div>` : ''}
              ${pick.etfPotential ? `<div style="margin-top:4px;padding:6px 8px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:6px;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                  <span style="font-size:10px;padding:1px 5px;background:${pick.etfPotential.potential?.includes('高')?'rgba(34,197,94,.2)':pick.etfPotential.potential?.includes('中')?'rgba(251,191,36,.2)':'rgba(148,163,184,.15)'};border:1px solid ${pick.etfPotential.potential?.includes('高')?'rgba(34,197,94,.4)':pick.etfPotential.potential?.includes('中')?'rgba(251,191,36,.4)':'rgba(148,163,184,.3)'};border-radius:4px;color:${pick.etfPotential.potential?.includes('高')?'#22c55e':pick.etfPotential.potential?.includes('中')?'#fbbf24':'#999999'};font-weight:600;">💡 ${pick.etfPotential.potential || '潜力分析'}</span>
                  <span style="font-size:10px;color:#60a5fa;">${pick.etfPotential.score}分</span>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                  ${Object.entries(pick.etfPotential.dimensions || {}).map(([k,v]) => `<span style="font-size:9px;padding:1px 4px;background:rgba(96,165,250,.1);border-radius:3px;color:#60a5fa;" title="${v.detail || ''}">${v.label || k}: ${v.score}分</span>`).join("")}
                </div>
              </div>` : ''}
            </div>
          </div>
          <!-- 展开的K线图区域 -->
          <div id="expandedKline-${pick.code}" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid rgba(245,158,11,.15);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
              <span style="font-size:12px;color:#92400e;font-weight:600;">📈 K线走势</span>
              <div style="display:flex;gap:6px;">
                <button class="kline-period-btn active" data-code="${pick.code}" data-period="minute" style="font-size:11px;padding:4px 10px;background:rgba(245,158,11,.25);border:1px solid rgba(245,158,11,.4);border-radius:6px;color:#fbbf24;cursor:pointer;">分时</button>
                <button class="kline-period-btn" data-code="${pick.code}" data-period="day" style="font-size:11px;padding:4px 10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);border-radius:6px;color:#d97706;cursor:pointer;">日K</button>
                <button class="kline-period-btn" data-code="${pick.code}" data-period="week" style="font-size:11px;padding:4px 10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);border-radius:6px;color:#d97706;cursor:pointer;">周K</button>
                <button style="font-size:11px;padding:4px 10px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:6px;color:#1E88E5;cursor:pointer;">完整分析 →</button>
              </div>
            </div>
            <div id="expandedKlineChart-${pick.code}" style="width:100%;height:200px;background:rgba(0,0,0,.2);border-radius:8px;"></div>
          </div>
        </div>`;
      }).join("");

      // 绑定按钮点击事件（替代内联onclick，CSP兼容）
      cardsEl.querySelectorAll(".kline-period-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const code = btn.dataset.code;
          const period = btn.dataset.period;
          if (code && period) switchKlinePeriod(code, period);
        });
      });
      cardsEl.querySelectorAll("button").forEach(btn => {
        if (btn.textContent.includes("完整分析")) {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const code = btn.closest(".ai-pick-card")?.dataset?.code;
            if (code) navigateToStock(code);
          });
        }
      });

      // 懒加载迷你K线图 — 仅在卡片滚动到视口内时才创建图表
      async function loadOneMiniChart(pick) {
        try {
          const container = $(`#expandedKlineChart-${pick.code}`);
          if (!container || container.dataset.loaded) return;
          container.dataset.loaded = "1";
          const resp = await fetch(`/api/indicators?code=${pick.code}&days=60`);
          const data = await resp.json();
          if (data.error || !data.dates || !container.isConnected) return;
          const chart = ChartManager.getChart(container, "scan");
          if (!chart) return;
          const ohlc = data.opens.slice(-30).map((o, i) => [o, data.closes.slice(-30)[i], data.lows.slice(-30)[i], data.highs.slice(-30)[i]]);
          chart.setOption({
            backgroundColor: "transparent",
            grid: { left: 0, right: 0, top: 0, bottom: 0 },
            xAxis: { type: "category", show: false, data: data.dates.slice(-30) },
            yAxis: { type: "value", show: false, scale: true },
            series: [{ type: "candlestick", data: ohlc, itemStyle: { color: "#E53935", color0: "#43A047", borderColor: "#E53935", borderColor0: "#43A047" } }],
          });
          ChartManager.manageResize(chart);
        } catch (e) { /* 静默失败 */ }
      }
      // 用 IntersectionObserver，卡片进入视口时才加载
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach(en => {
            if (en.isIntersecting) {
              const code = en.target.dataset?.code;
              const pick = picks.find(p => p.code === code);
              if (pick) loadOneMiniChart(pick);
              io.unobserve(en.target);
            }
          });
        }, { rootMargin: "200px" });
        cardsEl.querySelectorAll(".ai-pick-card").forEach(c => io.observe(c));
      } else {
        // 降级：逐个串行加载
        for (const pick of picks) await loadOneMiniChart(pick);
      }
    }

    resultsEl.style.display = "block";

    // 绑定点击事件 — 展开显示K线图
    cardsEl.querySelectorAll(".ai-pick-card").forEach(card => {
      card.addEventListener("click", async (e) => {
        // 如果点击的是按钮，不处理卡片展开逻辑
        if (e.target.closest("button")) return;
        console.log("[AIPick] card clicked", card.dataset.code, "perf-now:", performance.now().toFixed(0));

        const code = card.dataset.code;
        const expandedEl = $(`#expandedKline-${code}`);
        const chartEl = $(`#expandedKlineChart-${code}`);
        if (!expandedEl || !chartEl) return;

        // 切换展开/收起
        if (expandedEl.style.display === "none") {
          // 先收起其他展开的
          cardsEl.querySelectorAll("[id^='expandedKline-']").forEach(el => el.style.display = "none");
          cardsEl.querySelectorAll(".ai-pick-card").forEach(c => c.style.borderColor = "rgba(245,158,11,.15)");

          expandedEl.style.display = "block";
          card.style.borderColor = "rgba(245,158,11,.4)";

          // 加载分钟K线图
          if (!chartEl.dataset.loaded && !chartEl.dataset.loading) {
            chartEl.dataset.loading = "1";
            try {
              const resp = await fetch(`/api/fundflow/rtchart?code=${code}&lite=1`);
              const data = await resp.json();
              if (data.error || !data.candles || !data.candles.length) {
                // 分钟数据不可用时，加载日K线
                const dayResp = await fetch(`/api/indicators?code=${code}&days=60`);
                const dayData = await dayResp.json();
                if (!dayData.error && dayData.dates) {
                  // 延迟一帧确保容器已完成布局，再初始化图表
                  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                  loadDayKlineChart(chartEl, dayData, code);
                  chartEl.dataset.loaded = "day";
                }
                chartEl.dataset.loading = "";
                return;
              }

              // 延迟一帧确保容器已完成布局
              await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
              if (!chartEl.isConnected) return;
              const chart = ChartManager.getChart(chartEl, "scan");
              if (!chart) return;
              const times = data.candles.map(c => c.time);
              const ohlc = data.candles.map(c => [c.open, c.close, c.low, c.high]);

              chart.setOption({
                backgroundColor: "transparent",
                grid: { left: 50, right: 20, top: 20, bottom: 40 },
                xAxis: {
                  type: "category",
                  data: times,
                  axisLabel: { color: "#999999", fontSize: 10 },
                  axisLine: { lineStyle: { color: "#EAEAEA" } }
                },
                yAxis: {
                  type: "value",
                  scale: true,
                  axisLabel: { color: "#999999", fontSize: 10 },
                  splitLine: { lineStyle: { color: "#F0F0F0" } }
                },
                series: [{
                  name: "K线",
                  type: "candlestick",
                  data: ohlc,
                  itemStyle: { color: "#E53935", color0: "#43A047", borderColor: "#E53935", borderColor0: "#43A047", borderWidth: 1.5 }
                }],
                tooltip: {
                  trigger: "axis",
                  backgroundColor: "rgba(255,255,255,.97)",
                  borderColor: "#EAEAEA",
                  textStyle: { color: "#333333" },
                  formatter: params => {
                    const p = params[0];
                    const d = p.data;
                    return `${p.axisValue}<br/>开: ${d[1]} 收: ${d[2]}<br/>低: ${d[3]} 高: ${d[4]}`;
                  }
                },
                dataZoom: [
                  { type: "inside", start: 0, end: 100 }
                ]
              });

              chartEl.dataset.loaded = "minute";
              chartEl.dataset.loading = "";
              ChartManager.manageResize(chart);
              addMinuteSignal(chart, chartEl, code, ohlc, times);
            } catch (err) { chartEl.dataset.loading = ""; /* 静默失败 */ }
          }
        } else {
          expandedEl.style.display = "none";
          card.style.borderColor = "rgba(245,158,11,.15)";
        }
      });
    });

  } catch (e) {
    toast("AI 推荐失败: " + (e.message || "未知错误"));
  } finally {
    btn.textContent = originalText; btn.disabled = false;
  }
});

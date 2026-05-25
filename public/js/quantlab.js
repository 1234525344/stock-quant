// 量化工厂 — 多因子Alpha & 组合优化
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

function toast(msg) {
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  document.body.appendChild(t); setTimeout(() => t.remove(), 2500);
}

// ============ 因子看板 ============
let chartFactorHeat, chartAlphaBar, chartFactorIC;
let factorData = [];

function initFactorCharts() {
  chartFactorHeat = echarts.init($("#chartFactorHeat"));
  chartAlphaBar = echarts.init($("#chartAlphaBar"));
  chartFactorIC = echarts.init($("#chartFactorIC"));
  window.addEventListener("resize", () => {
    chartFactorHeat?.resize(); chartAlphaBar?.resize(); chartFactorIC?.resize();
  });
}

async function loadFactors() {
  initFactorCharts();
  try {
    const data = await fetch("/api/factors/exposures").then(r => r.json());
    if (data.error) { toast(data.error); return; }
    factorData = data;
    renderAlphaStrip(data);
    renderFactorHeatmap(data);
    renderAlphaBar(data);
    loadFactorIC();
  } catch (e) { toast("因子加载失败: " + e.message); }
}

function renderAlphaStrip(data) {
  const sorted = [...data].sort((a, b) => b.alpha - a.alpha);
  const strip = $("#alphaStrip");
  strip.innerHTML = sorted.map(d => {
    const cls = d.alpha > 40 ? "strong" : d.alpha > 15 ? "good" : d.alpha > -15 ? "neutral" : "weak";
    return `<div class="alpha-item" data-code="${d.code}" title="${d.name}">
      <div class="a-code">${d.code}</div>
      <div class="a-name">${d.name?.length > 4 ? d.name.slice(0,4)+'..' : d.name}</div>
      <div class="a-score ${cls}">${d.alpha > 0 ? '+' : ''}${d.alpha}</div>
    </div>`;
  }).join("");
}

function renderFactorHeatmap(data) {
  if (!chartFactorHeat) return;
  const factorNames = Object.keys(data[0]?.factors || {}).filter(k => k !== "size");
  if (!factorNames.length) return;

  // 友好名称
  const labelMap = {
    mom12_1: "动量12-1M", mom6: "动量6M", mom3: "动量3M", momRiskAdj: "风险调整动量",
    value52w: "价值52周", value60d: "价值60日",
    sharpe: "Sharpe", stability: "稳定性", maxDrawdown: "最大回撤(-)", ddDuration: "回撤持续(-)",
    vol20: "波动20d(-)", vol60: "波动60d(-)", downVol: "下行波(-)",
    volGrowth: "量增长", priceAccel: "价加速",
    amihud: "非流动性", turnover: "换手率",
    rev5: "5日反转", rev20: "20日反转", divergence: "量价背离",
  };

  const stocks = data.map(d => d.code);
  const labels = factorNames.map(f => labelMap[f] || f);

  // 热力数据: [stockIdx, factorIdx, value]
  const heatData = [];
  for (let i = 0; i < data.length; i++) {
    for (let j = 0; j < factorNames.length; j++) {
      heatData.push([j, i, data[i].factors[factorNames[j]] || 0]);
    }
  }

  chartFactorHeat.setOption({
    backgroundColor: "transparent",
    tooltip: {
      backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)",
      textStyle: { color: "#e0e4f0" },
      formatter: p => `${labels[p.data[0]]}<br/>${stocks[p.data[1]]}<br/>暴露: ${p.data[2].toFixed(2)}σ`,
    },
    grid: { left: 80, right: 60, top: 10, bottom: 100 },
    xAxis: { type: "category", data: labels, axisLabel: { color: "#8890b5", fontSize: 10, rotate: 45 },
      position: "bottom" },
    yAxis: { type: "category", data: stocks, axisLabel: { color: "#8890b5", fontSize: 11 } },
    visualMap: {
      min: -2.5, max: 2.5, calculable: true, orient: "vertical", right: 10, top: 20,
      inRange: { color: ["#22c55e", "#0d1128", "#ef4444"] },
      text: ["超配", "低配"], textStyle: { color: "#5f6b8a", fontSize: 10 },
    },
    series: [{
      type: "heatmap", data: heatData, label: { show: false },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,.4)" } },
    }],
  }, true);
}

function renderAlphaBar(data) {
  if (!chartAlphaBar) return;
  const sorted = [...data].sort((a, b) => b.alpha - a.alpha);
  chartAlphaBar.setOption({
    backgroundColor: "transparent",
    title: { text: "Alpha 得分排序", left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14 } },
    grid: { left: 80, right: 30, top: 50, bottom: 30 },
    xAxis: { type: "value", axisLabel: { color: "#5f6b8a", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
    yAxis: { type: "category", data: sorted.map(d => d.code), axisLabel: { color: "#8890b5", fontSize: 11 } },
    tooltip: {
      trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)",
      textStyle: { color: "#e0e4f0" },
      formatter: p => `<b>${sorted[p[0].dataIndex].name}</b> (${sorted[p[0].dataIndex].code})<br/>Alpha: ${p[0].data.toFixed(1)}`,
    },
    series: [{
      type: "bar", data: sorted.map(d => ({
        value: d.alpha,
        itemStyle: { color: d.alpha > 30 ? "#ef4444" : d.alpha > 0 ? "#f59e0b" : d.alpha > -20 ? "#6366f1" : "#6b7280" },
      })),
    }],
  }, true);
}

async function loadFactorIC() {
  try {
    const data = await fetch("/api/factors/returns").then(r => r.json());
    if (data.error || !data.series?.length) return;

    if (!chartFactorIC) initFactorCharts();
    const factorNames = Object.keys(data.series[0] || {}).filter(k => k !== "date");

    const labelMap = {
      mom12_1: "动量12-1M", mom6: "动量6M", mom3: "动量3M",
      value52w: "价值52周", value60d: "价值60日",
      sharpe: "质量Sharpe", stability: "稳定性",
      vol20: "波动20d", vol60: "波动60d",
      rev5: "5日反转", composite: "综合",
    };

    chartFactorIC.setOption({
      backgroundColor: "transparent",
      title: { text: "因子IC走势 (信息系数)", left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14 } },
      grid: { left: 12, right: 30, top: 50, bottom: 30 },
      legend: { right: 16, top: 10, textStyle: { color: "#8890b5", fontSize: 10 } },
      xAxis: { type: "category", data: data.series.map(s => s.date?.slice(5) || s.date), axisLabel: { color: "#5f6b8a", fontSize: 10, rotate: 30 } },
      yAxis: { axisLabel: { color: "#5f6b8a", fontSize: 11, formatter: v => v.toFixed(2) }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)" },
      series: factorNames.filter(f => f !== "divergence" && f !== "size" && f !== "recovery").map(f => ({
        name: labelMap[f] || f, type: "line", data: data.series.map(s => s[f]),
        lineStyle: { width: 1.5 }, symbol: "none",
      })),
    }, true);
  } catch (e) { /* IC optional */ }
}

// Tab切换
$$(".ptab").forEach(tab => tab.addEventListener("click", function() {
  $$(".ptab").forEach(t => t.classList.remove("active"));
  this.classList.add("active");
  const view = this.dataset.view;
  $("#chartFactorHeat").style.display = view === "heatmap" ? "" : "none";
  $("#chartAlphaBar").style.display = view === "bar" ? "" : "none";
  $("#chartFactorIC").style.display = view === "ic" ? "" : "none";
  if (view === "ic") loadFactorIC();
}));

// ============ 组合优化 ============
let chartPie, chartFrontier;

function initPortCharts() {
  chartPie = echarts.init($("#chartPie"));
  chartFrontier = echarts.init($("#chartFrontier"));
  window.addEventListener("resize", () => { chartPie?.resize(); chartFrontier?.resize(); });
}

$("#btnOptimize")?.addEventListener("click", async () => {
  const codes = $("#portCodes").value.trim();
  const method = $("#optMethod").value;
  if (!codes) { toast("请输入股票代码"); return; }
  const btn = $("#btnOptimize"); btn.textContent = "优化中..."; btn.disabled = true;

  try {
    const data = await fetch("/api/portfolio/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes, method }),
    }).then(r => r.json());
    if (data.error) { toast(data.error); return; }

    if (!chartPie) initPortCharts();
    const result = data.results[method];
    if (!result) { toast("优化失败"); return; }

    // 饼图
    const pieData = (result.weights || []).filter(w => w.weight > 0.5);
    chartPie.setOption({
      backgroundColor: "transparent",
      title: { text: `${method} 权重分配`, left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14 } },
      tooltip: { trigger: "item", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)",
        formatter: p => `${p.data.name}<br/>权重: ${p.data.value}%` },
      series: [{
        type: "pie", radius: ["35%", "65%"], center: ["50%", "55%"],
        data: pieData.map(w => ({ name: `${w.name || w.code}`, value: w.weight })),
        label: { color: "#8890b5", fontSize: 11 },
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0,0,0,.5)" } },
        itemStyle: { borderRadius: 6, borderColor: "rgba(15,19,48,.8)", borderWidth: 2 },
      }],
    }, true);

    // 有效前沿
    if (data.efficientFrontier?.length) {
      const ef = data.efficientFrontier;
      // 计算最大Sharpe点
      let maxSharpePt = ef[0];
      for (const p of ef) { if (p.sharpe > maxSharpePt.sharpe) maxSharpePt = p; }

      chartFrontier.setOption({
        backgroundColor: "transparent",
        title: { text: "有效前沿", left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14 } },
        grid: { left: 12, right: 16, top: 50, bottom: 30 },
        legend: { right: 16, top: 10, textStyle: { color: "#8890b5", fontSize: 10 } },
        xAxis: { name: "年化波动率 %", nameTextStyle: { color: "#5f6b8a", fontSize: 10 },
          axisLabel: { color: "#5f6b8a", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
        yAxis: { name: "年化收益 %", nameTextStyle: { color: "#5f6b8a", fontSize: 10 },
          axisLabel: { color: "#5f6b8a", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
        tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)" },
        series: [
          { name: "有效前沿", type: "line", data: ef.map(p => [p.vol, p.ret]),
            lineStyle: { color: "#6366f1", width: 2 }, symbol: "none", smooth: true,
            areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1,
              [{ offset: 0, color: "rgba(99,102,241,.15)" }, { offset: 1, color: "rgba(99,102,241,0)" }]) },
          },
          { name: "最优Sharpe", type: "scatter", data: [[maxSharpePt.vol, maxSharpePt.ret]],
            symbolSize: 14, itemStyle: { color: "#ef4444" },
            markLine: { silent: true, symbol: "none",
              data: [{ yAxis: maxSharpePt.ret, lineStyle: { color: "rgba(239,68,68,.3)", type: "dashed" } },
                     { xAxis: maxSharpePt.vol / 2 + (ef[0].vol / 2), lineStyle: { color: "rgba(239,68,68,.3)", type: "dashed" } }],
            },
          },
          { name: "等权基准", type: "scatter", data: ef.length > 10 ? [[ef[Math.floor(ef.length / 2)].vol, ef[Math.floor(ef.length / 2)].ret]] : [],
            symbolSize: 10, itemStyle: { color: "#94a3b8" } },
        ],
      }, true);
    }

    // 统计卡片
    $("#portStats").innerHTML = `
      <div class="port-stat-card" title="按这个组合配置，一年预计能赚多少"><div class="ps-label">预计年收益</div><div class="ps-value" style="color:#f87171">${result.stats?.annualReturn || "-"}%</div></div>
      <div class="port-stat-card" title="价格波动的幅度，越低越稳"><div class="ps-label">年化波动率</div><div class="ps-value">${result.stats?.annualVol || "-"}%</div></div>
      <div class="port-stat-card" title="每承担一单位风险能赚多少，>1 算不错"><div class="ps-label">夏普比率</div><div class="ps-value" style="color:#fbbf24">${result.stats?.sharpe || "-"}</div></div>
      <div class="port-stat-card" title="优化后实际持有几只股票"><div class="ps-label">精选股票数</div><div class="ps-value" style="color:#94a3b8">${result.weights.filter(w=>w.weight>0.5).length}</div></div>
    `;

    // 权重表格
    $("#portTable").innerHTML = `<table>
      <thead><tr><th>代码</th><th>名称</th><th>权重</th><th>分配</th></tr></thead>
      <tbody>${result.weights.sort((a,b)=>b.weight-a.weight).map(w => `
        <tr><td>${w.code}</td><td>${w.name||w.code}</td>
        <td><b>${w.weight}%</b></td>
        <td><span class="weight-bar" style="width:${Math.max(4,w.weight*2)}px;"></span></td>
        </tr>`).join("")}</tbody></table>`;
  } catch (e) { toast("优化失败: " + e.message); }
  finally { btn.textContent = "运行优化"; btn.disabled = false; }
});

// ============ 风险仪表盘 ============
let chartRiskDecomp;

$("#btnRisk")?.addEventListener("click", async () => {
  const code = $("#riskCode").value.trim();
  if (!code) { toast("请输入股票代码"); return; }
  const btn = $("#btnRisk"); btn.textContent = "分析中..."; btn.disabled = true;

  try {
    const data = await fetch(`/api/risk/decompose?code=${code}`).then(r => r.json());
    if (data.error) { toast(data.error); return; }

    $("#rVol").textContent = (data.totalRisk * 100).toFixed(1) + "%";
    $("#rVaR").textContent = data.var95 + "%";
    $("#rBeta").textContent = data.beta;
    $("#rSys").textContent = (data.systematicRisk * 100).toFixed(1) + "%";
    $("#rSpec").textContent = (data.specificRisk * 100).toFixed(1) + "%";
    $("#rR2").textContent = data.rSquared;

    // 风险分解饼图
    if (!chartRiskDecomp) {
      chartRiskDecomp = echarts.init($("#chartRiskDecomp"));
      window.addEventListener("resize", () => chartRiskDecomp?.resize());
    }
    chartRiskDecomp.setOption({
      backgroundColor: "transparent",
      title: { text: "风险归因", left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14 } },
      series: [{
        type: "pie", radius: ["40%", "65%"], center: ["50%", "55%"],
        data: [
          { name: "系统性风险", value: Math.max(0, (data.systematicRisk || 0) * 100).toFixed(2),
            itemStyle: { color: "#6366f1" } },
          { name: "特质风险", value: Math.max(0, (data.specificRisk || 0) * 100).toFixed(2),
            itemStyle: { color: "#818cf8" } },
        ],
        label: { color: "#8890b5", fontSize: 11, formatter: "{b}\n{d}%" },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,.5)" } },
      }],
    }, true);

    // 压力测试 (用默认场景)
    const stressScenarios = [
      { scenario: "2008金融危机", marketDrop: "-30%", stressedVol: "?%", stressedVaR95: "?%", expectedLoss: "?" },
      { scenario: "2015股灾", marketDrop: "-25%", stressedVol: "?%", stressedVaR95: "?%", expectedLoss: "?" },
      { scenario: "2020疫情冲击", marketDrop: "-15%", stressedVol: "?%", stressedVaR95: "?%", expectedLoss: "?" },
      { scenario: "温和回调", marketDrop: "-10%", stressedVol: "?%", stressedVaR95: "?%", expectedLoss: "?" },
    ];
    // 基于beta简单估算
    const beta = data.beta || 1;
    stressScenarios.forEach(s => {
      const drop = parseFloat(s.marketDrop);
      const estLoss = (beta * drop * 100).toFixed(1);
      const estVol = (Math.abs(drop) * beta * 2 * 100).toFixed(0);
      const estVaR = (Math.abs(drop) * beta * 1.5 * 100).toFixed(1);
      s.expectedLoss = estLoss + "%";
      s.stressedVol = estVol + "%";
      s.stressedVaR95 = estVaR + "%";
      if (Math.abs(parseFloat(estLoss)) > 25) s.lossClass = "loss-severe";
      else if (Math.abs(parseFloat(estLoss)) > 10) s.lossClass = "loss-moderate";
      else s.lossClass = "loss-mild";
    });

    $("#stressTable").innerHTML = `<h3 style="color:#c8cdf0;margin-bottom:10px;">压力测试 <span style="font-weight:400;font-size:11px;color:#5f6b8a;">— 如果历史重演，你的股票会怎样</span></h3>
      <table><thead><tr><th>历史情景</th><th>大盘当时跌了</th><th>你的股票预计亏</th><th>压力波动</th><th>压力VaR 95%</th></tr></thead>
      <tbody>${stressScenarios.map(s => `<tr>
        <td>${s.scenario}</td><td style="color:#f87171">${s.marketDrop}</td>
        <td class="loss-cell ${s.lossClass}">${s.expectedLoss}</td>
        <td>${s.stressedVol}</td><td>${s.stressedVaR95}</td>
      </tr>`).join("")}</tbody></table>`;
  } catch (e) { toast("风险分析失败: " + e.message); }
  finally { btn.textContent = "分析风险"; btn.disabled = false; }
});

// ============ 启动 ============
loadFactors();

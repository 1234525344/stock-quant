// 量化交易平台 v4 — 实时资金流 + 动态界面
// 工具函数和管理器已在 modules/utils.js 和 modules/managers.js 中定义

// 诊断：进度跟踪
function __diagStep(msg) {
  var el = document.getElementById('__loadingStep');
  if (el) el.textContent = msg;
  console.log("[DIAG]", msg);
}
__diagStep("app.js 开始执行");

// 全局错误捕获
window.addEventListener("error", e => console.error("[全局错误]", e.message, e.filename, e.lineno));
window.addEventListener("unhandledrejection", e => console.error("[未处理Promise]", e.reason));

// 长任务检测 — 捕获阻塞主线程超过50ms的操作
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      console.warn("[LONG TASK]", entry.duration.toFixed(0) + "ms", entry.startTime.toFixed(0), "at", new Date().toLocaleTimeString());
    }
  }).observe({ type: "longtask", buffered: true });
} catch (e) {}

// 自动飞行记录器 — 记录最近20个用户操作+耗时，卡死时自动显示
(function() {
  const log = [];
  window.__actionLog = log;
  function record(action) {
    log.push({ t: new Date().toLocaleTimeString(), action, ms: performance.now().toFixed(0) });
    if (log.length > 20) log.shift();
  }

  // 拦截所有点击
  document.addEventListener("click", e => {
    const card = e.target.closest(".scan-result-card");
    const aiCard = e.target.closest(".ai-pick-card");
    if (card) record("点击扫描结果 " + card.dataset.code);
    else if (aiCard) record("点击AI推荐 " + aiCard.dataset.code);
    else if (e.target.closest("#btnScan")) record("点击开始扫描");
    else if (e.target.closest("#btnAIPick")) record("点击AI智能推荐");
    else if (e.target.closest("#btnNLScreen")) record("点击AI筛选");
    else record("点击 " + e.target.tagName);
  }, true);

  // 主线程看门狗
  let last = Date.now(), blocked = 0;
  const ov = document.createElement("div");
  ov.style.cssText = "display:none;position:fixed;bottom:0;left:0;right:0;z-index:99999;background:rgba(220,38,38,.95);color:#fff;padding:10px 14px;font:11px/1.5 monospace;max-height:40vh;overflow:auto;";
  document.body.appendChild(ov);

  setInterval(() => {
    const now = Date.now(), delay = now - last - 100;
    if (delay > 800) {
      blocked += delay;
      if (blocked > 1000) {
        ov.style.display = "block";
        ov.innerHTML = `<b>⚠ 卡死 ${blocked}ms</b><br>` +
          log.slice(-8).map(l => `${l.t} [${l.ms}] ${l.action}`).join("<br>");
      }
    } else {
      blocked = 0;
      ov.style.display = "none";
    }
    last = now;
  }, 100);
})();

// ============ WebSocket 实时行情 ============
const WS_URL = `ws://${location.hostname}:3457`;
let wsClient = null;
let wsReconnectTimer = null;
let wsSubscribedCodes = [];
let wsReconnectAttempts = 0;
const WS_MAX_RECONNECT = 10;

// RAF批量更新: 收集多个tick, 在下一帧统一渲染
let _rafPending = false;
let _tickBuffer = [];
const TICK_BUFFER_MAX = 100;

function connectWebSocket() {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) return;

  try {
    wsClient = new WebSocket(WS_URL);

    wsClient.onopen = async () => {
      console.log("[WS] 实时行情已连接");
      wsReconnectAttempts = 0;
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }

      try {
        const pool = await fetch("/api/pool").then(r => r.json()).catch(() => []);
        if (pool.length > 0) {
          wsClient.send(JSON.stringify({ type: "subscribe", codes: pool.slice(0, 50) }));
          wsSubscribedCodes = pool.slice(0, 50);
        }
      } catch (e) { /* 静默失败 */ }
    };

    wsClient.onmessage = async (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "snapshot" && msg.quotes) {
          _tickBuffer = msg.quotes.map(q => ({ code: q.code, data: q }));
          _flushTicks();
        } else if (msg.type === "quote" && msg.data) {
          _tickBuffer.push({ code: msg.code, data: msg.data });
          if (_tickBuffer.length > TICK_BUFFER_MAX) _tickBuffer.shift();
          if (!_rafPending) {
            _rafPending = true;
            requestAnimationFrame(_flushTicks);
          }
        } else if (msg.type === "risk_alert" && msg.alerts) {
          // 全自动风控预警推送
          const pageRisk = $("#page-risk");
          const isRiskActive = pageRisk && pageRisk.classList.contains("active");

          for (const alert of msg.alerts) {
            if (alert.severity === "critical" || alert.severity === "danger") {
              toast(`⚠ ${alert.message}`);
            }
          }

          // 如果风控页面活跃，实时刷新
          if (isRiskActive) {
            const status = await fetch("/api/risk/status").then(r => r.json()).catch(() => null);
            if (status) updateRiskStatusBar(status);
            const alerts = await fetch("/api/risk/alerts?limit=20").then(r => r.json()).catch(() => []);
            renderAlertFeed(alerts);
          }

          // 更新预警计数（风控页活跃时由 loadRiskDashboard 定时刷新）
          const alertCountEl = document.querySelector("#riskHeroAlertCount");
          if (alertCountEl && msg.summary) {
            alertCountEl.textContent = msg.summary.today || (parseInt(alertCountEl.textContent) + msg.alerts.length);
            const alertCard = document.querySelector("#riskHeroAlert");
            if (alertCard) alertCard.style.display = "";
          }
        }
      } catch (err) {}
    };

    wsClient.onclose = () => {
      console.log("[WS] 断开, 重连中...");
      scheduleWSReconnect();
    };

    wsClient.onerror = () => { wsClient.close(); };
  } catch (e) { scheduleWSReconnect(); }
}

function scheduleWSReconnect() {
  if (wsReconnectTimer) return;
  if (wsReconnectAttempts >= WS_MAX_RECONNECT) {
    console.log("[WS] 已达最大重连次数, 停止重连");
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempts), 30000);
  wsReconnectAttempts++;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, delay);
}

// 在RAF帧内批量刷新DOM, 避免layout thrashing
function _flushTicks() {
  _rafPending = false;
  const batch = _tickBuffer;
  _tickBuffer = [];

  // 先读: 批量收集DOM引用
  const idxCards = $$("#indexCards .index-card");
  const cardMap = {};
  idxCards.forEach(card => {
    const code = card.dataset?.code;
    if (code) cardMap[code] = {
      priceEl: card.querySelector(".idx-price"),
      chgEl: card.querySelector(".idx-change"),
    };
  });

  // 后写: 批量更新
  for (const tick of batch) {
    const q = tick.data;
    const els = cardMap[tick.code];
    if (els) _applyTickToCard(els, q);
  }

  // 更新实时时间戳
  const liveEl = $("#liveTime");
  if (liveEl) liveEl.textContent = "实时 · " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function _applyTickToCard(els, q) {
  // 价格: 数值动画
  if (els.priceEl && q.price) {
    const prev = parseFloat(els.priceEl.textContent) || 0;
    if (Math.abs(q.price - prev) > 0.001) {
      animateNumber(els.priceEl, q.price);
      // 价格闪烁: 涨红跌绿
      els.priceEl.classList.remove("flash-up", "flash-down");
      void els.priceEl.offsetWidth; // force reflow
      els.priceEl.classList.add(q.price >= prev ? "flash-up" : "flash-down");
    }
  }

  // 涨跌幅
  if (els.chgEl && q.change != null) {
    const sign = q.change >= 0 ? "+" : "";
    els.chgEl.textContent = `${sign}${q.change}%`;
    els.chgEl.className = "idx-change " + (q.change >= 0 ? "up" : "down");
  }
}

// ============ 页面切换 ============
let aiConfigured = false;
async function checkAIConfigured() {
  try {
    const resp = await fetch("/api/ai/status");
    const data = await resp.json();
    aiConfigured = data.configured;
    // Show/hide AI UI elements
    $$(".ai-explain-btn").forEach(b => b.style.display = aiConfigured ? "inline-flex" : "none");
    if ($("#nlScreenRow")) $("#nlScreenRow").style.display = aiConfigured ? "block" : "none";
  } catch (e) { aiConfigured = false; }
}

function switchPage(page) {
  console.log("[Page] switchPage called with:", page);
  // 获取当前活动的页面
  const currentPage = document.querySelector(".page.active");
  const currentPageId = currentPage ? currentPage.id.replace("page-", "") : null;

  // 清理旧页面的图表和定时器
  if (currentPageId && currentPageId !== page) {
    ChartManager.disposePage(currentPageId);
    TimerManager.clearByPage(currentPageId);
  }

  $$(".nav-btn").forEach(b => b.classList.remove("active"));
  const btn = $(`.nav-btn[data-page="${page}"]`);
  if (btn) btn.classList.add("active");
  $$(".page").forEach(p => { p.classList.remove("active"); p.style.animation = "none"; });
  const pageEl = $(`#page-${page}`);
  if (pageEl) { pageEl.classList.add("active"); pageEl.style.animation = "pageIn .4s ease"; }

  clearInterval(ffLiveTimer);
  clearInterval(marketRefreshTimer);
  clearInterval(riskTickTimer);

  if (page === "market") { loadMarketOverview(); startMarketRefresh(); }
  if (page === "stock") { initStockChart(); loadStockAnalysis(); }
  if (page === "portfolio") { /* 组合分析页面无需初始化 */ }
  if (page === "backtest") initBTChart();
  if (page === "fundflow") { initFFChart(); loadFundFlow(); }
  if (page === "risk") loadRiskDashboard();
  if (page === "fund") loadFundPage();
  if (page === "scan") {
    if (aiConfigured && $("#nlScreenRow")) $("#nlScreenRow").style.display = "block";
  }
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

// 键盘快捷键
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return; // 不在输入框中响应
  const key = e.key.toLowerCase();
  if (key === "/" || (e.ctrlKey && key === "k")) { e.preventDefault(); $("#searchInput").focus(); return; }
  const pageMap = { "1": "market", "2": "stock", "3": "fundflow", "4": "backtest", "5": "compare", "6": "scan", "7": "risk" };
  if (pageMap[key]) switchPage(pageMap[key]);
});

function navigateToStock(code) {
  console.log("[Nav] navigateToStock called with code:", code);
  const input = $("#stockCode");
  if (input) input.value = code;
  // switchPage("stock") 内部已调用 loadStockAnalysis()，无需重复调用
  try { switchPage("stock"); } catch (e) { console.error("[Nav] switchPage error:", e); }
}

// ====================================================================
//  1. 市场总览 (实时量化仪表盘)
// ====================================================================
let indexTrendChart, sectorFlowChart, sectorHeatChart, marketRefreshTimer;
let riskPnlChart, riskExposureChart, riskStressChart, riskTickTimer;

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
    indexTrendChart = ChartManager.getChart("chartIndexTrend", "market");
    sectorFlowChart = ChartManager.getChart("chartSectorFlow", "market");
    sectorHeatChart = ChartManager.getChart("chartSectorHeat", "market");
    ChartManager.manageResize(indexTrendChart);
    ChartManager.manageResize(sectorFlowChart);
    ChartManager.manageResize(sectorHeatChart);
  }
  try {
    __diagStep("loadMarketOverview: 获取市场数据...");
    const [summary, sectorFlow, conceptFlow, breadth] = await Promise.all([
      fetch("/api/market/summary").then(r => r.json()).catch(() => null),
      fetch("/api/market/sector-flow").then(r => r.json()).catch(() => []),
      fetch("/api/market/concept-flow").then(r => r.json()).catch(() => []),
      fetch("/api/market/breadth").then(r => r.json()).catch(() => null),
    ]);
    if (!summary?.indices?.length) { toast("市场数据加载失败"); return; }
    __diagStep("loadMarketOverview: 数据已获取, 渲染中...");

    // 实时状态条
    updateLiveStatus(summary);

    // 天气报告
    updateWeatherBanner(summary);

    // 涨跌家数
    if (breadth && !breadth.error) renderBreadth(breadth);

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
    loadIndexTrend("000001", "上证指数");
    const firstCard = $("#indexCards")?.querySelector(".index-card");
    if (firstCard) firstCard.classList.add("selected");

    // 绑定K线图点击事件
    bindIndexCardKlineEvents();
    bindSectorKlineEvents();
    __diagStep("loadMarketOverview: 渲染完成 ✓");

  } catch (e) { toast("市场总览加载失败: " + e.message); __diagStep("loadMarketOverview 错误: " + e.message); }
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
  const plainMap = {
    "强势上涨": "今天市场情绪高涨，多数股票在涨。适合顺势操作，但注意不要追高。",
    "温和上涨": "市场小幅走高，整体偏乐观。可以关注领涨板块寻找机会。",
    "小幅回调": "市场微跌，属于正常调整。不必恐慌，观察是否有支撑。",
    "明显下跌": "市场跌幅较大，风险偏好下降。建议控制仓位，等待企稳信号。",
    "横盘震荡": "市场方向不明确，涨跌互现。适合观望，不宜大举进场。"
  };
  const plainText = plainMap[weather.mood] || weather.summary;
  window._lastWeatherText = weather.summary + "。💡 " + plainText;
  $("#weatherSummary").textContent = window._lastWeatherText;

  // AI 解读按钮
  const aiBtn = $("#btnAISummary");
  if (aiBtn) {
    aiBtn.style.display = aiConfigured ? "inline-flex" : "none";
    aiBtn.classList.remove("loading");
    aiBtn.textContent = "🤖 AI 解读";
  }

  // 资金流向警示条
  const ff = summary.fundFlow;
  let ffEl = $("#fundFlowAlert");
  if (!ffEl) {
    ffEl = document.createElement("div");
    ffEl.id = "fundFlowAlert";
    ffEl.style.cssText = "margin-top:10px;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:500;";
    weatherEl.appendChild(ffEl);
  }
  if (ff) {
    const isOutflow = ff.status === "major_outflow" || ff.status === "outflow";
    const isInflow = ff.status === "major_inflow" || ff.status === "inflow";
    ffEl.style.display = "block";
    ffEl.style.background = isOutflow ? "rgba(34,197,94,.12)" : isInflow ? "rgba(239,68,68,.12)" : "rgba(255,255,255,.04)";
    ffEl.style.color = isOutflow ? "#4ade80" : isInflow ? "#f87171" : "#8890b5";
    ffEl.style.border = "1px solid " + (isOutflow ? "rgba(34,197,94,.25)" : isInflow ? "rgba(239,68,68,.25)" : "rgba(255,255,255,.06)");
    const netAmt = Math.abs(ff.totalMainNet || 0);
    const amtStr = netAmt >= 1e8 ? (netAmt / 1e8).toFixed(1) + "亿" : (netAmt / 1e4).toFixed(0) + "万";
    const sign = (ff.totalMainNet || 0) >= 0 ? "+" : "-";
    ffEl.innerHTML = `💰 资金面: <b>${ff.label}</b> (主力净${sign}${amtStr}) · ${ff.inflowSectors || 0}板块流入/${ff.outflowSectors || 0}板块流出`;
  } else {
    ffEl.style.display = "none";
  }
}

// AI 市场解读 按钮
$("#btnAISummary")?.addEventListener("click", async function () {
  const btn = this;
  if (btn.classList.contains("loading")) return;
  const summaryEl = $("#weatherSummary");

  // 如果当前是 AI 模式，切回模板
  if (btn.dataset.mode === "ai") {
    btn.textContent = "🤖 AI 解读";
    btn.dataset.mode = "";
    summaryEl.textContent = window._lastWeatherText || "";
    return;
  }

  btn.classList.add("loading");
  btn.textContent = "⏳ 生成中...";
  try {
    const resp = await fetch("/api/ai/market-summary", {
      headers: { "x-api-key": localStorage.getItem("stockquant_ai_key") || "" },
    });
    if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error); }
    const data = await resp.json();
    btn.textContent = "📋 切回模板";
    btn.dataset.mode = "ai";
    btn.classList.remove("loading");
    summaryEl.innerHTML = escapeHTML(data.text).replace(/\n/g, "<br>") +
      ' <span class="ai-generated-badge">Claude 生成 · ' + new Date(data.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) + '</span>';
  } catch (e) {
    btn.classList.remove("loading");
    btn.textContent = "🤖 AI 解读";
    toast("AI 解读失败: " + (e.message || "未知错误"));
  }
});

// AI 策略推荐
$("#btnAIStrategy")?.addEventListener("click", async function () {
  const btn = this;
  if (btn.classList.contains("loading")) return;
  const contentEl = $("#strategyRecommendContent");

  btn.classList.add("loading");
  btn.textContent = "⏳ 分析中...";
  try {
    const resp = await fetch("/api/ai/strategy-recommend", {
      headers: { "x-api-key": localStorage.getItem("stockquant_ai_key") || "" },
    });
    if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error); }
    const data = await resp.json();
    btn.classList.remove("loading");
    btn.textContent = "🔄 刷新推荐";

    // 渲染推荐结果
    let html = "";
    if (data.marketState) {
      html += `<div style="margin-bottom:10px;padding:8px 12px;background:rgba(99,102,241,.1);border-radius:8px;font-size:13px;">
        <b>市场状态:</b> ${escapeHTML(data.marketState)}
      </div>`;
    }
    if (data.marketInsight) {
      html += `<div style="margin-bottom:10px;font-size:13px;color:#c8cdf0;">${escapeHTML(data.marketInsight)}</div>`;
    }
    if (data.recommended && data.recommended.length > 0) {
      html += '<div style="display:grid;gap:8px;">';
      data.recommended.forEach(s => {
        const riskColor = s.riskLevel === "低" ? "#22c55e" : s.riskLevel === "中" ? "#fbbf24" : "#f87171";
        html += `<div style="padding:10px 12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <b style="color:#c8cdf0;">${escapeHTML(s.name)}</b>
            <span style="font-size:11px;color:${riskColor};">${escapeHTML(s.riskLevel || '')}风险</span>
          </div>
          <p style="font-size:12px;color:#8890b5;margin:0;">${escapeHTML(s.reason)}</p>
          <div style="margin-top:6px;font-size:11px;color:#5f6b8a;">
            置信度: ${s.confidence || '--'}% · ${escapeHTML(s.suitableFor || '')}
          </div>
        </div>`;
      });
      html += '</div>';
    }
    if (data.riskWarning) {
      html += `<div style="margin-top:10px;padding:8px 12px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:8px;font-size:12px;color:#fca5a5;">
        ⚠️ ${escapeHTML(data.riskWarning)}
      </div>`;
    }
    if (data.rawText) {
      html += `<div style="font-size:13px;color:#c8cdf0;line-height:1.6;">${escapeHTML(data.rawText).replace(/\n/g, '<br>')}</div>`;
    }
    contentEl.innerHTML = html || '<p style="color:#8890b5;">暂无推荐</p>';
  } catch (e) {
    btn.classList.remove("loading");
    btn.textContent = "🤖 获取推荐";
    toast("策略推荐失败: " + (e.message || "未知错误"));
  }
});

// 页面加载时显示策略推荐卡片
setTimeout(() => {
  const card = $("#strategyRecommend");
  if (card) card.style.display = "block";
}, 1000);

function renderBreadth(b) {
  const strip = $("#breadthStrip");
  strip.style.display = "";
  $("#breadthUp").textContent = b.up || 0;
  $("#breadthDown").textContent = b.down || 0;
  $("#breadthFlat").textContent = b.flat || 0;
  $("#breadthLimitUp").textContent = b.limitUp || 0;
  $("#breadthLimitDown").textContent = b.limitDown || 0;
  // 比例条: 红=涨 绿=跌 灰=平
  const total = b.total || 1;
  const upPct = (b.up / total * 100).toFixed(1);
  const downPct = (b.down / total * 100).toFixed(1);
  const flatPct = (b.flat / total * 100).toFixed(1);
  const bar = $("#breadthBar");
  bar.style.background = `linear-gradient(to right, #ef4444 0%, #ef4444 ${upPct}%, #e5e7eb ${upPct}%, #e5e7eb ${+upPct + +flatPct}%, #22c55e ${+upPct + +flatPct}%)`;
  bar.title = `涨 ${upPct}% · 跌 ${downPct}% · 平 ${flatPct}% · 广度 ${b.breadth}`;
}

function renderIndexCards(summary) {
  const cardsEl = $("#indexCards");
  const indexHints = {
    "上证指数": "上海交易所综合指数，代表大盘蓝筹",
    "深证成指": "深圳交易所成分指数，代表深市主力股",
    "沪深300": "A股最大的300家公司，代表市场核心资产",
    "创业板指": "创业板100只代表股，代表新兴成长企业",
    "科创50": "科创板50只龙头，代表硬科技公司",
    "中证500": "中等规模的500家公司，代表中小盘"
  };
  cardsEl.innerHTML = summary.indices.map(i => {
    const cls = i.changePct >= 0 ? "up" : "down";
    const sign = i.changePct >= 0 ? "+" : "";
    const hint = indexHints[i.name] || "";
    return `<div class="index-card ${cls}" data-code="${i.code}" data-name="${i.name}" title="${hint}">
      <div class="idx-name">${i.name}</div>
      <div class="idx-price">${i.price?.toFixed(2)}</div>
      <div class="idx-change ${cls}">${sign}${i.changePct?.toFixed(2)}%</div>
    </div>`;
  }).join("");
  cardsEl.querySelectorAll(".index-card").forEach(card => card.addEventListener("click", function() {
    loadIndexTrend(this.dataset.code, this.dataset.name);
    cardsEl.querySelectorAll(".index-card").forEach(c => c.classList.remove("selected"));
    this.classList.add("selected");
    // 同时显示K线图弹窗
    showKlineModal(this.dataset.code, this.dataset.name);
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
  // 交易段30s高频刷新, 非交易120s低频
  const interval = isTradingHours() ? 30000 : 120000;
  marketRefreshTimer = setInterval(async () => {
    try {
      const [summary, sectorFlow, conceptFlow, breadth] = await Promise.all([
        fetch("/api/market/summary").then(r => r.json()).catch(() => null),
        fetch("/api/market/sector-flow").then(r => r.json()).catch(() => []),
        fetch("/api/market/concept-flow").then(r => r.json()).catch(() => []),
        fetch("/api/market/breadth").then(r => r.json()).catch(() => null),
      ]);
      if (summary?.indices?.length) {
        updateLiveStatus(summary);
        updateWeatherBanner(summary);
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
      if (breadth && !breadth.error) renderBreadth(breadth);
      if (sectorFlow?.length) {
        renderSectorFlowLists(sectorFlow);
      }
      if (conceptFlow?.length) renderConceptFlow(conceptFlow);
    } catch(e) {}
  }, interval);
  TimerManager.register('marketRefresh', marketRefreshTimer, 'market');
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
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" },
        axisPointer: { type: "cross", lineStyle: { color: "rgba(255,255,255,.12)", type: "dashed" } } },
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
  } catch (e) { console.error("加载指数走势失败:", e); toast("加载指数走势失败"); } finally { indexTrendChart.hideLoading(); }
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

// ====================================================================
//  2. 个股分析
// ====================================================================
let stockKlineChart, stockMacdChart, stockRsiChart;

function initStockChart() {
  if (stockKlineChart) return;
  stockKlineChart = ChartManager.getChart("chartStockKline", "stock");
  stockMacdChart = ChartManager.getChart("chartStockMacd", "stock");
  stockRsiChart = ChartManager.getChart("chartStockRsi", "stock");
  ChartManager.manageResize(stockKlineChart);
  ChartManager.manageResize(stockMacdChart);
  ChartManager.manageResize(stockRsiChart);

  // K线指南展开/收起（替代内联onclick，CSP兼容）
  const guideToggle = $("#klineGuideToggle");
  if (guideToggle && !guideToggle._bound) {
    guideToggle._bound = true;
    guideToggle.addEventListener("click", () => {
      const content = guideToggle.nextElementSibling;
      if (content) content.style.display = content.style.display === "none" ? "block" : "none";
    });
  }
}

async function loadStockAnalysis() {
  console.log("[Stock] loadStockAnalysis called");
  if (!stockKlineChart) initStockChart();
  const code = $("#stockCode").value.trim() || "600519";
  const period = [...$$("#page-stock .tag")].find(t => t.classList.contains("active"))?.dataset?.period || 365;
  if (!stockKlineChart) { console.warn("[Stock] stockKlineChart is null, aborting"); return; }
  stockKlineChart.showLoading();
  try {
    const [indData, scrData, btData, sigData, analysisData, adviceData] = await Promise.all([
      fetch(`/api/indicators?code=${code}&days=${period}`).then(r => r.json()).catch(() => null),
      fetch(`/api/screen?code=${code}`).then(r => r.json()).catch(() => null),
      fetch(`/api/backtest?code=${code}&strategy=multiFactorStrategy&days=${period}`).then(r => r.json()).catch(() => null),
      fetch(`/api/signals/now?code=${code}`).then(r => r.json()).catch(() => null),
      fetch(`/api/stock/analysis/${code}`).then(r => r.json()).catch(() => null),
      fetch(`/api/advice/${code}`).then(r => r.json()).catch(() => null),
    ]);
    if (!indData || indData.error) { toast(indData?.error || "加载失败"); return; }

    if (scrData && !scrData.error) { generateStockInsight(scrData, indData); renderScoreStrip(scrData); }
    else { generateSimpleInsight(indData); $("#stockScore").style.display = "none"; }

    // 实时信号条
    updateSignalBar(sigData);

    // 进阶指标 (Phase 3)
    renderEnhancedMetrics(analysisData);

    // 仓位建议 (Phase 5)
    renderAdviceCard(adviceData);

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

    // 信号标记: 在K线图上显示买卖点 — 超大醒目标记
    const signalPoints = btData?.signalPoints || [];
    if (signalPoints.length) {
      const buyPoints = signalPoints.filter(p => p.type === "buy");
      const sellPoints = signalPoints.filter(p => p.type === "sell");
      const lastIdx = indData.dates.length - 1;
      if (buyPoints.length) {
        klineSeries.push({
          name: "买入信号", type: "scatter",
          data: buyPoints.map(p => {
            const isRecent = p.date === indData.dates[lastIdx] || p.date === indData.dates[lastIdx - 1];
            return { value: [p.date, p.price * 0.975], symbolSize: isRecent ? 28 : 16, itemStyle: { shadowBlur: isRecent ? 12 : 4, shadowColor: "rgba(239,68,68,0.7)" } };
          }),
          symbol: "pin",
          symbolRotate: 0,
          itemStyle: { color: "#ef4444" },
          label: { show: true, position: "bottom", formatter: "买", color: "#ef4444", fontSize: 11, fontWeight: 800 },
          emphasis: { itemStyle: { shadowBlur: 20, shadowColor: "rgba(239,68,68,0.9)" } },
        });
      }
      if (sellPoints.length) {
        klineSeries.push({
          name: "卖出信号", type: "scatter",
          data: sellPoints.map(p => {
            const isRecent = p.date === indData.dates[lastIdx] || p.date === indData.dates[lastIdx - 1];
            return { value: [p.date, p.price * 1.025], symbolSize: isRecent ? 28 : 16, itemStyle: { shadowBlur: isRecent ? 12 : 4, shadowColor: "rgba(34,197,94,0.7)" } };
          }),
          symbol: "pin",
          symbolRotate: 180,
          itemStyle: { color: "#22c55e" },
          label: { show: true, position: "top", formatter: "卖", color: "#22c55e", fontSize: 11, fontWeight: 800 },
          emphasis: { itemStyle: { shadowBlur: 20, shadowColor: "rgba(34,197,94,0.9)" } },
        });
      }
    }

    // 最新信号标记 (来自实时投票)
    let liveSignalMarkers = [];
    if (sigData && sigData.consensus && (sigData.consensus === "strong_buy" || sigData.consensus === "buy" || sigData.consensus === "sell" || sigData.consensus === "strong_sell")) {
      const lastDate = indData.dates[indData.dates.length - 1];
      const lastClose = indData.closes[indData.closes.length - 1];
      const isBuy = sigData.consensus === "strong_buy" || sigData.consensus === "buy";
      liveSignalMarkers.push({
        name: "实时信号", type: "scatter",
        data: [{ value: [lastDate, lastClose], symbolSize: 32 }],
        symbol: isBuy ? "arrow" : "arrow",
        symbolRotate: isBuy ? 0 : 180,
        symbolOffset: [0, isBuy ? 20 : -20],
        itemStyle: { color: isBuy ? "#ef4444" : "#22c55e", shadowBlur: 14, shadowColor: isBuy ? "rgba(239,68,68,0.8)" : "rgba(34,197,94,0.8)" },
        label: { show: true, position: isBuy ? "bottom" : "top", formatter: isBuy ? "🔥买入" : "📉卖出", color: isBuy ? "#ef4444" : "#22c55e", fontSize: 13, fontWeight: 800, distance: 8 },
        z: 10,
      });
    }

    stockKlineChart.setOption({
      backgroundColor: "transparent",
      grid: { left: 12, right: 16, top: 20, bottom: 60 },
      xAxis: { type: "category", data: indData.dates, axisLabel: { color: "#5f6b8a", fontSize: 11 }, axisLine: { lineStyle: { color: "rgba(255,255,255,.06)" } } },
      yAxis: { type: "value", scale: true, axisLabel: { color: "#5f6b8a", fontSize: 11 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      dataZoom: [
        { type: "inside", start: 50, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: "slider", start: 50, end: 100, height: 22, bottom: 6, borderColor: "rgba(255,255,255,.04)", backgroundColor: "rgba(15,19,48,.6)", dataBackground: { lineStyle: { color: "rgba(255,255,255,.06)" }, areaStyle: { color: "rgba(255,255,255,.03)" } }, selectedDataBackground: { lineStyle: { color: "#a78bfa" }, areaStyle: { color: "rgba(167,139,250,.1)" } }, handleStyle: { color: "#8890b5" }, textStyle: { color: "#5f6b8a" } },
      ],
      series: [...klineSeries, ...liveSignalMarkers],
      legend: { right: 16, top: 4, textStyle: { color: "#8890b5", fontSize: 11 } },
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" },
        axisPointer: { type: "cross", lineStyle: { color: "rgba(255,255,255,.15)", type: "dashed" }, crossStyle: { color: "rgba(255,255,255,.08)" } },
        formatter: ps => {
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
        tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" },
        axisPointer: { type: "cross", lineStyle: { color: "rgba(255,255,255,.12)", type: "dashed" } } },
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
  finally { try { stockKlineChart?.hideLoading(); } catch (_) {} }
}

function updateSignalBar(sig) {
  const bar = $("#signalBar");
  if (!sig || !sig.consensus) { bar.style.display = "none"; return; }
  bar.style.display = "flex";

  const config = {
    strong_buy:  { color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", icon: "🔥", text: "强烈看多" },
    buy:         { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", icon: "📈", text: "偏多" },
    sell:        { color: "#3b82f6", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.3)", icon: "📉", text: "偏空" },
    strong_sell: { color: "#22c55e", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.3)", icon: "⚠️", text: "强烈看空" },
    neutral:     { color: "#8890b5", bg: "rgba(136,144,181,0.08)", border: "rgba(136,144,181,0.2)", icon: "📊", text: "方向不明" },
  };
  const c = config[sig.consensus] || config.neutral;
  bar.style.background = c.bg;
  bar.style.border = `1px solid ${c.border}`;
  bar.style.color = c.color;
  bar.style.flexDirection = "column";
  bar.style.alignItems = "flex-start";
  bar.style.gap = "6px";

  $("#signalIcon").textContent = c.icon;
  $("#signalText").textContent = `当前信号：${c.text}`;

  // Build rich detail line
  const v = sig.votes || {};
  let detailHTML = `${v.buy || 0}买 ${v.sell || 0}卖 · ${sig.date || ""}`;
  if (sig.volRatio) {
    const volLabel = sig.volumeConfirmed ? "放量" : sig.volRatio < 0.7 ? "缩量" : "正常量";
    const volColor = sig.volumeConfirmed ? "#f87171" : sig.volRatio < 0.7 ? "#94a3b8" : "#8890b5";
    detailHTML += ` · 量比：<b style="color:${volColor}">${sig.volRatio}x (${volLabel})</b>`;
  }
  $("#signalDetail").innerHTML = detailHTML;

  // Add entry/exit levels if available
  let levelsHTML = "";
  if (sig.suggestedEntry) {
    const e = sig.suggestedEntry;
    levelsHTML += `<div style="font-size:12px;margin-top:2px;">
      <span style="color:#f59e0b;">🟡 建议入场：<b>¥${e.buyZone}</b></span>
      <span style="color:#3b82f6;margin-left:10px;">🔵 止损：<b>¥${e.stopLoss}</b></span>
      <span style="color:#f87171;margin-left:10px;">🔴 目标：<b>¥${e.targetPrice}</b></span>
      <span style="color:#8890b5;margin-left:10px;">盈亏比：<b>1:${e.riskReward}</b></span>
    </div>`;
  }
  if (sig.levels) {
    const supp = (sig.levels.support || []).map(l => `<span style="color:#3b82f6;">${l.label} ¥${l.level}</span>`).join(" · ");
    const res = (sig.levels.resistance || []).map(l => `<span style="color:#f87171;">${l.label} ¥${l.level}</span>`).join(" · ");
    levelsHTML += `<div style="font-size:11px;margin-top:2px;color:#8890b5;">
      <span>支撑：${supp || "—"}</span><br>
      <span>阻力：${res || "—"}</span>
    </div>`;
  }
  // Append or update the levels section
  let levelsEl = bar.querySelector(".signal-levels");
  if (!levelsEl) {
    levelsEl = document.createElement("div");
    levelsEl.className = "signal-levels";
    bar.appendChild(levelsEl);
  }
  levelsEl.innerHTML = levelsHTML;
}

// Phase 3: Enhanced metrics card + AI stock analysis
function renderEnhancedMetrics(ana) {
  const container = $("#enhancedMetrics");
  if (!ana || ana.error) { container.style.display = "none"; return; }
  container.style.display = "block";
  // 显示 AI 深度分析按钮
  const aiBtn = $("#btnAIStockAnalysis");
  if (aiBtn) aiBtn.style.display = "inline-block";

  // 52周位置进度条
  const f52 = ana.fiftyTwoWeek;
  if (f52 && f52.high && f52.low && ana.price) {
    const pct52w = ((ana.price - f52.low) / (f52.high - f52.low) * 100);
    const clampedPct = Math.max(0, Math.min(100, pct52w));
    const bar = $("#em52wBar");
    bar.style.width = clampedPct + "%";
    // Color gradient: low=green(cheap), mid=yellow, high=red(expensive)
    if (clampedPct < 30) bar.style.background = "#4ade80";
    else if (clampedPct < 70) bar.style.background = "#fbbf24";
    else bar.style.background = "#f87171";
    $("#em52wVal").textContent = clampedPct.toFixed(0) + "% · 距高" + f52.distFromHigh + "% 距低" + f52.distFromLow + "%";
    $("#em52wVal").className = "em-val " + (clampedPct < 30 ? "good" : clampedPct < 70 ? "warn" : "bad");
  }

  // 波动率分位
  const vol = ana.volatility;
  if (vol != null) {
    $("#emVol").textContent = (vol.current != null ? vol.current + "%" : "--") + " · 分位" + (vol.percentile != null ? vol.percentile + "%" : "--");
    $("#emVol").className = "em-val " + (vol.percentile > 80 ? "bad" : vol.percentile < 30 ? "good" : "warn");
  }

  // 量比
  const v = ana.volume;
  if (v && v.volRatio != null) {
    const vrLabel = v.volRatio > 1.2 ? "放量" : v.volRatio < 0.7 ? "缩量" : "正常";
    const vrColor = v.volRatio > 1.2 ? "good" : v.volRatio < 0.7 ? "bad" : "warn";
    $("#emVolRatio").textContent = v.volRatio + "x " + vrLabel;
    $("#emVolRatio").className = "em-val " + vrColor;
  }

  // Beta
  const beta = ana.risk?.beta;
  if (beta != null) {
    const betaLabel = beta > 1.3 ? "高波动" : beta > 0.8 ? "与大盘同步" : "低波动/防御";
    const betaColor = beta > 1.3 ? "bad" : beta > 0.8 ? "warn" : "good";
    $("#emBeta").textContent = beta.toFixed(2) + " · " + betaLabel;
    $("#emBeta").className = "em-val " + betaColor;
  }
}

// AI stock analysis handler
$("#btnAIStockAnalysis")?.addEventListener("click", async function() {
  const code = $("#stockCode").value.trim() || "600519";
  const btn = this;
  btn.textContent = "⏳ 分析中...";
  btn.classList.add("loading");
  const textEl = $("#aiStockAnalysisText");
  try {
    const resp = await fetch("/api/ai/stock-analysis/" + code, { headers: { "x-api-key": localStorage.getItem("stockquant_ai_key") || "" } });
    const data = await resp.json();
    if (data.error) { toast(data.error); return; }
    textEl.style.display = "block";
    textEl.innerHTML = "<b>🤖 AI 深度分析</b><br><br>" + data.text.replace(/\n/g, "<br>");
  } catch (e) { toast("AI 分析失败: " + e.message); }
  finally { btn.textContent = "🤖 AI 深度分析"; btn.classList.remove("loading"); }
});

// Phase 5: Position advice card rendering
function renderAdviceCard(adv) {
  const card = $("#adviceCard");
  if (!adv || adv.error) { card.style.display = "none"; return; }
  card.style.display = "block";
  // 显示 AI 仓位分析按钮
  const aiBtn = $("#btnAIAdvice");
  if (aiBtn) aiBtn.style.display = "inline-block";

  const actionLabels = {
    build: { label: "建仓", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
    add: { label: "加仓", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
    hold: { label: "持仓", color: "#94a3b8", bg: "rgba(148,163,184,0.08)" },
    reduce: { label: "减仓", color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
    clear: { label: "清仓", color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
  };
  const al = actionLabels[adv.action] || actionLabels.hold;

  const actionEl = $("#adviceAction");
  actionEl.textContent = al.label;
  actionEl.className = "advice-action " + adv.action;
  actionEl.style.color = al.color;
  actionEl.style.background = al.bg;
  actionEl.style.borderRadius = "10px";
  actionEl.style.padding = "8px 0";

  const pctEl = $("#advicePct");
  pctEl.textContent = "建议仓位: " + (adv.suggestedPct >= 0 ? "+" : "") + (adv.suggestedPct * 100).toFixed(0) + "%";
  pctEl.style.color = al.color;

  $("#adviceReason").textContent = adv.reasoning || "";
  $("#adviceConfidence").textContent = "置信度 " + (adv.confidence || 0) + "%";
}

// AI position advice handler
$("#btnAIAdvice")?.addEventListener("click", async function() {
  const code = $("#stockCode").value.trim() || "600519";
  const btn = this;
  btn.textContent = "⏳ 分析中...";
  btn.classList.add("loading");
  const textEl = $("#aiAdviceText");
  try {
    const resp = await fetch("/api/ai/advice/" + code, { headers: { "x-api-key": localStorage.getItem("stockquant_ai_key") || "" } });
    const data = await resp.json();
    if (data.error) { toast(data.error); return; }
    textEl.style.display = "block";
    textEl.innerHTML = "<b>🤖 AI 仓位分析</b><br><br>" + data.text.replace(/\n/g, "<br>");
  } catch (e) { toast("AI 分析失败: " + e.message); }
  finally { btn.textContent = "🤖 AI 仓位分析"; btn.classList.remove("loading"); }
});

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

// 个股页面自动刷新
let stockRefreshTimer = null;
$("#stockAutoRefresh")?.addEventListener("change", function() {
  if (this.checked) {
    stockRefreshTimer = setInterval(() => {
      if ($("#stockAutoRefresh")?.checked && document.querySelector("#page-stock.active")) {
        loadStockAnalysis();
      }
    }, 30000);
    TimerManager.register('stockRefresh', stockRefreshTimer, 'stock');
  } else {
    clearInterval(stockRefreshTimer);
    TimerManager.clear('stockRefresh');
  }
});

// ====================================================================
//  3. 策略回测
// ====================================================================
let equityChart, cmpBarChart;
function initBTChart() {
  if (!equityChart) { equityChart = ChartManager.getChart("chartEquity", "backtest"); ChartManager.manageResize(equityChart); }

  // 绑定回测页面按钮事件（替代内联onclick，CSP兼容）
  const toggleBtn = $("#btToggleMore");
  const lessBtn = $("#btLessMetrics");
  const moreDiv = $("#btMoreMetrics");
  if (toggleBtn && !toggleBtn._bound) {
    toggleBtn._bound = true;
    toggleBtn.addEventListener("click", () => {
      toggleBtn.style.display = "none";
      if (moreDiv) moreDiv.style.display = "grid";
      if (lessBtn) lessBtn.style.display = "inline-block";
    });
  }
  if (lessBtn && !lessBtn._bound) {
    lessBtn._bound = true;
    lessBtn.addEventListener("click", () => {
      lessBtn.style.display = "none";
      if (moreDiv) moreDiv.style.display = "none";
      if (toggleBtn) toggleBtn.style.display = "inline-block";
    });
  }
}

function generateBTInsight(data) {
  const el = $("#btInsight");
  const icon = $("#btInsightIcon");
  const title = $("#btInsightTitle");
  const text = $("#btInsightText");
  el.style.display = "";

  const ret = data.totalReturn || 0;
  const bench = data.benchmarkReturn || 0;
  const winRate = data.winRate || 0;
  const sharpe = data.sharpe || 0;
  const dd = data.maxDrawdown || 0;
  const trades = data.totalTrades || 0;

  // 当前策略状态
  const sigPoints = data.signalPoints || [];
  const lastSig = sigPoints[sigPoints.length - 1];
  const eqCurve = data.equityCurve || [];
  const lastEq = eqCurve[eqCurve.length - 1];
  let posStatus = "";
  if (lastSig) {
    const today = new Date();
    const sigDate = new Date(lastSig.date);
    const daysAgo = Math.floor((today - sigDate) / (1000 * 60 * 60 * 24));
    const isHolding = lastSig.type === "buy";
    posStatus = `<div style="margin-top:8px;padding:8px 12px;border-radius:8px;font-size:13px;${isHolding ? 'background:rgba(239,68,68,0.1);color:#f87171;border:1px solid rgba(239,68,68,0.2)' : 'background:rgba(136,144,181,0.08);color:#8890b5;border:1px solid rgba(136,144,181,0.15)'}">
      📍 <b>当前状态：${isHolding ? '🔴 持仓中' : '⚪ 空仓等待'}</b> · 最后信号：${lastSig.date}（${daysAgo}天前 · ${isHolding ? '买入' : '卖出'}）
      ${lastEq ? ' · 最新权益：¥' + lastEq.equity.toLocaleString() : ''}
    </div>`;
  }

  let grade, gradeCls, iconStr, insightTitle, insightText;

  if (ret > 0 && ret > bench && sharpe > 1 && winRate > 50) {
    grade = "A"; gradeCls = "grade-a"; iconStr = "🏆";
    insightTitle = "优秀！策略显著跑赢市场";
    insightText = `这个策略在过去的表现相当好：总收益<b>${ret}%</b>（买入不动才${bench}%），赚钱很稳（夏普${sharpe}），${trades}次买卖中${winRate}%都在赚钱。就像请了个靠谱的交易员——该买的时候买，该卖的时候卖，不乱折腾。`;
  } else if (ret > 0 && sharpe > 0.5 && winRate > 40) {
    grade = "B"; gradeCls = "grade-b"; iconStr = "👍";
    insightTitle = "良好，策略有一定优势";
    insightText = `有赚钱能力（总收益${ret}%），但${ret < bench ? '暂时跑不赢最简单的买入持有策略（持有不动赚了' + bench + '%），说明买卖时机还有优化空间' : '跑赢了买入持有，表现不错'}。夏普${sharpe}说明收益还算稳定，回撤${dd}%。可以用AI进化器进一步微调参数。`;
  } else if (ret > -10 && trades > 0) {
    grade = "C"; gradeCls = "grade-c"; iconStr = "💡";
    insightTitle = "一般，策略需要改进";
    insightText = `收益${ret}%，胜率${winRate}%——${ret < 0 ? '这个策略在回测期间是亏钱的。可能是策略本身不适合这只股票，也可能是参数设置不当' : '勉强有点收益但不太稳定'}。最大回撤${dd}%意味着最惨时亏过这么多。建议换策略试试，或用AI进化器优化参数。`;
  } else {
    grade = "D"; gradeCls = "grade-d"; iconStr = "⚠️";
    insightTitle = "不佳，不建议使用此策略";
    insightText = trades === 0 ? "这个策略在回测期间<b>一笔交易都没产生</b>——说明策略信号太严格了，或者根本不匹配这只股票的走势特征。换一种策略试试。" : `收益${ret}%，最大回撤${dd}%。${trades}笔交易大部分亏钱。这个策略和这只股票不太合拍，建议换策略或换标的。`;
  }

  el.className = "bt-insight " + gradeCls;
  icon.textContent = iconStr;
  title.textContent = `[${grade}级] ${insightTitle}`;
  text.innerHTML = insightText + (posStatus || "");

  // AI 深度解读按钮
  const aiBTBtn = $("#btnAIExplainBT");
  if (aiBTBtn) {
    aiBTBtn.style.display = aiConfigured ? "inline-flex" : "none";
    aiBTBtn.classList.remove("loading");
    aiBTBtn.textContent = "🤖 AI 深度解读";
    aiBTBtn.dataset.mode = "";
    // Store backtest data for AI use
    aiBTBtn._btData = {
      stockName: data.stockName || "",
      totalReturn: ret,
      annualReturn: data.annualReturn,
      maxDrawdown: dd,
      winRate,
      sharpeRatio: sharpe,
      totalTrades: trades,
      benchmarkReturn: bench,
    };
  }
}

// AI 回测解读 按钮
$("#btnAIExplainBT")?.addEventListener("click", async function () {
  const btn = this;
  if (btn.classList.contains("loading")) return;
  const btData = btn._btData;
  if (!btData) return;

  const textEl = $("#btInsightText");

  // Toggle back
  if (btn.dataset.mode === "ai") {
    btn.textContent = "🤖 AI 深度解读";
    btn.dataset.mode = "";
    btn.classList.remove("loading");
    generateBTInsight(window._lastBTResult || {});
    return;
  }

  btn.classList.add("loading");
  btn.textContent = "⏳ AI 分析中...";
  try {
    const resp = await fetch("/api/ai/explain-backtest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": localStorage.getItem("stockquant_ai_key") || "",
      },
      body: JSON.stringify({ backtestResult: btData }),
    });
    if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error); }
    const data = await resp.json();
    btn.textContent = "📋 切回模板";
    btn.dataset.mode = "ai";
    btn.classList.remove("loading");
    const posStatus = textEl.innerHTML.match(/<div style="margin-top:8px.*?<\/div>/)?.[0] || "";
    textEl.innerHTML = data.text.replace(/\n/g, "<br>") +
      ' <span class="ai-generated-badge">Claude 解读</span>' +
      (posStatus ? "<br>" + posStatus : "");
  } catch (e) {
    btn.classList.remove("loading");
    btn.textContent = "🤖 AI 深度解读";
    toast("AI 解读失败: " + (e.message || "未知错误"));
  }
});

// 回测周期快捷按钮
document.querySelectorAll("#page-backtest .bt-period-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#page-backtest .bt-period-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    // 触发回测
    $("#btnBacktest")?.click();
  });
});

$("#btnBacktest")?.addEventListener("click", async () => {
  const code = $("#btCode").value.trim() || "600519";
  const btn = $("#btnBacktest");
  btn.textContent = "⏳ 回测中..."; btn.disabled = true;

  // 读取周期按钮
  const activePeriod = document.querySelector("#page-backtest .bt-period-btn.active");
  const days = activePeriod?.dataset.days || "365";

  try {
    const strategy = $("#btStrategy").value;
    const data = await fetch(`/api/backtest?code=${code}&strategy=${strategy}&days=${days}`).then(r => r.json());
    if (data.error) { toast(data.error); return; }

    // 白话解读
    window._lastBTResult = data;
    generateBTInsight(data);

    // 核心指标
    const color = v => v >= 0 ? "#f87171" : "#4ade80";
    $("#btRet").textContent = data.totalReturn + "%";
    $("#btRet").style.color = color(data.totalReturn);
    $("#btBench").textContent = (data.benchmarkReturn || 0) + "%";
    $("#btBench").style.color = color(data.benchmarkReturn || 0);
    $("#btDD").textContent = data.maxDrawdown + "%";
    $("#btSharpe").textContent = data.sharpe + (data.calmar ? " / Calmar " + data.calmar : "");
    $("#btTrades").textContent = data.totalTrades;
    $("#btWinRate").textContent = data.winRate + "%";

    // 高级指标 (折叠)
    $("#btAnnual").textContent = (data.annualReturn || 0) + "%";
    $("#btAnnual").style.color = color(data.annualReturn || 0);
    const winLoss = data.avgLoss && data.avgLoss !== 0 ? Math.abs(data.avgWin / data.avgLoss).toFixed(1) : "--";
    $("#btWinLoss").textContent = winLoss !== "--" ? winLoss + " : 1" : "--";
    $("#btAvgPnl").textContent = data.avgPnl + "%";
    $("#btAvgPnl").style.color = color(data.avgPnl);
    $("#btHoldDays").textContent = (data.avgHoldDays || 0) + "天";
    $("#btDDPeriod").textContent = data.ddStart && data.ddEnd ? data.ddStart + "~" + data.ddEnd : "--";
    $("#btCommission").textContent = "¥" + (data.totalCommission || 0).toFixed(0);

    // 显示"更多指标"按钮
    const toggleBtn = $("#btToggleMore");
    const lessBtn = $("#btLessMetrics");
    const moreDiv = $("#btMoreMetrics");
    if (toggleBtn) toggleBtn.style.display = "inline-block";
    if (lessBtn) lessBtn.style.display = "none";
    if (moreDiv) moreDiv.style.display = "none";

    // 权益曲线
    if (!equityChart) initBTChart();
    const benchFinal = data.initialCapital * (1 + (data.benchmarkReturn || 0) / 100);
    const benchLine = data.equityCurve.map((e, i) => {
      const progress = data.equityCurve.length > 1 ? i / (data.equityCurve.length - 1) : 0;
      return +(data.initialCapital + (benchFinal - data.initialCapital) * progress).toFixed(0);
    });

    const series = [{
      name: "策略权益", type: "line", data: data.equityCurve.map(e => e.equity),
      lineStyle: { color: "#818cf8", width: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(99,102,241,.25)" }, { offset: 1, color: "rgba(99,102,241,0)" }]) },
      symbol: "none",
      markPoint: {
        symbol: "pin",
        symbolSize: 48,
        label: { fontSize: 10, fontWeight: 700, color: "#fff" },
        itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.4)" },
        data: [
          ...(data.signalPoints || []).filter(p => p.type === "buy").slice(0, 30).map(p => {
            const eq = data.equityCurve.find(e => e.date === p.date);
            return { coord: [p.date, eq ? eq.equity : 0], value: "买", itemStyle: { color: "#ef4444" } };
          }),
          ...(data.signalPoints || []).filter(p => p.type === "sell").slice(0, 30).map(p => {
            const eq = data.equityCurve.find(e => e.date === p.date);
            return { coord: [p.date, eq ? eq.equity : 0], value: "卖", itemStyle: { color: "#22c55e" } };
          }),
        ],
        emphasis: { itemStyle: { shadowBlur: 16, shadowColor: "rgba(0,0,0,0.6)" } },
      },
    }, {
      name: "买入持有", type: "line", data: benchLine,
      lineStyle: { color: "#fbbf24", width: 1.5, type: "dashed" },
      symbol: "none",
    }];

    equityChart.setOption({
      backgroundColor: "transparent", grid: { left: 14, right: 16, top: 30, bottom: 30 },
      legend: { right: 16, top: 4, textStyle: { color: "#8890b5", fontSize: 11 } },
      xAxis: { type: "category", data: data.equityCurve.map(e => e.date), axisLabel: { color: "#5f6b8a", fontSize: 11 } },
      yAxis: { axisLabel: { color: "#5f6b8a", fontSize: 11, formatter: v => "¥" + (v / 10000).toFixed(0) + "万" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" },
        axisPointer: { type: "cross", lineStyle: { color: "rgba(255,255,255,.12)", type: "dashed" } } },
      series,
    }, true);

    // 交易明细 — 白话化
    const trades = data.trades || [];
    if (trades.length) {
      const winners = trades.filter(t => t.pnlPct > 0).length;
      const avgWin = trades.reduce((s, t) => s + (t.pnlPct > 0 ? t.pnlPct : 0), 0) / winners || 0;
      const bestTrade = trades.reduce((a, b) => (b.pnlPct || 0) > (a.pnlPct || 0) ? b : a, trades[0]);
      const worstTrade = trades.reduce((a, b) => (b.pnlPct || 0) < (a.pnlPct || 0) ? b : a, trades[0]);

      $("#btTradeList").innerHTML = `
        <h3 style="margin-bottom:4px;color:#c8cdf0;">交易明细</h3>
        <div class="plain-explain" style="margin-bottom:8px;">
          💬 ${trades.length}笔交易，${winners}笔赚钱（胜率${(winners/trades.length*100).toFixed(0)}%），平均每笔赚<b style="color:${avgWin>=0?'#f87171':'#4ade80'}">${avgWin>=0?'+':''}${avgWin.toFixed(1)}%</b>。
          最好一笔：${bestTrade?.entryDate}→${bestTrade?.exitDate} 赚了<b style="color:#f87171">+${bestTrade?.pnlPct}%</b>；
          最差一笔：${worstTrade?.entryDate}→${worstTrade?.exitDate} 亏了<b style="color:#4ade80">${worstTrade?.pnlPct}%</b>。
        </div>
        ${trades.map(t =>
          `<div class="bt-trade">
            <span style="min-width:200px;">📅 ${t.entryDate} → ${t.exitDate}</span>
            <span>买入 ${t.entryPrice?.toFixed(2)} → 卖出 ${t.exitPrice?.toFixed(2)} | ${t.shares}股</span>
            <span class="${t.pnlPct>=0?'profit':'loss'}" style="font-weight:700;margin-left:auto;">
              ${t.pnlPct>=0?'🟢 赚 +':'🔴 亏 '}${Math.abs(t.pnlPct)}% ${t.pnl>0?'（+¥'+t.pnl.toFixed(0)+'）':'（-¥'+Math.abs(t.pnl).toFixed(0)+'）'}
            </span>
          </div>`
        ).join("")}`;
    } else {
      $("#btTradeList").innerHTML = '<h3 style="margin-bottom:8px;color:#c8cdf0;">交易明细</h3><div class="plain-explain">这个策略在回测期间没有产生任何交易信号——就像一个人站在场边，一场比赛都没上场。</div>';
    }
  } catch (e) { toast("回测失败: " + e.message); }
  finally { btn.textContent = "▶ 运行回测"; btn.disabled = false; }
});
$("#btCode")?.addEventListener("keydown", e => { if (e.key === "Enter") $("#btnBacktest").click(); });

// ====================================================================
//  4. 策略对比
// ====================================================================
// 对比周期快捷按钮
document.querySelectorAll("#page-compare .cmp-period-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#page-compare .cmp-period-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    $("#btnCompare")?.click();
  });
});

// 策略白话解释映射
const STRATEGY_PLAIN = {
  maCrossStrategy: { icon: "📈", explain: "快线穿慢线就买卖。适合趋势行情，震荡市容易失误。" },
  macdStrategy: { icon: "🔄", explain: "DIF穿DEA触发。反应比均线快，适合捕捉转折点。" },
  rsiStrategy: { icon: "📊", explain: "超卖区买、超买区卖。适合震荡市抄底逃顶。" },
  bollStrategy: { icon: "〰️", explain: "触下轨买、触上轨卖。适合波动收敛后的突破。" },
  multiFactorStrategy: { icon: "🤖", explain: "三个指标投票决定。比单一策略更稳健。" },
  trendFollowingStrategy: { icon: "🏄", explain: "站上均线就持有。牛市赚大，震荡市来回打脸。" },
  breakoutStrategy: { icon: "🚀", explain: "突破高点就追。强趋势股效果好，假突破会亏。" },
};

$("#btnCompare")?.addEventListener("click", async () => {
  const code = $("#cmpCode").value.trim() || "600519";
  const btn = $("#btnCompare"); btn.textContent = "⏳ 对比中..."; btn.disabled = true;

  // 读取周期
  const activePeriod = document.querySelector("#page-compare .cmp-period-btn.active");
  const days = activePeriod?.dataset.days || "365";

  try {
    const data = await fetch(`/api/compare?code=${code}&days=${days}`).then(r => r.json());
    if (data.error) { toast(data.error); return; }

    const entries = Object.entries(data.results);
    // 按总收益排名
    entries.sort((a, b) => (b[1].totalReturn || 0) - (a[1].totalReturn || 0));
    const best = entries[0];
    const bestName = best[1].strategy;
    const bestRet = best[1].totalReturn || 0;
    const bestSharpe = best[1].sharpe || 0;
    const worst = entries[entries.length - 1];
    const worstRet = worst[1].totalReturn || 0;

    // 白话解读
    const cmpInsight = $("#cmpInsight");
    cmpInsight.style.display = "";
    $("#cmpInsightTitle").textContent = `最佳策略：${bestName}`;

    const rankSummary = entries.slice(0, 3).map((e, i) =>
      `${['🥇','🥈','🥉'][i]} <b>${e[1].strategy}</b>(${e[1].totalReturn>=0?'+':''}${e[1].totalReturn}%)`
    ).join(" · ");

    if (bestRet > 0) {
      const diff = bestRet - worstRet;
      $("#cmpInsightText").innerHTML =
        `这只股票更适合<b>${bestName}</b>——赚了<b style="color:#f87171">+${bestRet}%</b>（夏普${bestSharpe}），而表现最差的策略亏了${worstRet}%，差距高达${diff.toFixed(0)}个百分点。<br>
        <span style="font-size:11px;color:#5f6b8a;">前三名：${rankSummary}</span>`;
    } else {
      $("#cmpInsightText").innerHTML =
        `很遗憾，所有7种策略在这只股票上都亏了钱。表现相对最好的是<b>${bestName}</b>（仅亏${bestRet}%），说明${code}这段时间确实不好做。<br>
        <span style="font-size:11px;color:#5f6b8a;">换个股票试试？或者等市场好转再用策略。</span>`;
    }

    // 条形图
    if (!cmpBarChart) {
      cmpBarChart = ChartManager.getChart("chartCmpBar", "compare");
      ChartManager.manageResize(cmpBarChart);
    }
    cmpBarChart.setOption({
      backgroundColor: "transparent",
      title: { text: "策略收益对比", left: 10, top: 10, textStyle: { color: "#c8cdf0", fontSize: 13, fontWeight: 600 } },
      grid: { left: 100, right: 60, top: 50, bottom: 28 },
      xAxis: { type: "value", axisLabel: { color: "#5f6b8a", fontSize: 10, formatter: v => v + "%" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      yAxis: { type: "category", data: entries.map(([, v]) => v.strategy), axisLabel: { color: "#8890b5", fontSize: 11 }, inverse: true },
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" },
        formatter: ps => {
          const v = entries[ps[0].dataIndex][1];
          const p = STRATEGY_PLAIN[entries[ps[0].dataIndex][0]] || {};
          return `<b>${v.strategy}</b> ${p.icon||''}<br/>${p.explain||''}<br/>收益: ${v.totalReturn}% | 夏普: ${v.sharpe}<br/>回撤: ${v.maxDrawdown}% | 胜率: ${v.winRate}%<br/>交易: ${v.totalTrades}次`;
        }
      },
      series: [{ type: "bar", barMaxWidth: 20,
        data: entries.map(([, v], i) => ({
          value: v.totalReturn || 0,
          itemStyle: { color: i === 0 ? "#fbbf24" : (v.totalReturn >= 0 ? "#f87171" : "#4ade80"), borderRadius: v.totalReturn >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] },
        })),
        label: { show: true, position: "right", color: "#8890b5", fontSize: 10, formatter: "{c}%" },
      }],
    }, true);

    // 卡片 — 带白话解释
    $("#cmpResults").innerHTML = entries.map(([k, v], i) => {
      const good = v.totalReturn >= 0;
      const bestCls = i === 0 ? " best" : "";
      const p = STRATEGY_PLAIN[k] || {};
      const verdict = v.totalReturn > 10 ? "强烈推荐" : v.totalReturn > 0 ? "可考虑" : v.totalReturn > -10 ? "需改进" : "不推荐";
      const verdictColor = v.totalReturn > 10 ? "#f87171" : v.totalReturn > 0 ? "#f59e0b" : v.totalReturn > -10 ? "#3b82f6" : "#6b7280";
      return `<div class="cmp-card ${good ? 'good' : 'bad'}${bestCls}" title="${p.explain||''}">
        <h4>${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : ''}${p.icon||'📊'} ${v.strategy}
          <span style="font-size:10px;color:${verdictColor};float:right;">${verdict}</span>
        </h4>
        <div class="val">收益: <b style="color:${good?'#f87171':'#4ade80'}">${v.totalReturn>=0?'+':''}${v.totalReturn}%</b></div>
        <div class="val">夏普: ${v.sharpe} · 回撤: ${v.maxDrawdown}%</div>
        <div class="val">交易${v.totalTrades}次 · 胜率${v.winRate}%</div>
        <div style="font-size:10px;color:#5f6b8a;margin-top:3px;">${p.explain||''}</div>
      </div>`;
    }).join("");
  } catch (e) { toast("对比失败: " + e.message); }
  finally { btn.textContent = "▶ 对比所有策略"; btn.disabled = false; }
});
$("#cmpCode")?.addEventListener("keydown", e => { if (e.key === "Enter") $("#btnCompare").click(); });

// ====================================================================
//  5. 资金流向 — 实时版
// ====================================================================
let ffDailyChart, ffVWAPChart, ffRtChart, ffLiveTimer;

function initFFChart() {
  if (ffDailyChart) return;
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
  if (!ffRtChart && !$("#chartFFRealtime")) return; // 旧版HTML无此元素
  if (!ffRtChart) ffRtChart = ChartManager.getChart("chartFFRealtime", "fundflow");
  try {
    const resp = await fetch(`/api/fundflow/rtchart?code=${code}`);
    const data = await resp.json();
    if (!data.candles?.length) {
      const st = $("#ffRtStatus"); if (st) st.textContent = "暂无分钟数据";
      ffRtChart?.setOption({
        title: { text: "实时K线 + 资金流", left: 16, top: 10, textStyle: { color: "#8890b5", fontSize: 13 } },
        graphic: [{ type: "text", left: "center", top: "center", style: { text: "分钟K线数据暂不可用\n(请确认是否交易日)", fill: "#5f6b8a", fontSize: 13, textAlign: "center" } }],
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
    const upColor = "#f87171", downColor = "#4ade80";
    const priceChange = prices.length >= 2 ? prices[prices.length - 1] - prices[0] : 0;
    const lineColor = priceChange >= 0 ? upColor : downColor;

    // 主力资金颜色
    const flowColors = mainFlows.map(v => v >= 0 ? "rgba(248,113,113,0.45)" : "rgba(74,222,128,0.45)");
    const flowBorders = mainFlows.map(v => v >= 0 ? "#f87171" : "#4ade80");

    ffRtChart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(15,18,40,0.95)",
        borderColor: "#2a2d3e",
        textStyle: { color: "#e0e4f0", fontSize: 12 },
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
          axisLabel: { color: "#5f6b8a", fontSize: 10, interval: Math.max(1, Math.floor(dates.length / 6)) },
          axisTick: { show: false } },
        { type: "category", data: dates, gridIndex: 1,
          axisLine: { lineStyle: { color: "#2a2d3e" } },
          axisLabel: { show: false }, axisTick: { show: false } },
        { type: "category", data: dates, gridIndex: 2,
          axisLine: { lineStyle: { color: "#2a2d3e" } },
          axisLabel: { color: "#5f6b8a", fontSize: 9, interval: Math.max(1, Math.floor(dates.length / 4)) } },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, scale: true,
          splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } },
          axisLabel: { color: "#8890b5", fontSize: 10, formatter: v => v.toFixed(0) } },
        { type: "value", gridIndex: 1,
          splitLine: { show: false },
          axisLabel: { color: "#5f6b8a", fontSize: 9, formatter: v => (v / 1e4).toFixed(0) + "万" } },
        { type: "value", gridIndex: 2,
          splitLine: { show: false },
          axisLabel: { color: "#5f6b8a", fontSize: 9, formatter: v => (v / 1e6).toFixed(1) + "M" } },
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
    const chgColor = quantData.change >= 0 ? "#f87171" : "#4ade80";
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
        `<div class="signal-item"><span style="color:#5f6b8a;min-width:80px">${s.date}</span><span class="signal-badge ${s.direction}">${s.direction==="buy"?"大单买入":"大单卖出"}</span><span style="color:#8890b5">价格 <b>${s.price?.toFixed(2)}</b></span><span style="color:#5f6b8a;font-size:12px">${s.intensity==="heavy"?"大幅放量":"温和放量"} · ${s.confidence==="high"?"高确信":"中确信"}</span></div>`
      ).join("");
    } else {
      $("#ffSignalList").innerHTML = `<div class="section-title">🔔 近期大单交易信号</div><div style="padding:16px;color:#5f6b8a;text-align:center">近20日未检测到显著大单信号</div>`;
    }

    // 图表
    const dayFlow = quantData.mergedFlow.slice(-40);
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
        { name: "大资金", type: "bar", stack: "flow", data: dayFlow.map(d => (d.main || 0)), itemStyle: { color: "#6366f1", borderRadius: [0, 0, 0, 0] }, emphasis: { focus: "series" } },
        { name: "散户", type: "bar", stack: "flow", data: dayFlow.map(d => d.retail || 0), itemStyle: { color: "rgba(148,163,184,.5)", borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "series" } },
      ],
    }, true);

    if (quantData.indicators?.vwap?.length) {
      const indSlice = 60;
      const indDates = quantData.mergedFlow.slice(-indSlice).map(d => d.date.slice(5));
      ffVWAPChart.setOption({
        backgroundColor: "transparent",
        title: { text: "多空分界线 (VWAP) + 买卖力量 (OFI)", left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14, fontWeight: 600 } },
        grid: { left: 12, right: 60, top: 50, bottom: 35 },
        xAxis: { type: "category", data: indDates, axisLabel: { color: "#5f6b8a", fontSize: 11, rotate: 30 } },
        yAxis: [
          { type: "value", axisLabel: { color: "#5f6b8a", fontSize: 11, formatter: v => v.toFixed(0) }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
          { type: "value", min: -100, max: 100, axisLabel: { color: "#5f6b8a", fontSize: 11, formatter: v => v + "%" }, splitLine: { show: false } },
        ],
        tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" },
        axisPointer: { type: "cross", lineStyle: { color: "rgba(255,255,255,.12)", type: "dashed" } } },
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
    freshnessBadge = `<span style="font-size:10px;background:rgba(74,222,128,0.15);color:#4ade80;padding:2px 6px;border-radius:3px;margin-left:4px;" title="来自东方财富实时分钟数据">● 实时</span>`;
  } else if (isRealDaily) {
    freshnessBadge = `<span style="font-size:10px;background:rgba(250,204,21,0.15);color:#facc15;padding:2px 6px;border-radius:3px;margin-left:4px;" title="日级数据来自东方财富API，分钟数据暂不可用(可能已收盘)">● 日级</span>`;
  } else {
    freshnessBadge = `<span style="font-size:10px;background:rgba(148,163,184,0.12);color:#94a3b8;padding:2px 6px;border-radius:3px;margin-left:4px;" title="东方财富API暂不可用，使用K线估算数据">● 估算</span>`;
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
      <div class="flow-rate" style="font-size:20px;color:#8890b5;">${liveData.timestamp || '--:--:--'}${freshnessBadge}</div>
      <div class="flow-label"><span class="live-dot"></span> 实时更新</div>
    </div>
    <div class="live-flow-indicator">
      <div class="flow-rate" style="font-size:18px;color:${(liveData.acceleration||0) > 0 ? '#f87171' : (liveData.acceleration||0) < 0 ? '#4ade80' : '#8890b5'};">${(liveData.acceleration||0) > 0 ? '▲ 加速流入' : (liveData.acceleration||0) < 0 ? '▼ 加速流出' : isZero ? '─ 未开盘' : '─ 匀速'}</div>
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
  sectorGrid.innerHTML = '<div style="color:#5f6b8a;text-align:center;padding:20px;grid-column:1/-1;">加载中...</div>';
  etfBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#5f6b8a;">加载中...</td></tr>';
  rankBody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#5f6b8a;">加载中...</td></tr>';

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
        const flowColor = s.totalMainNet >= 0 ? "#f87171" : "#4ade80";
        const flowSign = s.totalMainNet >= 0 ? "+" : "";
        const chgColor = s.avgChangePct >= 0 ? "#f87171" : "#4ade80";
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
      sectorGrid.innerHTML = '<div style="color:#5f6b8a;text-align:center;padding:20px;grid-column:1/-1;">暂无板块数据</div>';
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
          '<td style="color:' + (e.hugeNet >= 0 ? '#f87171' : '#4ade80') + '">' + (e.hugeNet >= 0 ? '+' : '') + fmtFund(e.hugeNet) + '</td>' +
          '<td style="color:' + (e.largeNet >= 0 ? '#f87171' : '#4ade80') + '">' + (e.largeNet >= 0 ? '+' : '') + fmtFund(e.largeNet) + '</td>' +
          '<td class="' + pctCls + '">' + pctSign + (e.mainPct != null ? e.mainPct.toFixed(2) : "--") + '%</td>' +
          '<td>' + (etfTags || '<span style="color:#5f6b8a;">--</span>') + '</td>' +
        '</tr>';
      }).join("");
    } else {
      etfBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#5f6b8a;">暂无ETF板块数据</td></tr>';
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
          <td><span style="color:#c8cdf0;font-weight:500;">${f.name}</span>${rtBadge} <span style="font-size:10px;color:#5f6b8a;">${f.code}</span></td>
          <td style="color:#c8cdf0;">${f.nav.toFixed(4)}</td>
          <td class="${dailyCls}">${sign(f.dailyReturn)}${f.dailyReturn.toFixed(2)}%</td>
          <td class="${m1Cls}">${sign(f.monthlyReturn)}${f.monthlyReturn.toFixed(2)}%</td>
          <td class="${m3Cls}">${sign(f.return3m)}${f.return3m.toFixed(2)}%</td>
          <td class="${m6Cls}">${sign(f.return6m)}${f.return6m.toFixed(2)}%</td>
          <td class="${y1Cls}">${sign(f.return1y)}${f.return1y.toFixed(2)}%</td>
          <td style="color:#8890b5;font-size:12px;">${f.size > 0 ? f.size.toFixed(1) : "--"}</td>
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
    sectorGrid.innerHTML = '<div style="color:#f87171;text-align:center;padding:20px;grid-column:1/-1;">加载失败: ' + e.message + '</div>';
    rankBody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#f87171;">加载失败</td></tr>';
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
  dropdown.innerHTML = '<div style="padding:12px 14px;color:#5f6b8a;font-size:13px;">搜索中...</div>';
  dropdown.style.display = "block";
  fundSearchTimer = setTimeout(async function() {
    try {
      var resp = await fetch("/api/market/fund-search?q=" + encodeURIComponent(q));
      var data = await resp.json();
      if (!data.funds || data.funds.length === 0) {
        dropdown.innerHTML = '<div style="padding:12px 14px;color:#5f6b8a;font-size:13px;">未找到相关基金</div>';
        return;
      }
      dropdown.innerHTML = data.funds.filter(function(f) { return f.nav != null; }).map(function(f) {
        return '<div class="fund-search-item" data-fund-code="' + f.code + '" data-fund-name="' + f.name + '">' +
          '<div><div class="fsi-name">' + f.name + '</div><div class="fsi-code">' + f.code + ' · ' + (f.type || "") + '</div></div>' +
          '<div class="fsi-return" style="color:#c8cdf0;font-size:11px;">净值 ' + (f.nav != null ? Number(f.nav).toFixed(4) : "--") + '</div>' +
        '</div>';
      }).join("");
    } catch(e) {
      dropdown.innerHTML = '<div style="padding:12px 14px;color:#f87171;font-size:13px;">搜索失败，请重试</div>';
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
  $("#fundDetailInfo").innerHTML = '<div style="color:#5f6b8a;text-align:center;grid-column:1/-1;">加载中...</div>';

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
        strong_buy: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", icon: "🔥", text: "强烈看多" },
        buy: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", icon: "📈", text: "偏多" },
        sell: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.3)", icon: "📉", text: "偏空" },
        strong_sell: { color: "#22c55e", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.3)", icon: "⚠️", text: "强烈看空" },
        neutral: { color: "#8890b5", bg: "rgba(136,144,181,0.08)", border: "rgba(136,144,181,0.2)", icon: "📊", text: "方向不明" },
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
        itemStyle: { color: isBuy ? "#ef4444" : "#22c55e", shadowBlur: 12, shadowColor: isBuy ? "rgba(239,68,68,0.7)" : "rgba(34,197,94,0.7)" },
        label: { show: true, position: isBuy ? "bottom" : "top", formatter: isBuy ? "🔥买入" : "📉卖出", color: isBuy ? "#ef4444" : "#22c55e", fontSize: 12, fontWeight: 800, distance: 6 },
      });
    }

    fundNAVChart.setOption({
      backgroundColor: "transparent",
      title: { text: name + " 净值走势", left: 16, top: 14, textStyle: { color: "#c8cdf0", fontSize: 14 } },
      grid: { left: 12, right: 16, top: 50, bottom: 60 },
      xAxis: { type: "category", data: ind.dates, axisLabel: { color: "#5f6b8a", fontSize: 10 } },
      yAxis: { type: "value", scale: true, axisLabel: { color: "#5f6b8a", fontSize: 11, formatter: v => v.toFixed(3) }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      dataZoom: [
        { type: "inside", start: 60, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: "slider", start: 60, end: 100, height: 20, bottom: 6, borderColor: "rgba(255,255,255,.04)", backgroundColor: "rgba(15,19,48,.6)", dataBackground: { lineStyle: { color: "rgba(255,255,255,.06)" }, areaStyle: { color: "rgba(255,255,255,.03)" } }, selectedDataBackground: { lineStyle: { color: "#a78bfa" }, areaStyle: { color: "rgba(167,139,250,.1)" } }, handleStyle: { color: "#8890b5" }, textStyle: { color: "#5f6b8a" } },
      ],
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" }, formatter: ps => {
        const main = ps.find(p => p.seriesName === "净值"); if (!main) return "";
        return `${main.axisValue}<br/>净值: ${main.data[1]?.toFixed(4)}`;
      }},
      series: [
        { name: "净值", type: "candlestick", data: ohlc, itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e" } },
        { name: "MA5", type: "line", data: ind.ma5, lineStyle: { color: "#f87171", width: 1 }, symbol: "none" },
        { name: "MA10", type: "line", data: ind.ma10, lineStyle: { color: "#fbbf24", width: 1 }, symbol: "none" },
        { name: "MA20", type: "line", data: ind.ma20, lineStyle: { color: "#a78bfa", width: 1 }, symbol: "none" },
        { name: "MA60", type: "line", data: ind.ma60, lineStyle: { color: "#38bdf8", width: 1 }, symbol: "none" },
        ...fundLiveMarkers,
      ],
      legend: { right: 16, top: 4, textStyle: { color: "#8890b5", fontSize: 10 } },
    }, true);

    // MACD chart
    fundMACDChart.setOption({
      backgroundColor: "transparent", grid: { left: 12, right: 12, top: 10, bottom: 25 },
      xAxis: { type: "category", data: ind.dates, axisLabel: { color: "#5f6b8a", fontSize: 10, interval: Math.floor(ind.dates.length / 8) } },
      yAxis: { axisLabel: { color: "#5f6b8a", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      series: [
        { name: "DIF", type: "line", data: ind.macd.dif, lineStyle: { color: "#38bdf8", width: 1 }, symbol: "none" },
        { name: "DEA", type: "line", data: ind.macd.dea, lineStyle: { color: "#fbbf24", width: 1 }, symbol: "none" },
        { name: "MACD", type: "bar", data: ind.macd.macd, itemStyle: { color: p => p.data >= 0 ? "#ef4444" : "#22c55e" } },
      ],
      legend: { right: 16, top: 4, textStyle: { color: "#8890b5", fontSize: 10 } },
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" } },
    }, true);

    // RSI chart
    fundRSIChart.setOption({
      backgroundColor: "transparent", grid: { left: 12, right: 12, top: 10, bottom: 25 },
      xAxis: { type: "category", data: ind.dates, axisLabel: { color: "#5f6b8a", fontSize: 10, interval: Math.floor(ind.dates.length / 8) } },
      yAxis: { min: 0, max: 100, axisLabel: { color: "#5f6b8a", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      series: [{ name: "RSI(14)", type: "line", data: ind.rsi, lineStyle: { color: "#a78bfa", width: 1.5 }, symbol: "none",
        markLine: { silent: true, symbol: "none", data: [{ yAxis: 70, lineStyle: { color: "#ef4444", type: "dashed" } }, { yAxis: 30, lineStyle: { color: "#22c55e", type: "dashed" } }] }
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
          container.innerHTML = '<div style="text-align:center;color:#5f6b8a;padding:20px;">' +
            '<div style="font-size:14px;color:#8890b5;margin-bottom:8px;">⏳ ' + (kdata.error || "暂无数据") + '</div>' +
            '<div style="font-size:12px;">交易时间: 周一至周五 9:30-15:00</div>' +
            '<div style="font-size:12px;color:#5f6b8a;">开盘后将显示完整分时K线图</div>' +
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
          var chgColor = chg >= 0 ? "#ef4444" : "#22c55e";
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
            '<div style="font-size:10px;color:#5f6b8a;margin-top:6px;">盘后估值 · 基于' + (kdata.source || "fundgz") + '</div>' +
            '<div style="font-size:10px;color:#5f6b8a;">交易时段将显示完整分时K线</div>' +
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
  var lineColor = lastChg >= 0 ? "#ef4444" : "#22c55e";
  var areaTop = lastChg >= 0 ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.25)";

  fundIntradayChart.setOption({
    backgroundColor: "transparent",
    grid: { left: 14, right: 20, top: 16, bottom: 60 },
    xAxis: {
      type: "category", data: times,
      axisLabel: { color: "#5f6b8a", fontSize: 10, interval: xInterval },
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
      splitLine: { show: false }
    },
    yAxis: [
      { type: "value", scale: true,
        axisLabel: { color: "#5f6b8a", fontSize: 10, formatter: function(v) { return v.toFixed(4); } },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.04)" } }
      },
      { type: "value", scale: true,
        axisLabel: { color: "#5f6b8a", fontSize: 10, formatter: function(v) { return v.toFixed(2) + "%"; } },
        splitLine: { show: false }
      }
    ],
    dataZoom: [
      { type: "inside", start: 30, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true },
      { type: "slider", start: 30, end: 100, height: 20, bottom: 6, borderColor: "rgba(255,255,255,.04)", backgroundColor: "rgba(15,19,48,.6)", dataBackground: { lineStyle: { color: "rgba(255,255,255,.06)" }, areaStyle: { color: "rgba(255,255,255,.03)" } }, selectedDataBackground: { lineStyle: { color: "#a78bfa" }, areaStyle: { color: "rgba(167,139,250,.1)" } }, handleStyle: { color: "#8890b5" }, textStyle: { color: "#5f6b8a" } },
    ],
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15,19,48,0.96)", borderColor: "rgba(255,255,255,0.1)", textStyle: { color: "#e0e4f0", fontSize: 12 },
      formatter: function(ps) {
        var p = null;
        for (var i = 0; i < (ps||[]).length; i++) {
          if (ps[i].seriesName === "估算净值") { p = ps[i]; break; }
        }
        if (!p) return "";
        var idx = p.dataIndex;
        var chg = changes[idx];
        var chgColor = chg >= 0 ? "#ef4444" : "#22c55e";
        var chgSign = chg >= 0 ? "+" : "";
        return "<b>" + times[idx] + "</b><br/>" +
               "估算净值: <b>" + Number(p.data).toFixed(4) + "</b><br/>" +
               "涨跌幅: <b style=\"color:" + chgColor + "\">" + chgSign + chg + "%</b>";
      }
    },
    series: [
      { name: "昨收", type: "line", yAxisIndex: 0, data: new Array(times.length).fill(prevClose),
        lineStyle: { color: "#8890b5", type: "dashed", width: 1 }, symbol: "none",
        markLine: prevClose != null ? { silent: true, symbol: "none", lineStyle: { color: "#8890b5", type: "dashed", width: 1 },
          label: { formatter: "昨收 " + prevClose.toFixed(4), color: "#8890b5", fontSize: 10, position: "end" },
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
function isTradingHours() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), day = now.getDay();
  if (day === 0 || day === 6) return false;
  const t = h * 100 + m;
  return (t >= 930 && t <= 1130) || (t >= 1300 && t <= 1505);
}

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
      el.innerHTML = `<div style="padding:24px;text-align:center;color:#5f6b8a;">
        <div style="font-size:48px;margin-bottom:12px;">🔍</div>
        <b style="color:#8890b5;">没有符合当前筛选条件的股票</b>
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
          <span style="font-size:11px;color:#5f6b8a;margin-left:8px;">扫描 ${totalScanned} 只 → 通过 ${totalPassed} 只</span>
        </div>
        <span style="font-size:11px;color:#4b5563;">点击任意结果查看详情</span>
      </div>
      <div class="scan-results-list">
        ${resultsArray.map((d, i) => {
          const scoreColor = d.score >= 55 ? '#f87171' : d.score >= 40 ? '#f59e0b' : d.score >= 30 ? '#3b82f6' : '#94a3b8';
          const ringBg = d.score >= 55 ? 'rgba(248,113,113,.12)' : d.score >= 40 ? 'rgba(245,158,11,.12)' : d.score >= 30 ? 'rgba(59,130,246,.12)' : 'rgba(148,163,184,.08)';
          return `
          <div class="scan-result-card clickable" data-code="${d.code}" title="点击查看 ${d.name || d.code} 的详细分析">
            <div class="scan-result-header">
              <span style="font-size:10px;color:#4b5563;min-width:18px;">#${i + 1}</span>
              <span class="scan-grade" style="background:${d.gradeColor || '#6b7280'}20;color:${d.gradeColor || '#6b7280'}">${d.grade || d.score + '分'}</span>
              <div class="scan-score-ring" style="background:${ringBg};color:${scoreColor};border:2px solid ${scoreColor}33">${d.score}</div>
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <b style="color:#e0e4f0;font-size:14px;">${d.name || d.code}</b>
                  <span style="font-size:11px;color:#5f6b8a;">${d.code}</span>
                  <span style="font-size:13px;color:#c8cdf0;font-weight:600;">${d.lastPrice?.toFixed(2)}</span>
                  <span style="font-size:11px;color:${d.chg5 >= 0 ? '#f87171' : '#4ade80'}">${d.chg5 >= 0 ? '+' : ''}${d.chg5?.toFixed(1)}%</span>
                </div>
                <div style="font-size:13px;color:#c8cdf0;margin-top:2px;">${d.launchStatus || ''}</div>
              </div>
              <div style="display:flex;gap:10px;font-size:11px;">
                <span title="位置分：越低说明离高点越远，安全边际越大"><span class="dim-badge dim-pos">位置</span>${d.positionScore || 0}</span>
                <span title="启动分：量价突破+MACD信号，越高说明动能越强"><span class="dim-badge dim-launch">启动</span>${d.launchScore || 0}</span>
                <span title="质量分：均线趋势+OBV资金+波动率，越高说明上涨质量越好"><span class="dim-badge dim-qual">质量</span>${d.qualityScore || 0}</span>
              </div>
            </div>
            <div class="scan-signals">
              📋 信号：${(d.reasons || []).slice(0, 4).map(r => `<b>${r}</b>`).join(" · ")}
            </div>
          </div>`;
        }).join("")}
      </div>
      <div style="margin-top:12px;font-size:11px;color:#4b5563;display:flex;gap:14px;">
        <span><span class="dim-badge dim-pos">位置</span> 越低=安全边际越大</span>
        <span><span class="dim-badge dim-launch">启动</span> 越高=突破动能越强</span>
        <span><span class="dim-badge dim-qual">质量</span> 越高=上涨越稳健</span>
      </div>`;

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
      el.innerHTML = `<div style="padding:24px;text-align:center;color:#5f6b8a;">
        <div style="font-size:48px;margin-bottom:12px;">🔍</div>
        <b style="color:#8890b5;">没有符合 AI 理解的股票</b>
        <p style="margin-top:6px;">AI 理解的筛选条件可能太严格，试试换个说法</p>
      </div>`;
      return;
    }

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div>
          <b style="color:#c8cdf0;font-size:15px;">🤖 AI 筛选结果</b>
          <span style="font-size:11px;color:#5f6b8a;margin-left:8px;">共 ${results.length} 只</span>
        </div>
      </div>
      <div class="scan-results-list">
        ${results.map((d, i) => {
          const scoreColor = d.score >= 55 ? '#f87171' : d.score >= 40 ? '#f59e0b' : d.score >= 30 ? '#3b82f6' : '#94a3b8';
          const ringBg = d.score >= 55 ? 'rgba(248,113,113,.12)' : d.score >= 40 ? 'rgba(245,158,11,.12)' : d.score >= 30 ? 'rgba(59,130,246,.12)' : 'rgba(148,163,184,.08)';
          return `
          <div class="scan-result-card clickable" data-code="${d.code}" title="点击查看 ${d.name || d.code} 的详细分析">
            <div class="scan-result-header">
              <span style="font-size:10px;color:#4b5563;min-width:18px;">#${i + 1}</span>
              <div class="scan-score-ring" style="background:${ringBg};color:${scoreColor};border:2px solid ${scoreColor}33">${d.score || '?'}</div>
              <div style="flex:1;">
                <b style="color:#e0e4f0;font-size:14px;">${d.name || d.code}</b>
                <span style="font-size:11px;color:#5f6b8a;margin-left:6px;">${d.code}</span>
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
        <div style="font-size:12px;color:#818cf8;font-weight:600;margin-bottom:6px;">📊 市场环境</div>
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
        <div class="ai-pick-card" style="padding:14px 16px;background:rgba(255,255,255,.03);border:1px solid rgba(245,158,11,.15);border-radius:10px;cursor:pointer;" data-code="${pick.code}">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <!-- 排名和评分 -->
            <div style="text-align:center;min-width:50px;">
              <div style="font-size:11px;color:#92400e;">#${pick.rank}</div>
              <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,rgba(245,158,11,.15),rgba(217,119,6,.1));border:2px solid ${pick.compositeScore >= 70 ? '#f59e0b' : pick.compositeScore >= 50 ? '#3b82f6' : '#94a3b8'}33;display:flex;align-items:center;justify-content:center;margin:4px auto;">
                <span style="font-size:16px;font-weight:700;color:${pick.compositeScore >= 70 ? '#f59e0b' : pick.compositeScore >= 50 ? '#3b82f6' : '#94a3b8'};">${pick.compositeScore}</span>
              </div>
              <div style="font-size:10px;color:${pick.grade === 'A+' || pick.grade === 'A' ? '#f59e0b' : pick.grade === 'B' ? '#3b82f6' : '#94a3b8'};font-weight:600;">${pick.grade}级</div>
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
                ${pick.industry ? `<span style="font-size:10px;padding:1px 5px;background:rgba(148,163,184,.15);border-radius:4px;color:#94a3b8;margin-left:4px;">${pick.industry}</span>` : ''}
                ${pick.price ? `<span style="font-size:13px;color:#f59e0b;margin-left:4px;">¥${typeof pick.price === 'number' ? pick.price.toFixed(2) : pick.price}</span>` : ''}
              </div>
              <!-- 多周期涨跌 -->
              <div style="display:flex;gap:10px;margin-bottom:6px;font-size:11px;">
                <span style="color:${chg1d >= 0 ? '#f87171' : '#34d399'};">日${chg1d >= 0 ? '+' : ''}${chg1d}%</span>
                <span style="color:${chg5d >= 0 ? '#f87171' : '#34d399'};">周${chg5d >= 0 ? '+' : ''}${chg5d}%</span>
                <span style="color:${chg20d >= 0 ? '#f87171' : '#34d399'};">月${chg20d >= 0 ? '+' : ''}${chg20d}%</span>
              </div>
              <div style="font-size:12px;color:#b45309;line-height:1.6;margin-bottom:6px;">${pick.summary || ''}</div>
              ${techAnalysis.trend ? `<div style="font-size:11px;color:#818cf8;margin-bottom:4px;">📊 趋势：${techAnalysis.trend} ${techAnalysis.signals?.length ? '· ' + techAnalysis.signals.join(' ') : ''}</div>` : ''}
              ${pick.type === 'ETF' ? '<div style="font-size:11px;color:#60a5fa;margin-bottom:4px;">💡 ETF适合定投、行业配置，分散单股风险</div>' : ''}
              ${pick.highlights?.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;">${pick.highlights.map(h => `<span style="font-size:10px;padding:2px 6px;background:rgba(245,158,11,.1);border-radius:4px;color:#d97706;">${h}</span>`).join("")}</div>` : ''}
              ${pick.risks?.length ? `<div style="font-size:11px;color:#92400e;margin-bottom:4px;">⚠️ ${pick.risks.join(' · ')}</div>` : ''}
              ${pick.alerts?.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;">${pick.alerts.map(a => {
                // 根据level确定颜色
                const levelColors = { 'bullish': '#22c55e', 'info': '#818cf8', 'warning': '#fbbf24', 'bearish': '#f87171', 'danger': '#ef4444', 'opportunity': '#34d399', 'neutral': '#94a3b8' };
                const levelBgs = { 'bullish': '34,197,94', 'info': '129,140,248', 'warning': '251,191,36', 'bearish': '248,113,113', 'danger': '239,68,68', 'opportunity': '52,211,153', 'neutral': '148,163,184' };
                const color = levelColors[a.level] || '#94a3b8';
                const bgRgb = levelBgs[a.level] || '148,163,184';
                return `<span style="font-size:10px;padding:2px 6px;background:rgba(${bgRgb},.12);border:1px solid rgba(${bgRgb},.3);border-radius:4px;color:${color};">${a.icon || '📌'} ${a.msg || ''}</span>`;
              }).join("")}</div>` : ''}
              ${pick.etfPotential ? `<div style="margin-top:4px;padding:6px 8px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:6px;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                  <span style="font-size:10px;padding:1px 5px;background:${pick.etfPotential.potential?.includes('高')?'rgba(34,197,94,.2)':pick.etfPotential.potential?.includes('中')?'rgba(251,191,36,.2)':'rgba(148,163,184,.15)'};border:1px solid ${pick.etfPotential.potential?.includes('高')?'rgba(34,197,94,.4)':pick.etfPotential.potential?.includes('中')?'rgba(251,191,36,.4)':'rgba(148,163,184,.3)'};border-radius:4px;color:${pick.etfPotential.potential?.includes('高')?'#22c55e':pick.etfPotential.potential?.includes('中')?'#fbbf24':'#94a3b8'};font-weight:600;">💡 ${pick.etfPotential.potential || '潜力分析'}</span>
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
                <button style="font-size:11px;padding:4px 10px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:6px;color:#818cf8;cursor:pointer;">完整分析 →</button>
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
            series: [{ type: "candlestick", data: ohlc, itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e" } }],
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
                  axisLabel: { color: "#5f6b8a", fontSize: 10 },
                  axisLine: { lineStyle: { color: "rgba(255,255,255,.06)" } }
                },
                yAxis: {
                  type: "value",
                  scale: true,
                  axisLabel: { color: "#5f6b8a", fontSize: 10 },
                  splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } }
                },
                series: [{
                  name: "K线",
                  type: "candlestick",
                  data: ohlc,
                  itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e", borderWidth: 1.5 }
                }],
                tooltip: {
                  trigger: "axis",
                  backgroundColor: "rgba(15,19,48,.96)",
                  borderColor: "rgba(255,255,255,.1)",
                  textStyle: { color: "#e0e4f0" },
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

// 异步添加回测买卖信号标记到日K/周K图表（通用）
function addTradeSignals(chart, chartEl, code, dates, dateMap) {
  fetch(`/api/backtest?code=${code}&strategy=multiFactorStrategy&days=120`)
    .then(r => r.json()).catch(() => null)
    .then(bt => {
      try { if (!chart || chart.isDisposed() || !chartEl.isConnected) return; } catch (_) { return; }
      let pts = bt?.signalPoints || [];
      if (dateMap) {
        pts = pts.map(p => ({ ...p, date: dateMap[p.date] })).filter(p => p.date && dates.includes(p.date));
      } else {
        pts = pts.filter(p => dates.includes(p.date));
      }
      if (!pts.length) return;
      const buyPts = pts.filter(p => p.type === "buy");
      const sellPts = pts.filter(p => p.type === "sell");
      const sigSeries = [];
      if (buyPts.length) sigSeries.push({
        name: "买入信号", type: "scatter", z: 10,
        data: buyPts.map(p => ({ value: [p.date, p.price * 0.97], symbolSize: 16, itemStyle: { shadowBlur: 6, shadowColor: "rgba(239,68,68,0.6)" } })),
        symbol: "pin", symbolRotate: 0, itemStyle: { color: "#ef4444" },
        label: { show: true, position: "bottom", formatter: "买", color: "#ef4444", fontSize: 10, fontWeight: 800 },
      });
      if (sellPts.length) sigSeries.push({
        name: "卖出信号", type: "scatter", z: 10,
        data: sellPts.map(p => ({ value: [p.date, p.price * 1.03], symbolSize: 16, itemStyle: { shadowBlur: 6, shadowColor: "rgba(34,197,94,0.6)" } })),
        symbol: "pin", symbolRotate: 180, itemStyle: { color: "#22c55e" },
        label: { show: true, position: "top", formatter: "卖", color: "#22c55e", fontSize: 10, fontWeight: 800 },
      });
      try { chart.setOption({ series: sigSeries }); } catch (_) {}
    });
}

// 分钟K线T+0交易信号：布林带 + 支撑阻力（同步计算，无需额外API）
function addMinuteSignal(chart, chartEl, code, ohlc, times) {
  if (!ohlc || !ohlc.length) return;
  const closes = ohlc.map(c => c[1]); // close = index 1
  const n = Math.min(20, closes.length);
  if (n < 5) return;

  // 计算BB(20)：中轨=SMA20，上下轨=SMA20±2*stddev
  const bbMid = [], bbUpper = [], bbLower = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) { bbMid.push(null); bbUpper.push(null); bbLower.push(null); continue; }
    const slice = closes.slice(i - n + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / n;
    const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    bbMid.push(+mean.toFixed(3));
    bbUpper.push(+(mean + 2 * std).toFixed(3));
    bbLower.push(+(mean - 2 * std).toFixed(3));
  }

  // 寻找布林带触碰点（过去60根K线内）：下轨→买入，上轨→卖出
  const lookback = Math.min(60, closes.length);
  const startIdx = closes.length - lookback;
  const buyPts = [], sellPts = [];
  for (let i = startIdx + 1; i < closes.length; i++) {
    if (!bbLower[i] || !bbUpper[i]) continue;
    const low = ohlc[i][2], high = ohlc[i][3]; // low=index 2, high=index 3
    if (low <= bbLower[i] && closes[i] > bbLower[i]) {
      buyPts.push({ value: [times[i], low * 0.998], symbolSize: 20, itemStyle: { shadowBlur: 6, shadowColor: "rgba(34,197,94,0.6)" } });
    }
    if (high >= bbUpper[i] && closes[i] < bbUpper[i]) {
      sellPts.push({ value: [times[i], high * 1.002], symbolSize: 20, itemStyle: { shadowBlur: 6, shadowColor: "rgba(239,68,68,0.6)" } });
    }
  }

  // 添加BB线 + 信号标记
  const bbSeries = [
    { name: "BB上轨", type: "line", data: bbUpper, lineStyle: { color: "rgba(239,68,68,0.5)", width: 1, type: "dashed" }, symbol: "none", silent: true, z: 1 },
    { name: "BB中轨", type: "line", data: bbMid, lineStyle: { color: "rgba(245,158,11,0.45)", width: 1 }, symbol: "none", silent: true, z: 1 },
    { name: "BB下轨", type: "line", data: bbLower, lineStyle: { color: "rgba(34,197,94,0.5)", width: 1, type: "dashed" }, symbol: "none", silent: true, z: 1 },
  ];
  const sigSeries = [];
  if (buyPts.length) sigSeries.push({
    name: "T+0买入", type: "scatter", data: buyPts, z: 10,
    symbol: "arrow", symbolRotate: 0, itemStyle: { color: "#22c55e" },
    label: { show: true, position: "bottom", formatter: "买", color: "#22c55e", fontSize: 10, fontWeight: 800 },
  });
  if (sellPts.length) sigSeries.push({
    name: "T+0卖出", type: "scatter", data: sellPts, z: 10,
    symbol: "arrow", symbolRotate: 180, itemStyle: { color: "#ef4444" },
    label: { show: true, position: "top", formatter: "卖", color: "#ef4444", fontSize: 10, fontWeight: 800 },
  });

  try { chart.setOption({ series: [...bbSeries, ...sigSeries] }); } catch (_) {}
}

// 加载日K线图（含MA均线 + 买卖信号标记）
function loadDayKlineChart(chartEl, data, code) {
  const chart = ChartManager.getChart(chartEl, "scan");
  if (!chart) return;
  const ohlc = data.opens.map((o, i) => [o, data.closes[i], data.lows[i], data.highs[i]]);

  // 计算MA5/MA10/MA20
  const calcMA = (n) => data.closes.map((_, i) => {
    if (i < n - 1) return null;
    const sum = data.closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0);
    return +(sum / n).toFixed(2);
  });

  const series = [{
    name: "K线", type: "candlestick", data: ohlc,
    itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e", borderWidth: 1.5 },
  }];

  // 均线
  [[calcMA(5), "MA5", "#f87171"], [calcMA(10), "MA10", "#fbbf24"], [calcMA(20), "MA20", "#a78bfa"]]
    .forEach(([d, n, c]) => series.push({ name: n, type: "line", data: d, lineStyle: { color: c, width: 1.2 }, symbol: "none" }));

  // 异步获取买卖信号并添加标记
  fetch(`/api/backtest?code=${code}&strategy=multiFactorStrategy&days=120`).then(r => r.json()).catch(() => null).then(bt => {
    // 图表可能已在异步回调期间被销毁（页面切换/卡片收起）
    try {
      if (!chart || chart.isDisposed() || !chartEl.dataset.loaded) return;
    } catch (_) { return; }
    const signalPoints = bt?.signalPoints || [];
    if (signalPoints.length) {
      const buyPoints = signalPoints.filter(p => p.type === "buy");
      const sellPoints = signalPoints.filter(p => p.type === "sell");
      if (buyPoints.length) {
        series.push({
          name: "买入", type: "scatter",
          data: buyPoints.map(p => ({ value: [p.date, p.price * 0.97], symbolSize: 16, itemStyle: { shadowBlur: 6, shadowColor: "rgba(239,68,68,0.6)" } })),
          symbol: "pin", symbolRotate: 0, itemStyle: { color: "#ef4444" },
          label: { show: true, position: "bottom", formatter: "买", color: "#ef4444", fontSize: 10, fontWeight: 800 },
        });
      }
      if (sellPoints.length) {
        series.push({
          name: "卖出", type: "scatter",
          data: sellPoints.map(p => ({ value: [p.date, p.price * 1.03], symbolSize: 16, itemStyle: { shadowBlur: 6, shadowColor: "rgba(34,197,94,0.6)" } })),
          symbol: "pin", symbolRotate: 180, itemStyle: { color: "#22c55e" },
          label: { show: true, position: "top", formatter: "卖", color: "#22c55e", fontSize: 10, fontWeight: 800 },
        });
      }
    }
    try { chart.setOption({ series }); } catch (_) {}
  });

  chart.setOption({
    backgroundColor: "transparent",
    grid: { left: 50, right: 20, top: 20, bottom: 40 },
    legend: { right: 10, top: 2, textStyle: { color: "#5f6b8a", fontSize: 10 } },
    xAxis: {
      type: "category", data: data.dates,
      axisLabel: { color: "#5f6b8a", fontSize: 10 },
      axisLine: { lineStyle: { color: "rgba(255,255,255,.06)" } }
    },
    yAxis: {
      type: "value", scale: true,
      axisLabel: { color: "#5f6b8a", fontSize: 10 },
      splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } }
    },
    series,
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)",
      textStyle: { color: "#e0e4f0", fontSize: 12 },
      formatter: params => {
        const k = params.find(p => p.seriesName === "K线");
        if (!k) return "";
        const d = k.data;
        return `<b>${k.axisValue}</b><br/>开: ${d[1]} 收: ${d[2]}<br/>低: ${d[3]} 高: ${d[4]}`;
      }
    },
    dataZoom: [{ type: "inside", start: 30, end: 100 }]
  });

  chartEl.dataset.loaded = "day";
  ChartManager.manageResize(chart);
}

// 切换K线周期
async function switchKlinePeriod(code, period) {
  const chartEl = $(`#expandedKlineChart-${code}`);
  if (!chartEl) return;

  // 更新按钮状态
  document.querySelectorAll(`.kline-period-btn[data-code="${code}"]`).forEach(btn => {
    const isActive = btn.dataset.period === period;
    btn.classList.toggle("active", isActive);
    btn.style.background = isActive ? "rgba(245,158,11,.25)" : "rgba(245,158,11,.1)";
    btn.style.borderColor = isActive ? "rgba(245,158,11,.4)" : "rgba(245,158,11,.2)";
    btn.style.color = isActive ? "#fbbf24" : "#d97706";
  });

  // 销毁旧图表
  const oldChart = echarts.getInstanceByDom(chartEl);
  if (oldChart) oldChart.dispose();
  chartEl.dataset.loaded = "";

  if (period === "minute") {
    try {
      const resp = await fetch(`/api/fundflow/rtchart?code=${code}&lite=1`);
      const data = await resp.json();
      if (data.error || !data.candles || !data.candles.length) {
        chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5f6b8a;font-size:12px;">暂无分钟数据</div>';
        return;
      }
      if (!chartEl.isConnected) return; // DOM可能已被移除
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
          axisLabel: { color: "#5f6b8a", fontSize: 10 },
          axisLine: { lineStyle: { color: "rgba(255,255,255,.06)" } }
        },
        yAxis: {
          type: "value",
          scale: true,
          axisLabel: { color: "#5f6b8a", fontSize: 10 },
          splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } }
        },
        series: [{
          name: "K线",
          type: "candlestick",
          data: ohlc,
          itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e", borderWidth: 1.5 }
        }],
        tooltip: {
          trigger: "axis",
          backgroundColor: "rgba(15,19,48,.96)",
          borderColor: "rgba(255,255,255,.1)",
          textStyle: { color: "#e0e4f0" },
          formatter: params => {
            const p = params?.[0];
            const d = p?.data;
            if (!d || !Array.isArray(d)) return p?.axisValue || "";
            return `${p.axisValue}<br/>开: ${d[1]} 收: ${d[2]}<br/>低: ${d[3]} 高: ${d[4]}`;
          }
        },
        dataZoom: [
          { type: "inside", start: 0, end: 100 }
        ]
      });

      chartEl.dataset.loaded = "minute";
      ChartManager.manageResize(chart);
      addMinuteSignal(chart, chartEl, code, ohlc, times);
    } catch (e) {
      chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5f6b8a;font-size:12px;">加载失败</div>';
    }
  } else if (period === "day") {
    try {
      const resp = await fetch(`/api/indicators?code=${code}&days=60`);
      const data = await resp.json();
      if (data.error || !data.dates) {
        chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5f6b8a;font-size:12px;">暂无数据</div>';
        return;
      }
      if (!chartEl.isConnected) return;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!chartEl.isConnected) return;
      loadDayKlineChart(chartEl, data, code);
    } catch (e) {
      chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5f6b8a;font-size:12px;">加载失败</div>';
    }
  } else if (period === "week") {
    try {
      const resp = await fetch(`/api/indicators?code=${code}&days=365`);
      const data = await resp.json();
      if (data.error || !data.dates) {
        chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5f6b8a;font-size:12px;">暂无数据</div>';
        return;
      }
      if (!chartEl.isConnected) return;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!chartEl.isConnected) return;
      // 聚合为周K
      const wDates = [], wOpen = [], wClose = [], wHigh = [], wLow = [];
      for (let i = 0; i < data.opens.length; i += 5) {
        const sl = data.opens.slice(i, i + 5);
        if (sl.length === 0) continue;
        wDates.push(data.dates[i]);
        wOpen.push(data.opens[i]);
        wClose.push(data.closes[Math.min(i + 4, data.closes.length - 1)]);
        wHigh.push(Math.max(...data.highs.slice(i, i + 5)));
        wLow.push(Math.min(...data.lows.slice(i, i + 5)));
      }
      const wOhlc = wOpen.map((o, i) => [o, wClose[i], wLow[i], wHigh[i]]);
      // 构建日→周日期映射（用于信号日期转换）
      const dailyToWeekly = {};
      for (let i = 0; i < data.dates.length; i++) {
        const wk = Math.floor(i / 5);
        if (wk < wDates.length) dailyToWeekly[data.dates[i]] = wDates[wk];
      }
      const chart = ChartManager.getChart(chartEl, "scan");
      if (!chart) return;
      chart.setOption({
        backgroundColor: "transparent",
        grid: { left: 50, right: 20, top: 20, bottom: 40 },
        xAxis: { type: "category", data: wDates, axisLabel: { color: "#5f6b8a", fontSize: 10 }, axisLine: { lineStyle: { color: "rgba(255,255,255,.06)" } } },
        yAxis: { type: "value", scale: true, axisLabel: { color: "#5f6b8a", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
        series: [{ name: "周K", type: "candlestick", data: wOhlc, itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e" } }],
        tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" },
          formatter: params => { const p = params[0], d = p.data; return `${p.axisValue}<br/>开: ${d[1]} 收: ${d[2]}<br/>低: ${d[3]} 高: ${d[4]}`; }
        },
        dataZoom: [{ type: "inside", start: 0, end: 100 }]
      });
      chartEl.dataset.loaded = "week";
      ChartManager.manageResize(chart);
      addTradeSignals(chart, chartEl, code, wDates, dailyToWeekly);
    } catch (e) {
      chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5f6b8a;font-size:12px;">加载失败</div>';
    }
  }
}

// ============ 通用K线图弹窗组件 ============
// K线弹窗：取消上一次未完成的请求
let _klineModalAbort = null;

function showKlineModal(code, name) {
  window.__lastAction = "showKlineModal " + code;
  console.log("[Modal] showKlineModal start", code);
  const t0 = performance.now();
  // 取消上一次加载中的请求
  if (_klineModalAbort) { _klineModalAbort.abort(); _klineModalAbort = null; }
  // 移除已有的弹窗
  const existing = $("#klineModal");
  if (existing) existing.remove();

  // 创建弹窗
  const modal = document.createElement("div");
  modal.id = "klineModal";
  modal.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);";
  modal.innerHTML = `
    <div style="width:90%;max-width:900px;background:#12152a;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.5);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:16px;">📈</span>
          <b style="color:#e0e4f0;font-size:16px;">${name || code}</b>
          <span style="font-size:12px;color:#5f6b8a;">${code}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="kline-modal-period active" data-period="minute" style="font-size:12px;padding:6px 12px;background:rgba(99,102,241,.25);border:1px solid rgba(99,102,241,.4);border-radius:8px;color:#a5b4fc;cursor:pointer;">今日分时</button>
          <button class="kline-modal-period" data-period="day" style="font-size:12px;padding:6px 12px;background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.2);border-radius:8px;color:#818cf8;cursor:pointer;">日K</button>
          <button class="kline-modal-period" data-period="week" style="font-size:12px;padding:6px 12px;background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.2);border-radius:8px;color:#818cf8;cursor:pointer;">周K</button>
          <button class="kline-modal-analyze" style="font-size:12px;padding:6px 12px;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.3);border-radius:8px;color:#fbbf24;cursor:pointer;">完整分析 →</button>
          <button class="kline-modal-close" style="font-size:18px;padding:4px 8px;background:transparent;border:none;color:#5f6b8a;cursor:pointer;">✕</button>
        </div>
      </div>
      <div id="klineModalChart" style="width:100%;height:400px;background:rgba(0,0,0,.2);border-radius:10px;"></div>
    </div>
  `;
  document.body.appendChild(modal);
  console.log("[Modal] DOM created in", (performance.now() - t0).toFixed(1) + "ms");

  // 绑定K线周期按钮事件（替代内联onclick，CSP兼容）
  modal.querySelectorAll(".kline-modal-period").forEach(btn => {
    btn.addEventListener("click", () => {
      loadKlineModalData(code, btn.dataset.period);
    });
  });
  const analyzeBtn = modal.querySelector(".kline-modal-analyze");
  if (analyzeBtn) {
    analyzeBtn.addEventListener("click", () => {
      navigateToStock(code);
      modal.remove();
    });
  }
  const closeBtn = modal.querySelector(".kline-modal-close");
  const closeModal = () => { ChartManager.disposePage("klineModal"); modal.remove(); };
  if (closeBtn) {
    closeBtn.addEventListener("click", closeModal);
  }

  // 点击背景关闭
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // ESC关闭
  const escHandler = (e) => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);

  // 加载默认数据（分钟K线）
  loadKlineModalData(code, "minute");
}

async function loadKlineModalData(code, period) {
  window.__lastAction = "loadKlineModalData " + code + " " + period;
  const chartEl = $("#klineModalChart");
  if (!chartEl) return;
  const t0 = performance.now();
  console.log("[Modal] loadKlineModalData start", code, period);

  // 更新按钮状态
  document.querySelectorAll(".kline-modal-period").forEach(btn => {
    const isActive = btn.dataset.period === period;
    btn.classList.toggle("active", isActive);
    btn.style.background = isActive ? "rgba(99,102,241,.25)" : "rgba(99,102,241,.1)";
    btn.style.borderColor = isActive ? "rgba(99,102,241,.4)" : "rgba(99,102,241,.2)";
    btn.style.color = isActive ? "#a5b4fc" : "#818cf8";
  });

  // 中止上一次加载中的请求，防止竞态
  if (_klineModalAbort) { _klineModalAbort.abort(); _klineModalAbort = null; }

  // 通过 ChartManager 统一销毁旧图表
  ChartManager.disposePage("klineModal");

  chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5f6b8a;">加载中...</div>';

  // 创建新的 AbortController
  const ac = new AbortController();
  _klineModalAbort = ac;

  try {
    let data;
    if (period === "minute") {
      console.log("[Modal] fetching rtchart...");
      data = await fetch(`/api/fundflow/rtchart?code=${code}&lite=1`, { signal: ac.signal }).then(r => r.json());
      console.log("[Modal] rtchart fetched in", (performance.now() - t0).toFixed(1) + "ms", "candles:", data.candles?.length);
      if (data.error || !data.candles || !data.candles.length) {
        if (chartEl.isConnected) chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5f6b8a;">暂无分钟数据</div>';
        return;
      }

      if (!chartEl.isConnected) return;
      // 延迟一帧确保容器已完成布局
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!chartEl.isConnected) return;
      const t1 = performance.now();
      const chart = ChartManager.getChart(chartEl, "klineModal");
      console.log("[Modal] echarts.init in", (performance.now() - t1).toFixed(1) + "ms");
      if (!chart) return;
      const times = data.candles.map(c => c.time);
      const ohlc = data.candles.map(c => [c.open, c.close, c.low, c.high]);

      const t2 = performance.now();
      chart.setOption({
        backgroundColor: "transparent",
        grid: { left: 60, right: 30, top: 20, bottom: 50 },
        xAxis: {
          type: "category",
          data: times,
          axisLabel: { color: "#5f6b8a", fontSize: 11 },
          axisLine: { lineStyle: { color: "rgba(255,255,255,.06)" } }
        },
        yAxis: {
          type: "value",
          scale: true,
          axisLabel: { color: "#5f6b8a", fontSize: 11 },
          splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } }
        },
        series: [{
          name: "K线",
          type: "candlestick",
          data: ohlc,
          itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e", borderWidth: 1.5 }
        }],
        tooltip: {
          trigger: "axis",
          backgroundColor: "rgba(15,19,48,.96)",
          borderColor: "rgba(255,255,255,.1)",
          textStyle: { color: "#e0e4f0" },
          formatter: params => {
            const p = params?.[0];
            const d = p?.data;
            if (!d || !Array.isArray(d)) return p?.axisValue || "";
            return `${p.axisValue}<br/>开: ${d[1]} 收: ${d[2]}<br/>低: ${d[3]} 高: ${d[4]}`;
          }
        },
        dataZoom: [
          { type: "inside", start: 0, end: 100 }
        ]
      });
      console.log("[Modal] setOption in", (performance.now() - t2).toFixed(1) + "ms, total:", (performance.now() - t0).toFixed(1) + "ms");
      ChartManager.manageResize(chart);
      addMinuteSignal(chart, chartEl, code, ohlc, times);
    } else {
      const days = period === "week" ? 365 : 120;
      console.log("[Modal] fetching indicators...");
      data = await fetch(`/api/indicators?code=${code}&days=${days}`, { signal: ac.signal }).then(r => r.json());
      console.log("[Modal] indicators fetched in", (performance.now() - t0).toFixed(1) + "ms", "dates:", data.dates?.length);
      if (data.error || !data.dates) {
        if (chartEl.isConnected) chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5f6b8a;">暂无数据</div>';
        return;
      }

      if (!chartEl.isConnected) return;
      // 延迟一帧确保容器已完成布局
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!chartEl.isConnected) return;
      const t3 = performance.now();
      const chart = ChartManager.getChart(chartEl, "klineModal");
      console.log("[Modal] echarts.init in", (performance.now() - t3).toFixed(1) + "ms");
      if (!chart) return;
      let ohlc, dates;

      let dateMap;
      if (period === "week") {
        // 周K线：将日线数据聚合为周线
        const weeklyData = [];
        const weeklyDates = [];
        for (let i = 0; i < data.opens.length; i += 5) {
          const weekSlice = {
            opens: data.opens.slice(i, i + 5),
            closes: data.closes.slice(i, i + 5),
            highs: data.highs.slice(i, i + 5),
            lows: data.lows.slice(i, i + 5),
          };
          if (weekSlice.opens.length === 0) continue;
          weeklyData.push({
            open: weekSlice.opens[0],
            close: weekSlice.closes[weekSlice.closes.length - 1],
            high: Math.max(...weekSlice.highs),
            low: Math.min(...weekSlice.lows),
          });
          weeklyDates.push(data.dates[i]);
        }
        ohlc = weeklyData.map(d => [d.open, d.close, d.low, d.high]);
        dates = weeklyDates;
        // 构建日→周日期映射
        dateMap = {};
        for (let i = 0; i < data.dates.length; i++) {
          const wk = Math.floor(i / 5);
          if (wk < weeklyDates.length) dateMap[data.dates[i]] = weeklyDates[wk];
        }
      } else {
        ohlc = data.opens.map((o, i) => [o, data.closes[i], data.lows[i], data.highs[i]]);
        dates = data.dates;
      }

      chart.setOption({
        backgroundColor: "transparent",
        grid: { left: 60, right: 30, top: 20, bottom: 50 },
        xAxis: {
          type: "category",
          data: dates,
          axisLabel: { color: "#5f6b8a", fontSize: 11 },
          axisLine: { lineStyle: { color: "rgba(255,255,255,.06)" } }
        },
        yAxis: {
          type: "value",
          scale: true,
          axisLabel: { color: "#5f6b8a", fontSize: 11 },
          splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } }
        },
        series: [{
          name: "K线",
          type: "candlestick",
          data: ohlc,
          itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e", borderWidth: 1.5 }
        }],
        tooltip: {
          trigger: "axis",
          backgroundColor: "rgba(15,19,48,.96)",
          borderColor: "rgba(255,255,255,.1)",
          textStyle: { color: "#e0e4f0" },
          formatter: params => {
            const p = params?.[0];
            const d = p?.data;
            if (!d || !Array.isArray(d)) return p?.axisValue || "";
            return `${p.axisValue}<br/>开: ${d[1]} 收: ${d[2]}<br/>低: ${d[3]} 高: ${d[4]}`;
          }
        },
        dataZoom: [
          { type: "inside", start: period === "week" ? 0 : 50, end: 100 }
        ]
      });
      console.log("[Modal] setOption in", (performance.now() - t3).toFixed(1) + "ms, total:", (performance.now() - t0).toFixed(1) + "ms");
      ChartManager.manageResize(chart);
      addTradeSignals(chart, chartEl, code, dates, dateMap);
    }
  } catch (e) {
    if (e.name === "AbortError") { console.log("[Modal] aborted"); return; }
    console.error("[Modal] error:", e);
    if (chartEl.isConnected) chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#5f6b8a;">加载失败</div>';
  } finally {
    if (_klineModalAbort === ac) _klineModalAbort = null;
  }
}

// 为指数卡片添加点击事件（市场总览页面）
let _indexCardKlineBound = false;
function bindIndexCardKlineEvents() {
  if (_indexCardKlineBound) return;
  _indexCardKlineBound = true;
  const indexCards = $("#indexCards");
  if (!indexCards) return;

  indexCards.addEventListener("click", (e) => {
    const card = e.target.closest(".index-card");
    if (!card) return;
    const code = card.dataset.code || card.querySelector(".idx-code")?.textContent;
    const name = card.querySelector(".idx-name")?.textContent;
    if (code) showKlineModal(code, name);
  });
}

// 为板块列表添加点击事件 (只绑定一次)
let _sectorKlineBound = false;
function bindSectorKlineEvents() {
  if (_sectorKlineBound) return;
  _sectorKlineBound = true;
  document.addEventListener("click", (e) => {
    const item = e.target.closest(".flow-item, .sector-row");
    if (!item) return;
    const code = item.dataset.code;
    const name = item.dataset.name || item.querySelector(".name")?.textContent;
    if (code) showKlineModal(code, name);
  });
}

// ============ 风控中心 ============

async function loadRiskDashboard() {
  if (!riskPnlChart) {
    riskPnlChart = ChartManager.getChart("chartRiskPnl", "risk");
    riskExposureChart = ChartManager.getChart("chartRiskExposure", "risk");
    riskStressChart = ChartManager.getChart("chartRiskStress", "risk");
    ChartManager.manageResize(riskPnlChart);
    ChartManager.manageResize(riskExposureChart);
    ChartManager.manageResize(riskStressChart);
  }

  const [status, limits, alerts] = await Promise.all([
    fetch("/api/risk/status").then(r => r.json()).catch(() => null),
    fetch("/api/risk/limits").then(r => r.json()).catch(() => null),
    fetch("/api/risk/alerts?limit=20").then(r => r.json()).catch(() => []),
  ]);

  if (status) updateRiskStatusBar(status);
  if (limits) renderLimitPanels(limits);
  if (status) renderPosList(status);
  if (alerts) renderAlertFeed(alerts);
  if (status?.positions?.dailySnapshots) renderPnlChart(status.positions.dailySnapshots);
  if (status?.exposure) renderExposureChart(status.exposure);

  riskTickTimer = setInterval(async () => {
    const s = await fetch("/api/risk/status").then(r => r.json()).catch(() => null);
    if (s) updateRiskStatusBar(s);
    // 刷新预警Feed (自动推送基础上再定时拉取)
    const alerts = await fetch("/api/risk/alerts?limit=20").then(r => r.json()).catch(() => []);
    renderAlertFeed(alerts);
  }, 15000);
  TimerManager.register('riskTick', riskTickTimer, 'risk');
}

function updateRiskStatusBar(s) {
  const equity = s.positions?.equity || 0;
  const initialCapital = 1000000; // 初始100万
  const totalReturn = equity - initialCapital;
  const totalReturnPct = initialCapital > 0 ? (totalReturn / initialCapital * 100) : 0;
  const dailyPnl = s.pnl?.daily || 0;
  const dailyPnlPct = equity > 0 ? (dailyPnl / (equity - dailyPnl) * 100) : 0;

  // Hero cards
  $("#riskHeroEquity").textContent = (equity / 1e4).toFixed(1) + "万";
  const dailyEl = $("#riskHeroDaily");
  dailyEl.textContent = (dailyPnl >= 0 ? "+" : "") + (dailyPnl / 1e4).toFixed(2) + "万";
  dailyEl.className = "risk-hero-value " + (dailyPnl >= 0 ? "up" : "down");
  const dailyPctEl = $("#riskHeroDailyPct");
  dailyPctEl.textContent = (dailyPnlPct >= 0 ? "+" : "") + dailyPnlPct.toFixed(2) + "%";
  dailyPctEl.className = "risk-hero-sub " + (dailyPnlPct >= 0 ? "up" : "down");
  const totalEl = $("#riskHeroTotal");
  totalEl.textContent = (totalReturnPct >= 0 ? "+" : "") + totalReturnPct.toFixed(2) + "%";
  totalEl.className = "risk-hero-value " + (totalReturnPct >= 0 ? "up" : "down");
  const totalAmtEl = $("#riskHeroTotalAmt");
  totalAmtEl.textContent = (totalReturn >= 0 ? "+" : "") + (totalReturn / 1e4).toFixed(1) + "万";
  totalAmtEl.className = "risk-hero-sub " + (totalReturn >= 0 ? "up" : "down");
  $("#riskHeroPos").textContent = (s.exposure?.total || 0).toFixed(0) + "%";
  $("#riskHeroCount").textContent = (s.positions?.positions || []).length;

  // Alert card
  const alertCount = s.alerts?.today || 0;
  const alertCard = $("#riskHeroAlert");
  if (alertCount > 0) {
    alertCard.style.display = "";
    $("#riskHeroAlertCount").textContent = alertCount;
  } else {
    alertCard.style.display = "none";
  }
}

function renderLimitPanels(limits) {
  const sliders = [
    { key: "maxTotalPosition", label: "总仓位上限", pct: true },
    { key: "maxSinglePosition", label: "单股上限", pct: true },
    { key: "maxIndustryExposure", label: "单行业上限", pct: true },
    { key: "maxDailyLoss", label: "日亏损上限", pct: true },
  ];
  $("#limitSliders").innerHTML = sliders.map(s =>
    `<div class="limit-slider-row">
      <span>${s.label}</span>
      <input type="range" min="1" max="100" value="${(limits[s.key] * 100).toFixed(0)}" data-key="${s.key}" oninput="this.nextElementSibling.textContent=(this.value)+'%'" />
      <span class="val">${(limits[s.key] * 100).toFixed(0)}%</span>
    </div>`
  ).join("");

  const toggles = [
    { key: "enableSTFilter", label: "过滤ST股票" },
    { key: "enableSuspensionFilter", label: "过滤停牌股票" },
    { key: "enableNewStockFilter", label: "过滤次新股" },
  ];
  $("#limitToggles").innerHTML = toggles.map(t =>
    `<div class="limit-toggle-row">
      <span>${t.label}</span>
      <input type="checkbox" data-key="${t.key}" ${limits[t.key] ? "checked" : ""} />
    </div>`
  ).join("");
}

function renderAlertFeed(alerts) {
  if (!alerts.length) { $("#alertList").innerHTML = '<div style="padding:12px;color:#5f6b8a;text-align:center;">暂无预警</div>'; return; }
  const icons = { price_limit: "涨跌停", volume_explosion: "量暴", price_gap: "跳空", portfolio_loss: "亏损", consecutive_decline: "连跌", near_limit: "近停" };
  $("#alertList").innerHTML = alerts.map(a =>
    `<div class="alert-item ${a.severity}">
      <span style="color:#5f6b8a;">${a.time?.slice(11,16) || ""}</span>
      <b>${icons[a.type] || a.type}</b>
      ${a.code ? `<span style="color:#818cf8;">${a.code}</span>` : ""}
      ${a.message}
    </div>`
  ).join("");
}

function renderPnlChart(snapshots) {
  riskPnlChart.setOption({
    backgroundColor: "transparent",
    title: { text: "权益曲线", left: 10, top: 10, textStyle: { color: "#c8cdf0", fontSize: 13, fontWeight: 600 } },
    grid: { left: 10, right: 16, top: 40, bottom: 28 },
    xAxis: { type: "category", data: snapshots.map(s => s.date?.slice(5)), axisLabel: { color: "#5f6b8a", fontSize: 10 } },
    yAxis: { axisLabel: { color: "#5f6b8a", fontSize: 10, formatter: v => (v / 1e4).toFixed(0) + "万" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
    tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0", fontSize: 12 } },
    series: [{
      type: "line", data: snapshots.map(s => s.equity), smooth: true, symbol: "none",
      lineStyle: { color: "#818cf8", width: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(99,102,241,.3)" }, { offset: 1, color: "rgba(99,102,241,.02)" }]) },
    }],
  }, true);
}

function renderExposureChart(exposure) {
  if (!exposure.byIndustry?.length) return;
  riskExposureChart.setOption({
    backgroundColor: "transparent",
    title: { text: "行业暴露", left: 10, top: 10, textStyle: { color: "#c8cdf0", fontSize: 13, fontWeight: 600 } },
    tooltip: { trigger: "item", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", textStyle: { color: "#e0e4f0" }, formatter: "{b}: {c} ({d}%)" },
    series: [{
      type: "pie", radius: ["45%", "72%"], center: ["50%", "55%"],
      data: exposure.byIndustry.map(e => ({ name: e.industry, value: e.value })),
      label: { color: "#8890b5", fontSize: 10 }, itemStyle: { borderColor: "rgba(15,19,48,.96)", borderWidth: 2 },
    }],
  }, true);
}

// Event bindings for risk page
$("#btnRiskCheck")?.addEventListener("click", async () => {
  const code = $("#riskCheckCode").value.trim();
  if (!code) return toast("请输入股票代码");
  const result = await fetch("/api/risk/check", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  }).then(r => r.json());
  const el = $("#riskCheckResult");
  el.innerHTML = result.checks?.map(c =>
    `<div class="result-row ${c.passed ? (c.severity === "warning" ? "warn" : "pass") : "fail"}">
      <span>${c.name}</span><span>${c.passed ? "✓" : "✗"} ${c.reason}</span>
    </div>`
  ).join("") + `<div style="margin-top:8px;font-weight:600;color:${result.passed ? '#4ade80' : '#ef4444'}">${result.passed ? '✅ 通过检查' : '❌ 被风控拦截'}</div>`;
});

$("#btnSaveLimits")?.addEventListener("click", async () => {
  const patch = {};
  $$("#limitSliders input[type=range]").forEach(s => { patch[s.dataset.key] = +s.value / 100; });
  $$("#limitToggles input[type=checkbox]").forEach(c => { patch[c.dataset.key] = c.checked; });
  const result = await fetch("/api/risk/limits", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then(r => r.json());
  toast(result.error ? "保存失败: " + result.error : "限额配置已保存");
});

$("#btnClearAlerts")?.addEventListener("click", async () => {
  await fetch("/api/risk/alerts/clear", { method: "POST" });
  $("#alertList").innerHTML = '<div style="padding:12px;color:#5f6b8a;text-align:center;">暂无预警</div>';
  toast("预警已清除");
});

$("#btnStressTest")?.addEventListener("click", async () => {
  const btn = $("#btnStressTest");
  btn.textContent = "计算中..."; btn.disabled = true;
  const scenarios = [...$("#stressScenario").selectedOptions].map(o => o.value);
  const result = await fetch("/api/risk/stress-test", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarios }),
  }).then(r => r.json());

  if (result.error) {
    toast(result.error);
    btn.textContent = "运行压力测试"; btn.disabled = false;
    return;
  }

  if (riskStressChart && result.stressTests) {
    riskStressChart.setOption({
      backgroundColor: "transparent",
      title: { text: "压力测试 — 情景分析", left: 10, top: 10, textStyle: { color: "#c8cdf0", fontSize: 13, fontWeight: 600 } },
      grid: { left: 10, right: 60, top: 40, bottom: 28 },
      xAxis: { type: "category", data: result.stressTests.map(s => s.scenario.replace(/[0-9]/g,"").slice(0,4)), axisLabel: { color: "#5f6b8a", fontSize: 10 } },
      yAxis: { axisLabel: { color: "#5f6b8a", fontSize: 10, formatter: v => v + "%" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.04)" } } },
      tooltip: { trigger: "axis", backgroundColor: "rgba(15,19,48,.96)", borderColor: "rgba(255,255,255,.1)", formatter: ps => {
        let s = `<b>${ps[0].name}</b><br/>`;
        ps.forEach(p => { s += `${p.marker} ${p.seriesName}: <b>${p.data}%</b><br/>`; });
        return s;
      }},
      series: [
        { name: "预期损失", type: "bar", data: result.stressTests.map(s => +s.expectedLoss || 0), itemStyle: { color: "#ef4444", borderRadius: [4,4,0,0] }, label: { show: true, position: "top", color: "#ef4444", fontSize: 10, formatter: "{c}%" } },
        { name: "VaR 95", type: "bar", data: result.stressTests.map(s => s.stressedVaR95 || 0), itemStyle: { color: "#6366f1", borderRadius: [4,4,0,0] }, label: { show: true, position: "top", color: "#818cf8", fontSize: 10, formatter: "{c}%" } },
      ],
    }, true);
  }

  // 白话解读压力测试
  let stressPlain = "";
  if (result.stressTests?.length) {
    const worst = result.stressTests.reduce((a, b) => (Math.abs(b.expectedLoss) > Math.abs(a.expectedLoss) ? b : a), result.stressTests[0]);
    const worstLoss = Math.abs(worst?.expectedLoss || 0);
    if (worstLoss > 25) {
      stressPlain = `⚠️ 极端行情下可能亏<b style="color:#ef4444">${worstLoss}%</b>——风险偏高，建议降低仓位或设置更紧的止损。`;
    } else if (worstLoss > 10) {
      stressPlain = `⚡ 极端行情下预计亏<b style="color:#f59e0b">${worstLoss}%</b>——风险适中，仓位还在可控范围内。`;
    } else {
      stressPlain = `✅ 极端行情下最多亏<b style="color:#4ade80">${worstLoss}%</b>——防守做得不错，抗跌能力较强。`;
    }
  }
  $("#stressResults").innerHTML = (result.monteCarlo
    ? `<div style="margin-top:8px;font-size:11px;color:#5f6b8a;">MC VaR 95: <b style="color:#f87171">${result.monteCarlo.var95}%</b> &nbsp; VaR 99: <b style="color:#ef4444">${result.monteCarlo.var99}%</b> &nbsp; | &nbsp; 组合波动: <b style="color:#818cf8">${result.portfolioVol}%</b></div>`
    : "") + (stressPlain ? `<div class="plain-explain" style="margin-top:8px;font-size:13px;">💡 ${stressPlain}</div>` : "");
  btn.textContent = "运行压力测试"; btn.disabled = false;
});

$("#btnGenerateReport")?.addEventListener("click", async () => {
  const btn = $("#btnGenerateReport");
  btn.textContent = "生成中..."; btn.disabled = true;
  const report = await fetch("/api/risk/report").then(r => r.json());
  const m = report.summary || {};
  $("#reportMetrics").innerHTML = `<div class="result-row"><span>累计收益</span><span style="color:${m.totalReturn>=0?'#f87171':'#4ade80'}">${(m.totalReturn||0).toFixed(1)}%</span></div>
    <div class="result-row"><span>夏普比率</span><span style="color:#8890b5">${m.sharpe||0}</span></div>
    <div class="result-row"><span>最大回撤</span><span style="color:#ef4444">${m.maxDrawdown||0}%</span></div>
    <div class="result-row"><span>组合Beta</span><span style="color:#8890b5">${m.beta||0}</span></div>
    <div class="result-row"><span>胜率</span><span style="color:${m.winRate>=50?'#4ade80':'#f87171'}">${m.winRate||0}%</span></div>
    <div class="result-row"><span>盈亏比</span><span style="color:#8890b5">${m.profitFactor||0}</span></div>`;
  if (report.recommendations) {
    $("#reportMetrics").innerHTML += `<div style="margin-top:10px;">${report.recommendations.map(r =>
      `<div class="alert-item ${r.level}" style="margin-top:4px;">${r.text}</div>`
    ).join("")}</div>`;
  }
  btn.textContent = "生成报告"; btn.disabled = false;
  toast("报告已生成");
});

// 自动填价: 输入代码后自动获取现价
$("#posCode")?.addEventListener("blur", async () => {
  const code = $("#posCode").value.trim();
  if (!code || code.length < 6) return;
  const quotes = await fetch(`/api/quote?codes=${code}`).then(r => r.json()).catch(() => []);
  if (quotes[0]?.price) {
    $("#posPrice").value = quotes[0].price.toFixed(2);
  }
});

// 买入建仓
$("#btnOpenPos")?.addEventListener("click", async () => {
  const code = $("#posCode").value.trim();
  const shares = $("#posShares").value;
  const price = $("#posPrice").value;
  if (!code || !shares || !price) return toast("请填写代码/股数/价格");
  const btn = $("#btnOpenPos");
  btn.textContent = "提交中..."; btn.disabled = true;
  const result = await fetch("/api/risk/position/open", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, shares: +shares, price: +price }),
  }).then(r => r.json());
  if (result.error) { toast("建仓失败: " + result.error); }
  else { toast(`已买入 ${code} ${shares}股 @${price}`); loadRiskDashboard(); }
  btn.textContent = "买入建仓"; btn.disabled = false;
});

// 平仓 (事件委托 — 按钮在动态列表中)
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-close-pos");
  if (!btn) return;
  const code = btn.dataset.code;
  const price = prompt(`平仓 ${code} 价格 (当前价):`, btn.dataset.price);
  if (!price) return;
  const result = await fetch("/api/risk/position/close", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, price: +price }),
  }).then(r => r.json());
  if (result.error) { toast("平仓失败: " + result.error); }
  else { toast(`已平仓 ${code} 盈亏: ${result.pnl > 0 ? "+" : ""}${result.pnl.toFixed(0)}`); loadRiskDashboard(); }
});

// 渲染持仓列表
function renderPosList(status) {
  const positions = status?.positions?.positions || [];
  const equity = status?.positions?.equity || 1;
  const el = $("#posList");
  if (!positions.length) {
    el.innerHTML = '<div style="color:#5f6b8a;text-align:center;padding:12px;">暂无持仓，请先买入建仓</div>';
    return;
  }
  el.innerHTML = `<table style="width:100%;font-size:12px;color:#c8cdf0;">
    <thead><tr style="color:#5f6b8a;font-size:11px;">
      <th>代码</th><th>名称</th><th>持仓</th><th>成本</th><th>现价</th><th>市值</th><th>盈亏</th><th>占比</th><th>操作</th>
    </tr></thead>
    <tbody>${positions.map(p => {
      const pnlColor = p.pnl >= 0 ? '#f87171' : '#4ade80';
      const weight = equity > 0 ? (p.marketValue / equity * 100).toFixed(1) : 0;
      return `<tr>
        <td style="color:#818cf8;cursor:pointer;text-decoration:underline;" class="pos-code-link" data-code="${p.code}" data-name="${p.name}">${p.code}</td>
        <td>${p.name}</td>
        <td>${p.shares}股</td>
        <td>${p.avgCost.toFixed(2)}</td>
        <td>${p.currentPrice.toFixed(2)}</td>
        <td>${(p.marketValue/1e4).toFixed(1)}万</td>
        <td style="color:${pnlColor}">${p.pnl>=0?'+':''}${(p.pnl/1e4).toFixed(1)}万 (${p.pnlPct>=0?'+':''}${p.pnlPct.toFixed(1)}%)</td>
        <td>${weight}%</td>
        <td><button class="btn-close-pos small-btn" data-code="${p.code}" data-price="${p.currentPrice}" style="color:#ef4444;border-color:rgba(239,68,68,.3);">平仓</button></td>
      </tr>`;
    }).join("")}</tbody></table>`;

  // 为持仓股票代码绑定K线图弹窗事件
  el.querySelectorAll(".pos-code-link").forEach(link => {
    link.addEventListener("click", () => {
      const code = link.dataset.code;
      const name = link.dataset.name;
      showKlineModal(code, name);
    });
  });
}

$("#btnExportReport")?.addEventListener("click", async () => {
  const report = await fetch("/api/risk/report?export=true").then(r => r.json());
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `risk-report-${new Date().toISOString().slice(0,10)}.json` });
  a.click(); URL.revokeObjectURL(a.href);
  toast("报告已下载");
});

// 折叠面板
$$(".risk-fold-head").forEach(head => head.addEventListener("click", function() {
  const fold = this.closest(".risk-fold");
  const body = fold.querySelector(".risk-fold-body");
  if (body.style.display === "none") {
    body.style.display = "";
    fold.classList.add("open");
    // 如果打开压力测试面板，resize图表
    if (fold.dataset.fold === "stress" && riskStressChart) riskStressChart.resize();
    if (fold.dataset.fold === "report" && riskPnlChart) riskPnlChart.resize();
  } else {
    body.style.display = "none";
    fold.classList.remove("open");
  }
}));

// 风控等级预设
const RISK_PRESETS = {
  conservative: { maxTotalPosition: 0.50, maxSinglePosition: 0.10, maxIndustryExposure: 0.20, maxDailyLoss: 0.03, maxPositionsCount: 8 },
  balanced:    { maxTotalPosition: 0.80, maxSinglePosition: 0.20, maxIndustryExposure: 0.35, maxDailyLoss: 0.05, maxPositionsCount: 15 },
  aggressive:  { maxTotalPosition: 0.95, maxSinglePosition: 0.30, maxIndustryExposure: 0.50, maxDailyLoss: 0.08, maxPositionsCount: 25 },
};

$$(".risk-lvl-btn").forEach(btn => btn.addEventListener("click", async function() {
  const level = this.dataset.level;
  const preset = RISK_PRESETS[level];
  if (!preset) return;

  // 更新按钮状态
  $$(".risk-lvl-btn").forEach(b => b.classList.remove("active"));
  this.classList.add("active");

  // 保存到服务器
  const result = await fetch("/api/risk/limits", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preset),
  }).then(r => r.json()).catch(() => null);

  if (result && !result.error) {
    const labels = { conservative: "保守型", balanced: "平衡型", aggressive: "激进型" };
    toast(`已切换为 ${labels[level]} 风控等级`);
    // 刷新限额面板
    const limits = await fetch("/api/risk/limits").then(r => r.json()).catch(() => null);
    if (limits) renderLimitPanels(limits);
  }
}));

// ============ 组合分析 ============
$("#btnAnalyzePortfolio")?.addEventListener("click", async function () {
  const btn = this;
  const codesInput = $("#portfolioCodes").value.trim();
  if (!codesInput) { toast("请输入股票代码"); return; }

  const codes = codesInput.split(/[,，\s]+/).filter(c => /^\d{6}$/.test(c));
  if (codes.length === 0) { toast("请输入有效的6位股票代码"); return; }
  if (codes.length > 20) { toast("最多支持20只股票"); return; }

  btn.disabled = true;
  btn.textContent = "分析中...";

  try {
    const resp = await fetch("/api/portfolio/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes }),
    });
    const data = await resp.json();
    if (data.error) { toast(data.error); return; }

    // 渲染组合概览
    const summaryEl = $("#portfolioSummary");
    const summaryContent = $("#portfolioSummaryContent");
    summaryEl.style.display = "block";

    const s = data.summary;
    summaryContent.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;">
        <div style="text-align:center;padding:12px;background:rgba(255,255,255,.03);border-radius:8px;">
          <div style="font-size:24px;font-weight:700;color:#c8cdf0;">${s.totalStocks}</div>
          <div style="font-size:12px;color:#8890b5;">股票数量</div>
        </div>
        <div style="text-align:center;padding:12px;background:rgba(255,255,255,.03);border-radius:8px;">
          <div style="font-size:24px;font-weight:700;color:${s.avgChange >= 0 ? '#ef4444' : '#22c55e'};">${s.avgChange}%</div>
          <div style="font-size:12px;color:#8890b5;">平均涨跌</div>
        </div>
        <div style="text-align:center;padding:12px;background:rgba(255,255,255,.03);border-radius:8px;">
          <div style="font-size:24px;font-weight:700;color:${s.riskColor};">${s.riskLevel}</div>
          <div style="font-size:12px;color:#8890b5;">风险等级</div>
        </div>
        <div style="text-align:center;padding:12px;background:rgba(255,255,255,.03);border-radius:8px;">
          <div style="font-size:24px;font-weight:700;color:#818cf8;">${s.diversification}%</div>
          <div style="font-size:12px;color:#8890b5;">分散化评分</div>
        </div>
      </div>
      <div style="margin-top:12px;padding:8px 12px;background:rgba(99,102,241,.08);border-radius:8px;font-size:13px;">
        <b>信号分布:</b> 买入 ${s.buySignals} · 卖出 ${s.sellSignals} · 中性 ${s.neutralSignals} · 偏向 <span style="color:${s.suggestion === '偏多' ? '#ef4444' : s.suggestion === '偏空' ? '#22c55e' : '#8890b5'}">${s.suggestion}</span>
      </div>
    `;

    // 渲染个股详情
    const stocksEl = $("#portfolioStocks");
    const stocksContent = $("#portfolioStocksContent");
    stocksEl.style.display = "block";

    let stocksHtml = '<div style="display:grid;gap:8px;">';
    data.stocks.forEach(stock => {
      const chgColor = (stock.changePct || 0) >= 0 ? "#ef4444" : "#22c55e";
      const signal = stock.analysis?.signals?.consensus || "neutral";
      const signalColor = signal.includes("buy") ? "#22c55e" : signal.includes("sell") ? "#ef4444" : "#8890b5";
      stocksHtml += `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(255,255,255,.03);border-radius:8px;">
          <div>
            <span style="font-weight:600;color:#c8cdf0;">${stock.name}</span>
            <span style="margin-left:8px;font-size:12px;color:#8890b5;">${stock.code}</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-weight:600;color:${chgColor};">${stock.price} (${stock.changePct >= 0 ? '+' : ''}${stock.changePct}%)</span>
            <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:${signalColor}20;color:${signalColor};">${signal}</span>
          </div>
        </div>
      `;
    });
    stocksHtml += '</div>';
    stocksContent.innerHTML = stocksHtml;

  } catch (e) {
    toast("分析失败: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "分析组合";
  }
});

// ============ 启动 ============
__diagStep("启动: checkAIConfigured");
checkAIConfigured();
__diagStep("启动: connectWebSocket");
connectWebSocket();
__diagStep("启动: loadMarketOverview");
loadMarketOverview().then(() => {
  __diagStep("启动完成 ✓");
  var el = document.getElementById('__loading');
  if (el) setTimeout(() => el.style.display = 'none', 500);
}).catch(e => {
  __diagStep("启动失败: " + e.message);
});
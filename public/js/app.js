// 量化交易平台 v4 — 实时资金流 + 动态界面
// 全局 fetch 默认携带 Cookie
(function(){
  var _fetch = window.fetch;
  window.fetch = function(url, opts) {
    opts = opts || {};
    if (url && typeof url === 'string' && url.startsWith('/api/')) {
      opts.credentials = 'include';
    }
    return _fetch.call(window, url, opts);
  };
})();
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
const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
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
          msg.quotes.forEach(q => applyWsIndexTick(q));
          _flushTicks();
        } else if (msg.type === "quote" && msg.data) {
          _tickBuffer.push({ code: msg.code, data: msg.data });
          applyWsIndexTick(msg.data);
          if (_tickBuffer.length > TICK_BUFFER_MAX) _tickBuffer.shift();
          if (!_rafPending) {
            _rafPending = true;
            requestAnimationFrame(_flushTicks);
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

// ============ 页面注册表 (模块化页面管理) ============
const PageRegistry = {
  _pages: {},

  register(name, module) {
    this._pages[name] = module;
  },

  async activate(name) {
    const currentPage = document.querySelector(".page.active");
    const prevPage = currentPage ? currentPage.id.replace("page-", "") : null;

    // 清理旧页面
    if (prevPage && prevPage !== name) {
      const prevMod = this._pages[prevPage];
      if (prevMod?.cleanup) prevMod.cleanup();
      ChartManager.disposePage(prevPage);
      TimerManager.clearByPage(prevPage);
    }

    // DOM切换
    $$(".nav-btn").forEach(b => b.classList.remove("active"));
    const btn = $(`.nav-btn[data-page="${name}"]`);
    if (btn) btn.classList.add("active");
    $$(".page").forEach(p => { p.classList.remove("active"); p.style.animation = "none"; });
    const pageEl = $(`#page-${name}`);
    if (pageEl) { pageEl.classList.add("active"); pageEl.style.animation = "pageIn .4s ease"; }

    // 移动端：切换页面后关闭汉堡菜单
    document.body.classList.remove('nav-open');
    var t = document.getElementById('hamburgerToggle');
    if (t) t.setAttribute('aria-expanded', 'false');

    // 激活新页面
    const mod = this._pages[name];
    if (mod?.init) await mod.init();
  }
};
window.PageRegistry = PageRegistry;

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
  PageRegistry.activate(page);
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
  const pageMap = { "1": "market", "2": "stock", "3": "fundflow", "4": "backtest", "5": "compare", "6": "scan", "7": "etf", "8": "trend", "9": "limitup", "0": "hotmoney", "n": "news", "q": "quantlab" };
  if (pageMap[key]) switchPage(pageMap[key]);
});

function navigateToStock(code) {
  console.log("[Nav] navigateToStock called with code:", code);
  const input = $("#stockCode");
  if (input) input.value = code;
  // switchPage("stock") 内部已调用 loadStockAnalysis()，无需重复调用
  try { switchPage("stock"); } catch (e) { console.error("[Nav] switchPage error:", e); }
}

// 从自选股跳转: /?code=000001 自动打开个股分析
(function() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code && code.trim()) {
    // 延迟执行，等 PageRegistry 初始化完毕
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => navigateToStock(code.trim()), 500);
    });
  }
})();

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

// 清除市场页面的 "加载中..." 占位符，替换为错误提示
function clearMarketLoading(msg) {
  var errHtml = '<div style="color:#ef4444;text-align:center;padding:20px;font-size:13px;">⚠️ ' + (msg || '数据加载失败') + '</div>';
  var els = document.querySelectorAll('#indexCards, #topFlowSectors, #bottomFlowSectors, #topSectors, #bottomSectors');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el) {
      var text = (el.textContent || '').trim();
      if (text === '加载中...' || text === '加载指数数据中...' || text.includes('加载')) {
        el.innerHTML = errHtml;
      }
    }
  }
}

async function loadMarketOverview() {
  if (!indexTrendChart || indexTrendChart.isDisposed()) {
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
      fetch("/api/market/summary", { credentials: "include" }).then(r => r.json()).catch(() => null),
      fetch("/api/market/sector-flow", { credentials: "include" }).then(r => r.json()).catch(() => []),
      fetch("/api/market/concept-flow", { credentials: "include" }).then(r => r.json()).catch(() => []),
      fetch("/api/market/breadth", { credentials: "include" }).then(r => r.json()).catch(() => null),
    ]);
    if (!summary?.indices?.length) {
      // 判断是认证失败还是数据失败
      if (summary?.requireAuth || summary?.error === "未授权") {
        clearMarketLoading("登录已过期，请重新登录");
        toast("登录已过期，正在跳转...");
        setTimeout(function(){ window.location.href = '/login.html'; }, 1500);
        return;
      }
      clearMarketLoading("数据加载失败，请刷新页面重试");
      toast("市场数据加载失败");
      return;
    }
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
    ).join("") || '<div style="color:#999999;text-align:center;padding:16px;">暂无数据</div>';
    $("#bottomSectors").innerHTML = (summary.bottomSectors || []).map(s =>
      `<div class="sector-row"><span class="sct-name">${s.name}</span><span class="sct-chg ${(s.changePct||0)>=0?'up':'down'}">${(s.changePct>=0?'+':'')}${(s.changePct||0).toFixed(2)}%</span></div>`
    ).join("") || '<div style="color:#999999;text-align:center;padding:16px;">暂无数据</div>';

    renderSectorHeat(summary.sectors);
    loadIndexTrend("000001", "上证指数");
    const firstCard = $("#indexCards")?.querySelector(".index-card");
    if (firstCard) firstCard.classList.add("selected");

    // 绑定K线图点击事件
    bindIndexCardKlineEvents();
    bindSectorKlineEvents();
    __diagStep("loadMarketOverview: 渲染完成 ✓");

  } catch (e) {
    clearMarketLoading("网络错误，请检查连接后刷新");
    toast("市场总览加载失败: " + e.message);
    __diagStep("loadMarketOverview 错误: " + e.message);
  }
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
    ffEl.style.background = isOutflow ? "rgba(34,197,94,.12)" : isInflow ? "rgba(239,68,68,.12)" : "#F0F0F0";
    ffEl.style.color = isOutflow ? "#43A047" : isInflow ? "#E53935" : "#8890b5";
    ffEl.style.border = "1px solid " + (isOutflow ? "rgba(34,197,94,.25)" : isInflow ? "rgba(239,68,68,.25)" : "#F0F0F0");
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
        const riskColor = s.riskLevel === "低" ? "#43A047" : s.riskLevel === "中" ? "#fbbf24" : "#E53935";
        html += `<div style="padding:10px 12px;background:#F5F5F5;border:1px solid #F0F0F0;border-radius:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <b style="color:#c8cdf0;">${escapeHTML(s.name)}</b>
            <span style="font-size:11px;color:${riskColor};">${escapeHTML(s.riskLevel || '')}风险</span>
          </div>
          <p style="font-size:12px;color:#666666;margin:0;">${escapeHTML(s.reason)}</p>
          <div style="margin-top:6px;font-size:11px;color:#999999;">
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
    contentEl.innerHTML = html || '<p style="color:#666666;">暂无推荐</p>';
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
  // 保存指数代码供WebSocket实时更新
  window._indexCodes = summary.indices.map(i => i.code);

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
    title: { text: "行业板块主力资金净流入排行", left: 16, top: 10, textStyle: { color: "#1A1A2E", fontSize: 13, fontWeight: 600 } },
    grid: { left: 90, right: 60, top: 48, bottom: 30 },
    xAxis: { type: "value", axisLabel: { color: "#999999", fontSize: 10, formatter: v => (v/1e8).toFixed(0)+"亿" }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
    yAxis: { type: "category", data: top15.map(s => s.name), axisLabel: { color: "#666666", fontSize: 11 }, inverse: true },
    tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" },
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
  </div>`).join("") || '<div style="color:#999999;padding:12px;">暂无数据</div>';
}

function startMarketRefresh() {
  clearInterval(marketRefreshTimer);
  const interval = isTradingHours() ? 5000 : 15000;
  marketRefreshTimer = setInterval(refreshMarketCycle, interval);
  TimerManager.register('marketRefresh', marketRefreshTimer, 'market');
}

// WebSocket tick → 实时更新指数卡片
function applyWsIndexTick(q) {
  if (!q || !q.code) return;
  const idx = window._indexCodes?.indexOf(q.code);
  if (idx === undefined || idx < 0) return;
  const cards = $$("#indexCards .index-card");
  if (!cards[idx]) return;
  const priceEl = cards[idx].querySelector(".idx-price");
  const chgEl = cards[idx].querySelector(".idx-change");
  if (priceEl && q.price) priceEl.textContent = q.price.toFixed(2);
  if (chgEl && q.changePercent !== undefined) {
    const sign = q.changePercent >= 0 ? "+" : "";
    chgEl.textContent = `${sign}${q.changePercent.toFixed(2)}%`;
    chgEl.className = "idx-change " + (q.changePercent >= 0 ? "up" : "down");
  }
}

async function refreshMarketCycle() {
  try {
    const [summary, sectorFlow, conceptFlow, breadth] = await Promise.all([
      fetch("/api/market/summary", { credentials: "include" }).then(r => r.json()).catch(() => null),
      fetch("/api/market/sector-flow", { credentials: "include" }).then(r => r.json()).catch(() => []),
      fetch("/api/market/concept-flow", { credentials: "include" }).then(r => r.json()).catch(() => []),
      fetch("/api/market/breadth", { credentials: "include" }).then(r => r.json()).catch(() => null),
    ]);
    if (summary?.indices?.length) {
      updateLiveStatus(summary);
      updateWeatherBanner(summary);
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
    if (sectorFlow?.length) renderSectorFlowLists(sectorFlow);
    if (conceptFlow?.length) renderConceptFlow(conceptFlow);
  } catch(e) {}
}

async function loadIndexTrend(code, name) {
  if (!indexTrendChart || indexTrendChart.isDisposed()) {
    indexTrendChart = ChartManager.getChart("chartIndexTrend", "market");
  }
  if (!indexTrendChart) return;
  indexTrendChart.showLoading();
  try {
    const data = await fetch(`/api/index/kline?code=${code}&days=250`).then(r => r.json());
    if (data.error) { toast(data.error); return; }
    indexTrendChart.setOption({
      backgroundColor: "transparent",
      title: { text: `${name} 走势与技术指标`, left: 16, top: 14, textStyle: { color: "#1A1A2E", fontSize: 14, fontWeight: 600 } },
      grid: { left: 12, right: 12, top: 55, bottom: 35 },
      xAxis: { type: "category", data: data.dates, axisLabel: { color: "#999999", fontSize: 11 }, axisLine: { lineStyle: { color: "#EAEAEA" } } },
      yAxis: { type: "value", scale: true, axisLabel: { color: "#999999", fontSize: 11 }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
      tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" },
        axisPointer: { type: "cross", lineStyle: { color: "#EAEAEA", type: "dashed" } } },
      legend: { right: 16, top: 10, textStyle: { color: "#666666", fontSize: 11 } },
      series: [
        { name: "收盘", type: "line", data: data.closes, lineStyle: { color: "#1E88E5", width: 1.5 }, symbol: "none", smooth: true },
        { name: "MA5", type: "line", data: data.ma5, lineStyle: { color: "#E53935", width: 1 }, symbol: "none" },
        { name: "MA10", type: "line", data: data.ma10, lineStyle: { color: "#fbbf24", width: 1 }, symbol: "none" },
        { name: "MA20", type: "line", data: data.ma20, lineStyle: { color: "#8E24AA", width: 1 }, symbol: "none" },
        { name: "MA60", type: "line", data: data.ma60, lineStyle: { color: "#38bdf8", width: 1 }, symbol: "none" },
        { name: "BOLL上", type: "line", data: data.boll?.upper, lineStyle: { color: "#E53935", width: 1, type: "dashed" }, symbol: "none" },
        { name: "BOLL下", type: "line", data: data.boll?.lower, lineStyle: { color: "#43A047", width: 1, type: "dashed" }, symbol: "none" },
      ],
    }, true);
  } catch (e) { console.error("加载指数走势失败:", e); toast("加载指数走势失败"); } finally { indexTrendChart.hideLoading(); }
}

function renderSectorHeat(sectors) {
  if (!sectorHeatChart || !sectors?.length) return;
  const sorted = [...sectors].sort((a, b) => (b.changePct || 0) - (a.changePct || 0));
  sectorHeatChart.setOption({
    backgroundColor: "transparent",
    title: { text: "行业涨跌一览", left: 16, top: 14, textStyle: { color: "#1A1A2E", fontSize: 14, fontWeight: 600 } },
    grid: { left: 12, right: 30, top: 50, bottom: 60 },
    xAxis: { type: "category", data: sorted.map(s => s.name?.length > 5 ? s.name.slice(0, 5) : s.name), axisLabel: { color: "#999999", fontSize: 11, rotate: 60 } },
    yAxis: { type: "value", axisLabel: { color: "#999999", fontSize: 11, formatter: v => v.toFixed(1) + "%" }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
    tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" }, formatter: p => { const v = p[0]?.data?.value ?? p[0]?.data ?? 0; return `<b>${sorted[p[0].dataIndex].name}</b><br/>涨跌幅: ${v > 0 ? '+' : ''}${v.toFixed(2)}%`; } },
    series: [{ type: "bar", barMaxWidth: 24,
      data: sorted.map(s => ({ value: s.changePct || 0, itemStyle: { color: (s.changePct||0) >= 0 ? "#E53935" : "#43A047", borderRadius: (s.changePct||0) >= 0 ? [6, 6, 0, 0] : [0, 0, 6, 6] } })),
    }],
  }, true);
}

// ====================================================================
//  2. 个股分析
// ====================================================================
let stockKlineChart, stockMacdChart, stockRsiChart, stockObvChart;

let tvChart = null; // TradingView图表实例

function initStockChart() {
  // TradingView主K线图
  if (!tvChart) {
    tvChart = new TradingViewChart("chartStockKline");
    tvChart.init();
  }
  // ECharts副图
  stockMacdChart = ChartManager.getChart("chartStockMacd", "stock");
  stockRsiChart = ChartManager.getChart("chartStockRsi", "stock");
  stockObvChart = ChartManager.getChart("chartStockObv", "stock");
  ChartManager.manageResize(stockMacdChart);
  ChartManager.manageResize(stockRsiChart);
  ChartManager.manageResize(stockObvChart);

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
  if (!tvChart) initStockChart();
  const code = $("#stockCode").value.trim() || "600519";
  const period = [...$$("#page-stock .tag")].find(t => t.classList.contains("active"))?.dataset?.period || 365;
  if (!tvChart) { initStockChart(); }
  if (!tvChart) { console.warn("[Stock] tvChart is null, aborting"); return; }
  try {
    const [indData, scrData, btData, sigData, analysisData, adviceData] = await Promise.all([
      fetch(`/api/indicators?code=${code}&days=${period}`).then(r => r.json()).catch(() => null),
      fetch(`/api/screen?code=${code}`).then(r => r.json()).catch(() => null),
      fetch(`/api/backtest?code=${code}&strategy=ma_cross&days=${period}`).then(r => r.json()).catch(() => null),
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
    loadLongterm(code);

    const showMA = $(".ind-toggle[data-ind=ma]")?.checked;
    const showBOLL = $(".ind-toggle[data-ind=boll]")?.checked;
    const showMACD = $(".ind-toggle[data-ind=macd]")?.checked;
    const showRSI = $(".ind-toggle[data-ind=rsi]")?.checked;
    const showKDJ = $(".ind-toggle[data-ind=kdj]")?.checked;
    const showOBV = $(".ind-toggle[data-ind=obv]")?.checked;
    const showSAR = $(".ind-toggle[data-ind=sar]")?.checked;

    const ohlc = indData.opens.map((o, i) => [indData.opens[i], indData.closes[i], indData.lows[i], indData.highs[i]]);
    const klineSeries = [{
      name: "K线", type: "candlestick", data: ohlc,
      itemStyle: { color: "#E53935", color0: "#43A047", borderColor: "#E53935", borderColor0: "#43A047" },
    }];
    if (showMA) {
      [[indData.ma5, "MA5", "#E53935"], [indData.ma10, "MA10", "#fbbf24"], [indData.ma20, "MA20", "#8E24AA"], [indData.ma60, "MA60", "#38bdf8"]]
        .forEach(([d, n, c]) => d && klineSeries.push({ name: n, type: "line", data: d, lineStyle: { color: c, width: 1 }, symbol: "none" }));
    }
    if (showBOLL && indData.boll) {
      klineSeries.push({ name: "BOLL上", type: "line", data: indData.boll.upper, lineStyle: { color: "#E53935", width: 1, type: "dashed" }, symbol: "none" });
      klineSeries.push({ name: "BOLL下", type: "line", data: indData.boll.lower, lineStyle: { color: "#43A047", width: 1, type: "dashed" }, symbol: "none" });
    }
    if (showSAR && indData.sar) {
      klineSeries.push({ name: "SAR", type: "scatter", data: indData.sar,
        symbol: "circle", symbolSize: 4,
        itemStyle: { color: p => p.data > (indData.closes[p.dataIndex] || 0) ? "#43A047" : "#E53935" },
      });
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
          itemStyle: { color: "#E53935" },
          label: { show: true, position: "bottom", formatter: "买", color: "#E53935", fontSize: 11, fontWeight: 800 },
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
          itemStyle: { color: "#43A047" },
          label: { show: true, position: "top", formatter: "卖", color: "#43A047", fontSize: 11, fontWeight: 800 },
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
        itemStyle: { color: isBuy ? "#E53935" : "#43A047", shadowBlur: 14, shadowColor: isBuy ? "rgba(239,68,68,0.8)" : "rgba(34,197,94,0.8)" },
        label: { show: true, position: isBuy ? "bottom" : "top", formatter: isBuy ? "🔥买入" : "📉卖出", color: isBuy ? "#E53935" : "#43A047", fontSize: 13, fontWeight: 800, distance: 8 },
        z: 10,
      });
    }

    // TradingView K线图渲染
    tvChart.clearOverlays();
    const tvData = indData.dates.map((d, i) => ({
      time: d,
      open: indData.opens[i],
      high: indData.highs[i],
      low: indData.lows[i],
      close: indData.closes[i],
    }));
    tvChart.setData(tvData);

    // MA均线
    if (showMA) {
      [[indData.ma5, "#E53935", "MA5"], [indData.ma10, "#fbbf24", "MA10"], [indData.ma20, "#8E24AA", "MA20"], [indData.ma60, "#38bdf8", "MA60"]]
        .forEach(([d, c, n]) => {
          if (d) {
            const maData = indData.dates.map((dt, i) => ({ time: dt, value: d[i] })).filter(v => v.value != null);
            tvChart.addMA(maData, c, n);
          }
        });
    }

    // BOLL
    if (showBOLL && indData.boll) {
      const upperData = indData.dates.map((d, i) => ({ time: d, value: indData.boll.upper[i] })).filter(v => v.value != null);
      const lowerData = indData.dates.map((d, i) => ({ time: d, value: indData.boll.lower[i] })).filter(v => v.value != null);
      tvChart.addBoll(upperData, lowerData);
    }

    // 买卖信号
    const allSignals = [];
    if (btData?.signalPoints) {
      btData.signalPoints.forEach(p => {
        allSignals.push({ time: p.date, type: p.type });
      });
    }
    if (sigData?.consensus) {
      const lastDate = indData.dates[indData.dates.length - 1];
      if (sigData.consensus.includes("buy")) allSignals.push({ time: lastDate, type: "buy" });
      else if (sigData.consensus.includes("sell")) allSignals.push({ time: lastDate, type: "sell" });
    }
    tvChart.setSignals(allSignals);

    if (showMACD && indData.macd) {
      stockMacdChart.setOption({
        backgroundColor: "transparent", grid: { left: 12, right: 12, top: 10, bottom: 25 },
        xAxis: { type: "category", data: indData.dates, axisLabel: { color: "#999999", fontSize: 11 } },
        yAxis: { axisLabel: { color: "#999999", fontSize: 11 }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
        series: [
          { name: "DIF", type: "line", data: indData.macd.dif, lineStyle: { color: "#38bdf8", width: 1 }, symbol: "none" },
          { name: "DEA", type: "line", data: indData.macd.dea, lineStyle: { color: "#fbbf24", width: 1 }, symbol: "none" },
          { name: "MACD", type: "bar", data: indData.macd.macd, itemStyle: { color: p => p.data >= 0 ? "#E53935" : "#43A047" } },
        ],
        legend: { right: 16, top: 4, textStyle: { color: "#666666", fontSize: 11 } }, tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" } },
      }, true);
      $("#chartStockMacd").style.display = "block";
    } else { $("#chartStockMacd").style.display = "none"; }

    if (showRSI && indData.rsi) {
      stockRsiChart.setOption({
        backgroundColor: "transparent", grid: { left: 12, right: 12, top: 10, bottom: 25 },
        xAxis: { type: "category", data: indData.dates, axisLabel: { color: "#999999", fontSize: 11 } },
        yAxis: { min: 0, max: 100, axisLabel: { color: "#999999", fontSize: 11 }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
        series: [{ name: "RSI(14)", type: "line", data: indData.rsi, lineStyle: { color: "#8E24AA", width: 1.5 }, symbol: "none",
          markLine: { silent: true, symbol: "none", data: [{ yAxis: 70, lineStyle: { color: "#E53935", type: "dashed" } }, { yAxis: 30, lineStyle: { color: "#43A047", type: "dashed" } }] }
        }],
        tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" },
        axisPointer: { type: "cross", lineStyle: { color: "#EAEAEA", type: "dashed" } } },
      }, true);
      $("#chartStockRsi").style.display = "block";
    } else if (showKDJ && indData.kdj) {
      stockRsiChart.setOption({
        backgroundColor: "transparent", grid: { left: 12, right: 12, top: 10, bottom: 25 },
        xAxis: { type: "category", data: indData.dates, axisLabel: { color: "#999999", fontSize: 11 } },
        yAxis: { axisLabel: { color: "#999999", fontSize: 11 }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
        series: [
          { name: "K", type: "line", data: indData.kdj.k, lineStyle: { color: "#38bdf8", width: 1 }, symbol: "none" },
          { name: "D", type: "line", data: indData.kdj.d, lineStyle: { color: "#fbbf24", width: 1 }, symbol: "none" },
          { name: "J", type: "line", data: indData.kdj.j, lineStyle: { color: "#8E24AA", width: 1 }, symbol: "none" },
        ],
        legend: { right: 16, top: 4, textStyle: { color: "#666666", fontSize: 11 } }, tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" } },
      }, true);
      $("#chartStockRsi").style.display = "block";
    } else { $("#chartStockRsi").style.display = "none"; }

    if (showOBV && indData.obv) {
      if (stockObvChart && !stockObvChart.isDisposed()) {
        stockObvChart.setOption({
          backgroundColor: "transparent", grid: { left: 60, right: 12, top: 10, bottom: 25 },
          xAxis: { type: "category", data: indData.dates, axisLabel: { color: "#999999", fontSize: 11 } },
          yAxis: { axisLabel: { color: "#999999", fontSize: 11, formatter: v => (v/1e6).toFixed(0) + "M" }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
          series: [{
            name: "OBV", type: "line", data: indData.obv, lineStyle: { color: "#f59e0b", width: 1.5 }, symbol: "none",
            areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: "rgba(245,158,11,0.15)" }, { offset: 1, color: "rgba(245,158,11,0)" }]
            } },
          }],
          tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" },
            formatter: ps => `${ps[0].axisValue}<br/>OBV: <b>${(ps[0].data/1e6).toFixed(1)}M</b>` },
        }, true);
        $("#chartStockObv").style.display = "block";
      }
    } else {
      $("#chartStockObv").style.display = "none";
    }

  } catch (e) { toast("分析失败: " + e.message); }
}

function updateSignalBar(sig) {
  const bar = $("#signalBar");
  if (!sig || !sig.consensus) { bar.style.display = "none"; return; }
  bar.style.display = "flex";

  const config = {
    strong_buy:  { color: "#E53935", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", icon: "🔥", text: "强烈看多" },
    buy:         { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", icon: "📈", text: "偏多" },
    sell:        { color: "#3b82f6", bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.3)", icon: "📉", text: "偏空" },
    strong_sell: { color: "#43A047", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.3)", icon: "⚠️", text: "强烈看空" },
    neutral:     { color: "#666666", bg: "rgba(136,144,181,0.08)", border: "rgba(136,144,181,0.2)", icon: "📊", text: "方向不明" },
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
    const volColor = sig.volumeConfirmed ? "#E53935" : sig.volRatio < 0.7 ? "#999999" : "#8890b5";
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
      <span style="color:#E53935;margin-left:10px;">🔴 目标：<b>¥${e.targetPrice}</b></span>
      <span style="color:#666666;margin-left:10px;">盈亏比：<b>1:${e.riskReward}</b></span>
    </div>`;
  }
  if (sig.levels) {
    const supp = (sig.levels.support || []).map(l => `<span style="color:#3b82f6;">${l.label} ¥${l.level}</span>`).join(" · ");
    const res = (sig.levels.resistance || []).map(l => `<span style="color:#E53935;">${l.label} ¥${l.level}</span>`).join(" · ");
    levelsHTML += `<div style="font-size:11px;margin-top:2px;color:#666666;">
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
    if (clampedPct < 30) bar.style.background = "#43A047";
    else if (clampedPct < 70) bar.style.background = "#fbbf24";
    else bar.style.background = "#E53935";
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
    build: { label: "建仓", color: "#E53935", bg: "rgba(239,68,68,0.1)" },
    add: { label: "加仓", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
    hold: { label: "持仓", color: "#999999", bg: "rgba(148,163,184,0.08)" },
    reduce: { label: "减仓", color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
    clear: { label: "清仓", color: "#43A047", bg: "rgba(34,197,94,0.1)" },
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

// ============ 长线分析 ============
(function(){
  var s = document.createElement('style');
  s.textContent = '.lt-card{background:#f8f9fa;padding:10px;border-radius:6px;text-align:center;}.lt-label{display:block;font-size:11px;color:#999;margin-bottom:4px;}.lt-val{font-size:16px;font-weight:600;color:#333;}';
  document.head.appendChild(s);
})();
var _ltPanel = null;
async function loadLongterm(code) {
  // 清理旧面板
  if (_ltPanel) { _ltPanel.remove(); _ltPanel = null; }
  var oldChart = document.getElementById('chartLongterm');
  if (oldChart) { var c = ChartManager._instances.get(oldChart); if (c) try { c.dispose(); } catch(e) {} oldChart.remove(); }
  try {
    var resp = await fetch('/api/stock/longterm/'+code);
    var d = await resp.json();
    if (!d.metrics) return;
    var m = d.metrics;
    var f = d.fundamental;

    var scoreColor = m.score >= 70 ? '#f85149' : m.score >= 50 ? '#d29922' : '#3fb950';
    var starCount = m.score >= 80 ? '5' : m.score >= 65 ? '4' : m.score >= 50 ? '3' : m.score >= 35 ? '2' : '1';

    // 通俗解读
    var advice = '';
    if (m.score >= 70) advice = '长期趋势向好，基本面坚实，适合作为核心持仓分批买入长期持有。';
    else if (m.score >= 55) advice = '整体表现不错，可以在回调时逐步建仓，注意控制仓位。';
    else if (m.score >= 45) advice = '喜忧参半，没有明显的长期优势，建议观望或轻仓试探。';
    else if (m.score >= 30) advice = '多个指标偏弱，风险较高。不建议重仓，已有持仓考虑减仓或止损。';
    else advice = '长期趋势和基本面均不理想，建议回避，等待趋势反转再关注。';
    if (m.maxDD < -40) advice += ' 该股历史最大回撤超40%，波动较大，心理承受力弱者需谨慎。';
    if (m.annualVol > 40) advice += ' 年化波动率偏高，适合风险偏好较高的投资者。';

    var html = '';
    // 标题+评分
    html += '<div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-top:16px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #eee;padding-bottom:12px;">';
    html += '<div><h3 style="margin:0 0 4px 0;color:#333;">'+d.name+' 长线投资分析</h3><span style="color:#999;font-size:12px;">基于3年K线+最新季报 | 数据仅供参考</span></div>';
    html += '<div style="text-align:center;"><div style="font-size:32px;font-weight:800;color:'+scoreColor+';">'+m.score+'<span style="font-size:16px;">分</span></div><div style="font-size:14px;color:'+scoreColor+';">'+m.scoreLabel+'</div></div>';
    html += '</div>';

    // 通俗解读
    html += '<div style="background:#f8f9fa;border-radius:8px;padding:14px;margin-bottom:16px;font-size:14px;line-height:1.8;color:#333;">';
    html += '<div style="font-weight:600;margin-bottom:6px;color:#1a73e8;">一句话总结</div>'+advice+'</div>';

    // 价格趋势
    html += '<div style="margin-bottom:16px;"><h4 style="color:#e53935;margin:0 0 8px 0;">价格与趋势</h4>';
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">';
    html += '<div class="lt-card"><span class="lt-label">当前价格</span><span class="lt-val" style="color:#58a6ff;">'+d.price.toFixed(2)+'</span></div>';
    html += '<div class="lt-card"><span class="lt-label">1年涨跌</span><span class="lt-val '+(m.ret1y>=0?'positive':'negative')+'">'+(m.ret1y>0?'+':'')+(m.ret1y?m.ret1y.toFixed(1):'--')+'%</span></div>';
    html += '<div class="lt-card"><span class="lt-label">3年涨跌</span><span class="lt-val '+(m.ret3y>=0?'positive':'negative')+'">'+(m.ret3y>0?'+':'')+(m.ret3y?m.ret3y.toFixed(1):'--')+'%</span></div>';
    html += '<div class="lt-card"><span class="lt-label">5年涨跌</span><span class="lt-val '+(m.ret5y>=0?'positive':'negative')+'">'+(m.ret5y>0?'+':'')+(m.ret5y?m.ret5y.toFixed(1):'--')+'%</span></div>';
    html += '<div class="lt-card"><span class="lt-label">年化波动</span><span class="lt-val">'+(m.annualVol?m.annualVol.toFixed(1):'--')+'%</span><span style="font-size:10px;color:#8b949e;display:block;">'+(m.annualVol>35?'偏高':m.annualVol>20?'适中':'较低')+'</span></div>';
    html += '<div class="lt-card"><span class="lt-label">最大回撤</span><span class="lt-val negative">'+(m.maxDD?m.maxDD.toFixed(1):'--')+'%</span><span style="font-size:10px;color:#8b949e;display:block;">'+(m.maxDD<-40?'风险较大':m.maxDD<-20?'需关注':'控制好')+'</span></div>';
    html += '<div class="lt-card"><span class="lt-label">距1年顶点</span><span class="lt-val '+(m.from1yHigh>-15?'negative':'positive')+'">'+(m.from1yHigh?m.from1yHigh.toFixed(1):'--')+'%</span></div>';
    html += '<div class="lt-card"><span class="lt-label">距1年底点</span><span class="lt-val '+(m.from1yLow>0?'positive':'negative')+'">+'+(m.from1yLow?m.from1yLow.toFixed(1):'--')+'%</span></div>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px;">';
    html += '<div class="lt-card"><span class="lt-label">MA60均线</span><span class="lt-val '+(m.pos60>0?'positive':'negative')+'">'+(m.pos60>0?'高于':'低于')+' '+(m.pos60>0?'+':'')+(m.pos60?m.pos60.toFixed(1):'--')+'%</span></div>';
    html += '<div class="lt-card"><span class="lt-label">MA120均线</span><span class="lt-val '+(m.pos120>0?'positive':'negative')+'">'+(m.pos120>0?'高于':'低于')+' '+(m.pos120>0?'+':'')+(m.pos120?m.pos120.toFixed(1):'--')+'%</span></div>';
    html += '<div class="lt-card"><span class="lt-label">MA250年线</span><span class="lt-val '+(m.pos250>0?'positive':'negative')+'">'+(m.pos250>0?'高于':'低于')+' '+(m.pos250>0?'+':'')+(m.pos250?m.pos250.toFixed(1):'--')+'%</span></div>';
    html += '</div>';
    html += '<div style="margin-top:8px;font-size:13px;color:#666;">';
    html += (m.maBullish?'多头排列(看涨)':'')+(m.maBearish?'空头排列(看跌)':'')+(!m.maBullish&&!m.maBearish?'均线交织(震荡)':'')+' | 估值: '+m.valuation;
    html += '</div></div>';

    // 基本面
    if (f) {
      var revStr = (f.revenue/1e8).toFixed(f.revenue>1e8?0:2);
      var profStr = (f.netProfit/1e8).toFixed(Math.abs(f.netProfit)>1e8?0:2);
      html += '<div style="margin-bottom:16px;"><h4 style="color:#1a73e8;margin:0 0 8px 0;">财报数据(最新季报)</h4>';
      html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">';
      html += '<div class="lt-card"><span class="lt-label">营业收入</span><span class="lt-val">'+revStr+'亿</span></div>';
      html += '<div class="lt-card"><span class="lt-label">营收增长</span><span class="lt-val '+(f.revenueGrowth>=0?'positive':'negative')+'">'+(f.revenueGrowth>0?'+':'')+(f.revenueGrowth?f.revenueGrowth.toFixed(1):'--')+'%</span></div>';
      html += '<div class="lt-card"><span class="lt-label">净利润</span><span class="lt-val '+(f.netProfit>=0?'positive':'negative')+'">'+profStr+'亿</span></div>';
      html += '<div class="lt-card"><span class="lt-label">利润增长</span><span class="lt-val '+(f.profitGrowth>=0?'positive':'negative')+'">'+(f.profitGrowth>0?'+':'')+(f.profitGrowth?f.profitGrowth.toFixed(1):'--')+'%</span></div>';
      html += '<div class="lt-card"><span class="lt-label">ROE(净资产收益率)</span><span class="lt-val '+(f.roe>=15?'positive':f.roe>=5?'':'negative')+'">'+(f.roe?f.roe.toFixed(1):'--')+'%</span><span style="font-size:10px;color:#8b949e;display:block;">'+(f.roe>=15?'优秀':f.roe>=8?'良好':f.roe>=0?'一般':'亏损')+'</span></div>';
      html += '<div class="lt-card"><span class="lt-label">净利率</span><span class="lt-val">'+(f.netMargin?f.netMargin.toFixed(1):'--')+'%</span></div>';
      html += '<div class="lt-card"><span class="lt-label">净资产</span><span class="lt-val">'+(f.equity/1e8).toFixed(0)+'亿</span></div>';
      html += '<div class="lt-card"><span class="lt-label">现金流评级</span><span class="lt-val" style="color:'+(f.netProfit>0?'#f85149':'#3fb950')+';">'+(f.netProfit>0?'盈利中':'亏损中')+'</span></div>';
      html += '</div></div>';
    }

    html += '</div>';
    // 包裹以便后续清理
    var wrapper = document.createElement('div');
    wrapper.id = 'longtermPanel';
    wrapper.innerHTML = html;
    _ltPanel = wrapper;
    document.getElementById('stockComments').parentNode.insertBefore(wrapper, document.getElementById('stockComments'));

    // 月线图
    if (d.monthly && d.monthly.length > 0) {
      var container = document.createElement('div');
      container.id = 'chartLongterm';
      container.style.cssText = 'height:300px;margin-top:12px;background:#161b22;border:1px solid #21262d;border-radius:8px;';
      document.getElementById('page-stock').appendChild(container);
      var chart = ChartManager.getChart('chartLongterm', 'stock');
      if (chart) {
        var dates = d.monthly.map(function(m){return m.date.slice(2);});
        var ohlc = d.monthly.map(function(m){return [m.open,m.close,m.low,m.high];});
        chart.setOption({
          title: { text: '月K线(36个月)', left:16, top:10, textStyle:{color:'#666',fontSize:13} },
          grid: { left:60, right:20, top:40, bottom:20 },
          xAxis: { type:'category', data:dates, axisLabel:{color:'#999',fontSize:10} },
          yAxis: { type:'value', scale:true, axisLabel:{color:'#666'} },
          series: [{ type:'candlestick', data:ohlc, itemStyle:{color:'#E53935',color0:'#43A047',borderColor:'#E53935',borderColor0:'#43A047'} }]
        }, true);
      }
    }
  } catch(e) { console.error(e); }
}

// ============ 加载个股研报评论 ============// ============ 加载个股研报评论 ============
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
      $("#companyNewsList").innerHTML = data.news.map(n =>
        `<a class="comment-link news-item" href="${n.url}" target="_blank"><span class="news-date">${n.date}</span>${n.title}</a>`
      ).join("");
    } else {
      $("#companyNewsList").innerHTML = '<div class="comment-empty">暂无公司资讯</div>';
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

// 个股页面自动刷新 (交易时段默认开启)
let stockRefreshTimer = null;
function isTradingHours() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), day = now.getDay();
  if (day === 0 || day === 6) return false;
  const t = h * 60 + m;
  return t >= 9 * 60 + 15 && t <= 15 * 60 + 5; // 9:15-15:05
}
function startStockRefresh() {
  clearInterval(stockRefreshTimer);
  stockRefreshTimer = setInterval(() => {
    if (document.querySelector("#page-stock.active")) {
      loadStockAnalysis();
    }
  }, 30000);
  TimerManager.register('stockRefresh', stockRefreshTimer, 'stock');
}
function stopStockRefresh() {
  clearInterval(stockRefreshTimer);
  TimerManager.clear('stockRefresh');
}
$("#stockAutoRefresh")?.addEventListener("change", function() {
  if (this.checked) { startStockRefresh(); }
  else { stopStockRefresh(); }
});
// 交易时段默认开启自动刷新
if (isTradingHours()) {
  const cb = $("#stockAutoRefresh");
  if (cb) cb.checked = true;
  startStockRefresh();
}

// ====================================================================
//  3. 策略回测
// ====================================================================
let equityChart, cmpBarChart;
function initBTChart() {
  var el = document.getElementById("chartEquity");
  if (!el) return;
  if (equityChart) { try { equityChart.dispose(); } catch(e) {} }
  equityChart = echarts.init(el);
  window.addEventListener("resize", function() { try { equityChart.resize(); } catch(e) {} });
}

function generateBTInsight(data) {
  const el = $("#btInsight");
  const icon = $("#btInsightIcon");
  const title = $("#btInsightTitle");
  const text = $("#btInsightText");
  el.style.display = "";

  const s = data.summary || data;
  const ret = s.totalReturn || 0;
  const bench = s.benchmarkReturn || 0;
  const winRate = s.winRate || 0;
  const sharpe = s.sharpe || 0;
  const dd = s.maxDrawdown || 0;
  const trades = s.totalTrades || 0;

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
    posStatus = `<div style="margin-top:8px;padding:8px 12px;border-radius:8px;font-size:13px;${isHolding ? 'background:rgba(229,57,53,0.08);color:#E53935;border:1px solid rgba(229,57,53,0.15)' : 'background:rgba(0,0,0,0.04);color:#666666;border:1px solid #EAEAEA'}">
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
      annualReturn: s.annualReturn || s.annualizedReturn || 0,
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

document.getElementById("btnBacktest")?.addEventListener("click", runBacktest);
async function runBacktest() {
  var code = document.getElementById("btCode")?.value?.trim() || "000001";
  var btn = document.getElementById("btnBacktest");
  if (btn) { btn.textContent = "⏳"; btn.disabled = true; }
  var statusEl = document.getElementById("btStatus");

  try {
    var strategyEl = document.getElementById("btStrategy");
    var strategy = strategyEl?.value || "macdStrategy";
    var strategyMap = { "multiFactorStrategy":"maCross", "maCrossStrategy":"maCross", "macdStrategy":"macd", "bollStrategy":"boll" };
    var pyStrategy = strategyMap[strategy] || "macd";
    var activePeriod = document.querySelector("#page-backtest .bt-period-btn.active");
    var days = activePeriod?.dataset?.days || "365";

    var resp = await fetch("/api/quant/backtest/"+code+"?strategy="+pyStrategy+"&days="+days);
    var data = await resp.json();
    if (data.error) { if (statusEl) statusEl.textContent = data.error; if (btn) { btn.textContent = "▶ 重试"; btn.disabled = false; } return; }

    var setNum = function(id, val, suffix) {
      var el = document.getElementById(id);
      if (el) { el.textContent = val + (suffix||""); el.style.color = parseFloat(val) >= 0 ? "#E53935" : "#43A047"; }
    };
    setNum("btRet", (data.totalReturn||0).toFixed(1), "%");
    setNum("btDD", (data.maxDrawdown||0).toFixed(1), "%");
    setNum("btSharpe", (data.sharpe||0).toFixed(2));
    setNum("btWinRate", (data.winRate||0).toFixed(1), "%");
    var te = document.getElementById("btStatsTrades"); if (te) te.textContent = data.totalTrades||0;

    var sigHtml = "";
    if (data.signals && data.signals.length > 0) {
      sigHtml = '<table style="width:100%;border-collapse:collapse;font-size:12px;"><tr><th>日期</th><th>类型</th><th>价格</th><th>原因</th></tr>';
      data.signals.forEach(function(s) {
        sigHtml += '<tr><td>'+s.date+'</td><td style="color:'+(s.type==="buy"?"#E53935":"#43A047")+';">'+(s.type==="buy"?"买入":"卖出")+'</td><td>'+s.price+'</td><td>'+s.reason+'</td></tr>';
      });
      sigHtml += '</table>';
    }
    var td = document.getElementById("btTrades"); if (td) td.innerHTML = sigHtml || '<div style="color:#999;text-align:center;padding:20px;">无交易信号</div>';

    initBTChart();
    if (equityChart && data.equity) {
      var dates = data.equity.map(function(e){return e.date;});
      var values = data.equity.map(function(e){return e.value;});
      equityChart.setOption({
        grid: { left:60, right:20, top:20, bottom:30 },
        xAxis: { type:"category", data:dates, axisLabel:{color:"#999",fontSize:10} },
        yAxis: { type:"value", axisLabel:{formatter:function(v){return (v/10000).toFixed(1)+"万"},color:"#999"} },
        series: [{ type:"line", data:values, lineStyle:{color:"#1E88E5",width:2}, areaStyle:{color:"rgba(99,102,241,.15)"}, symbol:"none" }]
      });
    }

    if (statusEl) statusEl.textContent = "✅ 回测完成 | "+data.totalTrades+"笔交易 | 收益"+(data.totalReturn>=0?"+":"")+data.totalReturn.toFixed(1)+"%";
    if (btn) { btn.textContent = "✅ 完成"; btn.disabled = false; }
  } catch(e) {
    console.error(e);
    if (statusEl) statusEl.textContent = "❌ 失败: "+e.message;
    if (btn) { btn.textContent = "▶ 重试"; btn.disabled = false; }
  }
}
document.getElementById("btnBacktest")?.addEventListener("click", runBacktest);
document.getElementById("btCode")?.addEventListener("keydown", function(e) { if (e.key==="Enter") runBacktest(); });
document.getElementById("btCode")?.addEventListener("keydown", function(e) { if (e.key==="Enter") runBacktest(); });

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
  signal_follow: { icon: "🤖", explain: "MACD+RSI信号投票。跟随技术指标综合判断，比单一策略更稳健。" },
  ma_cross: { icon: "📈", explain: "5/20均线金叉买入，死叉卖出。适合趋势行情，震荡市容易反复打脸。" },
  grid: { icon: "#️", explain: "在价格区间内高抛低吸。适合横盘震荡的股票，趋势行情容易卖飞。" },
  breakout: { icon: "🚀", explain: "突破20日高点+放量买入。强趋势股效果好，假突破会止损出局。" },
  momentum_rotation: { icon: "🔄", explain: "RSI动量+成交量确认。跟着资金流入方向，追涨杀跌但有指标把关。" },
  mean_reversion: { icon: "📊", explain: "RSI超卖买入超买卖出。适合震荡市抄底逃顶，单边市风险高。" },
  t3pullback: { icon: "🎯", explain: "涨停后回调低吸。抓涨停次日回踩机会，T+3持有期，严格纪律。" },
  limit_up_chase: { icon: "🏄", explain: "涨停次日高开追入持有3天。追强势股但控制持有期防止反转。" },
  trend_band: { icon: "🏰", explain: "多头排列回踩MA5低吸。顺势而为，跌破MA20就离场，纪律严格。" },
  panic_buy: { icon: "🆘", explain: "暴跌8%+RSI<25+放量抄底。逆势操作风险极高，反弹5%就止盈。" },
  hcci: { icon: "🔥", explain: "辛烷值检测行情平顺度·动能涡轮动态调仓·爆震FAULT保护。全自动自适应策略。" },
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
        `这只股票更适合<b>${bestName}</b>——赚了<b style="color:#E53935">+${bestRet}%</b>（夏普${bestSharpe}），而表现最差的策略亏了${worstRet}%，差距高达${diff.toFixed(0)}个百分点。<br>
        <span style="font-size:11px;color:#999999;">前三名：${rankSummary}</span>`;
    } else {
      $("#cmpInsightText").innerHTML =
        `很遗憾，所有7种策略在这只股票上都亏了钱。表现相对最好的是<b>${bestName}</b>（仅亏${bestRet}%），说明${code}这段时间确实不好做。<br>
        <span style="font-size:11px;color:#999999;">换个股票试试？或者等市场好转再用策略。</span>`;
    }

    // 条形图
    if (!cmpBarChart) {
      cmpBarChart = ChartManager.getChart("chartCmpBar", "compare");
      ChartManager.manageResize(cmpBarChart);
    }
    cmpBarChart.setOption({
      backgroundColor: "transparent",
      title: { text: "策略收益对比", left: 10, top: 10, textStyle: { color: "#1A1A2E", fontSize: 13, fontWeight: 600 } },
      grid: { left: 100, right: 60, top: 50, bottom: 28 },
      xAxis: { type: "value", axisLabel: { color: "#999999", fontSize: 10, formatter: v => v + "%" }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
      yAxis: { type: "category", data: entries.map(([, v]) => v.strategy), axisLabel: { color: "#666666", fontSize: 11 }, inverse: true },
      tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" },
        formatter: ps => {
          const v = entries[ps[0].dataIndex][1];
          const p = STRATEGY_PLAIN[entries[ps[0].dataIndex][0]] || {};
          return `<b>${v.strategy}</b> ${p.icon||''}<br/>${p.explain||''}<br/>收益: ${v.totalReturn}% | 夏普: ${v.sharpe}<br/>回撤: ${v.maxDrawdown}% | 胜率: ${v.winRate}%<br/>交易: ${v.totalTrades}次`;
        }
      },
      series: [{ type: "bar", barMaxWidth: 20,
        data: entries.map(([, v], i) => ({
          value: v.totalReturn || 0,
          itemStyle: { color: i === 0 ? "#fbbf24" : (v.totalReturn >= 0 ? "#E53935" : "#43A047"), borderRadius: v.totalReturn >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] },
        })),
        label: { show: true, position: "right", color: "#666666", fontSize: 10, formatter: "{c}%" },
      }],
    }, true);

    // 策略操作说明
    const STRATEGY_OPS = {
      signal_follow: { buy: "≥4个指标说买+放量", sell: "≥4个指标说卖", size: "15%", stop: "亏8%止损" },
      ma_cross: { buy: "5日均线上穿20日均线", sell: "5日均线下穿20日均线", size: "15%", stop: "亏5%止损" },
      grid: { buy: "每跌3%买一份", sell: "每涨3%卖一份", size: "每格3%", stop: "跌破下沿10%清仓" },
      breakout: { buy: "突破20日高点+放量", sell: "跌破10日低点", size: "15%", stop: "亏7%止损" },
      momentum_rotation: { buy: "选20日涨幅最大的3只", sell: "5天轮换一次", size: "每只20%", stop: "单只亏10%清仓" },
      mean_reversion: { buy: "RSI<30+跌到布林下轨", sell: "RSI>70或回到中轨", size: "15%", stop: "亏8%止损" },
      t3pullback: { buy: "涨停后第3天回调低吸", sell: "持有5天或盈利10%", size: "20%", stop: "亏5%止损" },
      limit_up_chase: { buy: "首板放量→次日高开追入", sell: "持有2天必走", size: "15%", stop: "亏3%止损" },
      trend_band: { buy: "多头排列+回踩MA20", sell: "跌破MA20或盈利25%", size: "25%", stop: "亏8%止损" },
      panic_buy: { buy: "连跌缩量+RSI<25分批买", sell: "反弹12%止盈", size: "10%分3批", stop: "均价下8%清仓" },
      hcci: { buy: "自适应算法自动判断", sell: "自适应算法自动判断", size: "动态调整", stop: "爆震保护自动止损" },
    };

    // 卡片 — 带操作说明
    $("#cmpResults").innerHTML = entries.map(([k, v], i) => {
      const good = v.totalReturn >= 0;
      const bestCls = i === 0 ? " best" : "";
      const p = STRATEGY_PLAIN[k] || {};
      const ops = STRATEGY_OPS[k] || {};
      const verdict = v.totalReturn > 10 ? "强烈推荐" : v.totalReturn > 0 ? "可考虑" : v.totalReturn > -10 ? "需改进" : "不推荐";
      const verdictColor = v.totalReturn > 10 ? "#E53935" : v.totalReturn > 0 ? "#f59e0b" : v.totalReturn > -10 ? "#3b82f6" : "#6b7280";
      return `<div class="cmp-card ${good ? 'good' : 'bad'}${bestCls}" title="${p.explain||''}">
        <h4>${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : ''}${p.icon||'📊'} ${v.strategy}
          <span style="font-size:10px;color:${verdictColor};float:right;">${verdict}</span>
        </h4>
        <div class="val">收益: <b style="color:${good?'#E53935':'#43A047'}">${v.totalReturn>=0?'+':''}${v.totalReturn}%</b></div>
        <div class="val">夏普: ${v.sharpe} · 回撤: ${v.maxDrawdown}%</div>
        <div class="val">交易${v.totalTrades}次 · 胜率${v.winRate}%</div>
        <div style="font-size:10px;color:#999;margin-top:6px;padding-top:6px;border-top:1px solid #eee;">
          <div><b style="color:#E53935">买入：</b>${ops.buy||'--'}</div>
          <div><b style="color:#43A047">卖出：</b>${ops.sell||'--'}</div>
          <div><b>仓位：</b>${ops.size||'--'} · <b>止损：</b>${ops.stop||'--'}</div>
        </div>
        <div style="font-size:10px;color:#999;margin-top:4px;">💡 ${p.explain||''}</div>
      </div>`;
    }).join("");
  } catch (e) { toast("对比失败: " + e.message); }
  finally { btn.textContent = "▶ 对比所有策略"; btn.disabled = false; }
});
$("#cmpCode")?.addEventListener("keydown", e => { if (e.key === "Enter") $("#btnCompare").click(); });


// 异步添加回测买卖信号标记到日K/周K图表（通用）
function addTradeSignals(chart, chartEl, code, dates, dateMap) {
  fetch(`/api/backtest?code=${code}&strategy=ma_cross&days=120`)
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
        symbol: "pin", symbolRotate: 0, itemStyle: { color: "#E53935" },
        label: { show: true, position: "bottom", formatter: "买", color: "#E53935", fontSize: 10, fontWeight: 800 },
      });
      if (sellPts.length) sigSeries.push({
        name: "卖出信号", type: "scatter", z: 10,
        data: sellPts.map(p => ({ value: [p.date, p.price * 1.03], symbolSize: 16, itemStyle: { shadowBlur: 6, shadowColor: "rgba(34,197,94,0.6)" } })),
        symbol: "pin", symbolRotate: 180, itemStyle: { color: "#43A047" },
        label: { show: true, position: "top", formatter: "卖", color: "#43A047", fontSize: 10, fontWeight: 800 },
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
    symbol: "arrow", symbolRotate: 0, itemStyle: { color: "#43A047" },
    label: { show: true, position: "bottom", formatter: "买", color: "#43A047", fontSize: 10, fontWeight: 800 },
  });
  if (sellPts.length) sigSeries.push({
    name: "T+0卖出", type: "scatter", data: sellPts, z: 10,
    symbol: "arrow", symbolRotate: 180, itemStyle: { color: "#E53935" },
    label: { show: true, position: "top", formatter: "卖", color: "#E53935", fontSize: 10, fontWeight: 800 },
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
    itemStyle: { color: "#E53935", color0: "#43A047", borderColor: "#E53935", borderColor0: "#43A047", borderWidth: 1.5 },
  }];

  // 均线
  [[calcMA(5), "MA5", "#E53935"], [calcMA(10), "MA10", "#fbbf24"], [calcMA(20), "MA20", "#8E24AA"]]
    .forEach(([d, n, c]) => series.push({ name: n, type: "line", data: d, lineStyle: { color: c, width: 1.2 }, symbol: "none" }));

  // 异步获取买卖信号并添加标记
  fetch(`/api/backtest?code=${code}&strategy=ma_cross&days=120`).then(r => r.json()).catch(() => null).then(bt => {
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
          symbol: "pin", symbolRotate: 0, itemStyle: { color: "#E53935" },
          label: { show: true, position: "bottom", formatter: "买", color: "#E53935", fontSize: 10, fontWeight: 800 },
        });
      }
      if (sellPoints.length) {
        series.push({
          name: "卖出", type: "scatter",
          data: sellPoints.map(p => ({ value: [p.date, p.price * 1.03], symbolSize: 16, itemStyle: { shadowBlur: 6, shadowColor: "rgba(34,197,94,0.6)" } })),
          symbol: "pin", symbolRotate: 180, itemStyle: { color: "#43A047" },
          label: { show: true, position: "top", formatter: "卖", color: "#43A047", fontSize: 10, fontWeight: 800 },
        });
      }
    }
    try { chart.setOption({ series }); } catch (_) {}
  });

  chart.setOption({
    backgroundColor: "transparent",
    grid: { left: 50, right: 20, top: 20, bottom: 40 },
    legend: { right: 10, top: 2, textStyle: { color: "#999999", fontSize: 10 } },
    xAxis: {
      type: "category", data: data.dates,
      axisLabel: { color: "#999999", fontSize: 10 },
      axisLine: { lineStyle: { color: "#EAEAEA" } }
    },
    yAxis: {
      type: "value", scale: true,
      axisLabel: { color: "#999999", fontSize: 10 },
      splitLine: { lineStyle: { color: "#F0F0F0" } }
    },
    series,
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA",
      textStyle: { color: "#333333", fontSize: 12 },
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
        chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999999;font-size:12px;">暂无分钟数据</div>';
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
      chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999999;font-size:12px;">加载失败</div>';
    }
  } else if (period === "day") {
    try {
      const resp = await fetch(`/api/indicators?code=${code}&days=60`);
      const data = await resp.json();
      if (data.error || !data.dates) {
        chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999999;font-size:12px;">暂无数据</div>';
        return;
      }
      if (!chartEl.isConnected) return;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!chartEl.isConnected) return;
      loadDayKlineChart(chartEl, data, code);
    } catch (e) {
      chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999999;font-size:12px;">加载失败</div>';
    }
  } else if (period === "week") {
    try {
      const resp = await fetch(`/api/indicators?code=${code}&days=365`);
      const data = await resp.json();
      if (data.error || !data.dates) {
        chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999999;font-size:12px;">暂无数据</div>';
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
        xAxis: { type: "category", data: wDates, axisLabel: { color: "#999999", fontSize: 10 }, axisLine: { lineStyle: { color: "#EAEAEA" } } },
        yAxis: { type: "value", scale: true, axisLabel: { color: "#999999", fontSize: 10 }, splitLine: { lineStyle: { color: "#F0F0F0" } } },
        series: [{ name: "周K", type: "candlestick", data: wOhlc, itemStyle: { color: "#E53935", color0: "#43A047", borderColor: "#E53935", borderColor0: "#43A047" } }],
        tooltip: { trigger: "axis", backgroundColor: "rgba(255,255,255,.97)", borderColor: "#EAEAEA", textStyle: { color: "#333333" },
          formatter: params => { const p = params[0], d = p.data; return `${p.axisValue}<br/>开: ${d[1]} 收: ${d[2]}<br/>低: ${d[3]} 高: ${d[4]}`; }
        },
        dataZoom: [{ type: "inside", start: 0, end: 100 }]
      });
      chartEl.dataset.loaded = "week";
      ChartManager.manageResize(chart);
      addTradeSignals(chart, chartEl, code, wDates, dailyToWeekly);
    } catch (e) {
      chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999999;font-size:12px;">加载失败</div>';
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
          <b style="color:#1A1A2E;font-size:16px;">${name || code}</b>
          <span style="font-size:12px;color:#999999;">${code}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="kline-modal-period active" data-period="minute" style="font-size:12px;padding:6px 12px;background:rgba(99,102,241,.25);border:1px solid rgba(99,102,241,.4);border-radius:8px;color:#a5b4fc;cursor:pointer;">今日分时</button>
          <button class="kline-modal-period" data-period="day" style="font-size:12px;padding:6px 12px;background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.2);border-radius:8px;color:#1E88E5;cursor:pointer;">日K</button>
          <button class="kline-modal-period" data-period="week" style="font-size:12px;padding:6px 12px;background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.2);border-radius:8px;color:#1E88E5;cursor:pointer;">周K</button>
          <button class="kline-modal-analyze" style="font-size:12px;padding:6px 12px;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.3);border-radius:8px;color:#fbbf24;cursor:pointer;">完整分析 →</button>
          <button class="kline-modal-close" style="font-size:18px;padding:4px 8px;background:transparent;border:none;color:#999999;cursor:pointer;">✕</button>
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
    btn.style.color = isActive ? "#a5b4fc" : "#1E88E5";
  });

  // 中止上一次加载中的请求，防止竞态
  if (_klineModalAbort) { _klineModalAbort.abort(); _klineModalAbort = null; }

  // 通过 ChartManager 统一销毁旧图表
  ChartManager.disposePage("klineModal");

  chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999999;">加载中...</div>';

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
        if (chartEl.isConnected) chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999999;">暂无分钟数据</div>';
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
          axisLabel: { color: "#999999", fontSize: 11 },
          axisLine: { lineStyle: { color: "#EAEAEA" } }
        },
        yAxis: {
          type: "value",
          scale: true,
          axisLabel: { color: "#999999", fontSize: 11 },
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
        if (chartEl.isConnected) chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999999;">暂无数据</div>';
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
          axisLabel: { color: "#999999", fontSize: 11 },
          axisLine: { lineStyle: { color: "#EAEAEA" } }
        },
        yAxis: {
          type: "value",
          scale: true,
          axisLabel: { color: "#999999", fontSize: 11 },
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
    if (chartEl.isConnected) chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999999;">加载失败</div>';
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
}PageRegistry.register("market", {
  init: async () => {
    await loadMarketOverview();
    try { startMarketRefresh(); } catch(e) { console.error("startMarketRefresh error:", e); }
  },
  cleanup: () => {
    clearInterval(marketRefreshTimer);
    marketRefreshTimer = null;
    TimerManager.clear('marketRefresh');
  }
});

PageRegistry.register("stock", {
  init: async () => {
    initStockChart();
    await loadStockAnalysis();
  },
  cleanup: () => {
    clearInterval(stockRefreshTimer);
    stockRefreshTimer = null;
    TimerManager.clear('stockRefresh');
  }
});

PageRegistry.register("backtest", {
  init: async () => {
    initBTChart();
    // 自动加载默认回测
    await new Promise(r => setTimeout(r, 500));
    var btn = document.getElementById("btnBacktest");
    if (btn) btn.click();
  },
  cleanup: () => { if (equityChart) { try { equityChart.dispose(); equityChart = null; } catch(e) {} } }
});

PageRegistry.register("fundflow", {
  init: async () => {
    initFFChart();
    await loadFundFlow();
  },
  cleanup: () => {
    clearInterval(ffLiveTimer);
    ffLiveTimer = null;
    TimerManager.clear('ffLive');
    if (typeof _rtKlineTimer !== 'undefined') { clearInterval(_rtKlineTimer); _rtKlineTimer = null; }
  }
});

PageRegistry.register("fund", {
  init: async () => { await loadFundPage(); },
  cleanup: () => {
    stopFundIntradayPoll();
    TimerManager.clear('fundIntradayPoll');
  }
});

PageRegistry.register("compare", {
  init: () => {},
  cleanup: () => {}
});

PageRegistry.register("scan", {
  init: () => {},
  cleanup: () => {}
});

PageRegistry.register("etf", {
  init: async () => { await loadEtfRotate(); },
  cleanup: () => {}
});

PageRegistry.register("trend", {
  init: async () => { await loadTrendScan(); },
  cleanup: () => {}
});

PageRegistry.register("hotmoney", {
  init: () => {},
  cleanup: () => {}
});

// ============ 涨停打板页面 ============
PageRegistry.register("limitup", {
  init: async () => {
    // 绑定扫描按钮
    const btn = document.getElementById("btnLimitUpScan");
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener("click", scanLimitUp);
    }
  },
  cleanup: () => {}
});

// 涨停打板扫描函数
async function scanLimitUp() {
  const btn = document.getElementById("btnLimitUpScan");
  const status = document.getElementById("limitUpStatus");
  const tbody = document.getElementById("limitUpBody");
  const empty = document.getElementById("limitUpEmpty");
  const top2Div = document.getElementById("limitUpTop2");
  const top2Cards = document.getElementById("limitUpTop2Cards");

  btn.disabled = true;
  btn.textContent = "⏳ 扫描中...";
  status.textContent = "正在获取昨日涨停池并评分...";
  tbody.innerHTML = "";
  empty.style.display = "none";

  try {
    const resp = await fetch("/api/limitup/scan?limit=30");
    const data = await resp.json();

    if (data.error) {
      status.textContent = "❌ " + data.error;
      return;
    }

    if (!data.results || data.results.length === 0) {
      status.textContent = "暂无涨停股数据";
      empty.style.display = "block";
      empty.textContent = data.message || "未获取到涨停股数据";
      return;
    }

    status.textContent = `✅ 共 ${data.totalCount} 只涨停股，已评分 ${data.count} 只`;

    // 渲染TOP2卡片
    const top2 = data.results.slice(0, 2);
    top2Div.style.display = "block";
    top2Cards.innerHTML = top2.map((s, i) => `
      <div style="flex:1;min-width:280px;background:${i===0?'linear-gradient(135deg,#fef2f2,#fee2e2)':'linear-gradient(13deg,#fff7ed,#ffedd5)'};border:2px solid ${i===0?'#fca5a5':'#fdba74'};border-radius:12px;padding:16px;cursor:pointer;" onclick="window.open('/?code=${s.code}','_blank')">
        <div style="font-size:13px;color:#999;margin-bottom:4px;">${i===0?'🥇':'🥈'} 推荐 ${i+1}</div>
        <div style="font-size:20px;font-weight:700;color:#1f2937;">${s.name} <span style="font-size:14px;color:#6b7280;">${s.code}</span></div>
        <div style="display:flex;gap:16px;margin-top:8px;">
          <div><span style="font-size:12px;color:#999;">总分</span><div style="font-size:22px;font-weight:700;color:${s.gradeColor};">${s.totalScore}</div></div>
          <div><span style="font-size:12px;color:#999;">等级</span><div style="font-size:22px;font-weight:700;color:${s.gradeColor};">${s.grade}</div></div>
          <div><span style="font-size:12px;color:#999;">连板</span><div style="font-size:22px;font-weight:700;color:#dc2626;">${s.connBan}</div></div>
          <div><span style="font-size:12px;color:#999;">信号</span><div style="font-size:16px;font-weight:600;color:${s.signal==='强烈推荐'?'#dc2626':s.signal==='推荐'?'#f59e0b':'#6b7280'};">${s.signal}</div></div>
        </div>
        <div style="font-size:12px;color:#6b7280;margin-top:8px;">${s.reasons.join(' | ')}</div>
      </div>
    `).join("");

    // 渲染表格
    tbody.innerHTML = data.results.map((s, i) => `
      <tr style="border-bottom:1px solid rgba(0,0,0,.06);${i<2?'background:rgba(239,68,68,0.04);':''}" onclick="window.open('/?code=${s.code}','_blank')" class="clickable-row">
        <td style="padding:8px 6px;text-align:center;font-weight:600;color:${i<3?'#dc2626':'#666'};">${i+1}</td>
        <td style="padding:8px 6px;font-family:monospace;">${s.code}</td>
        <td style="padding:8px 6px;font-weight:500;">${s.name}</td>
        <td style="padding:8px 6px;text-align:center;font-weight:700;color:${s.gradeColor};font-size:15px;">${s.totalScore}</td>
        <td style="padding:8px 6px;text-align:center;"><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#fff;background:${s.gradeColor};">${s.grade}</span></td>
        <td style="padding:8px 6px;text-align:center;color:${s.connBan>=2?'#dc2626':'#666'};font-weight:${s.connBan>=2?'700':'400'};">${s.connBan}板</td>
        <td style="padding:8px 6px;text-align:center;">${s.sealTimeScore}</td>
        <td style="padding:8px 6px;text-align:center;">${s.blastScore}</td>
        <td style="padding:8px 6px;text-align:center;">${s.volumeRatio}</td>
        <td style="padding:8px 6px;text-align:center;color:${parseFloat(s.changePct)>0?'#dc2626':'#22c55e'};">${s.changePct?s.changePct+'%':'-'}</td>
        <td style="padding:8px 6px;text-align:center;font-weight:600;color:${s.signal==='强烈推荐'?'#dc2626':s.signal==='推荐'?'#f59e0b':'#6b7280'};">${s.signal}</td>
        <td style="padding:8px 6px;font-size:11px;color:#999;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${s.reasons.join(' | ')}">${s.reasons.join(' | ')}</td>
      </tr>
    `).join("");

  } catch (e) {
    status.textContent = "❌ 请求失败: " + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "🎯 一键扫描涨停股";
  }
}

// ============ 市场快讯页面 ============

// ============ 量化实验室 ============
var qlChart = null, qlMacdChart = null, qlRsiChart = null;
var qlData = null;

PageRegistry.register("quantlab", {
  init: async () => { await loadQuantLab(); },
  cleanup: () => {
    if (qlChart) try { qlChart.remove(); qlChart = null; } catch(e) {}
    if (qlMacdChart) try { qlMacdChart.remove(); qlMacdChart = null; } catch(e) {}
    if (qlRsiChart) try { qlRsiChart.remove(); qlRsiChart = null; } catch(e) {}
    qlData = null;
  }
});

$("#btnQlAnalyze")?.addEventListener("click", loadQuantLab);
$("#qlCode")?.addEventListener("keydown", e => { if (e.key === "Enter") loadQuantLab(); });

async function loadQuantLab() {
  var code = $("#qlCode").value.trim() || "000001";
  $("#qlStatus").textContent = "加载中...";
  
  try {
    var resp = await fetch("/api/quant/analyze/" + code);
    var d = await resp.json();
    if (d.error) { $("#qlStatus").textContent = d.error; return; }
    qlData = d;
    $("#qlStatus").textContent = d.name + " ¥" + (d.price||0).toFixed(2);
    
    // 新手引导(首次显示)
    if (!document.getElementById("qlGuide")) {
      var guide = document.createElement("div");
      guide.id = "qlGuide";
      guide.style.cssText = "background:#f8f9fa;border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin-bottom:12px;font-size:12px;color:#666;line-height:1.8;";
      guide.innerHTML = '<b>📖 怎么看这些图？</b> 🕯 <b>红K线</b>=涨了 <b>绿K线</b>=跌了 | 🟡黄线=5日均线 🔵蓝线=20日均线 🟣紫线=60日均线 | <b>MACD</b>: 橙线上穿蓝线=看涨 | <b>RSI</b>: 低于30=便宜(买) 高于70=太贵(卖) | <b>策略对比</b>: A级=优秀 B级=良好 C级=一般 D级=差';
      document.getElementById("qlChart").parentNode.insertBefore(guide, document.getElementById("qlChart"));
    }

    // K线图 (Lightweight Charts)
    var chartEl = document.getElementById("qlChart");
    if (qlChart) qlChart.remove();
    qlChart = LightweightCharts.createChart(chartEl, {
      layout: { background: { color: "#ffffff" }, textColor: "#333" },
      grid: { vertLines: { color: "#f0f0f0" }, horzLines: { color: "#f0f0f0" } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#ddd" },
      timeScale: { borderColor: "#ddd", timeVisible: true },
    });
    
    var candleData = d.klines.map(function(k) { return { time: k.date, open: k.open, high: k.high, low: k.low, close: k.close }; });
    var candleSeries = qlChart.addCandlestickSeries({ upColor: "#E53935", downColor: "#43A047", borderUpColor: "#E53935", borderDownColor: "#43A047" });
    candleSeries.setData(candleData);
    
    // 叠加MA均线
    if (d.indicators.sma5) {
      var sma5Data = d.indicators.sma5.map(function(v,i) { return v ? { time: d.klines[i+50].date, value: v } : null; }).filter(Boolean);
      var sma5Series = qlChart.addLineSeries({ color: "#f59e0b", lineWidth: 1, lastValueVisible: false });
      sma5Series.setData(sma5Data);
    }
    if (d.indicators.sma20) {
      var sma20Data = d.indicators.sma20.map(function(v,i) { return v ? { time: d.klines[i+50].date, value: v } : null; }).filter(Boolean);
      var sma20Series = qlChart.addLineSeries({ color: "#3b82f6", lineWidth: 1, lastValueVisible: false });
      sma20Series.setData(sma20Data);
    }
    if (d.indicators.sma60) {
      var sma60Data = d.indicators.sma60.map(function(v,i) { return v ? { time: d.klines[i+50].date, value: v } : null; }).filter(Boolean);
      var sma60Series = qlChart.addLineSeries({ color: "#8b5cf6", lineWidth: 1, lastValueVisible: false });
      sma60Series.setData(sma60Data);
    }
    
    // 买卖标记
    var markers = [];
    d.strategies[0]?.signals?.forEach(function(s) {
      markers.push({ time: s.date, position: s.type === "buy" ? "belowBar" : "aboveBar", color: s.type === "buy" ? "#E53935" : "#43A047", shape: s.type === "buy" ? "arrowUp" : "arrowDown", text: s.reason, size: 2 });
    });
    if (markers.length > 0) candleSeries.setMarkers(markers);
    
    // MACD副图
    var macdEl = document.getElementById("chartQLMacd");
    if (qlMacdChart) qlMacdChart.remove();
    qlMacdChart = LightweightCharts.createChart(macdEl, {
      layout: { background: { color: "#ffffff" }, textColor: "#333" },
      grid: { vertLines: { color: "#f0f0f0" }, horzLines: { color: "#f0f0f0" } },
      rightPriceScale: { borderColor: "#ddd" },
    });
    var difData = d.indicators.macdDif.map(function(v,i) { return v !== null ? { time: d.klines[i+50].date, value: v } : null; }).filter(Boolean);
    var deaData = d.indicators.macdDea.map(function(v,i) { return v !== null ? { time: d.klines[i+50].date, value: v } : null; }).filter(Boolean);
    var histData = d.indicators.macdHist.map(function(v,i) { return v !== null ? { time: d.klines[i+50].date, value: v, color: v>=0?"#E5393566":"#43A04766" } : null; }).filter(Boolean);
    qlMacdChart.addHistogramSeries({ priceFormat: { type: "volume" } }).setData(histData);
    qlMacdChart.addLineSeries({ color: "#f59e0b", lineWidth: 1 }).setData(difData);
    qlMacdChart.addLineSeries({ color: "#3b82f6", lineWidth: 1 }).setData(deaData);
    
    // RSI副图  
    var rsiEl = document.getElementById("chartQLRsi");
    if (qlRsiChart) qlRsiChart.remove();
    qlRsiChart = LightweightCharts.createChart(rsiEl, {
      layout: { background: { color: "#ffffff" }, textColor: "#333" },
      grid: { vertLines: { color: "#f0f0f0" }, horzLines: { color: "#f0f0f0" } },
      rightPriceScale: { borderColor: "#ddd" },
    });
    var rsiData = d.indicators.rsi14.map(function(v,i) { return v !== null ? { time: d.klines[i+50].date, value: v } : null; }).filter(Boolean);
    qlRsiChart.addLineSeries({ color: "#8b5cf6", lineWidth: 2 }).setData(rsiData);
    // 30/70 参考线
    qlRsiChart.addLineSeries({ color: "#ef444466", lineWidth: 1, lastValueVisible: false }).setData(d.klines.slice(50).map(function(k){return {time:k.date,value:70}}));
    qlRsiChart.addLineSeries({ color: "#22c55e66", lineWidth: 1, lastValueVisible: false }).setData(d.klines.slice(50).map(function(k){return {time:k.date,value:30}}));
    
    // ===== 策略对比 (增强版) =====
    var strHtml = "";
    var bestName = d.bestStrategy?.name || "";
    var bestRet = d.bestStrategy?.totalReturn || 0;

    // 一句话总结
    var summaryText = "";
    if (bestRet > 20) summaryText = "非常优秀！历史回测收益超过20%，该策略在当前股票上表现亮眼。";
    else if (bestRet > 5) summaryText = "表现不错，最佳策略有正收益，可以考虑用于实盘参考。";
    else if (bestRet > -5) summaryText = "表现平平，策略和该股票匹配度一般，建议换股或调整参数再试。";
    else summaryText = "不太理想，所有策略在该股票上均为负收益，不建议用这些策略交易该股。";

    strHtml += '<div style="background:#f8f9fa;border-radius:8px;padding:14px;margin-bottom:12px;font-size:14px;line-height:1.8;color:#333;">';
    strHtml += '<div style="font-weight:600;color:#1a73e8;margin-bottom:4px;">📝 回测总结</div>';
    strHtml += summaryText + ' 最佳策略是 <b>'+bestName+'</b>（收益 '+(bestRet>0?'+':'')+bestRet.toFixed(1)+'%）。';
    strHtml += '</div>';

    // 策略卡片
    var labels = {
      "均线交叉 MA5×MA20": { emoji: "📈", desc: "短期均线上穿长期均线买入，下穿卖出。适合趋势行情。", tip: "趋势市好用，震荡市频繁止损" },
      "MACD金叉死叉": { emoji: "📊", desc: "MACD柱由负转正买入，由正转负卖出。经典动量策略。", tip: "中长线参考价值高" },
      "布林带波段": { emoji: "〰️", desc: "价格触及下轨反弹买入，触及上轨回落卖出。适合震荡市。", tip: "震荡市抓波段，单边市容易踏空" },
      "RSI超买超卖": { emoji: "⚖️", desc: "RSI低于30超卖区买入，高于70超买区卖出。逆向交易。", tip: "极端行情信号可靠，但有延迟" },
    };

    strHtml += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">';
    d.strategies.forEach(function(s) {
      if (s.totalReturn === undefined) return;
      var info = labels[s.name] || { emoji: "📋", desc: "", tip: "" };
      var color = s.totalReturn >= 0 ? "#E53935" : "#43A047";
      var grade = s.totalReturn >= 15 ? "A" : s.totalReturn >= 5 ? "B" : s.totalReturn >= 0 ? "C" : "D";
      var gradeColor = grade === "A" ? "#E53935" : grade === "B" ? "#f59e0b" : grade === "C" ? "#8b5cf6" : "#666";
      strHtml += '<div style="background:#fff;border:2px solid '+(s.name===bestName?'#1a73e8':'#eee')+';border-radius:8px;padding:14px;text-align:center;'+(s.name===bestName?'box-shadow:0 0 12px rgba(26,115,232,0.15)':'')+'">';
      strHtml += '<div style="font-size:12px;color:#999;margin-bottom:2px;">'+info.emoji+' '+s.name+'</div>';
      strHtml += '<div style="font-size:26px;font-weight:800;color:'+color+';margin:6px 0;">'+(s.totalReturn>0?'+':'')+s.totalReturn.toFixed(1)+'%</div>';
      strHtml += '<div style="display:flex;justify-content:center;gap:8px;font-size:11px;color:#666;margin-bottom:6px;">';
      strHtml += '<span>Sharpe '+s.sharpe+'</span><span>胜率 '+s.winRate+'%</span><span>'+s.totalTrades+'笔</span>';
      strHtml += '</div>';
      strHtml += '<div style="font-size:11px;color:#999;line-height:1.4;">'+info.desc+'</div>';
      strHtml += '<div style="font-size:10px;color:#aaa;margin-top:4px;">💡 '+info.tip+'</div>';
      strHtml += (s.name===bestName ? '<div style="margin-top:8px;background:#1a73e8;color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;display:inline-block;">🏆 最佳</div>' : '');
      strHtml += '</div>';
    });
    strHtml += '</div>';
    document.getElementById("qlStrategies").innerHTML = strHtml || '<div style="color:#999">无策略数据</div>';

    // 更新状态栏
    if (d.bestStrategy) {
      $("#qlStatus").innerHTML = '<b>'+d.name+'</b> ¥'+(d.price||0).toFixed(2)+' | 🏆 最佳策略: '+d.bestStrategy.name+' <span style="color:'+(d.bestStrategy.totalReturn>=0?'#E53935':'#43A047')+';">'+(d.bestStrategy.totalReturn>0?'+':'')+d.bestStrategy.totalReturn.toFixed(1)+'%</span>';
    }
  } catch(e) { console.error(e); $("#qlStatus").textContent = "加载失败"; }
}

$("#btnQlBt")?.addEventListener("click", () => {
  if (qlData?.bestStrategy) {
    var s = qlData.bestStrategy;
    alert("最佳策略: "+s.name+"\n收益: "+(s.totalReturn>0?'+':'')+s.totalReturn.toFixed(1)+"%\nSharpe: "+s.sharpe+"\n最大回撤: "+s.maxDrawdown+"%\n交易次数: "+s.totalTrades+"\n胜率: "+s.winRate+"%");
  }
});
PageRegistry.register("news", {
  init: async () => {
    const btn = document.getElementById("btnNewsRefresh");
    const filter = document.getElementById("newsFilterSentiment");
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener("click", loadNews);
      filter.addEventListener("change", loadNews);
    }
    loadNews();
    // 每60秒自动刷新
    if (!window._newsTimer) {
      window._newsTimer = setInterval(loadNews, 60000);
    }
  },
  cleanup: () => {
    if (window._newsTimer) { clearInterval(window._newsTimer); window._newsTimer = null; }
  }
});

async function loadNews() {
  const list = document.getElementById("newsList");
  const empty = document.getElementById("newsEmpty");
  const status = document.getElementById("newsStatus");
  const filter = document.getElementById("newsFilterSentiment").value;

  // HTML转义函数
  const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  // URL校验
  const safeUrl = (u) => { try { const url = new URL(u); return url.protocol==="http:"||url.protocol==="https:" ? url.href : "#"; } catch { return "#"; } };

  status.textContent = "加载中...";
  try {
    // 并行获取情绪、新闻和AI分析
    const [sentResp, newsResp, analysisResp] = await Promise.all([
      fetch("/api/news/sentiment"),
      fetch(`/api/news/latest?pageSize=50${filter ? '&sentiment=' + filter : ''}`),
      fetch("/api/news/analysis"),
    ]);
    const sent = await sentResp.json();
    const news = await newsResp.json();
    const analysis = await analysisResp.json();

    // 更新情绪仪表盘（textContent安全）
    document.getElementById("newsSentimentIndex").textContent = sent.index ?? "--";
    const idx = sent.index ?? 50;
    document.getElementById("newsSentimentIndex").style.color = idx >= 60 ? "#22c55e" : idx <= 40 ? "#ef4444" : "#8b5cf6";
    document.getElementById("newsSentimentLabel").textContent = sent.label || "中性";
    document.getElementById("newsPosCount").textContent = sent.positive ?? 0;
    document.getElementById("newsNegCount").textContent = sent.negative ?? 0;
    document.getElementById("newsNeuCount").textContent = sent.neutral ?? 0;

    // 渲染AI市场分析卡片
    const analysisCard = document.getElementById("newsAnalysisCard");
    if (analysis && analysis.conclusion) {
      analysisCard.style.display = "block";
      document.getElementById("newsAnalysisConclusion").textContent = analysis.conclusion;
      document.getElementById("newsAnalysisTime").textContent = analysis.lastUpdate ? new Date(analysis.lastUpdate).toLocaleTimeString() : "";
      // 渲染热点板块标签
      const sectorsEl = document.getElementById("newsAnalysisSectors");
      sectorsEl.innerHTML = (analysis.sectors || []).slice(0, 6).map(s => {
        const bgColor = s.avgSentiment > 0.1 ? "rgba(34,197,94,0.15)" : s.avgSentiment < -0.1 ? "rgba(239,68,68,0.15)" : "rgba(156,163,175,0.15)";
        const textColor = s.avgSentiment > 0.1 ? "#22c55e" : s.avgSentiment < -0.1 ? "#ef4444" : "#9ca3af";
        const arrow = s.avgSentiment > 0.1 ? "↑" : s.avgSentiment < -0.1 ? "↓" : "→";
        return `<span onclick="filterNewsBySector('${esc(s.name)}')" style="cursor:pointer;padding:4px 10px;border-radius:6px;font-size:12px;background:${bgColor};color:${textColor};font-weight:500;">${esc(s.name)} ${arrow} ${s.count}条</span>`;
      }).join("");
    } else {
      analysisCard.style.display = "none";
    }

    // 渲染新闻列表
    if (!news.items || news.items.length === 0) {
      list.innerHTML = "";
      empty.style.display = "block";
      empty.textContent = "暂无快讯数据，点击刷新获取";
      status.textContent = `最后更新: ${sent.lastUpdate ? new Date(sent.lastUpdate).toLocaleTimeString() : '--'}`;
      return;
    }
    empty.style.display = "none";
    list.innerHTML = news.items.map(n => {
      const color = n.sentiment > 0.1 ? "#22c55e" : n.sentiment < -0.1 ? "#ef4444" : "#9ca3af";
      const label = esc(n.sentimentLabel);
      const labelBg = n.sentiment > 0.1 ? "rgba(34,197,94,0.1)" : n.sentiment < -0.1 ? "rgba(239,68,68,0.1)" : "rgba(156,163,175,0.1)";
      const time = n.publishedAt ? new Date(n.publishedAt).toLocaleTimeString("zh-CN", {hour:"2-digit",minute:"2-digit"}) : "";
      const title = esc(n.title);
      const source = esc(n.source);
      const href = safeUrl(n.url);
      // 关联个股（优先显示带名称的板块个股，否则显示代码）
      const sectorStocks = (n.sectorStocks || []).filter(s => s && s.code);
      const codes = sectorStocks.length > 0
        ? sectorStocks.map(s =>
          `<span style="display:inline-block;padding:1px 6px;background:rgba(139,92,246,0.1);border-radius:4px;font-size:11px;color:#8b5cf6;cursor:pointer;" onclick="event.stopPropagation();window.open('/?code=${esc(s.code)}','_blank')">${esc(s.name || s.code)}</span>`
        ).join(" ")
        : (n.relatedCodes || []).filter(c => /^\d{6}$/.test(c)).slice(0, 3).map(c =>
          `<span style="display:inline-block;padding:1px 6px;background:rgba(139,92,246,0.1);border-radius:4px;font-size:11px;color:#8b5cf6;cursor:pointer;" onclick="event.stopPropagation();window.open('/?code=${esc(c)}','_blank')">${esc(c)}</span>`
        ).join(" ");
      // 板块标签
      const sectors = (n.sectors || []).slice(0, 3).map(s =>
        `<span style="display:inline-block;padding:1px 6px;background:rgba(59,130,246,0.1);border-radius:4px;font-size:11px;color:#3b82f6;">${esc(s)}</span>`
      ).join(" ");
      // 结论
      const conclusion = n.conclusion ? `<div style="font-size:11px;color:#888;margin-top:4px;font-style:italic;">💬 ${esc(n.conclusion)}</div>` : "";
      return `<div style="display:flex;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;cursor:pointer;transition:background .2s;" onmouseover="this.style.background='rgba(139,92,246,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'" onclick="window.open('${href}','_blank')">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:${color};background:${labelBg};">${label}</span>
            <span style="font-size:13px;font-weight:500;color:#e0e0e0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${title}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#666;flex-wrap:wrap;">
            <span>${source}</span>
            <span>${esc(time)}</span>
            ${sectors}
            ${codes ? '<span style="margin-left:auto;">' + codes + '</span>' : ''}
          </div>
          ${conclusion}
        </div>
      </div>`;
    }).join("");
    status.textContent = `共 ${news.total} 条 | 最后更新: ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    status.textContent = "❌ 加载失败: " + esc(e.message);
  }
}

// 按板块筛选新闻
function filterNewsBySector(sector) {
  // 重新加载并过滤
  const list = document.getElementById("newsList");
  const empty = document.getElementById("newsEmpty");
  const status = document.getElementById("newsStatus");
  const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const safeUrl = (u) => { try { const url = new URL(u); return url.protocol==="http:"||url.protocol==="https:" ? url.href : "#"; } catch { return "#"; } };

  status.textContent = `筛选: ${sector}...`;
  fetch(`/api/news/latest?pageSize=50&sector=${encodeURIComponent(sector)}`)
    .then(r => r.json())
    .then(news => {
      if (!news.items || news.items.length === 0) {
        list.innerHTML = "";
        empty.style.display = "block";
        empty.textContent = `暂无「${sector}」相关快讯`;
        status.textContent = `板块筛选: ${sector} | 共 0 条`;
        return;
      }
      empty.style.display = "none";
      list.innerHTML = news.items.map(n => {
        const color = n.sentiment > 0.1 ? "#22c55e" : n.sentiment < -0.1 ? "#ef4444" : "#9ca3af";
        const label = esc(n.sentimentLabel);
        const labelBg = n.sentiment > 0.1 ? "rgba(34,197,94,0.1)" : n.sentiment < -0.1 ? "rgba(239,68,68,0.1)" : "rgba(156,163,175,0.1)";
        const time = n.publishedAt ? new Date(n.publishedAt).toLocaleTimeString("zh-CN", {hour:"2-digit",minute:"2-digit"}) : "";
        const title = esc(n.title);
        const source = esc(n.source);
        const href = safeUrl(n.url);
        const sectorStocks = (n.sectorStocks || []).filter(s => s && s.code);
        const codes = sectorStocks.length > 0
          ? sectorStocks.map(s =>
            `<span style="display:inline-block;padding:1px 6px;background:rgba(139,92,246,0.1);border-radius:4px;font-size:11px;color:#8b5cf6;cursor:pointer;" onclick="event.stopPropagation();window.open('/?code=${esc(s.code)}','_blank')">${esc(s.name || s.code)}</span>`
          ).join(" ")
          : (n.relatedCodes || []).filter(c => /^\d{6}$/.test(c)).slice(0, 3).map(c =>
            `<span style="display:inline-block;padding:1px 6px;background:rgba(139,92,246,0.1);border-radius:4px;font-size:11px;color:#8b5cf6;cursor:pointer;" onclick="event.stopPropagation();window.open('/?code=${esc(c)}','_blank')">${esc(c)}</span>`
          ).join(" ");
        const sectors = (n.sectors || []).slice(0, 3).map(s =>
          `<span style="display:inline-block;padding:1px 6px;background:rgba(59,130,246,0.1);border-radius:4px;font-size:11px;color:#3b82f6;">${esc(s)}</span>`
        ).join(" ");
        const conclusion = n.conclusion ? `<div style="font-size:11px;color:#888;margin-top:4px;font-style:italic;">💬 ${esc(n.conclusion)}</div>` : "";
        return `<div style="display:flex;gap:12px;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;cursor:pointer;transition:background .2s;" onmouseover="this.style.background='rgba(139,92,246,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'" onclick="window.open('${href}','_blank')">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:${color};background:${labelBg};">${label}</span>
              <span style="font-size:13px;font-weight:500;color:#e0e0e0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${title}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#666;flex-wrap:wrap;">
              <span>${source}</span>
              <span>${esc(time)}</span>
              ${sectors}
              ${codes ? '<span style="margin-left:auto;">' + codes + '</span>' : ''}
            </div>
            ${conclusion}
          </div>
        </div>`;
      }).join("");
      status.textContent = `板块: ${sector} | 共 ${news.total} 条 | <a href="javascript:void(0)" onclick="loadNews()" style="color:#8b5cf6;">清除筛选</a>`;
    })
    .catch(e => { status.textContent = "❌ 筛选失败"; });
}

// 交易时段判断 (多模块共用)
function isTradingHours() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), day = now.getDay();
  if (day === 0 || day === 6) return false;
  const t = h * 100 + m;
  return (t >= 930 && t <= 1130) || (t >= 1300 && t <= 1505);
}

// ============ 启动 ============
__diagStep("启动: checkAIConfigured");
checkAIConfigured();
__diagStep("启动: connectWebSocket");
connectWebSocket();
__diagStep("启动: PageRegistry.activate market");
PageRegistry.activate("market").then(() => {
  __diagStep("启动完成 ✓");
  var el = document.getElementById('__loading');
  if (el) setTimeout(() => el.style.display = 'none', 500);
}).catch(e => {
  __diagStep("启动失败: " + e.message + " | stack: " + (e.stack || '').slice(0, 200));
  // 立即隐藏加载遮罩
  var el = document.getElementById('__loading');
  if (el) el.style.display = 'none';
  // 在页面顶部显示错误
  var app = document.getElementById('app');
  if (app) {
    var banner = document.createElement('div');
    banner.style.cssText = 'background:#fff3cd;color:#856404;padding:12px 16px;font-size:14px;text-align:center;border-bottom:2px solid #ffc107;';
    banner.innerHTML = '<b>⚠️ 数据加载失败</b><br><small>' + (e.message || '未知错误') + '<br>请检查网络后<a href=\"/\" style=\"color:#1E88E5;\">刷新页面</a></small>';
    app.insertBefore(banner, app.firstChild);
  }
});

// 安全兜底: 12秒后强制隐藏加载遮罩
setTimeout(function() {
  var el = document.getElementById('__loading');
  if (el && el.style.display !== 'none') {
    __diagStep("超时强制隐藏加载遮罩");
    el.style.display = 'none';
  }
}, 12000);

// ============ 汉堡菜单（移动端） ============
(function() {
  var toggle = document.getElementById('hamburgerToggle');
  if (!toggle) return;

  toggle.addEventListener('click', function() {
    document.body.classList.toggle('nav-open');
    var open = document.body.classList.contains('nav-open');
    toggle.setAttribute('aria-expanded', open);
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.body.classList.contains('nav-open')) {
      document.body.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', function(e) {
    if (document.body.classList.contains('nav-open') &&
        !e.target.closest('nav') &&
        !e.target.closest('.hamburger-toggle')) {
      document.body.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
})();
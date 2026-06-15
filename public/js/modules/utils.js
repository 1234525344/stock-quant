// 量化交易平台 - 工具函数模块

const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

function toast(msg) {
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  document.body.appendChild(t); setTimeout(() => t.remove(), 2500);
}

function fmtFund(val) {
  if (val == null) return "--";
  if (val === 0) return "0 万";
  const abs = Math.abs(val);
  if (abs >= 1e8) return (val / 1e8).toFixed(1) + "亿";
  if (abs >= 1e4) return (val / 1e4).toFixed(0) + "万";
  return val.toFixed(0);
}

function fmtFlowRate(val) {
  if (val == null) return "--";
  const abs = Math.abs(val);
  const sign = val > 0 ? "+" : val < 0 ? "-" : "";
  if (abs >= 1e8) return sign + (val / 1e8).toFixed(2) + "亿/分";
  if (abs >= 1e6) return sign + (val / 1e6).toFixed(1) + "万/分";
  if (abs >= 1e4) return sign + (val / 1e4).toFixed(1) + "万/分";
  if (abs > 0) return sign + abs.toFixed(0) + "/分";
  return "0 万/分";
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

function animateNumber(el, target, duration = 600) {
  const start = parseFloat(el.textContent.replace(/[^0-9.-]/g, "")) || 0;
  if (Math.abs(target - start) < 0.01) { el.textContent = formatNum(target, el); return; }
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * eased;
    el.textContent = formatNum(current, el);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// CSV 导出工具
function exportCSV(filename, headers, rows) {
  const BOM = "﻿"; // UTF-8 BOM for Excel
  const csv = BOM + headers.join(",") + "\n" +
    rows.map(row => headers.map(h => {
      const v = row[h] != null ? String(row[h]) : "";
      return v.includes(",") || v.includes('"') ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// 导出到全局
window.$ = $;
window.$$ = $$;
window.toast = toast;
window.fmtFund = fmtFund;
window.fmtFlowRate = fmtFlowRate;
window.formatNum = formatNum;
window.animateNumber = animateNumber;
window.escapeHTML = escapeHTML;
window.exportCSV = exportCSV;

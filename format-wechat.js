// 公众号文章 HTML 格式化工具
// 把每日文章转成公众号编辑器兼容的 HTML（内联样式）
// 用法: node format-wechat.js → 输出到 D:/作业/daily-picks/wechat_YYYYMMDD.html
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = "D:/作业/daily-picks";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on("error", reject);
  });
}

// HTML 转义
function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// 公众号兼容的 CSS 内联样式
const STYLE = {
  body: "font-size:15px;color:#333;line-height:1.8;letter-spacing:0.5px;padding:0;max-width:100%;word-break:break-all;",
  header: "font-size:22px;font-weight:bold;color:#1A1A1A;text-align:center;padding:20px 0 8px;border-bottom:3px solid #D32F2F;display:inline-block;",
  subHeader: "font-size:14px;color:#999;text-align:center;padding-bottom:16px;",
  sectionTitle: "font-size:18px;font-weight:bold;color:#1A1A1A;padding:18px 0 8px;border-left:4px solid #D32F2F;padding-left:10px;margin:20px 0 10px;",
  card: "background:#FAFAFA;border-radius:6px;padding:14px 16px;margin:10px 0;",
  stockName: "font-size:16px;font-weight:bold;color:#1A1A1A;",
  scoreHigh: "font-size:18px;font-weight:bold;color:#D32F2F;",
  scoreMid: "font-size:18px;font-weight:bold;color:#F5A623;",
  scoreLow: "font-size:18px;font-weight:bold;color:#666;",
  tag: "display:inline-block;background:#FFF0F0;color:#D32F2F;font-size:12px;padding:2px 8px;border-radius:3px;margin:2px 4px 2px 0;",
  footer: "font-size:12px;color:#bbb;text-align:center;padding:20px 0;border-top:1px solid #eee;margin-top:20px;",
  divider: "border:0;height:1px;background:#eee;margin:16px 0;",
  quote: "background:#FFF9F0;border-left:3px solid #F5A623;padding:8px 12px;margin:8px 0;font-size:14px;color:#888;",
};

// 构建 HTML
async function buildHTML() {
  // 获取选股数据
  let picksData = [];
  try {
    for (const mode of [
      { key: "strong", label: "强势突破" },
      { key: "volume", label: "放量突破" },
    ]) {
      const res = await httpGet(`http://localhost:3456/api/scan?mode=${mode.key}&minScore=30&limit=6`);
      if (res && res.results) picksData.push({ mode: mode.label, stocks: res.results.slice(0, 6) });
    }
  } catch (e) { /* 服务器未运行，生成空模板 */ }

  const today = new Date();
  const ds = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const wd = ["日", "一", "二", "三", "四", "五", "六"][today.getDay()];

  let html = `<section style="${STYLE.body}">\n`;

  // 标题
  html += `<p style="text-align:center;"><span style="${STYLE.header}">每日量化选股</span></p>\n`;
  html += `<p style="${STYLE.subHeader}">${ds} 星期${wd}</p>\n`;
  html += `<hr style="${STYLE.divider}">\n`;

  // 说明
  html += `<blockquote style="${STYLE.quote}">基于多因子量化模型自动筛选，综合动量、趋势、量价、资金流等 13 个因子打分。仅供参考，不构成投资建议。</blockquote>\n`;

  // 去重 + 排序
  let allStocks = [];
  picksData.forEach(m => m.stocks.forEach(s => allStocks.push({ ...s, mode: m.mode })));
  const seen = new Set();
  allStocks = allStocks.filter(s => {
    if (seen.has(s.code)) return false;
    seen.add(s.code);
    return true;
  }).sort((a, b) => b.score - a.score).slice(0, 6);

  if (allStocks.length > 0) {
    html += `<h2 style="${STYLE.sectionTitle}">今日标的</h2>\n`;

    allStocks.forEach((s, i) => {
      const emoji = s.grade === "A级" ? "⭐" : s.grade === "B级" ? "🔹" : "▫️";
      const sc = s.score >= 60 ? STYLE.scoreHigh : s.score >= 45 ? STYLE.scoreMid : STYLE.scoreLow;
      const chgColor = s.chg5 >= 0 ? "color:#D32F2F;" : "color:#4CAF50;";

      html += `<div style="${STYLE.card}">\n`;
      html += `  <p style="margin:0 0 6px;">\n`;
      html += `    <span style="${STYLE.stockName}">${emoji} ${esc(s.name)}</span>\n`;
      html += `    <span style="font-size:13px;color:#999;margin-left:8px;">${esc(s.code)}</span>\n`;
      html += `    <span style="float:right;${sc}">${s.score}分</span>\n`;
      html += `  </p>\n`;

      html += `  <p style="margin:4px 0;font-size:14px;">\n`;
      html += `    5日涨跌：<span style="${chgColor}font-weight:bold;">${s.chg5 >= 0 ? "+" : ""}${s.chg5.toFixed(1)}%</span>\n`;
      html += `    &nbsp;&nbsp;等级：<span style="font-weight:bold;">${esc(s.grade || "C级")}</span>\n`;
      html += `  </p>\n`;

      if (s.reasons && s.reasons.length > 0) {
        html += `  <p style="margin:6px 0 0;font-size:13px;">\n`;
        s.reasons.slice(0, 4).forEach(r => {
          html += `    <span style="${STYLE.tag}">${esc(r)}</span> `;
        });
        html += `</p>\n`;
      }

      html += `</div>\n`;
    });
  } else {
    html += `<p style="text-align:center;color:#999;padding:40px 0;">今日暂无符合条件标的（服务器未运行或非交易日）</p>\n`;
  }

  // 模型说明
  html += `<h2 style="${STYLE.sectionTitle}">模型说明</h2>\n`;
  html += `<p style="font-size:14px;color:#666;">\n`;
  html += `  <strong>📊 评分维度：</strong><br>\n`;
  html += `  🚀 启动动量（0-55分）：突破信号 + 放量确认 + 短期动量 + MACD + RSI<br>\n`;
  html += `  📈 质量确认（0-30分）：均线趋势 + OBV资金流 + 成交量活跃度 + 波动率 + KDJ<br>\n`;
  html += `  📍 位置参考（0-15分）：距60日高点位置 + 回调企稳信号<br>\n`;
  html += `</p>\n`;

  html += `<blockquote style="${STYLE.quote}">\n`;
  html += `  <strong>分值含义：</strong><br>\n`;
  html += `  60分以上 → A级 · 强势突破，重点关注<br>\n`;
  html += `  45-59分 → B级 · 正在启动，加入观察池<br>\n`;
  html += `  30-44分 → C级 · 有启动迹象<br>\n`;
  html += `</blockquote>\n`;

  // 页脚
  html += `<hr style="${STYLE.divider}">\n`;
  html += `<p style="${STYLE.footer}">\n`;
  html += `  ⚠️ 以上内容由量化模型自动生成，不构成投资建议。<br>\n`;
  html += `  数据来源：通达信实时行情 &nbsp;|&nbsp; 模型：多因子评分（13因子）<br>\n`;
  html += `  关注我获取每日更新 #量化交易 #A股 #每日选股\n`;
  html += `</p>\n`;

  html += `</section>`;

  return { html, allStocks };
}

async function main() {
  console.log("📝 生成公众号 HTML...");
  const { html, allStocks } = await buildHTML();

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filePath = path.join(OUT, `wechat_${dateStr}.html`);
  fs.writeFileSync(filePath, html, "utf8");
  console.log(`   HTML: ${filePath} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);

  // 同时生成纯文本版（备用）
  let txt = `每日量化选股 ${new Date().toLocaleDateString("zh-CN")}\n\n`;
  allStocks.forEach((s, i) => {
    txt += `${i + 1}. ${s.grade === "A级" ? "⭐" : "🔹"} ${s.name}(${s.code}) 评分${s.score}分 5日${s.chg5 >= 0 ? "+" : ""}${s.chg5.toFixed(1)}%\n`;
    if (s.reasons) txt += `   信号：${s.reasons.slice(0, 3).join(" · ")}\n`;
    txt += "\n";
  });
  txt += "──\n⚠️ 仅供参考，不构成投资建议\n";

  const txtPath = path.join(OUT, `wechat_${dateStr}.txt`);
  fs.writeFileSync(txtPath, txt, "utf8");
  console.log(`   文本: ${txtPath}`);

  console.log("\n✅ 公众号文章已生成");
  console.log("   发布步骤：");
  console.log("   1. 打开 https://mp.weixin.qq.com");
  console.log("   2. 新建图文消息");
  console.log("   3. 用浏览器打开 HTML 文件 → 全选复制");
  console.log("   4. 粘贴到公众号编辑器（Ctrl+V）");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

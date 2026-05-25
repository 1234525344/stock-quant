// 每日量化选股卡片生成 — 发订阅用户 / 闲鱼交付
const { createCanvas } = require("canvas");
const fs = require("fs");
const path = require("path");
const http = require("http");

const OUT = "D:/作业/daily-picks";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on("error", reject);
  });
}

// ============ 绘图工具 ============
function filledRect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

function text(ctx, str, x, y, opts = {}) {
  ctx.save();
  ctx.fillStyle = opts.color || "#333";
  ctx.font = (opts.bold ? "bold " : "") + (opts.size || 24) + "px sans-serif";
  ctx.textAlign = opts.align || "left";
  ctx.textBaseline = "top";
  ctx.fillText(str, x, y);
  ctx.restore();
}

function tw(ctx, str, opts = {}) {
  ctx.save();
  ctx.font = (opts.bold ? "bold " : "") + (opts.size || 24) + "px sans-serif";
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}

// 信号标签
function signalTag(ctx, label, x, y, color) {
  const w = tw(ctx, label, { size: 15, bold: true }) + 16;
  filledRect(ctx, x, y, w, 24, color);
  text(ctx, label, x + 8, y + 4, { size: 15, bold: true, color: "#fff" });
}

// ============ 生成每日卡片 ============
async function generateDailyCard(picksData) {
  const W = 750, H = 1100;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");

  const today = new Date();
  const ds = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;
  const wd = ["日", "一", "二", "三", "四", "五", "六"][today.getDay()];

  // 背景
  filledRect(ctx, 0, 0, W, H, "#0A0E27");

  // 顶部装饰线
  filledRect(ctx, 0, 0, W, 4, "#F5A623");

  // 标题
  text(ctx, "每日量化选股", 30, 30, { size: 42, bold: true, color: "#fff" });
  text(ctx, ds + "  周" + wd, 30, 82, { size: 22, color: "rgba(255,255,255,0.5)" });

  // 分割线
  filledRect(ctx, 30, 124, W - 60, 1, "rgba(255,255,255,0.08)");

  // 说明
  text(ctx, "基于多因子量化模型自动筛选，仅供参考，不构成投资建议", 30, 140, { size: 16, color: "rgba(255,255,255,0.3)" });

  // 逐只展示
  let allStocks = [];
  picksData.forEach(m => {
    m.stocks.forEach(s => allStocks.push({ ...s, mode: m.mode }));
  });
  // 去重 + 排序
  const seen = new Set();
  allStocks = allStocks.filter(s => {
    if (seen.has(s.code)) return false;
    seen.add(s.code);
    return true;
  }).sort((a, b) => b.score - a.score).slice(0, 6);

  allStocks.forEach((s, i) => {
    const y = 180 + i * 140;

    // 卡片底色
    filledRect(ctx, 30, y, W - 60, 128, i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)");
    filledRect(ctx, 30, y, 4, 128, s.score >= 70 ? "#F5A623" : s.score >= 55 ? "#4A90D9" : "#666");

    // 排名
    text(ctx, "#" + (i + 1), 50, y + 12, { size: 28, bold: true, color: "#fff" });

    // 股票名 + 代码
    text(ctx, s.name, 100, y + 12, { size: 28, bold: true, color: "#fff" });
    text(ctx, s.code, 100 + tw(ctx, s.name, { size: 28, bold: true }) + 14, y + 18, { size: 17, color: "rgba(255,255,255,0.4)" });

    // 评分
    const scoreColor = s.score >= 70 ? "#F5A623" : s.score >= 55 ? "#4A90D9" : "#888";
    text(ctx, "评分", 470, y + 12, { size: 16, color: "rgba(255,255,255,0.4)" });
    text(ctx, String(s.score), 510, y + 8, { size: 36, bold: true, color: scoreColor });
    text(ctx, "分", 550, y + 20, { size: 14, color: "rgba(255,255,255,0.3)" });

    // 涨跌幅
    const chgColor = s.chg5 >= 0 ? "#FF4D4F" : "#52C41A";
    text(ctx, (s.chg5 >= 0 ? "+" : "") + s.chg5.toFixed(1) + "%", 610, y + 12, { size: 22, bold: true, color: chgColor });
    text(ctx, "5日", 610, y + 42, { size: 14, color: "rgba(255,255,255,0.3)" });

    // 等级标签
    const gradeColor = s.grade === "A级" ? "#F5A623" : s.grade === "B级" ? "#4A90D9" : "#888";
    signalTag(ctx, s.grade || "C级", 720, y + 12, gradeColor);

    // 理由
    if (s.reasons && s.reasons.length > 0) {
      text(ctx, "信号：", 50, y + 56, { size: 16, color: "rgba(255,255,255,0.4)" });
      s.reasons.slice(0, 4).forEach((r, ri) => {
        const rx = 50 + ri * 190;
        filledRect(ctx, rx, y + 82, 178, 28, "rgba(255,255,255,0.06)");
        text(ctx, r, rx + 8, y + 88, { size: 14, color: "rgba(255,255,255,0.7)" });
      });
    }
  });

  // 底部
  const footerY = allStocks.length * 140 + 200;
  filledRect(ctx, 30, footerY, W - 60, 1, "rgba(255,255,255,0.08)");

  text(ctx, "⚠️ 以上内容由量化模型自动生成，不构成投资建议。", 30, footerY + 20, { size: 16, color: "rgba(255,255,255,0.3)" });
  text(ctx, "📊 模型：多因子评分（动量 + 趋势 + 量价 + 资金流）", 30, footerY + 48, { size: 16, color: "rgba(255,255,255,0.3)" });
  text(ctx, "📡 数据来源：通达信实时行情", 30, footerY + 72, { size: 16, color: "rgba(255,255,255,0.25)" });

  // 切掉空白
  const finalH = footerY + 110;
  const finalCanvas = createCanvas(W, finalH);
  const fctx = finalCanvas.getContext("2d");
  fctx.drawImage(c, 0, 0, W, finalH, 0, 0, W, finalH);

  return finalCanvas;
}

// ============ 生成文本版（发微信/闲鱼聊天）============
function generateTextVersion(picksData) {
  const today = new Date();
  const ds = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;
  const wd = ["日", "一", "二", "三", "四", "五", "六"][today.getDay()];

  let txt = `📊 每日量化选股 ${ds} 周${wd}\n`;
  txt += `━━━━━━━━━━━━━━━━\n\n`;

  let allStocks = [];
  picksData.forEach(m => {
    m.stocks.forEach(s => allStocks.push({ ...s, mode: m.mode }));
  });
  const seen = new Set();
  allStocks = allStocks.filter(s => {
    if (seen.has(s.code)) return false;
    seen.add(s.code);
    return true;
  }).sort((a, b) => b.score - a.score).slice(0, 6);

  allStocks.forEach((s, i) => {
    const emoji = s.grade === "A级" ? "⭐" : s.grade === "B级" ? "🔹" : "▫️";
    txt += `${emoji} ${s.name}（${s.code}）\n`;
    txt += `   评分：${s.score}分 | 5日：${s.chg5 >= 0 ? "+" : ""}${s.chg5}%\n`;
    if (s.reasons) txt += `   信号：${s.reasons.slice(0, 3).join(" · ")}\n`;
    txt += "\n";
  });

  txt += `━━━━━━━━━━━━━━━━\n`;
  txt += `⚠️ 仅供参考，不构成投资建议\n`;
  txt += `📊 量化多因子模型自动筛选\n`;

  return txt;
}

// ============ 主流程 ============
async function main() {
  console.log("📡 获取选股数据...\n");

  // 尝试从服务器获取
  let picksData = [];
  try {
    const modes = [
      { key: "strong", label: "强势突破" },
      { key: "volume", label: "放量突破" },
    ];
    for (const m of modes) {
      const res = await httpGet(`http://localhost:3456/api/scan?mode=${m.key}&minScore=30&limit=6`);
      if (res && res.results) {
        picksData.push({ mode: m.label, stocks: res.results.slice(0, 6) });
      }
    }
  } catch (e) {
    console.log("   ⚠️ 服务器未运行");
    process.exit(1);
  }

  if (picksData.length === 0) {
    console.log("❌ 没有选股结果");
    process.exit(1);
  }

  // 生成卡片图
  console.log("🎨 生成选股卡片...");
  const card = await generateDailyCard(picksData);
  const cardBuf = card.toBuffer("image/png");
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const cardPath = path.join(OUT, `picks_${dateStr}.png`);
  fs.writeFileSync(cardPath, cardBuf);
  console.log(`   卡片: ${cardPath} (${(cardBuf.length / 1024).toFixed(0)} KB)`);

  // 生成文本版
  console.log("📝 生成文本版...");
  const txt = generateTextVersion(picksData);
  const txtPath = path.join(OUT, `picks_${dateStr}.txt`);
  fs.writeFileSync(txtPath, txt, "utf-8");
  console.log(`   文本: ${txtPath}`);

  // 打印预览
  console.log("\n" + "─".repeat(40));
  console.log(txt);
  console.log("─".repeat(40));

  console.log(`\n✅ 生成完毕 → ${OUT}`);
  console.log("   图片发订阅用户 / 文本发闲鱼聊天");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

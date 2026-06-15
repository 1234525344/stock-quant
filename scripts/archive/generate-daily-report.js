// 每日精选报告生成器 — 深色卡片 + 文字版
// 用法: node generate-daily-report.js [日期偏移, 0=今天 -1=昨天, 默认-1]
const { createCanvas } = require("canvas");
const fs = require("fs");
const path = require("path");
const http = require("http");

const API = "http://localhost:3456";
const OUT = "D:/作业/daily-picks";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const DAY_OFFSET = process.argv[2] != null ? parseInt(process.argv[2]) : -1;

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

// 获取日期
function getDateStr() {
  const d = new Date();
  d.setDate(d.getDate() + DAY_OFFSET);
  return {
    full: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`,
    iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    weekday: ["日", "一", "二", "三", "四", "五", "六"][d.getDay()],
  };
}

// 一句话点评 — 像交易员写的，不写教科书画风
function buildOneLiner(s) {
  const chg = s.chg5;
  const absChg = Math.abs(chg);
  const strongTrend = s.trendScore >= 26;
  const strongLaunch = s.launchScore >= 22;
  const hasVol = s.signals.includes("放量") || s.signals.includes("明显放量");
  const breaking = s.signals.includes("突破前高");
  const nearHigh = s.nearHigh20 >= 0.97;
  const contracting = s.signals.includes("缩量") || s.signals.includes("缩量筑底");

  if (breaking && hasVol) return "突破前高，量能配合打开上行空间";
  if (breaking) return "突破前高，关注后续量能能否跟上";
  if (absChg > 30) return strongTrend ? "短线涨幅较大，趋势惯性仍在，追高注意仓位" : "短期拉升过急，需要震荡消化";
  if (absChg > 20) return strongTrend && hasVol ? "量价齐升，趋势加速中，持股为主" : "涨幅已高，等待回踩确认";
  if (nearHigh && hasVol) return "逼近前高，量能放大，突破概率较大";
  if (strongTrend && hasVol) return "量价配合良好，均线多头排列，趋势延续";
  if (strongTrend && strongLaunch) return "动能和趋势共振，处于主升阶段";
  if (strongLaunch && nearHigh) return "放量逼近高点，突破一触即发";
  if (strongLaunch) return "量能放大配合指标金叉，处于起涨阶段";
  if (strongTrend) return "趋势向上，适合持有，追高需谨慎";
  if (contracting && s.positionScore >= 6) return "缩量回踩支撑，筑底迹象，关注放量信号";
  if (s.positionScore >= 10) return "处于相对低位，安全边际较高，等待催化";
  return "评分中等，各项指标均衡，可作为观察标的";
}

// 信号标签 — 简短精炼
function buildSignals(s) {
  const tags = [];
  if (s.signals.includes("突破前高")) tags.push("突破前高");
  else if (s.signals.includes("逼近前高")) tags.push("逼近前高");
  if (s.signals.includes("MACD金叉")) tags.push("MACD金叉");
  else if (s.signals.includes("MACD底叉")) tags.push("MACD底叉");
  if (s.signals.includes("均线多头")) tags.push("均线多头");
  else if (s.signals.includes("MA5>MA10")) tags.push("MA5>MA10");
  if (s.signals.includes("明显放量")) tags.push("明显放量");
  else if (s.signals.includes("放量")) tags.push("放量");
  if (s.signals.includes("MACD红柱放大")) tags.push("红柱放大");
  if (s.signals.includes("缩量筑底")) tags.push("缩量筑底");
  else if (s.signals.includes("缩量")) tags.push("缩量");
  if (s.positionScore >= 12) tags.push("低位");
  if (s.upDays >= 4) tags.push(`${s.upDays}连阳`);
  else if (s.upDays >= 3) tags.push("连续上涨");
  if (s.signals.includes("强势拉升")) tags.push("强势拉升");
  else if (s.chg5 > 8) tags.push("温和上涨");
  if (tags.length < 2) tags.push("趋势延续");
  return tags.slice(0, 3);
}

// ============ 获取数据 ============
async function fetchPicks() {
  console.log("📡 获取选股数据...");
  const res = await httpGet(`${API}/api/scan?mode=all&minScore=35&limit=15`);
  if (!res || !res.results) throw new Error("API 无数据");

  // 去重，按评分排序
  const seen = new Set();
  const unique = [];
  for (const s of res.results) {
    if (seen.has(s.code)) continue;
    seen.add(s.code);
    unique.push(s);
  }
  unique.sort((a, b) => b.score - a.score);
  const top6 = unique.slice(0, 6);

  // 转换为百分制 (满分90 → 100)
  top6.forEach(s => {
    s.score100 = Math.round(s.score / 90 * 100);
    s.gradeDisplay = s.score100 >= 78 ? "A级" : s.score100 >= 65 ? "B级" : "C级";
    s.oneLiner = buildOneLiner(s);
    s.signals = buildSignals(s);
  });

  console.log(`   市场状态: ${res.regime}, 权重: pos=${res.regimeWeights.pos} launch=${res.regimeWeights.launch} trend=${res.regimeWeights.trend}`);
  console.log(`   选出 ${unique.length} 只, 取前 ${top6.length} 只\n`);
  return { picks: top6, regime: res.regime };
}

// ============ Canvas 绘图工具 ============

function filledRect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

function text(ctx, str, x, y, opts = {}) {
  ctx.save();
  ctx.fillStyle = opts.color || "#333";
  ctx.font = (opts.bold ? "bold " : "") + (opts.size || 24) + "px sans-serif";
  ctx.textAlign = opts.align || "left";
  ctx.textBaseline = opts.baseline || "top";
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

function roundRect(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function progressBar(ctx, x, y, w, h, pct, bgColor, fgColor) {
  roundRect(ctx, x, y, w, h, h / 2, bgColor);
  if (pct > 0) roundRect(ctx, x, y, Math.max(w * pct, h), h, h / 2, fgColor);
}

// 生成深色卡片
async function generateCard(data, dateInfo) {
  const W = 840;
  const PAD = 20;
  const CARD_X = PAD;
  const CARD_W = W - PAD * 2;
  const TOP_H = 136;
  const ROW_H = 118;
  const ROW_GAP = 10;
  const N = data.picks.length;

  const H = TOP_H + N * (ROW_H + ROW_GAP) + 150;
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");

  // Background
  filledRect(ctx, 0, 0, W, H, "#090d1a");

  // Top glow
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, 350);
  glow.addColorStop(0, "rgba(245,158,11,0.05)");
  glow.addColorStop(1, "rgba(9,13,26,0)");
  filledRect(ctx, 0, 0, W, 250, glow);

  // Top stripe
  const stripe = ctx.createLinearGradient(0, 0, W, 0);
  stripe.addColorStop(0, "#f59e0b");
  stripe.addColorStop(0.3, "#f97316");
  stripe.addColorStop(0.6, "#ef4444");
  stripe.addColorStop(1, "#8b5cf6");
  filledRect(ctx, 0, 0, W, 3, stripe);

  // Grain
  ctx.fillStyle = "rgba(255,255,255,0.006)";
  for (let i = 0; i < 120; i++) {
    ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
  }

  // Header
  text(ctx, "MARKET CLOSE REVIEW", PAD, 16, { size: 10, bold: true, color: "rgba(245,158,11,0.32)", baseline: "top" });
  text(ctx, "收盘观察", PAD, 34, { size: 36, bold: true, color: "#ffffff" });

  // Date + market
  const dateW = tw(ctx, `${dateInfo.full}  周${dateInfo.weekday}`, { size: 14 }) + 20;
  roundRect(ctx, PAD, 80, dateW, 26, 13, "rgba(255,255,255,0.04)");
  text(ctx, `${dateInfo.full}  周${dateInfo.weekday}`, PAD + 10, 85, { size: 14, color: "rgba(255,255,255,0.48)" });

  const regimeLabel = data.regime === "bull" ? "牛市" : data.regime === "bear" ? "熊市" : data.regime === "range" ? "震荡" : "高波动";
  const regimeColor = data.regime === "bull" ? "#22c55e" : data.regime === "bear" ? "#ef4444" : "#f59e0b";
  const regimeW = tw(ctx, regimeLabel, { size: 12 }) + 16;
  roundRect(ctx, PAD + dateW + 8, 82, regimeW, 22, 11, `${regimeColor}16`);
  text(ctx, regimeLabel, PAD + dateW + 16, 86, { size: 12, color: regimeColor });

  // Divider
  const divGrad = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  divGrad.addColorStop(0, "rgba(255,255,255,0.01)");
  divGrad.addColorStop(0.2, "rgba(255,255,255,0.06)");
  divGrad.addColorStop(0.8, "rgba(255,255,255,0.06)");
  divGrad.addColorStop(1, "rgba(255,255,255,0.01)");
  filledRect(ctx, PAD, 102, W - PAD * 2, 1, divGrad);

  // Column headers
  text(ctx, "标的", PAD + 48, 112, { size: 11, bold: true, color: "rgba(255,255,255,0.16)" });
  text(ctx, "评分", 610, 112, { size: 11, bold: true, color: "rgba(255,255,255,0.16)" });
  text(ctx, "涨跌", 740, 112, { size: 11, bold: true, color: "rgba(255,255,255,0.16)" });

  // Rank accent palette
  const rankAccent = ["#f59e0b", "#f97316", "#ef4444", "#8b5cf6", "#3b82f6", "#14b8a6"];

  // Each stock
  data.picks.forEach((s, i) => {
    const y = TOP_H + i * (ROW_H + ROW_GAP);
    const accent = rankAccent[i];

    // Card bg
    roundRect(ctx, CARD_X, y, CARD_W, ROW_H, 10, "rgba(255,255,255,0.022)");

    // Left accent bar
    roundRect(ctx, CARD_X + 2, y + 12, 3, ROW_H - 24, 2, accent);

    // Rank
    text(ctx, `${i + 1}`, CARD_X + 22, y + ROW_H / 2, { size: 18, bold: true, color: accent, align: "center", baseline: "middle" });

    // Name + code (left side)
    const infoX = CARD_X + 40;
    text(ctx, s.name, infoX, y + 16, { size: 23, bold: true, color: "#f1f5f9" });
    const nameW = tw(ctx, s.name, { size: 23, bold: true });
    const codeW = tw(ctx, s.code, { size: 11 }) + 12;
    roundRect(ctx, infoX + nameW + 8, y + 19, codeW, 18, 9, "rgba(255,255,255,0.06)");
    text(ctx, s.code, infoX + nameW + 14, y + 21, { size: 11, color: "rgba(255,255,255,0.33)" });

    // One-liner (left side, second line)
    text(ctx, s.oneLiner, infoX, y + 52, { size: 13, color: "rgba(255,255,255,0.25)" });

    // Signal chips (left side, third line)
    let chipX = infoX;
    const chipBg = ["rgba(245,158,11,0.10)", "rgba(239,68,68,0.08)", "rgba(139,92,246,0.08)"];
    const chipFg = ["#f59e0b", "#f87171", "#a78bfa"];
    s.signals.slice(0, 3).forEach((sig, si) => {
      const cw = tw(ctx, sig, { size: 12 }) + 16;
      roundRect(ctx, chipX, y + 76, cw, 24, 12, chipBg[si]);
      text(ctx, sig, chipX + 8, y + 81, { size: 12, color: chipFg[si] });
      chipX += cw + 6;
    });

    // ---- Right column (stacked vertically, no overlaps) ----

    // Score + grade on top row
    const scoreColor = s.score100 >= 78 ? "#f59e0b" : s.score100 >= 65 ? "#4A90D9" : accent;
    text(ctx, `${s.score100}`, 650, y + 12, { size: 42, bold: true, color: scoreColor, align: "right" });
    text(ctx, "分", 658, y + 30, { size: 11, color: "rgba(255,255,255,0.2)" });

    const gColor = s.gradeDisplay === "A级" ? "#f59e0b" : s.gradeDisplay === "B级" ? "#4A90D9" : accent;
    roundRect(ctx, 680, y + 14, 36, 20, 10, gColor);
    text(ctx, s.gradeDisplay, 698, y + 19, { size: 13, bold: true, color: "#fff", align: "center" });

    // Change on second row, below score
    const chgStr = (s.chg5 >= 0 ? "+" : "") + s.chg5.toFixed(1) + "%";
    const chgColor = s.chg5 >= 0 ? "#ef4444" : "#22c55e";
    text(ctx, chgStr, 790, y + 50, { size: 20, bold: true, color: chgColor, align: "right" });
    text(ctx, "5日", 790, y + 72, { size: 11, color: "rgba(255,255,255,0.16)", align: "right" });

    // Score bar at bottom
    const barX = 610;
    const barW = 80;
    const barY = y + 58;
    filledRect(ctx, barX, barY, barW, 3, "rgba(255,255,255,0.06)");
    filledRect(ctx, barX, barY, barW * Math.min(s.score100 / 100, 1), 3, scoreColor);
  });

  // Footer
  const footerY = TOP_H + N * (ROW_H + ROW_GAP) + 32;
  filledRect(ctx, PAD, footerY, W - PAD * 2, 1, divGrad);

  const avgScore = Math.round(data.picks.reduce((sum, s) => sum + s.score100, 0) / N);
  const upCount = data.picks.filter(s => s.chg5 > 0).length;
  text(ctx, `${N} 只标的  |  均分 ${avgScore}  |  ${upCount} 只上涨  |  盘后整理，仅供复盘`, PAD, footerY + 20, { size: 14, color: "rgba(255,255,255,0.26)" });
  text(ctx, "位置 · 动能 · 趋势  |  多因子共振选股", PAD, footerY + 46, { size: 14, color: "rgba(255,255,255,0.16)" });
  text(ctx, "lbquant.top", W - PAD - tw(ctx, "lbquant.top", { size: 13 }), footerY + 46, { size: 13, color: "rgba(255,255,255,0.10)", align: "right" });

  // Final crop
  const finalH = footerY + 90;
  const finalCanvas = createCanvas(W, finalH);
  const fctx = finalCanvas.getContext("2d");
  fctx.drawImage(c, 0, 0, W, finalH, 0, 0, W, finalH);

  return finalCanvas;
}

// ============ 文本版 ============
function generateText(picks, dateInfo) {
  let txt = `收盘观察  |  ${dateInfo.full}  周${dateInfo.weekday}\n`;
  txt += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  picks.picks.forEach((s, i) => {
    const grade = s.gradeDisplay;
    const chg = s.chg5 >= 0 ? `+${s.chg5.toFixed(1)}%` : `${s.chg5.toFixed(1)}%`;
    txt += `${i + 1}. ${s.name}（${s.code}）${grade}\n`;
    txt += `   评分 ${s.score100}  |  5日 ${chg}\n`;
    txt += `   信号：${s.signals.slice(0, 3).join(" / ")}\n`;
    txt += `   ${s.oneLiner}\n\n`;
  });

  txt += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  txt += `盘后数据整理，仅供复盘参考，不构成投资建议。\n`;
  txt += `选股逻辑：位置评分 + 启动动能 + 趋势强度 共振\n`;
  txt += `数据：通达信行情 | lbquant.top\n`;
  return txt;
}

// ============ 主流程 ============
async function main() {
  console.log("═".repeat(50));
  console.log("  收盘观察报告生成器");
  console.log("═".repeat(50));
  console.log(`  日期偏移: ${DAY_OFFSET} (0=今天, -1=昨天)`);

  const dateInfo = getDateStr();
  console.log(`  目标日期: ${dateInfo.full} 周${dateInfo.weekday}\n`);

  // 1. 获取数据
  const data = await fetchPicks();

  if (data.picks.length === 0) {
    console.log("❌ 无符合条件的标的");
    process.exit(1);
  }

  // 打印预览
  console.log("│  # │ 名称      │ 代码   │ 评分 │ 等级 │  5日   │ 信号");
  console.log("│ ───┼───────────┼────────┼──────┼──────┼────────┼────────────────");
  data.picks.forEach((s, i) => {
    console.log(`│ ${i + 1}  │ ${s.name.padEnd(8)} │ ${s.code} │ ${String(s.score100).padStart(3)} │ ${s.gradeDisplay.padEnd(4)} │ ${(s.chg5 >= 0 ? "+" : "") + s.chg5.toFixed(1).padStart(5)}% │ ${s.signals.slice(0, 3).join(" / ")}`);
  });
  console.log();

  // 2. 生成卡片图
  console.log("🎨 生成深色精选卡片...");
  const card = await generateCard(data, dateInfo);
  const dateTag = dateInfo.iso.replace(/-/g, "");
  const cardPath = path.join(OUT, `picks_${dateTag}.png`);
  const buf = card.toBuffer("image/png");
  fs.writeFileSync(cardPath, buf);
  console.log(`   ✅ 卡片: ${cardPath} (${(buf.length / 1024).toFixed(0)} KB)`);

  // 3. 生成文本版
  console.log("📝 生成文字版...");
  const txt = generateText(data, dateInfo);
  const txtPath = path.join(OUT, `picks_${dateTag}.txt`);
  fs.writeFileSync(txtPath, txt, "utf-8");
  console.log(`   ✅ 文本: ${txtPath}`);

  // 4. 打印文本版
  console.log("\n" + "─".repeat(50));
  console.log(txt);
  console.log("─".repeat(50));

  console.log(`\n✅ 报告生成完毕 → ${OUT}`);
  console.log("   图片发订阅/朋友圈，文字发微信群/聊天");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

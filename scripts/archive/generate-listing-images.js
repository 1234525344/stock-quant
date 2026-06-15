// 闲鱼商品图 v3 — 极简高端风格
const { createCanvas } = require("canvas");
const fs = require("fs");
const path = require("path");

const OUT = "D:/作业/listing-images";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const W = 750, H = 1000;

// ============ 工具函数 ============
function R(ctx, x, y, w, h, r, c) {
  if (!c || c === "transparent") return;
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function T(ctx, str, x, y, opts = {}) {
  ctx.save();
  ctx.fillStyle = opts.c || "#222";
  ctx.font = (opts.b ? "bold " : "") + (opts.s || 28) + "px " + (opts.f || "sans-serif");
  ctx.textAlign = opts.a || "left";
  ctx.textBaseline = "top";
  ctx.fillText(str, x, y);
  ctx.restore();
}
function TW(ctx, str, opts = {}) {
  ctx.save();
  ctx.font = (opts.b ? "bold " : "") + (opts.s || 28) + "px " + (opts.f || "sans-serif");
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}
function TC(ctx, str, y, opts = {}) { T(ctx, str, W / 2, y, { ...opts, a: "center" }); }

// 分隔线
function hr(ctx, y, c = "rgba(0,0,0,0.08)") {
  ctx.fillStyle = c; ctx.fillRect(40, y, W - 80, 1);
}

// ============ 图1：实训报告 ============
function makeReport() {
  const c = createCanvas(W, H); const ctx = c.getContext("2d");
  const P = 40; // padding

  // 纯白底
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);

  // 顶部色块 — 深蓝色
  ctx.fillStyle = "#1B2838"; ctx.fillRect(0, 0, W, 260);

  // 大标题
  T(ctx, "实训报告", P, 40, { s: 54, b: true, c: "#fff" });
  T(ctx, "自动排版生成", P, 102, { s: 34, b: true, c: "#F0C060" });

  // 三列数字
  [
    { n: "¥20", l: "一份" },
    { n: "2h", l: "交付" },
    { n: "¥5", l: "修改" },
  ].forEach((d, i) => {
    const bx = P + i * 138;
    T(ctx, d.n, bx, 170, { s: 32, b: true, c: "#fff" });
    T(ctx, d.l, bx + TW(ctx, d.n, { s: 32, b: true }) + 6, 178, { s: 15, c: "rgba(255,255,255,0.5)" });
  });

  // 流程条
  R(ctx, P, 230, W - P * 2, 36, 8, "#F8F8F8");
  T(ctx, "① 你发实验数据", P + 14, 240, { s: 14, b: true, c: "#1B2838" });
  T(ctx, "→  ② 我处理排版  →  ③ 发你成品  →  ④ 确认收货", P + 140, 240, { s: 14, c: "#999" });

  // === 预览卡片 ===
  const CY = 300;
  R(ctx, P, CY, W - P * 2, 340, 10, "#FAFBFC");

  // 模拟表格
  R(ctx, P + 20, CY + 20, W - P * 2 - 40, 28, 4, "#1B2838");
  T(ctx, "表1  牙膏固含量的测定结果", P + 36, CY + 26, { s: 13, b: true, c: "#fff" });

  // 表头
  [P + 20, P + 240, P + 455].forEach((x, i) => {
    R(ctx, x, CY + 52, [215, 210, 210][i], 22, 0, "#F2F2F2");
  });
  T(ctx, "项目", P + 34, CY + 56, { s: 12, b: true, c: "#555" });
  T(ctx, "样品 1", P + 320, CY + 56, { s: 12, b: true, c: "#555", a: "center" });
  T(ctx, "样品 2", P + 540, CY + 56, { s: 12, b: true, c: "#555", a: "center" });

  const rows = [
    ["固含量 W / %", "21.9", "24.3"],
    ["pH 值", "8.10", "8.15"],
    ["w(CaCO₃) / %", "26.11", "34.84"],
    ["可溶氟 / (μg/g)", "1815.85", "3196.55"],
  ];
  rows.forEach((row, i) => {
    const ry = CY + 76 + i * 24;
    const bg = i % 2 === 0 ? "#fff" : "#FAFAFA";
    R(ctx, P + 20, ry, 215, 22, 0, bg);
    R(ctx, P + 240, ry, 210, 22, 0, bg);
    R(ctx, P + 455, ry, 210, 22, 0, bg);
    T(ctx, row[0], P + 32, ry + 5, { s: 12, c: "#444" });
    T(ctx, row[1], P + 330, ry + 5, { s: 12, c: "#333", a: "center" });
    T(ctx, row[2], P + 550, ry + 5, { s: 12, c: "#333", a: "center" });
  });

  // 底部信息卡
  const c1x = P + 20, c1y = CY + 200;
  R(ctx, c1x, c1y, (W - P * 2 - 60) / 2, 60, 6, "#FFF9F0");
  T(ctx, "📊  数据图表", c1x + 14, c1y + 10, { s: 15, b: true, c: "#1B2838" });
  T(ctx, "标准曲线 · 回归方程 · R² 标注", c1x + 14, c1y + 34, { s: 12, c: "#999" });

  const c2x = c1x + (W - P * 2 - 60) / 2 + 20;
  R(ctx, c2x, c1y, (W - P * 2 - 60) / 2, 60, 6, "#F0F5FF");
  T(ctx, "📄  Word 排版", c2x + 14, c1y + 10, { s: 15, b: true, c: "#1B2838" });
  T(ctx, "宋体小四 · 1.5倍行距 · 页脚页码", c2x + 14, c1y + 34, { s: 12, c: "#999" });

  // 清单
  const LY = 670;
  T(ctx, "交付内容", P, LY, { s: 22, b: true, c: "#1B2838" });
  [
    "Word 报告全文（封面 + 正文 + 检测报告表）",
    "数据分析图表 PNG（回归分析，含 R² 相关性）",
    "标准学术排版，拿到直接打印提交",
  ].forEach((line, i) => {
    const iy = LY + 36 + i * 36;
    R(ctx, P, iy, W - P * 2, 30, 6, i % 2 === 0 ? "#FAFAFA" : "#fff");
    T(ctx, "✓  " + line, P + 14, iy + 7, { s: 15, c: "#555" });
  });

  // 底部
  R(ctx, P, 920, W - P * 2, 56, 10, "#1B2838");
  T(ctx, "¥20 / 份", P + 20, 938, { s: 28, b: true, c: "#F0C060" });
  T(ctx, "数据给我 · 2小时出 · 包修改", P + 180, 942, { s: 14, c: "rgba(255,255,255,0.5)" });

  return c;
}

// ============ 图2：代写脚本 ============
function makeScript() {
  const c = createCanvas(W, H); const ctx = c.getContext("2d");
  const P = 40;

  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);

  // 顶部 — 深黑
  ctx.fillStyle = "#161B22"; ctx.fillRect(0, 0, W, 300);

  // 代码装饰（右侧）
  ctx.fillStyle = "rgba(0,255,136,0.04)";
  ctx.font = "13px monospace";
  for (let i = 0; i < 16; i++) {
    ctx.fillText("const data = await scraper.run(config)", 370, 35 + i * 23);
  }

  T(ctx, "代写脚本", P, 40, { s: 54, b: true, c: "#fff" });
  T(ctx, "Python · Node.js", P, 102, { s: 30, b: true, c: "#00FF88" });
  T(ctx, "你说需求 → 我写代码 → 源码给你", P, 150, { s: 16, c: "rgba(255,255,255,0.6)" });

  // 能力标签
  ["数据采集", "自动化", "数据处理", "工具脚本"].forEach((t, i) => {
    R(ctx, P + i * 148, 195, 134, 30, 6, "rgba(255,255,255,0.08)");
    T(ctx, t, P + i * 148 + 22, 203, { s: 14, c: "rgba(255,255,255,0.8)" });
  });

  // 案例
  T(ctx, "能做什么", P, 255, { s: 13, c: "rgba(255,255,255,0.35)" });
  [
    "网页数据采集 → 导出 Excel / CSV",
    "自动填表、批量提交、定时任务",
    "多平台自动发文（雪球 / 知乎 / 东财）",
  ].forEach((line, i) => T(ctx, line, P, 276 + i * 24, { s: 14, c: "rgba(255,255,255,0.65)" }));

  // 交付
  const DY = 330;
  T(ctx, "交付内容", P, DY, { s: 22, b: true, c: "#161B22" });
  [
    { ico: "📦", t: "源码", d: "注释清晰，到手能跑" },
    { ico: "📋", t: "依赖清单", d: "装好环境就能跑" },
    { ico: "📖", t: "使用说明", d: "截图步骤，包教包会" },
    { ico: "🔧", t: "一周售后", d: "出 bug 免费修" },
  ].forEach((item, i) => {
    const dx = P + i * 162;
    R(ctx, dx, DY + 38, 146, 84, 8, "#FAFAFA");
    T(ctx, item.ico, dx + 18, DY + 50, { s: 26 });
    T(ctx, item.t, dx + 18, DY + 80, { s: 16, b: true, c: "#161B22" });
    T(ctx, item.d, dx + 18, DY + 100, { s: 12, c: "#999" });
  });

  // 价格
  const PY = DY + 160;
  T(ctx, "参考价格", P, PY, { s: 22, b: true, c: "#161B22" });
  const prices = [
    { l: "简单", r: "¥50-100", eg: "单页抓取 · Excel处理", bar: "#00FF88" },
    { l: "中等", r: "¥100-300", eg: "多页爬虫 · 自动填表", bar: "#FFD600" },
    { l: "复杂", r: "¥300-800", eg: "模拟登录 · 多步骤自动化", bar: "#FF9100" },
  ];
  prices.forEach((p, i) => {
    const py = PY + 38 + i * 88;
    R(ctx, P, py, W - P * 2, 74, 8, "#fff");
    R(ctx, P, py + 2, 4, 70, 3, p.bar);
    T(ctx, p.l, P + 22, py + 10, { s: 18, b: true, c: "#161B22" });
    T(ctx, p.r, P + 100, py + 10, { s: 26, b: true, c: "#E53935" });
    T(ctx, p.eg, P + 22, py + 42, { s: 13, c: "#999" });
  });

  // 底部
  R(ctx, P, 920, W - P * 2, 56, 10, "#161B22");
  T(ctx, "¥50 起", P + 20, 938, { s: 28, b: true, c: "#00FF88" });
  T(ctx, "不接违法/灰产/需实名验证的单", P + 150, 942, { s: 14, c: "rgba(255,255,255,0.4)" });

  return c;
}

// ============ 图3：Excel 处理 ============
function makeExcel() {
  const c = createCanvas(W, H); const ctx = c.getContext("2d");
  const P = 40;

  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);

  // 顶部
  ctx.fillStyle = "#134A2E"; ctx.fillRect(0, 0, W, 250);

  // Excel 网格装饰
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let x = 380; x < W; x += 50) ctx.fillRect(x, 30, 1, 220);
  for (let y = 30; y < 250; y += 32) ctx.fillRect(380, y, W - 380, 1);

  T(ctx, "Excel 数据处理", P, 40, { s: 48, b: true, c: "#fff" });
  T(ctx, "数据清洗 · 公式 · 图表 · 报表", P, 98, { s: 24, b: true, c: "#7ED4A5" });
  T(ctx, "表格发来 → 处理完还你 → 整整齐齐", P, 140, { s: 16, c: "rgba(255,255,255,0.6)" });

  // 对比
  R(ctx, P, 185, 320, 52, 8, "#FFF0F0");
  T(ctx, "你发来", P + 16, 194, { s: 15, b: true, c: "#E53935" });
  T(ctx, "乱七八糟的原始数据", P + 16, 214, { s: 13, c: "#999" });

  R(ctx, P + 340, 185, 320, 52, 8, "#F0FFF0");
  T(ctx, "还给你", P + 356, 194, { s: 15, b: true, c: "#134A2E" });
  T(ctx, "干干净净 · 算好了 · 排好了", P + 356, 214, { s: 13, c: "#6A9A6A" });

  // 服务项目
  const SY = 280;
  T(ctx, "服务项目", P, SY, { s: 22, b: true, c: "#134A2E" });
  const svcs = [
    { ico: "🧹", n: "数据清洗", d: "去重 · 格式统一 · 异常值", p: "¥10" },
    { ico: "🔢", n: "公式计算", d: "VLOOKUP · 条件判断", p: "¥15" },
    { ico: "📈", n: "图表制作", d: "柱状图 · 折线图 · 饼图", p: "¥15" },
    { ico: "📎", n: "批量合并", d: "多文件 → 一个汇总表", p: "¥20" },
    { ico: "🎨", n: "排版美化", d: "字体 · 边框 · 打印设置", p: "¥10" },
    { ico: "⚡", n: "自动化", d: "重复操作脚本化", p: "¥30" },
  ];
  svcs.forEach((s, i) => {
    const sx = P + (i % 3) * 218;
    const sy = SY + 38 + Math.floor(i / 3) * 78;
    R(ctx, sx, sy, 200, 64, 8, i % 2 === 0 ? "#F8FAF8" : "#fff");
    T(ctx, s.ico, sx + 14, sy + 8, { s: 18 });
    T(ctx, s.n, sx + 42, sy + 8, { s: 16, b: true, c: "#333" });
    T(ctx, s.p, sx + 154, sy + 10, { s: 15, b: true, c: "#E53935", a: "right" });
    T(ctx, s.d, sx + 14, sy + 38, { s: 12, c: "#999" });
  });

  // 底部
  R(ctx, P, 920, W - P * 2, 56, 10, "#134A2E");
  T(ctx, "¥10 起", P + 20, 938, { s: 28, b: true, c: "#7ED4A5" });
  T(ctx, "具体报价看数据量 · 简单不多收", P + 140, 942, { s: 14, c: "rgba(255,255,255,0.5)" });

  return c;
}

// ============ 图4：多平台发文 ============
function makePublish() {
  const c = createCanvas(W, H); const ctx = c.getContext("2d");
  const P = 40;

  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);

  // 顶部
  ctx.fillStyle = "#2D1060"; ctx.fillRect(0, 0, W, 280);

  // 装饰圆
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  ctx.beginPath(); ctx.arc(600, 120, 130, 0, Math.PI * 2); ctx.fill();

  T(ctx, "多平台一键发文", P, 40, { s: 48, b: true, c: "#fff" });
  T(ctx, "写一篇 → 同步 3 个平台", P, 100, { s: 26, b: true, c: "#C9B8FF" });
  T(ctx, "雪球 / 知乎 / 东方财富  自动填写 + 发布", P, 145, { s: 16, c: "rgba(255,255,255,0.6)" });

  // 平台标签
  [
    { n: "雪球", c: "#FF6B35" },
    { n: "知乎", c: "#0066FF" },
    { n: "东方财富", c: "#E60012" },
  ].forEach((pl, i) => {
    R(ctx, P + i * 128, 190, 112, 32, 8, pl.c);
    T(ctx, pl.n, P + i * 128 + 56, 199, { s: 15, b: true, c: "#fff", a: "center" });
  });
  T(ctx, "脚本在你电脑跑 · 不传账号密码 · 安全", P, 242, { s: 13, c: "rgba(255,255,255,0.4)" });

  // 卖点
  const MY = 320;
  T(ctx, "为什么选这个", P, MY, { s: 22, b: true, c: "#2D1060" });

  [
    { ico: "🚀", t: "一次撰写，三平台同步", d: "写好内容，脚本自动分发到雪球、知乎、东方财富" },
    { ico: "🛡️", t: "本地运行，数据安全", d: "代码在你电脑执行，不经过任何第三方服务器" },
    { ico: "🧠", t: "智能识别编辑器", d: "自动找到各平台编辑框和发布按钮，无需手动操作" },
    { ico: "🔄", t: "包后续维护", d: "平台改版导致失效，免费更新适配" },
  ].forEach((pt, i) => {
    const iy = MY + 42 + i * 62;
    R(ctx, P, iy, W - P * 2, 54, 8, i % 2 === 0 ? "#F8F6FF" : "#fff");
    T(ctx, pt.ico, P + 16, iy + 16, { s: 20 });
    T(ctx, pt.t, P + 46, iy + 14, { s: 16, b: true, c: "#333" });
    T(ctx, pt.d, P + 46 + TW(ctx, pt.t, { s: 16, b: true }) + 16, iy + 16, { s: 13, c: "#999" });
  });

  // 包含
  const IY = MY + 42 + 4 * 62 + 30;
  T(ctx, "包含", P, IY, { s: 22, b: true, c: "#2D1060" });
  ["自动化脚本源码（Node.js，注释清晰）", "依赖清单（装好就能跑）", "详细图文使用说明"].forEach((s, i) => {
    R(ctx, P, IY + 38 + i * 40, W - P * 2, 32, 6, i % 2 === 0 ? "#F8F6FF" : "#fff");
    T(ctx, "✓  " + s, P + 16, IY + 46 + i * 40, { s: 14, c: "#555" });
  });

  // 底部
  R(ctx, P, 920, W - P * 2, 56, 10, "#2D1060");
  T(ctx, "¥99 / 套", P + 20, 938, { s: 28, b: true, c: "#C9B8FF" });
  T(ctx, "一次买断 · 包维护更新 · 仅限正经内容", P + 160, 942, { s: 14, c: "rgba(255,255,255,0.5)" });

  return c;
}

// ============ 图5：每日选股 ============
function makeDailyPicks() {
  const c = createCanvas(W, H); const ctx = c.getContext("2d");
  const P = 40;

  // 深色背景
  ctx.fillStyle = "#0A0E27"; ctx.fillRect(0, 0, W, H);

  // 金色顶线
  ctx.fillStyle = "#D4A853"; ctx.fillRect(0, 0, W, 3);

  T(ctx, "每日量化选股", P, 36, { s: 42, b: true, c: "#fff" });
  T(ctx, "收盘后推送 · 图片 + 文字", P, 86, { s: 18, c: "rgba(255,255,255,0.4)" });

  // 卖点
  [
    "多因子量化模型 · 实时扫描全市场",
    "3~6 只强势标的 · 附评分与触发信号",
    "每天省下 1 小时复盘时间",
  ].forEach((line, i) => T(ctx, "▸ " + line, P, 130 + i * 26, { s: 14, c: "rgba(255,255,255,0.55)" }));

  // 价格
  R(ctx, P, 230, 200, 66, 10, "rgba(212,168,83,0.12)");
  T(ctx, "¥9.9", P + 22, 240, { s: 44, b: true, c: "#D4A853" });
  T(ctx, "/ 月", P + 22 + TW(ctx, "¥9.9", { s: 44, b: true }) + 4, 258, { s: 16, c: "rgba(255,255,255,0.3)" });
  T(ctx, "新上架优惠 · 后期涨价老订户不涨", P + 220, 255, { s: 13, c: "rgba(255,255,255,0.25)" });

  // 卡片预览
  const CX = P, CY = 330, CW = W - P * 2, CH = 300;
  R(ctx, CX, CY, CW, CH, 10, "rgba(255,255,255,0.02)");

  T(ctx, "今日精选  ·  2026.05.24  周日", CX + 24, CY + 16, { s: 17, b: true, c: "#fff" });
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(CX + 24, CY + 40, CW - 48, 1);

  [
    { r: "#1", n: "京东方A", c: "000725", s: 72, chg: "+24.6%", gc: "#4A90D9" },
    { r: "#2", n: "深南电路", c: "002916", s: 71, chg: "+17.0%", gc: "#4A90D9" },
    { r: "#3", n: "兆易创新", c: "603986", s: 67, chg: "+24.9%", gc: "#4A90D9" },
  ].forEach((st, i) => {
    const sy = CY + 54 + i * 78;

    R(ctx, CX + 24, sy, 3, 44, 2, st.gc);

    T(ctx, st.r, CX + 38, sy + 2, { s: 18, b: true, c: "#fff" });
    T(ctx, st.n, CX + 70, sy + 2, { s: 18, b: true, c: "#fff" });
    T(ctx, st.c, CX + 70 + TW(ctx, st.n, { s: 18, b: true }) + 8, sy + 5, { s: 12, c: "rgba(255,255,255,0.28)" });

    T(ctx, "评分", CX + 410, sy + 2, { s: 12, c: "rgba(255,255,255,0.3)" });
    T(ctx, st.s + "分", CX + 445, sy, { s: 24, b: true, c: st.gc });
    T(ctx, st.chg, CX + 530, sy + 2, { s: 18, b: true, c: "#FF4D4F" });
    T(ctx, "5日", CX + 530, sy + 26, { s: 11, c: "rgba(255,255,255,0.18)" });

    // 信号标签
    ["突破高点", "放量确认", "动量强势"].forEach((tag, ti) => {
      R(ctx, CX + 38 + ti * 104, sy + 30, 96, 20, 4, "rgba(255,255,255,0.04)");
      T(ctx, tag, CX + 45 + ti * 104, sy + 33, { s: 11, c: "rgba(255,255,255,0.35)" });
    });
  });

  T(ctx, "···", CX + CW / 2 - 10, CY + 278, { s: 14, c: "rgba(255,255,255,0.12)" });

  // 收到内容
  const FY = 660;
  T(ctx, "订阅后每天收到", P, FY, { s: 20, b: true, c: "#fff" });
  [
    { ico: "🖼️", t: "图片卡片", d: "深色主题排版" },
    { ico: "📝", t: "文字摘要", d: "方便复制查看" },
    { ico: "🔍", t: "信号拆解", d: "触发逻辑透明" },
    { ico: "💬", t: "随时追问", d: "评分有疑问问" },
  ].forEach((f, i) => {
    const fx = P + i * 168;
    R(ctx, fx, FY + 36, 152, 76, 8, "rgba(255,255,255,0.025)");
    T(ctx, f.ico, fx + 14, FY + 48, { s: 20 });
    T(ctx, f.t, fx + 42, FY + 48, { s: 14, b: true, c: "#ddd" });
    T(ctx, f.d, fx + 14, FY + 70, { s: 11, c: "rgba(255,255,255,0.28)" });
  });

  // 底部
  R(ctx, P, 920, W - P * 2, 56, 10, "rgba(212,168,83,0.08)");
  T(ctx, "¥9.9 / 月", P + 20, 938, { s: 28, b: true, c: "#D4A853" });
  T(ctx, "一杯奶茶钱 · 省下每天一小时复盘", P + 180, 942, { s: 14, c: "rgba(255,255,255,0.35)" });

  return c;
}

// ============ 图6：通达信公式 ============
function makeTDX() {
  const c = createCanvas(W, H); const ctx = c.getContext("2d");
  const P = 40;

  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);

  // 顶部
  ctx.fillStyle = "#14181F"; ctx.fillRect(0, 0, W, 320);

  // K线装饰
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  for (let i = 0; i < 12; i++) {
    const kh = 15 + Math.random() * 35;
    const kx = 410 + i * 24;
    ctx.fillRect(kx, 120 + (50 - kh), 4, kh); // 实体
    ctx.fillRect(kx + 1, 120 + (50 - kh) - 5, 2, 8); // 上影线
    ctx.fillRect(kx + 1, 120 + 50, 2, 6); // 下影线
  }
  // 一根金线
  ctx.fillStyle = "#D4A853";
  ctx.fillRect(400, 175, 320, 1);

  T(ctx, "通达信选股公式", P, 36, { s: 48, b: true, c: "#fff" });
  T(ctx, "5 套量化指标 · 导入直接用", P, 96, { s: 28, b: true, c: "#D4A853" });
  T(ctx, "全市场自动扫描 · 不用一个个翻", P, 144, { s: 16, c: "rgba(255,255,255,0.55)" });

  // 公式列表
  [
    { n: "多因子评分", d: "副图指标 · 13因子综合打分 0-100", bar: "#D4A853" },
    { n: "强势突破", d: "条件选股 · 突破高点 + 放量 + MACD 确认", bar: "#FF6B6B" },
    { n: "放量突破", d: "条件选股 · 量比异动 + 价格启动 + OBV 确认", bar: "#4A90D9" },
    { n: "MACD 金叉", d: "条件选股 · 金叉信号 + RSI 强势 + 放量配合", bar: "#52C41A" },
    { n: "均线多头", d: "条件选股 · 多头排列 + 发散加速 + 放量", bar: "#9B59B6" },
  ].forEach((f, i) => {
    const fy = 185 + i * 30;
    R(ctx, P, fy, 4, 20, 2, f.bar);
    T(ctx, f.n, P + 16, fy + 2, { s: 15, b: true, c: "rgba(255,255,255,0.9)" });
    T(ctx, f.d, P + 130, fy + 2, { s: 13, c: "rgba(255,255,255,0.4)" });
  });

  // 卖点
  const VY = 355;
  T(ctx, "为什么好用", P, VY, { s: 22, b: true, c: "#14181F" });
  [
    { h: "13 因子综合打分", b: "不是单一指标，是多维度共振确认，减少假信号" },
    { h: "4 套选股一键扫描", b: "收盘后 30 秒扫完全市场，快速锁定潜力标的" },
    { h: "分级提示，一目了然", b: "60分以上 A 级重点，45-59 B 级观察，30-44 C 级留意" },
    { h: "逻辑透明，不是黑箱", b: "每个信号都标注触发原因，看得懂为什么被选出" },
  ].forEach((p, i) => {
    const iy = VY + 38 + i * 68;
    R(ctx, P, iy, W - P * 2, 58, 8, i % 2 === 0 ? "#FFFBF0" : "#fff");
    T(ctx, p.h, P + 16, iy + 10, { s: 16, b: true, c: "#14181F" });
    T(ctx, p.b, P + 16, iy + 32, { s: 13, c: "#999" });
  });

  // 交付 + 底部
  const DY2 = VY + 38 + 4 * 68 + 20;
  T(ctx, "交付", P, DY2, { s: 22, b: true, c: "#14181F" });
  [
    "5 个 .tni 公式文件（通达信直接导入）",
    "详细安装说明 + 使用建议",
    "一周售后 · 不会装远程帮你",
  ].forEach((s, i) => {
    R(ctx, P, DY2 + 38 + i * 36, W - P * 2, 30, 6, i % 2 === 0 ? "#FAFAFA" : "#fff");
    T(ctx, "✓  " + s, P + 16, DY2 + 46 + i * 36, { s: 14, c: "#555" });
  });

  R(ctx, P, 920, W - P * 2, 56, 10, "#14181F");
  T(ctx, "¥29.9 / 全套", P + 20, 938, { s: 28, b: true, c: "#D4A853" });
  T(ctx, "5 套公式 · 导入即用 · 一次买断", P + 210, 942, { s: 14, c: "rgba(255,255,255,0.5)" });

  return c;
}

// ============ 图7：API 月卡 ============
function makeAPI() {
  const c = createCanvas(W, H); const ctx = c.getContext("2d");
  const P = 40;

  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);

  // 顶部 — 终端风
  ctx.fillStyle = "#0D1117"; ctx.fillRect(0, 0, W, 340);

  // 终端内容
  ctx.fillStyle = "rgba(0,255,100,0.07)";
  ctx.font = "12px monospace";
  [
    "$ curl -H 'x-api-key: sk-xxx' \\",
    "    localhost:3456/api/scan?mode=strong",
    "{",
    '  "results": [',
    '    { "code":"600519","name":"茅台","score":85 },',
    '    { "code":"300750","name":"宁德","score":78 }',
    "  ],",
    '  "updatedAt": "2026-05-24T15:30:00Z"',
    "}",
    "",
    "> 200 OK · 3ms",
  ].forEach((line, i) => ctx.fillText(line, 370, 48 + i * 18));

  T(ctx, "量化数据 API", P, 36, { s: 46, b: true, c: "#fff" });
  T(ctx, "实时行情 · JSON 接口", P, 94, { s: 26, b: true, c: "#00FF64" });
  T(ctx, "Python / Node.js 直接调用", P, 138, { s: 15, c: "rgba(255,255,255,0.5)" });

  // 接口列表
  [
    { m: "GET", p: "/api/scan", d: "选股扫描 + 多因子评分" },
    { m: "GET", p: "/api/quote", d: "实时行情数据" },
    { m: "GET", p: "/api/kline", d: "K 线历史 OHLCV" },
    { m: "GET", p: "/api/fundflow", d: "主力资金流向" },
    { m: "GET", p: "/api/pool", d: "股票池 + 评分排序" },
  ].forEach((ep, i) => {
    const ey = 185 + i * 32;
    R(ctx, P, ey + 2, 38, 20, 4, "#00FF64");
    T(ctx, ep.m, P + 5, ey + 6, { s: 10, b: true, c: "#0D1117", a: "center" });
    T(ctx, ep.p, P + 52, ey + 4, { s: 14, b: true, c: "rgba(255,255,255,0.8)", f: "monospace" });
    T(ctx, ep.d, P + 260, ey + 4, { s: 13, c: "rgba(255,255,255,0.35)" });
  });

  // 对比
  const CY2 = 375;
  T(ctx, "对比免费数据源", P, CY2, { s: 22, b: true, c: "#0D1117" });

  const comp = [
    { a: "免费数据", b: "我的 API" },
    { a: "经常挂，不稳定", b: "多源融合，稳" },
    { a: "格式不统一，要清洗", b: "JSON 直接 parse" },
    { a: "只有原始数据", b: "算好评分 + 信号" },
    { a: "没人维护", b: "包更新维护" },
  ];
  comp.forEach((row, ri) => {
    const iy = CY2 + 40 + ri * 40;
    const hdr = ri === 0;
    R(ctx, P, iy, 310, 34, hdr ? 6 : 0, hdr ? "#0D1117" : ri % 2 === 0 ? "#F8F9FA" : "#fff");
    R(ctx, P + 330, iy, W - P * 2 - 330, 34, hdr ? 6 : 0, hdr ? "#0D1117" : ri % 2 === 0 ? "#F8F9FA" : "#fff");
    T(ctx, row.a, P + (hdr ? 120 : 16), iy + 8, { s: hdr ? 15 : 13, b: hdr, c: hdr ? "#fff" : "#999", a: hdr ? "center" : "left" });
    T(ctx, row.b, P + 330 + (hdr ? 140 : 16), iy + 8, { s: hdr ? 15 : 13, b: hdr, c: hdr ? "#00FF64" : "#333", a: hdr ? "center" : "left" });
  });

  // 流程
  const FY2 = CY2 + 40 + 5 * 40 + 30;
  T(ctx, "怎么开始", P, FY2, { s: 22, b: true, c: "#0D1117" });
  [
    "① 拍下 → 发你 API Key + 接入文档",
    "② 本地启动服务（帮你配好）",
    "③ 代码加一行 fetch / curl 就能调",
  ].forEach((s, i) => T(ctx, s, P, FY2 + 36 + i * 32, { s: 15, c: "#555" }));

  R(ctx, P, 920, W - P * 2, 56, 10, "#0D1117");
  T(ctx, "¥19.9 / 月", P + 20, 938, { s: 28, b: true, c: "#00FF64" });
  T(ctx, "本地运行 · 数据不出电脑 · 30天有效 · 500次/天", P + 170, 942, { s: 14, c: "rgba(255,255,255,0.5)" });

  return c;
}

// ============ 图8：知识星球 ============
function makePlanet() {
  const c = createCanvas(W, H); const ctx = c.getContext("2d");
  const P = 40;

  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);

  // 顶部
  ctx.fillStyle = "#1A0040"; ctx.fillRect(0, 0, W, 290);

  // 星球装饰
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  ctx.beginPath(); ctx.arc(580, 130, 110, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(610, 70, 50, 0, Math.PI * 2); ctx.fill();

  T(ctx, "量化交易星球", P, 36, { s: 46, b: true, c: "#fff" });
  T(ctx, "每天一份选股 + 行情分析", P, 94, { s: 26, b: true, c: "#C9B8FF" });
  T(ctx, "帮你复盘 · 帮你省时间 · 帮你建立交易体系", P, 138, { s: 15, c: "rgba(255,255,255,0.55)" });

  // 每日内容
  ["📊 量化选股", "📈 行情复盘", "📉 风险提示", "🔬 策略解析"].forEach((s, i) => {
    R(ctx, P + i * 152, 185, 138, 30, 6, "rgba(255,255,255,0.08)");
    T(ctx, s, P + i * 152 + 16, 193, { s: 14, c: "rgba(255,255,255,0.85)" });
  });
  T(ctx, "非交易日也有内容 · 交易心得 · 策略拆解笔记", P, 235, { s: 13, c: "rgba(255,255,255,0.35)" });

  // 内容板块
  const PY3 = 325;
  T(ctx, "星球内容", P, PY3, { s: 22, b: true, c: "#1A0040" });

  const cards = [
    { ico: "📊", t: "每日选股", d: "量化模型筛选 3-6 只 + 评分及信号" },
    { ico: "📈", t: "行情复盘", d: "大盘情绪 · 板块轮动 · 资金流向" },
    { ico: "📉", t: "风控提醒", d: "持仓风险 · 止损位 · 仓位建议" },
    { ico: "📝", t: "交易笔记", d: "实盘操作复盘 · 失误分析 · 教训" },
    { ico: "💬", t: "问答互动", d: "有问题随时问 · 看到就回" },
    { ico: "🔬", t: "策略拆解", d: "选股逻辑透明 · 看懂为什么选" },
  ];
  cards.forEach((item, i) => {
    const ix = P + (i % 3) * 218;
    const iy = PY3 + 38 + Math.floor(i / 3) * 86;
    R(ctx, ix, iy, 200, 72, 8, "#FAFAFE");
    T(ctx, item.ico, ix + 14, iy + 10, { s: 20 });
    T(ctx, item.t, ix + 46, iy + 10, { s: 15, b: true, c: "#1A0040" });
    T(ctx, item.d, ix + 14, iy + 40, { s: 12, c: "#999" });
  });

  // 价格卡
  const PRY = PY3 + 38 + 2 * 86 + 30;
  T(ctx, "定价", P, PRY, { s: 22, b: true, c: "#1A0040" });

  R(ctx, P, PRY + 40, 300, 100, 10, "rgba(26,0,64,0.04)");
  T(ctx, "¥99", P + 22, PRY + 52, { s: 48, b: true, c: "#E53935" });
  T(ctx, "/ 年", P + 22 + TW(ctx, "¥99", { s: 48, b: true }) + 4, PRY + 70, { s: 18, c: "#999" });
  T(ctx, "前 100 人价格（满了涨到 ¥199）", P + 22, PRY + 100, { s: 13, c: "#E53935" });
  T(ctx, "每天不到 3 毛钱", P + 22 + TW(ctx, "前 100 人价格（满了涨到 ¥199）", { s: 13 }) + 12, PRY + 100, { s: 13, c: "#999" });

  [
    "全年 250+ 交易日更新",
    "加入 3 天内不满意可退",
    "星球内随时提问交流",
  ].forEach((s, i) => T(ctx, "✓  " + s, P + 380, PRY + 52 + i * 30, { s: 15, c: "#555" }));

  R(ctx, P, 920, W - P * 2, 56, 10, "#1A0040");
  T(ctx, "¥99 / 年", P + 20, 938, { s: 28, b: true, c: "#C9B8FF" });
  T(ctx, "前 100 人价 · 每天不到 3 毛 · 省下复盘时间", P + 160, 942, { s: 14, c: "rgba(255,255,255,0.5)" });

  return c;
}

// ============ 输出 ============
function save(img, name) {
  const buf = img.toBuffer("image/png");
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log("OK  " + name + "  (" + (buf.length / 1024).toFixed(0) + " KB)");
}

save(makeReport(), "01-实训报告.png");
save(makeScript(), "02-代写脚本.png");
save(makeExcel(), "03-Excel处理.png");
save(makePublish(), "04-多平台发文.png");
save(makeDailyPicks(), "05-每日选股.png");
save(makeTDX(), "06-通达信公式.png");
save(makeAPI(), "07-API月卡.png");
save(makePlanet(), "08-知识星球.png");
console.log("\n→ " + OUT);

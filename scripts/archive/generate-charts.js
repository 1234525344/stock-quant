// 实训报告图表生成 — 含趋势线和回归方程
const fs = require("fs");
const path = require("path");
const { createCanvas } = require("canvas");

const OUT_DIR = "D:/作业/charts";
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ============ 线性回归 ============
function linReg(x, y) {
  const n = x.length;
  const sx = x.reduce((a, b) => a + b, 0), sy = y.reduce((a, b) => a + b, 0);
  const sxy = x.reduce((a, xi, i) => a + xi * y[i], 0), sxx = x.reduce((a, xi) => a + xi * xi, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const yMean = sy / n;
  const ssTot = y.reduce((a, yi) => a + (yi - yMean) ** 2, 0);
  const ssRes = y.reduce((a, yi, i) => a + (yi - (slope * x[i] + intercept)) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  return { slope, intercept, r: Math.sqrt(Math.max(0, r2)), r2 };
}

// ============ 通用绘图类 ============
class XLChart {
  constructor(title, xlabel, ylabel, W = 860, H = 520) {
    this.W = W; this.H = H;
    this.cv = createCanvas(W, H);
    this.c = this.cv.getContext("2d");
    this.title = title; this.xlabel = xlabel; this.ylabel = ylabel;

    this.m = { t: 44, r: 36, b: 52, l: 76 };
    this.plotW = W - this.m.l - this.m.r;
    this.plotH = H - this.m.t - this.m.b;
    this.plotX = this.m.l;
    this.plotY = this.m.t;
    this.plotR = W - this.m.r;
    this.plotB = this.m.t + this.plotH;

    this.c.fillStyle = "#FFFFFF";
    this.c.fillRect(0, 0, W, H);
  }

  setRange(x0, x1, y0, y1) { this.x0 = x0; this.x1 = x1; this.y0 = y0; this.y1 = y1; }
  tx(v) { return this.plotX + ((v - this.x0) / (this.x1 - this.x0)) * this.plotW; }
  ty(v) { return this.plotB - ((v - this.y0) / (this.y1 - this.y0)) * this.plotH; }

  // 绘制网格和坐标轴
  drawFrame(xTicks, yTicks) {
    const c = this.c;
    // 网格线
    c.strokeStyle = "#E2E6EC";
    c.lineWidth = 0.5;
    yTicks.forEach(v => {
      const y = Math.round(this.ty(v)) + 0.5;
      c.beginPath(); c.moveTo(this.plotX, y); c.lineTo(this.plotR, y); c.stroke();
    });
    xTicks.forEach(v => {
      const x = Math.round(this.tx(v)) + 0.5;
      c.beginPath(); c.moveTo(x, this.plotY); c.lineTo(x, this.plotB); c.stroke();
    });

    // 轴线
    c.strokeStyle = "#A0A8B4";
    c.lineWidth = 1.2;
    c.strokeRect(this.plotX, this.plotY, this.plotW, this.plotH);

    // Y轴刻度
    c.fillStyle = "#333333";
    c.font = "bold 11px \"Microsoft YaHei\", \"SimSun\", sans-serif";
    c.textAlign = "right";
    c.textBaseline = "middle";
    yTicks.forEach(v => {
      const y = this.ty(v);
      const label = Math.abs(v) < 0.001 ? "0" : Number.isInteger(v) ? v.toString() : v.toFixed(Math.abs(v) < 1 ? 4 : 2);
      c.fillText(label, this.plotX - 8, y);
    });

    // X轴刻度
    c.textAlign = "center";
    c.textBaseline = "top";
    xTicks.forEach(v => {
      const x = this.tx(v);
      const dec = Number.isInteger(v) ? 0 : (Math.abs(v) < 0.1 ? 2 : 1);
      c.fillText(v.toFixed(dec), x, this.plotB + 6);
    });
  }

  // 标题
  drawTitle() {
    this.c.fillStyle = "#1A1A1A";
    this.c.font = "bold 14px \"Microsoft YaHei\", \"SimHei\", sans-serif";
    this.c.textAlign = "center";
    this.c.textBaseline = "middle";
    this.c.fillText(this.title, this.W / 2, 20);
  }

  // 轴标题
  drawAxisTitles() {
    const c = this.c;
    c.fillStyle = "#555555";
    c.font = "bold 11px \"Microsoft YaHei\", \"SimSun\", sans-serif";
    c.textAlign = "center";
    c.textBaseline = "bottom";
    c.fillText(this.xlabel, this.plotX + this.plotW / 2, this.H - 10);
    c.save();
    c.translate(16, this.plotY + this.plotH / 2);
    c.rotate(-Math.PI / 2);
    c.textAlign = "center";
    c.fillText(this.ylabel, 0, 0);
    c.restore();
  }

  // 绘制趋势线和方程
  drawTrendline(xData, yData, reg, color = "#EF4444") {
    const c = this.c;
    const x0 = this.x0, x1 = this.x1;
    const y0 = reg.slope * x0 + reg.intercept;
    const y1 = reg.slope * x1 + reg.intercept;

    // 裁剪到绘图区域
    const drawY0 = Math.max(this.y0, Math.min(this.y1, y0));
    const drawY1 = Math.max(this.y0, Math.min(this.y1, y1));
    const drawX0 = y0 < this.y0 ? (this.y0 - reg.intercept) / reg.slope : x0;
    const drawX1 = y1 > this.y1 ? (this.y1 - reg.intercept) / reg.slope : (y1 < this.y0 ? (this.y0 - reg.intercept) / reg.slope : x1);

    c.save();
    // 裁剪
    c.beginPath(); c.rect(this.plotX, this.plotY, this.plotW, this.plotH); c.clip();

    c.strokeStyle = color;
    c.lineWidth = 2.5;
    c.setLineDash([8, 4]);
    c.beginPath();
    c.moveTo(this.tx(drawX0), this.ty(drawY0));
    c.lineTo(this.tx(drawX1), this.ty(drawY1));
    c.stroke();
    c.setLineDash([]);
    c.restore();
  }

  // 在图上标注回归方程
  annotateEquation(reg, xLabel, yLabel) {
    const c = this.c;
    const sign = reg.intercept >= 0 ? "+" : "−";
    const eqText = `y = ${reg.slope.toFixed(4)}x ${sign} ${Math.abs(reg.intercept).toFixed(4)}`;
    const rText = `r = ${reg.r.toFixed(4)}`;

    // 方程框（放在图内左上或右下合适位置）
    const boxW = 310, boxH = 52;
    const boxX = this.plotR - boxW - 12;
    const boxY = this.plotY + 12;

    // 半透明背景
    c.fillStyle = "rgba(255, 255, 255, 0.85)";
    c.strokeStyle = "#CCCCCC";
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(boxX, boxY, boxW, boxH, 6);
    c.fill();
    c.stroke();

    // 方程文字
    c.fillStyle = "#CC0000";
    c.font = "bold 14px \"Microsoft YaHei\", sans-serif";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(eqText, boxX + 14, boxY + 18);

    // 相关系数
    c.fillStyle = "#CC0000";
    c.font = "bold 13px \"Microsoft YaHei\", sans-serif";
    c.fillText(rText, boxX + 14, boxY + 38);
  }

  save(name) {
    const buf = this.cv.toBuffer("image/png");
    fs.writeFileSync(path.join(OUT_DIR, name), buf);
    console.log("  " + name + " (" + (buf.length / 1024).toFixed(1) + "KB)");
  }
}

// ============ 散点 + 趋势线图 ============
function drawScatterWithTrend(title, xlabel, ylabel, xData, yData, reg, xTicks, yTicks, filename, opts = {}) {
  const chart = new XLChart(title, xlabel, ylabel);
  const xMin = opts.xMin !== undefined ? opts.xMin : xTicks[0];
  const xMax = opts.xMax !== undefined ? opts.xMax : xTicks[xTicks.length - 1];
  const yMin = yTicks[0], yMax = yTicks[yTicks.length - 1];
  chart.setRange(xMin, xMax, yMin, yMax);
  chart.drawFrame(xTicks, yTicks);
  chart.drawTitle();
  chart.drawAxisTitles();

  const c = chart.c;
  const pts = xData.map((x, i) => ({ x: chart.tx(x), y: chart.ty(yData[i]) }));

  // 趋势线（先画，在数据点下面）
  if (reg && opts.showTrendline !== false) {
    chart.drawTrendline(xData, yData, reg);
    chart.annotateEquation(reg, xlabel, ylabel);
  }

  // 数据点连线（浅蓝）
  c.strokeStyle = "#93C5FD";
  c.lineWidth = 1.5;
  c.setLineDash([]);
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  c.stroke();

  // 数据点
  pts.forEach((p, i) => {
    // 外发光
    const grad = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 8);
    grad.addColorStop(0, "rgba(37, 99, 235, 0.3)");
    grad.addColorStop(1, "rgba(37, 99, 235, 0)");
    c.fillStyle = grad;
    c.beginPath(); c.arc(p.x, p.y, 8, 0, Math.PI * 2); c.fill();

    // 蓝色实心
    c.fillStyle = "#2563EB";
    c.beginPath(); c.arc(p.x, p.y, 5.5, 0, Math.PI * 2); c.fill();
    // 白边
    c.strokeStyle = "#FFFFFF";
    c.lineWidth = 2;
    c.beginPath(); c.arc(p.x, p.y, 5.5, 0, Math.PI * 2); c.stroke();
  });

  chart.save(filename);
}

// ============ 吸收曲线 ============
function drawAbsorptionCurve(title, xlabel, ylabel, xData, yData, xTicks, yTicks, filename, opts = {}) {
  const chart = new XLChart(title, xlabel, ylabel);
  const xMin = xTicks[0], xMax = xTicks[xTicks.length - 1];
  chart.setRange(xMin, xMax, yTicks[0], yTicks[yTicks.length - 1]);
  chart.drawFrame(xTicks, yTicks);
  chart.drawTitle();
  chart.drawAxisTitles();

  const c = chart.c;
  const pts = xData.map((x, i) => ({ x: chart.tx(x), y: chart.ty(yData[i]), xv: x, yv: yData[i] }));

  // 面积填充
  c.fillStyle = "rgba(37, 99, 235, 0.07)";
  c.beginPath();
  c.moveTo(pts[0].x, chart.plotB);
  for (let i = 0; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  c.lineTo(pts[pts.length - 1].x, chart.plotB);
  c.closePath();
  c.fill();

  // 平滑曲线
  c.strokeStyle = "#2563EB";
  c.lineWidth = 2.8;
  c.lineJoin = "round";
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2;
    c.bezierCurveTo(xc, pts[i].y, xc, pts[i + 1].y, pts[i + 1].x, pts[i + 1].y);
  }
  c.stroke();

  // 数据点（隔点显示）
  pts.forEach((p, i) => {
    if (pts.length > 10 && i % 2 !== 0 && i !== pts.length - 1 && yData[i] !== Math.max(...yData)) return;
    c.fillStyle = "#2563EB";
    c.beginPath(); c.arc(p.x, p.y, 4.5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#FFFFFF";
    c.lineWidth = 1.8;
    c.beginPath(); c.arc(p.x, p.y, 4.5, 0, Math.PI * 2); c.stroke();
  });

  // 标注峰值
  if (opts.markPeak) {
    let mi = 0;
    for (let i = 1; i < yData.length; i++) { if (yData[i] > yData[mi]) mi = i; }
    const px = pts[mi].x, py = pts[mi].y;

    // 垂直虚线
    c.strokeStyle = "#EF4444";
    c.lineWidth = 1.5;
    c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(px, py); c.lineTo(px, chart.plotB); c.stroke();
    c.setLineDash([]);

    // 峰值标注框
    const lx = px + 50, ly = py - 40;
    const bw = 180, bh = 38;

    c.fillStyle = "rgba(255, 255, 255, 0.9)";
    c.strokeStyle = "#EF4444";
    c.lineWidth = 1.2;
    c.beginPath();
    c.roundRect(lx - bw / 2, ly - bh / 2, bw, bh, 5);
    c.fill();
    c.stroke();

    c.fillStyle = "#EF4444";
    c.font = "bold 13px \"Microsoft YaHei\", sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(`λmax = ${xData[mi]} nm  A = ${yData[mi].toFixed(3)}`, lx, ly);
  }

  chart.save(filename);
}

// ============ E-LogC 多系列图 ============
function drawELogCChart(filename) {
  const chart = new XLChart("图4  氟离子选择电极 E - LogC 关系图", "LogC", "E / mV");

  const xTicks = [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15];
  const yTicks = [-120, -115, -110, -105, -100, -95, -90, -85];
  chart.setRange(0.60, 1.15, -120, -84);
  chart.drawFrame(xTicks, yTicks);
  chart.drawTitle();
  chart.drawAxisTitles();

  const c = chart.c;

  const series = [
    {
      xData: [0.8591, 1.1041], yData: [-102, -87.5],
      color: "#2563EB", name: "可溶氟",
      reg: linReg([0.8591, 1.1041], [-102, -87.5]),
    },
    {
      xData: [0.7306, 0.6462], yData: [-110, -115],
      color: "#EF4444", name: "游离氟",
      reg: linReg([0.7306, 0.6462], [-110, -115]),
    },
  ];

  series.forEach((s, si) => {
    const pts = s.xData.map((x, i) => ({
      x: chart.tx(x), y: chart.ty(s.yData[i]),
      xv: x, yv: s.yData[i]
    }));

    // 趋势线
    c.save();
    c.beginPath(); c.rect(chart.plotX, chart.plotY, chart.plotW, chart.plotH); c.clip();
    c.strokeStyle = s.color;
    c.lineWidth = 2.2;
    c.setLineDash([6, 4]);
    const tx0 = chart.tx(0.60), ty0 = chart.ty(s.reg.slope * 0.60 + s.reg.intercept);
    const tx1 = chart.tx(1.15), ty1 = chart.ty(s.reg.slope * 1.15 + s.reg.intercept);
    c.beginPath(); c.moveTo(tx0, ty0); c.lineTo(tx1, ty1); c.stroke();
    c.setLineDash([]);
    c.restore();

    // 连线
    c.strokeStyle = s.color;
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    c.stroke();

    // 数据点
    pts.forEach((p, i) => {
      c.fillStyle = s.color;
      c.beginPath(); c.arc(p.x, p.y, 7, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#FFFFFF";
      c.lineWidth = 2.5;
      c.beginPath(); c.arc(p.x, p.y, 7, 0, Math.PI * 2); c.stroke();
    });

    // 回归方程标注
    const sign = s.reg.intercept >= 0 ? "+" : "−";
    const eqText = `${s.name}: E = ${s.reg.slope.toFixed(1)} LogC ${sign} ${Math.abs(s.reg.intercept).toFixed(0)}`;
    c.fillStyle = s.color;
    c.font = "bold 12px \"Microsoft YaHei\", sans-serif";
    c.textAlign = "left";
    c.textBaseline = "bottom";
    c.fillText(eqText, chart.plotX + 14, chart.plotY + 22 + si * 24);
  });

  // 图例
  const lx = chart.plotR - 160, ly = chart.plotY + 8;
  series.forEach((s, i) => {
    const y = ly + i * 24;
    c.fillStyle = s.color;
    c.beginPath(); c.arc(lx + 8, y + 8, 6, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#FFFFFF";
    c.lineWidth = 2;
    c.beginPath(); c.arc(lx + 8, y + 8, 6, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "#333333";
    c.font = "bold 12px \"Microsoft YaHei\", sans-serif";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(s.name, lx + 22, y + 8);
  });

  chart.save(filename);
}

// ==================== 生成全部图表 ====================
console.log("正在生成图表...\n");

// ---- 图1: 镁标准工作曲线 ----
{
  const rho = [0.00, 0.10, 0.20, 0.30, 0.40, 0.50];
  const A = [0.0001, 0.1117, 0.1989, 0.2699, 0.3327, 0.3902];
  const reg = linReg(rho, A);
  drawScatterWithTrend(
    "图1  镁的标准工作曲线",
    "ρ(镁) / (μg/mL)", "吸光度 A",
    rho, A, reg,
    [0.00, 0.10, 0.20, 0.30, 0.40, 0.50],
    [0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40],
    "fig1_mg_calibration.png",
    { xMin: -0.03, xMax: 0.55 }
  );
}

// ---- 图2: 镁标准加入法 试样1 ----
{
  const rho = [0.00, 0.10, 0.20, 0.30, 0.40, 0.50];
  const A = [0.0120, 0.0319, 0.0505, 0.0684, 0.0872, 0.1064];
  const reg = linReg(rho, A);
  const cx = -reg.intercept / reg.slope; // 外推x截距 ≈ -0.067
  const pad = 0.12;
  const xMin = cx - pad; // ≈ -0.19
  drawScatterWithTrend(
    "图2  标准加入法测定试样1中镁",
    "ρ(镁) / (μg/mL)", "吸光度 A",
    rho, A, reg,
    [-0.15, -0.10, -0.05, 0.00, 0.10, 0.20, 0.30, 0.40, 0.50],
    [0.00, 0.02, 0.04, 0.06, 0.08, 0.10, 0.12],
    "fig2_mg_addition1.png",
    { xMin: xMin, xMax: 0.55 }
  );
}

// ---- 图3: 镁标准加入法 试样2 ----
{
  const rho = [0.00, 0.10, 0.20, 0.30, 0.40, 0.50];
  const A = [0.0681, 0.0855, 0.1021, 0.1184, 0.1366, 0.1527];
  const reg = linReg(rho, A);
  const cx = -reg.intercept / reg.slope; // 外推x截距 ≈ -0.403
  const pad = 0.15;
  const xMin = cx - pad; // ≈ -0.55
  drawScatterWithTrend(
    "图3  标准加入法测定试样2中镁",
    "ρ(镁) / (μg/mL)", "吸光度 A",
    rho, A, reg,
    [-0.50, -0.40, -0.30, -0.20, -0.10, 0.00, 0.10, 0.20, 0.30, 0.40, 0.50],
    [0.00, 0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14, 0.16],
    "fig3_mg_addition2.png",
    { xMin: xMin, xMax: 0.55 }
  );
}

// ---- 图4: 铁吸收曲线 ----
{
  const lambda = [440, 450, 460, 470, 480, 490, 500, 505, 510, 515, 520, 530, 540, 550, 560, 570];
  const A = [0.165, 0.177, 0.192, 0.211, 0.220, 0.228, 0.241, 0.244, 0.250, 0.244, 0.233, 0.185, 0.123, 0.071, 0.044, 0.003];
  drawAbsorptionCurve(
    "图5  铁-邻二氮菲配合物吸收曲线",
    "λ / nm", "吸光度 A",
    lambda, A,
    [440, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570],
    [0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30],
    "fig4_fe_absorption.png",
    { markPeak: true }
  );
}

// ---- 图5: 铁标准工作曲线 ----
{
  const rho = [0.00, 0.40, 0.80, 1.20, 1.60, 2.00];
  const A = [-0.0012, 0.071, 0.149, 0.245, 0.319, 0.391];
  const reg = linReg(rho, A);
  drawScatterWithTrend(
    "图6  铁的标准工作曲线",
    "ρ(铁) / (μg/mL)", "吸光度 A",
    rho, A, reg,
    [0.00, 0.20, 0.40, 0.60, 0.80, 1.00, 1.20, 1.40, 1.60, 1.80, 2.00],
    [0.00, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40],
    "fig5_fe_calibration.png",
    { xMin: -0.1, xMax: 2.1 }
  );
}

// ---- 图6: 氟E-LogC ----
drawELogCChart("fig6_fluoride.png");

console.log("\n全部图表已保存到: " + OUT_DIR);

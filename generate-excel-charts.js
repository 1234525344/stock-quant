// 在 Excel 中生成所有实验图表
const ExcelJS = require("exceljs");

const OUT = "D:/作业/实验图表.xlsx";
const workbook = new ExcelJS.Workbook();
workbook.creator = "QuantLab";
workbook.created = new Date();

// ============ 通用样式 ============
const titleFont = { name: "微软雅黑", size: 14, bold: true, color: { argb: "FF1F2937" } };
const headerFont = { name: "宋体", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
const dataFont = { name: "宋体", size: 11 };
const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
const headerBorder = { style: "thin", color: { argb: "FF8DB4E2" } };
const dataBorder = { style: "thin", color: { argb: "FFD9D9D9" } };

function styleHeader(ws, row, cols) {
  for (let c = 1; c <= cols; c++) {
    const cell = ws.getCell(row, c);
    cell.font = headerFont;
    cell.fill = headerFill;
    cell.border = { top: headerBorder, bottom: headerBorder, left: headerBorder, right: headerBorder };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
}

function styleData(ws, startRow, endRow, cols) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = 1; c <= cols; c++) {
      const cell = ws.getCell(r, c);
      cell.font = dataFont;
      cell.border = { top: dataBorder, bottom: dataBorder, left: dataBorder, right: dataBorder };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    }
  }
}

function setTitle(ws, row, col, text, mergeToCol) {
  const cell = ws.getCell(row, col);
  cell.value = text;
  cell.font = titleFont;
  cell.alignment = { horizontal: "center", vertical: "middle" };
  if (mergeToCol > col) ws.mergeCells(row, col, row, mergeToCol);
}

// ============ 创建散点图 + 趋势线 ============
function addScatterChart(ws, title, xTitle, yTitle, dataRange, eqText, opts = {}) {
  // dataRange: { x: {rowStart, rowEnd, col}, y: {rowStart, rowEnd, col} }
  // 将图表放在数据右侧
  const chartCol = (opts.dataCols || 4) + 2;
  const chartRow = opts.chartRow || 1;

  const chart = workbook.addWorksheet(title);
  // 复制数据
  chart.getCell("A1").value = xTitle;
  chart.getCell("B1").value = yTitle;
  chart.getCell("A1").font = { name: "宋体", size: 11, bold: true };
  chart.getCell("B1").font = { name: "宋体", size: 11, bold: true };

  // 从原sheet复制数据
  const xVals = [];
  const yVals = [];
  for (let i = 0; i < opts.xCount; i++) {
    const xv = ws.getCell(opts.xStartRow + i, 1).value;
    const yv = ws.getCell(opts.yStartRow + i, 1 + (opts.yColOffset || 0)).value;
    chart.getCell("A" + (i + 2)).value = xv;
    chart.getCell("B" + (i + 2)).value = yv;
    chart.getCell("A" + (i + 2)).font = dataFont;
    chart.getCell("B" + (i + 2)).font = dataFont;
    if (xv !== null && xv !== undefined) xVals.push(Number(xv));
    if (yv !== null && yv !== undefined) yVals.push(Number(yv));
  }
  chart.getColumn(1).width = 16;
  chart.getColumn(2).width = 16;

  // 方程文本
  chart.getCell("D2").value = eqText;
  chart.getCell("D2").font = { name: "宋体", size: 11, color: { argb: "FFEF4444" } };
  chart.getColumn(4).width = 50;

  // 创建散点图
  chart.addChart({
    name: title,
    title: { name: title, nameFont: { name: "微软雅黑", size: 12 } },
    xAxes: [{
      title: { name: xTitle, nameFont: { name: "宋体", size: 10 } },
      min: opts.xMin,
      max: opts.xMax,
      majorGridLines: { color: { argb: "FFE5E5E5" } },
    }],
    yAxes: [{
      title: { name: yTitle, nameFont: { name: "宋体", size: 10 } },
      min: opts.yMin,
      max: opts.yMax,
      majorGridLines: { color: { argb: "FFE5E5E5" } },
    }],
    plot: {
      x: 0, y: 0, cx: 620, cy: 420,
    },
    anchor: { from: { col: 0.5, row: xVals.length + 3 }, to: { col: 10.5, row: xVals.length + 28 } },
    series: [{
      name: yTitle,
      reference: { cat: { f: `='${title}'!$A$2:$A$${xVals.length + 1}`, }, val: { f: `='${title}'!$B$2:$B$${xVals.length + 1}`, } },
      smooth: false,
      marker: { symbol: "circle", size: 7, fill: { color: "2563EB" }, stroke: { color: "FFFFFF", width: 1.5 } },
      line: { color: "2563EB", width: 1.5 },
      trendlines: [{
        type: "linear",
        displayEquation: true,
        displayRSquared: true,
        line: { color: "EF4444", width: 1.5, dashType: "solid" },
      }],
    }],
  });

  return chart;
}

// ============ Sheet 1: 镁标准工作曲线 ============
{
  const ws = workbook.addWorksheet("镁标准曲线");
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 14;
  ws.getColumn(5).width = 50;

  setTitle(ws, 1, 1, "镁标准工作曲线数据", 2);
  ws.getCell(2, 1).value = "编号"; ws.getCell(2, 2).value = "ρ(镁) μg/mL"; ws.getCell(2, 3).value = "吸光度 A";
  styleHeader(ws, 2, 3);

  const data = [
    ["0", 0.00, 0.0001],
    ["1", 0.10, 0.1117],
    ["2", 0.20, 0.1989],
    ["3", 0.30, 0.2699],
    ["4", 0.40, 0.3327],
    ["5", 0.50, 0.3902],
  ];
  data.forEach((r, i) => { ws.getCell(3 + i, 1).value = r[0]; ws.getCell(3 + i, 2).value = r[1]; ws.getCell(3 + i, 3).value = r[2]; });
  styleData(ws, 3, 8, 3);

  // 图表
  const chart = workbook.addWorksheet("图1-镁标准曲线");
  data.forEach((r, i) => { chart.getCell(2 + i, 1).value = r[1]; chart.getCell(2 + i, 2).value = r[2]; });
  chart.getCell(1, 1).value = "ρ(镁) μg/mL"; chart.getCell(1, 2).value = "吸光度 A";
  chart.getCell(1, 1).font = headerFont; chart.getCell(1, 2).font = headerFont;
  chart.getColumn(1).width = 16; chart.getColumn(2).width = 16;

  chart.addChart({
    name: "图1",
    title: { name: "图1  镁的标准工作曲线", nameFont: { name: "微软雅黑", size: 13, bold: true } },
    xAxes: [{ title: { name: "ρ(镁) / (μg/mL)", nameFont: { name: "宋体", size: 10 } }, min: -0.02, max: 0.55, majorGridLines: { color: { argb: "FFE8E8E8" } }, minorGridLines: { color: { argb: "FFF5F5F5" } } }],
    yAxes: [{ title: { name: "吸光度 A", nameFont: { name: "宋体", size: 10 } }, min: -0.02, max: 0.44, majorGridLines: { color: { argb: "FFE8E8E8" } } }],
    plot: { x: 0, y: 0, cx: 620, cy: 420 },
    anchor: { from: { col: 0.5, row: 9 }, to: { col: 10.5, row: 35 } },
    series: [{
      name: "镁标准系列",
      reference: { cat: { f: "='图1-镁标准曲线'!$A$2:$A$7" }, val: { f: "='图1-镁标准曲线'!$B$2:$B$7" } },
      smooth: false,
      marker: { symbol: "circle", size: 7, fill: { color: "2563EB" }, stroke: { color: "FFFFFF", width: 1.5 } },
      line: { color: "2563EB", width: 1.5 },
      trendlines: [{
        type: "linear", displayEquation: true, displayRSquared: true,
        line: { color: "EF4444", width: 1.5, dashType: "solid" },
      }],
    }],
  });
}

// ============ Sheet 2: 镁标准加入法1 ============
{
  const ws = workbook.addWorksheet("镁标准加入法1");
  ws.getColumn(1).width = 10; ws.getColumn(2).width = 18; ws.getColumn(3).width = 15;
  setTitle(ws, 1, 1, "标准加入法测定试样1中镁", 3);
  ws.getCell(2, 1).value = "编号"; ws.getCell(2, 2).value = "ρ(镁) μg/mL"; ws.getCell(2, 3).value = "吸光度 A";
  styleHeader(ws, 2, 3);
  const data = [[0, 0.00, 0.0120], [1, 0.10, 0.0319], [2, 0.20, 0.0505], [3, 0.30, 0.0684], [4, 0.40, 0.0872], [5, 0.50, 0.1064]];
  data.forEach((r, i) => { ws.getCell(3 + i, 1).value = r[0]; ws.getCell(3 + i, 2).value = r[1]; ws.getCell(3 + i, 3).value = r[2]; });
  styleData(ws, 3, 8, 3);

  const chart = workbook.addWorksheet("图2-镁加入法1");
  data.forEach((r, i) => { chart.getCell(2 + i, 1).value = r[1]; chart.getCell(2 + i, 2).value = r[2]; });
  chart.getCell(1, 1).value = "ρ(镁) μg/mL"; chart.getCell(1, 2).value = "吸光度 A";
  chart.getCell(1, 1).font = headerFont; chart.getCell(1, 2).font = headerFont;
  chart.getColumn(1).width = 16; chart.getColumn(2).width = 16;

  chart.addChart({
    name: "图2",
    title: { name: "图2  标准加入法测定试样1中镁", nameFont: { name: "微软雅黑", size: 13, bold: true } },
    xAxes: [{
      title: { name: "ρ(镁) / (μg/mL)", nameFont: { name: "宋体", size: 10 } },
      min: -0.45, max: 0.55,
      crosses: "min", // 让y轴在x=0处
      majorGridLines: { color: { argb: "FFE8E8E8" } },
    }],
    yAxes: [{
      title: { name: "吸光度 A", nameFont: { name: "宋体", size: 10 } },
      min: -0.01, max: 0.12,
      crosses: "min",
      majorGridLines: { color: { argb: "FFE8E8E8" } },
    }],
    plot: { x: 0, y: 0, cx: 620, cy: 420 },
    anchor: { from: { col: 0.5, row: 9 }, to: { col: 10.5, row: 35 } },
    series: [{
      name: "试样1标准加入",
      reference: { cat: { f: "='图2-镁加入法1'!$A$2:$A$7" }, val: { f: "='图2-镁加入法1'!$B$2:$B$7" } },
      smooth: false,
      marker: { symbol: "circle", size: 7, fill: { color: "2563EB" }, stroke: { color: "FFFFFF", width: 1.5 } },
      line: { color: "2563EB", width: 1.5 },
      trendlines: [{ type: "linear", displayEquation: true, displayRSquared: true, line: { color: "EF4444", width: 1.5 } }],
    }],
  });
}

// ============ Sheet 3: 镁标准加入法2 ============
{
  const ws = workbook.addWorksheet("镁标准加入法2");
  ws.getColumn(1).width = 10; ws.getColumn(2).width = 18; ws.getColumn(3).width = 15;
  setTitle(ws, 1, 1, "标准加入法测定试样2中镁", 3);
  ws.getCell(2, 1).value = "编号"; ws.getCell(2, 2).value = "ρ(镁) μg/mL"; ws.getCell(2, 3).value = "吸光度 A";
  styleHeader(ws, 2, 3);
  const data = [[0, 0.00, 0.0681], [1, 0.10, 0.0855], [2, 0.20, 0.1021], [3, 0.30, 0.1184], [4, 0.40, 0.1366], [5, 0.50, 0.1527]];
  data.forEach((r, i) => { ws.getCell(3 + i, 1).value = r[0]; ws.getCell(3 + i, 2).value = r[1]; ws.getCell(3 + i, 3).value = r[2]; });
  styleData(ws, 3, 8, 3);

  const chart = workbook.addWorksheet("图3-镁加入法2");
  data.forEach((r, i) => { chart.getCell(2 + i, 1).value = r[1]; chart.getCell(2 + i, 2).value = r[2]; });
  chart.getCell(1, 1).value = "ρ(镁) μg/mL"; chart.getCell(1, 2).value = "吸光度 A";
  chart.getCell(1, 1).font = headerFont; chart.getCell(1, 2).font = headerFont;
  chart.getColumn(1).width = 16; chart.getColumn(2).width = 16;

  chart.addChart({
    name: "图3",
    title: { name: "图3  标准加入法测定试样2中镁", nameFont: { name: "微软雅黑", size: 13, bold: true } },
    xAxes: [{
      title: { name: "ρ(镁) / (μg/mL)", nameFont: { name: "宋体", size: 10 } },
      min: -2.5, max: 0.55,
      majorGridLines: { color: { argb: "FFE8E8E8" } },
    }],
    yAxes: [{
      title: { name: "吸光度 A", nameFont: { name: "宋体", size: 10 } },
      min: -0.01, max: 0.17,
      crosses: "min",
      majorGridLines: { color: { argb: "FFE8E8E8" } },
    }],
    plot: { x: 0, y: 0, cx: 620, cy: 420 },
    anchor: { from: { col: 0.5, row: 9 }, to: { col: 10.5, row: 35 } },
    series: [{
      name: "试样2标准加入",
      reference: { cat: { f: "='图3-镁加入法2'!$A$2:$A$7" }, val: { f: "='图3-镁加入法2'!$B$2:$B$7" } },
      smooth: false,
      marker: { symbol: "circle", size: 7, fill: { color: "2563EB" }, stroke: { color: "FFFFFF", width: 1.5 } },
      line: { color: "2563EB", width: 1.5 },
      trendlines: [{ type: "linear", displayEquation: true, displayRSquared: true, line: { color: "EF4444", width: 1.5 } }],
    }],
  });
}

// ============ Sheet 4: 铁吸收曲线 ============
{
  const ws = workbook.addWorksheet("铁吸收曲线");
  ws.getColumn(1).width = 10; ws.getColumn(2).width = 14;
  setTitle(ws, 1, 1, "铁-邻二氮菲配合物吸收曲线", 2);
  ws.getCell(2, 1).value = "λ / nm"; ws.getCell(2, 2).value = "吸光度 A";
  styleHeader(ws, 2, 2);

  const lambda = [440, 450, 460, 470, 480, 490, 500, 505, 510, 515, 520, 530, 540, 550, 560, 570];
  const A = [0.165, 0.177, 0.192, 0.211, 0.220, 0.228, 0.241, 0.244, 0.250, 0.244, 0.233, 0.185, 0.123, 0.071, 0.044, 0.003];
  lambda.forEach((l, i) => { ws.getCell(3 + i, 1).value = l; ws.getCell(3 + i, 2).value = A[i]; });
  styleData(ws, 3, 18, 2);

  const chart = workbook.addWorksheet("图4-铁吸收曲线");
  lambda.forEach((l, i) => { chart.getCell(2 + i, 1).value = l; chart.getCell(2 + i, 2).value = A[i]; });
  chart.getCell(1, 1).value = "λ / nm"; chart.getCell(1, 2).value = "吸光度 A";
  chart.getCell(1, 1).font = headerFont; chart.getCell(1, 2).font = headerFont;
  chart.getColumn(1).width = 12; chart.getColumn(2).width = 14;

  chart.addChart({
    name: "图4",
    title: { name: "图4  铁-邻二氮菲配合物吸收曲线", nameFont: { name: "微软雅黑", size: 13, bold: true } },
    xAxes: [{ title: { name: "λ / nm", nameFont: { name: "宋体", size: 10 } }, min: 435, max: 575, majorGridLines: { color: { argb: "FFE8E8E8" } } }],
    yAxes: [{ title: { name: "吸光度 A", nameFont: { name: "宋体", size: 10 } }, min: 0, max: 0.30, majorGridLines: { color: { argb: "FFE8E8E8" } } }],
    plot: { x: 0, y: 0, cx: 620, cy: 420 },
    anchor: { from: { col: 0.5, row: 19 }, to: { col: 10.5, row: 45 } },
    series: [{
      name: "吸收曲线",
      reference: { cat: { f: "='图4-铁吸收曲线'!$A$2:$A$17" }, val: { f: "='图4-铁吸收曲线'!$B$2:$B$17" } },
      smooth: true,
      marker: { symbol: "circle", size: 6, fill: { color: "2563EB" } },
      line: { color: "2563EB", width: 2 },
    }],
  });
}

// ============ Sheet 5: 铁标准工作曲线 ============
{
  const ws = workbook.addWorksheet("铁标准曲线");
  ws.getColumn(1).width = 10; ws.getColumn(2).width = 18; ws.getColumn(3).width = 15;
  setTitle(ws, 1, 1, "铁标准工作曲线数据", 3);
  ws.getCell(2, 1).value = "编号"; ws.getCell(2, 2).value = "ρ(铁) μg/mL"; ws.getCell(2, 3).value = "吸光度 A";
  styleHeader(ws, 2, 3);
  const data = [[0, 0.00, -0.0012], [1, 0.40, 0.071], [2, 0.80, 0.149], [3, 1.20, 0.245], [4, 1.60, 0.319], [5, 2.00, 0.391]];
  data.forEach((r, i) => { ws.getCell(3 + i, 1).value = r[0]; ws.getCell(3 + i, 2).value = r[1]; ws.getCell(3 + i, 3).value = r[2]; });
  styleData(ws, 3, 8, 3);

  const chart = workbook.addWorksheet("图5-铁标准曲线");
  data.forEach((r, i) => { chart.getCell(2 + i, 1).value = r[1]; chart.getCell(2 + i, 2).value = r[2]; });
  chart.getCell(1, 1).value = "ρ(铁) μg/mL"; chart.getCell(1, 2).value = "吸光度 A";
  chart.getCell(1, 1).font = headerFont; chart.getCell(1, 2).font = headerFont;
  chart.getColumn(1).width = 16; chart.getColumn(2).width = 16;

  chart.addChart({
    name: "图5",
    title: { name: "图5  铁的标准工作曲线", nameFont: { name: "微软雅黑", size: 13, bold: true } },
    xAxes: [{ title: { name: "ρ(铁) / (μg/mL)", nameFont: { name: "宋体", size: 10 } }, min: -0.1, max: 2.2, majorGridLines: { color: { argb: "FFE8E8E8" } } }],
    yAxes: [{ title: { name: "吸光度 A", nameFont: { name: "宋体", size: 10 } }, min: -0.05, max: 0.45, majorGridLines: { color: { argb: "FFE8E8E8" } } }],
    plot: { x: 0, y: 0, cx: 620, cy: 420 },
    anchor: { from: { col: 0.5, row: 9 }, to: { col: 10.5, row: 35 } },
    series: [{
      name: "铁标准系列",
      reference: { cat: { f: "='图5-铁标准曲线'!$A$2:$A$7" }, val: { f: "='图5-铁标准曲线'!$B$2:$B$7" } },
      smooth: false,
      marker: { symbol: "circle", size: 7, fill: { color: "2563EB" }, stroke: { color: "FFFFFF", width: 1.5 } },
      line: { color: "2563EB", width: 1.5 },
      trendlines: [{ type: "linear", displayEquation: true, displayRSquared: true, line: { color: "EF4444", width: 1.5 } }],
    }],
  });
}

// ============ Sheet 6: 氟离子 E-LogC ============
{
  const ws = workbook.addWorksheet("氟E-LogC");
  ws.getColumn(1).width = 10; ws.getColumn(2).width = 12; ws.getColumn(3).width = 12; ws.getColumn(4).width = 12; ws.getColumn(5).width = 12;
  setTitle(ws, 1, 1, "氟离子选择电极 E-LogC 数据", 5);
  ws.getCell(2, 1).value = "类型"; ws.getCell(2, 2).value = "LogC1"; ws.getCell(2, 3).value = "E1/mV"; ws.getCell(2, 4).value = "LogC2"; ws.getCell(2, 5).value = "E2/mV";
  styleHeader(ws, 2, 5);
  ws.getCell(3, 1).value = "可溶氟"; ws.getCell(3, 2).value = 0.8591; ws.getCell(3, 3).value = -102; ws.getCell(3, 4).value = 1.1041; ws.getCell(3, 5).value = -87.5;
  ws.getCell(4, 1).value = "游离氟"; ws.getCell(4, 2).value = 0.7306; ws.getCell(4, 3).value = -110; ws.getCell(4, 4).value = 0.6462; ws.getCell(4, 5).value = -115;
  styleData(ws, 3, 4, 5);

  const chart = workbook.addWorksheet("图6-氟E-LogC");
  chart.getColumn(1).width = 12; chart.getColumn(2).width = 12; chart.getColumn(3).width = 12; chart.getColumn(4).width = 12;
  chart.getCell(1, 1).value = "LogC(可溶)"; chart.getCell(1, 2).value = "E(可溶)/mV"; chart.getCell(1, 3).value = "LogC(游离)"; chart.getCell(1, 4).value = "E(游离)/mV";
  chart.getCell(1, 1).font = headerFont; chart.getCell(1, 2).font = headerFont; chart.getCell(1, 3).font = headerFont; chart.getCell(1, 4).font = headerFont;
  chart.getCell(2, 1).value = 0.8591; chart.getCell(2, 2).value = -102; chart.getCell(2, 3).value = 0.7306; chart.getCell(2, 4).value = -110;
  chart.getCell(3, 1).value = 1.1041; chart.getCell(3, 2).value = -87.5; chart.getCell(3, 3).value = 0.6462; chart.getCell(3, 4).value = -115;

  chart.addChart({
    name: "图6",
    title: { name: "图6  氟离子选择电极 E - LogC 关系图", nameFont: { name: "微软雅黑", size: 13, bold: true } },
    xAxes: [{
      title: { name: "LogC", nameFont: { name: "宋体", size: 10 } },
      min: 0.60, max: 1.15,
      majorGridLines: { color: { argb: "FFE8E8E8" } },
    }],
    yAxes: [{
      title: { name: "E / mV", nameFont: { name: "宋体", size: 10 } },
      min: -120, max: -82,
      majorGridLines: { color: { argb: "FFE8E8E8" } },
    }],
    plot: { x: 0, y: 0, cx: 620, cy: 420 },
    anchor: { from: { col: 0.5, row: 5 }, to: { col: 10.5, row: 31 } },
    series: [
      {
        name: "可溶氟",
        reference: { cat: { f: "='图6-氟E-LogC'!$A$2:$A$3" }, val: { f: "='图6-氟E-LogC'!$B$2:$B$3" } },
        smooth: false,
        marker: { symbol: "circle", size: 8, fill: { color: "2563EB" }, stroke: { color: "FFFFFF", width: 1.5 } },
        line: { color: "2563EB", width: 2 },
      },
      {
        name: "游离氟",
        reference: { cat: { f: "='图6-氟E-LogC'!$C$2:$C$3" }, val: { f: "='图6-氟E-LogC'!$D$2:$D$3" } },
        smooth: false,
        marker: { symbol: "diamond", size: 8, fill: { color: "EF4444" }, stroke: { color: "FFFFFF", width: 1.5 } },
        line: { color: "EF4444", width: 2 },
      },
    ],
  });
}

// ============ 保存 ============
workbook.xlsx.writeFile(OUT).then(() => {
  console.log("Excel 图表文件已生成: " + OUT);
  console.log("共 6 张图表: 镁标准曲线×3, 铁吸收曲线×1, 铁标准曲线×1, 氟E-LogC×1");
}).catch(err => {
  console.error("生成失败:", err);
  process.exit(1);
});

// 实训报告通用引擎 — 可复用的格式工具集
// 适用于化学/生物/材料等理工科实训报告自动生成
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle,
  ImageRun, Footer, PageNumber, PageBreak, GridSpan
} = require("docx");

// ============ 格式常量 ============
const FONT = "宋体";
const FONT_HEI = "黑体";
const SIZE_2 = 44;    // 二号 22pt（主标题）
const SIZE_3 = 32;    // 三号 16pt（副标题）
const SIZE_4 = 24;    // 小四 12pt（正文/目录编号）
const SIZE_5 = 21;    // 五号 10.5pt (21半磅)

const LINE_32PT = 32 * 20;       // 固定32磅（主标题）
const LINE_24PT = 24 * 20;       // 固定24磅（副标题）
const LINE_15 = Math.round(1.5 * 240);  // 1.5倍行距（正文）

// 页面边距 (twips): 上2.5cm, 下左右2cm, 装订线1cm
const MARGIN_TOP = Math.round(2.5 * 567);
const MARGIN_BOTTOM = Math.round(2.0 * 567);
const MARGIN_LEFT = Math.round(2.0 * 567);
const MARGIN_RIGHT = Math.round(2.0 * 567);
const GUTTER = Math.round(1.0 * 567);

const TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
  insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
};

// ============ 段落工具 ============
function makeParagraph(runs, opts = {}) {
  return new Paragraph({
    children: runs,
    alignment: opts.alignment || AlignmentType.LEFT,
    spacing: {
      line: opts.lineSpacing || LINE_15,
      before: opts.before || 0,
      after: opts.after || 0,
    },
    indent: opts.indent ? { firstLine: opts.indent } : undefined,
  });
}

function p(text, opts = {}) {
  return makeParagraph([
    new TextRun({
      text,
      font: opts.font || FONT,
      size: opts.size || SIZE_4,
      bold: opts.bold || false,
    })
  ], opts);
}

// 多段文本段落（支持混合格式）
function pr(runs, opts = {}) {
  return makeParagraph(runs.map(r => {
    if (typeof r === "string") {
      return new TextRun({ text: r, font: FONT, size: opts.size || SIZE_4, bold: opts.bold || false });
    }
    return new TextRun({ font: FONT, size: opts.size || SIZE_4, ...r });
  }), opts);
}

// 各级标题：宋体小四加粗，1.5倍行距，段前段后0
function heading1(text) { return p(text, { bold: true, size: SIZE_4, font: FONT }); }
function heading2(text) { return p(text, { bold: true, size: SIZE_4, font: FONT }); }
function heading3(text) { return p(text, { bold: true, size: SIZE_4, font: FONT }); }
function heading4(text) { return p(text, { bold: true, size: SIZE_4, font: FONT }); }

// 正文：宋体小四，1.5倍行距，首行缩进2字符
function bodyText(text) { return p(text, { indent: 480 }); }

// 表格/图表标题
function tableCaption(text) { return p(text, { bold: true, alignment: AlignmentType.CENTER, size: SIZE_4 }); }
function figureCaption(text) { return p(text, { bold: true, alignment: AlignmentType.CENTER, size: SIZE_4 }); }

// ============ 图表工具 ============
function loadChart(name, chartDir = "D:/作业/charts") {
  const fpath = path.join(chartDir, name);
  if (!fs.existsSync(fpath)) return null;
  return fs.readFileSync(fpath);
}

let _chartDir = "D:/作业/charts";

function setChartDir(dir) { _chartDir = dir; }

function chartFigure(imageName, widthPx = 520, heightPx = 315) {
  const buf = loadChart(imageName, _chartDir);
  if (!buf) return p("[图表未找到: " + imageName + "]", { alignment: AlignmentType.CENTER });
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        data: buf,
        transformation: { width: widthPx, height: heightPx },
        type: "png",
      }),
    ],
    spacing: { before: 180, after: 60 },
  });
}

// 线性回归
function linReg(x, y) {
  const n = x.length;
  const sx = x.reduce((a, b) => a + b, 0);
  const sy = y.reduce((a, b) => a + b, 0);
  const sxy = x.reduce((a, xi, i) => a + xi * y[i], 0);
  const sxx = x.reduce((a, xi) => a + xi * xi, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const yMean = sy / n;
  const ssTot = y.reduce((a, yi) => a + (yi - yMean) ** 2, 0);
  const ssRes = y.reduce((a, yi, i) => a + (yi - (slope * x[i] + intercept)) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  return { slope, intercept, r: Math.sqrt(Math.max(0, r2)), r2 };
}

// ============ 表格工具 ============
function createTable(headers, rows) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(h => new TableCell({
      children: [p(h, { bold: true, alignment: AlignmentType.CENTER, size: SIZE_5 })],
      borders: TABLE_BORDERS,
    })),
  });
  const dataRows = rows.map(row => new TableRow({
    children: row.map(cell => new TableCell({
      children: [p(String(cell), { alignment: AlignmentType.CENTER, size: SIZE_5 })],
      borders: TABLE_BORDERS,
    })),
  }));
  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// 检测报告表（4列、含GridSpan）
function createDetectionTable({ info, results, conclusion }) {
  const CW = [1414, 2050, 1229, 3829];

  const tc = (text, col, span) => {
    let w = 0;
    for (let i = col; i < col + (span || 1); i++) w += CW[i];
    const cell = new TableCell({
      children: [p(text, { size: SIZE_5 })],
      borders: TABLE_BORDERS,
      width: { size: w, type: WidthType.DXA },
    });
    if (span) cell.root[0].root.push(new GridSpan(span));
    return cell;
  };

  const multiTc = (paragraphs, col, span) => {
    let w = 0;
    for (let i = col; i < col + span; i++) w += CW[i];
    const cell = new TableCell({
      children: paragraphs,
      borders: TABLE_BORDERS,
      width: { size: w, type: WidthType.DXA },
    });
    cell.root[0].root.push(new GridSpan(span));
    return cell;
  };

  const resultParagraphs = results.map(r => p(r, { size: SIZE_5 }));

  return new Table({
    columnWidths: CW,
    rows: [
      new TableRow({ children: [tc(info.productLabel || "产品名称", 0), tc(info.productName, 1), tc(info.batchLabel || "生产批次", 2), tc(info.batch, 3)] }),
      new TableRow({ children: [tc(info.quantityLabel || "样品数量", 0), tc(info.quantity, 1), tc(info.receiveDateLabel || "收样日期", 2), tc(info.receiveDate, 3)] }),
      new TableRow({ children: [tc(info.locationLabel || "采样地点", 0), tc(info.location, 1), tc(info.testDateLabel || "检测日期", 2), tc(info.testDate, 3)] }),
      new TableRow({ children: [tc(info.statusLabel || "样品状态", 0), tc(info.status, 1, 3)] }),
      new TableRow({ children: [tc(info.indicatorsLabel || "检测指标", 0), tc(info.indicators, 1, 3)] }),
      new TableRow({ children: [tc(info.basisLabel || "检验依据", 0), tc(info.basis, 1, 3)] }),
      new TableRow({ children: [tc(info.resultLabel || "检验结果", 0), multiTc(resultParagraphs, 1, 3)] }),
      new TableRow({ children: [tc(info.conclusionLabel || "检验结论", 0), multiTc([
        p(conclusion, { size: SIZE_5, indent: 480 }),
      ], 1, 3)] }),
    ],
  });
}

// ============ 文档组装 ============
function makeFooter() {
  return new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: "- ", font: "Times New Roman", size: 18 }),
          new TextRun({ children: [PageNumber.CURRENT], font: "Times New Roman", size: 18 }),
          new TextRun({ text: " -", font: "Times New Roman", size: 18 }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    ],
  });
}

// 封面页
function makeCoverPage(cover) {
  return {
    properties: {
      page: {
        margin: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT, right: MARGIN_RIGHT },
      },
    },
    children: [
      p("", { lineSpacing: 2 * 240 }),
      p(cover.title, { bold: true, size: 72, font: FONT, alignment: AlignmentType.CENTER, lineSpacing: 72 * 20 }),
      p(cover.subtitle, { size: 52, font: FONT, alignment: AlignmentType.CENTER, lineSpacing: 52 * 20, after: 240 }),
      p("", { lineSpacing: 2 * 240 }),
      ...(cover.fields || []).map(f => p(f, { size: SIZE_4 })),
      p(cover.date || "______年______月______日", { size: SIZE_4, alignment: AlignmentType.CENTER, before: 2 * 240 }),
    ],
  };
}

// 正文节
function makeBodySection(children, opts = {}) {
  return {
    properties: {
      page: {
        margin: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_LEFT, right: MARGIN_RIGHT, gutter: GUTTER, footer: 1022 },
      },
    },
    footers: {
      default: makeFooter(),
    },
    children: [
      p(opts.mainTitle || "", { bold: true, size: SIZE_2, font: FONT, alignment: AlignmentType.CENTER, lineSpacing: LINE_32PT }),
      ...children,
    ],
  };
}

// 构建完整文档
function buildDoc(sections) {
  return new Document({ sections });
}

// 保存文件
async function saveDoc(doc, outputPath) {
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return { path: outputPath, sizeKB: (buffer.length / 1024).toFixed(1) };
}

// ============ 导出 ============
module.exports = {
  // 格式常量
  FONT, FONT_HEI,
  SIZE_2, SIZE_3, SIZE_4, SIZE_5,
  LINE_32PT, LINE_24PT, LINE_15,
  MARGIN_TOP, MARGIN_BOTTOM, MARGIN_LEFT, MARGIN_RIGHT,
  GUTTER, TABLE_BORDERS,
  // 段落
  makeParagraph, p, pr,
  heading1, heading2, heading3, heading4,
  bodyText, tableCaption, figureCaption,
  // 图表
  loadChart, chartFigure, setChartDir, linReg,
  // 表格
  createTable, createDetectionTable,
  // 文档
  makeFooter, makeCoverPage, makeBodySection, buildDoc, saveDoc,
  // docx 底层（供高级用户使用）
  Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle,
  ImageRun, PageBreak, GridSpan,
};

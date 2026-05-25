// 生成手机兼容版 Word 报告 — 使用通用字体，UTF-8 编码
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun,
  HeadingLevel, BorderStyle, WidthType, AlignmentType, ShadingType, TableLayoutType } = require("docx");
const fs = require("fs");

const outDir = "D:/作业/shopee-data";
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// 通用字体 — 手机 / Mac / Windows 都支持
const FONT = "Segoe UI";  // 拉丁字体，回退到系统默认中文字体
const FONT_CN = "SimSun"; // 宋体，兼容性好

const BLUE = "1F4E79";
const LIGHT_BLUE = "D6E4F0";
const WHITE = "FFFFFF";
const GRAY = "F2F2F2";
const DARK = "333333";
const RED = "C0392B";

function cell(text, opts = {}) {
  const runs = [];
  if (typeof text === "string") {
    runs.push(new TextRun({
      text: String(text),
      font: { eastAsia: "SimSun", latin: "Segoe UI" },
      size: opts.size || 20,
      bold: !!opts.bold,
      color: opts.color || DARK,
    }));
  }
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shade ? { type: ShadingType.SOLID, color: opts.shade } : undefined,
    verticalAlign: "center",
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      spacing: { before: 40, after: 40 },
      children: runs,
    })],
  });
}

function h2(text) {
  return new Paragraph({
    spacing: { before: 300, after: 120 },
    border: { bottom: { color: BLUE, size: 6, style: BorderStyle.SINGLE } },
    children: [new TextRun({
      text, size: 28, bold: true, color: BLUE,
      font: { eastAsia: "SimHei", latin: "Segoe UI" },
    })],
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    children: [new TextRun({
      text, size: 21, color: opts.color || DARK, bold: !!opts.bold,
      font: { eastAsia: "SimSun", latin: "Segoe UI" },
    })],
  });
}

function makeTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => cell(h, {
      bold: true, shade: BLUE, color: WHITE, size: 20,
      width: colWidths ? colWidths[i] : undefined,
    })),
  });
  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map((c, ci) => cell(c, {
        shade: ri % 2 === 0 ? GRAY : WHITE,
        width: colWidths ? colWidths[ci] : undefined,
        bold: ci === 0,
      })),
    })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [headerRow, ...dataRows],
  });
}

// ====== 构建文档 ======
const children = [];

// 标题
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 600, after: 60 },
  children: [new TextRun({
    text: "Shopee 越南 - 女士单肩包（斜挎包）",
    size: 36, bold: true, color: BLUE,
    font: { eastAsia: "SimHei", latin: "Segoe UI" },
  })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 60 },
  children: [new TextRun({
    text: "市场数据报告",
    size: 34, bold: true, color: BLUE,
    font: { eastAsia: "SimHei", latin: "Segoe UI" },
  })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 40 },
  children: [new TextRun({
    text: "数据源: 知虾企业版 | 站点: 越南 | 类目: 女生包包/精品 - 单肩包",
    size: 18, color: "666666",
    font: { eastAsia: "SimSun", latin: "Segoe UI" },
  })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 40 },
  children: [new TextRun({
    text: "数据周期: 2024.01 - 2025.06 | 导出: 2026.05.24",
    size: 18, color: "666666",
    font: { eastAsia: "SimSun", latin: "Segoe UI" },
  })],
}));

// === 一 ===
children.push(h2("一、核心市场指标"));

children.push(makeTable(
  ["指标", "数据", "备注"],
  [
    ["越南电商半年交易额", "202.3万亿VND (84亿美元)", "2025H1, 同比+41.52%"],
    ["女手袋搜索量", "1,730万次", "Shopee全品类热搜第1"],
    ["斜挎包GMV增速", "整体+5-10%, 品牌+60%+", "品牌化为核心驱动力"],
    ["平台格局", "Shopee 58% / TikTok 39%", "TikTok增速69%, 增长最快"],
  ],
  [30, 35, 35]
));

// === 二 ===
children.push(h2("二、价格分布与趋势"));

children.push(makeTable(
  ["价格(USD)", "折合VND", "份额变化", "趋势"],
  [
    ["$4 - $8", "10-20万VND", "24.2% -> 26.3%", "涨幅最大, 主力带"],
    ["$8 - $14", "20-35万VND", "15.7% -> 16.5%", "小幅增长"],
    ["$14 - $40", "35-100万VND", "基本持平", "稳定区间"],
    ["$40+", "100万VND+", "16.3% -> 15.1%", "份额收缩"],
  ],
  [18, 24, 28, 30]
));

children.push(para(">> 定价建议: 主力产品聚焦 10-35万VND (约30-105元人民币)", { bold: true }));

// === 三 ===
children.push(h2("三、TOP商品月销量估算"));

children.push(makeTable(
  ["排名", "月均销量", "代表价位", "商品类型"],
  [
    ["TOP 1-10", "5,000-50,000", "10-30万VND", "基础款帆布/PU斜挎包"],
    ["TOP 11-50", "1,000-5,000", "20-80万VND", "中品质PU皮单肩包"],
    ["TOP 51-200", "200-1,000", "30-100万VND", "品牌/设计款"],
    ["长尾", "<200", "50万VND+", "高端/真皮/小众"],
  ],
  [15, 25, 25, 35]
));

// === 四 ===
children.push(h2("四、价格-销量对应模型"));

children.push(makeTable(
  ["价位(万VND)", "折合CNY", "月均销量/品", "竞争强度"],
  [
    ["10-20", "30-60元", "5,000-30,000", "极高(白牌价格战)"],
    ["20-50", "60-150元", "1,000-10,000", "高(跨境卖家集中)"],
    ["50-100", "150-300元", "500-3,000", "中(品牌化机会)"],
    ["100+", "300元+", "100-1,000", "低(品牌溢价)"],
  ],
  [22, 22, 28, 28]
));

// === 五 ===
children.push(h2("五、竞争格局"));

children.push(makeTable(
  ["类型", "代表", "特征"],
  [
    ["国际品牌", "Charles & Keith, Pedro", "新加坡品牌, 中高端"],
    ["越南本土", "Vascara, Juno", "设计感强, 中端价位"],
    ["跨境卖家", "中国/韩国卖家", "高性价比, 快速迭代"],
    ["白牌", "大量中小卖家", "价格战, 利润薄"],
  ],
  [20, 32, 48]
));

// === 六 ===
children.push(h2("六、消费者画像"));

children.push(makeTable(
  ["维度", "特征"],
  [
    ["核心人群", "25-34岁女性, 内容电商活跃"],
    ["旺季", "1月农历新年(最大旺季), 年底双11/双12"],
    ["颜色偏好", "紫、红、黄(越南特色)"],
    ["直播习惯", "82%进过直播间, 63%购买过"],
    ["物流时效", "本土发货+跨境直邮, 最快3天"],
  ],
  [25, 75]
));

// === 七 ===
children.push(h2("七、结论与建议"));

const tips = [
  "品牌化: 品牌女包增速>60%, 消费者愿为品牌溢价买单, 建议注册自有品牌",
  "内容电商: TikTok Shop份额29%->39%, 直播+短视频是核心增长引擎",
  "性价比定位: $4-8价格带增长最快, 建议主力产品定价在30-105元区间",
  "本土化: 越南语内容+本地节日营销+本土发货, 缺一不可",
  "差异化蓝海: 欧美大五金、环保材料、IP联名、中性风是机会点",
];
tips.forEach((t, i) => {
  children.push(para((i+1) + ". " + t));
});

// 页脚
children.push(new Paragraph({ spacing: { before: 200 }, children: [] }));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 30 },
  border: { top: { color: "CCCCCC", size: 1, style: BorderStyle.SINGLE } },
  children: [new TextRun({
    text: "数据来源: 知虾企业版 (zxee.menglar.com) · Shopee越南站 · 女生包包/精品类目",
    size: 16, color: "999999",
    font: { eastAsia: "SimSun", latin: "Segoe UI" },
  })],
}));

// ====== 生成 ======
const doc = new Document({
  styles: {
    default: {
      document: {
        run: {
          size: 21,
          font: { eastAsia: "SimSun", latin: "Segoe UI" },
        },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 800, bottom: 800, left: 900, right: 900 },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const outPath = outDir + "/Shopee越南-女士单肩包-知虾数据报告_v2.docx";
  fs.writeFileSync(outPath, buf);
  console.log("Generated: " + outPath);
});

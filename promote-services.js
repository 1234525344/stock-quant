// 闲鱼服务多平台推广 — 小红书 / 知乎 / 豆瓣
// 用法：
//   1. 关掉所有 Edge → start msedge --remote-debugging-port=9222
//   2. 在 Edge 中登录小红书/知乎/豆瓣
//   3. node promote-services.js [平台]
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const TMP = path.join(__dirname, ".clip-temp.txt");

function copyToClipboard(text) {
  fs.writeFileSync(TMP, text, "utf8");
  execSync(`cmd.exe /c "type "${TMP}" | clip"`, { encoding: "utf8" });
}

// ============ 推广内容模板 ============

// 通用自我介绍（发小红书/知乎想法）
function introPost() {
  return `分享几个我用编程搞副业的方法，适合会一点代码或者愿意学的：

1. 帮大学生做实训报告排版
   化学/材料专业的实验报告，数据处理+图表+Word排版，20块一份。其实就是用Python算回归、画标准曲线、生成docx，一套流程5分钟。（闲鱼搜"实训报告自动生成"）

2. 代写小脚本
   数据采集、Excel批量处理、网页自动填表，50-800块不等。很多人不知道这些其实几十行代码就搞定。（闲鱼搜"代写脚本 Python"）

3. 通达信选股公式
   把量化模型的因子写成通达信公式卖，29.9一套。写一次，反复卖。（闲鱼搜"通达信选股公式 多因子"）

4. 每日量化选股订阅
   收盘后自动跑模型，推送3-6只强势标的，9.9/月。闲鱼和知识星球都能做。

这四个的共同点：代码写好之后就剩复制粘贴，边际成本几乎为零。我白天上班，晚上和周末弄，一个月能多三四千。

有兴趣的可以闲鱼搜"stockquant"或者直接私我。
#副业 #编程 #闲鱼赚钱 #Python #量化交易`;
}

// 知乎问题回答：有哪些小众的赚钱方式
function zhihuSideHustleAnswer() {
  const today = new Date();
  const ds = `${today.getFullYear()}年${today.getMonth() + 1}月`;

  return `说实话，大部分"副业教程"要么割韭菜要么太卷。我说几个我自己在做的、门槛不高但确实能赚到钱的。

一、帮大学生处理实验数据（月入500-2000）

化学、材料、环境这些理工科专业的实验报告很有规律。学生把实验记录拍照发你，你帮他：
- 做数据回归计算
- 画标准曲线图（含R²）
- 排成标准Word格式

一套收20块。用Python写个脚本，pandas处理数据、matplotlib画图、python-docx生成Word，5分钟一套。

我${ds}在闲鱼挂了链接，稳定每天1-3单。期末月能到5-8单。

二、代写办公自动化脚本（月入1000-4000）

闲鱼上"代写脚本"的需求比想象中大。数据采集、Excel批量处理、网页自动填表，报价50-800。

很多人工作中遇到重复性操作，知道能用代码解决但自己不会写。50行Python解决的事，在他们眼里值200块。

三、卖通达信/同花顺公式（月入300-1500）

炒股的人很多在用通达信，但99%不会写公式。你把常用的技术指标写成选股公式和副图指标，标29.9一份，写一次反复卖。

我写了一套"多因子量化评分"公式——13个因子综合打分，包含突破信号、量价配合、MACD动量、OBV资金流。导入通达信就能自动扫描全市场。

四、量化选股订阅（月入300-2000）

收盘后自动跑多因子模型，筛出3-6只强势票，配上评分和信号，做成图片推给订户。9.9/月。

你只需要一次把模型写好，之后就是服务器自动跑。

总结

四个的共同点：写好一次，反复卖。不是"时薪"思维，是"产品"思维。前期花时间写代码，后期就是复制粘贴。

想试试的可以私我，我可以分享具体怎么开始。`;
}

// 小红书图文：实训报告
function xhsReportPost() {
  return `大学生实训报告代做🔥实验数据直接发我

不是代写！是你把实验数据给我，我帮你做：
✅ 数据计算（回归分析、平均值、标准偏差）
✅ 标准曲线图（标注回归方程+R²）
✅ Word标准排版（宋体小四、1.5倍行距）

📦 交付：Word报告 + 高清图表PNG
💰 价格：20元/份
⏰ 时间：2小时出

支持：固含量、pH、碳酸根、氟、铁等化学实验
其他实验可定制

左下角闲鱼搜"实训报告自动生成"
#实训报告 #实验报告 #大学生 #化学实验 #Word排版`;
}

// 小红书图文：通达信公式
function xhsTDXPost() {
  return `炒股必备🔥5套量化选股公式 导入通达信直接用

自己写的多因子模型，转成了通达信公式：

📊 多因子评分（副图指标）
13个因子综合打分0-100，一眼看出强弱

🔍 4套条件选股
• 强势突破 — N日高点突破+放量
• 放量突破 — 量价配合+OBV确认
• MACD金叉 — 金叉+RSI共振
• 均线多头 — 多头排列+加速信号

💰 29.9/全套（5个公式）
📖 附带详细安装和使用说明

收盘后30秒扫完全市场，不用一只只翻了
左下角闲鱼搜"通达信选股公式"
#炒股 #通达信 #选股公式 #技术分析 #量化`;
}

// 小红书图文：代写脚本
function xhsScriptPost() {
  return `会Python/Node.js的朋友看过来💻

闲鱼代写脚本副业：
🕷️ 爬虫/数据采集
⚙️ 自动化办公
📊 Excel处理
🔧 工具脚本

50-800/单，看难度报价
源码给你 · 一周售后 · 不接灰产

我在做的事情，你也可以做。有编程基础的话门槛很低。

左下角闲鱼搜"代写脚本 Python"
#副业 #Python #编程副业 #闲鱼赚钱 #自动化办公`;
}

// ============ 发布工具函数 ============

async function findEditorAndFill(page, text) {
  const result = await page.evaluate((t) => {
    const contentEditables = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter(el => el.offsetParent !== null);
    const textareas = [...document.querySelectorAll('textarea')]
      .filter(el => el.offsetParent !== null);
    const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')]
      .filter(el => {
        if (el.offsetParent === null) return false;
        const attr = (el.id || '') + (el.name || '') + (el.placeholder || '');
        return !/search|title|标题/.test(attr.toLowerCase());
      });
    const candidates = [...contentEditables, ...textareas, ...inputs];
    if (candidates.length === 0) return { ok: false, reason: "无编辑元素" };

    let best = candidates[0], bestArea = 0;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) { best = el; bestArea = area; }
    }

    best.focus(); best.click();
    if (best.contentEditable === "true") {
      best.textContent = "";
      best.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, t);
    } else {
      best.value = t;
      best.dispatchEvent(new Event("input", { bubbles: true }));
      best.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true, tag: best.tagName };
  }, text);

  if (!result.ok) {
    console.log("   ⚠️ JS注入失败，换键盘粘贴");
    await page.mouse.click(500, 400);
    await page.waitForTimeout(300);
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(800);
  }
  return result;
}

async function clickPublish(page) {
  return await page.evaluate(() => {
    const all = [...document.querySelectorAll("button, a, span, div[role='button']")];
    const byClass = all.filter(el => {
      if (!el.offsetParent) return false;
      const attr = ((el.className || '') + (el.id || '')).toLowerCase();
      return /publish|submit|post|send/.test(attr);
    });
    if (byClass.length > 0) {
      byClass[byClass.length - 1].click();
      return "class=" + (byClass[byClass.length - 1].className || "").slice(0, 20);
    }
    const byText = all.filter(el => {
      if (!el.offsetParent) return false;
      const t = (el.textContent || '').trim();
      return /^(发布|发表|提交|确认|发送)$/.test(t);
    });
    if (byText.length > 0) {
      byText[byText.length - 1].click();
      return "text=" + byText[byText.length - 1].textContent?.trim();
    }
    const fuzzy = all.filter(el => {
      if (!el.offsetParent) return false;
      const t = (el.textContent || '').trim();
      return t.length >= 2 && t.length <= 6 && /发布|发表/.test(t);
    });
    if (fuzzy.length > 0) {
      fuzzy[fuzzy.length - 1].click();
      return "fuzzy=" + fuzzy[fuzzy.length - 1].textContent?.trim();
    }
    return false;
  });
}

// ============ 平台发布 ============

// 小红书发布图文（需要提前在Edge中登录）
async function postXiaohongshu(content) {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  console.log("📕 小红书...");
  await page.goto("https://creator.xiaohongshu.com/publish/publish", { waitUntil: "load", timeout: 20000 });
  await page.waitForTimeout(4000);

  // 关弹窗
  await page.evaluate(() => {
    document.querySelectorAll("[role='dialog'] button, .modal-close, .close-btn")
      .forEach(b => b.click());
  });
  await page.waitForTimeout(500);

  copyToClipboard(content);
  await findEditorAndFill(page, content);

  // 小红书需要封面图，提示用户
  console.log("   ⚠️ 小红书需要手动上传封面图（在 Edge 中操作）");
  console.log("   📁 建议图片: D:/作业/listing-images/");

  // 尝试发布
  const pub = await clickPublish(page);
  console.log(pub ? `   ✅ 已点击: ${pub}` : "   ⚠️ 请手动发布（内容已填入）");

  return page;
}

// 知乎写想法
async function postZhihuPin(content) {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  console.log("💡 知乎想法...");
  await page.goto("https://www.zhihu.com/pin/create", { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(3000);

  // 关弹窗
  await page.evaluate(() => {
    document.querySelectorAll("[role='dialog'] button, .Modal-closeButton")
      .forEach(b => b.click());
  });
  await page.waitForTimeout(500);

  copyToClipboard(content);
  await findEditorAndFill(page, content);

  const pub = await page.evaluate(() => {
    const all = [...document.querySelectorAll("button")]
      .filter(el => el.offsetParent);
    const btn = all.find(el => /发布|发表/.test(el.textContent || '') && (el.textContent || '').length <= 4);
    if (btn) { btn.click(); return btn.textContent?.trim(); }
    return false;
  });
  console.log(pub ? `   ✅ 已发布: ${pub}` : "   ⚠️ 请手动发布（内容已填入）");

  return page;
}

// 知乎回答问题
async function postZhihuAnswer(questionUrl, content) {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  console.log("💡 知乎回答...");
  await page.goto(questionUrl, { waitUntil: "load", timeout: 15000 });
  await page.waitForTimeout(3000);

  // 关弹窗
  await page.evaluate(() => {
    document.querySelectorAll("[role='dialog'] button, .Modal-closeButton, .signFlowModal button")
      .forEach(b => b.click());
  });
  await page.waitForTimeout(500);

  // 找「写回答」按钮
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button, a")]
      .filter(el => /写回答|撰写回答|添加回答/.test(el.textContent || ''));
    if (btns[0]) btns[0].click();
  });
  await page.waitForTimeout(2000);

  copyToClipboard(content);
  await findEditorAndFill(page, content);

  const pub = await page.evaluate(() => {
    const all = [...document.querySelectorAll("button")]
      .filter(el => el.offsetParent);
    const btn = all.find(el => /发布|提交|发表/.test(el.textContent || '') && (el.textContent || '').length <= 4);
    if (btn) { btn.click(); return btn.textContent?.trim(); }
    return false;
  });
  console.log(pub ? `   ✅ 已发布: ${pub}` : "   ⚠️ 请手动发布（内容已填入）");

  return page;
}

// ============ 主流程 ============
async function main() {
  const target = process.argv[2] || "all";

  console.log("🚀 闲鱼服务推广发布\n");
  console.log("   确保 Edge 已打开且已登录相关平台\n");

  if (target === "xiaohongshu" || target === "all") {
    console.log("═".repeat(40));
    console.log("📕 小红书 — 副业分享");
    console.log("═".repeat(40));
    await postXiaohongshu(introPost());
    console.log("");
  }

  if (target === "zhihu-pin" || target === "all") {
    console.log("═".repeat(40));
    console.log("💡 知乎想法 — 自我介绍");
    console.log("═".repeat(40));
    await postZhihuPin(introPost());
    console.log("");
  }

  if (target === "zhihu-answer" || target === "all") {
    console.log("═".repeat(40));
    console.log("💡 知乎回答 — 小众赚钱方式");
    console.log("═".repeat(40));
    // 搜索相关问题和手动选择
    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const ctx = browser.contexts()[0];
    const page = await ctx.newPage();
    await page.goto("https://www.zhihu.com/search?type=content&q=小众赚钱方式 副业", { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(3000);

    // 列出搜索结果让用户选
    const questions = await page.evaluate(() => {
      return [...document.querySelectorAll(".List-item .ContentItem-title a, .SearchResult-Card a[href*='question']")]
        .slice(0, 5)
        .map((el, i) => ({ index: i, title: el.textContent?.trim(), href: el.href }));
    });
    console.log("   找到以下问题:");
    questions.forEach(q => console.log(`   [${q.index}] ${q.title}`));
    console.log("   → 请在 Edge 中选择一个问题，手动粘贴回答内容");

    copyToClipboard(zhihuSideHustleAnswer());
    console.log("   ✅ 回答内容已复制到剪贴板");
  }

  console.log("\n" + "═".repeat(40));
  console.log("推广发布完成！");
  console.log("\n💡 建议发布节奏：");
  console.log("   小红书：每周 2-3 篇副业/技能分享");
  console.log("   知乎：每周 1-2 个相关问题的回答");
  console.log("   内容已经写好，下次直接跑 node promote-services.js xiaohongshu");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

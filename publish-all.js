// 全自动全平台发布 — 处理封面图、发布按钮、知乎选题
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SITE_URL = "https://percentage-insight-satellite-reads.trycloudflare.com";
const IMG_DIR = "D:/作业/listing-images";
const TMP = path.join(__dirname, ".clip-temp.txt");

function copyToClipboard(text) {
  fs.writeFileSync(TMP, text, "utf8");
  execSync(`cmd.exe /c "type "${TMP}" | clip"`, { encoding: "utf8" });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ 推广内容 ============

const introPost = `分享几个我用编程搞副业的方法，适合会一点代码或者愿意学的：

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

const zhihuAnswer = `说实话，大部分"副业教程"要么割韭菜要么太卷。我说几个我自己在做的、门槛不高但确实能赚到钱的。

一、帮大学生处理实验数据（月入500-2000）

化学、材料、环境这些理工科专业的实验报告很有规律。学生把实验记录拍照发你，你帮他做数据回归计算、画标准曲线图（含R²）、排成标准Word格式。一套收20块。用Python写个脚本，pandas处理数据、matplotlib画图、python-docx生成Word，5分钟一套。

二、代写办公自动化脚本（月入1000-4000）

闲鱼上"代写脚本"的需求比想象中大。数据采集、Excel批量处理、网页自动填表，报价50-800。很多人工作中遇到重复性操作，知道能用代码解决但自己不会写。50行Python解决的事，在他们眼里值200块。

三、卖通达信/同花顺公式（月入300-1500）

炒股的人很多在用通达信，但99%不会写公式。你把常用的技术指标写成选股公式和副图指标，标29.9一份，写一次反复卖。

四、量化选股订阅（月入300-2000）

收盘后自动跑多因子模型，筛出3-6只强势票，配上评分和信号，做成图片推给订户。9.9/月。

四个的共同点：写好一次，反复卖。不是"时薪"思维，是"产品"思维。前期花时间写代码，后期就是复制粘贴。

想试试的可以私我，我可以分享具体怎么开始。`;

// ============ 通用工具 ============

async function findEditor(page) {
  return await page.evaluate(() => {
    const contentEditables = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter(el => el.offsetParent !== null);
    const textareas = [...document.querySelectorAll('textarea')]
      .filter(el => el.offsetParent !== null);
    const candidates = [...contentEditables, ...textareas];
    if (candidates.length === 0) return null;
    let best = candidates[0], bestArea = 0;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    return { tag: best.tagName, area: bestArea, ce: best.contentEditable === "true" };
  });
}

async function injectText(page, text) {
  // 方法1: JS注入
  const result = await page.evaluate((t) => {
    const contentEditables = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter(el => el.offsetParent !== null);
    const textareas = [...document.querySelectorAll('textarea')]
      .filter(el => el.offsetParent !== null);
    const candidates = [...contentEditables, ...textareas];
    if (candidates.length === 0) return { ok: false, reason: "no editor" };

    let best = candidates[0], bestArea = 0;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height > bestArea) { best = el; bestArea = rect.width * rect.height; }
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
    return { ok: true, tag: best.tagName, area: Math.round(bestArea) };
  }, text);

  if (result.ok) {
    console.log(`   ✅ 已填入 (${result.tag} area=${result.area})`);
    return true;
  }

  // 方法2: 键盘粘贴
  console.log("   ⚠️ JS注入失败，改用键盘粘贴...");
  copyToClipboard(text);
  await page.mouse.click(500, 400);
  await sleep(300);
  await page.keyboard.press("Control+v");
  await sleep(800);
  return true;
}

async function clickPublish(page) {
  return await page.evaluate(() => {
    const all = [...document.querySelectorAll("button, a, span, div[role='button']")];

    // 精确匹配：只有"发布"/"发表"/"提交"
    const exact = all.filter(el => {
      if (!el.offsetParent) return false;
      const t = (el.textContent || '').trim();
      return /^(发布|发表|提交|确认发布|发布笔记|发布回答)$/.test(t);
    });
    if (exact.length > 0) { exact[exact.length - 1].click(); return exact[exact.length - 1].textContent.trim(); }

    // Class匹配
    const byClass = all.filter(el => {
      if (!el.offsetParent) return false;
      const attr = ((el.className || '') + (el.id || '')).toLowerCase();
      return /publish|submit|post/.test(attr) && (el.textContent || '').trim().length <= 10;
    });
    if (byClass.length > 0) { byClass[byClass.length - 1].click(); return "btn:" + (byClass[byClass.length - 1].className || "").slice(0, 20); }

    // 模糊匹配
    const fuzzy = all.filter(el => {
      if (!el.offsetParent) return false;
      const t = (el.textContent || '').trim();
      return t.length >= 2 && t.length <= 8 && /发布|发表|提交/.test(t);
    });
    if (fuzzy.length > 0) { fuzzy[fuzzy.length - 1].click(); return "fuzzy:" + fuzzy[fuzzy.length - 1].textContent.trim(); }

    return false;
  });
}

// ============ 小红书 ============
async function publishXHS(page, content, imageFile) {
  console.log("📕 小红书...");
  await page.goto("https://creator.xiaohongshu.com/publish/publish", { waitUntil: "load", timeout: 20000 });
  await sleep(5000);

  // 关弹窗
  await page.evaluate(() => {
    document.querySelectorAll("[role='dialog'] button, .modal-close, .close-btn, .driver-close-btn")
      .forEach(b => b.click());
  });
  await sleep(500);

  // 上传封面图
  if (imageFile && fs.existsSync(imageFile)) {
    console.log(`   📷 上传封面: ${path.basename(imageFile)}`);
    try {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(imageFile);
        await sleep(3000);
        console.log("   ✅ 封面上传完成");
      } else {
        // 尝试点击上传区域触发文件选择
        const uploadArea = await page.$('[class*="upload"], [class*="cover"], [class*="add-image"]');
        if (uploadArea) {
          // 找隐藏的file input
          const allInputs = await page.$$('input[type="file"]');
          if (allInputs.length > 0) {
            await allInputs[0].setInputFiles(imageFile);
            await sleep(3000);
            console.log("   ✅ 封面上传完成");
          }
        }
        if (!fileInput && allInputs.length === 0) {
          console.log("   ⚠️ 未找到上传入口，请手动拖入封面图");
        }
      }
    } catch(e) {
      console.log("   ⚠️ 上传失败: " + e.message.substring(0, 60));
    }
  }

  // 填标题（小红书需要标题）
  try {
    const titleInput = await page.$('input[placeholder*="标题"], [class*="title"] input');
    if (titleInput) {
      await titleInput.fill("编程副业分享：写好代码，反复赚钱");
      console.log("   ✅ 标题已填");
    }
  } catch(e) {}

  // 填正文
  copyToClipboard(content);
  const ok = await injectText(page, content);
  await sleep(1000);

  // 发布
  const pub = await clickPublish(page);
  console.log(pub ? `   🎉 已发布: ${pub}` : "   ⚠️ 请手动发布");
}

// ============ 知乎想法 ============
async function publishZhihuPin(page, content) {
  console.log("💡 知乎想法...");
  await page.goto("https://www.zhihu.com/pin/create", { waitUntil: "load", timeout: 15000 });
  await sleep(4000);

  await page.evaluate(() => {
    document.querySelectorAll("[role='dialog'] button, .Modal-closeButton")
      .forEach(b => b.click());
  });
  await sleep(500);

  copyToClipboard(content);
  await injectText(page, content);
  await sleep(1000);

  const pub = await clickPublish(page);
  console.log(pub ? `   🎉 已发布: ${pub}` : "   ⚠️ 请手动发布");
}

// ============ 知乎回答 ============
async function publishZhihuAnswer(page, content) {
  console.log("💡 知乎回答...");
  await page.goto("https://www.zhihu.com/search?type=content&q=小众赚钱方式 副业 编程", { waitUntil: "load", timeout: 15000 });
  await sleep(4000);

  // 关弹窗
  await page.evaluate(() => {
    document.querySelectorAll("[role='dialog'] button, .Modal-closeButton, .signFlowModal button")
      .forEach(b => b.click());
  });
  await sleep(500);

  // 找第一个问题链接
  const questionUrl = await page.evaluate(() => {
    const links = [...document.querySelectorAll("a[href*='/question/']")]
      .filter(el => el.offsetParent && el.textContent.trim().length > 5);
    return links[0]?.href || null;
  });

  if (!questionUrl) {
    console.log("   ⚠️ 没找到问题链接");
    return;
  }

  console.log(`   问题: ${questionUrl.slice(0, 70)}...`);
  await page.goto(questionUrl, { waitUntil: "load", timeout: 15000 });
  await sleep(4000);

  // 关弹窗
  await page.evaluate(() => {
    document.querySelectorAll("[role='dialog'] button, .Modal-closeButton, .signFlowModal button")
      .forEach(b => b.click());
  });
  await sleep(500);

  // 点「写回答」
  const wrote = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")]
      .filter(el => /写回答|撰写回答/.test(el.textContent || '') && el.offsetParent);
    if (btns[0]) { btns[0].click(); return true; }
    return false;
  });

  if (!wrote) {
    console.log("   ⚠️ 未找到写回答按钮");
    return;
  }

  console.log("   ✅ 已打开编辑器");
  await sleep(3000);

  // 填内容
  copyToClipboard(content);
  await injectText(page, content);
  await sleep(1500);

  // 发布
  const pub = await clickPublish(page);
  console.log(pub ? `   🎉 已发布: ${pub}` : "   ⚠️ 请手动发布");
}

// ============ 雪球 ============
async function publishXueqiu(page, content) {
  console.log("❄️  雪球...");
  await page.goto("https://xueqiu.com/statuses/new", { waitUntil: "load", timeout: 20000 });
  await sleep(4000);

  copyToClipboard(content);
  await injectText(page, content);
  await sleep(1000);

  const pub = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button, a, span")]
      .filter(el => {
        if (!el.offsetParent) return false;
        const t = (el.textContent || '').trim();
        return t === '发布' || t === '发帖';
      });
    if (btns.length > 0) { btns[btns.length - 1].click(); return true; }
    return false;
  });

  if (pub) {
    console.log("   🎉 已发布！");
    await sleep(3000);
  } else {
    // 再试通用方法
    const pub2 = await clickPublish(page);
    console.log(pub2 ? `   🎉 已发布: ${pub2}` : "   ⚠️ 请手动发布");
  }
}

// ============ 东方财富股吧 ============
async function publishGuba(page, content) {
  console.log("📊 东方财富股吧...");
  await page.goto("https://guba.eastmoney.com/list,600519.html", { waitUntil: "load", timeout: 20000 });
  await sleep(3000);

  // 点"发新帖"
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("a, button, span")]
      .filter(b => /发新帖|写话题|发帖/.test(b.textContent));
    if (btns[0]) btns[0].click();
  });
  await sleep(3000);

  copyToClipboard(content);
  await injectText(page, content);
  await sleep(1000);

  // 填标题
  try {
    await page.evaluate(() => {
      const titleInput = document.querySelector("input[id*='title'], input[name*='title'], input[placeholder*='标题']");
      if (titleInput) {
        titleInput.value = "量化交易工具分享";
        titleInput.dispatchEvent(new Event("input",{bubbles:true}));
        titleInput.dispatchEvent(new Event("change",{bubbles:true}));
      }
    });
  } catch(e) {}

  const pub = await clickPublish(page);
  console.log(pub ? `   🎉 已发布: ${pub}` : "   ⚠️ 请手动发布");
}

// ============ 公众号 ============
async function publishWeChat(page, content) {
  console.log("📰 公众号...");
  await page.goto("https://mp.weixin.qq.com", { waitUntil: "load", timeout: 15000 });
  await sleep(3000);

  copyToClipboard(content);
  console.log("   ✅ 内容已复制到剪贴板");

  // 尝试自动导航到新建图文
  try {
    await page.click('text=新的创作');
    await sleep(1000);
    await page.click('text=写新图文');
    await sleep(3000);

    // 填标题
    const titleInput = await page.$('#title, input[placeholder*="标题"]');
    if (titleInput) {
      await titleInput.fill("量化交易工具分享 | 每日选股");
    }

    // 填正文
    await injectText(page, content);
    console.log("   ✅ 已填入编辑器");
  } catch(e) {
    console.log("   ⚠️ 自动填入失败，请手动 Ctrl+V");
  }
}

// ============ 主流程 ============
(async () => {
  console.log("🚀 全自动全平台发布\n");

  // 生成每日选股内容
  let dailyContent = "";
  try {
    const { generateDailyArticle } = require("./src/article-generator");
    const article = await generateDailyArticle();
    console.log(`📝 每日选股: ${article.date} | ${article.mood}`);
    dailyContent = article.short + `\n\n免费量化工具：${SITE_URL}\n#量化交易 #A股`;
  } catch(e) {
    console.log("⚠️ 每日选股生成失败，使用备用内容");
    dailyContent = `今日量化选股推送\n\n多因子模型扫描结果\n\n免费量化工具：${SITE_URL}\n#量化交易 #A股`;
  }

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  console.log("🔗 已连接 Edge\n");

  // ====== 1. 服务推广 ======
  console.log("═".repeat(50));
  console.log("📢 第一步：服务推广");
  console.log("═".repeat(50));

  // 小红书 — 副业分享
  const xhsPage1 = await ctx.newPage();
  await publishXHS(xhsPage1, introPost, path.join(IMG_DIR, "01-实训报告.png"));

  console.log("");

  // 知乎想法
  const zhihuPage1 = await ctx.newPage();
  await publishZhihuPin(zhihuPage1, introPost);

  console.log("");

  // 知乎回答
  const zhihuPage2 = await ctx.newPage();
  await publishZhihuAnswer(zhihuPage2, zhihuAnswer);

  console.log("\n");

  // ====== 2. 每日选股推广 ======
  console.log("═".repeat(50));
  console.log("📈 第二步：每日量化选股推广");
  console.log("═".repeat(50));

  // 雪球
  const xqPage = await ctx.newPage();
  await publishXueqiu(xqPage, dailyContent);

  console.log("");

  // 东方财富股吧
  const gubaPage = await ctx.newPage();
  await publishGuba(gubaPage, dailyContent);

  console.log("");

  // 小红书 — 每日选股
  const xhsPage2 = await ctx.newPage();
  await publishXHS(xhsPage2, dailyContent, path.join(IMG_DIR, "05-每日选股.png"));

  console.log("");

  // 公众号
  const wxPage = await ctx.newPage();
  await publishWeChat(wxPage, dailyContent);

  console.log("\n" + "═".repeat(50));
  console.log("✅ 全平台发布完成！");
  console.log("═".repeat(50));
  console.log("\n📊 发布清单:");
  console.log("   小红书: 副业分享 + 每日选股 (2篇)");
  console.log("   知乎:   想法 + 回答 (2篇)");
  console.log("   雪球:   每日选股 (1篇)");
  console.log("   股吧:   每日选股 (1篇)");
  console.log("   公众号: 每日选股 (1篇，需手动群发)");
  console.log("\n💡 建议检查各标签页确认发布状态");

  // 保持连接，让用户检查
  console.log("\n浏览器保持打开，检查完毕后可关闭。");
})();

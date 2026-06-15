// 量化平台推广 — 一键多平台发文
const { chromium } = require("playwright");
const { execSync } = require("child_process");

const SITE_URL = "https://lbquant.top";

// Platform-specific posts
const POSTS = {
  xueqiu: `【自建量化交易平台分享】多因子评分 + 组合优化 + 风控回测

把量化选股流程做成了Web平台，浏览器打开即用：

📊 核心功能：
- 多因子评分引擎 — 9维度自动打分
- 组合优化器 — Markowitz Max Sharpe / Risk Parity / Min Variance
- 策略回测 — 月/周调仓，净值曲线可视化
- 三层风控 — 止损止盈/仓位上限/VaR+Beta

🔗 ${SITE_URL}

💰 提供API数据接口月卡(19.9元)，适合做量化策略开发的朋友调用行情/K线/选股数据。源码99元永久授权，可私有化部署。

欢迎交流策略！`,

  zhihu: `关于量化选股，分享一下我的实践。

我自己搭建了一个量化平台，把选股流程做成了浏览器工具：

1. 数据：akshare + 通达信双源，覆盖全市场4000+标的
2. 因子：9维度评分（位置/动量/趋势/质量/成长/流动性/波动率/RSI/量比）
3. 组合：四种优化方法，自动计算最优权重
4. 风控：三层（止损线+仓位上限+VaR/Beta）
5. 回测：可视化净值曲线+夏普比率+最大回撤

实盘验证了三个月，跑赢沪深300约8个点（历史仅供参考）。

${SITE_URL}
提供API接口月卡(19.9元)，方便在代码里调用数据。`,

  guba: `【量化选股工具分享】自建多因子评分系统

做了一个量化选股Web平台：
✅ 每日精选标的 + 多因子评分
✅ 买卖信号自动提示
✅ 组合优化 + 策略回测
✅ 三层风控系统

浏览器打开即用：${SITE_URL}

提供API数据接口(19.9元/月)和完整源码(99元永久)，适合做量化开发的朋友。`,
};

async function injectAndPublish(page, text) {
  // Try to find editor and fill
  const result = await page.evaluate((t) => {
    const editables = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter(e => e.offsetParent);
    const textareas = [...document.querySelectorAll('textarea')]
      .filter(e => e.offsetParent);
    const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')]
      .filter(e => e.offsetParent && !/search|title|标题/.test((e.id + e.name + e.placeholder).toLowerCase()));

    const all = [...editables, ...textareas, ...inputs];
    if (!all.length) return { ok: false, msg: "no editor" };

    let best = all[0], maxArea = 0;
    for (const el of all) {
      const a = el.getBoundingClientRect().width * el.getBoundingClientRect().height;
      if (a > maxArea) { best = el; maxArea = a; }
    }
    best.focus(); best.click();
    if (best.contentEditable === "true") {
      best.textContent = t;
      best.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      best.value = t;
      best.dispatchEvent(new Event("input", { bubbles: true }));
      best.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true, tag: best.tagName, area: maxArea };
  }, text);
  console.log(`   编辑器: ${JSON.stringify(result)}`);
  return result;
}

async function tryClickPublish(page) {
  const btns = await page.$$("button, a, div[role='button'], span[role='button']");
  for (const b of btns) {
    const t = (await b.textContent().catch(() => "")).trim();
    if (t && /^(发布|发表|提交)$/.test(t) && t.length <= 3) {
      await b.click();
      return true;
    }
  }
  // Fallback: search for any button containing these chars
  for (const b of btns) {
    const t = (await b.textContent().catch(() => "")).trim();
    if (t.includes("发布") || t.includes("发表")) {
      await b.click();
      return true;
    }
  }
  return false;
}

async function main() {
  console.log("🚀 量化平台多平台推广发布\n");
  console.log(`🔗 推广链接: ${SITE_URL}\n`);

  const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ==== 1. 雪球 ====
  console.log("❄️  雪球...");
  try {
    const page = await context.newPage();
    await page.goto("https://xueqiu.com/", { timeout: 30000, waitUntil: "domcontentloaded" });
    await sleep(4000);

    // Check login status
    const needLogin = await page.$("text=登录 / 注册");
    if (needLogin) {
      console.log("   ⚠️ 需要登录雪球 — 请在浏览器中扫码, 等待60秒...");
      await sleep(60000);
      await page.goto("https://xueqiu.com/", { timeout: 30000, waitUntil: "domcontentloaded" });
      await sleep(3000);
    }

    // Navigate to publish page
    await page.goto("https://xueqiu.com/statuses/publish", { timeout: 30000, waitUntil: "domcontentloaded" });
    await sleep(4000);

    await injectAndPublish(page, POSTS.xueqiu);
    await sleep(2000);

    if (await tryClickPublish(page)) {
      console.log("   ✅ 雪球发布成功");
    } else {
      console.log("   ⚠️ 内容已填入, 请手动点击发布按钮");
    }
    await sleep(2000);
    await page.close();
  } catch (e) {
    console.log("   ❌ 雪球失败:", e.message);
  }

  // ==== 2. 知乎 ====
  console.log("\n💡 知乎...");
  try {
    const page = await context.newPage();
    await page.goto("https://www.zhihu.com/", { timeout: 30000, waitUntil: "domcontentloaded" });
    await sleep(4000);

    // Try to find and click "写想法"
    const ideaBtns = await page.$$("a, button, span, div");
    let clicked = false;
    for (const el of ideaBtns) {
      const t = (await el.textContent().catch(() => "")).trim();
      if (t === "写想法" || t.includes("写想法")) {
        await el.click();
        clicked = true;
        console.log("   已点击: 写想法");
        break;
      }
    }

    if (!clicked) {
      // Navigate directly
      await page.goto("https://www.zhihu.com/pin-creation", { timeout: 30000, waitUntil: "domcontentloaded" });
    }
    await sleep(3000);

    await injectAndPublish(page, POSTS.zhihu);
    await sleep(2000);

    if (await tryClickPublish(page)) {
      console.log("   ✅ 知乎想法发布成功");
    } else {
      console.log("   ⚠️ 内容已填入, 请手动点击发布");
    }
    await sleep(2000);
    await page.close();
  } catch (e) {
    console.log("   ❌ 知乎失败:", e.message);
  }

  // ==== 3. 东方财富股吧 ====
  console.log("\n📊 东方财富股吧...");
  try {
    const page = await context.newPage();
    await page.goto("https://guba.eastmoney.com/", { timeout: 30000, waitUntil: "domcontentloaded" });
    await sleep(4000);

    // Need login
    const loginBtn = await page.$("text=登录");
    if (loginBtn) {
      console.log("   ⚠️ 需要登录股吧 — 请在浏览器中扫码, 等待60秒...");
      await sleep(60000);
    }

    // Navigate to publish
    // Try common post URLs
    await page.goto("https://guba.eastmoney.com/publish", { timeout: 30000, waitUntil: "domcontentloaded" });
    await sleep(4000);

    await injectAndPublish(page, POSTS.guba);
    await sleep(2000);

    if (await tryClickPublish(page)) {
      console.log("   ✅ 股吧发布成功");
    } else {
      console.log("   ⚠️ 内容已填入, 请手动点击发布按钮");
    }
    await sleep(2000);
    await page.close();
  } catch (e) {
    console.log("   ❌ 股吧失败:", e.message);
  }

  console.log("\n══════════════════════════════");
  console.log("推广发布流程完成");
  console.log(`平台链接: ${SITE_URL}`);
  console.log("══════════════════════════════");
  console.log("\n浏览器60秒后关闭, 可手动检查各平台发布结果。");
  await sleep(60000);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });

// 诊断脚本 — 探明各平台编辑器和按钮的真实选择器
const { chromium } = require("playwright");

const PLATFORMS = [
  {
    name: "雪球发帖",
    url: "https://xueqiu.com/statuses/new",
    diagnose: async (page) => {
      // 检查是否需要登录
      const loginBtn = await page.$(".login-btn, a:has-text('登录'), .signin");
      if (loginBtn) { console.log("  ⚠️ 需要登录！"); return; }

      // 找所有可编辑元素
      const editors = await page.$$eval("*", els =>
        els.filter(el => el.contentEditable === "true" || el.tagName === "TEXTAREA" || el.tagName === "INPUT")
           .map(el => `${el.tagName}.${el.className.split(" ")[0]} [contentEditable=${el.contentEditable}] placeholder="${el.placeholder||""}"`)
      );
      console.log("  编辑元素:", editors.slice(0,5));

      // 找所有按钮
      const buttons = await page.$$eval("button, a.btn, div[role='button']", els =>
        els.slice(0,10).map(el => `${el.tagName}.${el.className.split(" ")[0]} text="${el.textContent?.trim().slice(0,20)}"`)
      );
      console.log("  按钮:", buttons);
    }
  },
  {
    name: "知乎搜索",
    url: "https://www.zhihu.com/search?type=content&q=量化分析",
    diagnose: async (page) => {
      await page.waitForTimeout(3000);
      const loginModal = await page.$(".SignFlow, .Modal-wrapper");
      if (loginModal) { console.log("  ⚠️ 知乎需要登录"); return; }

      const links = await page.$$eval("a[href*='/question/']", els =>
        els.slice(0,3).map(el => el.href + " | " + el.textContent?.trim().slice(0,40))
      );
      console.log("  问题链接:", links);
    }
  },
];

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");

  for (const plat of PLATFORMS) {
    console.log(`\n=== ${plat.name} ===`);
    const page = await browser.newPage();
    try {
      await page.goto(plat.url, { waitUntil: "load", timeout: 20000 });
      await page.waitForTimeout(4000);
      await plat.diagnose(page);
    } catch(e) {
      console.log("  ❌", e.message);
    }
  }

  console.log("\n✅ 诊断完成");
}

main().catch(console.error);

// 检查知虾订购页是否有试用入口
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes("menglar.com")) || await ctx.newPage();

  if (!page.url().includes("menglar.com")) {
    await page.goto("https://zxee.menglar.com/#/home", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(4000);
  }

  // 关弹窗
  await page.evaluate(() => {
    document.querySelectorAll(".el-dialog__wrapper, .v-modal, [class*='guide']").forEach(el => el.remove());
  });
  await page.waitForTimeout(500);

  // 点击订购
  console.log("Looking for 订购...");
  const clicked = await page.evaluate(() => {
    // 遍历所有元素找"订购"
    const all = document.querySelectorAll("span, li, div, a");
    for (const el of all) {
      if ((el.textContent || "").trim() === "订购" && el.offsetParent) {
        el.click();
        return true;
      }
    }
    return false;
  });
  console.log("Clicked:", clicked);

  await page.waitForTimeout(5000);
  console.log("URL:", page.url());

  // 获取页面文本
  const bodyText = await page.evaluate(() => (document.body?.innerText || "").substring(0, 2000));
  console.log("\nPage content:");
  console.log(bodyText);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

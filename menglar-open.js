// 在新标签页打开知虾
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  await page.goto("https://zxee.menglar.com/#/personal-center/user-info", {
    waitUntil: "domcontentloaded", timeout: 20000
  });
  await page.waitForTimeout(5000);

  // 关弹窗
  try {
    await page.evaluate(() => {
      document.querySelectorAll(".el-dialog__wrapper, .el-overlay, .v-modal, [class*='guide']").forEach(el => {
        el.style.display = "none"; el.remove();
      });
    });
  } catch (e) {}

  console.log("Done. URL:", page.url());
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });

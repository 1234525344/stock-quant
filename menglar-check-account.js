// 重新检查知虾账户状态
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes("menglar.com") && p.url().includes("user-info"));
  if (!page) page = ctx.pages().find(p => p.url().includes("menglar.com"));
  if (!page) page = await ctx.newPage();

  if (!page.url().includes("user-info")) {
    await page.goto("https://zxee.menglar.com/#/personal-center/user-info", {
      waitUntil: "domcontentloaded", timeout: 15000
    });
    await page.waitForTimeout(4000);
  }

  // 关弹窗
  try {
    await page.evaluate(() => {
      document.querySelectorAll(".el-dialog__wrapper, .el-overlay, .v-modal").forEach(el => {
        el.style.display = "none"; el.remove();
      });
    });
  } catch (e) {}
  await page.waitForTimeout(500);

  const status = await page.evaluate(() => {
    const memberInfo = localStorage.getItem("memberInfoEp") || "{}";
    const userInfoEp = localStorage.getItem("userInfoEp") || "{}";
    const bodyText = (document.body.innerText || "").substring(0, 2000);

    // Get all relevant localStorage
    const allKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || "";
      allKeys.push(k + ": " + v.substring(0, 150));
    }

    return { memberInfo, userInfoEp, bodyText, allKeys };
  });

  console.log("=== memberInfoEp ===");
  console.log(status.memberInfo.substring(0, 500));
  console.log("\n=== Body Text ===");
  console.log(status.bodyText);
  console.log("\n=== All localStorage ===");
  status.allKeys.forEach(k => console.log("  " + k));
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });

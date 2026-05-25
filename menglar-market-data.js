// 知虾企业版 — 获取 Shopee 越南 女士单肩包 市场数据 v4
// 策略：利用已有的知虾页面导航，拦截所有 API 返回
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const outDir = "D:/作业/shopee-data";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // 找到知虾页面或用 newPage
  let page = ctx.pages().find(p => p.url().includes("menglar.com") && p.url().includes("home"));
  if (!page) {
    page = ctx.pages().find(p => p.url().includes("menglar.com"));
  }
  if (!page) {
    page = await ctx.newPage();
  }

  console.log("Current page:", page.url());

  // === API 拦截 — 捕获所有数据 ===
  const apiLog = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("/api/")) return;
    try {
      const ct = resp.headers()["content-type"] || "";
      if (ct.includes("json") || ct.includes("text")) {
        const body = await resp.text().catch(() => "");
        if (body.length > 100) {
          try {
            const json = JSON.parse(body);
            apiLog.push({
              url: url.replace(/https?:\/\/[^/]+/, ""),
              status: resp.status(),
              data: json,
            });
          } catch {
            // non-JSON, skip
          }
        }
      }
    } catch (e) {}
  });

  // === 尝试导航到市场分析报告页 ===
  console.log("\nNavigating to market analysis report...");
  try {
    await page.goto("https://zxee.menglar.com/#/big-data-selection/market-analysis-report", {
      waitUntil: "domcontentloaded", timeout: 30000
    });
  } catch (e) {
    console.log("Navigation error (continuing):", e.message.substring(0, 100));
  }
  await page.waitForTimeout(8000);

  console.log("Page URL:", page.url());
  console.log("Page title:", await page.title().catch(() => "?"));

  // 关弹窗
  try {
    await page.evaluate(() => {
      const overlays = document.querySelectorAll(".el-dialog__wrapper, .el-overlay, .v-modal, [class*='guide-layer']");
      overlays.forEach(el => { el.style.display = "none"; el.remove(); });
    });
  } catch (e) {}
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(1000);

  // === 尝试切换站点到越南 ===
  console.log("\n--- Step 1: Switch site to Vietnam ---");
  try {
    // Try via navigation bar — look for site selector
    const siteSwitched = await page.evaluate(() => {
      // Try localStorage first
      try { localStorage.setItem("siteId", "7"); } catch (e) {}
      try { sessionStorage.setItem("siteId", "7"); } catch (e) {}
      try { sessionStorage.setItem("siteName", "越南"); } catch (e) {}

      // Look for site selector UI
      const allText = document.body.innerText || "";
      const hasVietnam = allText.includes("越南") || allText.includes("Vietnam");
      return { hasVietnam, url: location.href };
    });
    console.log("Site check:", JSON.stringify(siteSwitched));
  } catch (e) {
    console.log("Site switch error:", e.message.substring(0, 100));
  }

  // === 尝试选择类目 ===
  console.log("\n--- Step 2: Select category ---");
  try {
    // Find and click category selector
    const catInfo = await page.evaluate(() => {
      const selects = document.querySelectorAll(".el-select, .el-cascader, [class*='select'], [class*='cascader']");
      const inputs = document.querySelectorAll("input[placeholder*='类目'], input[placeholder*='品类'], input[placeholder*='分类'], input[readonly]");
      return {
        selects: selects.length,
        inputs: [...inputs].map(i => ({ placeholder: i.placeholder, value: i.value })),
        visibleText: (document.body.innerText || "").substring(0, 300),
      };
    });
    console.log("Category UI:", JSON.stringify(catInfo, null, 2));
  } catch (e) {
    console.log("Category error:", e.message.substring(0, 100));
  }

  // === 获取页面可见内容 ===
  console.log("\n--- Step 3: Dump page text ---");
  try {
    const bodyText = await page.evaluate(() => {
      // Get visible text, limit to important areas
      const main = document.querySelector(".el-main, main, [class*='content'], [class*='main']");
      return (main || document.body).innerText.substring(0, 3000);
    });
    console.log(bodyText);
  } catch (e) {
    console.log("Text dump error:", e.message.substring(0, 100));
  }

  // === 检查 API 日志 ===
  console.log(`\n--- API Responses captured: ${apiLog.length} ---`);
  const marketApis = [];
  const searchApis = [];
  const otherApis = [];

  apiLog.forEach(a => {
    const u = a.url;
    if (u.includes("report") || u.includes("market") || u.includes("analysis") || u.includes("overview") || u.includes("trend") || u.includes("sales")) {
      marketApis.push(a);
    } else if (u.includes("search") || u.includes("product") || u.includes("keyword") || u.includes("category") || u.includes("ranking")) {
      searchApis.push(a);
    } else {
      otherApis.push(a);
    }
  });

  // 打印重点 API
  const printApi = (label, list) => {
    console.log(`\n${label} (${list.length}):`);
    list.forEach((a, i) => {
      const str = JSON.stringify(a.data);
      console.log(`  [${i+1}] ${a.status} ${a.url}`);
      console.log(`      Preview: ${str.substring(0, 400)}`);
    });
  };

  printApi("Market APIs", marketApis);
  printApi("Search/Product APIs", searchApis);
  if (otherApis.length > 0 && otherApis.length <= 10) {
    printApi("Other APIs", otherApis);
  } else if (otherApis.length > 10) {
    console.log(`\nOther APIs (${otherApis.length}):`);
    otherApis.forEach(a => console.log(`  ${a.status} ${a.url}`));
  }

  // === 保存 ===
  const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  if (apiLog.length > 0) {
    // Save full log
    const jsonPath = path.join(outDir, `menglar-api-${ts}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(apiLog, null, 2), "utf8");
    console.log(`\nFull API log: ${jsonPath}`);

    // Save key data separately
    const keyData = marketApis.length > 0 ? marketApis : (searchApis.length > 0 ? searchApis : apiLog.slice(0, 5));
    const keyPath = path.join(outDir, `menglar-key-data-${ts}.json`);
    fs.writeFileSync(keyPath, JSON.stringify(keyData, null, 2), "utf8");
    console.log(`Key data: ${keyPath}`);
  } else {
    console.log("\n⚠️ No API data captured. The page may need manual interaction.");
    // Save screenshot of current state
    try {
      await page.screenshot({ path: path.join(outDir, "menglar-current-state.png") });
      console.log("Screenshot saved.");
    } catch (e) {}
  }

  console.log("\nDone.");
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });

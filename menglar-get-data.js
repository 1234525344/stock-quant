// 知虾 — 直接尝试获取越南女士单肩包数据 v5
// 从首页点击"超级榜单"入口，拦截API
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const outDir = "D:/作业/shopee-data";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let page = ctx.pages().find(p => p.url().includes("menglar.com") && p.url().includes("home"));
  if (!page) {
    page = ctx.pages().find(p => p.url().includes("menglar.com"));
  }
  if (!page) {
    page = await ctx.newPage();
    await page.goto("https://zxee.menglar.com/#/home", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(5000);
  }

  console.log("Page:", page.url());

  // === API 拦截 ===
  const apiLog = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("/api/")) return;
    try {
      const ct = resp.headers()["content-type"] || "";
      if (!ct.includes("json")) return;
      const body = await resp.text().catch(() => "");
      if (body.length < 100) return;
      try {
        const json = JSON.parse(body);
        const short = url.replace(/https?:\/\/[^/]+/, "");
        const label = short.includes("report") ? "RPT" : short.includes("search") ? "SRC" :
                      short.includes("category") ? "CAT" : short.includes("rank") ? "RNK" : "API";
        console.log(`\n📡 [${label}] ${short}  (${body.length} chars)`);
        console.log(`   ${body.substring(0, 500)}`);
        apiLog.push({ url: short, status: resp.status(), data: json, size: body.length });
      } catch {}
    } catch (e) {}
  });

  // 关弹窗
  try {
    await page.evaluate(() => {
      document.querySelectorAll(".el-dialog__wrapper, .el-overlay, .v-modal, [class*='guide']").forEach(el => {
        el.style.display = "none"; el.remove();
      });
    });
  } catch (e) {}
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(1000);

  // === 确保站点是越南 ===
  console.log("\n=== Setting site to Vietnam ===");
  await page.evaluate(() => {
    localStorage.setItem("siteId", "7");
  });

  // 刷新首页
  await page.goto("https://zxee.menglar.com/#/home", { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(5000);

  // 再次关弹窗
  try {
    await page.evaluate(() => {
      document.querySelectorAll(".el-dialog__wrapper, .el-overlay, .v-modal").forEach(el => {
        el.style.display = "none"; el.remove();
      });
    });
  } catch (e) {}
  await page.waitForTimeout(500);

  // === 获取首页数据面板 ===
  console.log("\n=== Home page text ===");
  const homeInfo = await page.evaluate(() => {
    const text = (document.body.innerText || "").substring(0, 2000);
    const siteId = localStorage.getItem("siteId");
    const memberInfo = localStorage.getItem("memberInfoEp") || "";
    return { text, siteId, memberInfo: memberInfo.substring(0, 200) };
  });
  console.log(homeInfo.text);
  console.log("\nsiteId:", homeInfo.siteId);
  console.log("memberInfo:", homeInfo.memberInfo);

  // === 尝试点击"市场分析"菜单 ===
  console.log("\n=== Try clicking 市场分析 ===");
  const marketClicked = await page.evaluate(() => {
    const all = document.querySelectorAll("span, li, div, a, .el-menu-item");
    for (const el of all) {
      if ((el.textContent || "").trim() === "市场分析" && el.offsetParent) {
        el.click();
        return true;
      }
    }
    return false;
  });
  console.log("市场分析 clicked:", marketClicked);
  await page.waitForTimeout(3000);

  // 获取当前页面
  console.log("URL after click:", page.url());
  const afterClick = await page.evaluate(() => (document.body.innerText || "").substring(0, 2000));
  console.log(afterClick);

  // === 如果有市场分析页面，尝试找子菜单 ===
  console.log("\n=== Looking for sub-menus ===");
  const subs = await page.evaluate(() => {
    return [...document.querySelectorAll(".el-menu-item, .el-submenu__title, [class*='menu'] span, [class*='nav'] span")]
      .filter(el => el.offsetParent && el.textContent.trim().length < 30)
      .map(el => el.textContent.trim())
      .slice(0, 20);
  });
  console.log("Sub-menus:", subs.join(" | "));

  // === 尝试点击"市场分析报告"子菜单 ===
  if (subs.some(s => s.includes("市场分析报告"))) {
    const reportClicked = await page.evaluate(() => {
      const all = document.querySelectorAll("li, div, span, a");
      for (const el of all) {
        if ((el.textContent || "").trim() === "市场分析报告" && el.offsetParent) {
          el.click();
          return true;
        }
      }
      return false;
    });
    console.log("市场分析报告 clicked:", reportClicked);
    await page.waitForTimeout(5000);
    console.log("URL:", page.url());
  }

  // === 保存 API 结果 ===
  const dataApis = apiLog.filter(a => a.size > 200);
  console.log(`\n=== API logged: ${apiLog.length} total, ${dataApis.length} with data >200 chars ===`);

  if (dataApis.length > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const jsonPath = path.join(outDir, `menglar-data-${ts}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(dataApis, null, 2), "utf8");
    console.log(`Saved: ${jsonPath}`);
  }
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });

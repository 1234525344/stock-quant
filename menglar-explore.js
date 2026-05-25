// 探索 知虾 可用功能和导航菜单
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const outDir = "D:/作业/shopee-data";

  let page = ctx.pages().find(p => p.url().includes("menglar.com"));
  if (!page) page = await ctx.newPage();

  const apiLog = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("/api/")) return;
    try {
      const ct = resp.headers()["content-type"] || "";
      if (ct.includes("json")) {
        const body = await resp.text().catch(() => "");
        if (body.length > 100) {
          try {
            const json = JSON.parse(body);
            const shortUrl = url.replace(/https?:\/\/[^/]+/, "");
            console.log(`\n📡 API: ${shortUrl}`);
            console.log(`   Status: ${resp.status()}, Length: ${body.length}`);
            console.log(`   Preview: ${body.substring(0, 500)}`);
            apiLog.push({ url: shortUrl, status: resp.status(), data: json });
          } catch {}
        }
      }
    } catch (e) {}
  });

  // 从首页获取导航菜单
  console.log("=== 探索知虾导航菜单 ===");
  await page.goto("https://zxee.menglar.com/#/home", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(5000);

  // 关弹窗
  try {
    await page.evaluate(() => {
      document.querySelectorAll(".el-dialog__wrapper, .el-overlay, .v-modal, [class*='guide']").forEach(el => {
        el.style.display = "none";
        el.remove();
      });
    });
  } catch (e) {}
  await page.waitForTimeout(500);

  const nav = await page.evaluate(() => {
    const menuItems = document.querySelectorAll(".el-menu-item, .el-submenu, .menu-item, [class*='nav'] a, [class*='sidebar'] a, [class*='menu'] li");
    const result = [];
    menuItems.forEach(el => {
      const text = (el.textContent || "").trim().replace(/\s+/g, " ");
      const href = el.getAttribute("href") || "";
      const cls = (el.className || "").substring(0, 60);
      if (text && text.length < 100) result.push({ text: text.substring(0, 80), href, cls });
    });

    // 也获取所有链接
    const allLinks = document.querySelectorAll("a[href^='#/']");
    const routes = [...new Set([...allLinks].map(a => a.getAttribute("href")))];

    // 获取页面可见文本
    const visibleText = (document.body.innerText || "").substring(0, 1000);

    return { menuItems: result.slice(0, 30), routes: routes.slice(0, 30), visibleText };
  });

  console.log("Menu items:");
  nav.menuItems.forEach(m => console.log(`  ${m.text} | ${m.href || m.cls}`));
  console.log("\nRoutes found:");
  nav.routes.forEach(r => console.log(`  ${r}`));
  console.log("\nVisible text (first 500 chars):");
  console.log(nav.visibleText.substring(0, 500));

  // === 尝试几个可能有数据的页面 ===
  const testRoutes = [
    "/#/big-data-selection/product-search",
    "/#/big-data-selection/category-analysis",
    "/#/big-data-selection/keyword-research",
    "/#/big-data-selection/shop-analysis",
    "/#/big-data-selection/product-ranking",
    "/#/big-data-selection/industry-trend",
    "/#/data-center/sale-data",
    "/#/product-monitor",
  ];

  console.log("\n=== 测试不同页面 ===");
  for (const route of testRoutes) {
    console.log(`\nTrying: ${route}`);
    try {
      await page.goto("https://zxee.menglar.com" + route, {
        waitUntil: "domcontentloaded", timeout: 15000
      });
    } catch (e) {
      console.log(`  Navigation failed: ${e.message.substring(0, 80)}`);
      continue;
    }
    await page.waitForTimeout(5000);

    const pageInfo = await page.evaluate(() => {
      const bodyText = (document.body.innerText || "").substring(0, 500);
      const hasData = !bodyText.includes("暂无数据") && !bodyText.includes("无数据") && bodyText.length > 50;
      return {
        url: location.href,
        hasData,
        text: bodyText.substring(0, 300),
      };
    });
    console.log(`  Has data: ${pageInfo.hasData}`);
    console.log(`  Text: ${pageInfo.text}`);

    if (pageInfo.hasData || apiLog.length > 0) {
      console.log("  ✅ 此页面有数据!");
    }
  }

  // 保存 API 日志
  if (apiLog.length > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    fs.writeFileSync(path.join(outDir, `menglar-explore-${ts}.json`), JSON.stringify(apiLog, null, 2), "utf8");
    console.log(`\nAPI log saved (${apiLog.length} entries)`);
  }
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });

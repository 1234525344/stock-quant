// 打开 Shopee 越南让用户手动浏览，然后用 CDP 提取数据
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  await page.goto("https://shopee.vn/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);

  console.log("URL:", page.url());
  console.log("Title:", await page.title());
  console.log("");
  console.log("Shopee 越南已打开，请在 Edge 中操作：");
  console.log("1. 搜索: tui deo cheo nu");
  console.log("2. 排序选 Ban chay (热销)");
  console.log("3. 往下多翻几页，加载尽可能多的商品");
  console.log("4. 完成后说一声");
}

main().catch(e => { console.error(e.message); process.exit(1); });

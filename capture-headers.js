// 拦截真实网络请求，查看认证 header
const { chromium } = require("playwright");
const fs = require("fs");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes("market-analysis/index"));
  if (!page) { console.log("no page"); return; }

  // 关弹窗
  await page.evaluate(() => {
    document.querySelectorAll(".el-dialog__wrapper, .el-overlay, .v-modal, [class*='guide']").forEach(el => el.remove());
  });

  // CDP 拦截
  const cdp = await page.context().newCDPSession(page);
  const requests = [];

  cdp.on("Network.requestWillBeSent", (params) => {
    const url = params.request.url;
    if (url.includes("/api/")) {
      requests.push({
        url: url.replace(/https?:\/\/[^/]+/, "").substring(0, 150),
        method: params.request.method,
        headers: params.request.headers,
        postData: params.request.postData,
      });
    }
  });
  await cdp.send("Network.enable");

  // 在搜索框中输入关键词触发搜索建议（这通常会调 API）
  console.log("触发输入事件...");
  await page.evaluate(() => {
    const inputs = document.querySelectorAll("input");
    for (const input of inputs) {
      if (input.placeholder && input.placeholder.includes("商品ID")) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "12345");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
    }
  });
  await page.waitForTimeout(2000);

  // 点击提交
  const btn = page.locator("button:has-text('提交'), button:has-text('查询'), button:has-text('搜索')").first();
  if (await btn.count() > 0) {
    await btn.click();
    console.log("Clicked submit");
  }
  await page.waitForTimeout(5000);

  // 输出
  console.log("\n拦截到 " + requests.length + " 个 API 请求:");
  requests.forEach(r => {
    console.log("\n  " + r.method + " " + r.url);
    const authH = {};
    for (const [k, v] of Object.entries(r.headers)) {
      if (/auth|token|admin|x-|cookie/i.test(k)) {
        authH[k] = typeof v === "string" ? v.substring(0, 80) : v;
      }
    }
    console.log("    Auth: " + JSON.stringify(authH));
    if (r.postData) console.log("    Body: " + r.postData.substring(0, 200));
  });

  const outDir = "D:/作业/shopee-data";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outDir + "/network-capture.json", JSON.stringify(requests, null, 2));
  console.log("\n📁 " + outDir + "/network-capture.json");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

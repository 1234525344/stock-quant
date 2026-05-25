// 从 menglar.com 获取 Shopee 越南站点女士单肩包销量数据
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];

  // 检查是否已有 menglar 的页面打开
  const existingPages = ctx.pages();
  let page = existingPages.find(p => p.url().includes("menglar.com"));

  if (!page) {
    console.log("打开 menglar.com...");
    page = await ctx.newPage();
    await page.goto("https://zxee.menglar.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
  } else {
    console.log("复用已有 menglar 页面:", page.url());
  }

  // 提取 localStorage 中的 token
  const tokenData = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      let displayVal = val;
      if (val && val.length > 200) displayVal = val.substring(0, 200) + "...";
      keys.push({ key, value: displayVal });
    }

    const sessionKeys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const val = sessionStorage.getItem(key);
      let displayVal = val;
      if (val && val.length > 200) displayVal = val.substring(0, 200) + "...";
      sessionKeys.push({ key, value: displayVal });
    }

    return {
      url: window.location.href,
      localStorage: keys,
      sessionStorage: sessionKeys,
      cookies: document.cookie
    };
  });

  console.log("\n=== localStorage ===");
  tokenData.localStorage.forEach(t => console.log(`  ${t.key}: ${t.value}`));
  console.log("\n=== sessionStorage ===");
  tokenData.sessionStorage.forEach(t => console.log(`  ${t.key}: ${t.value}`));
  console.log("\n=== cookies ===");
  console.log("  " + (tokenData.cookies || "(无)"));

  // 尝试找 token
  const token = await page.evaluate(() => {
    // 常见的 token 存储 key
    const candidates = ["token", "access_token", "adminToken", "auth", "authorization", "user", "userInfo"];
    for (const key of candidates) {
      const val = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (val) {
        try {
          const parsed = JSON.parse(val);
          if (parsed.token || parsed.access_token || parsed.accessToken) {
            return parsed.token || parsed.access_token || parsed.accessToken;
          }
        } catch (e) {}
        return val;
      }
    }
    // 遍历所有 localStorage 找 jwt 格式
    for (let i = 0; i < localStorage.length; i++) {
      const val = localStorage.getItem(localStorage.key(i));
      if (val && /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(val.trim())) {
        return val.trim();
      }
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const val = sessionStorage.getItem(sessionStorage.key(i));
      if (val && /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(val.trim())) {
        return val.trim();
      }
    }
    return null;
  });

  if (token) {
    console.log("\n✅ 找到 token:", token.substring(0, 50) + "...");

    // 直接用浏览器发 API 请求
    const apiResult = await page.evaluate(async (t) => {
      const headers = { "Authorization": "Bearer " + t, "Content-Type": "application/json" };
      try {
        // 尝试不同的 API 端点
        const endpoints = [
          "/api/shopee-report-service/pro/market-analysis",
          "/api/shopee-report-service/pro/category-sales",
          "/api/shopee-report-service/pro/sales-trend",
          "/api/shopee-report-service/pro/product-analysis",
          "/api/shopee-report-service/pub/market-analysis",
          "/api/shopee-report-service/pub/category-sales",
        ];
        const results = {};
        for (const ep of endpoints) {
          const res = await fetch(ep, { headers });
          const text = await res.text();
          results[ep] = { status: res.status, body: text.substring(0, 300) };
        }
        return results;
      } catch (e) {
        return { error: e.message };
      }
    }, token);

    console.log("\n=== API 测试结果 ===");
    for (const [ep, r] of Object.entries(apiResult)) {
      console.log(`  ${ep} [${r.status}]: ${r.body}`);
    }
  } else {
    console.log("\n⚠️ 未找到 token，尝试导航到市场分析页面...");

    // 导航到市场分析页面
    await page.goto("https://zxee.menglar.com/#/market-analysis/index", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(5000);

    // 再次检查
    const token2 = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const val = localStorage.getItem(localStorage.key(i));
        if (val && /^eyJ/.test(val.trim())) return val.trim();
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const val = sessionStorage.getItem(sessionStorage.key(i));
        if (val && /^eyJ/.test(val.trim())) return val.trim();
      }
      return null;
    });

    if (token2) {
      console.log("✅ 第二次尝试找到 token:", token2.substring(0, 50) + "...");
    } else {
      console.log("❌ 未登录或 token 存储在其他位置");
      console.log("请在 Edge 中手动登录 https://zxee.menglar.com 后重新运行此脚本");
    }
  }

  console.log("\n完成。请查看 Edge 浏览器中的页面状态。");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

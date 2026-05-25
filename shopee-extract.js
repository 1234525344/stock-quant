// 从 Edge 已加载的 Shopee 搜索页提取数据
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const outDir = "D:/作业/shopee-data";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // 找到 shopee 页面或新建
  let page = ctx.pages().find(p => p.url().includes("shopee.vn/search"));
  if (!page) {
    page = await ctx.newPage();
    console.log("Opening shopee.vn search...");
    await page.goto("https://shopee.vn/search?keyword=t%C3%BAi%20%C4%91eo%20ch%C3%A9o%20n%E1%BB%AF&sortBy=sold", {
      waitUntil: "domcontentloaded", timeout: 30000
    });
    await page.waitForTimeout(10000);
  }

  console.log("URL:", page.url());
  console.log("Title:", await page.title());

  // 关弹窗
  try {
    const btns = await page.$$("button");
    for (const btn of btns) {
      const t = (await btn.textContent()) || "";
      if (/OK|Dong y/i.test(t.trim())) {
        await btn.click().catch(() => {});
      }
    }
  } catch (e) {}

  // 滚动加载
  console.log("Scrolling to load...");
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // 截图
  const ssPath = path.join(outDir, "search-result.png");
  await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {});
  console.log("Screenshot:", ssPath);

  // DOM 提取 - 全面选择器
  console.log("\nExtracting from DOM...");
  const products = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    // 找到所有产品链接
    const links = document.querySelectorAll("a[href*='-i.']");
    links.forEach(link => {
      const href = link.href;
      const m = href.match(/\/(\d+)\.(\d+)$/) || href.match(/i\.(\d+)\.(\d+)/);
      if (!m) return;
      const shopId = m[1], itemId = m[2];
      if (seen.has(itemId)) return;
      seen.add(itemId);

      // 往上找卡片容器
      let card = link;
      for (let i = 0; i < 5; i++) {
        card = card.parentElement;
        if (!card) break;
        const cls = card.className || "";
        if (cls.includes("col") || cls.includes("item") || cls.includes("card") || cls.includes("search")) break;
      }

      const txt = (card?.textContent || link.textContent || "").trim();
      const img = card?.querySelector("img");

      // 各种正则提取
      let price = 0;
      let priceMatch = txt.match(/₫\s*(\d{1,3}(?:\.\d{3})*)/);
      if (!priceMatch) priceMatch = txt.match(/(\d{1,3}(?:\.\d{3})*)\s*₫/);
      if (priceMatch) price = parseInt(priceMatch[1].replace(/\./g, "")) / 1000;

      let sold = 0;
      const soldMatch = txt.match(/(?:Da ban|Sold)\s*([\d,.]+[kKmM]?)/i);
      if (soldMatch) {
        let v = soldMatch[1].replace(/,/g, "");
        if (/[kK]/.test(v)) sold = Math.round(parseFloat(v) * 1000);
        else if (/[mM]/.test(v)) sold = Math.round(parseFloat(v) * 1000000);
        else sold = parseInt(v.replace(/\./g, "")) || 0;
      }

      let rating = 0;
      const starMatch = txt.match(/(\d+\.?\d*)\s*★|★\s*(\d+\.?\d*)/);
      if (starMatch) rating = parseFloat(starMatch[1] || starMatch[2]);

      const name = (img?.alt || "").trim() || link.textContent?.trim() || "";

      results.push({
        name: name.substring(0, 120),
        price,
        sold,
        rating,
        itemId,
        shopId,
        image: img?.src?.split("/").pop() || "",
      });
    });

    return results;
  });

  console.log("Products found:", products.length);

  if (products.length === 0) {
    // 检查是否被反爬
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500));
    console.log("Page text:", bodyText);

    if (bodyText.includes("verify") || bodyText.includes("robot")) {
      console.log("\nBlocked by anti-bot. Checking page URL...");
      console.log("Current URL:", page.url());
    }
    return;
  }

  // 统计
  const prices = products.map(p => p.price).filter(p => p > 0);
  const solds = products.map(p => p.sold).filter(p => p > 0);
  const totalSold = solds.reduce((a, b) => a + b, 0);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const sortedPrices = [...prices].sort((a, b) => a - b);

  console.log("\n" + "=".repeat(60));
  console.log("Shopee Vietnam - Women's Shoulder Bags Market Data");
  console.log("=".repeat(60));
  console.log("Products:   " + products.length);
  console.log("Avg price:  " + Math.round(avgPrice).toLocaleString() + "K VND (approx " + (avgPrice / 3.3).toFixed(2) + " CNY)");
  console.log("Median:     " + Math.round(sortedPrices[Math.floor(sortedPrices.length / 2)]).toLocaleString() + "K VND");
  console.log("Range:      " + Math.round(Math.min(...prices)) + "K - " + Math.round(Math.max(...prices)) + "K VND");
  console.log("Total sold: " + totalSold.toLocaleString());
  if (solds.length > 0) console.log("Avg sold:   " + Math.round(solds.reduce((a, b) => a + b, 0) / solds.length).toLocaleString());

  // Price distribution
  const ranges = [[0, 30], [30, 50], [50, 80], [80, 120], [120, 180], [180, 300], [300, 500], [500, 99999]];
  console.log("\nPrice Distribution (KVND):");
  ranges.forEach(([lo, hi]) => {
    const n = products.filter(p => p.price >= lo && p.price < hi).length;
    const pct = ((n / products.length) * 100).toFixed(1);
    const bar = "█".repeat(Math.max(1, Math.round(n / products.length * 40)));
    console.log("  " + lo + "-" + (hi === 99999 ? "+" : hi) + "K: " + n + " (" + pct + "%) " + bar);
  });

  // TOP 30
  console.log("\nTop 30 by Sales:");
  products.sort((a, b) => b.sold - a.sold);
  products.slice(0, 30).forEach((p, i) => {
    console.log("  " + String(i + 1).padStart(2) + ". " + String(p.sold).padStart(10) + " sold | " + String(Math.round(p.price)).padStart(7) + "K VND | " + (p.name || "").substring(0, 70));
  });

  // Save
  const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const jsonPath = path.join(outDir, "shopee-vn-bags-" + ts + ".json");
  fs.writeFileSync(jsonPath, JSON.stringify({
    keyword: "tui deo cheo nu",
    scrapedAt: new Date().toISOString(),
    stats: {
      count: products.length,
      avgPriceKVND: Math.round(avgPrice),
      medPriceKVND: Math.round(sortedPrices[Math.floor(sortedPrices.length / 2)]),
      totalSold,
      priceRange: [Math.round(Math.min(...prices)), Math.round(Math.max(...prices))],
    },
    products: products,
  }, null, 2), "utf8");
  console.log("\nJSON: " + jsonPath);

  // CSV
  const csvPath = jsonPath.replace(".json", ".csv");
  const csvLines = ["Rank,Product Name,Price(KVND),Approx CNY,Sold,Rating,Item ID,Shop ID"];
  products.forEach((p, i) => {
    csvLines.push([
      i + 1,
      '"' + (p.name || "").replace(/"/g, '""') + '"',
      Math.round(p.price),
      (p.price / 3.3).toFixed(2),
      p.sold,
      p.rating,
      p.itemId,
      p.shopId,
    ].join(","));
  });
  fs.writeFileSync(csvPath, "﻿" + csvLines.join("\n"), "utf8");
  console.log("CSV: " + csvPath);

  console.log("\nDone!");
}

main().catch(e => { console.error(e.message); process.exit(1); });

// Shopee Vietnam scraper — stealth mode
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

const fs = require("fs");
const path = require("path");

async function main() {
  const outDir = "D:/作业/shopee-data";
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: "vi-VN",
  });

  const page = await context.newPage();

  const keyword = "túi đeo chéo nữ";

  // 拦截 search_items API
  let searchData = null;
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("/api/v4/search/search_items")) {
      try {
        const json = await resp.json();
        console.log(`📡 API response: error=${json.error}, keys=${Object.keys(json).join(",")}`);
        if (!json.error) {
          searchData = json;
          // 保存原始数据用于调试
          fs.writeFileSync(path.join(outDir, "api-raw.json"), JSON.stringify(json, null, 2));
        }
      } catch (e) {
        console.log(`   ⚠️ parse error:`, e.message.substring(0, 80));
      }
    }
  });

  console.log("🌐 打开 Shopee 越南...");
  await page.goto("https://shopee.vn/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);

  // 点击搜索框并输入
  console.log(`🔍 搜索: "${keyword}"`);
  // 直接在 URL 导航到搜索页（更可靠）
  await page.goto(
    `https://shopee.vn/search?keyword=${encodeURIComponent(keyword)}&sortBy=sold`,
    { waitUntil: "domcontentloaded", timeout: 45000 }
  );

  console.log("⏳ 等待搜索结果渲染...");
  await page.waitForTimeout(12000);

  // 滚动加载
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(3000);

  // 截图
  const ssPath = path.join(outDir, "search-result.png");
  await page.screenshot({ path: ssPath, fullPage: false });
  console.log(`📸 ${ssPath}`);

  // 解析
  let allItems = [];
  if (searchData && !searchData.error) {
    let items = [];
    const d = searchData;

    // 全面解析
    if (Array.isArray(d.items)) items = d.items;
    else if (d.data?.sections) {
      for (const sec of d.data.sections) {
        if (sec?.data?.item) items.push(...sec.data.item);
        if (sec?.data?.items) items.push(...sec.data.items);
      }
    } else if (d.data?.items) items = d.data.items;
    else if (d.items) items = d.items;

    console.log(`📡 API 解析: ${items.length} 个商品`);

    items.forEach(item => {
      allItems.push({
        name: item.name || "",
        price: (item.price || item.price_before_discount || item.price_min || 0) / 100000,
        priceMax: (item.price_max || item.price || 0) / 100000,
        sold: item.sold || item.historical_sold || item.sales || 0,
        rating: item.item_rating?.rating_star || 0,
        reviewCount: item.item_rating?.rating_count?.[0] || 0,
        shopName: item.shop_name || "",
        shopLocation: item.shop_location || "",
        brand: item.brand || "",
        image: item.image || "",
        itemId: item.itemid || item.item_id || 0,
        shopId: item.shopid || item.shop_id || 0,
        isMall: !!(item.is_shopee_mall || item.is_official_shop),
        isPreferred: !!(item.is_preferred_plus_seller || item.shop_is_preferred),
        discount: item.raw_discount || item.discount || 0,
      });
    });
  }

  if (allItems.length === 0) {
    console.log("⚠️ API 为空，尝试 DOM 提取...");
    const domItems = await page.evaluate(() => {
      const results = [];
      const links = [...document.querySelectorAll('a[href*="-i."]')];
      const seen = new Set();

      links.forEach(link => {
        const m = link.href.match(/i\.(\d+)\.(\d+)/);
        if (!m || seen.has(m[2])) return;
        seen.add(m[2]);

        const card = link.closest('div[class*="col"], div[class*="item"], div[class*="card"]') || link;
        const txt = (card.textContent || "").trim();

        // 价格
        const priceMatch = txt.match(/₫\s*(\d{1,3}(?:\.\d{3})*)/);
        // 销量
        const soldMatch = txt.match(/(?:Đã bán|Sold)\s*([\d,.]+[kKmM]?)/i);
        let sold = 0;
        if (soldMatch) {
          let v = soldMatch[1].replace(/,/g, "");
          if (/[kK]/.test(v)) sold = Math.round(parseFloat(v) * 1000);
          else if (/[mM]/.test(v)) sold = Math.round(parseFloat(v) * 1000000);
          else sold = parseInt(v.replace(/\./g, "")) || 0;
        }
        // 评分
        const starMatch = txt.match(/(\d+\.?\d*)\s*★|★\s*(\d+\.?\d*)/);
        const rating = starMatch ? parseFloat(starMatch[1] || starMatch[2]) : 0;

        results.push({
          name: (link.querySelector("img")?.alt || "").substring(0, 100),
          price: priceMatch ? parseInt(priceMatch[1].replace(/\./g, "")) / 1000 : 0,
          sold, rating,
          reviewCount: 0, shopName: "", shopLocation: "", brand: "",
          image: (link.querySelector("img")?.src || "").split("/").pop(),
          itemId: m[2], shopId: m[1],
          isMall: false, isPreferred: false, discount: 0,
        });
      });
      return results;
    });

    console.log(`   DOM 提取: ${domItems.length} 个`);
    allItems = domItems;
  }

  // 去重 & 排序
  const seen = new Set();
  allItems = allItems.filter(item => {
    const id = item.itemId || item.name;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  allItems.sort((a, b) => b.sold - a.sold);

  if (allItems.length === 0) {
    console.log("❌ 无数据");
    await browser.close();
    return;
  }

  const prices = allItems.map(p => p.price).filter(p => p > 0);
  const solds = allItems.map(p => p.sold).filter(p => p > 0);
  const totalSold = solds.reduce((a,b)=>a+b, 0);
  const avgPrice = prices.reduce((a,b)=>a+b,0) / prices.length;
  const sp = [...prices].sort((a,b)=>a-b);
  const medPrice = sp[Math.floor(sp.length/2)];

  console.log(`\n${"═".repeat(65)}`);
  console.log(`📊 女士单肩包 (túi đeo chéo nữ) — Shopee 越南`);
  console.log(`${"═".repeat(65)}`);
  console.log(`   商品: ${allItems.length}  均价: ₫${Math.round(avgPrice).toLocaleString()}K (≈¥${(avgPrice/3.3).toFixed(2)})`);
  console.log(`   中位价: ₫${Math.round(medPrice).toLocaleString()}K  区间: ₫${Math.round(Math.min(...prices))}K-₫${Math.round(Math.max(...prices))}K`);
  console.log(`   累计销量: ${totalSold.toLocaleString()}  均销: ${Math.round(solds.reduce((a,b)=>a+b,0)/solds.length).toLocaleString()}`);
  console.log(`   Mall: ${allItems.filter(p=>p.isMall).length}  Preferred: ${allItems.filter(p=>p.isPreferred).length}`);

  // 价格分布
  const ranges = [[0,30],[30,50],[50,80],[80,120],[120,180],[180,300],[300,500],[500,99999]];
  console.log(`\n💰 价格分布:`);
  ranges.forEach(([lo,hi]) => {
    const n = allItems.filter(p => p.price >= lo && p.price < hi).length;
    const pct = ((n/allItems.length)*100).toFixed(1);
    const bar = "█".repeat(Math.max(1, Math.round(n/allItems.length*40)));
    console.log(`   ₫${lo}-${hi===99999?"+":hi}K  ¥${(lo/3.3).toFixed(0)}-${hi===99999?"+":(hi/3.3).toFixed(0)}  ${String(n).padStart(3)} (${String(pct).padStart(5)}%) ${bar}`);
  });

  console.log(`\n🔥 热销 TOP 30:`);
  allItems.slice(0, 30).forEach((p, i) => {
    const s = (p.sold||0).toLocaleString();
    const pr = Math.round(p.price||0);
    console.log(`   ${String(i+1).padStart(2)}. ${s.padStart(10)}件 | ₫${String(pr).padStart(7)}K | ★${String(p.rating||"-").padStart(3)}(${String(p.reviewCount||0).padStart(4)}) | ${(p.shopName||"").substring(0,24).padEnd(24)} ${p.isMall?"M":""}${p.isPreferred?"P":""}`);
    console.log(`      ${(p.name||"").substring(0, 95)}`);
  });

  // 品牌
  const brands = {};
  allItems.forEach(p => {
    const b = (p.brand||"").trim() || "(无品牌)";
    brands[b] = (brands[b]||0) + 1;
  });
  const topBrands = Object.entries(brands).sort((a,b)=>b[1]-a[1]).slice(0, 15);
  if (topBrands.length > 0) {
    console.log(`\n🏷️ 品牌 TOP 15:`);
    topBrands.forEach(([b,c]) => console.log(`   ${b.padEnd(30)} ${c}个`));
  }

  // 保存
  const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const report = {
    keyword, scrapedAt: new Date().toISOString(),
    stats: {
      count: allItems.length, avgPriceKVND: Math.round(avgPrice), medPriceKVND: Math.round(medPrice),
      minPrice: Math.round(Math.min(...prices)), maxPrice: Math.round(Math.max(...prices)),
      totalSold, avgSoldPerProduct: Math.round(solds.reduce((a,b)=>a+b,0)/solds.length),
    },
    priceDistribution: ranges.map(([lo,hi]) => ({
      rangeKVND: `${lo}-${hi===99999?"+":hi}`,
      count: allItems.filter(p => p.price >= lo && p.price < hi).length
    })),
    topBrands: topBrands.map(([n,c]) => ({ name:n, count:c })),
    products: allItems,
  };

  const jsonPath = path.join(outDir, `shopee-vn-shoulder-bags_${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n📁 JSON: ${jsonPath}`);

  const csvPath = path.join(outDir, `shopee-vn-shoulder-bags_${ts}.csv`);
  const BOM = "﻿";
  const csvH = ["排名","商品名","价格KVND","约¥","销量","评分","评价数","店铺","位置","品牌","Mall","Preferred","折扣%","商品ID"];
  const csvLines = [csvH.join(",")];
  allItems.forEach((p,i) => {
    csvLines.push([
      i+1, `"${(p.name||"").replace(/"/g,'""')}"`, Math.round(p.price),
      (p.price/3.3).toFixed(2), p.sold, p.rating, p.reviewCount,
      `"${p.shopName}"`, p.shopLocation, `"${p.brand}"`,
      p.isMall?"是":"否", p.isPreferred?"是":"否", p.discount, p.itemId,
    ].join(","));
  });
  fs.writeFileSync(csvPath, BOM + csvLines.join("\n"), "utf8");
  console.log(`📁 CSV: ${csvPath}`);

  await browser.close();
  console.log("\n✅ 完成");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

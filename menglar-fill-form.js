// 填写知虾企业信息表单获取试用 v2
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  await page.goto("https://zxee.menglar.com/#/home", { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(5000);

  // 这次不删弹窗！先看弹窗里有什么
  const dialogs = await page.evaluate(() => {
    const ds = document.querySelectorAll(".el-dialog__wrapper, .el-dialog");
    return [...ds].map(d => ({
      visible: !!d.offsetParent,
      text: (d.textContent || "").trim().substring(0, 500),
      inputs: [...d.querySelectorAll("input")].map(el => ({
        placeholder: el.placeholder || "",
        type: el.type || "",
        visible: !!el.offsetParent,
      })),
      buttons: [...d.querySelectorAll("button")].map(b => (b.textContent || "").trim()),
    }));
  });

  console.log("Dialogs found:", dialogs.length);
  dialogs.forEach((d, i) => {
    console.log(`\nDialog ${i}: visible=${d.visible}`);
    console.log("  Text:", d.text);
    console.log("  Inputs:", JSON.stringify(d.inputs));
    console.log("  Buttons:", d.buttons);
  });

  // 找到并填写表单
  const filled = await page.evaluate(() => {
    const results = {};
    // 在所有可见元素中找 input
    const allInputs = document.querySelectorAll("input[type='text']:not([readonly]), input:not([type]):not([type='checkbox']):not([type='password'])");
    for (const input of allInputs) {
      if (!input.offsetParent) continue;
      const ph = input.placeholder || "";
      if (ph.includes("公司名称") && !ph.includes("品牌")) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeSetter.call(input, "跨境选品工作室");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        results.companyName = true;
      } else if (ph.includes("品牌")) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeSetter.call(input, "FashionBag");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        results.brand = true;
      } else if (ph.includes("地址")) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeSetter.call(input, "广东省广州市白云区");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        results.address = true;
      }
    }
    return results;
  });

  console.log("\nFilled results:", JSON.stringify(filled));

  // 找类目和站点的级联选择器
  await page.waitForTimeout(1000);

  // 找提交按钮
  const submitBtn = page.locator("button:has-text('提交')").first();
  if (await submitBtn.count() > 0) {
    await submitBtn.click();
    console.log("✅ Submitted");
  } else {
    console.log("⚠️ No submit button found");
  }
  await page.waitForTimeout(4000);

  // 检查状态
  const status = await page.evaluate(() => ({
    bodyText: (document.body?.innerText || "").substring(0, 1200),
    memberInfoEp: localStorage.getItem("memberInfoEp") || "empty",
  }));
  console.log("\nAfter submit:");
  console.log(status.bodyText);
  console.log("memberInfoEp:", status.memberInfoEp);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

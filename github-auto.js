// 通过 Edge CDP 自动创建 GitHub 仓库并推送
// 前提: Edge 已启动 (--remote-debugging-port=9222) 且已登录 GitHub

const { chromium } = require("playwright");
const { execSync } = require("child_process");

async function main() {
  console.log("🔗 连接 Edge...");
  const browser = await chromium.connectOverCDP("http://localhost:9222");

  // 查找已打开的 GitHub 页面或新建
  const contexts = browser.contexts();
  const ctx = contexts[0];

  // 检查 GitHub 登录状态
  console.log("🔍 检查 GitHub 登录状态...");
  const testPage = await ctx.newPage();
  await testPage.goto("https://github.com", { waitUntil: "load", timeout: 15000 });
  await testPage.waitForTimeout(3000);

  const loggedIn = await testPage.evaluate(() => {
    // 检查页面是否显示已登录
    const signInBtn = document.querySelector('a[href="/login"]');
    const avatar = document.querySelector('meta[name="user-login"]');
    const feedContainer = document.querySelector('[data-scope="feed"]');
    return !signInBtn || !!avatar || !!feedContainer;
  });

  if (!loggedIn) {
    console.log("❌ 未登录 GitHub，请在浏览器登录后重试");
    console.log("   https://github.com/login");
    await testPage.close();
    await browser.close();
    process.exit(1);
  }

  console.log("✅ GitHub 已登录");

  // 获取用户名
  const username = await testPage.evaluate(() => {
    const meta = document.querySelector('meta[name="user-login"]');
    return meta ? meta.content : null;
  });
  console.log("   👤 " + (username || "未知"));

  await testPage.close();

  // 检查是否已有 SSH key 关联
  console.log("🔑 检查 SSH Key...");
  const sshPage = await ctx.newPage();
  await sshPage.goto("https://github.com/settings/keys", { waitUntil: "load", timeout: 15000 });
  await sshPage.waitForTimeout(3000);

  const hasSSH = await sshPage.evaluate(() => {
    const keys = document.querySelectorAll('[data-test-selector="public-key"]');
    return keys.length > 0;
  });

  if (!hasSSH) {
    console.log("   添加 SSH Key...");
    // 读取公钥
    const fs = require("fs");
    const os = require("os");
    const pubKey = fs.readFileSync(os.homedir() + "/.ssh/id_ed25519.pub", "utf8").trim();

    // 导航到添加 SSH key 页面
    await sshPage.goto("https://github.com/settings/ssh/new", { waitUntil: "load", timeout: 15000 });
    await sshPage.waitForTimeout(2000);

    // 填入 key
    await sshPage.evaluate((key) => {
      const titleInput = document.querySelector('#ssh_key_title, input[name="key[title]"]');
      const keyTextarea = document.querySelector('#ssh_key_key, textarea[name="key[key]"]');
      if (titleInput) titleInput.value = "stock-quant-auto";
      if (keyTextarea) keyTextarea.value = key;

      // 触发表单验证
      if (titleInput) titleInput.dispatchEvent(new Event("input", {bubbles: true}));
      if (keyTextarea) keyTextarea.dispatchEvent(new Event("input", {bubbles: true}));
    }, pubKey);

    await sshPage.waitForTimeout(1000);

    // 点击添加按钮
    const added = await sshPage.evaluate(() => {
      const btns = [...document.querySelectorAll("button")]
        .filter(b => /Add SSH key|添加/.test(b.textContent));
      if (btns[0]) { btns[0].click(); return true; }
      return false;
    });

    if (added) {
      console.log("   ✅ SSH Key 已添加");
      await sshPage.waitForTimeout(3000);
    }
  } else {
    console.log("   ✅ SSH Key 已存在");
  }

  await sshPage.close();

  // 创建仓库
  console.log("📦 创建 GitHub 仓库...");
  const createPage = await ctx.newPage();
  await createPage.goto("https://github.com/new", { waitUntil: "load", timeout: 15000 });
  await createPage.waitForTimeout(3000);

  // 填入仓库信息
  await createPage.evaluate(() => {
    const nameInput = document.querySelector('#repository_name, input[name="repository[name]"]');
    const descInput = document.querySelector('#repository_description, input[name="repository[description]"]');

    if (nameInput) {
      nameInput.value = "stock-quant";
      nameInput.dispatchEvent(new Event("input", {bubbles: true}));
      nameInput.dispatchEvent(new Event("change", {bubbles: true}));
    }
    if (descInput) {
      descInput.value = "量化交易平台 — 多因子Alpha · 组合优化 · 风险归因 | 全自动多平台内容发布";
      descInput.dispatchEvent(new Event("input", {bubbles: true}));
    }
  });

  await createPage.waitForTimeout(1000);

  // 确保选择 Public
  await createPage.evaluate(() => {
    const publicRadio = document.querySelector('#repository_visibility_public, input[value="public"]');
    if (publicRadio && !publicRadio.checked) publicRadio.click();
  });

  await createPage.waitForTimeout(500);

  // 点击创建
  const created = await createPage.evaluate(() => {
    const btns = [...document.querySelectorAll("button")]
      .filter(b => /Create repository|创建/.test(b.textContent));
    if (btns[0]) {
      btns[0].click();
      return true;
    }
    return false;
  });

  if (created) {
    console.log("   ✅ 仓库已创建");
    await createPage.waitForTimeout(5000);
  }

  await createPage.close();

  // 推送代码
  console.log("📤 推送代码...");
  try {
    const remoteUrl = `git@github.com:${username}/stock-quant.git`;
    execSync(`cd "C:/Users/lb/stock-quant" && git remote remove origin 2>nul`, { stdio: "ignore" });
    execSync(`cd "C:/Users/lb/stock-quant" && git remote add origin "${remoteUrl}"`, { encoding: "utf8" });
    console.log(`   Remote: ${remoteUrl}`);

    execSync(`cd "C:/Users/lb/stock-quant" && git push -u origin master`, {
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30" }
    });
    console.log("   ✅ 推送成功");
  } catch(e) {
    console.log("   ⚠️ Push 出错: " + e.message.substring(0, 200));
    console.log("   尝试备用方式...");
  }

  console.log("\n════════════════════════════════════════");
  console.log("  GitHub 仓库: https://github.com/" + (username || "YOUR_USERNAME") + "/stock-quant");
  console.log("════════════════════════════════════════");
  console.log("\n接下来去 Render.com 部署:");
  console.log("  1. https://render.com → Sign In with GitHub");
  console.log("  2. New → Blueprint → 选择 stock-quant 仓库");
  console.log("  3. 设置环境变量 DEEPSEEK_API_KEY");
  console.log("  4. 点击 Apply → 等待部署完成");
  console.log("  5. 永久地址: https://stock-quant.onrender.com");
}

main().catch(e => {
  console.error("❌", e.message);
  process.exit(1);
});

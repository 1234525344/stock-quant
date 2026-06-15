// 每日选股结果自动发帖 — 雪球 + 知乎 + 东方财富
// 用法：
//   1. 先启动 server:  node server.js
//   2. 打开 Edge:  start msedge --remote-debugging-port=9222
//   3. 在 Edge 中登录雪球/知乎/东财
//   4. 运行本脚本: node daily-picks.js
//   5. （可选）定时运行: 每天收盘后自动发

const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const API = "http://localhost:3456";
const TMP = path.join(__dirname, ".clip-temp.txt");

// ============ 工具函数 ============

function copyToClipboard(text) {
  fs.writeFileSync(TMP, text, "utf8");
  execSync(`cmd.exe /c "type "${TMP}" | clip"`, { encoding: "utf8" });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on("error", reject);
  });
}

// 获取今日选股结果
async function getTodayPicks() {
  console.log("📡 获取今日选股...");

  try {
    // 模式: strong=强势突破, volume=放量突破, all=全面扫描
    const modes = [
      { key: "strong", label: "🔥 强势突破" },
      { key: "volume", label: "📈 放量突破" },
    ];

    const allResults = [];
    for (const m of modes) {
      const res = await httpGet(`${API}/api/scan?mode=${m.key}&minScore=30&limit=8`);
      if (res && res.results) {
        allResults.push({
          mode: m.label,
          desc: res.modeDesc || "",
          stocks: res.results.slice(0, 5),
        });
      }
    }
    return allResults;
  } catch (e) {
    console.log("   ⚠️ 服务器未运行，使用示例数据");
    // 测试用示例数据
    return [
      {
        mode: "🔥 强势突破",
        desc: "MACD金叉 + 均线多头 + 量价突破",
        stocks: [
          { code: "600519", name: "贵州茅台", score: 85, grade: "A级", lastPrice: 1680.50, chg5: 3.2, reasons: ["放量突破60日高点", "MACD金叉", "主力资金流入"] },
          { code: "300750", name: "宁德时代", score: 78, grade: "B级", lastPrice: 215.30, chg5: 5.1, reasons: ["突破平台整理", "成交量放大", "北向资金加仓"] },
          { code: "002415", name: "海康威视", score: 72, grade: "B级", lastPrice: 35.80, chg5: 2.8, reasons: ["MACD底背离", "20日均线支撑", "AI概念催化"] },
        ],
      },
      {
        mode: "📈 放量突破",
        desc: "成交量显著放大 + 价格突破 + 资金流入",
        stocks: [
          { code: "000858", name: "五 粮 液", score: 80, grade: "A级", lastPrice: 148.20, chg5: 4.5, reasons: ["放量突破BOLL上轨", "KDJ金叉", "白酒板块回暖"] },
          { code: "601318", name: "中国平安", score: 68, grade: "B级", lastPrice: 42.60, chg5: 1.8, reasons: ["底部放量企稳", "保险板块估值修复", "分红预期"] },
        ],
      },
    ];
  }
}

// 格式化选股帖子
function formatPickPost(picksData) {
  const today = new Date();
  const dateStr = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][today.getDay()];

  let post = `【每日量化选股】${dateStr} 周${weekday}\n\n`;

  post += `🔍 今日扫描全市场，筛选出以下强势标的：\n\n`;

  picksData.forEach(mode => {
    if (mode.stocks.length === 0) return;
    post += `${mode.mode}\n`;
    post += `筛选逻辑：${mode.desc}\n\n`;

    mode.stocks.forEach((s, i) => {
      const emoji = s.grade === "A级" ? "⭐" : s.grade === "B级" ? "🔹" : "▫️";
      const chg = s.chg5 > 0 ? `+${s.chg5}%` : `${s.chg5}%`;
      post += `${i + 1}. ${emoji} ${s.name}（${s.code}）\n`;
      post += `   评分：${s.score}分 | ${s.grade || ""} | 5日涨跌：${chg}\n`;
      if (s.reasons) {
        post += `   信号：${s.reasons.slice(0, 3).join(" · ")}\n`;
      }
      post += "\n";
    });
  });

  post += `──\n`;
  post += `⚠️ 以上为量化模型筛选结果，仅供参考，不构成投资建议。\n`;
  post += `📊 每日自动更新，关注我获取最新选股。\n`;
  post += `#量化交易 #A股 #股票分析 #每日选股`;

  /****************************************
   * 雪球限制，现在只发短贴
   ****************************************/
   const short = `【每日量化选股】${dateStr} 周${weekday}\n\n` +
    picksData.flatMap(m => m.stocks.map((s, i) =>
      `${i + 1}. ${s.grade === "A级" ? "⭐" : "🔹"} ${s.name} 评分${s.score} ${s.chg5 > 0 ? "+" + s.chg5 + "%" : s.chg5 + "%"}  ${(s.reasons || []).slice(0, 2).join(" · ")}`
    )).join("\n") +
    `\n──\n⚠️ 仅供参考  #量化交易 #A股 #股票分析 #每日选股`;

  return { full: post, short };
}

// 注入内容到编辑器并点击发布
async function injectAndPublish(page, text) {
  const result = await page.evaluate((t) => {
    const contentEditables = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter(el => el.offsetParent !== null);
    const textareas = [...document.querySelectorAll('textarea')]
      .filter(el => el.offsetParent !== null);
    const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')]
      .filter(el => {
        if (el.offsetParent === null) return false;
        const attr = (el.id || '') + (el.name || '') + (el.placeholder || '');
        return !/search|title|标题/.test(attr.toLowerCase());
      });

    const candidates = [...contentEditables, ...textareas, ...inputs];
    if (candidates.length === 0) return { ok: false, reason: "无编辑元素" };

    let best = candidates[0];
    let bestArea = 0;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) { best = el; bestArea = area; }
    }

    const ed = best;
    ed.focus();
    ed.click();

    if (ed.contentEditable === "true") {
      ed.textContent = "";
      ed.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, t);
    } else {
      ed.value = t;
      ed.dispatchEvent(new Event("input", { bubbles: true }));
      ed.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true, tag: ed.tagName, area: Math.round(bestArea) };
  }, text);

  if (result.ok) {
    console.log(`   ✅ 已填入 (${result.tag} area=${result.area})`);
  } else {
    console.log("   ⚠️ JS注入失败，改用键盘粘贴...");
    await page.mouse.click(500, 400);
    await page.waitForTimeout(300);
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(800);
  }
}

// 尝试点击发布按钮
async function tryClickPublish(page, platform) {
  const result = await page.evaluate((platform) => {
    const allEls = [...document.querySelectorAll("button, a, span, div[role='button']")];

    // 1) class/id 匹配
    const byClass = allEls.filter(el => {
      if (!el.offsetParent) return false;
      const attr = ((el.className || '') + (el.id || '')).toLowerCase();
      return /publish|submit|post|send/.test(attr);
    });
    if (byClass.length > 0) {
      byClass[byClass.length - 1].click();
      return `class=${byClass[byClass.length - 1].className?.slice(0, 30)}`;
    }

    // 2) 文本匹配
    const byText = allEls.filter(el => {
      if (!el.offsetParent) return false;
      const t = (el.textContent || '').trim();
      return /^(发布|发表|提交|确认|回答|发帖)$/.test(t);
    });
    if (byText.length > 0) {
      byText[byText.length - 1].click();
      return `text=${byText[byText.length - 1].textContent?.trim()}`;
    }

    // 3) 模糊匹配（2-6字包含发布/发表）
    const fuzzy = allEls.filter(el => {
      if (!el.offsetParent) return false;
      const t = (el.textContent || '').trim();
      return t.length >= 2 && t.length <= 6 && /发布|发表/.test(t);
    });
    if (fuzzy.length > 0) {
      fuzzy[fuzzy.length - 1].click();
      return `fuzzy=${fuzzy[fuzzy.length - 1].textContent?.trim()}`;
    }

    return false;
  }, platform);

  return result;
}

// ============ 主流程 ============
async function main() {
  console.log("🚀 每日选股自动发帖\n");

  // 1. 获取选股数据
  const picks = await getTodayPicks();
  const totalStocks = picks.reduce((sum, m) => sum + m.stocks.length, 0);
  console.log(`📊 选股结果: ${picks.length} 个模式, 共 ${totalStocks} 只\n`);

  // 2. 格式化
  const post = formatPickPost(picks);
  console.log("📝 帖子预览:\n");
  console.log(post.short);
  console.log("\n" + "─".repeat(50) + "\n");

  // 3. 连接浏览器
  console.log("🔗 连接 Edge...");
  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  console.log("✅ 已连接\n");

  // ==== 雪球 ====
  console.log("❄️  雪球...");
  {
    const page = await ctx.newPage();
    await page.goto("https://xueqiu.com/statuses/new", { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(4000);

    const notLoggedIn = await page.$("text=登录 / 注册");
    if (notLoggedIn) {
      console.log("   ⚠️ 未登录，请在 Edge 中扫码...");
      await page.waitForTimeout(30000);
    }

    copyToClipboard(post.short);
    await injectAndPublish(page, post.short);

    // 激活发布按钮：雪球编辑器需要输入事件才能启用按钮
    await page.evaluate(() => {
      const ed = document.querySelector('[contenteditable="true"]');
      if (ed) {
        ed.focus();
        ed.dispatchEvent(new Event("input", { bubbles: true }));
        ed.dispatchEvent(new Event("change", { bubbles: true }));
        ed.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      }
    });
    await page.waitForTimeout(1000);

    // 强制点击发布（即使有 disabled class 也尝试）
    const pub = await page.evaluate(() => {
      const all = [...document.querySelectorAll("button, a, span")]
        .filter(el => {
          if (!el.offsetParent) return false;
          const t = (el.textContent || '').trim();
          const cls = (el.className || '') + (el.id || '');
          return /提交|发布|submit|publish|post/.test(cls + t) && t.length <= 10;
        });
      if (all.length > 0) {
        const btn = all[all.length - 1];
        btn.removeAttribute('disabled');
        btn.classList.remove('disabled');
        btn.click();
        return btn.textContent?.trim().slice(0, 20) || btn.className.slice(0, 30);
      }
      return false;
    });
    console.log(pub ? `   🎉 已发布 (${pub})` : "   ⚠️ 请手动点发布（内容已填入）");
  }

  // ==== 知乎 ====
  console.log("\n💡 知乎...");
  {
    const page = await ctx.newPage();
    // 知乎写想法 (pin) — 比回答问题更简单直接
    await page.goto("https://www.zhihu.com/", { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000);

    // 关弹窗
    await page.evaluate(() => {
      document.querySelectorAll("[role='dialog'] button, .Modal-closeButton, .signFlowModal button, .Modal button")
        .forEach(b => b.click());
    });
    await page.waitForTimeout(500);

    // 先试试直接导航到写想法页面
    await page.goto("https://www.zhihu.com/pin/create", { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(3000);

    // 诊断：看看有什么编辑器和按钮
    const diag = await page.evaluate(() => {
      const editors = [...document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]')]
        .filter(el => el.offsetParent)
        .map(el => `${el.tagName} ce=${el.contentEditable} role=${el.getAttribute('role')} ph="${(el.placeholder||'').slice(0,40)}"`);
      const btns = [...document.querySelectorAll("button")]
        .filter(el => el.offsetParent)
        .map(el => `${el.tagName} "${(el.textContent||'').trim().slice(0,30)}"`)
        .slice(0, 10);
      return { editors, btns };
    });
    console.log(`   编辑器: ${JSON.stringify(diag.editors)}`);
    console.log(`   按钮: ${JSON.stringify(diag.btns)}`);

    const zhText = post.short + `\n\n#量化交易 #A股 #选股`;
    copyToClipboard(zhText);
    await injectAndPublish(page, zhText);

    // 点击发布
    const pub = await page.evaluate(() => {
      const all = [...document.querySelectorAll("button, a, span, div")]
        .filter(el => {
          if (!el.offsetParent) return false;
          const t = (el.textContent || '').trim();
          const cls = ((el.className||'') + (el.id||'')).toLowerCase();
          return /发布|发表|submit|publish/.test(cls + t) && t.length <= 8;
        });
      if (all.length > 0) {
        all[all.length - 1].click();
        return all[all.length - 1].textContent?.trim();
      }
      return false;
    });
    if (pub) {
      console.log(`   🎉 已发布 (${pub})`);
    } else {
      console.log("   ⚠️ 内容已填入，请手动点发布（知乎页面在 Edge 中打开着）");
    }
  }

  // ==== 东方财富 ====
  console.log("\n📊 东方财富...");
  {
    const page = await ctx.newPage();
    await page.goto("https://guba.eastmoney.com/list,600519.html", { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000);

    const oldUrl = page.url();
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("a, button, span")]
        .filter(b => /发新帖|写话题|发帖/.test(b.textContent));
      if (btns[0]) btns[0].click();
    });
    await page.waitForTimeout(3000);

    if (page.url() !== oldUrl) await page.waitForTimeout(2000);

    const gubaText = post.short;
    copyToClipboard(gubaText);
    await injectAndPublish(page, gubaText);

    // 填标题
    await page.evaluate((t) => {
      const input = document.querySelector("input[id*='title'], input[name*='title'], input[placeholder*='标题']");
      if (input) {
        input.value = t;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, `每日量化选股 ${new Date().toLocaleDateString("zh-CN")}`);

    const pub = await tryClickPublish(page, "guba");
    console.log(pub ? `   🎉 发布成功 (${pub})` : "   ⚠️ 请手动点发布");
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ 自动发帖完成！");
  console.log("   检查各标签页确认发布状态");
  console.log("\n💡 定时运行: 每天收盘后 node daily-picks.js");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

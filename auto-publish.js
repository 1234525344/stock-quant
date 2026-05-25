// 一键发布 — DOM注入方式，绕过选择器问题
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { generateDailyArticle } = require("./src/article-generator");

const SITE_URL = "https://knights-keen-busy-policies.trycloudflare.com";
const TMP = path.join(__dirname, ".clip-temp.txt");

function copyToClipboard(text) {
  fs.writeFileSync(TMP, text, "utf8");
  execSync(`cmd.exe /c "type "${TMP}" | clip"`, { encoding: "utf8" });
}

// 通过 JS 注入方式填入内容并点击发布
async function injectAndPublish(page, text, submitSelectors) {
  // 方法1: 找 contenteditable / textarea / input
  const result = await page.evaluate((t) => {
    // 查找所有可能的编辑元素，优先 contenteditable（富文本编辑器）
    const contentEditables = [...document.querySelectorAll('[contenteditable="true"]')]
      .filter(el => el.offsetParent !== null); // 只要可见的
    const textareas = [...document.querySelectorAll('textarea')]
      .filter(el => el.offsetParent !== null);
    // input 只取那些不太像搜索/标题的
    const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')]
      .filter(el => {
        if (el.offsetParent === null) return false;
        const id = (el.id || '').toLowerCase();
        const name = (el.name || '').toLowerCase();
        const ph = (el.placeholder || '').toLowerCase();
        // 跳过搜索框和标题框
        if (/search|title|标题/.test(id + name + ph)) return false;
        return true;
      });

    // 优先 contenteditable（正文编辑器），其次 textarea，最后 input
    const candidates = [...contentEditables, ...textareas, ...inputs];
    if (candidates.length === 0) return { ok: false, reason: "无编辑元素" };

    // 取面积最大的可见元素（正文编辑器通常最大）
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

    // 尝试多种方式填入文本
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
    return { ok: true, tag: ed.tagName, className: ed.className, area: Math.round(bestArea) };
  }, text);

  if (result.ok) {
    console.log(`   ✅ 已填入 (${result.tag}.${result.className.slice(0,40)} area=${result.area})`);
  } else {
    // 方法2: 用键盘粘贴
    console.log("   ⚠️ JS注入失败，改用键盘粘贴...");
    await page.mouse.click(500, 400);
    await page.waitForTimeout(300);
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(800);
  }
}

async function main() {
  console.log("🚀 量化平台自动发布\n");

  const article = await generateDailyArticle();
  console.log(`📝 ${article.date} | ${article.mood}\n`);

  const short = article.short;
  const full = article.full;

  const browser = await chromium.connectOverCDP("http://localhost:9222");
  const ctx = browser.contexts()[0];
  console.log("🔗 已连接 Edge\n");

  // ==== 1. 雪球 ====
  console.log("❄️  雪球...");
  {
    const page = await ctx.newPage();
    await page.goto("https://xueqiu.com/statuses/new", { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(4000);

    // 检查登录
    const notLoggedIn = await page.$("text=登录 / 注册");
    if (notLoggedIn) {
      console.log("   ⚠️ 雪球未登录，请在浏览器中扫码...");
      await page.waitForTimeout(30000);
    }

    copyToClipboard(short);
    await injectAndPublish(page, short, ["button.submit", ".publish-btn", "button:has-text('发布')"]);

    // 找发布按钮并点击
    const publishClicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button, a")]
        .filter(b => /发布|提交/.test(b.textContent));
      if (btns[0]) { btns[0].click(); return true; }
      return false;
    });
    if (publishClicked) {
      console.log("   🎉 已点击发布！");
      await page.waitForTimeout(3000);
    } else {
      console.log("   ⚠️ 内容已填入，请手动点发布按钮");
    }
  }

  // ==== 2. 知乎 ====
  console.log("\n💡 知乎...");
  {
    const page = await ctx.newPage();
    await page.goto("https://www.zhihu.com/search?type=content&q=量化交易+A股", { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000);

    // 关闭弹窗
    await page.evaluate(() => {
      document.querySelectorAll("[role='dialog'] button, .Modal-closeButton, .signFlowModal button")
        .forEach(b => b.click());
    });
    await page.waitForTimeout(500);

    // 获取问题链接，直接导航过去
    const questionUrl = await page.evaluate(() => {
      const link = document.querySelector("a[href*='/question/']");
      return link ? link.href : null;
    });

    if (questionUrl) {
      console.log(`   问题: ${questionUrl.slice(0,60)}...`);
      await page.goto(questionUrl, { waitUntil: "load", timeout: 20000 });
      await page.waitForTimeout(4000);

      // 滚动到页面中部，触发回答区
      await page.evaluate(() => {
        window.scrollTo(0, Math.max(0, document.body.scrollHeight * 0.3));
      });
      await page.waitForTimeout(1500);

      // 诊断
      const diag = await page.evaluate(() => {
        const btns = [...document.querySelectorAll("button, a, span")]
          .filter(el => {
            const t = (el.textContent || '').trim();
            return /写|回答|发布|提交/.test(t) && t.length < 20 && el.offsetParent !== null;
          })
          .map(el => `${el.tagName} "${(el.textContent||'').trim().slice(0,20)}"`);
        const editors = [...document.querySelectorAll('[contenteditable="true"], textarea')]
          .filter(el => el.offsetParent !== null)
          .map(el => `${el.tagName}.${(el.className||'').slice(0,30)}`);
        return { btns: btns.slice(0, 10), editors: editors.slice(0, 5) };
      });
      console.log(`   按钮: ${JSON.stringify(diag.btns)}`);
      console.log(`   编辑器: ${JSON.stringify(diag.editors)}`);

      // 找"写回答"按钮
      const wrote = await page.evaluate(() => {
        const candidates = [...document.querySelectorAll("button, a")]
          .filter(el => {
            const t = (el.textContent || '').trim();
            return /^(写回答|撰写回答|添加回答)$/.test(t) || (t.includes('写回答') && t.length <= 8);
          });
        if (candidates[0]) { candidates[0].click(); return true; }
        return false;
      });
      if (wrote) {
        console.log("   ✅ 已点击写回答");
        await page.waitForTimeout(3000);
      } else {
        console.log("   ⚠️ 未找到写回答按钮（可能需登录知乎）");
      }

      const zhText = short + `\n\n免费量化工具：${SITE_URL}\n#量化交易 #A股`;
      copyToClipboard(zhText);
      await injectAndPublish(page, zhText, []);

      // 诊断：列出所有可见按钮
      const pubDiag = await page.evaluate(() => {
        return [...document.querySelectorAll("button, [role='button'], a.btn")]
          .filter(el => el.offsetParent)
          .map(el => `${el.tagName} "${(el.textContent||'').trim().slice(0,30)}"`)
          .filter(s => s.length > 5)
          .slice(0, 15);
      });
      console.log(`   页面按钮: ${JSON.stringify(pubDiag)}`);

      // 发布
      const pubClicked = await page.evaluate(() => {
        // 知乎发布按钮：可能在编辑器底部工具栏，class 通常包含 "PublishBtn" 或 "Submit"
        const all = [...document.querySelectorAll("button, [role='button'], span, div")]
          .filter(el => {
            if (!el.offsetParent) return false;
            const t = (el.textContent || '').trim();
            const cls = (el.className || '') + (el.id || '');
            // 优先 class/id 匹配
            if (/publish|submit|post/i.test(cls) && t.length <= 15) return true;
            // 文本匹配
            if (/^(发布|提交|确认发布|发布回答)$/.test(t)) return true;
            return false;
          });
        if (all.length > 0) {
          // 取最后一个（通常是底部发布按钮，不是顶部工具栏）
          const btn = all[all.length - 1];
          btn.click();
          return btn.textContent?.trim() || btn.className;
        }
        return false;
      });
      console.log(pubClicked ? `   🎉 已点击「${pubClicked}」！` : "   ⚠️ 请手动点发布");
    } else {
      console.log("   ⚠️ 未找到问题链接");
    }
  }

  // ==== 3. 东方财富股吧 ====
  console.log("\n📊 东方财富股吧...");
  {
    const page = await ctx.newPage();
    await page.goto("https://guba.eastmoney.com/list,600519.html", { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000);

    // 点"发新帖" — 可能触发页面跳转
    const oldUrl = page.url();
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("a, button, span")]
        .filter(b => /发新帖|写话题|发帖/.test(b.textContent));
      if (btns[0]) btns[0].click();
    });
    await page.waitForTimeout(3000);

    // 如果页面跳转了，等新页面加载
    const newUrl = page.url();
    if (newUrl !== oldUrl) {
      console.log(`   页面跳转: ${newUrl.slice(0,60)}...`);
      await page.waitForTimeout(2000);
    }

    const gubaText = short + `\n\n工具：${SITE_URL}`;
    copyToClipboard(gubaText);
    await injectAndPublish(page, gubaText, ["button:has-text('发布')"]);

    // 填标题（如果存在）
    await page.evaluate((t) => {
      const titleInput = document.querySelector("input[id*='title'], input[name*='title'], input[placeholder*='标题']");
      if (titleInput) {
        titleInput.value = t;
        titleInput.dispatchEvent(new Event("input",{bubbles:true}));
        titleInput.dispatchEvent(new Event("change",{bubbles:true}));
      }
    }, `量化速报 ${article.date}`);

    // 诊断并点击发布
    const pubClicked = await page.evaluate(() => {
      // 搜索所有可能的发布按钮（按优先级排序）
      const allEls = [...document.querySelectorAll("button, a, span, div, input[type='submit']")];

      // 第一优先：class 或 id 包含 publish/submit/post
      const byClass = allEls.filter(el => {
        const attr = ((el.className||'') + (el.id||'')).toLowerCase();
        return /publish|submit|post_btn|send_btn/.test(attr) && el.offsetParent;
      });
      if (byClass[0]) { byClass[0].click(); return `class=${byClass[0].className}`; }

      // 第二优先：短文本包含"发布"/"发表"
      const byText = allEls.filter(el => {
        const t = (el.textContent || '').trim();
        return (/^(发布|发表|提交|确认)$/.test(t) || /^(发布|发表|提交|确认).{0,2}$/.test(t)) && el.offsetParent;
      });
      if (byText[0]) { byText[0].click(); return `text=${byText[0].textContent?.trim()}`; }

      // 第三优先：任意包含"发布"的短文本元素（2-6字）
      const fuzzy = allEls.filter(el => {
        const t = (el.textContent || '').trim();
        return t.length >= 2 && t.length <= 6 && /发布|发表/.test(t) && el.offsetParent;
      });
      if (fuzzy[0]) { fuzzy[0].click(); return `fuzzy=${fuzzy[0].textContent?.trim()}`; }

      return false;
    });
    console.log(pubClicked ? `   🎉 已点击「${pubClicked}」！` : "   ⚠️ 请手动点发布");
  }

  // ==== 4. 小红书 ====
  console.log("\n📕 小红书...");
  {
    const page = await ctx.newPage();
    await page.goto("https://creator.xiaohongshu.com/publish/publish", { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(5000);

    // 诊断编辑器结构
    const diag = await page.evaluate(() => {
      const all = [...document.querySelectorAll("*")]
        .filter(el => {
          const attr = (el.getAttribute('contenteditable') || '') +
                       (el.getAttribute('role') || '') +
                       (el.getAttribute('data-placeholder') || '') +
                       (el.getAttribute('placeholder') || '');
          return attr.length > 0 && el.offsetParent !== null;
        })
        .map(el => {
          const rect = el.getBoundingClientRect();
          return `${el.tagName} ce=${el.contentEditable} role=${el.getAttribute('role')} ph="${(el.getAttribute('data-placeholder')||el.getAttribute('placeholder')||'').slice(0,30)}" area=${Math.round(rect.width*rect.height)}`;
        })
        .filter(s => !s.includes('area=0'))
        .slice(0, 10);
      return all;
    });
    console.log(`   诊断编辑器: ${JSON.stringify(diag)}`);

    const xhsText = short + `\n\n🔗 ${SITE_URL}\n#量化交易 #股票分析 #A股工具`;
    copyToClipboard(xhsText);
    await injectAndPublish(page, xhsText, []);

    // 尝试点击发布
    const pubClicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button, a, span, div")]
        .filter(el => {
          if (!el.offsetParent) return false;
          const t = (el.textContent || '').trim();
          const cls = ((el.className||'') + (el.id||'')).toLowerCase();
          return /publish|submit|发布|发表/.test(cls + t) && t.length <= 10;
        });
      if (btns[0]) { btns[0].click(); return btns[0].textContent?.trim() || btns[0].className; }
      return false;
    });
    if (pubClicked) {
      console.log(`   🎉 已点击「${pubClicked}」！`);
    } else {
      console.log("   ⚠️ 小红书需要手动添加封面图才能发布");
    }
  }

  // ==== 5. 公众号 ====
  console.log("\n📰 公众号...");
  copyToClipboard(full);
  const wxPage = await ctx.newPage();
  await wxPage.goto("https://mp.weixin.qq.com", { waitUntil: "load", timeout: 15000 });
  console.log("   ✅ 完整文章已复制到剪贴板");
  console.log("   👉 公众号后台 → 新建图文 → 正文区 Ctrl+V → 群发");

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ 全平台发布完成！");
  console.log("   检查各标签页确认发布状态");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });

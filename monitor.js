// 外网监控脚本 — 每30秒检测 lbquant.top，挂了弹窗+声音告警
const http = require("http");
const https = require("https");
// spawn 已移除 — 无通知，纯日志
const fs = require("fs");
const path = require("path");

const TARGET_URL = "http://lbquant.top";
const CHECK_INTERVAL = 30 * 1000; // 30秒
const TIMEOUT = 10 * 1000; // 10秒超时
const LOG_FILE = path.join(__dirname, "logs", "monitor.log");

let wasDown = false;
let checkCount = 0;
let failCount = 0;

function log(msg) {
  const ts = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// notify 已移除 — 纯后台日志记录，无弹窗无声音

function check() {
  checkCount++;
  const mod = TARGET_URL.startsWith("https") ? https : http;

  const req = mod.get(TARGET_URL, { timeout: TIMEOUT }, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      if (res.statusCode === 200) {
        if (wasDown) {
          log(`✅ 恢复正常 (之前连续失败 ${failCount} 次)`);
          wasDown = false;
          failCount = 0;
        }
        if (checkCount % 20 === 0) {
          log(`✅ 第 ${checkCount} 次检查: 正常 (HTTP ${res.statusCode})`);
        }
      } else {
        failCount++;
        if (!wasDown) {
          log(`❌ 异常! HTTP ${res.statusCode} — 连续失败开始`);
          wasDown = true;
        }
        log(`❌ 第 ${checkCount} 次检查: HTTP ${res.statusCode} (连续失败 ${failCount} 次)`);
      }
    });
  });

  req.on("error", (err) => {
    failCount++;
    if (!wasDown) {
      log(`❌ 连接失败: ${err.message} — 连续失败开始`);
      wasDown = true;
    }
    log(`❌ 第 ${checkCount} 次检查: ${err.message} (连续失败 ${failCount} 次)`);
  });

  req.on("timeout", () => {
    req.destroy();
    failCount++;
    if (!wasDown) {
      log(`❌ 请求超时 — 连续失败开始`);
      wasDown = true;
    }
    log(`❌ 第 ${checkCount} 次检查: 超时 (连续失败 ${failCount} 次)`);
  });
}

// 启动
log("═══════════════════════════════════════");
log("🔍 外网监控启动");
log(`   目标: ${TARGET_URL}`);
log(`   间隔: ${CHECK_INTERVAL / 1000}秒`);
log("═══════════════════════════════════════");

// 立即检查一次
check();
// 定时检查
setInterval(check, CHECK_INTERVAL);

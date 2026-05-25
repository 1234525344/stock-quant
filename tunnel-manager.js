// 隧道管理器 — 启动/监控/URL更新
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const LOCAL_PORT = 3456;
const HEALTH_CHECK_INTERVAL = 60000; // 每分钟健康检查
const LOG_DIR = path.join(__dirname, "..", "logs");
const TUNNEL_LOG = path.join(LOG_DIR, "tunnel.log");
const URL_FILE = path.join(__dirname, "logs", "tunnel_url.txt");
const SCRIPTS_TO_UPDATE = [
  "auto-publish.js",
  "publish-all.js",
];

// 确保目录存在
[LOG_DIR, path.join(__dirname, "logs")].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

let currentUrl = null;
let tunnelProcess = null;
let restartCount = 0;

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(TUNNEL_LOG, line + "\n");
}

function extractUrl(text) {
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  return m ? m[0] : null;
}

function updateScripts(url) {
  for (const script of SCRIPTS_TO_UPDATE) {
    const p = path.join(__dirname, script);
    if (!fs.existsSync(p)) continue;
    let content = fs.readFileSync(p, "utf8");
    const oldUrl = content.match(/SITE_URL\s*=\s*"([^"]+)"/)?.[1];
    if (oldUrl && oldUrl !== url) {
      content = content.replace(/SITE_URL\s*=\s*"[^"]+"/, `SITE_URL = "${url}"`);
      fs.writeFileSync(p, content, "utf8");
      log(`   📝 已更新 ${script}: ${oldUrl.slice(0,40)} → ${url.slice(0,40)}`);
    }
  }
}

function healthCheck() {
  return new Promise((resolve) => {
    if (!currentUrl) return resolve(false);
    const req = http.get(currentUrl, { timeout: 10000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function startTunnel() {
  return new Promise((resolve) => {
    log("🚀 启动 Cloudflare Tunnel...");

    // 杀掉旧进程 (own process only — but skip to avoid killing existing working tunnel)
    // try { require("child_process").execSync("taskkill /F /IM cloudflared.exe 2>nul", { stdio: "ignore" }); } catch(e) {}

    const cloudflaredExe = "C:\\Users\\lb\\cloudflared.exe";
    tunnelProcess = spawn(cloudflaredExe, [
      "tunnel", "--url", `http://localhost:${LOCAL_PORT}`,
      "--protocol", "http2", "--no-autoupdate",
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let buffer = "";
    let resolved = false;

    const onData = (data) => {
      buffer += data.toString();
      if (!resolved) {
        const url = extractUrl(buffer);
        if (url) {
          resolved = true;
          currentUrl = url;
          fs.writeFileSync(URL_FILE, url + "\n", "utf8");
          log(`✅ 隧道已建立: ${url}`);
          updateScripts(url);
          resolve(url);
        }
      }
    };

    tunnelProcess.stdout.on("data", onData);
    tunnelProcess.stderr.on("data", onData);

    tunnelProcess.on("exit", (code) => {
      log(`⚠️ 隧道进程退出 (code=${code})`);
      currentUrl = null;
      tunnelProcess = null;

      // 自动重启
      const delay = Math.min(restartCount * 5000, 60000);
      restartCount++;
      log(`   ⏳ ${delay/1000}秒后自动重启 (第${restartCount}次)`);
      setTimeout(() => startTunnel(), delay);
    });

    // 30秒超时
    setTimeout(() => {
      if (!resolved) {
        log("❌ 隧道启动超时，重试中...");
        tunnelProcess.kill();
        setTimeout(() => startTunnel(), 5000);
      }
    }, 30000);
  });
}

async function monitorLoop() {
  setInterval(async () => {
    const healthy = await healthCheck();
    if (!healthy && currentUrl) {
      log("⚠️ 健康检查失败，重启隧道...");
      if (tunnelProcess) tunnelProcess.kill();
    }
  }, HEALTH_CHECK_INTERVAL);
}

// 主入口
async function main() {
  log("═".repeat(50));
  log("隧道管理器启动");
  log("═".repeat(50));

  await startTunnel();
  restartCount = 0; // 成功启动后重置计数
  monitorLoop();

  // 保持进程运行
  process.on("SIGINT", () => {
    log("🛑 隧道管理器关闭");
    if (tunnelProcess) tunnelProcess.kill();
    process.exit(0);
  });
}

// 如果作为模块被引用，导出函数
if (require.main === module) {
  main().catch(e => { log(`❌ ${e.message}`); process.exit(1); });
}

module.exports = { startTunnel, extractUrl, updateScripts, healthCheck };

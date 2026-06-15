// 隧道管理器 — 使用命名隧道连接 lbquant.top (HTTP/2, 自动重启)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const TUNNEL_ID = "8001c255-c5e7-46e4-8459-155b57217686";
const SITE_URL = "https://lbquant.top";
const HEALTH_CHECK_INTERVAL = 60000;
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

let tunnelProcess = null;
let restartCount = 0;

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(TUNNEL_LOG, line + "\n");
}

function updateScripts() {
  for (const script of SCRIPTS_TO_UPDATE) {
    const p = path.join(__dirname, script);
    if (!fs.existsSync(p)) continue;
    let content = fs.readFileSync(p, "utf8");
    if (!content.includes(SITE_URL)) {
      content = content.replace(/const SITE_URL\s*=\s*"[^"]+"/, `const SITE_URL = "${SITE_URL}"`);
      fs.writeFileSync(p, content, "utf8");
      log(`   📝 已更新 ${script} → ${SITE_URL}`);
    }
  }
}

const https = require("https");

function healthCheck() {
  return new Promise((resolve) => {
    const mod = SITE_URL.startsWith("https") ? https : http;
    const req = mod.get(`${SITE_URL}/api/autotrade/status`, { timeout: 10000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function startTunnel() {
  return new Promise((resolve) => {
    log("🚀 启动命名隧道: lbquant.top (HTTP/2)...");

    const cloudflaredExe = "C:\\Users\\lb\\cloudflared.exe";
    tunnelProcess = spawn(cloudflaredExe, [
      "--protocol", "http2",
      "tunnel", "run", TUNNEL_ID,
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    let resolved = false;

    const onData = (data) => {
      const text = data.toString();
      if (!resolved && text.includes("Registered tunnel connection")) {
        resolved = true;
        fs.writeFileSync(URL_FILE, SITE_URL + "\n", "utf8");
        log(`✅ 隧道已建立: ${SITE_URL}`);
        updateScripts();
        resolve();
      }
    };

    tunnelProcess.stdout.on("data", onData);
    tunnelProcess.stderr.on("data", onData);

    tunnelProcess.on("exit", (code) => {
      log(`⚠️ 隧道进程退出 (code=${code})`);
      tunnelProcess = null;

      const delay = Math.min(restartCount * 5000, 60000);
      restartCount++;
      log(`   ⏳ ${delay/1000}秒后自动重启 (第${restartCount}次)`);
      setTimeout(() => startTunnel(), delay);
    });

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
    if (!healthy) {
      log("⚠️ 健康检查失败，重启隧道...");
      if (tunnelProcess) tunnelProcess.kill();
    }
  }, HEALTH_CHECK_INTERVAL);
}

// 主入口
async function main() {
  log("═".repeat(50));
  log("隧道管理器启动 (命名隧道: lbquant.top)");
  log("═".repeat(50));

  await startTunnel();
  restartCount = 0;
  monitorLoop();

  process.on("SIGINT", () => {
    log("🛑 隧道管理器关闭");
    if (tunnelProcess) tunnelProcess.kill();
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(e => { log(`❌ ${e.message}`); process.exit(1); });
}

module.exports = { startTunnel, healthCheck };

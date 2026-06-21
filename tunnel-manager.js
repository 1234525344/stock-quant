// 隧道管理器 — 使用命名隧道连接 lbquant.top (HTTP/2, 自动重启)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const TUNNEL_ID = "8001c255-c5e7-46e4-8459-155b57217686";
const SITE_URL = "https://lbquant.top";
const HEALTH_CHECK_INTERVAL = 60000;
const LOG_DIR = path.join(__dirname, "logs");
const TUNNEL_LOG = path.join(LOG_DIR, "tunnel.log");
const URL_FILE = path.join(LOG_DIR, "tunnel_url.txt");

// 确保目录存在
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

let tunnelProcess = null;
let restartCount = 0;

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(TUNNEL_LOG, line + "\n"); } catch (_) {}
}

function healthCheck() {
  return new Promise((resolve) => {
    const mod = SITE_URL.startsWith("https") ? https : http;
    const req = mod.get(`${SITE_URL}/api/health`, { timeout: 10000 }, (res) => {
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

    // 检测 cloudflared 是否存在
    if (!fs.existsSync(cloudflaredExe)) {
      log(`❌ 找不到 cloudflared: ${cloudflaredExe}`);
      resolve();
      return;
    }

    tunnelProcess = spawn(cloudflaredExe, [
      "--protocol", "http2",
      "tunnel", "run", TUNNEL_ID,
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    let resolved = false;

    const onData = (data) => {
      const text = data.toString();
      if (!resolved && text.includes("Registered tunnel connection")) {
        resolved = true;
        try { fs.writeFileSync(URL_FILE, SITE_URL + "\n", "utf8"); } catch (_) {}
        log(`✅ 隧道已建立: ${SITE_URL}`);
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
      log(`   ⏳ ${delay / 1000}秒后自动重启 (第${restartCount}次)`);
      setTimeout(() => startTunnel(), delay);
    });

    tunnelProcess.on("error", (err) => {
      log(`❌ 隧道进程错误: ${err.message}`);
      tunnelProcess = null;
    });

    // 30秒超时
    setTimeout(() => {
      if (!resolved) {
        log("❌ 隧道启动超时，重试中...");
        if (tunnelProcess) {
          try { tunnelProcess.kill(); } catch (_) {}
          tunnelProcess = null;
        }
        setTimeout(() => startTunnel(), 5000);
      }
    }, 30000);
  });
}

async function monitorLoop() {
  let healthyStreak = 0;
  setInterval(async () => {
    const healthy = await healthCheck();
    if (!healthy) {
      healthyStreak = 0;
      log("⚠️ 健康检查失败，重启隧道...");
      if (tunnelProcess) {
        try { tunnelProcess.kill(); } catch (_) {}
        tunnelProcess = null;
      }
    } else {
      healthyStreak++;
      if (healthyStreak >= 3 && restartCount > 0) {
        log("✅ 隧道已稳定，重置重连计数");
        restartCount = 0;
      }
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
    if (tunnelProcess) {
      try { tunnelProcess.kill(); } catch (_) {}
    }
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(e => { log(`❌ ${e.message}`); process.exit(1); });
}

module.exports = { startTunnel, healthCheck };

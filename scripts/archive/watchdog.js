const { execSync, spawn } = require("child_process");
const http = require("http");

const SERVER_PORT = 3456;
const CHECK_INTERVAL = 60 * 1000; // 每 60 秒检查一次
const TUNNEL_ID = "8001c255-c5e7-46e4-8459-155b57217686";
const CLOUDFLARED = "C:/Users/lb/cloudflared.exe";
const SERVER_DIR = "C:/Users/lb/stock-quant";

function log(msg) {
  const time = new Date().toLocaleString("zh-CN");
  console.log(`[${time}] ${msg}`);
}

function isProcessRunning(name) {
  try {
    const out = execSync(`tasklist /fi "imagename eq ${name}" /fo csv /nh`, { encoding: "utf8" });
    return out.toLowerCase().includes(name.toLowerCase());
  } catch {
    return false;
  }
}

function killProcess(name) {
  try {
    execSync(`taskkill /F /IM ${name}`, { stdio: "ignore" });
    log(`已终止 ${name}`);
  } catch { /* not running */ }
}

function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${SERVER_PORT}/api/ai/status`, { timeout: 5000 }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve(res.statusCode === 200));
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function startServer() {
  const child = spawn("node", ["server.js"], {
    cwd: SERVER_DIR,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  log("Node 服务器已启动 (PID: " + child.pid + ")");
}

function startTunnel() {
  const child = spawn(CLOUDFLARED, ["--protocol", "http2", "tunnel", "run", TUNNEL_ID], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  log("Cloudflare 隧道已启动 (PID: " + child.pid + ")");
}

async function check() {
  // 检查 Node 服务器
  const serverOk = await checkServer();
  if (!serverOk) {
    log("⚠ Node 服务器无响应，正在重启...");
    killProcess("node.exe");
    await new Promise(r => setTimeout(r, 2000));
    startServer();
  }

  // 检查 cloudflared
  if (!isProcessRunning("cloudflared.exe")) {
    log("⚠ Cloudflare 隧道未运行，正在启动...");
    startTunnel();
  }
}

log("守护进程已启动，每 60 秒检查一次...");
check();
setInterval(check, CHECK_INTERVAL);

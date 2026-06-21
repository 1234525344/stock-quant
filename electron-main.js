// 量化交易平台 — Electron 桌面应用
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path = require("path");
const { execSync } = require("child_process");

let mainWindow;

const PORT = parseInt(process.env.PORT) || 3456;
const isDev = !app.isPackaged;

// ── Python 检测 ──
function findPython() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const candidates = [
    "python3", "python",
    "C:\\Python314\\python.exe", "C:\\Python313\\python.exe",
    "C:\\Python312\\python.exe", "C:\\Python311\\python.exe",
    "C:\\Python3\\python.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python314", "python.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python313", "python.exe"),
  ];
  for (const p of candidates) {
    try { execSync(`"${p}" --version`, { stdio: "ignore", timeout: 5000 }); return p; }
    catch (_) {}
  }
  return null;
}

const PYTHON_BIN = findPython();

// ── 创建窗口 ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 680,
    title: "量化交易平台", backgroundColor: "#0a0e27", show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });

  const menuTemplate = [{
    label: "量化交易平台",
    submenu: [
      { label: "关于", click: () => dialog.showMessageBox(mainWindow, {
        type: "info", title: "关于", message: "量化交易平台 v2.1.0",
        detail: `A股量化分析工具\n${PYTHON_BIN ? "Python 已检测到" : "Python 未检测到(回测功能不可用)"}`,
      })},
      { type: "separator" },
      { label: "刷新", accelerator: "F5", role: "reload" },
      { label: "开发者工具", accelerator: "F12", role: "toggleDevTools" },
      { type: "separator" },
      { label: "退出", role: "quit" },
    ],
  }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── 启动 ──
app.whenReady().then(() => {
  // 设置环境变量，告诉 server.js 这是 Electron 桌面应用
  process.env.ELECTRON = "1";
  process.env.PYTHON_BIN = PYTHON_BIN || "";
  process.env.NODE_ENV = "development";
  process.env.PORT = String(PORT);
  process.env.DATA_DIR = isDev
    ? path.join(__dirname, "data")
    : path.join(path.dirname(app.getPath("exe")), "data");

  if (PYTHON_BIN) console.log("[Electron] Python:", PYTHON_BIN);
  else console.warn("[Electron] Python not found");

  // 直接在主进程加载 server.js（不在子进程中）
  require("./server.js");

  // server.js 的 server.listen 是异步的，稍等后打开窗口
  setTimeout(() => {
    console.log("[Electron] Opening window on port", PORT);
    createWindow();
  }, 2000);
});

app.on("window-all-closed", () => { app.quit(); });

// 单实例
if (!app.requestSingleInstanceLock()) { app.quit(); }
else { app.on("second-instance", () => { if (mainWindow) { mainWindow.restore(); mainWindow.focus(); }}); }

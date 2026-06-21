// 量化交易平台 — Electron 桌面应用
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");

let mainWindow;
let serverProcess;

const PORT = process.env.PORT || 3456;
const isDev = !app.isPackaged;

// ── Python 检测 ──
function findPython() {
  // 优先用环境变量
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;

  // 常见路径
  const candidates = [
    "python3", "python",
    "C:\\Python314\\python.exe",
    "C:\\Python313\\python.exe",
    "C:\\Python312\\python.exe",
    "C:\\Python311\\python.exe",
    "C:\\Python3\\python.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python314", "python.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python313", "python.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "python.exe"),
  ];

  for (const p of candidates) {
    try {
      execSync(`"${p}" --version`, { stdio: "ignore", timeout: 5000 });
      return p;
    } catch (_) {}
  }
  return null;
}

const PYTHON_BIN = findPython();

// ── 服务器启动 ──
function startServer() {
  return new Promise((resolve) => {
    const { fork } = require("child_process");
    const env = {
      ...process.env,
      PORT: String(PORT),
      ELECTRON: "1",
      NODE_ENV: process.env.NODE_ENV || "development",
      PYTHON_BIN: PYTHON_BIN || "",
      // 数据目录：打包后指向 Electron userData，开发模式用项目 data/
      DATA_DIR: app.isPackaged ? path.join(app.getPath("userData"), "data") : path.join(__dirname, "data"),
    };

    serverProcess = fork(path.join(__dirname, "server.js"), [], {
      env,
      silent: false,
      stdio: "pipe",
    });

    let started = false;
    const onData = (d) => {
      const msg = d.toString();
      if (!started && (msg.includes("已启动") || msg.includes("listening") || msg.includes("3456"))) {
        started = true;
        resolve(true);
      }
    };

    serverProcess.stdout?.on("data", onData);
    serverProcess.stderr?.on("data", onData);
    serverProcess.on("error", (err) => {
      console.error("[Electron] Server error:", err.message);
    });

    // 超时回退：3秒后无论如何都打开窗口
    setTimeout(() => resolve(started), 4000);
  });
}

// ── 主窗口 ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "量化交易平台",
    icon: path.join(__dirname, "public", "favicon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: "#0a0e27",
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const menuTemplate = [
    {
      label: "量化交易平台",
      submenu: [
        {
          label: "关于",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "关于 量化交易平台",
              message: "量化交易平台 v2.1.0",
              detail: `A股量化分析工具\n多因子Alpha · 策略回测 · AI选股\n数据来源: 新浪 / 腾讯 / 东方财富\n${PYTHON_BIN ? "✅ Python 已检测到" : "⚠️ 未检测到Python，部分功能不可用"}`,
            });
          },
        },
        { type: "separator" },
        { label: "刷新", accelerator: "F5", role: "reload" },
        { label: "开发者工具", accelerator: "F12", role: "toggleDevTools" },
        { type: "separator" },
        { label: "退出", role: "quit" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── 启动流程 ──
app.whenReady().then(async () => {
  if (!PYTHON_BIN) {
    console.warn("[Electron] Python 未检测到，量化回测功能将不可用（其他功能正常）");
  } else {
    console.log(`[Electron] Python: ${PYTHON_BIN}`);
  }

  try {
    await startServer();
    console.log("[Electron] 服务器已启动");
  } catch (e) {
    console.error("[Electron] 服务器启动失败:", e.message);
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) serverProcess.kill();
});

// 防止多开
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// 量化交易平台 — Electron 主进程
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");
const { fork } = require("child_process");

let mainWindow;
let serverProcess;

const PORT = 3456;
const isDev = process.argv.includes("--dev");

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = fork(path.join(__dirname, "server.js"), [], {
      env: { ...process.env, PORT: String(PORT), ELECTRON: "true" },
      silent: true,
    });
    serverProcess.stdout.on("data", (d) => {
      const msg = d.toString();
      if (msg.includes("已启动") || msg.includes("listening") || msg.includes(PORT)) {
        resolve();
      }
    });
    serverProcess.stderr.on("data", (d) => { /* ignore */ });
    serverProcess.on("error", reject);
    // 超时回退
    setTimeout(() => resolve(), 3000);
  });
}

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
  mainWindow.on("closed", () => { mainWindow = null; });

  // 外部链接用默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // 精简菜单
  const menuTemplate = [
    {
      label: "量化交易平台",
      submenu: [
        { label: "关于", role: "about" },
        { type: "separator" },
        { label: "退出", accelerator: "Alt+F4", role: "quit" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "刷新", accelerator: "F5", role: "reload" },
        { label: "开发者工具", accelerator: "F12", role: "toggleDevTools" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

app.whenReady().then(async () => {
  try {
    await startServer();
  } catch (e) {
    // 服务器可能已在运行
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

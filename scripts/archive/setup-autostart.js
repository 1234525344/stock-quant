// Setup auto-start via Windows Startup folder (no admin required)
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const startupDir = path.join(
  process.env.APPDATA,
  "Microsoft\\Windows\\Start Menu\\Programs\\Startup"
);

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const WORK = __dirname;

const tasks = [
  {
    name: "StockQuantServer.bat",
    content: `@echo off
cd /d "${WORK}"
start "StockQuantServer" /MIN "${NODE}" server.js
`,
  },
  {
    name: "StockQuantTunnel.bat",
    content: `@echo off
cd /d "${WORK}"
start "StockQuantTunnel" /MIN "${NODE}" tunnel-manager.js
`,
  },
];

console.log("=== Setup Auto-Start (Startup Folder) ===\n");
console.log("Startup folder:", startupDir);

if (!fs.existsSync(startupDir)) {
  fs.mkdirSync(startupDir, { recursive: true });
}

for (const task of tasks) {
  const filePath = path.join(startupDir, task.name);
  fs.writeFileSync(filePath, task.content, "utf8");
  console.log(`✅ ${task.name}`);
}

console.log("\n=== Done ===");
console.log("These will run automatically on next login.");
console.log("To start immediately, run the .bat files in:");
console.log("  " + startupDir);

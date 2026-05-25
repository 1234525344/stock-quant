// Setup Windows Scheduled Tasks for Stock-Quant
// Uses spawn to avoid shell escaping issues
const { spawnSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const NODE_EXE = "C:\\Program Files\\nodejs\\node.exe";
const WORK_DIR = __dirname;

function schtasks(args) {
  const r = spawnSync("schtasks", args, { encoding: "utf8", windowsHide: true });
  if (r.stdout) console.log(r.stdout.trim());
  if (r.stderr && r.status !== 0) console.log("ERR:", r.stderr.trim().substring(0, 300));
  return r.status === 0;
}

console.log("=== Setup Stock-Quant Auto-Start Tasks ===\n");

// Delete old tasks
console.log("Removing old tasks...");
schtasks(["/Delete", "/TN", "StockQuantServer", "/F"]);
schtasks(["/Delete", "/TN", "StockQuantTunnel", "/F"]);

// Create StockQuantServer
console.log("\n[1] StockQuantServer:");
const r1 = schtasks([
  "/Create", "/TN", "StockQuantServer",
  "/TR", `${NODE_EXE} server.js`,
  "/SC", "ONLOGON",
  "/DELAY", "0000:30",
  "/RL", "LIMITED",
  "/IT",
  "/F"
]);
console.log(r1 ? "  OK" : "  FAILED (may need admin)");

// Create StockQuantTunnel
console.log("\n[2] StockQuantTunnel:");
const r2 = schtasks([
  "/Create", "/TN", "StockQuantTunnel",
  "/TR", `${NODE_EXE} tunnel-manager.js`,
  "/SC", "ONLOGON",
  "/DELAY", "0001:00",
  "/RL", "LIMITED",
  "/IT",
  "/F"
]);
console.log(r2 ? "  OK" : "  FAILED (may need admin)");

// Verify
console.log("\n=== Verification ===");
try {
  const v1 = execSync('schtasks /Query /TN "StockQuantServer" /FO LIST', { encoding: "utf8" });
  console.log(v1.trim().split("\n").filter(l => /TaskName|Status|Author/i.test(l)).join("\n"));
} catch(e) {}
try {
  const v2 = execSync('schtasks /Query /TN "StockQuantTunnel" /FO LIST', { encoding: "utf8" });
  console.log(v2.trim().split("\n").filter(l => /TaskName|Status|Author/i.test(l)).join("\n"));
} catch(e) {}

console.log("\n=== Done ===");
console.log("To start immediately:");
console.log('  schtasks /Run /TN "StockQuantServer"');
console.log('  schtasks /Run /TN "StockQuantTunnel"');

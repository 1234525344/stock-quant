// Central Python binary resolution.
const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Find the best Python binary: bundled > env var > system
let _pythonBin = null;
function findPythonBin() {
  if (_pythonBin) return _pythonBin;
  if (process.env.PYTHON_BIN && fs.existsSync(process.env.PYTHON_BIN))
    return (_pythonBin = process.env.PYTHON_BIN);
  // Bundled portable Python
  if (process.execPath) {
    const bundled = path.join(path.dirname(process.execPath), "python-portable", "python.exe");
    if (fs.existsSync(bundled)) return (_pythonBin = bundled);
  }
  return (_pythonBin = (process.platform === "win32" ? "python" : "python3"));
}
const PYTHON_BIN = findPythonBin();

function getPythonBin() { return PYTHON_BIN; }

// Resolve script path out of .asar for system Python access
function resolveScript(scriptPath) {
  if (typeof scriptPath !== 'string') return scriptPath;
  if (!scriptPath.includes(".asar")) return scriptPath;
  const basename = path.basename(scriptPath);
  // Check alongside asar in resources/
  const resourcesDir = path.join(path.dirname(process.resourcesPath || ""), basename);
  if (fs.existsSync(resourcesDir)) return resourcesDir;
  // Check relative to exe
  if (process.execPath) {
    const exeDir = path.join(path.dirname(process.execPath), "resources", basename);
    if (fs.existsSync(exeDir)) return exeDir;
  }
  return scriptPath;
}

function execPython(scriptPath, args = [], options = {}) {
  const resolved = resolveScript(scriptPath);
  const opts = { timeout: options.timeout || 15000, maxBuffer: options.maxBuffer || 4*1024*1024, windowsHide: true, ...options };
  return new Promise((resolve) => {
    execFile(PYTHON_BIN, [resolved, ...args], opts, (err, stdout) => {
      if (err) return resolve(options.onError ? (options.onError(err), null) : null);
      if (options.expectJson) { try { resolve(JSON.parse(stdout)); } catch(e) { resolve(null); } }
      else resolve(stdout);
    });
  });
}

function spawnPython(scriptPath, args = [], options = {}) {
  return spawn(PYTHON_BIN, [resolveScript(scriptPath), ...args], { stdio: ["ignore","pipe","pipe"], windowsHide: true, ...options });
}

module.exports = { getPythonBin, execPython, spawnPython, resolveScript, PYTHON_BIN };

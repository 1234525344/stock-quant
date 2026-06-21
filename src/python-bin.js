// Central Python binary resolution.
// On Linux/Docker: python3 (default). On Windows: python.
// Override with PYTHON_BIN env var.
const { execFile, spawn } = require("child_process");

const PYTHON_BIN = process.env.PYTHON_BIN
  || (process.platform === "win32" ? "python" : "python3");

function getPythonBin() {
  return PYTHON_BIN;
}

/**
 * Safe execFile wrapper. Always resolves (never rejects).
 * Returns parsed JSON when expectJson=true, raw stdout otherwise.
 * Returns null on any error (so callers degrade gracefully).
 */
function execPython(scriptPath, args = [], options = {}) {
  const opts = {
    timeout: options.timeout || 15000,
    maxBuffer: options.maxBuffer || 4 * 1024 * 1024,
    windowsHide: true,
    ...options,
    env: options.env || process.env,
  };
  return new Promise((resolve) => {
    execFile(PYTHON_BIN, [scriptPath, ...args], opts, (err, stdout) => {
      if (err) {
        if (options.onError) options.onError(err);
        return resolve(null);
      }
      if (options.expectJson) {
        try { resolve(JSON.parse(stdout)); }
        catch (e) { resolve(null); }
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Safe spawn wrapper for long-running Python processes (e.g., Qlib).
 */
function spawnPython(scriptPath, args = [], options = {}) {
  return spawn(PYTHON_BIN, [scriptPath, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    ...options,
  });
}

module.exports = { getPythonBin, execPython, spawnPython, PYTHON_BIN };

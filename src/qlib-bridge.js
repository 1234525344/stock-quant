// Qlib Bridge — Node.js ↔ Python child_process interface
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PYTHON_SCRIPT = path.join(__dirname, "..", "python", "qlib_service.py");
const PYTHON = "python";

/**
 * Call the Python Qlib service and return parsed JSON.
 * @param {string[]} args - CLI arguments
 * @param {number} timeout - timeout in ms
 * @returns {Promise<object>}
 */
function callPython(args, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [PYTHON_SCRIPT, ...args], {
      cwd: path.join(__dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Python service timeout (${timeout}ms)`));
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`Python exited ${code}: ${stderr.slice(-500)}`));
      }
      // Extract JSON from mixed output (JSON is on stdout but may have INFO lines before it)
      const lines = stdout.trim().split("\n");
      // Find the last JSON object or array
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith("{") || line.startsWith("[")) {
          // Validate it's complete JSON
          try {
            const json = JSON.parse(lines.slice(i).join("\n"));
            return resolve(json);
          } catch {
            try {
              return resolve(JSON.parse(line));
            } catch {
              // continue searching
            }
          }
        }
      }
      reject(new Error("No JSON found in output. Last 300 chars: " + stdout.slice(-300)));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Get Qlib environment status.
 */
async function getStatus() {
  return callPython(["status"], 60000);
}

/**
 * List all trained models.
 */
async function listModels() {
  return callPython(["list-models"], 60000);
}

/**
 * Train a new model.
 * @param {object} options
 * @param {string} options.market - e.g. "csi300"
 * @param {string} options.modelType - "lgb" or "lgb_fast"
 * @param {string} [options.modelName] - optional custom name
 * @param {string} [options.trainStart]
 * @param {string} [options.trainEnd]
 * @param {string} [options.validStart]
 * @param {string} [options.validEnd]
 * @param {string} [options.testStart]
 * @param {string} [options.testEnd]
 */
async function trainModel(options = {}) {
  const args = ["train", "--market", options.market || "csi300",
                "--model-type", options.modelType || "lgb"];
  if (options.modelName) args.push("--model-name", options.modelName);
  if (options.trainStart) args.push("--train-start", options.trainStart);
  if (options.trainEnd) args.push("--train-end", options.trainEnd);
  if (options.validStart) args.push("--valid-start", options.validStart);
  if (options.validEnd) args.push("--valid-end", options.validEnd);
  if (options.testStart) args.push("--test-start", options.testStart);
  if (options.testEnd) args.push("--test-end", options.testEnd);
  return callPython(args, 600000);
}

/**
 * Get predictions from a trained model.
 * @param {string} modelName
 * @param {object} [options]
 * @param {string} [options.date] - prediction date
 * @param {string[]} [options.stocks] - stock codes
 */
async function predict(modelName, options = {}) {
  const args = ["predict", "--model-name", modelName];
  if (options.date) args.push("--date", options.date);
  if (options.stocks && options.stocks.length) {
    args.push("--stock-list", options.stocks.join(","));
  }
  return callPython(args, 120000);
}

/**
 * Get model metrics.
 */
async function getModelMetrics(modelName) {
  const result = await predict(modelName);
  if (result.error) throw new Error(result.error);
  return result;
}

module.exports = {
  getStatus,
  listModels,
  trainModel,
  predict,
  getModelMetrics,
};

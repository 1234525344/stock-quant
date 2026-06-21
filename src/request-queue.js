// 请求队列 — 带指数退避的并发控制 + 熔断器
// 替代 batchWithLimit 的简单并发限制，增加重试和退避机制

const { logger } = require("./logger");

// ====== 熔断器 (Circuit Breaker) ======
const circuitState = new Map(); // key -> { failures, lastFail, open }

function getCircuit(key, { threshold = 5, cooldownMs = 300000 } = {}) {
  if (!circuitState.has(key)) {
    circuitState.set(key, { failures: 0, lastFail: 0, open: false, threshold, cooldownMs });
  }
  return circuitState.get(key);
}

function circuitFail(key, opts) {
  const cb = getCircuit(key, opts);
  cb.failures++;
  cb.lastFail = Date.now();
  if (cb.failures >= cb.threshold) {
    cb.open = true;
    logger.warn(`[CircuitBreaker] ${key} 熔断开启 (${cb.failures}次连续失败, ${cb.cooldownMs/1000}s冷却)`);
  }
}

function circuitSuccess(key, opts) {
  const cb = getCircuit(key, opts);
  cb.failures = 0;
  cb.open = false;
}

function isCircuitOpen(key, opts) {
  const cb = getCircuit(key, opts);
  if (!cb.open) return false;
  if (Date.now() - cb.lastFail > cb.cooldownMs) {
    cb.open = false;
    cb.failures = 0;
    logger.info(`[CircuitBreaker] ${key} 熔断冷却结束, 恢复请求`);
    return false;
  }
  return true;
}

// 请求超时包装
function withTimeout(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`请求超时 (${ms}ms)`)), ms))
  ]);
}

class RequestQueue {
  /**
   * @param {Object} opts
   * @param {number} opts.concurrency - 最大并发数 (默认 10)
   * @param {number} opts.maxRetries - 最大重试次数 (默认 3)
   * @param {number} opts.baseDelay - 基础退避时间 ms (默认 1000)
   * @param {number} opts.maxDelay - 最大退避时间 ms (默认 30000)
   * @param {number} opts.jitter - 抖动比例 0-1 (默认 0.3)
   */
  constructor(opts = {}) {
    this.concurrency = opts.concurrency || 10;
    this.maxRetries = opts.maxRetries || 3;
    this.baseDelay = opts.baseDelay || 1000;
    this.maxDelay = opts.maxDelay || 30000;
    this.jitter = opts.jitter || 0.3;
    this.running = 0;
    this.queue = [];
    this.stats = { total: 0, success: 0, failed: 0, retried: 0 };
  }

  /**
   * 提交任务到队列
   * @param {Function} fn - 异步任务函数
   * @param {string} label - 任务标签 (用于日志)
   * @returns {Promise}
   */
  enqueue(fn, label = "task") {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, label, resolve, reject, retries: 0 });
      this._processNext();
    });
  }

  _processNext() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      this.running++;
      this._executeTask(task);
    }
  }

  async _executeTask(task) {
    this.stats.total++;
    try {
      const result = await task.fn();
      this.stats.success++;
      task.resolve(result);
    } catch (err) {
      if (task.retries < this.maxRetries) {
        task.retries++;
        this.stats.retried++;
        const delay = this._calcDelay(task.retries);
        logger.warn(`[RequestQueue] ${task.label} 失败, 第${task.retries}次重试, ${delay}ms后`, { error: err.message });
        setTimeout(() => {
          this.queue.push(task);
          this._processNext();
        }, delay);
      } else {
        this.stats.failed++;
        logger.error(`[RequestQueue] ${task.label} 最终失败 (${this.maxRetries}次重试后)`, { error: err.message });
        task.reject(err);
      }
    } finally {
      this.running--;
      this._processNext();
    }
  }

  _calcDelay(attempt) {
    const exponential = this.baseDelay * Math.pow(2, attempt - 1);
    const capped = Math.min(exponential, this.maxDelay);
    const jitterRange = capped * this.jitter;
    return Math.floor(capped - jitterRange + Math.random() * 2 * jitterRange);
  }

  getStats() { return { ...this.stats, pending: this.queue.length, running: this.running }; }
}

// 带退避的单次请求包装 (含熔断器)
async function fetchWithRetry(fn, { maxRetries = 3, baseDelay = 1000, label = "fetch", circuitKey = null, circuitThreshold = 5, circuitCooldown = 300000, timeout = 15000 } = {}) {
  // 熔断器检查
  if (circuitKey && isCircuitOpen(circuitKey, { threshold: circuitThreshold, cooldownMs: circuitCooldown })) {
    const err = new Error(`[CircuitBreaker] ${circuitKey} 已熔断, 跳过请求`);
    logger.warn(err.message);
    throw err;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await withTimeout(fn(), timeout);
      if (circuitKey) circuitSuccess(circuitKey, { threshold: circuitThreshold, cooldownMs: circuitCooldown });
      return result;
    } catch (err) {
      if (attempt === maxRetries) {
        logger.error(`[fetchWithRetry] ${label} 最终失败`, { error: err.message, attempts: attempt + 1 });
        if (circuitKey) circuitFail(circuitKey, { threshold: circuitThreshold, cooldownMs: circuitCooldown });
        throw err;
      }
      if (circuitKey) circuitFail(circuitKey, { threshold: circuitThreshold, cooldownMs: circuitCooldown });
      const delay = Math.min(baseDelay * Math.pow(2, attempt), 30000);
      const jitter = delay * 0.3;
      const wait = Math.floor(delay - jitter + Math.random() * 2 * jitter);
      logger.warn(`[fetchWithRetry] ${label} 失败, 重试 ${attempt + 1}/${maxRetries}, 等待 ${wait}ms`, { error: err.message });
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// 批量请求 (替代 batchWithLimit)
async function batchWithRetry(items, fn, { concurrency = 10, maxRetries = 3, label = "batch" } = {}) {
  const queue = new RequestQueue({ concurrency, maxRetries });
  const results = await Promise.allSettled(
    items.map((item, i) => queue.enqueue(() => fn(item), `${label}[${i}]`))
  );
  const stats = queue.getStats();
  if (stats.failed > 0) {
    logger.warn(`[batchWithRetry] ${label}: ${stats.failed}/${stats.total} 任务最终失败`, stats);
  }
  return results.map(r => r.status === "fulfilled" ? r.value : null);
}

module.exports = { RequestQueue, fetchWithRetry, batchWithRetry };

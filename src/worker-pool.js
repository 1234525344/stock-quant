// Worker Thread Pool — 通用线程池，用于卸载 CPU 密集型任务
// 支持任务队列、超时、自动重启、优雅关闭
const { Worker } = require("worker_threads");
const os = require("os");
const path = require("path");

const TASK_TIMEOUT = 30_000; // 30 秒超时

// 任务类型 → worker 文件映射
const WORKER_FILES = {
  backtest: path.join(__dirname, "workers", "backtest-worker.js"),
  genetic: path.join(__dirname, "workers", "ga-worker.js"),
  covariance: path.join(__dirname, "workers", "covariance-worker.js"),
};

class WorkerPool {
  /**
   * @param {Object} options
   * @param {number} [options.poolSize] - 工作线程数 (默认: max(2, CPU核心数 - 1))
   * @param {number} [options.taskTimeout] - 单任务超时 (ms)
   */
  constructor(options = {}) {
    const cpuCount = os.cpus().length;
    this.poolSize = options.poolSize || Math.max(2, cpuCount - 1);
    this.taskTimeout = options.taskTimeout || TASK_TIMEOUT;

    this.workers = [];        // 活跃 worker 列表
    this.available = [];      // 空闲 worker 索引队列
    this.taskQueue = [];      // 等待执行的任务 [{taskType, data, resolve, reject, id}]
    this.taskId = 0;          // 自增任务 ID
    this.running = new Map(); // taskId → {worker, timer}
    this.shuttingDown = false;

    this._init();
  }

  // ==================== 初始化 ====================

  _init() {
    for (let i = 0; i < this.poolSize; i++) {
      this._spawnPlaceholder(i);
    }
  }

  // 占位: worker 按需惰性创建 (首次收到任务时)
  _spawnPlaceholder(index) {
    this.workers[index] = null; // null = 未创建
    this.available.push(index);
  }

  /**
   * 真正创建 worker 线程
   * @param {number} index - 池中的槽位
   * @param {string} workerFile - worker 脚本路径
   * @returns {Worker}
   */
  _createWorker(index, workerFile) {
    const worker = new Worker(workerFile);
    worker._workerFile = workerFile;
    worker._poolIndex = index;

    worker.on("error", (err) => {
      console.error(`[WorkerPool] Worker ${index} crashed:`, err.message);
      this._handleWorkerCrash(index, worker);
    });

    worker.on("exit", (code) => {
      if (code !== 0 && !worker._exitedGracefully) {
        console.error(`[WorkerPool] Worker ${index} exited with code ${code}`);
        this._handleWorkerCrash(index, worker);
      }
    });

    this.workers[index] = worker;
    return worker;
  }

  /**
   * worker 崩溃处理: 自动重启 + 将其正在跑的任务重新入队
   */
  _handleWorkerCrash(index, deadWorker) {
    // 如果这个 worker 上有正在跑的任务，找到它并重新入队
    for (const [taskId, info] of this.running) {
      if (info.worker === deadWorker) {
        clearTimeout(info.timer);
        this.running.delete(taskId);
        // 重新入队
        this.taskQueue.push(info.task);
        break;
      }
    }

    // 清理并标记空闲
    deadWorker.removeAllListeners();
    this.workers[index] = null;

    if (!this.shuttingDown) {
      // 恢复空闲状态等待新任务
      if (!this.available.includes(index)) {
        this.available.push(index);
      }
      this._processQueue();
    }
  }

  // ==================== 核心 API ====================

  /**
   * 提交任务到线程池
   * @param {string} taskType - 任务类型: 'backtest' | 'genetic' | 'covariance'
   * @param {Object} data - 传给 worker 的数据
   * @returns {Promise<any>} worker 返回的结果
   */
  run(taskType, data) {
    if (this.shuttingDown) {
      return Promise.reject(new Error("WorkerPool is shutting down"));
    }

    const workerFile = WORKER_FILES[taskType];
    if (!workerFile) {
      return Promise.reject(new Error(`Unknown task type: ${taskType}. Valid types: ${Object.keys(WORKER_FILES).join(", ")}`));
    }

    return new Promise((resolve, reject) => {
      const id = ++this.taskId;
      const task = { id, taskType, workerFile, data, resolve, reject };
      this.taskQueue.push(task);
      this._processQueue();
    });
  }

  // ==================== 调度 ====================

  _processQueue() {
    while (this.taskQueue.length > 0 && this.available.length > 0) {
      const task = this.taskQueue.shift();
      const index = this.available.shift();

      let worker = this.workers[index];
      // 如果 worker 不存在或类型不匹配，重新创建
      if (!worker || worker._workerFile !== task.workerFile) {
        if (worker) {
          worker._exitedGracefully = true;
          worker.terminate().catch(() => {});
        }
        worker = this._createWorker(index, task.workerFile);
      }

      // 设置超时
      const timer = setTimeout(() => {
        console.warn(`[WorkerPool] Task ${task.id} (${task.taskType}) timed out after ${this.taskTimeout}ms`);
        this.running.delete(task.id);
        task.reject(new Error(`Task ${task.taskType} timed out after ${this.taskTimeout}ms`));
        // 杀掉超时 worker 并重启
        worker._exitedGracefully = false;
        worker.terminate();
        this._handleWorkerCrash(index, worker);
      }, this.taskTimeout);

      this.running.set(task.id, { worker, timer, task });

      // 设置一次性消息回调
      const onMessage = (result) => {
        clearTimeout(timer);
        this.running.delete(task.id);
        worker.removeListener("error", onError);
        // 归还 worker
        this.available.push(index);
        task.resolve(result);
        this._processQueue();
      };

      const onError = (err) => {
        clearTimeout(timer);
        this.running.delete(task.id);
        worker.removeListener("message", onMessage);
        task.reject(err);
        // crash 处理由 worker.on('error') 统一管理
      };

      worker.once("message", onMessage);
      worker.once("error", onError);

      // 发送任务
      worker.postMessage({ taskType: task.taskType, data: task.data });
    }
  }

  // ==================== 状态查询 ====================

  /**
   * 返回当前池状态
   */
  status() {
    return {
      poolSize: this.poolSize,
      idleWorkers: this.available.length,
      busyWorkers: this.poolSize - this.available.length,
      queuedTasks: this.taskQueue.length,
      runningTasks: this.running.size,
      shuttingDown: this.shuttingDown,
    };
  }

  // ==================== 优雅关闭 ====================

  /**
   * 等待所有运行中的任务完成，然后关闭所有 worker
   * @param {number} [gracePeriod=10000] - 等待运行中任务的最长时间 (ms)
   * @returns {Promise<void>}
   */
  async shutdown(gracePeriod = 10_000) {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    // 拒绝队列中剩余的任务
    for (const task of this.taskQueue) {
      task.reject(new Error("WorkerPool is shutting down"));
    }
    this.taskQueue = [];

    // 等待运行中的任务完成 (最多等 gracePeriod)
    if (this.running.size > 0) {
      const deadline = Date.now() + gracePeriod;
      while (this.running.size > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // 强制终止所有 worker
    const terminatePromises = this.workers
      .filter(Boolean)
      .map((w) => {
        w._exitedGracefully = true;
        return w.terminate().catch(() => {});
      });

    await Promise.all(terminatePromises);

    // 清理剩余的运行中任务
    for (const [, info] of this.running) {
      clearTimeout(info.timer);
      info.task.reject(new Error("WorkerPool shutdown: task forcibly terminated"));
    }
    this.running.clear();
    this.workers = [];
    this.available = [];
  }
}

// 导出单例 + 类
let _defaultPool = null;

function getPool(options) {
  if (!_defaultPool) {
    _defaultPool = new WorkerPool(options);
  }
  return _defaultPool;
}

module.exports = { WorkerPool, getPool, WORKER_FILES };

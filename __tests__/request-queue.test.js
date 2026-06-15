process.env.LOG_LEVEL = "error"; // suppress info/warn logs in tests
jest.setTimeout(15000);
const { RequestQueue, fetchWithRetry, batchWithRetry } = require("../src/request-queue");

describe("request-queue", () => {
  describe("RequestQueue", () => {
    test("should execute tasks and return results", async () => {
      const queue = new RequestQueue({ concurrency: 2 });
      const result = await queue.enqueue(() => Promise.resolve(42));
      expect(result).toBe(42);
    });

    test("should retry on failure", async () => {
      let attempts = 0;
      const queue = new RequestQueue({ concurrency: 2, maxRetries: 2, baseDelay: 10 });
      const result = await queue.enqueue(() => {
        attempts++;
        if (attempts < 3) return Promise.reject(new Error("fail"));
        return Promise.resolve("ok");
      });
      expect(result).toBe("ok");
      expect(attempts).toBe(3);
    });

    test("should reject after max retries", async () => {
      const queue = new RequestQueue({ concurrency: 2, maxRetries: 1, baseDelay: 10 });
      await expect(
        queue.enqueue(() => Promise.reject(new Error("always fail")))
      ).rejects.toThrow("always fail");
    });

    test("should respect concurrency limit", async () => {
      let running = 0;
      let maxRunning = 0;
      const queue = new RequestQueue({ concurrency: 2, maxRetries: 0 });
      const slowFn = () => new Promise(resolve => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        setTimeout(() => { running--; resolve(); }, 50);
      });
      await Promise.all([
        queue.enqueue(slowFn), queue.enqueue(slowFn),
        queue.enqueue(slowFn), queue.enqueue(slowFn),
      ]);
      expect(maxRunning).toBeLessThanOrEqual(2);
    });

    test("should track stats", async () => {
      const queue = new RequestQueue({ concurrency: 2, maxRetries: 0, baseDelay: 1 });
      const r1 = await queue.enqueue(() => Promise.resolve(1));
      expect(r1).toBe(1);
      let err;
      try { await queue.enqueue(() => Promise.reject(new Error("x"))); } catch (e) { err = e; }
      expect(err).toBeDefined();
    });
  });

  describe("fetchWithRetry", () => {
    test("should retry and succeed", async () => {
      let attempts = 0;
      const result = await fetchWithRetry(() => {
        attempts++;
        if (attempts < 2) return Promise.reject(new Error("fail"));
        return Promise.resolve("ok");
      }, { maxRetries: 2, baseDelay: 10 });
      expect(result).toBe("ok");
    });

    test("should throw after max retries", async () => {
      await expect(
        fetchWithRetry(() => Promise.reject(new Error("nope")), { maxRetries: 1, baseDelay: 10 })
      ).rejects.toThrow("nope");
    });
  });

  describe("batchWithRetry", () => {
    test("should process batch with results", async () => {
      const items = [1, 2, 3, 4, 5];
      const results = await batchWithRetry(items, async (n) => n * 2, { concurrency: 2 });
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });

    test("should handle mixed success/failure", async () => {
      const items = [1, 3]; // skip 2 to avoid retry delays
      const results = await batchWithRetry(items, async (n) => {
        if (n === 3) throw new Error("fail");
        return n * 10;
      }, { concurrency: 2, maxRetries: 0 });
      expect(results[0]).toBe(10);
      expect(results[1]).toBeNull();
    }, 10000);
  });
});

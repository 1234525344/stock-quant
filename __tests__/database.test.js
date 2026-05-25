const path = require("path");
const fs = require("fs");

// 使用临时数据库进行测试
const TEST_DB_PATH = path.join(__dirname, "..", "data", "test.db");

describe("Database", () => {
  let database;

  beforeAll(async () => {
    // 删除测试数据库
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // 动态导入数据库模块
    const databaseModule = require("../src/database");
    await databaseModule.ready;
    database = databaseModule;
  });

  afterAll(() => {
    // 清理测试数据库
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe("Trades", () => {
    test("should insert and retrieve trades", () => {
      const trade = {
        tradeId: `TEST${Date.now()}`,
        code: "000001",
        name: "平安银行",
        action: "buy",
        price: 10.5,
        quantity: 1000,
        amount: 10500,
        commission: 5,
        strategy: "test",
        reason: "test trade",
      };

      database.insertTrade(trade);
      const trades = database.getTrades({ code: "000001" });
      expect(trades.length).toBeGreaterThan(0);
      expect(trades[0].code).toBe("000001");
    });

    test("should get trade stats", () => {
      const stats = database.getTradeStats();
      expect(stats).toHaveProperty("totalTrades");
      expect(stats).toHaveProperty("totalBuy");
      expect(stats).toHaveProperty("totalSell");
    });
  });

  describe("Snapshots", () => {
    test("should insert and retrieve snapshots", () => {
      const snapshot = {
        date: "2026-01-15",
        balance: 1000000,
        positions: { "000001": { quantity: 1000 } },
        totalValue: 1050000,
        pnl: 50000,
        pnlPct: 5,
      };

      database.insertSnapshot(snapshot);
      const snapshots = database.getSnapshots({ days: 7 });
      expect(snapshots.length).toBeGreaterThan(0);
      expect(snapshots[0].date).toBe("2026-01-15");
    });
  });

  describe("Strategies", () => {
    test("should save and retrieve strategies", () => {
      const strategy = {
        name: "test-strategy",
        config: { param1: 10, param2: 20 },
        active: true,
      };

      database.saveStrategy(strategy.name, strategy.config, strategy.active);
      const strategies = database.getStrategies();
      const found = strategies.find(s => s.name === "test-strategy");
      expect(found).toBeDefined();
      expect(found.name).toBe("test-strategy");
    });
  });

  describe("Alerts", () => {
    test("should insert and retrieve alerts", () => {
      const alert = {
        code: "000001",
        type: "price_alert",
        message: "Price above 10",
        data: { price: 10.5 },
      };

      database.insertAlert(alert);
      const alerts = database.getAlerts({ limit: 10 });
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].code).toBe("000001");
    });

    test("should mark alert as read", () => {
      const alerts = database.getAlerts({ limit: 1 });
      if (alerts.length > 0) {
        database.markAlertRead(alerts[0].id);
        const updatedAlerts = database.getAlerts({ limit: 1, unreadOnly: true });
        expect(updatedAlerts.length).toBe(0);
      }
    });
  });

  describe("Performance", () => {
    test("should insert performance data", () => {
      database.insertPerformance({
        lcp: 1200,
        fid: 50,
        cls: 0.05,
        ttfb: 200,
        url: "/test",
        userAgent: "test-agent",
      });
      // Should not throw
      expect(true).toBe(true);
    });

    test("should get performance stats", () => {
      database.insertPerformance({
        lcp: 1000,
        fid: 40,
        cls: 0.03,
        ttfb: 150,
        url: "/",
        userAgent: "test",
      });
      database.insertPerformance({
        lcp: 2000,
        fid: 60,
        cls: 0.07,
        ttfb: 250,
        url: "/",
        userAgent: "test",
      });
      const stats = database.getPerformanceStats();
      if (stats) {
        expect(stats.avgLcp).toBeGreaterThan(0);
        expect(stats.totalSamples).toBeGreaterThan(0);
      }
    });
  });

  describe("Maintenance", () => {
    test("should get DB stats", () => {
      const stats = database.getStats();
      expect(stats).toHaveProperty("trades");
      expect(stats).toHaveProperty("daily_snapshots");
      expect(stats).toHaveProperty("strategies");
      expect(stats).toHaveProperty("alerts");
      expect(stats).toHaveProperty("performance");
    });

    test("should cleanup old data", () => {
      // cleanup with long retention won't delete recent test data
      database.cleanup({ days: 365 });
      // Should not throw
      expect(true).toBe(true);
    });

    test("should run vacuum", () => {
      database.vacuum();
      expect(true).toBe(true);
    });
  });

  describe("Edge cases", () => {
    test("getTrades should return empty for nonexistent code", () => {
      const trades = database.getTrades({ code: "999999" });
      expect(trades).toEqual([]);
    });

    test("getSnapshots should return empty for no data", () => {
      const snapshots = database.getSnapshots({ days: 1 });
      expect(Array.isArray(snapshots)).toBe(true);
    });

    test("getAlerts with unreadOnly should work", () => {
      const alerts = database.getAlerts({ limit: 10, unreadOnly: true });
      expect(Array.isArray(alerts)).toBe(true);
    });

    test("saveStrategy should work without active flag", () => {
      database.saveStrategy("test-edge", { p1: 1 });
      const strategies = database.getStrategies();
      const found = strategies.find(s => s.name === "test-edge");
      expect(found).toBeDefined();
      expect(found.active).toBe(false);
    });
  });
});

const fs = require("fs");
const path = require("path");

describe("Logger", () => {
  let Logger, logger;

  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    // Clean up log files
    const logDir = path.join(__dirname, "..", "logs");
    if (fs.existsSync(logDir)) {
      for (const f of fs.readdirSync(logDir)) {
        fs.unlinkSync(path.join(logDir, f));
      }
    }
    ({ Logger, logger } = require("../src/logger"));
  });

  afterEach(() => {
    const logDir = path.join(__dirname, "..", "logs");
    if (fs.existsSync(logDir)) {
      for (const f of fs.readdirSync(logDir)) {
        fs.unlinkSync(path.join(logDir, f));
      }
    }
  });

  describe("constructor", () => {
    test("should create with default options", () => {
      const log = new Logger();
      expect(log.level).toBe(1); // info
      expect(log.toFile).toBe(true);
      expect(log.toConsole).toBe(true);
    });

    test("should respect debug level from options", () => {
      const log = new Logger({ level: "debug" });
      expect(log.level).toBe(0);
    });

    test("should respect error level from options", () => {
      const log = new Logger({ level: "error" });
      expect(log.level).toBe(3);
    });

    test("should disable file output when toFile is false", () => {
      const log = new Logger({ toFile: false });
      expect(log.toFile).toBe(false);
      expect(log.currentFile).toBeNull();
    });

    test("should disable console output when toConsole is false", () => {
      const log = new Logger({ toConsole: false });
      expect(log.toConsole).toBe(false);
    });

    test("should accept custom maxFileSize and maxFiles", () => {
      const log = new Logger({ maxFileSize: 5 * 1024 * 1024, maxFiles: 3 });
      expect(log.maxFileSize).toBe(5 * 1024 * 1024);
      expect(log.maxFiles).toBe(3);
    });
  });

  describe("logging methods", () => {
    test("should log debug messages", () => {
      const log = new Logger({ level: "debug", toFile: false });
      const spy = jest.spyOn(console, "log").mockImplementation(() => {});
      log.debug("test debug");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    test("should log info messages", () => {
      const log = new Logger({ toFile: false });
      const spy = jest.spyOn(console, "log").mockImplementation(() => {});
      log.info("test info");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    test("should log warn messages", () => {
      const log = new Logger({ toFile: false });
      const spy = jest.spyOn(console, "log").mockImplementation(() => {});
      log.warn("test warn");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    test("should log error messages", () => {
      const log = new Logger({ toFile: false });
      const spy = jest.spyOn(console, "log").mockImplementation(() => {});
      log.error("test error");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    test("should NOT log debug when level is info", () => {
      const log = new Logger({ level: "info", toFile: false });
      const spy = jest.spyOn(console, "log").mockImplementation(() => {});
      log.debug("should not appear");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    test("should NOT log info when level is warn", () => {
      const log = new Logger({ level: "warn", toFile: false });
      const spy = jest.spyOn(console, "log").mockImplementation(() => {});
      log.info("should not appear");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    test("should still log error when level is error only", () => {
      const log = new Logger({ level: "error", toFile: false });
      const spy = jest.spyOn(console, "log").mockImplementation(() => {});
      log.warn("should not appear");
      expect(spy).not.toHaveBeenCalled();
      log.error("should appear");
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("file logging", () => {
    test("should write log to file", () => {
      const log = new Logger({ toConsole: false });
      log.info("file test");
      expect(log.currentFile).not.toBeNull();
      expect(fs.existsSync(log.currentFile)).toBe(true);
      const content = fs.readFileSync(log.currentFile, "utf8");
      expect(content).toContain("file test");
      expect(content).toContain("info");
    });

    test("should write log with meta data", () => {
      const log = new Logger({ toConsole: false });
      log.error("error with meta", { code: "ERR01" });
      const content = fs.readFileSync(log.currentFile, "utf8");
      expect(content).toContain("ERR01");
    });
  });

  describe("level filtering with env var", () => {
    beforeEach(() => {
      delete process.env.LOG_LEVEL;
      jest.resetModules();
    });

    test("should respect LOG_LEVEL env var", () => {
      process.env.LOG_LEVEL = "debug";
      jest.resetModules();
      const { Logger: L2 } = require("../src/logger");
      const log = new L2({ toFile: false });
      expect(log.level).toBe(0);
      delete process.env.LOG_LEVEL;
    });
  });

  describe("child logger", () => {
    beforeEach(() => {
      delete process.env.LOG_LEVEL;
    });
    test("should create child with prefix", () => {
      const log = new Logger({ toFile: false });
      const spy = jest.spyOn(console, "log").mockImplementation(() => {});
      const child = log.child("TEST");
      child.info("hello");
      expect(spy).toHaveBeenCalled();
      const call = spy.mock.calls[0][0];
      expect(call).toContain("[TEST]");
      expect(call).toContain("hello");
      spy.mockRestore();
    });

    test("child should support all log levels", () => {
      const log = new Logger({ level: "debug", toFile: false });
      const spy = jest.spyOn(console, "log").mockImplementation(() => {});
      const child = log.child("CHILD");
      child.debug("d"); child.info("i"); child.warn("w"); child.error("e");
      expect(spy).toHaveBeenCalledTimes(4);
      spy.mockRestore();
    });
  });

  describe("singleton logger", () => {
    test("should export a default logger instance", () => {
      const { logger: lg } = require("../src/logger");
      expect(lg).toBeDefined();
      expect(typeof lg.info).toBe("function");
      expect(typeof lg.debug).toBe("function");
      expect(typeof lg.warn).toBe("function");
      expect(typeof lg.error).toBe("function");
      expect(typeof lg.child).toBe("function");
    });
  });

  describe("log rotation", () => {
    test("should rotate when file size exceeds max", () => {
      const log = new Logger({ toConsole: false, maxFileSize: 200 });
      // Write enough to trigger rotation
      for (let i = 0; i < 20; i++) {
        log.info("rotation test message " + "x".repeat(50));
      }
      // File should still exist
      expect(fs.existsSync(log.currentFile)).toBe(true);
    });
  });
});

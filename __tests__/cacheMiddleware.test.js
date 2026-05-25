const { cacheMiddleware, cacheHeaders, clearCache, responseCache } = require("../src/middleware/cache");
const { TTLCache } = require("../src/cache");

describe("cacheMiddleware", () => {
  let req, res, next;

  beforeEach(() => {
    responseCache.clear();
    req = { method: "GET", originalUrl: "/api/test" };
    res = {
      json: jest.fn(),
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  test("should cache JSON response", () => {
    const middleware = cacheMiddleware(60000);
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate response
    res.json({ data: "cached" });
    expect(res.set).toHaveBeenCalledWith("X-Cache", "MISS");
  });

  test("should return cached response on second request", () => {
    const middleware = cacheMiddleware(60000);

    // First request
    middleware(req, res, next);
    res.json({ data: "test" });

    // Second request — should hit cache
    const cachedJson = jest.fn();
    const res2 = { json: cachedJson, set: jest.fn(), status: jest.fn().mockReturnThis() };
    const next2 = jest.fn();
    middleware(req, res2, next2);
    expect(res2.set).toHaveBeenCalledWith("X-Cache", "HIT");
    expect(cachedJson).toHaveBeenCalledWith({ data: "test" });
  });

  test("should skip caching for non-GET requests", () => {
    req.method = "POST";
    const middleware = cacheMiddleware(60000);
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("should use custom key function", () => {
    const keyFn = jest.fn().mockReturnValue("custom-key");
    const middleware = cacheMiddleware(60000, keyFn);
    middleware(req, res, next);
    expect(keyFn).toHaveBeenCalled();
  });
});

describe("cacheHeaders", () => {
  test("should set Cache-Control header", () => {
    const req = {};
    const res = { set: jest.fn() };
    const next = jest.fn();
    cacheHeaders(30)(req, res, next);
    expect(res.set).toHaveBeenCalledWith("Cache-Control", "public, max-age=30");
    expect(res.set).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(next).toHaveBeenCalled();
  });
});

describe("clearCache", () => {
  test("should clear all cache", () => {
    responseCache.cache.set("key1", { value: "val1", expiry: Date.now() + 99999 });
    responseCache.cache.set("key2", { value: "val2", expiry: Date.now() + 99999 });
    expect(responseCache.size).toBe(2);
    clearCache();
    expect(responseCache.size).toBe(0);
  });

  test("should clear cache matching pattern", () => {
    responseCache.cache.set("api/test", { value: "v1", expiry: Date.now() + 99999 });
    responseCache.cache.set("api/other", { value: "v2", expiry: Date.now() + 99999 });
    clearCache("test");
    expect(responseCache.cache.has("api/test")).toBe(false);
    expect(responseCache.cache.has("api/other")).toBe(true);
  });
});

describe("responseCache singleton", () => {
  test("should be a TTLCache instance", () => {
    expect(responseCache).toBeInstanceOf(TTLCache);
    expect(responseCache.maxSize).toBe(200);
  });
});

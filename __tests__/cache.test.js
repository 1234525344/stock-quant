const { TTLCache } = require("../src/cache");

describe("TTLCache", () => {
  let cache;

  beforeEach(() => {
    cache = new TTLCache({ maxSize: 5, defaultTTL: 1000 });
  });

  afterEach(() => {
    cache.clear();
  });

  test("should set and get values", () => {
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  test("should return undefined for expired keys", (done) => {
    cache.set("key1", "value1", 100); // 100ms TTL
    setTimeout(() => {
      expect(cache.get("key1")).toBeUndefined();
      done();
    }, 150);
  });

  test("should evict LRU when max size reached", () => {
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.set("key3", "value3");
    cache.set("key4", "value4");
    cache.set("key5", "value5");

    // Add one more, should evict key1 (oldest)
    cache.set("key6", "value6");

    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBe("value2");
    expect(cache.size).toBe(5);
  });

  test("should check if key exists", () => {
    cache.set("key1", "value1");
    expect(cache.has("key1")).toBe(true);
    expect(cache.has("key2")).toBe(false);
  });

  test("should delete key", () => {
    cache.set("key1", "value1");
    cache.delete("key1");
    expect(cache.get("key1")).toBeUndefined();
  });

  test("should clear all entries", () => {
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.clear();
    expect(cache.size).toBe(0);
  });

  test("should update existing key", () => {
    cache.set("key1", "value1");
    cache.set("key1", "value2");
    expect(cache.get("key1")).toBe("value2");
    expect(cache.size).toBe(1);
  });
});

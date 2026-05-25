// TTL Cache (LRU淘汰)
class TTLCache {
  constructor({ maxSize = 500, defaultTTL = 30000 } = {}) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.cache = new Map();
    this.timers = new Map();
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (Date.now() > item.expiry) {
      this.delete(key);
      return undefined;
    }
    // LRU: 移到最新
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  set(key, value, ttl) {
    if (this.cache.has(key)) {
      this.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 淘汰最旧的（Map迭代器第一个）
      const oldestKey = this.cache.keys().next().value;
      this.delete(oldestKey);
    }
    const expiry = Date.now() + (ttl || this.defaultTTL);
    this.cache.set(key, { value, expiry });
    // 设置自动淘汰
    const timer = setTimeout(() => this.delete(key), ttl || this.defaultTTL);
    this.timers.set(key, timer);
  }

  has(key) {
    const item = this.cache.get(key);
    if (!item) return false;
    if (Date.now() > item.expiry) {
      this.delete(key);
      return false;
    }
    return true;
  }

  delete(key) {
    this.cache.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  get size() {
    return this.cache.size;
  }

  clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.cache.clear();
    this.timers.clear();
  }
}

module.exports = { TTLCache };

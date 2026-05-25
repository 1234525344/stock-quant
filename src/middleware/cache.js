// HTTP 响应缓存中间件
const { TTLCache } = require("../cache");

// 响应缓存实例
const responseCache = new TTLCache({ maxSize: 200, defaultTTL: 60000 });

/**
 * HTTP 响应缓存中间件
 * @param {number} ttl - 缓存时间 (毫秒)
 * @param {Function} keyFn - 自定义缓存键生成函数
 */
function cacheMiddleware(ttl = 60000, keyFn = null) {
  return (req, res, next) => {
    // 只缓存 GET 请求
    if (req.method !== "GET") {
      return next();
    }

    const cacheKey = keyFn ? keyFn(req) : `${req.originalUrl}`;
    const cached = responseCache.get(cacheKey);

    if (cached) {
      res.set("X-Cache", "HIT");
      return res.json(cached);
    }

    // 拦截 res.json 方法
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      responseCache.set(cacheKey, data, ttl);
      res.set("X-Cache", "MISS");
      return originalJson(data);
    };

    next();
  };
}

/**
 * 设置 Cache-Control 头的中间件
 * @param {number} maxAge - 最大缓存时间 (秒)
 */
function cacheHeaders(maxAge = 60) {
  return (req, res, next) => {
    res.set("Cache-Control", `public, max-age=${maxAge}`);
    res.set("X-Content-Type-Options", "nosniff");
    next();
  };
}

/**
 * 清除缓存
 */
function clearCache(pattern) {
  if (!pattern) {
    responseCache.clear();
    return;
  }
  // 简单的模式匹配清除
  for (const key of responseCache.cache.keys()) {
    if (key.includes(pattern)) {
      responseCache.delete(key);
    }
  }
}

module.exports = { cacheMiddleware, cacheHeaders, clearCache, responseCache };

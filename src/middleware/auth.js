// API Key 认证中间件 — 用于付费 API 月卡
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { getDataDir } = require("../data-dir");
const KEY_FILE = path.join(getDataDir(), "api-keys.json");

// 内存缓存 — 启动时加载, 避免每次请求读盘
let keysCache = null;

function loadKeys() {
  if (keysCache) return keysCache;
  try {
    if (fs.existsSync(KEY_FILE)) {
      keysCache = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
      return keysCache;
    }
  } catch (e) { /* ignore */ }
  keysCache = [];
  return keysCache;
}

async function saveKeys(keys) {
  keysCache = keys; // 立即更新缓存
  const dir = path.dirname(KEY_FILE);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(KEY_FILE, JSON.stringify(keys, null, 2), "utf8");
  } catch (e) { /* 写盘失败不阻塞 — 缓存已有最新数据 */ }
}

// 生成新 key
function createKey(plan = "monthly", note = "", owner = null) {
  const keys = loadKeys();
  const key = "sk-" + crypto.randomBytes(24).toString("hex");
  const now = new Date();

  let expiresAt = null;
  if (plan === "monthly") {
    expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30天
  } else if (plan === "yearly") {
    expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  }

  const entry = {
    key,
    plan,
    note,
    owner: owner || "admin",
    enabled: true,
    createdAt: now.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    lastUsed: null,
    requestCount: 0,
    dailyCounts: {},
  };
  keys.push(entry);
  saveKeys(keys);
  return entry;
}

// 验证 key
function validateKey(key) {
  const keys = loadKeys();
  const entry = keys.find(k => k.key === key && k.enabled);
  if (!entry) return null;

  // 检查过期
  if (entry.expiresAt && new Date() > new Date(entry.expiresAt)) {
    entry.enabled = false;
    saveKeys(keys);
    return null;
  }

  return entry;
}

// 记录使用
function recordUsage(key) {
  const keys = loadKeys();
  const entry = keys.find(k => k.key === key);
  if (!entry) return;

  entry.lastUsed = new Date().toISOString();
  entry.requestCount++;

  const today = new Date().toISOString().slice(0, 10);
  entry.dailyCounts[today] = (entry.dailyCounts[today] || 0) + 1;

  // 每日上限 500 次
  if (entry.dailyCounts[today] > 500) return false;

  saveKeys(keys);
  return true;
}

// 列出所有 keys (管理端 — 截断 key)
function listKeys() {
  return loadKeys().map(k => ({ ...k, key: k.key.slice(0, 10) + "..." }));
}

// 列出某用户自己的 keys (返回完整 key)
function listMyKeys(owner) {
  return loadKeys().filter(k => k.owner === owner && k.enabled);
}

// 禁用 key
function disableKey(key) {
  const keys = loadKeys();
  const entry = keys.find(k => k.key === key);
  if (entry) { entry.enabled = false; saveKeys(keys); }
  return entry;
}

// 用户禁用自己的 key
function disableMyKey(key, owner) {
  const keys = loadKeys();
  const entry = keys.find(k => k.key === key && k.owner === owner);
  if (entry) { entry.enabled = false; saveKeys(keys); }
  return entry;
}

// 中间件 — 只验证 API key，不强制
function apiKeyAuth(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.api_key;
  if (!key) return next(); // 继续但不标记

  const entry = validateKey(key);
  if (!entry) {
    return res.status(403).json({ error: "API Key 无效或已过期" });
  }

  const ok = recordUsage(key);
  if (!ok) {
    return res.status(429).json({ error: "今日请求次数已用完(500次/天)" });
  }

  req.apiKeyEntry = entry;
  next();
}

// 强制认证中间件
function requireAuth(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.api_key;
  if (!key) return res.status(401).json({ error: "需要 API Key，请在请求头传 x-api-key" });

  const entry = validateKey(key);
  if (!entry) {
    return res.status(403).json({ error: "API Key 无效或已过期" });
  }

  const ok = recordUsage(key);
  if (!ok) {
    return res.status(429).json({ error: "今日请求次数已用完(500次/天)" });
  }

  req.apiKeyEntry = entry;
  next();
}

module.exports = { apiKeyAuth, requireAuth, createKey, listKeys, listMyKeys, disableKey, disableMyKey, validateKey };

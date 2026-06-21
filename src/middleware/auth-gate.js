/**
 * 密码访问控制 — 月度轮换密码 + 多用户支持
 * cookie 持续使用自动续期 | 每月1号自动换新密码 | 持久化到文件
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const COOKIE_NAME = "qp_auth";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_FILE = path.join(__dirname, "..", "..", "data", "access-password.json");

// ===== 密码管理 =====

let passwordCache = null;
let passwordCacheTime = 0;

function _ensureDir() {
  const d = path.dirname(PASSWORD_FILE);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function _readPasswordFile() {
  _ensureDir();
  if (fs.existsSync(PASSWORD_FILE)) {
    try { return JSON.parse(fs.readFileSync(PASSWORD_FILE, "utf-8")); } catch (_) {}
  }
  return {};
}

function _writePasswordFile(data) {
  _ensureDir();
  fs.promises.writeFile(PASSWORD_FILE, JSON.stringify(data, null, 2), "utf-8").catch(() => {});
}

function getCurrentPassword() {
  const now = Date.now();
  if (passwordCache && (now - passwordCacheTime) < 3600000) return passwordCache;
  _ensureDir();
  const d = new Date();
  const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  let data = _readPasswordFile();

  // 兼容旧格式: { "2026-06": "xxx" } → { passwords: {...}, users: [] }
  if (!data.passwords) {
    data = { passwords: data, users: [] };
    _writePasswordFile(data);
  }

  if (data.passwords[mk]) {
    passwordCache = data.passwords[mk];
    passwordCacheTime = now;
    return data.passwords[mk];
  }
  // 生成新密码: qp-202606-a3f2c1
  const suffix = crypto.randomBytes(3).toString("hex");
  const pwd = `qp-${mk.replace('-','')}-${suffix}`;
  data.passwords[mk] = pwd;
  // 只保留最近3个月
  const keys = Object.keys(data.passwords).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - 3))) delete data.passwords[old];
  _writePasswordFile(data);
  passwordCache = pwd;
  passwordCacheTime = now;
  return pwd;
}

// 哈希比较
function _hash(input) {
  return crypto.createHash("sha256").update(input || "").digest("hex");
}

// 检查密码: 先查用户密码, 再查月度密码
function checkPassword(input) {
  const ihash = _hash(input);
  const correct = getCurrentPassword();
  if (ihash === _hash(correct)) return { valid: true, type: "monthly", userId: null };

  // 检查用户密码
  const data = _readPasswordFile();
  if (data.users) {
    for (const u of data.users) {
      if (u.enabled && u.password === ihash) {
        return { valid: true, type: "user", userId: u.id, userName: u.name };
      }
    }
  }
  return { valid: false };
}

function getPasswordInfo() {
  _ensureDir();
  const now = new Date();
  const mk = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const data = _readPasswordFile();
  const passwords = data.passwords || data;
  const pwd = passwords[mk] || getCurrentPassword();
  const next = new Date(now.getFullYear(), now.getMonth()+1, 1);
  return {
    currentPassword: pwd, monthKey: mk,
    daysLeft: Math.ceil((next - now) / 86400000),
    nextChange: next.toISOString().slice(0, 10),
    history: passwords,
    userCount: (data.users || []).filter(u => u.enabled).length,
  };
}

// ===== 多用户管理 =====

function createUser(name, customPassword) {
  const data = _readPasswordFile();
  if (!data.users) data.users = [];

  const id = "u" + crypto.randomBytes(4).toString("hex");
  const entry = {
    id, name,
    password: _hash(customPassword),
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  data.users.push(entry);
  _writePasswordFile(data);
  return { id: entry.id, name: entry.name, createdAt: entry.createdAt };
}

function listUsers() {
  const data = _readPasswordFile();
  return (data.users || []).map(u => ({
    id: u.id, name: u.name, enabled: u.enabled, createdAt: u.createdAt,
  }));
}

function disableUser(id) {
  const data = _readPasswordFile();
  const user = (data.users || []).find(u => u.id === id);
  if (user) { user.enabled = false; _writePasswordFile(data); }
  return user;
}

function enableUser(id) {
  const data = _readPasswordFile();
  const user = (data.users || []).find(u => u.id === id);
  if (user) { user.enabled = true; _writePasswordFile(data); }
  return user;
}

function resetUserPassword(id, newPassword) {
  const data = _readPasswordFile();
  const user = (data.users || []).find(u => u.id === id);
  if (!user) return null;
  user.password = _hash(newPassword);
  _writePasswordFile(data);
  return { id: user.id, name: user.name };
}

// ===== Token 管理（持久化到磁盘） =====

const TOKEN_FILE = path.join(__dirname, "..", "..", "data", "auth-tokens.json");

const tokens = new Map();

async function _saveTokens() {
  _ensureDir();
  const obj = Object.fromEntries(tokens);
  try { await fs.promises.writeFile(TOKEN_FILE, JSON.stringify(obj), "utf-8"); } catch (_) {}
}

function _loadTokens() {
  if (!fs.existsSync(TOKEN_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    for (const [k, v] of Object.entries(data)) tokens.set(k, v);
  } catch (_) {}
}

function generateToken(ip, userId) {
  const t = crypto.randomBytes(32).toString("hex");
  tokens.set(t, {
    expires: Date.now() + COOKIE_MAX_AGE,
    ip, userId: userId || null,
    at: new Date().toISOString(),
  });
  _saveTokens();
  return t;
}

function verifyToken(t) {
  const d = tokens.get(t);
  if (!d) return false;
  if (Date.now() > d.expires) { tokens.delete(t); _saveTokens(); return false; }
  d.expires = Date.now() + COOKIE_MAX_AGE; // 续期
  return true;
}

function getTokenInfo(t) {
  return tokens.get(t) || null;
}

function refreshCookie(res, t, req) {
  var isSecure = !!(req && (req.secure || (req.headers && req.headers["x-forwarded-proto"] === "https")));
  res.cookie(COOKIE_NAME, t, { maxAge: COOKIE_MAX_AGE, httpOnly: true, secure: isSecure, sameSite: "lax", path: "/" });
}

setInterval(() => {
  const n = Date.now();
  let changed = false;
  for (const [k, v] of tokens) if (n > v.expires) { tokens.delete(k); changed = true; }
  if (changed) _saveTokens();
}, 3600000);

_loadTokens();
getCurrentPassword(); // 启动时确保密码已生成

module.exports = {
  checkPassword, getPasswordInfo,
  generateToken, verifyToken, getTokenInfo,
  refreshCookie, COOKIE_NAME, COOKIE_MAX_AGE,
  createUser, listUsers, disableUser, enableUser, resetUserPassword,
};

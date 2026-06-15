/**
 * 密码访问控制 — 月度轮换密码
 * cookie 持续使用自动续期 | 每月1号自动换新密码 | 持久化到文件
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const COOKIE_NAME = "qp_auth";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_FILE = path.join(__dirname, "..", "..", "data", "access-password.json");

// ===== 密码管理 =====

// 内存缓存 — 每小时自动刷新
let passwordCache = null;
let passwordCacheTime = 0;

function _ensureDir() {
  const d = path.dirname(PASSWORD_FILE);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function getCurrentPassword() {
  const now = Date.now();
  if (passwordCache && (now - passwordCacheTime) < 3600000) return passwordCache;
  _ensureDir();
  const d = new Date();
  const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  let data = {};
  if (fs.existsSync(PASSWORD_FILE)) {
    try { data = JSON.parse(fs.readFileSync(PASSWORD_FILE, "utf-8")); } catch(_) {}
  }
  if (data[mk]) {
    passwordCache = data[mk];
    passwordCacheTime = now;
    return data[mk];
  }
  // 生成新密码: qp-202606-a3f2c1
  const suffix = crypto.randomBytes(3).toString("hex");
  const pwd = `qp-${mk.replace('-','')}-${suffix}`;
  data[mk] = pwd;
  // 只保留最近3个月
  const keys = Object.keys(data).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - 3))) delete data[old];
  // 异步写盘
  fs.promises.writeFile(PASSWORD_FILE, JSON.stringify(data, null, 2), "utf-8").catch(() => {});
  passwordCache = pwd;
  passwordCacheTime = now;
  return pwd;
}

function checkPassword(input) {
  const correct = getCurrentPassword();
  return crypto.createHash("sha256").update(input||"").digest("hex")
    === crypto.createHash("sha256").update(correct).digest("hex");
}

function getPasswordInfo() {
  _ensureDir();
  const now = new Date();
  const mk = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  let data = {};
  if (fs.existsSync(PASSWORD_FILE)) {
    try { data = JSON.parse(fs.readFileSync(PASSWORD_FILE, "utf-8")); } catch(_) {}
  }
  const pwd = data[mk] || getCurrentPassword();
  const next = new Date(now.getFullYear(), now.getMonth()+1, 1);
  return { currentPassword: pwd, monthKey: mk, daysLeft: Math.ceil((next-now)/86400000), nextChange: next.toISOString().slice(0,10), history: data };
}

// ===== Token 管理（持久化到磁盘） =====

const TOKEN_FILE = path.join(__dirname, "..", "..", "data", "auth-tokens.json");

const tokens = new Map();

async function _saveTokens() {
  _ensureDir();
  const obj = Object.fromEntries(tokens);
  try { await fs.promises.writeFile(TOKEN_FILE, JSON.stringify(obj), "utf-8"); } catch(_) {}
}

function _loadTokens() {
  if (!fs.existsSync(TOKEN_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    for (const [k, v] of Object.entries(data)) tokens.set(k, v);
  } catch(_) {}
}

function generateToken(ip) {
  const t = crypto.randomBytes(32).toString("hex");
  tokens.set(t, { expires: Date.now()+COOKIE_MAX_AGE, ip, at: new Date().toISOString() });
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

function refreshCookie(res, t) {
  res.cookie(COOKIE_NAME, t, { maxAge: COOKIE_MAX_AGE, httpOnly: true, secure: false, sameSite: "lax", path: "/" });
}

setInterval(() => {
  const n = Date.now();
  let changed = false;
  for (const [k, v] of tokens) if (n > v.expires) { tokens.delete(k); changed = true; }
  if (changed) _saveTokens();
}, 3600000);

_loadTokens(); // 启动时恢复已登录 token
getCurrentPassword(); // 启动时确保密码已生成

module.exports = { checkPassword, getPasswordInfo, generateToken, verifyToken, refreshCookie, COOKIE_NAME, COOKIE_MAX_AGE };

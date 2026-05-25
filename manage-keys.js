// API Key 管理命令行工具
// 用法: node manage-keys.js [create|list|disable] [options]
const http = require("http");

const BASE = "http://localhost:3456";

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method, headers: { "Content-Type": "application/json" } };
    const r = http.request(opts, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  const cmd = process.argv[2] || "list";

  if (cmd === "create") {
    const plan = process.argv[3] || "monthly";
    const note = process.argv[4] || "";
    const result = await req("POST", "/api/admin/keys", { plan, note });
    console.log("✅ Key 已生成:\n");
    console.log("   Key:       " + result.key);
    console.log("   套餐:      " + result.plan);
    console.log("   过期时间:  " + (result.expiresAt || "永不过期"));
    console.log("\n   发送给用户: 请求头加 x-api-key: " + result.key);
  } else if (cmd === "list") {
    const result = await req("GET", "/api/admin/keys");
    if (!result.keys || result.keys.length === 0) {
      console.log("📭 暂无 API Key\n   创建: node manage-keys.js create monthly");
      return;
    }
    console.log("📋 API Keys:\n");
    result.keys.forEach(k => {
      const status = k.enabled ? "✅" : "🚫";
      const expires = k.expiresAt ? " 到期:" + k.expiresAt.slice(0, 10) : " 永久";
      console.log(`   ${status} ${k.key}  [${k.plan}]${expires}  请求:${k.requestCount}次`);
    });
    console.log(`\n   共 ${result.keys.length} 个`);
  } else if (cmd === "disable") {
    const key = process.argv[3];
    if (!key) { console.log("用法: node manage-keys.js disable <key>"); return; }
    await req("DELETE", "/api/admin/keys/" + key);
    console.log("✅ 已禁用: " + key.slice(0, 16) + "...");
  } else {
    console.log("用法: node manage-keys.js [create|list|disable]");
  }
}

main().catch(e => console.error("❌", e.message));

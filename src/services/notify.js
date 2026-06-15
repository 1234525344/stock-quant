/**
 * 微信通知服务 — WxPusher
 * 完全免费，无日限
 * 只需微信扫码关注公众号即可接收消息
 */
const https = require("https");

const WXPUSHER_API = "https://wxpusher.zjiecode.com/api/send/message";

/** 发送 WxPusher 通知 */
async function sendWxPusher({ appToken, uids }, { title, content }) {
  if (!appToken) throw new Error("WxPusher AppToken 未配置");
  if (!uids || uids.length === 0) throw new Error("WxPusher UID 未配置");
  const body = JSON.stringify({
    appToken,
    content,
    summary: title,
    contentType: 2,
    uids,
  });
  return new Promise((resolve, reject) => {
    const req = https.request(WXPUSHER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 10000,
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 1000) resolve(json);
          else reject(new Error(json.msg || `WxPusher 返回: ${json.code}`));
        } catch (e) { reject(new Error("解析 WxPusher 响应失败")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("WxPusher 请求超时")); });
    req.write(body);
    req.end();
  });
}

/** 格式化交易通知（Markdown 格式） */
function formatTradeMessage(trade, strategyName) {
  const isBuy = trade.side === "buy";
  const emoji = isBuy ? "📈" : "📉";
  const action = isBuy ? "买入" : "卖出";
  let pnlLine = "";
  if (!isBuy && trade.pnl !== undefined) {
    const pnlPct = trade.pnlPercent || 0;
    const sign = trade.pnl >= 0 ? "+" : "";
    pnlLine = `\n> 盈亏: **${sign}${trade.pnl.toFixed(2)} 元 (${sign}${pnlPct.toFixed(2)}%)**`;
  }
  return {
    title: `${emoji} ${action} ${trade.name || trade.code}`,
    content: `> 股票: **${trade.name || ""} (${trade.code})**\n> 价格: ${trade.price.toFixed(2)} 元\n> 数量: ${trade.quantity} 股\n> 金额: ${(trade.price * trade.quantity).toFixed(2)} 元${strategyName ? `\n> 策略: ${strategyName}` : ""}\n> 时间: ${trade.time || new Date().toLocaleString("zh-CN")}${pnlLine}`,
  };
}

/** 格式化每日汇总 */
function formatDailySummary(summary) {
  const { date, trades, pnl, winRate, positions, equity } = summary;
  const sign = pnl >= 0 ? "+" : "";
  const tradesLines = trades.length > 0
    ? trades.map(t => {
        const icon = t.side === "buy" ? "📈" : "📉";
        const pnlText = t.pnl !== undefined ? ` | ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}` : "";
        return `> ${icon} ${t.name || t.code} ${t.side === "buy" ? "买" : "卖"} ${t.quantity}股 @ ${t.price.toFixed(2)}${pnlText}`;
      }).join("\n")
    : "> 今日无交易";
  const posLines = positions.length > 0
    ? positions.map(p => {
        const pSign = p.unrealizedPnl >= 0 ? "+" : "";
        return `> ${p.name || p.code} ${p.quantity}股 成本${p.avgCost.toFixed(2)} 现价${p.currentPrice.toFixed(2)} ${pSign}${p.unrealizedPnl.toFixed(2)}`;
      }).join("\n")
    : "> 无持仓";
  return {
    title: `📊 每日汇总 - ${date}`,
    content: `> 日期: **${date}**\n> 总资产: **${equity.toFixed(2)} 元**\n> 今日盈亏: **${sign}${pnl.toFixed(2)} 元**\n> 胜率: **${winRate}%**\n\n**📋 交易 (${trades.length}笔)**\n${tradesLines}\n\n**💼 持仓 (${positions.length}只)**\n${posLines}`,
  };
}

/** 测试通知 */
async function testNotify(config) {
  return sendWxPusher(config, {
    title: "✅ 量化平台通知测试",
    content: `> 通知连接成功！\n> 时间: ${new Date().toLocaleString("zh-CN")}\n> 每次交易将自动推送到微信。`,
  });
}

module.exports = { sendWxPusher, formatTradeMessage, formatDailySummary, testNotify };

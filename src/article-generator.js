// 公众号文章素材自动生成器
// 每天从量化平台API拉数据，输出排版好的文章，复制即可发布
const { getRealtimeQuotes } = require("./data");
const { getIndexQuotes, getSectorPerformance, getSectorFlow, getConceptFlow } = require("./index");

const STOCK_POOL = ["600519", "000858", "300750", "601318", "002415", "000333", "601012", "600036"];

// 内置市场总览摘要生成器
async function getMarketSummary() {
  const [indices, sectors] = await Promise.all([
    getIndexQuotes().catch(() => []),
    getSectorPerformance().catch(() => []),
  ]);

  let totalChg = 0, upCount = 0, downCount = 0;
  indices.forEach(i => {
    totalChg += i.changePct || 0;
    if (i.changePct > 0) upCount++;
    else if (i.changePct < 0) downCount++;
  });
  const avgChg = indices.length > 0 ? totalChg / indices.length : 0;

  const topSectors = [...sectors].sort((a, b) => (b.changePct || 0) - (a.changePct || 0)).slice(0, 5);
  const bottomSectors = [...sectors].sort((a, b) => (a.changePct || 0) - (b.changePct || 0)).slice(0, 5);

  let mood, moodColor, summary;
  if (avgChg > 1.5) {
    mood = "强势上涨"; summary = `市场整体表现强劲，${upCount}个主要指数上涨。${topSectors[0]?.name || "—"}板块领涨，市场情绪乐观。`;
  } else if (avgChg > 0.3) {
    mood = "温和上涨"; summary = `市场温和走强，多数指数小幅上涨。${topSectors[0]?.name || "—"}板块表现较好。整体环境偏积极。`;
  } else if (avgChg < -1.5) {
    mood = "明显下跌"; summary = `市场整体下跌幅度较大，${downCount}个主要指数下跌。${bottomSectors[0]?.name || "—"}等板块跌幅居前。建议控制仓位。`;
  } else if (avgChg < -0.3) {
    mood = "小幅回调"; summary = `市场小幅回调，属于正常波动范围。整体风险可控。`;
  } else {
    mood = "横盘震荡"; summary = `市场整体波动不大，方向不明确。板块轮动较快，缺乏持续热点。多看少动。`;
  }

  return {
    indices, sectors,
    marketMood: { mood, moodColor, summary },
    topSectors, bottomSectors,
    upCount, downCount, avgChg,
  };
}

async function generateDailyArticle() {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][today.getDay()];

  // 1. 获取市场数据
  let summary = null, sectors = [], concepts = [], quotes = [];
  try {
    [summary, sectors, concepts, quotes] = await Promise.all([
      getMarketSummary().catch(() => null),
      getSectorFlow().catch(() => []),
      getConceptFlow().catch(() => []),
      getRealtimeQuotes(STOCK_POOL).catch(() => []),
    ]);
  } catch (e) {}

  // 2. 构建文章
  let article = "";

  // 标题
  const moodText = summary?.marketMood?.mood || "市场观察";
  article += `【每日量化分析】${dateStr} 周${weekday}\n`;
  article += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // 市场天气
  article += `📊 今日市场情绪\n`;
  article += `${moodText}\n`;
  if (summary?.marketMood?.summary) {
    article += `${summary.marketMood.summary}\n`;
  }
  article += `\n`;

  // 指数行情
  if (summary?.indices?.length) {
    article += `📈 主要指数\n`;
    for (const idx of summary.indices.slice(0, 5)) {
      const arrow = (idx.changePct || 0) >= 0 ? "🔴" : "🟢";
      const sign = (idx.changePct || 0) >= 0 ? "+" : "";
      article += `${arrow} ${idx.name}: ${idx.price?.toFixed(2) || "--"}  ${sign}${(idx.changePct || 0).toFixed(2)}%\n`;
    }
    article += `\n`;
  }

  // 板块资金 TOP/BOTTOM — 跳过全零数据（非交易时段）
  const sectorNonZero = sectors.filter(s => Math.abs(s.mainFlow || 0) > 0);
  if (sectorNonZero.length >= 3) {
    const sorted = [...sectorNonZero].sort((a, b) => (b.mainFlow || 0) - (a.mainFlow || 0));
    article += `🔥 主力资金大幅流入板块 TOP5\n`;
    for (const s of sorted.slice(0, 5)) {
      article += `${s.name}: ${fmtFlowYuan(s.mainFlow || 0)}\n`;
    }
    article += `\n`;
    article += `❄️ 主力资金大幅流出板块 TOP5\n`;
    for (const s of sorted.slice(-5).reverse()) {
      article += `${s.name}: ${fmtFlowYuan(s.mainFlow || 0)}\n`;
    }
    article += `\n`;
  }

  // 概念板块热榜 — 跳过全零数据
  const conceptNonZero = concepts.filter(c => Math.abs(c.flow || 0) > 0);
  if (conceptNonZero.length >= 3) {
    const hot = [...conceptNonZero].sort((a, b) => (b.flow || 0) - (a.flow || 0)).slice(0, 8);
    article += `💡 概念板块资金热榜\n`;
    for (const c of hot) {
      const arrow = (c.flow || 0) >= 0 ? "🔥" : "❄️";
      article += `${arrow} ${c.name}: ${fmtFlowYuan(c.flow || 0)}\n`;
    }
    article += `\n`;
  }

  // 个股速览
  if (quotes.length) {
    article += `📋 核心标的速览\n`;
    for (const q of quotes.slice(0, 6)) {
      const dir = (q.change || 0) >= 0 ? "🔴" : "🟢";
      const sign = (q.change || 0) >= 0 ? "+" : "";
      article += `${dir} ${q.name}(${q.code}): ¥${q.price?.toFixed(2) || "--"}  ${sign}${(q.change || 0).toFixed(2)}%\n`;
    }
    article += `\n`;
  }

  // 白话解读精选
  if (quotes.length) {
    const q = quotes[0];
    const trend = (q.change || 0) >= 0 ? "偏强" : "偏弱";
    const volumeLevel = (q.volume || 0) > 10000000 ? "放量" : (q.volume || 0) > 5000000 ? "正常" : "缩量";
    article += `🔍 白话解读 (以${q.name}为例)\n`;
    article += `今日${trend}，${volumeLevel}。`;
    if (q.price > q.open) {
      article += `开盘¥${q.open?.toFixed(2)}后震荡上行，收于¥${q.price?.toFixed(2)}。`;
    } else {
      article += `开盘¥${q.open?.toFixed(2)}后回落，现价¥${q.price?.toFixed(2)}。`;
    }
    article += `日内振幅${(((q.high - q.low) / q.preClose) * 100).toFixed(2)}%。\n\n`;
  }

  // 免责声明
  article += `━━━━━━━━━━━━━━━━━━━━\n`;
  article += `⚠️ 免责声明\n`;
  article += `以上内容由量化工具自动生成，数据来源：新浪财经/东方财富。\n`;
  article += `所有内容仅供参考学习，不构成任何投资建议。\n`;
  article += `股市有风险，投资需谨慎。\n\n`;
  article += `🤖 本文由「量化交易平台」自动生成\n`;
  article += `🔗 访问工具: (公众号菜单栏)\n`;
  article += `📅 生成时间: ${new Date().toLocaleString("zh-CN")}\n`;

  // 同时生成精简版（适合雪球/知乎发帖）
  const shortVersion = generateShortVersion(summary, sectors, quotes, dateStr);

  return {
    full: article,
    short: shortVersion,
    date: dateStr,
    mood: moodText,
    topSectors: sectors.length ? [...sectors].sort((a, b) => (b.mainFlow || 0) - (a.mainFlow || 0)).slice(0, 3).map(s => s.name) : [],
    hotStocks: quotes.slice(0, 5).map(q => ({ code: q.code, name: q.name, change: q.change })),
  };
}

function generateShortVersion(summary, sectors, quotes, dateStr) {
  let s = `【量化速报】${dateStr}\n\n`;
  if (summary?.marketMood?.mood) {
    s += `市场: ${summary.marketMood.mood}\n`;
  }
  if (sectors.length) {
    const nonZero = sectors.filter(s => Math.abs(s.mainFlow || 0) > 0);
    if (nonZero.length) {
      const top = [...nonZero].sort((a, b) => (b.mainFlow || 0) - (a.mainFlow || 0))[0];
      s += `资金热门: ${top?.name || ""}\n`;
    }
  }
  if (quotes.length) {
    s += `关注: ` + quotes.slice(0, 3).map(q => `${q.name} ${(q.change||0)>=0?'+':''}${(q.change||0).toFixed(2)}%`).join(" | ") + `\n`;
  }
  s += `\n#量化分析 #A股 #每日复盘`;
  return s;
}

function fmtFlowYuan(val) {
  if (val == null || isNaN(val)) return "--";
  const sign = val >= 0 ? "+" : "";
  const abs = Math.abs(val);
  if (abs >= 1e8) return sign + (abs / 1e8).toFixed(2) + "亿";
  if (abs >= 1e4) return sign + (abs / 1e4).toFixed(2) + "万";
  return sign + abs.toFixed(0);
}

module.exports = { generateDailyArticle };

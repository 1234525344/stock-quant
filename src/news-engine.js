/**
 * 实时市场新闻引擎 — 自动抓取 + AI情绪分析 + 板块影响 + 缓存
 */
const crypto = require("crypto");
const { dedupedGet } = require("./data");
const { chatCompletion, getApiKey, isAiConfigured, getActiveModels } = require("./ai-service");
const database = require("./database");

// ========== 板块关键词映射 ==========
const SECTOR_KEYWORDS = {
  "银行": ["银行", "央行", "降准", "降息", "存贷款", "信贷", "LPR", "存款准备金", "货币政策"],
  "保险": ["保险", "寿险", "车险", "理赔", "保费", "中国平安", "中国太保"],
  "券商": ["券商", "证券", "IPO", "注册制", "融资融券", "两融", "投行", "交易所"],
  "白酒": ["白酒", "茅台", "五粮液", "泸州老窖", "消费升级", "高端白酒"],
  "半导体": ["半导体", "芯片", "光刻机", "ASML", "晶圆", "封测", "EDA", "国产替代", "集成电路"],
  "新能源": ["新能源", "光伏", "风电", "储能", "锂电池", "电动车", "充电桩", "碳中和", "太阳能", "氢能"],
  "医药": ["医药", "创新药", "CXO", "疫苗", "医疗器械", "集采", "带量采购", "生物", "制药"],
  "房地产": ["房地产", "楼市", "房价", "限购", "房贷", "恒大", "碧桂园", "保交楼", "土地", "住建"],
  "消费": ["消费", "零售", "电商", "直播带货", "双十一", "618", "社会消费品", "CPI", "物价", "食品"],
  "科技": ["人工智能", "AI", "大模型", "ChatGPT", "算力", "数据中心", "5G", "6G", "信息技术", "互联网", "软件", "云计算", "数字经济"],
  "军工": ["军工", "国防", "军费", "导弹", "战斗机", "航母", "北斗", "航天", "武器"],
  "汽车": ["汽车", "新能源车", "特斯拉", "比亚迪", "造车新势力", "自动驾驶", "整车", "零部件"],
  "有色": ["有色金属", "铜", "铝", "锂", "稀土", "黄金", "白银", "大宗商品", "矿", "铁矿石"],
  "煤炭": ["煤炭", "动力煤", "焦煤", "能源安全", "保供", "煤矿"],
  "农业": ["农业", "种业", "养殖", "猪肉", "粮食安全", "乡村振兴", "化肥", "农药"],
  "基建": ["基建", "铁路", "公路", "水利工程", "新基建", "城投", "建材", "水泥", "钢铁"],
  "传媒": ["传媒", "游戏", "影视", "版权", "元宇宙", "短视频", "广告", "营销"],
};

// ========== 板块 → 代表性个股映射 ==========
const SECTOR_STOCKS = {
  "银行":   [{ code: "600036", name: "招商银行" }, { code: "601398", name: "工商银行" }, { code: "601166", name: "兴业银行" }],
  "保险":   [{ code: "601318", name: "中国平安" }, { code: "601601", name: "中国太保" }, { code: "601336", name: "新华保险" }],
  "券商":   [{ code: "600030", name: "中信证券" }, { code: "601211", name: "国泰君安" }, { code: "601688", name: "华泰证券" }],
  "白酒":   [{ code: "600519", name: "贵州茅台" }, { code: "000858", name: "五粮液" }, { code: "000568", name: "泸州老窖" }],
  "半导体": [{ code: "002371", name: "北方华创" }, { code: "603986", name: "兆易创新" }, { code: "688981", name: "中芯国际" }],
  "新能源": [{ code: "300750", name: "宁德时代" }, { code: "601012", name: "隆基绿能" }, { code: "600438", name: "通威股份" }],
  "医药":   [{ code: "300015", name: "爱尔眼科" }, { code: "600276", name: "恒瑞医药" }, { code: "300759", name: "康龙化成" }],
  "房地产": [{ code: "001979", name: "招商蛇口" }, { code: "600048", name: "保利发展" }, { code: "000002", name: "万科A" }],
  "消费":   [{ code: "600887", name: "伊利股份" }, { code: "000651", name: "格力电器" }, { code: "000333", name: "美的集团" }],
  "科技":   [{ code: "002230", name: "科大讯飞" }, { code: "300059", name: "东方财富" }, { code: "002415", name: "海康威视" }],
  "军工":   [{ code: "600893", name: "航发动力" }, { code: "600760", name: "中航沈飞" }, { code: "002179", name: "中航光电" }],
  "汽车":   [{ code: "002594", name: "比亚迪" }, { code: "601238", name: "广汽集团" }, { code: "600104", name: "上汽集团" }],
  "有色":   [{ code: "601899", name: "紫金矿业" }, { code: "600362", name: "江西铜业" }, { code: "601225", name: "陕西煤业" }],
  "煤炭":   [{ code: "601088", name: "中国神华" }, { code: "601898", name: "中煤能源" }, { code: "600188", name: "兖矿能源" }],
  "农业":   [{ code: "002714", name: "牧原股份" }, { code: "000998", name: "隆平高科" }, { code: "600598", name: "北大荒" }],
  "基建":   [{ code: "601668", name: "中国建筑" }, { code: "601186", name: "中国铁建" }, { code: "601390", name: "中国中铁" }],
  "传媒":   [{ code: "300413", name: "芒果超媒" }, { code: "002602", name: "世纪华通" }, { code: "002555", name: "三七互娱" }],
};

class NewsEngine {
  constructor() {
    this.news = [];            // 最近新闻缓存
    this.sentimentIndex = 50;  // 大盘情绪指数 0-100
    this.maxCache = 1000;
    this.running = false;
    this.timer = null;
    this.lastFetch = 0;
    this.lastAnalysis = null;  // 最新AI分析结论缓存
  }

  /** 启动定时抓取 */
  start() {
    if (this.running) return;
    this.running = true;
    // 从数据库恢复历史新闻
    try {
      const cached = database.getRecentNews(500);
      if (cached.length) {
        this.news = cached;
        this._updateSentimentIndex();
        console.log(`[新闻引擎] 从缓存恢复 ${cached.length} 条新闻`);
      }
    } catch (e) { /* 首次启动无缓存表, 忽略 */ }
    console.log("[新闻引擎] 已启动");
    this.fetch(); // 立即抓一次
    this.timer = setInterval(() => this.fetch(), this._getInterval());
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    console.log("[新闻引擎] 已停止");
  }

  _getInterval() {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const mins = h * 60 + m;
    // 交易时段 9:15-11:30, 13:00-15:00 → 5分钟
    if ((mins >= 555 && mins <= 690) || (mins >= 780 && mins <= 900)) {
      return 5 * 60 * 1000;
    }
    // 其他时间 → 30分钟
    return 30 * 60 * 1000;
  }

  /** 抓取所有源 */
  async fetch() {
    try {
      const results = await Promise.allSettled([
        this._fetchEastMoney(),
        this._fetchSina(),
        this._fetchEastMoneyStock(),
        this._fetchCLS(),
        this._fetchEastMoneyNews(),
      ]);
      const all = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
      // 去重
      const seen = new Set(this.news.map(n => n.hash));
      const fresh = all.filter(n => {
        if (seen.has(n.hash)) return false;
        seen.add(n.hash);
        return true;
      });
      if (fresh.length) {
        // 批量情绪分析
        await this._analyzeSentiment(fresh);
        this.news = [...fresh, ...this.news].slice(0, this.maxCache);
        this._updateSentimentIndex();
        // 持久化到数据库 (fire-and-forget)
        database.insertNewsItems(fresh);
        const sources = {};
        fresh.forEach(n => { sources[n.source] = (sources[n.source] || 0) + 1; });
        console.log(`[新闻引擎] 新增 ${fresh.length} 条 (来源: ${Object.entries(sources).map(([k,v])=>`${k}:${v}`).join(', ')})，总计 ${this.news.length} 条`);
      }
      this.lastFetch = Date.now();
    } catch (e) {
      console.error("[新闻引擎] 抓取失败:", e.message);
    }
  }

  /** 东方财富快讯 */
  async _fetchEastMoney() {
    try {
      const results = [];
      for (let page = 1; page <= 3; page++) {
        const url = `https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=350&order=1&needInteractData=0&page_index=${page}&page_size=100&req_trace=${Date.now().toString(36)}`;
        const { data } = await dedupedGet(url, {
          timeout: 8000,
          headers: { Referer: "https://finance.eastmoney.com" },
        });
        if (!data?.data?.list?.length) break;
        results.push(...data.data.list.map(item => ({
          title: item.title || "",
          summary: item.digest || item.content || "",
          source: "东方财富",
          url: item.url || "",
          publishedAt: item.showtime || new Date().toISOString(),
          hash: crypto.createHash("md5").update(item.title || "").digest("hex"),
          relatedCodes: this._extractCodes(item.title + " " + (item.digest || "")),
        })));
      }
      return results;
    } catch { return []; }
  }

  /** 新浪财经要闻 */
  async _fetchSina() {
    try {
      const results = [];
      for (let page = 1; page <= 3; page++) {
        const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&k=&num=100&page=${page}`;
        const { data } = await dedupedGet(url, {
          timeout: 8000,
          headers: { Referer: "https://finance.sina.com.cn" },
        });
        if (!data?.result?.data?.length) break;
        results.push(...data.result.data.map(item => ({
          title: item.title || "",
          summary: item.intro || "",
          source: "新浪财经",
          url: item.url || "",
          publishedAt: item.ctime ? new Date(item.ctime * 1000).toISOString() : new Date().toISOString(),
          hash: crypto.createHash("md5").update(item.title || "").digest("hex"),
          relatedCodes: this._extractCodes(item.title + " " + (item.intro || "")),
        })));
      }
      return results;
    } catch { return []; }
  }

  /** 东方财富A股资讯 */
  async _fetchEastMoneyNews() {
    try {
      const results = [];
      for (let page = 1; page <= 3; page++) {
        const trace = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const url = `https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=350&order=1&needInteractData=0&page_index=${page}&page_size=100&req_trace=${trace}`;
        const { data } = await dedupedGet(url, {
          timeout: 8000,
          headers: { Referer: "https://finance.eastmoney.com" },
        });
        if (!data?.data?.list?.length) break;
        results.push(...data.data.list.map(item => ({
          title: item.title || "",
          summary: item.digest || item.content || "",
          source: "东方财富资讯",
          url: item.url || "",
          publishedAt: item.showtime || new Date().toISOString(),
          hash: crypto.createHash("md5").update("emnews_" + (item.title || "")).digest("hex"),
          relatedCodes: this._extractCodes(item.title + " " + (item.digest || "")),
        })));
      }
      return results;
    } catch { return []; }
  }

  /** 东方财富A股快讯 */
  async _fetchEastMoneyStock() {
    try {
      const results = [];
      for (let page = 1; page <= 3; page++) {
        const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=100&page_index=${page}&ann_type=A&client_source=web&f_node=0&s_node=0`;
        const { data } = await dedupedGet(url, {
          timeout: 8000,
          headers: { Referer: "https://data.eastmoney.com" },
        });
        if (!data?.data?.list?.length) break;
        results.push(...data.data.list.map(item => ({
          title: item.title || "",
          summary: item.digest || "",
          source: "东方财富公告",
          url: `https://data.eastmoney.com/notices/detail/${item.stock_code || ""}/${item.art_code || ""}.html`,
          publishedAt: item.notice_date || new Date().toISOString(),
          hash: crypto.createHash("md5").update(item.title || "").digest("hex"),
          relatedCodes: item.stock_code ? [item.stock_code] : this._extractCodes(item.title || ""),
        })));
      }
      return results;
    } catch { return []; }
  }

  /** 同花顺A股快讯 */
  async _fetchCLS() {
    try {
      const results = [];
      for (let page = 1; page <= 3; page++) {
        const url = `https://news.10jqka.com.cn/tapp/news/push/stock/?page=${page}&tag=&track=website&pagesize=100`;
        const { data } = await dedupedGet(url, {
          timeout: 8000,
          headers: { Referer: "https://news.10jqka.com.cn" },
        });
        if (!data?.data?.list?.length) break;
        results.push(...data.data.list.map(item => ({
          title: item.title || "",
          summary: item.digest || "",
          source: "同花顺",
          url: item.url || `https://news.10jqka.com.cn/${item.code || ""}`,
          publishedAt: item.ctime ? new Date(item.ctime * 1000).toISOString() : new Date().toISOString(),
          hash: crypto.createHash("md5").update(item.title || "").digest("hex"),
          relatedCodes: this._extractCodes(item.title + " " + (item.digest || "")),
        })));
      }
      return results;
    } catch { return []; }
  }

  /** 从文本中提取股票代码 */
  _extractCodes(text) {
    const codes = new Set();
    // 匹配 6位数字代码
    const m = text.match(/[036]\d{5}/g);
    if (m) m.forEach(c => codes.add(c));
    return [...codes];
  }

  /** AI批量情绪分析 — 返回情绪、板块、影响类型、结论 */
  async _analyzeSentiment(newsList) {
    const apiKey = getApiKey();
    let aiFailed = false; // AI失败后跳过后续请求
    // 分批，每批8条（AI单次处理更多以获取板块信息）
    for (let i = 0; i < newsList.length; i += 8) {
      const batch = newsList.slice(i, i + 8);
      if (!apiKey || !isAiConfigured() || aiFailed) {
        // 无AI时用关键词匹配 + 板块推断
        batch.forEach(n => {
          const text = n.title + " " + n.summary;
          n.sentiment = this._keywordSentiment(text);
          const { sectors, codes } = this._detectSectors(text);
          n.sectors = sectors;
          // 补充板块关联个股（不覆盖已有的 relatedCodes）
          const existCodes = new Set(n.relatedCodes || []);
          codes.forEach(c => { if (!existCodes.has(c.code)) n.relatedCodes = [...(n.relatedCodes || []), c.code]; });
          n._sectorStocks = codes; // 带名称的个股列表
          n.impact = n.sentiment > 0.1 ? "利多" : n.sentiment < -0.1 ? "利空" : "中性";
          n.conclusion = "";
        });
        continue;
      }
      try {
        const items = batch.map((n, idx) => `${idx + 1}. ${n.title}${n.summary ? " — " + n.summary.slice(0, 80) : ""}`).join("\n");
        const prompt = `对以下A股新闻，分析每条的市场影响。返回JSON数组，每条格式：
{"idx":1,"score":0.5,"sectors":["半导体","芯片"],"impact":"利多","conclusion":"国产替代加速利好半导体"}

score: -1极度利空,-0.5利空,0中性,0.5利多,1极度利多
sectors: 受影响板块（从这些选：银行,保险,券商,白酒,半导体,新能源,医药,房地产,消费,科技,军工,汽车,有色,煤炭,农业,基建,传媒）
impact: 利多/利空/中性
conclusion: 一句话结论（15字内）

只输出JSON数组，不要解释。
${items}`;
        const models = getActiveModels(apiKey);
        const result = await chatCompletion(apiKey, {
          model: models.flash,
          system: "你是A股市场分析师，输出简洁的JSON分析。",
          messages: [{ role: "user", content: prompt }],
          maxTokens: 600,
        });
        // 解析JSON
        const jsonMatch = result.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          parsed.forEach(item => {
            const idx = item.idx - 1;
            if (idx >= 0 && idx < batch.length) {
              batch[idx].sentiment = Math.max(-1, Math.min(1, item.score || 0));
              batch[idx].sectors = Array.isArray(item.sectors) ? item.sectors : [];
              batch[idx].impact = item.impact || (item.score > 0.1 ? "利多" : item.score < -0.1 ? "利空" : "中性");
              batch[idx].conclusion = item.conclusion || "";
            }
          });
        }
        // 未被AI分析的用关键词
        batch.forEach(n => {
          if (n.sentiment === undefined) {
            const text = n.title + " " + n.summary;
            n.sentiment = this._keywordSentiment(text);
            const { sectors, codes } = this._detectSectors(text);
            n.sectors = sectors;
            const existCodes = new Set(n.relatedCodes || []);
            codes.forEach(c => { if (!existCodes.has(c.code)) n.relatedCodes = [...(n.relatedCodes || []), c.code]; });
            n._sectorStocks = codes;
            n.impact = n.sentiment > 0.1 ? "利多" : n.sentiment < -0.1 ? "利空" : "中性";
            n.conclusion = "";
          }
        });
        // AI分析成功的也补充板块个股
        batch.forEach(n => {
          if (n.sectors?.length && !n._sectorStocks) {
            const codes = [];
            n.sectors.forEach(s => {
              (SECTOR_STOCKS[s] || []).forEach(stk => {
                if (!codes.find(c => c.code === stk.code)) codes.push(stk);
              });
            });
            n._sectorStocks = codes;
            const existCodes = new Set(n.relatedCodes || []);
            codes.forEach(c => { if (!existCodes.has(c.code)) n.relatedCodes = [...(n.relatedCodes || []), c.code]; });
          }
        });
      } catch (e) {
        console.error("[新闻引擎] AI分析失败:", e.message);
        aiFailed = true; // 本次fetch周期内跳过后续AI请求
        batch.forEach(n => {
          const text = n.title + " " + n.summary;
          n.sentiment = this._keywordSentiment(text);
          const { sectors, codes } = this._detectSectors(text);
          n.sectors = sectors;
          const existCodes = new Set(n.relatedCodes || []);
          codes.forEach(c => { if (!existCodes.has(c.code)) n.relatedCodes = [...(n.relatedCodes || []), c.code]; });
          n._sectorStocks = codes;
          n.impact = n.sentiment > 0.1 ? "利多" : n.sentiment < -0.1 ? "利空" : "中性";
          n.conclusion = "";
        });
      }
    }
  }

  /** 基于关键词检测涉及板块，并补充关联个股 */
  _detectSectors(text) {
    const sectors = [];
    const codes = [];
    for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
      if (keywords.some(kw => text.includes(kw))) {
        sectors.push(sector);
        // 补充该板块的代表性个股
        const stocks = SECTOR_STOCKS[sector] || [];
        stocks.forEach(s => {
          if (!codes.find(c => c.code === s.code)) {
            codes.push(s);
          }
        });
      }
    }
    return { sectors, codes };
  }

  /** 关键词情绪匹配（快速备用） */
  _keywordSentiment(text) {
    const pos = ["涨停", "利好", "增长", "突破", "新高", "大涨", "暴涨", "翻倍", "盈利", "超预期",
                 "加仓", "买入", "推荐", "强势", "放量", "主力", "资金流入", "政策利好"];
    const neg = ["跌停", "利空", "亏损", "暴跌", "大跌", "风险", "警示", "退市", "违规", "处罚",
                 "减仓", "卖出", "空头", "缩量", "资金流出", "爆雷", "下调", "破位"];
    let score = 0;
    pos.forEach(w => { if (text.includes(w)) score += 0.2; });
    neg.forEach(w => { if (text.includes(w)) score -= 0.2; });
    return Math.max(-1, Math.min(1, score));
  }

  /** 计算大盘情绪指数 */
  _updateSentimentIndex() {
    const oneHourAgo = Date.now() - 3600000;
    const recent = this.news.filter(n => new Date(n.publishedAt).getTime() > oneHourAgo);
    if (recent.length === 0) return;
    const pos = recent.filter(n => n.sentiment > 0.1).length;
    const neg = recent.filter(n => n.sentiment < -0.1).length;
    const total = pos + neg || 1;
    this.sentimentIndex = Math.round((pos / total) * 100);
  }

  /** 获取最新新闻 */
  getLatest({ page = 1, pageSize = 20, sentiment, source, sector } = {}) {
    let filtered = this.news;
    if (sentiment === "positive") filtered = filtered.filter(n => n.sentiment > 0.1);
    else if (sentiment === "negative") filtered = filtered.filter(n => n.sentiment < -0.1);
    else if (sentiment === "neutral") filtered = filtered.filter(n => Math.abs(n.sentiment) <= 0.1);
    if (source) filtered = filtered.filter(n => n.source === source);
    if (sector) filtered = filtered.filter(n => (n.sectors || []).includes(sector));
    const start = (page - 1) * pageSize;
    return {
      total: filtered.length,
      page, pageSize,
      items: filtered.slice(start, start + pageSize).map(n => ({
        title: n.title,
        summary: n.summary,
        source: n.source,
        url: n.url,
        publishedAt: n.publishedAt,
        sentiment: n.sentiment,
        sentimentLabel: n.sentiment > 0.1 ? "利多" : n.sentiment < -0.1 ? "利空" : "中性",
        relatedCodes: n.relatedCodes,
        sectors: n.sectors || [],
        impact: n.impact || "中性",
        conclusion: n.conclusion || "",
        sectorStocks: (n._sectorStocks || []).slice(0, 3), // 最多3只代表个股
      })),
    };
  }

  /** 生成市场分析汇总 — AI综合研判 */
  async generateAnalysis() {
    // 取最近1小时的新闻
    const oneHourAgo = Date.now() - 3600000;
    const recent = this.news.filter(n => new Date(n.publishedAt).getTime() > oneHourAgo);
    if (recent.length === 0) {
      return { summary: "暂无足够新闻数据", sectors: [], stocks: [], conclusion: "数据不足，无法分析" };
    }

    // 统计板块热度
    const sectorCount = {};
    const sectorSentiment = {};
    recent.forEach(n => {
      (n.sectors || []).forEach(s => {
        sectorCount[s] = (sectorCount[s] || 0) + 1;
        if (!sectorSentiment[s]) sectorSentiment[s] = [];
        sectorSentiment[s].push(n.sentiment || 0);
      });
    });

    const sectorStats = Object.entries(sectorCount)
      .map(([name, count]) => {
        const sentiments = sectorSentiment[name] || [];
        const avg = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
        return { name, count, avgSentiment: Math.round(avg * 100) / 100 };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // 统计个股热度
    const codeCount = {};
    recent.forEach(n => {
      (n.relatedCodes || []).forEach(c => {
        codeCount[c] = (codeCount[c] || 0) + 1;
      });
    });
    const topStocks = Object.entries(codeCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([code, count]) => ({ code, count }));

    // 有AI时生成综合分析
    const apiKey = getApiKey();
    let aiConclusion = "";
    if (apiKey && isAiConfigured() && recent.length >= 5) {
      try {
        const topNews = recent.slice(0, 15).map((n, i) =>
          `${i + 1}. [${n.impact || "中性"}] ${n.title}${n.conclusion ? " (" + n.conclusion + ")" : ""}`
        ).join("\n");
        const sectorInfo = sectorStats.slice(0, 5).map(s =>
          `${s.name}: ${s.count}条, 情绪${s.avgSentiment > 0 ? "偏多" : s.avgSentiment < 0 ? "偏空" : "中性"}`
        ).join(", ");
        const prompt = `根据以下A股市场新闻和板块数据，给出一段50字以内的市场研判结论。

新闻摘要：
${topNews}

板块热度：${sectorInfo}

要求：指出市场整体方向、主要机会和风险。用通俗语言。`;
        const models = getActiveModels(apiKey);
        aiConclusion = await chatCompletion(apiKey, {
          model: models.flash,
          system: "你是A股市场分析师，给出简洁的市场研判。",
          messages: [{ role: "user", content: prompt }],
          maxTokens: 200,
        });
      } catch (e) {
        console.error("[新闻引擎] AI综合分析失败:", e.message);
      }
    }

    const pos = recent.filter(n => n.sentiment > 0.1).length;
    const neg = recent.filter(n => n.sentiment < -0.1).length;
    const total = pos + neg || 1;

    return {
      newsCount: recent.length,
      sentimentIndex: Math.round((pos / total) * 100),
      sentimentLabel: pos / total > 0.6 ? "偏多" : pos / total < 0.4 ? "偏空" : "震荡",
      sectors: sectorStats,
      stocks: topStocks,
      conclusion: aiConclusion || `${pos > neg ? "多头占优" : pos < neg ? "空头占优" : "多空胶着"}，共${recent.length}条新闻，利多${pos}条，利空${neg}条`,
      lastUpdate: new Date().toISOString(),
    };
  }

  /** 获取情绪指标 */
  getSentiment() {
    const oneHour = this.news.filter(n => Date.now() - new Date(n.publishedAt).getTime() < 3600000);
    const pos = oneHour.filter(n => n.sentiment > 0.1).length;
    const neg = oneHour.filter(n => n.sentiment < -0.1).length;
    const neu = oneHour.length - pos - neg;
    return {
      index: this.sentimentIndex,
      total: oneHour.length,
      positive: pos, negative: neg, neutral: neu,
      label: this.sentimentIndex >= 60 ? "偏多" : this.sentimentIndex <= 40 ? "偏空" : "中性",
      lastUpdate: new Date(this.lastFetch).toISOString(),
    };
  }

  /** 获取个股相关新闻 */
  getStockNews(code) {
    return this.news
      .filter(n => n.relatedCodes.includes(code))
      .slice(0, 20)
      .map(n => ({
        title: n.title, source: n.source, url: n.url,
        publishedAt: n.publishedAt, sentiment: n.sentiment,
        sentimentLabel: n.sentiment > 0.1 ? "利多" : n.sentiment < -0.1 ? "利空" : "中性",
      }));
  }
}

module.exports = new NewsEngine();

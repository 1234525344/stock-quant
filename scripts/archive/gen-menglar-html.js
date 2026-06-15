// 生成手机兼容 HTML 报告
const fs = require("fs");
const outDir = "D:/作业/shopee-data";

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Shopee越南-女士单肩包-市场数据报告</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:#f5f7fa;color:#333;line-height:1.7;padding:12px;max-width:700px;margin:0 auto}
.header{text-align:center;padding:30px 16px 20px;background:linear-gradient(135deg,#1a5276,#2980b9);color:#fff;border-radius:12px;margin-bottom:16px}
.header h1{font-size:22px;margin-bottom:4px}
.header h2{font-size:18px;opacity:.9;font-weight:400}
.header .meta{font-size:12px;opacity:.7;margin-top:8px}
.section{background:#fff;border-radius:10px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.section h3{font-size:17px;color:#1a5276;border-bottom:2px solid #2980b9;padding-bottom:6px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#1a5276;color:#fff;padding:8px 6px;text-align:left;font-weight:600;font-size:12px}
td{padding:7px 6px;border-bottom:1px solid #eee}
tr:nth-child(even) td{background:#f8f9fa}
tr td:first-child{font-weight:600;white-space:nowrap}
.highlight{background:#fff3cd;border-left:3px solid #ffc107;padding:8px 12px;border-radius:4px;font-size:14px;margin-top:8px}
.conclusion li{margin:6px 0 6px 18px;font-size:14px;list-style-type:decimal}
.footer{text-align:center;font-size:11px;color:#999;padding:16px 0;border-top:1px solid #ddd;margin-top:16px}
.badge{display:inline-block;background:#e74c3c;color:#fff;font-size:10px;padding:2px 6px;border-radius:3px;margin-left:4px;vertical-align:middle}
.tag{display:inline-block;background:#2980b9;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px}
</style>
</head>
<body>

<div class="header">
  <h1>Shopee 越南 — 女士单肩包（斜挎包）</h1>
  <h2>市场数据报告</h2>
  <div class="meta">知虾企业版 · 越南站(siteId=7) · 女生包包/精品 · 2024.01-2025.06</div>
</div>

<div class="section">
  <h3>一、核心市场指标</h3>
  <table>
    <tr><th>指标</th><th>数据</th></tr>
    <tr><td>越南电商半年交易额</td><td>202.3万亿VND (84亿美元) <span class="tag">+41.52%</span></td></tr>
    <tr><td>女手袋搜索量</td><td><b>1,730万次</b><span class="badge">热搜第1</span></td></tr>
    <tr><td>斜挎包GMV增速</td><td>整体 +5~10% / <b style="color:#e74c3c">品牌 +60%+</b></td></tr>
    <tr><td>平台份额</td><td>Shopee 58% | TikTok 39% | 其他 3%</td></tr>
    <tr><td>TikTok增速</td><td><b style="color:#e74c3c">+69%</b> (29%→39%), 增长最快</td></tr>
  </table>
</div>

<div class="section">
  <h3>二、价格分布与趋势</h3>
  <table>
    <tr><th>价格(USD)</th><th>VND</th><th>份额变化</th><th>趋势</th></tr>
    <tr><td>$4-8</td><td>10-20万</td><td>24.2%→<b>26.3%</b></td><td style="color:#27ae60">涨幅最大</td></tr>
    <tr><td>$8-14</td><td>20-35万</td><td>15.7%→16.5%</td><td style="color:#27ae60">小幅增长</td></tr>
    <tr><td>$14-40</td><td>35-100万</td><td>基本持平</td><td>—</td></tr>
    <tr><td>$40+</td><td>100万+</td><td>16.3%→<b>15.1%</b></td><td style="color:#e74c3c">份额收缩</td></tr>
  </table>
  <div class="highlight">定价建议: 主力产品聚焦 <b>10-35万VND (30-105元CNY)</b></div>
</div>

<div class="section">
  <h3>三、TOP商品月销量估算</h3>
  <table>
    <tr><th>排名段</th><th>月均销量</th><th>价位</th><th>商品类型</th></tr>
    <tr><td>TOP 1-10</td><td>5,000-50,000</td><td>10-30万</td><td>基础款帆布/PU斜挎包(爆款)</td></tr>
    <tr><td>TOP 11-50</td><td>1,000-5,000</td><td>20-80万</td><td>中等品质PU皮单肩包</td></tr>
    <tr><td>TOP 51-200</td><td>200-1,000</td><td>30-100万</td><td>品牌/设计款</td></tr>
    <tr><td>长尾</td><td>&lt;200</td><td>50万+</td><td>高端/真皮/小众</td></tr>
  </table>
</div>

<div class="section">
  <h3>四、价格-销量对应模型</h3>
  <table>
    <tr><th>价位(万VND)</th><th>CNY</th><th>月销量/品</th><th>竞争</th></tr>
    <tr><td>10-20</td><td>¥30-60</td><td>5k-30k</td><td style="color:#e74c3c">极高</td></tr>
    <tr><td>20-50</td><td>¥60-150</td><td>1k-10k</td><td style="color:#e67e22">高</td></tr>
    <tr><td>50-100</td><td>¥150-300</td><td>500-3k</td><td>中 ⬅ 品牌机会</td></tr>
    <tr><td>100+</td><td>¥300+</td><td>100-1k</td><td style="color:#27ae60">低</td></tr>
  </table>
</div>

<div class="section">
  <h3>五、竞争格局</h3>
  <table>
    <tr><th>类型</th><th>代表</th><th>特征</th></tr>
    <tr><td>国际品牌</td><td>Charles & Keith, Pedro</td><td>新加坡品牌, 中高端</td></tr>
    <tr><td>越南本土</td><td>Vascara, Juno</td><td>设计感强, 中端价位</td></tr>
    <tr><td>跨境卖家</td><td>中国/韩国</td><td>高性价比, 快速迭代</td></tr>
    <tr><td>白牌</td><td>大量中小卖家</td><td>价格战, 利润薄</td></tr>
  </table>
</div>

<div class="section">
  <h3>六、消费者画像</h3>
  <table>
    <tr><th>维度</th><th>特征</th></tr>
    <tr><td>核心人群</td><td>25-34岁女性, 内容电商活跃</td></tr>
    <tr><td>旺季</td><td><b>1月农历新年</b> (最大旺季), 双11/12</td></tr>
    <tr><td>颜色偏好</td><td>紫、红、黄 (越南特色)</td></tr>
    <tr><td>直播习惯</td><td>82%进过直播间, <b>63%购买过</b></td></tr>
    <tr><td>物流</td><td>本土发货+跨境直邮, 最快3天</td></tr>
  </table>
</div>

<div class="section">
  <h3>七、关键结论与建议</h3>
  <ol class="conclusion">
    <li><b>品牌化</b> — 品牌女包增速>60%, 消费者愿为溢价买单, 立即注册自有品牌</li>
    <li><b>内容电商</b> — TikTok Shop份额29%→39%, 直播+短视频是最强增长引擎</li>
    <li><b>性价比定位</b> — $4-8价格带增长最快, 主力产品定价30-105元CNY</li>
    <li><b>本土化</b> — 越南语内容+本地节日营销+本土发货, 缺一不可</li>
    <li><b>差异化</b> — 欧美大五金/环保材料/IP联名/中性风是蓝海机会</li>
  </ol>
</div>

<div class="footer">
  数据来源: 知虾企业版 (zxee.menglar.com) · Shopee越南站 · 女生包包/精品类目<br>
  声明: 基于知虾平台数据+行业模型推算 · 导出日期 2026.05.24
</div>

</body>
</html>`;

fs.writeFileSync(outDir + "/Shopee越南-女士单肩包-市场数据报告.html", html, "utf8");
console.log("HTML: " + outDir + "/Shopee越南-女士单肩包-市场数据报告.html");

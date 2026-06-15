# 数据库架构

本项目使用两类数据库，分别管理不同类型的数据。

## 1. 主数据库: `data/stock-quant.db`

**引擎**: sql.js (WASM-based, 内存 + 定期写盘)  
**访问**: `src/database.js` → 单例 `require("../database")`

### 表结构

| 表名 | 用途 |
|------|------|
| `trades` | 交易记录 (买卖操作、策略、手续费) |
| `daily_snapshots` | 每日快照 (持仓、净值、收益) |
| `strategies` | 策略配置 |
| `alerts` | 告警记录 |
| `watchlist_groups` | 自选股分组 |
| `watchlist` | 自选股列表 |
| `news_cache` | 新闻缓存 (情感分析结果持久化) |

### 访问方式

```js
const database = require("../database");
await database.ready; // 等待初始化完成
const groups = database.getWatchlistGroups();
database.createWatchlistGroup("新分组");
```

### 写盘策略

- 每次 `insert*` / `update*` / `delete*` 操作后**立即**调用 `save()` 全量导出到磁盘
- 程序退出时（SIGINT/SIGTERM）也会执行 `save()`
- 临时数据（如实时行情）**不存入**该数据库

## 2. 交易数据库: `data/trades.db`

**引擎**: better-sqlite3 (直写磁盘, WAL 模式)  
**访问**: `src/database/trades.db.js`

### 用途

自动交易引擎的订单、持仓、回测记录。

### 访问方式

```js
const { getTradesDB } = require("../database/trades.db");
const db = getTradesDB();
```

## 数据流

```
外部 API (Sina/QQ/EastMoney)
    │
    ├─→ data.js (实时行情, K线) ─→ 内存缓存 ─→ WebSocket 推送
    │
    ├─→ realtime-engine.js (行情融合) ─→ 客户端订阅
    │
    └─→ database.js (持久化) ─→ stock-quant.db (磁盘)
                    │
                    └─→ trades.db.js ─→ trades.db (磁盘)
```

// Correlation ID 中间件 — 为每个请求注入唯一 ID, 贯穿日志链路
const { randomUUID } = require("crypto");

function correlationId() {
  return (req, res, next) => {
    const id = req.headers["x-correlation-id"] || randomUUID();
    req.correlationId = id;
    res.setHeader("X-Correlation-Id", id);
    next();
  };
}

module.exports = { correlationId };

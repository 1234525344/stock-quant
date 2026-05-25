// 生产级错误处理和输入验证中间件
const { logger } = require("../logger");
const log = logger.child("HTTP");

/**
 * 自定义应用错误类
 */
class AppError extends Error {
  constructor(message, status = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
    this.isOperational = true;
  }
}

class ValidationError extends AppError {
  constructor(message, details = []) {
    super(message, 400, "VALIDATION_ERROR");
    this.details = details;
  }
}

class NotFoundError extends AppError {
  constructor(resource = "资源") {
    super(`${resource}不存在`, 404, "NOT_FOUND");
  }
}

class RateLimitError extends AppError {
  constructor() {
    super("请求过于频繁，请稍后重试", 429, "RATE_LIMIT_EXCEEDED");
  }
}

class ExternalAPIError extends AppError {
  constructor(service, message) {
    super(`外部服务 ${service} 错误: ${message}`, 502, "EXTERNAL_API_ERROR");
  }
}

/**
 * 异步路由包装器 - 自动捕获async函数的rejected promise
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * 请求日志中间件
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, path, query } = req;

  res.on("finish", () => {
    const duration = Date.now() - start;
    const meta = {
      method,
      path,
      query: Object.keys(query).length > 0 ? query : undefined,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get("user-agent")?.slice(0, 80),
    };
    if (res.statusCode >= 400) {
      log.warn(`${method} ${path} ${res.statusCode}`, meta);
    } else {
      log.info(`${method} ${path} ${res.statusCode}`, meta);
    }
  });

  next();
}

/**
 * 输入验证中间件工厂
 * @param {Object} schema - 验证规则 { field: { type, required, min, max, pattern, enum } }
 */
function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    const body = req.method === "GET" ? req.query : req.body;

    for (const [field, rules] of Object.entries(schema)) {
      const value = body[field];

      // 必填检查
      if (rules.required && (value === undefined || value === null || value === "")) {
        errors.push({ field, message: `${field} 是必填项` });
        continue;
      }

      // 跳过可选且未提供的字段
      if (value === undefined || value === null) continue;

      // 类型检查
      if (rules.type === "number" && isNaN(Number(value))) {
        errors.push({ field, message: `${field} 必须是数字` });
        continue;
      }

      if (rules.type === "string" && typeof value !== "string") {
        errors.push({ field, message: `${field} 必须是字符串` });
        continue;
      }

      if (rules.type === "array" && !Array.isArray(value)) {
        errors.push({ field, message: `${field} 必须是数组` });
        continue;
      }

      // 范围检查
      const numVal = Number(value);
      if (rules.type === "number" && !isNaN(numVal)) {
        if (rules.min !== undefined && numVal < rules.min) {
          errors.push({ field, message: `${field} 不能小于 ${rules.min}` });
        }
        if (rules.max !== undefined && numVal > rules.max) {
          errors.push({ field, message: `${field} 不能大于 ${rules.max}` });
        }
      }

      // 字符串长度检查
      if (rules.type === "string" && typeof value === "string") {
        if (rules.minLength && value.length < rules.minLength) {
          errors.push({ field, message: `${field} 长度不能小于 ${rules.minLength}` });
        }
        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push({ field, message: `${field} 长度不能大于 ${rules.maxLength}` });
        }
      }

      // 枚举检查
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push({ field, message: `${field} 必须是以下值之一: ${rules.enum.join(", ")}` });
      }

      // 正则检查
      if (rules.pattern && !rules.pattern.test(String(value))) {
        errors.push({ field, message: `${field} 格式不正确` });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: "参数验证失败",
        code: "VALIDATION_ERROR",
        details: errors,
      });
    }

    // Sanitize - 移除危险字符
    if (req.body && typeof req.body === "object") {
      sanitizeObject(req.body);
    }

    next();
  };
}

/**
 * 递归清理对象中的危险字符
 */
function sanitizeObject(obj) {
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "string") {
      // 移除潜在的XSS和注入
      obj[key] = obj[key]
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
        .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
        .replace(/<embed\b[^>]*>/gi, "")
        .replace(/javascript:/gi, "")
        .replace(/on\w+\s*=/gi, "");
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      sanitizeObject(obj[key]);
    }
  }
}

/**
 * 股票代码验证
 */
function validateStockCode(code) {
  if (!code || typeof code !== "string") return false;
  // 6位数字
  return /^\d{6}$/.test(code);
}

/**
 * 日期格式验证
 */
function validateDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !isNaN(Date.parse(dateStr));
}

/**
 * 全局错误处理中间件
 */
function errorHandler(err, req, res, next) {
  // 应用错误（已知错误）
  if (err.isOperational) {
    const response = {
      error: err.message,
      code: err.code,
    };
    if (err.details) response.details = err.details;
    return res.status(err.status).json(response);
  }

  // JSON解析错误
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "请求体JSON格式错误",
      code: "INVALID_JSON",
    });
  }

  // 请求体过大
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      error: "请求体过大",
      code: "PAYLOAD_TOO_LARGE",
    });
  }

  // 外部API超时
  if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
    return res.status(504).json({
      error: "外部API请求超时",
      code: "GATEWAY_TIMEOUT",
    });
  }

  // 外部API限流
  if (err.response?.status === 429) {
    return res.status(429).json({
      error: "外部API请求过于频繁",
      code: "RATE_LIMIT_EXCEEDED",
    });
  }

  // 数据库错误
  if (err.code?.startsWith("SQLITE")) {
    log.error(`数据库错误: ${err.message}`, { code: err.code, stack: err.stack });
    return res.status(500).json({
      error: "数据库操作失败",
      code: "DATABASE_ERROR",
    });
  }

  // 未知错误
  log.error(`未处理错误: ${err.message}`, {
    stack: err.stack,
    method: req.method,
    path: req.path,
    body: req.body,
  });

  res.status(500).json({
    error: process.env.NODE_ENV === "production"
      ? "服务器内部错误"
      : err.message,
    code: "INTERNAL_ERROR",
  });
}

/**
 * 404处理
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: `接口 ${req.method} ${req.path} 不存在`,
    code: "NOT_FOUND",
  });
}

module.exports = {
  asyncHandler,
  errorHandler,
  notFoundHandler,
  requestLogger,
  validate,
  validateStockCode,
  validateDate,
  sanitizeObject,
  AppError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ExternalAPIError,
};

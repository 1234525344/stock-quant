const {
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
} = require("../src/middleware/errorHandler");

describe("AppError", () => {
  test("should create AppError with defaults", () => {
    const err = new AppError("test error");
    expect(err.message).toBe("test error");
    expect(err.status).toBe(500);
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.isOperational).toBe(true);
  });

  test("should create AppError with custom status and code", () => {
    const err = new AppError("custom", 400, "CUSTOM_ERROR");
    expect(err.status).toBe(400);
    expect(err.code).toBe("CUSTOM_ERROR");
  });
});

describe("ValidationError", () => {
  test("should create ValidationError", () => {
    const err = new ValidationError("invalid", [{ field: "code" }]);
    expect(err.message).toBe("invalid");
    expect(err.status).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toEqual([{ field: "code" }]);
  });

  test("should create ValidationError with empty details", () => {
    const err = new ValidationError("invalid");
    expect(err.details).toEqual([]);
  });
});

describe("NotFoundError", () => {
  test("should create NotFoundError with default resource", () => {
    const err = new NotFoundError();
    expect(err.message).toBe("资源不存在");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });

  test("should create NotFoundError with custom resource", () => {
    const err = new NotFoundError("股票");
    expect(err.message).toBe("股票不存在");
  });
});

describe("RateLimitError", () => {
  test("should create RateLimitError", () => {
    const err = new RateLimitError();
    expect(err.status).toBe(429);
    expect(err.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});

describe("ExternalAPIError", () => {
  test("should create ExternalAPIError", () => {
    const err = new ExternalAPIError("东方财富", "timeout");
    expect(err.message).toContain("东方财富");
    expect(err.message).toContain("timeout");
    expect(err.status).toBe(502);
    expect(err.code).toBe("EXTERNAL_API_ERROR");
  });
});

describe("asyncHandler", () => {
  test("should pass resolved value through", async () => {
    const fn = asyncHandler(async (req, res, next) => {
      res.json({ ok: true });
    });
    const req = {};
    const res = { json: jest.fn() };
    const next = jest.fn();
    await fn(req, res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  test("should catch rejected promise and call next with error", async () => {
    const err = new Error("async error");
    const fn = asyncHandler(async () => {
      throw err;
    });
    const req = {};
    const res = {};
    const next = jest.fn();
    await fn(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  test("should call next when synchronous error", async () => {
    const fn = asyncHandler(async (req, res, next) => {
      throw new Error("sync-like error");
    });
    const req = {};
    const res = {};
    const next = jest.fn();
    await fn(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("errorHandler middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = { method: "GET", path: "/api/test", query: {}, body: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  test("should handle AppError (operational)", () => {
    const err = new AppError("known error", 400, "KNOWN");
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "known error", code: "KNOWN" })
    );
  });

  test("should handle ValidationError with details", () => {
    const err = new ValidationError("bad input", [{ field: "code", message: "required" }]);
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "bad input", details: expect.any(Array) })
    );
  });

  test("should handle NotFoundError", () => {
    const err = new NotFoundError("股票");
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("should handle RateLimitError", () => {
    const err = new RateLimitError();
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  test("should handle ExternalAPIError", () => {
    const err = new ExternalAPIError("TestAPI", "timeout");
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  test("should handle JSON parse error", () => {
    const err = new Error("bad json");
    err.type = "entity.parse.failed";
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_JSON" })
    );
  });

  test("should handle payload too large error", () => {
    const err = new Error("too large");
    err.type = "entity.too.large";
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PAYLOAD_TOO_LARGE" })
    );
  });

  test("should handle gateway timeout (ECONNABORTED)", () => {
    const err = new Error("timeout");
    err.code = "ECONNABORTED";
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(504);
  });

  test("should handle gateway timeout (ETIMEDOUT)", () => {
    const err = new Error("timeout");
    err.code = "ETIMEDOUT";
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(504);
  });

  test("should handle external API rate limit", () => {
    const err = new Error("rate limited");
    err.response = { status: 429 };
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  test("should handle SQLite errors", () => {
    const err = new Error("sqlite error");
    err.code = "SQLITE_CONSTRAINT";
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "DATABASE_ERROR" })
    );
  });

  test("should handle unknown errors", () => {
    const err = new Error("unknown error");
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INTERNAL_ERROR" })
    );
  });

  test("should mask error details in production", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const err = new Error("secret details");
    errorHandler(err, req, res, next);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "服务器内部错误" })
    );
    process.env.NODE_ENV = originalEnv;
  });
});

describe("notFoundHandler", () => {
  test("should return 404 for unknown routes", () => {
    const req = { method: "GET", path: "/api/nonexistent" };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    notFoundHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});

describe("requestLogger", () => {
  test("should call next", () => {
    const req = {
      method: "GET",
      path: "/api/test",
      query: {},
      ip: "127.0.0.1",
      get: jest.fn().mockReturnValue("test-agent"),
    };
    const res = {
      on: jest.fn((event, cb) => {
        if (event === "finish") res.statusCode = 200;
      }),
      statusCode: 200,
    };
    const next = jest.fn();
    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("validate middleware - additional tests", () => {
  let req, res, next;

  beforeEach(() => {
    req = { method: "GET", query: {}, body: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  test("should pass optional fields when not provided", () => {
    req.query = {};
    const middleware = validate({ code: { type: "string", required: false } });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("should validate string length", () => {
    req.query = { code: "12" };
    const middleware = validate({ code: { type: "string", minLength: 3 } });
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should validate max string length", () => {
    req.query = { code: "12345678901" };
    const middleware = validate({ code: { type: "string", maxLength: 10 } });
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should validate array type", () => {
    req.query = { items: "notarray" };
    const middleware = validate({ items: { type: "array" } });
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should validate from body for non-GET requests", () => {
    req.method = "POST";
    req.body = { code: "000001" };
    const middleware = validate({ code: { type: "string", required: true } });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("should sanitize body after validation", () => {
    req.method = "POST";
    req.body = { name: "<script>alert(1)</script>test" };
    const middleware = validate({ name: { type: "string" } });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body.name).not.toContain("<script>");
  });

  test("should validate regex pattern", () => {
    req.query = { email: "notanemail" };
    const middleware = validate({ email: { type: "string", pattern: /^[^\s@]+@[^\s@]+$/ } });
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

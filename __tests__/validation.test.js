const { validate, validateStockCode, validateDate, sanitizeObject } = require("../src/middleware/errorHandler");

describe("Validation", () => {
  describe("validate middleware", () => {
    let req, res, next;

    beforeEach(() => {
      req = { method: "GET", query: {}, body: {} };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      next = jest.fn();
    });

    test("should pass valid required fields", () => {
      req.query = { code: "000001" };
      const middleware = validate({ code: { type: "string", required: true } });
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test("should fail for missing required fields", () => {
      req.query = {};
      const middleware = validate({ code: { type: "string", required: true } });
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "VALIDATION_ERROR" })
      );
    });

    test("should validate number range", () => {
      req.query = { days: "5" };
      const middleware = validate({ days: { type: "number", min: 1, max: 365 } });
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test("should fail for number out of range", () => {
      req.query = { days: "500" };
      const middleware = validate({ days: { type: "number", min: 1, max: 365 } });
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("should validate enum values", () => {
      req.query = { action: "buy" };
      const middleware = validate({ action: { type: "string", enum: ["buy", "sell"] } });
      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    test("should fail for invalid enum values", () => {
      req.query = { action: "hold" };
      const middleware = validate({ action: { type: "string", enum: ["buy", "sell"] } });
      middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("validateStockCode", () => {
    test("should accept valid 6-digit codes", () => {
      expect(validateStockCode("000001")).toBe(true);
      expect(validateStockCode("600519")).toBe(true);
      expect(validateStockCode("300750")).toBe(true);
    });

    test("should reject invalid codes", () => {
      expect(validateStockCode("12345")).toBe(false);
      expect(validateStockCode("1234567")).toBe(false);
      expect(validateStockCode("abcdef")).toBe(false);
      expect(validateStockCode("")).toBe(false);
      expect(validateStockCode(null)).toBe(false);
    });
  });

  describe("validateDate", () => {
    test("should accept valid dates", () => {
      expect(validateDate("2026-01-15")).toBe(true);
      expect(validateDate("2026-12-31")).toBe(true);
    });

    test("should reject invalid dates", () => {
      expect(validateDate("2026/01/15")).toBe(false);
      expect(validateDate("15-01-2026")).toBe(false);
      expect(validateDate("2026-13-01")).toBe(false);
      expect(validateDate("")).toBe(false);
      expect(validateDate(null)).toBe(false);
    });
  });

  describe("sanitizeObject", () => {
    test("should remove script tags", () => {
      const obj = { name: "<script>alert('xss')</script>Hello" };
      sanitizeObject(obj);
      expect(obj.name).toBe("Hello");
    });

    test("should remove javascript: protocol", () => {
      const obj = { url: "javascript:alert('xss')" };
      sanitizeObject(obj);
      expect(obj.url).toBe("alert('xss')");
    });

    test("should remove event handlers", () => {
      const obj = { div: 'onclick="alert(1)"' };
      sanitizeObject(obj);
      expect(obj.div).not.toContain("onclick");
    });

    test("should sanitize nested objects", () => {
      const obj = {
        nested: {
          name: "<script>alert('xss')</script>",
        },
      };
      sanitizeObject(obj);
      expect(obj.nested.name).toBe("");
    });
  });
});

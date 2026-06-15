const { SMA, EMA, MACD, RSI, BOLL, ATR, KDJ, calcReturns, calcVolatility } = require("../src/indicators");

describe("indicators", () => {
  const closes = [10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const highs =  closes.map((c, i) => c + 0.5);
  const lows =   closes.map((c, i) => c - 0.5);

  describe("SMA", () => {
    test("should calculate simple moving average", () => {
      const result = SMA(closes, 5);
      expect(result.length).toBe(closes.length);
      expect(result[0]).toBeNull();
      expect(result[3]).toBeNull();
      expect(result[4]).toBeCloseTo((10 + 11 + 12 + 13 + 14) / 5, 2);
      expect(result[5]).toBeCloseTo((11 + 12 + 13 + 14 + 15) / 5, 2);
    });

    test("should handle period = 1", () => {
      const result = SMA(closes, 1);
      expect(result).toEqual(closes);
    });
  });

  describe("EMA", () => {
    test("should calculate exponential moving average", () => {
      const result = EMA(closes, 5);
      expect(result.length).toBe(closes.length);
      expect(result[0]).toBe(closes[0]);
      // EMA should follow price trend
      expect(result[result.length - 1]).toBeGreaterThan(result[5]);
    });
  });

  describe("MACD", () => {
    test("should return {dif, dea, macd} arrays", () => {
      const result = MACD(closes, 12, 26, 9);
      expect(result).toHaveProperty("dif");
      expect(result).toHaveProperty("dea");
      expect(result).toHaveProperty("macd");
      expect(result.dif.length).toBe(closes.length);
      expect(result.dea.length).toBe(closes.length);
      expect(result.macd.length).toBe(closes.length);
    });

    test("should have null values for early dea bars", () => {
      const result = MACD(closes, 12, 26, 9);
      // dif[0] is 0 (EMA12[0] - EMA26[0] = same value), dea has offset
      expect(result.dea[0]).toBeNull();
    });
  });

  describe("RSI", () => {
    test("should return values between 0 and 100", () => {
      const result = RSI(closes, 14);
      const validValues = result.filter(v => v != null);
      validValues.forEach(v => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      });
    });

    test("should return null for early bars", () => {
      const result = RSI(closes, 14);
      expect(result[0]).toBeNull();
      expect(result[13]).toBeNull();
    });
  });

  describe("BOLL", () => {
    test("should return {mid, upper, lower}", () => {
      const result = BOLL(closes, 5);
      expect(result).toHaveProperty("mid");
      expect(result).toHaveProperty("upper");
      expect(result).toHaveProperty("lower");
    });

    test("upper should be > mid > lower", () => {
      const result = BOLL(closes, 5);
      for (let i = 4; i < closes.length; i++) {
        if (result.mid[i] != null) {
          expect(result.upper[i]).toBeGreaterThan(result.mid[i]);
          expect(result.mid[i]).toBeGreaterThan(result.lower[i]);
        }
      }
    });
  });

  describe("ATR", () => {
    test("should return positive values", () => {
      const result = ATR(highs, lows, closes, 14);
      const validValues = result.filter(v => v != null);
      validValues.forEach(v => expect(v).toBeGreaterThan(0));
    });
  });

  describe("KDJ", () => {
    test("should return {k, d, j}", () => {
      const result = KDJ(highs, lows, closes, 9);
      expect(result).toHaveProperty("k");
      expect(result).toHaveProperty("d");
      expect(result).toHaveProperty("j");
    });
  });

  describe("calcReturns", () => {
    test("should return d5/d10/d20 returns", () => {
      const result = calcReturns(closes);
      expect(result).toHaveProperty("d5");
      expect(result).toHaveProperty("d10");
      expect(result).toHaveProperty("d20");
    });

    test("should return empty object for short data", () => {
      expect(calcReturns([1, 2, 3])).toEqual({});
    });
  });

  describe("calcVolatility", () => {
    test("should return non-negative annualized volatility", () => {
      const vol = calcVolatility(closes);
      expect(vol).toBeGreaterThanOrEqual(0);
    });

    test("should return 0 for short data", () => {
      expect(calcVolatility([1, 2, 3])).toBe(0);
    });
  });
});

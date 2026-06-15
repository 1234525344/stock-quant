const { sanitizeKlines, detectGaps, fillGaps, cleanPipeline } = require("../src/data-sanitizer");

describe("data-sanitizer", () => {
  const validKlines = [
    { date: "2024-01-02", open: 10, high: 11, low: 9, close: 10.5, volume: 1000 },
    { date: "2024-01-03", open: 10.5, high: 12, low: 10, close: 11, volume: 1200 },
    { date: "2024-01-04", open: 11, high: 13, low: 10.5, close: 12, volume: 1500 },
  ];

  describe("sanitizeKlines", () => {
    test("should filter NaN/close values", () => {
      const data = [
        { date: "2024-01-02", close: NaN, open: 10, high: 11, low: 9, volume: 1000 },
        { date: "2024-01-03", close: 0, open: 10, high: 11, low: 9, volume: 1000 },
        { date: "2024-01-04", close: -5, open: 10, high: 11, low: 9, volume: 1000 },
        validKlines[0],
      ];
      const result = sanitizeKlines(data);
      expect(result.length).toBe(1);
    });

    test("should filter missing date", () => {
      const data = [{ close: 10 }, { date: "2024-01-02", close: 10, open: 10, high: 11, low: 9, volume: 1000 }];
      const result = sanitizeKlines(data);
      expect(result.length).toBe(1);
    });

    test("should sort by date ascending", () => {
      const data = [
        { date: "2024-01-04", close: 12, open: 11, high: 13, low: 10.5, volume: 1500 },
        { date: "2024-01-02", close: 10.5, open: 10, high: 11, low: 9, volume: 1000 },
        { date: "2024-01-03", close: 11, open: 10.5, high: 12, low: 10, volume: 1200 },
      ];
      const result = sanitizeKlines(data);
      expect(result[0].date).toBe("2024-01-02");
      expect(result[2].date).toBe("2024-01-04");
    });

    test("should deduplicate by date", () => {
      const data = [
        { date: "2024-01-02", close: 10, open: 10, high: 11, low: 9, volume: 1000 },
        { date: "2024-01-02", close: 10.5, open: 10, high: 11, low: 9, volume: 1000 },
      ];
      const result = sanitizeKlines(data);
      expect(result.length).toBe(1);
      expect(result[0].close).toBe(10.5); // keeps last
    });

    test("should return empty for invalid input", () => {
      expect(sanitizeKlines(null)).toEqual([]);
      expect(sanitizeKlines([])).toEqual([]);
      expect(sanitizeKlines("not an array")).toEqual([]);
    });
  });

  describe("detectGaps", () => {
    test("should detect large gaps", () => {
      const data = [
        { date: "2024-01-02", close: 10, open: 10, high: 11, low: 9, volume: 1000 },
        { date: "2024-01-25", close: 12, open: 11, high: 13, low: 10.5, volume: 1500 },
      ];
      const { gaps } = detectGaps(data);
      expect(gaps.length).toBe(1);
      expect(gaps[0].missingDays).toBeGreaterThan(0);
    });

    test("should not flag normal gaps", () => {
      const { gaps } = detectGaps(validKlines);
      expect(gaps.length).toBe(0);
    });
  });

  describe("fillGaps", () => {
    test("should interpolate missing trading days", () => {
      const data = [
        { date: "2024-01-02", close: 10, open: 10, high: 11, low: 9, volume: 1000 },
        { date: "2024-01-05", close: 12, open: 11, high: 13, low: 10.5, volume: 1500 },
      ];
      const result = fillGaps(data, 5);
      // Jan 3 (Wed) and Jan 4 (Thu) should be interpolated
      const interp = result.filter(k => k.interpolated);
      expect(interp.length).toBe(2);
      expect(interp[0].volume).toBe(0);
    });

    test("should skip weekends", () => {
      // Friday -> Monday = only 1 gap day (weekend doesn't count as trading)
      const data = [
        { date: "2024-01-05", close: 10, open: 10, high: 11, low: 9, volume: 1000 }, // Fri
        { date: "2024-01-08", close: 12, open: 11, high: 13, low: 10.5, volume: 1500 }, // Mon
      ];
      const result = fillGaps(data, 5);
      const interp = result.filter(k => k.interpolated);
      expect(interp.length).toBe(0); // No missing trading days
    });
  });

  describe("cleanPipeline", () => {
    test("should run full pipeline", () => {
      const data = [
        { date: "2024-01-02", close: 10, open: 10, high: 11, low: 9, volume: 1000 },
        { date: "2024-01-02", close: 10.5, open: 10, high: 11, low: 9, volume: 1000 }, // dup
        { date: "2024-01-03", close: 11, open: 10.5, high: 12, low: 10, volume: 1200 },
        { date: "2024-01-04", close: 12, open: 11, high: 13, low: 10.5, volume: 1500 },
      ];
      const { klines, stats } = cleanPipeline(data);
      expect(stats.input).toBe(4);
      expect(stats.removed).toBe(1);
      expect(klines.length).toBe(3);
    });
  });
});

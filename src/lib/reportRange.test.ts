import { describe, expect, it } from "vitest";
import { ApiError } from "./apiErrorBase";
import { MAX_CUSTOM_RANGE_DAYS, customRangeQuery, endOfDay, resolveRange, startOfDay, validateCustomRange } from "./reportRange";

describe("validateCustomRange", () => {
  it("accepts a normal range and a single day", () => {
    expect(validateCustomRange(new Date(2026, 7, 1), new Date(2026, 7, 31))).toBeNull();
    expect(validateCustomRange(new Date(2026, 7, 5), new Date(2026, 7, 5))).toBeNull();
  });

  it("refuses an end before the start, naming the problem", () => {
    expect(validateCustomRange(new Date(2026, 8, 10), new Date(2026, 8, 1))).toMatch(/شروع باید قبل از/);
  });

  it("refuses an invalid date and a range longer than the cap", () => {
    expect(validateCustomRange(new Date("nope"), new Date(2026, 8, 1))).toMatch(/معتبر نیست/);
    const start = new Date(2000, 0, 1);
    const tooFar = new Date(2000, 0, 1 + MAX_CUSTOM_RANGE_DAYS + 2);
    expect(validateCustomRange(start, tooFar)).toMatch(/۱۰ سال/);
  });
});

describe("customRangeQuery", () => {
  it("asks for the whole of both local days as exact instants", () => {
    const params = new URLSearchParams(customRangeQuery(new Date(2026, 7, 20, 15, 30), new Date(2026, 8, 5, 8, 0)));
    expect(new Date(params.get("from")!).getTime()).toBe(startOfDay(new Date(2026, 7, 20)).getTime());
    expect(new Date(params.get("to")!).getTime()).toBe(endOfDay(new Date(2026, 8, 5)).getTime());
  });
});

describe("resolveRange with a custom range", () => {
  it("uses the instants it is given exactly, so the picked days are covered in full", () => {
    const query = new URLSearchParams(customRangeQuery(new Date(2026, 7, 20), new Date(2026, 8, 5)));
    const range = resolveRange(null, query.get("from"), query.get("to"));
    expect(range.from.getTime()).toBe(new Date(2026, 7, 20).getTime());
    expect(range.to.getTime()).toBe(endOfDay(new Date(2026, 8, 5)).getTime());
    expect(range.label).toContain("تا");
  });

  it("still understands a bare date as the whole day", () => {
    const range = resolveRange(null, "2026-09-01", "2026-09-10");
    expect(range.to.getHours()).toBe(23);
    expect(range.to.getMinutes()).toBe(59);
  });

  it("answers 400 for a missing, reversed, unparseable or oversized range", () => {
    const status = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof ApiError ? e.status : "other";
      }
      return "no error";
    };
    expect(status(() => resolveRange(null, null, null))).toBe(400);
    expect(status(() => resolveRange(null, "2026-09-10", "2026-09-01"))).toBe(400);
    expect(status(() => resolveRange(null, "garbage", "2026-09-01"))).toBe(400);
    expect(status(() => resolveRange(null, "1990-01-01", "2026-09-01"))).toBe(400);
  });

  it("leaves the presets alone", () => {
    expect(resolveRange("today", null, null).label).toBe("امروز");
    expect(resolveRange("month", null, null).label).toBe("این ماه");
  });
});

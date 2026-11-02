import { describe, expect, it } from "vitest";
import { describeDay, formatAmount, formatNumber, isMetricKind, parseAmount } from "./habitMetrics";
import { habitCheckInDurationSchema } from "./schemas/habits";

describe("formatAmount", () => {
  it("writes a distance with one decimal at most, and whole pages and kilocalories", () => {
    expect(formatAmount("DISTANCE", 5)).toBe("۵ کیلومتر");
    expect(formatAmount("DISTANCE", 5.25)).toBe("۵٫۳ کیلومتر");
    expect(formatAmount("DISTANCE", 10.04)).toBe("۱۰ کیلومتر");
    expect(formatAmount("PAGES", 30)).toBe("۳۰ صفحه");
    expect(formatAmount("PAGES", 29.6)).toBe("۳۰ صفحه");
    expect(formatAmount("CALORIES", 450)).toBe("۴۵۰ کیلوکالری");
  });

  it("does not leave a trailing zero or point", () => {
    expect(formatNumber(2.5, 1)).toBe("۲٫۵");
    expect(formatNumber(2, 1)).toBe("۲");
    expect(formatNumber(0.04, 1)).toBe("۰");
  });
});

describe("parseAmount", () => {
  it("reads Persian, Arabic and Latin digits and every decimal point people type", () => {
    expect(parseAmount("۵")).toBe(5);
    expect(parseAmount("5.5")).toBe(5.5);
    expect(parseAmount("۵٫۵")).toBe(5.5);
    expect(parseAmount("5,5")).toBe(5.5);
    expect(parseAmount("٥٫٢")).toBe(5.2);
    expect(parseAmount("  12 ")).toBe(12);
    expect(parseAmount(".5")).toBe(0.5);
  });

  it("is null for nothing, for words, and for what is not above zero", () => {
    for (const text of ["", "  ", "abc", "5km", "-3", "0", "۰", "1.2.3", "٫"]) expect(parseAmount(text)).toBeNull();
  });
});

describe("describeDay", () => {
  it("joins what was logged, in the order amount then minutes", () => {
    expect(describeDay("DISTANCE", 5, 30)).toBe("۵ کیلومتر · ۳۰ دقیقه");
    expect(describeDay("PAGES", 20, null)).toBe("۲۰ صفحه");
    expect(describeDay(null, null, 45)).toBe("۴۵ دقیقه");
  });

  it("is null when only the tick was logged, or when an amount has no kind to be read by", () => {
    expect(describeDay("DISTANCE", null, null)).toBeNull();
    expect(describeDay(null, 5, null)).toBeNull();
    expect(describeDay("PAGES", 0, 0)).toBeNull();
  });
});

describe("isMetricKind", () => {
  it("knows the three kinds and nothing else", () => {
    for (const kind of ["DISTANCE", "PAGES", "CALORIES"]) expect(isMetricKind(kind)).toBe(true);
    for (const other of ["TIME", "distance", "", null, undefined, 3]) expect(isMetricKind(other)).toBe(false);
  });
});

describe("the check-in details body", () => {
  it("takes minutes, an amount, or both — but not nothing", () => {
    expect(habitCheckInDurationSchema.safeParse({ durationMin: 30 }).success).toBe(true);
    expect(habitCheckInDurationSchema.safeParse({ amount: 5.5 }).success).toBe(true);
    expect(habitCheckInDurationSchema.safeParse({ durationMin: 30, amount: 5, date: "2026-11-02T00:00:00.000Z" }).success).toBe(true);
    expect(habitCheckInDurationSchema.safeParse({}).success).toBe(false);
    expect(habitCheckInDurationSchema.safeParse({ date: "2026-11-02T00:00:00.000Z" }).success).toBe(false);
  });

  it("keeps the old bounds, and 0 is how a value is cleared", () => {
    expect(habitCheckInDurationSchema.safeParse({ durationMin: 0 }).success).toBe(true);
    expect(habitCheckInDurationSchema.safeParse({ amount: 0 }).success).toBe(true);
    expect(habitCheckInDurationSchema.safeParse({ durationMin: 1441 }).success).toBe(false);
    expect(habitCheckInDurationSchema.safeParse({ durationMin: 1.5 }).success).toBe(false);
    expect(habitCheckInDurationSchema.safeParse({ amount: -1 }).success).toBe(false);
  });
});

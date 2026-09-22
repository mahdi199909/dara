import { describe, it, expect } from "vitest";
import { buildCapturePrefill } from "./smartCapture";

const NOW = new Date(2026, 4, 10, 14, 30, 0); // 1405/02/20, a Sunday, "right now" is 14:30

describe("buildCapturePrefill", () => {
  it("a named clock time and duration becomes an exact start/end", () => {
    const r = buildCapturePrefill("جلسه با مشتری فردا ساعت ۱۰ ۱ ساعت", NOW);
    expect(r.entityType).toBe("EVENT");
    expect(r.day?.getDate()).toBe(11);
    expect(r.start?.getHours()).toBe(10);
    expect(r.start?.getMinutes()).toBe(0);
    expect(r.end?.getTime()).toBe(r.start!.getTime() + 60 * 60_000);
  });

  it("a duration with no named time reads as 'just finished' — ends about now, starts that long before", () => {
    const r = buildCapturePrefill("۲ ساعت رو پروژه کار کردم", NOW);
    expect(r.entityType).toBe("TASK");
    expect(r.end).toEqual(NOW);
    expect(r.start?.getTime()).toBe(NOW.getTime() - 120 * 60_000);
    expect(r.day).toBeNull(); // CaptureForm's own default (today) applies — never fabricated here
  });

  it("a duration with a named day (no time) anchors 'just finished' to that day, not today", () => {
    const r = buildCapturePrefill("دیروز ۲ ساعت کار کردم", NOW);
    expect(r.day?.getDate()).toBe(9);
    expect(r.end?.getDate()).toBe(9);
    expect(r.end?.getHours()).toBe(NOW.getHours());
    expect(r.start?.getDate()).toBe(9);
  });

  it("a day with no time and no duration sets only the day — never invents a time", () => {
    const r = buildCapturePrefill("فردا تماس با رضا", NOW);
    expect(r.day?.getDate()).toBe(11);
    expect(r.start).toBeNull();
    expect(r.end).toBeNull();
  });

  it("no time signal at all leaves day/start/end untouched for CaptureForm's own defaults", () => {
    const r = buildCapturePrefill("خرید نان", NOW);
    expect(r.day).toBeNull();
    expect(r.start).toBeNull();
    expect(r.end).toBeNull();
  });

  it("carries the amount as a cost, and the waste-category hint, unresolved (the caller matches it)", () => {
    const r = buildCapturePrefill("اینستاگرام ۲ ساعت", NOW);
    expect(r.categoryHint).toBe("شبکه‌های اجتماعی");
    expect(r.flowType).toBe("COST");

    const withMoney = buildCapturePrefill("۵۰۰ تومن خرج ناهار شد", NOW);
    expect(withMoney.amount).toBe(500);
    expect(withMoney.flowType).toBe("COST");
  });

  it("the user's own example round-trips: today, a duration, and a تومن amount", () => {
    const r = buildCapturePrefill("امروز ۲ ساعت رو پروژه کار کردم، ۵۰۰ تومن هم خرج ناهار شد", NOW);
    expect(r.amount).toBe(500);
    expect(r.day?.getDate()).toBe(10);
    expect(r.end?.getTime()).toBe(NOW.getTime());
    expect(r.start?.getTime()).toBe(NOW.getTime() - 120 * 60_000);
  });
});

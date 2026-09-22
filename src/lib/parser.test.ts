import { describe, it, expect } from "vitest";
import { parseQuickCapture } from "./parser";

const NOW = new Date(2026, 4, 10, 9, 0, 0); // 1405/02/20 - a Sunday reference point

describe("parseQuickCapture", () => {
  it("خرید هویه ۲ ساعت ۱.۵ میلیون -> \"خرید\" strips out, category hint added", () => {
    const r = parseQuickCapture("خرید هویه ۲ ساعت ۱.۵ میلیون", NOW);
    expect(r.title).toBe("هویه");
    expect(r.durationMinutes).toBe(120);
    expect(r.amount).toBe(1_500_000);
    expect(r.suggestedType).toBe("ACTIVITY");
    expect(r.categoryHint).toBe("خرید");
  });

  it("مطالعه مقاله SNN -> plain task", () => {
    const r = parseQuickCapture("مطالعه مقاله SNN", NOW);
    expect(r.title).toBe("مطالعه مقاله SNN");
    expect(r.durationMinutes).toBeNull();
    expect(r.amount).toBeNull();
    expect(r.suggestedType).toBe("TASK");
  });

  it("خرید قطعات ۲ ساعت ۸۰۰ هزار تومان", () => {
    const r = parseQuickCapture("خرید قطعات ۲ ساعت ۸۰۰ هزار تومان", NOW);
    expect(r.title).toBe("قطعات");
    expect(r.durationMinutes).toBe(120);
    expect(r.amount).toBe(800_000);
    expect(r.suggestedType).toBe("ACTIVITY");
  });

  it("جلسه با مشتری فردا ساعت ۱۰", () => {
    const r = parseQuickCapture("جلسه با مشتری فردا ساعت ۱۰", NOW);
    expect(r.title).toBe("جلسه با مشتری");
    expect(r.suggestedType).toBe("EVENT");
    expect(r.date).not.toBeNull();
    expect(r.date?.getDate()).toBe(11);
    expect(r.date?.getHours()).toBe(10);
    expect(r.hasExplicitTime).toBe(true);
  });

  it("اینستاگرام ۲ ساعت -> waste category hint", () => {
    const r = parseQuickCapture("اینستاگرام ۲ ساعت", NOW);
    expect(r.durationMinutes).toBe(120);
    expect(r.suggestedType).toBe("ACTIVITY");
    expect(r.categoryHint).toBe("شبکه‌های اجتماعی");
  });

  it("خرید مولتی متر 3h 2,500,000", () => {
    const r = parseQuickCapture("خرید مولتی متر 3h 2,500,000", NOW);
    expect(r.title).toBe("مولتی متر");
    expect(r.durationMinutes).toBe(180);
    expect(r.amount).toBe(2_500_000);
  });

  it("مطالعه SNN 2h", () => {
    const r = parseQuickCapture("مطالعه SNN 2h", NOW);
    expect(r.title).toBe("مطالعه SNN");
    expect(r.durationMinutes).toBe(120);
    expect(r.suggestedType).toBe("ACTIVITY");
  });

  it("جلسه فردا 10:00 1h -> event", () => {
    const r = parseQuickCapture("جلسه فردا 10:00 1h", NOW);
    expect(r.title).toBe("جلسه");
    expect(r.suggestedType).toBe("EVENT");
    expect(r.date?.getHours()).toBe(10);
    expect(r.date?.getMinutes()).toBe(0);
  });

  it("bare expense: قبض برق ۴۵۰,۰۰۰ تومان", () => {
    const r = parseQuickCapture("قبض برق ۴۵۰,۰۰۰ تومان", NOW);
    expect(r.amount).toBe(450_000);
    expect(r.durationMinutes).toBeNull();
    expect(r.suggestedType).toBe("EXPENSE");
  });

  it("spoken number-word amount: یک میلیون", () => {
    const r = parseQuickCapture("خرید لپتاپ یک میلیون تومن", NOW);
    expect(r.amount).toBe(1_000_000);
    expect(r.title).toBe("لپتاپ");
  });

  it("spoken number-word amount, no تومان: پنج هزار", () => {
    const r = parseQuickCapture("پنج هزار خرج پارکینگ", NOW);
    expect(r.amount).toBe(5_000);
  });

  it("خرید برای پروژه --- -> project hint extracted, title has neither خرید nor the project clause", () => {
    const r = parseQuickCapture("خرید سیمان برای پروژه بازسازی اتاق", NOW);
    expect(r.title).toBe("سیمان");
    expect(r.categoryHint).toBe("خرید");
    expect(r.projectHint).toBe("بازسازی اتاق");
  });

  it("a fragment of the project's name is still a usable hint: خرید رنگ پروژه اتاق", () => {
    const r = parseQuickCapture("خرید رنگ پروژه اتاق", NOW);
    expect(r.title).toBe("رنگ");
    expect(r.projectHint).toBe("اتاق");
  });

  it("no پروژه mention -> projectHint stays null", () => {
    const r = parseQuickCapture("مطالعه مقاله SNN", NOW);
    expect(r.projectHint).toBeNull();
  });
});

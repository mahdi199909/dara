import { describe, it, expect } from "vitest";
import { parseCaptureIntent, type CaptureIntent } from "./captureIntent";
import { toJalali } from "./jalali";

const NOW = new Date(2026, 4, 10, 9, 0, 0); // Sunday 2026-05-10, 1405/02/20, 09:00

function entry(intent: CaptureIntent) {
  if (intent.kind !== "ENTRY") throw new Error(`expected an entry, got ${intent.kind}`);
  return intent.prefill;
}
const ymd = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null);
const hm = (d: Date | null) => (d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : null);

describe("an entry on the day it was typed", () => {
  it("a dated line is an event at the time named", () => {
    const p = entry(parseCaptureIntent("جلسه با مشتری فردا ساعت ۱۰", NOW));
    expect(p).toMatchObject({ entityType: "EVENT", title: "جلسه با مشتری", flowType: "COST" });
    expect(ymd(p.day)).toBe("2026-05-11");
    expect(hm(p.start)).toBe("10:00");
    expect(p.end).toBeNull();
  });

  it("a meeting with no date is still an event — today, starting when it was typed, like any entry with no time", () => {
    const p = entry(parseCaptureIntent("جلسه با علی", NOW));
    expect(p.entityType).toBe("EVENT");
    expect(p.day).toBeNull(); // the form's own default, today
    expect(hm(p.start)).toBe("09:00");
  });

  it("names the next such weekday, never today", () => {
    expect(ymd(entry(parseCaptureIntent("جلسه یکشنبه ساعت ۱۰", NOW)).day)).toBe("2026-05-17"); // NOW is a Sunday
    expect(ymd(entry(parseCaptureIntent("جلسه دوشنبه", NOW)).day)).toBe("2026-05-11");
    expect(ymd(entry(parseCaptureIntent("جلسه شنبه", NOW)).day)).toBe("2026-05-16");
    expect(ymd(entry(parseCaptureIntent("جلسه جمعه", NOW)).day)).toBe("2026-05-15");
  });

  it("places a Jalali date in this Jalali year, or the one named", () => {
    const thisYear = entry(parseCaptureIntent("قرار ۲۵ مهر ساعت ۱۰", NOW));
    expect(toJalali(thisYear.day!)).toEqual({ jy: 1405, jm: 7, jd: 25 });
    expect(hm(thisYear.start)).toBe("10:00");
    expect(toJalali(entry(parseCaptureIntent("قرار ۲۵ مهر ۱۴۰۶", NOW)).day!)).toEqual({ jy: 1406, jm: 7, jd: 25 });
    expect(toJalali(entry(parseCaptureIntent("قرار ۱۴۰۵/۰۷/۲۵", NOW)).day!)).toEqual({ jy: 1405, jm: 7, jd: 25 });
    // the 31st of a 30-day month is that month's last day, not the next month's first
    expect(toJalali(entry(parseCaptureIntent("قرار ۳۱ آبان", NOW)).day!)).toEqual({ jy: 1405, jm: 8, jd: 30 });
  });

  it("moves an afternoon hour into the afternoon", () => {
    expect(hm(entry(parseCaptureIntent("فردا ساعت ۵ عصر دندان‌پزشک", NOW)).start)).toBe("17:00");
  });

  it("time spent with no clock time ends now and started that long ago", () => {
    const p = entry(parseCaptureIntent("۲ ساعت مطالعه", NOW));
    expect(p.entityType).toBe("TASK");
    expect(hm(p.start)).toBe("07:00");
    expect(hm(p.end)).toBe("09:00");
  });

  it("an income keyword makes the amount income, anything else a cost", () => {
    expect(entry(parseCaptureIntent("حقوق ۲۰ میلیون", NOW))).toMatchObject({ flowType: "INCOME", amount: 20_000_000, entityType: "TASK" });
    expect(entry(parseCaptureIntent("ناهار ۲۰۰ هزار تومان", NOW))).toMatchObject({ flowType: "COST", amount: 200_000 });
  });

  it("carries the category and project hints", () => {
    expect(entry(parseCaptureIntent("خرید رنگ برای پروژه اتاق", NOW))).toMatchObject({ title: "رنگ", categoryHint: "خرید", projectHint: "اتاق" });
  });

  it("forceEntry reads a keyword line as a plain entry", () => {
    expect(parseCaptureIntent("یادداشت: نان", NOW).kind).toBe("NOTE");
    expect(entry(parseCaptureIntent("یادداشت: نان", NOW, { forceEntry: true })).title).toBe("یادداشت: نان");
  });
});

describe("a reminder", () => {
  it("goes off at the time named, on the day named", () => {
    const r = parseCaptureIntent("یادآوری فردا ساعت ۸ صبح قرص", NOW);
    if (r.kind !== "REMINDER") throw new Error(r.kind);
    expect(r.title).toBe("قرص");
    expect(`${ymd(r.start)} ${hm(r.start)}`).toBe("2026-05-11 08:00");
    expect(hm(r.end)).toBe("08:30");
  });

  it("a named day without a time is nine in the morning", () => {
    const r = parseCaptureIntent("یادآوری فردا قرص", NOW);
    if (r.kind !== "REMINDER") throw new Error(r.kind);
    expect(`${ymd(r.start)} ${hm(r.start)}`).toBe("2026-05-11 09:00");
  });

  it("no day and no time is the next whole hour", () => {
    const r = parseCaptureIntent("یادم باشه زنگ بزنم به مامان", new Date(2026, 4, 10, 14, 20, 0));
    if (r.kind !== "REMINDER") throw new Error(r.kind);
    expect(`${ymd(r.start)} ${hm(r.start)}`).toBe("2026-05-10 15:00");
    expect(r.title).toBe("زنگ بزنم به مامان");
  });
});

describe("an installment plan", () => {
  function plan(text: string) {
    const intent = parseCaptureIntent(text, NOW);
    if (intent.kind !== "INSTALLMENT_PLAN") throw new Error(`${text} -> ${intent.kind}`);
    return intent;
  }

  it("multiplies a per-installment amount and divides a total", () => {
    expect(plan("قسط ماشین ۱۲ ماهه ۵ میلیونی")).toMatchObject({ title: "قسط ماشین", count: 12, installmentAmount: 5_000_000, totalAmount: 60_000_000 });
    expect(plan("وام ۶۰ میلیون ۱۲ ماهه")).toMatchObject({ count: 12, installmentAmount: 5_000_000, totalAmount: 60_000_000 });
    expect(plan("وام ۱۰ میلیون ۳ ماهه")).toMatchObject({ installmentAmount: 3_333_333, totalAmount: 10_000_000 });
  });

  it("falls due on the day named, or on today's Jalali day of the month", () => {
    expect(plan("وام ۶۰ میلیون ۱۲ ماهه روز ۵ هر ماه").dueDay).toBe(5);
    expect(plan("وام ۶۰ میلیون ۱۲ ماهه").dueDay).toBe(20); // NOW is 1405/02/20
  });
});

describe("the other things a line can be", () => {
  it("pays an installment, by name", () => {
    expect(parseCaptureIntent("قسط ماشین رو دادم", NOW)).toEqual({ kind: "INSTALLMENT_PAY", planHint: "ماشین" });
  });

  it("ticks off a habit for today", () => {
    const h = parseCaptureIntent("عادت ورزش انجام شد", NOW);
    if (h.kind !== "HABIT_CHECKIN") throw new Error(h.kind);
    expect(h.habitHint).toBe("ورزش");
    expect(ymd(h.date)).toBe("2026-05-10");
    expect(hm(h.date)).toBe("00:00");
  });

  it("writes a note on today, or on a day named before the colon", () => {
    expect(parseCaptureIntent("یادداشت: امروز خوب بود", NOW)).toEqual({ kind: "NOTE", content: "امروز خوب بود", day: "2026-05-10" });
    expect(parseCaptureIntent("یادداشت دیروز: دیر خوابیدم", NOW)).toEqual({ kind: "NOTE", content: "دیر خوابیدم", day: "2026-05-09" });
  });

  it("makes a habit, a goal, a project and a budget", () => {
    expect(parseCaptureIntent("عادت جدید مطالعه", NOW)).toEqual({ kind: "HABIT_CREATE", title: "مطالعه" });
    expect(parseCaptureIntent("هدف ماشین ۲۰۰ میلیون", NOW)).toEqual({ kind: "SAVINGS_GOAL", title: "ماشین", targetAmount: 200_000_000 });
    expect(parseCaptureIntent("پروژه جدید بازسازی اتاق", NOW)).toEqual({ kind: "PROJECT_CREATE", name: "بازسازی اتاق" });
    expect(parseCaptureIntent("بودجه خوراک ماهانه ۵ میلیون", NOW)).toEqual({ kind: "BUDGET", categoryHint: "خوراک", monthlyCap: 5_000_000 });
  });
});

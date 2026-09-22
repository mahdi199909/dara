import { describe, it, expect } from "vitest";
import { buildCapturePrefill, matchCategoryHint, matchProjectHint } from "./smartCapture";

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

  it("carries a project hint through, unresolved (the caller matches or creates it)", () => {
    const r = buildCapturePrefill("خرید رنگ پروژه اتاق", NOW);
    expect(r.projectHint).toBe("اتاق");
    expect(r.categoryHint).toBe("خرید");
    expect(r.title).toBe("رنگ");

    const noProject = buildCapturePrefill("خرید نان", NOW);
    expect(noProject.projectHint).toBeNull();
  });

  it("matchCategoryHint: exact and substring, never an inactive or unrelated category", () => {
    const cats = [
      { id: "1", name: "شبکه‌های اجتماعی", isActive: true },
      { id: "2", name: "خرید", isActive: true },
      { id: "3", name: "قدیمی", isActive: false },
    ];
    expect(matchCategoryHint("خرید", cats)?.id).toBe("2");
    expect(matchCategoryHint("شبکه‌های اجتماعی", cats)?.id).toBe("1");
    expect(matchCategoryHint("قدیمی", cats)).toBeNull();
    expect(matchCategoryHint("چیزی که وجود ندارد", cats)).toBeNull();
  });

  it("matchProjectHint: a fragment of the project's own name still matches, a random category never does", () => {
    const cats = [
      { id: "p1", name: "بازسازی اتاق", isActive: true, projectId: "proj-1" },
      { id: "c1", name: "اتاق کار", isActive: true, projectId: null }, // shares a word, but isn't a project
    ];
    expect(matchProjectHint("اتاق", cats)?.id).toBe("p1"); // fragment of the project's name
    expect(matchProjectHint("بازسازی", cats)?.id).toBe("p1"); // the other fragment
    expect(matchProjectHint("بازسازی اتاق", cats)?.id).toBe("p1"); // the exact name
    expect(matchProjectHint("چیز نامرتبط", cats)).toBeNull();
  });

  it("the user's own example round-trips: today, a duration, and a تومن amount", () => {
    const r = buildCapturePrefill("امروز ۲ ساعت رو پروژه کار کردم، ۵۰۰ تومن هم خرج ناهار شد", NOW);
    expect(r.amount).toBe(500);
    expect(r.day?.getDate()).toBe(10);
    expect(r.end?.getTime()).toBe(NOW.getTime());
    expect(r.start?.getTime()).toBe(NOW.getTime() - 120 * 60_000);
  });
});

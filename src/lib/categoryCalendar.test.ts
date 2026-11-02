import { describe, expect, it } from "vitest";
import { heatOf, mergeCategoryStats, monthHeadline, orderForList, type CategoryCalendarStat } from "./categoryCalendar";

const stat = (over: Partial<CategoryCalendarStat> & { categoryId: string; name: string }): CategoryCalendarStat => ({
  icon: null,
  color: "#3a8d80",
  parentCategoryId: null,
  totalMinutes: 0,
  totalDays: 0,
  days: {},
  dayItems: {},
  ...over,
});

const work = stat({
  categoryId: "work",
  name: "کار",
  icon: "💼",
  totalMinutes: 300,
  totalDays: 2,
  days: { "2026-11-02": 180, "2026-11-03": 120 },
  dayItems: {
    "2026-11-02": [
      { type: "TASK", title: "گزارش", minutes: 120, timeOfDay: "2026-11-02T09:00:00.000Z" },
      { type: "TIME_ENTRY", title: "کدنویسی", minutes: 60, timeOfDay: "2026-11-02T14:00:00.000Z" },
    ],
    "2026-11-03": [{ type: "EVENT", title: "جلسه", minutes: 120, timeOfDay: "2026-11-03T10:00:00.000Z" }],
  },
});
const gym = stat({
  categoryId: "gym",
  name: "ورزش",
  icon: "🏋️",
  totalMinutes: 90,
  totalDays: 2,
  days: { "2026-11-02": 60, "2026-11-05": 30 },
  dayItems: {
    "2026-11-02": [{ type: "HABIT", title: "کراسفیت", minutes: 60, timeOfDay: null }, { type: "TASK", title: "دویدن", minutes: 0, timeOfDay: "2026-11-02T06:00:00.000Z" }],
    "2026-11-05": [{ type: "HABIT", title: "کراسفیت", minutes: 30, timeOfDay: null }],
  },
});
const idle = stat({ categoryId: "idle", name: "مطالعه" });
const idle2 = stat({ categoryId: "idle2", name: "آشپزی" });

describe("orderForList", () => {
  it("puts the busiest first and the categories with no time last, in name order", () => {
    expect(orderForList([idle, gym, idle2, work]).map((s) => s.categoryId)).toEqual(["work", "gym", "idle2", "idle"]);
  });

  it("does not change the array it is given", () => {
    const input = [idle, work];
    orderForList(input);
    expect(input.map((s) => s.categoryId)).toEqual(["idle", "work"]);
  });
});

describe("mergeCategoryStats", () => {
  const all = mergeCategoryStats([work, gym, idle], { name: "همهٔ دسته‌ها", icon: null, color: "#000000" });

  it("adds the minutes of each day across the categories and counts the days with anything once", () => {
    expect(all.days).toEqual({ "2026-11-02": 240, "2026-11-03": 120, "2026-11-05": 30 });
    expect(all.totalMinutes).toBe(390);
    expect(all.totalDays).toBe(3); // not 2 + 2 + 0
    expect(all.name).toBe("همهٔ دسته‌ها");
  });

  it("keeps every item of a day and says which category it came from", () => {
    const items = all.dayItems["2026-11-02"];
    expect(items).toHaveLength(4);
    expect(items.find((i) => i.title === "کراسفیت")?.category).toEqual({ name: "ورزش", icon: "🏋️" });
    expect(items.find((i) => i.title === "گزارش")?.category).toEqual({ name: "کار", icon: "💼" });
  });

  it("orders a day's items by time, those without a time after them", () => {
    expect(all.dayItems["2026-11-02"].map((i) => i.title)).toEqual(["دویدن", "گزارش", "کدنویسی", "کراسفیت"]);
  });

  it("is empty for no categories", () => {
    const none = mergeCategoryStats([], { name: "x", icon: null, color: "" });
    expect(none).toMatchObject({ totalMinutes: 0, totalDays: 0, days: {}, dayItems: {} });
  });
});

describe("monthHeadline", () => {
  it("gives the month's total, its active days and its busiest category", () => {
    const headline = monthHeadline([idle, gym, work]);
    expect(headline.totalMinutes).toBe(390);
    expect(headline.activeDays).toBe(3);
    expect(headline.busiest?.categoryId).toBe("work");
  });

  it("has no busiest category when nothing was logged", () => {
    expect(monthHeadline([idle, idle2])).toEqual({ totalMinutes: 0, activeDays: 0, busiest: null });
  });
});

describe("heatOf", () => {
  it("is the share of the busiest day, between 0 and 1", () => {
    expect(heatOf(0, 200)).toBe(0);
    expect(heatOf(100, 200)).toBe(0.5);
    expect(heatOf(200, 200)).toBe(1);
    expect(heatOf(500, 200)).toBe(1);
    expect(heatOf(10, 0)).toBe(1); // a scale of nothing never divides by zero
  });
});

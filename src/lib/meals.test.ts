import { describe, expect, it } from "vitest";
import {
  EMPTY_MEALS,
  burnedFromHabits,
  dayTotal,
  lastDays,
  mealsOfDay,
  meterOf,
  meterSentence,
  suggestions,
  validateMeal,
  validateTarget,
  type MealData,
  type MealEntry,
} from "./meals";

const meal = (id: string, day: string, kind: MealEntry["kind"], title: string, kcal: number): MealEntry => ({ id, day, kind, title, kcal });
const persian = (n: number) => String(n);

describe("validateMeal", () => {
  it("accepts a named meal with whole calories", () => {
    expect(validateMeal({ title: "املت", kcal: 320, kind: "BREAKFAST" })).toBeNull();
  });

  it("says what is wrong, in words", () => {
    expect(validateMeal({ title: "  ", kcal: 100, kind: "LUNCH" })).toMatch(/اسم غذا/);
    expect(validateMeal({ title: "x".repeat(101), kcal: 100, kind: "LUNCH" })).toMatch(/۱۰۰/);
    expect(validateMeal({ title: "برنج", kcal: 0, kind: "LUNCH" })).toMatch(/کالری/);
    expect(validateMeal({ title: "برنج", kcal: 12.5, kind: "LUNCH" })).toMatch(/کالری/);
    expect(validateMeal({ title: "برنج", kcal: 10_001, kind: "LUNCH" })).toMatch(/کالری/);
    expect(validateMeal({ title: "برنج", kcal: 100, kind: "BRUNCH" })).toMatch(/وعده/);
  });

  it("bounds the daily target", () => {
    expect(validateTarget(2200)).toBeNull();
    expect(validateTarget(499)).not.toBeNull();
    expect(validateTarget(10_001)).not.toBeNull();
    expect(validateTarget(2200.5)).not.toBeNull();
  });
});

describe("a day's meals", () => {
  const data: MealData = {
    v: 1,
    target: 2200,
    entries: [
      meal("a", "2026-11-02", "DINNER", "کباب", 700),
      meal("b", "2026-11-02", "BREAKFAST", "نان و پنیر", 300),
      meal("c", "2026-11-03", "LUNCH", "قورمه", 650),
      meal("d", "2026-11-02", "BREAKFAST", "چای", 20),
    ],
  };

  it("lists them by meal of the day, and in the order written within a meal", () => {
    expect(mealsOfDay(data, "2026-11-02").map((e) => e.id)).toEqual(["b", "d", "a"]);
    expect(mealsOfDay(data, "2026-11-09")).toEqual([]);
  });

  it("adds up only that day", () => {
    expect(dayTotal(data, "2026-11-02")).toBe(1020);
    expect(dayTotal(data, "2026-11-03")).toBe(650);
    expect(dayTotal(data, "2026-11-04")).toBe(0);
  });
});

describe("the meter", () => {
  it("fills toward the target and says how much is left", () => {
    const meter = meterOf(1500, 2000);
    expect(meter).toMatchObject({ state: "UNDER", remaining: 500, fill: 0.75 });
    expect(meterSentence(meter, persian)).toBe("500 کیلوکالری تا هدف مانده است.");
  });

  it("says plainly when the target is reached or passed, without scolding", () => {
    expect(meterOf(2000, 2000).state).toBe("REACHED");
    expect(meterSentence(meterOf(2000, 2000), persian)).toBe("به هدف روزانه رسیدی.");
    const over = meterOf(2300, 2000);
    expect(over).toMatchObject({ state: "OVER", remaining: -300, fill: 1 });
    expect(meterSentence(over, persian)).toBe("300 کیلوکالری بیشتر از هدف.");
    expect(meterSentence(over, persian)).not.toMatch(/[!！]|زیاد خوردی|شکست/);
  });

  it("works without a target: only the total", () => {
    const meter = meterOf(800, null);
    expect(meter).toMatchObject({ state: "NO_TARGET", remaining: null, fill: 0 });
    expect(meterSentence(meter, persian)).toMatch(/هدفی نگذاشته/);
  });
});

describe("the week", () => {
  it("lists the days ending with the given one, oldest first, scaled together", () => {
    const data: MealData = { v: 1, target: 2000, entries: [meal("a", "2026-11-02", "LUNCH", "x", 1000), meal("b", "2026-11-01", "LUNCH", "y", 500)] };
    const bars = lastDays(data, "2026-11-02", 3);
    expect(bars.map((b) => b.day)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(bars.map((b) => b.total)).toEqual([0, 500, 1000]);
    // The target (2000) is taller than every day, so it is the scale.
    expect(bars.map((b) => b.height)).toEqual([0, 0.25, 0.5]);
  });

  it("has no height at all for an empty week without a target", () => {
    expect(lastDays(EMPTY_MEALS, "2026-11-02", 7).every((b) => b.height === 0)).toBe(true);
  });
});

describe("suggestions", () => {
  it("offers what was written most often first, with its latest calories", () => {
    const data: MealData = {
      v: 1,
      target: null,
      entries: [
        meal("1", "2026-10-01", "BREAKFAST", "املت", 300),
        meal("2", "2026-10-05", "BREAKFAST", " املت ", 340),
        meal("3", "2026-10-02", "LUNCH", "سالاد", 150),
        meal("4", "2026-10-09", "DINNER", "سوپ", 200),
      ],
    };
    const list = suggestions(data, 2);
    expect(list).toEqual([
      { title: "املت", kind: "BREAKFAST", kcal: 340 },
      { title: "سوپ", kind: "DINNER", kcal: 200 },
    ]);
  });
});

describe("burnedFromHabits", () => {
  it("adds up only calorie habits' amounts, as information", () => {
    expect(
      burnedFromHabits([
        { type: "HABIT", habitMetricKind: "CALORIES", habitAmount: 450 },
        { type: "HABIT", habitMetricKind: "DISTANCE", habitAmount: 5 },
        { type: "HABIT", habitMetricKind: "CALORIES", habitAmount: 380 },
        { type: "TRANSACTION", habitMetricKind: null, habitAmount: null },
      ])
    ).toBe(830);
    expect(burnedFromHabits(undefined)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { buildHabitCalendar, chartMetric, monthBars, orderHabitsForList, summarizeHabitMonth, type HabitRowLike } from "./habitCalendar";

const at = (day: number) => new Date(2026, 10, day);
const habit = (id: string, over: Partial<HabitRowLike> = {}): HabitRowLike => ({ id, title: id, icon: null, color: "#3a8d80", metricKind: null, isActive: true, ...over });

describe("buildHabitCalendar", () => {
  it("keys each day by its calendar day and keeps what the tick logged", () => {
    const stats = buildHabitCalendar(
      [habit("run", { metricKind: "DISTANCE" })],
      [
        { habitId: "run", date: at(2), durationMin: 30, amount: 5.5 },
        { habitId: "run", date: at(4), durationMin: null, amount: null },
      ]
    );
    expect(stats).toHaveLength(1);
    expect(stats[0].metricKind).toBe("DISTANCE");
    expect(stats[0].days).toEqual({ "2026-11-02": { amount: 5.5, minutes: 30 }, "2026-11-04": { amount: null, minutes: null } });
  });

  it("treats a zero as nothing written", () => {
    const [stat] = buildHabitCalendar([habit("read", { metricKind: "PAGES" })], [{ habitId: "read", date: at(3), durationMin: 0, amount: 0 }]);
    expect(stat.days["2026-11-03"]).toEqual({ amount: null, minutes: null });
  });

  it("lists an active habit even with no tick, and an inactive one only when it was done that month", () => {
    const stats = buildHabitCalendar(
      [habit("idle"), habit("old-done", { isActive: false }), habit("old-idle", { isActive: false })],
      [{ habitId: "old-done", date: at(1), durationMin: null, amount: null }]
    );
    expect(stats.map((s) => s.habitId)).toEqual(["idle", "old-done"]);
    expect(stats[0].days).toEqual({});
  });

  it("does not trust a kind it does not know", () => {
    expect(buildHabitCalendar([habit("x", { metricKind: "WEIGHT" })], [])[0].metricKind).toBeNull();
  });
});

describe("summarizeHabitMonth", () => {
  it("counts the days, adds the measure and the minutes, and finds the best day", () => {
    const summary = summarizeHabitMonth({
      days: {
        "2026-11-02": { amount: 5, minutes: 30 },
        "2026-11-05": { amount: 8.5, minutes: 55 },
        "2026-11-09": { amount: null, minutes: null },
        "2026-11-11": { amount: 8.5, minutes: null },
      },
    });
    expect(summary).toEqual({ daysDone: 4, totalAmount: 22, amountDays: 3, totalMinutes: 85, best: { key: "2026-11-05", amount: 8.5 } });
  });

  it("gives a tick-only habit its days and nothing else", () => {
    expect(summarizeHabitMonth({ days: { "2026-11-02": { amount: null, minutes: null }, "2026-11-03": { amount: null, minutes: null } } })).toEqual({
      daysDone: 2,
      totalAmount: 0,
      amountDays: 0,
      totalMinutes: 0,
      best: null,
    });
  });

  it("is all zeros for a month without a tick", () => {
    expect(summarizeHabitMonth({ days: {} })).toEqual({ daysDone: 0, totalAmount: 0, amountDays: 0, totalMinutes: 0, best: null });
  });
});

describe("orderHabitsForList", () => {
  it("puts the habits done most this month first, then the idle ones by name", () => {
    const day = { amount: null, minutes: null };
    const ordered = orderHabitsForList([
      { title: "ب", days: {} },
      { title: "الف", days: { a: day } },
      { title: "ج", days: { a: day, b: day, c: day } },
      { title: "آ", days: {} },
    ]);
    expect(ordered.map((h) => h.title)).toEqual(["ج", "الف", "آ", "ب"]);
  });
});

describe("the chart", () => {
  const days = [
    { key: "2026-11-01", label: 10 },
    { key: "2026-11-02", label: 11 },
    { key: "2026-11-03", label: 12 },
  ];

  it("plots the measure when any day has one, otherwise the minutes, otherwise nothing", () => {
    expect(chartMetric({ days: { a: { amount: 3, minutes: 20 } } })).toBe("amount");
    expect(chartMetric({ days: { a: { amount: null, minutes: 20 } } })).toBe("minutes");
    expect(chartMetric({ days: { a: { amount: null, minutes: null } } })).toBeNull();
    expect(chartMetric({ days: {} })).toBeNull();
  });

  it("makes a bar for every day, empty ones at zero, scaled to the tallest", () => {
    const bars = monthBars({ days: { "2026-11-01": { amount: 2, minutes: null }, "2026-11-03": { amount: 8, minutes: null } } }, "amount", days);
    expect(bars.map((b) => [b.label, b.value, b.height])).toEqual([
      [10, 2, 0.25],
      [11, 0, 0],
      [12, 8, 1],
    ]);
  });

  it("has no height at all when nothing was logged", () => {
    expect(monthBars({ days: {} }, "minutes", days).every((b) => b.height === 0)).toBe(true);
  });
});

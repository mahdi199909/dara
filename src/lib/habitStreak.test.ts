import { describe, it, expect } from "vitest";
import {
  computeAdherenceSeries,
  computeCurrentStreak,
  daysSinceLastCheckIn,
  isHabitNeglected,
  trialDayNumber,
  isTrialElapsed,
} from "./habitStreak";

const day = (d: number) => new Date(2026, 0, d);

const habits = [
  { id: "h1", createdAt: day(1), isActive: true },
  { id: "h2", createdAt: day(1), isActive: true },
];

describe("computeAdherenceSeries", () => {
  it("computes ratio per day from check-ins", () => {
    const checkIns = [
      { habitId: "h1", date: day(5) },
      { habitId: "h2", date: day(5) },
      { habitId: "h1", date: day(6) },
    ];
    const series = computeAdherenceSeries(habits, checkIns, day(5), day(6));
    expect(series[0]).toMatchObject({ total: 2, checkedIn: 2, ratio: 1 });
    expect(series[1]).toMatchObject({ total: 2, checkedIn: 1, ratio: 0.5 });
  });

  it("excludes a habit from days before it was created", () => {
    const laterHabits = [...habits, { id: "h3", createdAt: day(10), isActive: true }];
    const series = computeAdherenceSeries(laterHabits, [], day(5), day(5));
    expect(series[0].total).toBe(2);
  });

  it("ignores inactive habits", () => {
    const withInactive = [...habits, { id: "h3", createdAt: day(1), isActive: false }];
    const series = computeAdherenceSeries(withInactive, [], day(5), day(5));
    expect(series[0].total).toBe(2);
  });

  it("returns ratio 0 (not NaN) when there are no active habits", () => {
    const series = computeAdherenceSeries([], [], day(5), day(5));
    expect(series[0]).toMatchObject({ total: 0, checkedIn: 0, ratio: 0 });
  });

  it("excludes trial habits — a 3-day experiment can't affect the established streak", () => {
    const withTrial = [...habits, { id: "h3", createdAt: day(1), isActive: true, isTrial: true }];
    const checkIns = [{ habitId: "h1", date: day(5) }, { habitId: "h2", date: day(5) }];
    const series = computeAdherenceSeries(withTrial, checkIns, day(5), day(5));
    expect(series[0]).toMatchObject({ total: 2, checkedIn: 2, ratio: 1 });
  });
});

describe("computeCurrentStreak", () => {
  it("counts consecutive days at/above the 80% threshold", () => {
    const series = [
      { date: day(1), total: 2, checkedIn: 2, ratio: 1 },
      { date: day(2), total: 2, checkedIn: 2, ratio: 1 },
      { date: day(3), total: 2, checkedIn: 1, ratio: 0.5 },
      { date: day(4), total: 2, checkedIn: 2, ratio: 1 },
    ];
    expect(computeCurrentStreak(series, day(4))).toBe(1);
  });

  it("does not break the streak on an incomplete today", () => {
    const series = [
      { date: day(1), total: 2, checkedIn: 2, ratio: 1 },
      { date: day(2), total: 2, checkedIn: 2, ratio: 1 },
      { date: day(3), total: 2, checkedIn: 0, ratio: 0 },
    ];
    expect(computeCurrentStreak(series, day(3))).toBe(2);
  });

  it("skips days with no active habits without breaking the streak", () => {
    const series = [
      { date: day(1), total: 2, checkedIn: 2, ratio: 1 },
      { date: day(2), total: 0, checkedIn: 0, ratio: 0 },
      { date: day(3), total: 2, checkedIn: 2, ratio: 1 },
    ];
    expect(computeCurrentStreak(series, day(3))).toBe(2);
  });

  it("is 0 when the most recently closed day misses the threshold", () => {
    const series = [
      { date: day(1), total: 2, checkedIn: 2, ratio: 1 },
      { date: day(2), total: 2, checkedIn: 0, ratio: 0 },
      { date: day(3), total: 2, checkedIn: 0, ratio: 0 },
    ];
    expect(computeCurrentStreak(series, day(3))).toBe(0);
  });
});

describe("daysSinceLastCheckIn / isHabitNeglected", () => {
  it("counts days since the most recent check-in across habits with multiple entries", () => {
    const checkIns = [{ habitId: "h1", date: day(1) }, { habitId: "h1", date: day(3) }];
    expect(daysSinceLastCheckIn(checkIns, day(1), day(6))).toBe(3);
  });

  it("falls back to the habit's creation date when there are no check-ins", () => {
    expect(daysSinceLastCheckIn([], day(1), day(4))).toBe(3);
  });

  it("flags neglect at the configured threshold", () => {
    expect(isHabitNeglected(2, 3)).toBe(false);
    expect(isHabitNeglected(3, 3)).toBe(true);
  });
});

describe("trialDayNumber / isTrialElapsed", () => {
  it("reports day 1 on the trial's own start day", () => {
    expect(trialDayNumber(day(1), day(1))).toBe(1);
  });

  it("counts up to and clamps at the trial length", () => {
    expect(trialDayNumber(day(1), day(2))).toBe(2);
    expect(trialDayNumber(day(1), day(3))).toBe(3);
    expect(trialDayNumber(day(1), day(4))).toBe(3);
    expect(trialDayNumber(day(1), day(10))).toBe(3);
  });

  it("is not elapsed during the 3-day window and elapsed on/after day 4", () => {
    expect(isTrialElapsed(day(1), day(1))).toBe(false);
    expect(isTrialElapsed(day(1), day(3))).toBe(false);
    expect(isTrialElapsed(day(1), day(4))).toBe(true);
  });
});

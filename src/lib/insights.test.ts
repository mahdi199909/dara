import { describe, expect, it } from "vitest";
import {
  dayOfWeekCost,
  categoryDrift,
  hiddenCostTop,
  milestoneHours,
  onThisDay,
  personalRecord,
  unloggedGap,
  selectDailyInsight,
  collectCandidates,
  type InsightContext,
  type DailyMinutes,
} from "./insights";
import type { TimeAndMoneyReport, HiddenCostReport } from "./reportEngine";

function emptyReport(overrides: Partial<TimeAndMoneyReport> = {}): TimeAndMoneyReport {
  return {
    from: new Date("2026-01-01"),
    to: new Date("2026-01-31"),
    hourlyValue: 100_000,
    totalDurationMin: 0,
    productiveMin: 0,
    neutralMin: 0,
    wasteMin: 0,
    productiveRatio: 0,
    timeByCategory: [],
    timeByProject: [],
    income: 0,
    expense: 0,
    net: 0,
    expenseByCategory: [],
    timeCost: 0,
    opportunityCost: 0,
    realCost: 0,
    virtualAssetValue: 0,
    tasksCompleted: 0,
    eventsCount: 0,
    ...overrides,
  };
}

function emptyHiddenCost(overrides: Partial<HiddenCostReport> = {}): HiddenCostReport {
  return { items: [], totalDirectCost: 0, totalTimeCost: 0, totalHiddenCost: 0, ...overrides };
}

function baseContext(overrides: Partial<InsightContext> = {}): InsightContext {
  return {
    now: new Date("2026-06-10T20:00:00.000Z"),
    dataDays: 30,
    report7d: emptyReport(),
    report30d: emptyReport(),
    report90d: emptyReport(),
    reportPrevious30d: emptyReport(),
    hiddenCost7d: emptyHiddenCost(),
    onThisDayLastMonth: emptyReport(),
    onThisDayLastYear: emptyReport(),
    categoryLifetimeMinutes: {},
    projectLifetimeMinutes: {},
    capitalSnapshots: [],
    weekDaySegments: [],
    hourlyValue: 100_000,
    ...overrides,
  };
}

describe("dayOfWeekCost", () => {
  it("returns null with fewer than 14 days of account history", () => {
    const daily: DailyMinutes[] = Array.from({ length: 10 }, (_, i) => ({ date: `2026-06-${i + 1}`, minutes: 60 }));
    expect(dayOfWeekCost(baseContext({ dataDays: 10 }), daily)).toBeNull();
  });

  it("finds a weekday that's meaningfully above the daily average", () => {
    // Three Wednesdays (2026-06-03, -10, -17) at 4h each, every other day at 30min.
    const daily: DailyMinutes[] = [];
    for (let i = 0; i < 21; i++) {
      const d = new Date("2026-06-01");
      d.setDate(d.getDate() + i);
      const isWednesday = d.getDay() === 3;
      daily.push({ date: d.toISOString().slice(0, 10), minutes: isWednesday ? 240 : 30 });
    }
    const result = dayOfWeekCost(baseContext(), daily);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("چهارشنبه");
    expect(result!.text).toContain("به نظر می‌رسد"); // hedged — this is a statistical pattern
  });
});

describe("categoryDrift", () => {
  it("returns null when no category's share shifted more than 25 points", () => {
    const report30d = emptyReport({ timeByCategory: [{ categoryId: "c1", name: "کار", color: "#000", kind: "PRODUCTIVE", minutes: 100 }] });
    const reportPrevious30d = emptyReport({ timeByCategory: [{ categoryId: "c1", name: "کار", color: "#000", kind: "PRODUCTIVE", minutes: 105 }] });
    expect(categoryDrift(baseContext({ report30d, reportPrevious30d }))).toBeNull();
  });

  it("finds a category whose share grew by more than 25 percentage points", () => {
    const report30d = emptyReport({
      timeByCategory: [
        { categoryId: "c1", name: "کار", color: "#000", kind: "PRODUCTIVE", minutes: 300 },
        { categoryId: "c2", name: "شبکه‌های اجتماعی", color: "#000", kind: "WASTE", minutes: 600 },
        { categoryId: "c3", name: "خانه", color: "#000", kind: "NEUTRAL", minutes: 100 },
      ],
    });
    const reportPrevious30d = emptyReport({
      timeByCategory: [
        { categoryId: "c1", name: "کار", color: "#000", kind: "PRODUCTIVE", minutes: 500 },
        { categoryId: "c2", name: "شبکه‌های اجتماعی", color: "#000", kind: "WASTE", minutes: 200 },
        { categoryId: "c3", name: "خانه", color: "#000", kind: "NEUTRAL", minutes: 300 },
      ],
    });
    const result = categoryDrift(baseContext({ report30d, reportPrevious30d }));
    expect(result).not.toBeNull();
    expect(result!.text).toContain("شبکه‌های اجتماعی");
    expect(result!.text).toContain("بیشتر شده");
  });
});

describe("hiddenCostTop", () => {
  it("returns null when no item has a zero direct cost with a real time cost", () => {
    const hiddenCost7d = emptyHiddenCost({ items: [{ entityType: "TASK", id: "t1", title: "کار", categoryName: null, directCost: 50_000, durationMin: 60, timeCost: 100_000, hiddenCost: 150_000, date: new Date() }] });
    expect(hiddenCostTop(baseContext({ hiddenCost7d }))).toBeNull();
  });

  it("surfaces the biggest zero-direct-cost item, naming it and its real time cost", () => {
    const hiddenCost7d = emptyHiddenCost({
      items: [
        { entityType: "EVENT", id: "e1", title: "جلسه کوچک", categoryName: null, directCost: 0, durationMin: 30, timeCost: 100_000, hiddenCost: 100_000, date: new Date() },
        { entityType: "TASK", id: "t2", title: "این جلسه", categoryName: null, directCost: 0, durationMin: 90, timeCost: 240_000, hiddenCost: 240_000, date: new Date() },
      ],
    });
    const result = hiddenCostTop(baseContext({ hiddenCost7d }));
    expect(result?.text).toContain("«این جلسه»");
    expect(result?.text).toContain("۲۴۰,۰۰۰ تومان");
  });
});

describe("milestoneHours", () => {
  it("returns null when no category/project crossed a threshold this period", () => {
    const report30d = emptyReport({ timeByCategory: [{ categoryId: "c1", name: "زبان انگلیسی", color: "#000", kind: "PRODUCTIVE", minutes: 120 }] });
    const ctx = baseContext({ report30d, categoryLifetimeMinutes: { c1: 400 } }); // already well past 6h before this period too
    expect(milestoneHours(ctx)).toBeNull();
  });

  it("detects a category crossing the 50-hour threshold within this period", () => {
    const report30d = emptyReport({ timeByCategory: [{ categoryId: "c1", name: "زبان انگلیسی", color: "#000", kind: "PRODUCTIVE", minutes: 300 }] }); // 5h this period
    // lifetime 3005min (~50.08h); before this period: 3005-300=2705min (~45h) — crossed 50h now.
    const ctx = baseContext({ report30d, categoryLifetimeMinutes: { c1: 3005 } });
    const result = milestoneHours(ctx);
    expect(result?.text).toContain("«زبان انگلیسی»");
    expect(result?.text).toContain("۵۰ ساعت");
  });
});

describe("onThisDay", () => {
  it("returns null when neither a year ago nor a month ago has any recorded time", () => {
    expect(onThisDay(baseContext())).toBeNull();
  });

  it("prefers the year-ago memory when both a year and a month ago have data", () => {
    const ctx = baseContext({
      onThisDayLastMonth: emptyReport({ from: new Date("2026-05-10"), timeByCategory: [{ categoryId: "c1", name: "کار", color: "#000", kind: "PRODUCTIVE", minutes: 60 }], totalDurationMin: 60 }),
      onThisDayLastYear: emptyReport({ from: new Date("2025-06-10"), timeByCategory: [{ categoryId: "c2", name: "سفر", color: "#000", kind: "NEUTRAL", minutes: 200 }], totalDurationMin: 200 }),
    });
    const result = onThisDay(ctx);
    expect(result?.text).toContain("«سفر»");
    expect(result?.text).toContain("سال");
  });
});

describe("personalRecord", () => {
  it("returns null when today's invested minutes don't exceed the historical max", () => {
    const capitalSnapshots = Array.from({ length: 10 }, (_, i) => ({ date: `d${i}`, investedMinutes: i * 60 })); // steady +60/day, today is not a record
    expect(personalRecord(baseContext({ capitalSnapshots }))).toBeNull();
  });

  it("detects a newly broken single-day record", () => {
    const capitalSnapshots = [
      { date: "d0", investedMinutes: 0 },
      { date: "d1", investedMinutes: 60 },
      { date: "d2", investedMinutes: 120 },
      { date: "d3", investedMinutes: 150 },
      { date: "d4", investedMinutes: 200 },
      { date: "d5", investedMinutes: 240 },
      { date: "d6 (today)", investedMinutes: 600 }, // +360 today, far above any prior day's delta
    ];
    const result = personalRecord(baseContext({ capitalSnapshots }));
    expect(result?.text).toContain("بیشترین مقدار در یک روز");
  });
});

describe("unloggedGap", () => {
  it("returns null when every gap across the week is under an hour", () => {
    const weekDaySegments = [{ date: "2026-06-10", wakeTime: new Date("2026-06-10T07:00:00.000Z"), sleepTime: new Date("2026-06-10T07:30:00.000Z"), intervals: [] }];
    expect(unloggedGap(baseContext({ weekDaySegments }))).toBeNull();
  });

  it("finds the largest unlogged gap across the week's days", () => {
    const weekDaySegments = [
      { date: "2026-06-09", wakeTime: new Date("2026-06-09T07:00:00.000Z"), sleepTime: new Date("2026-06-09T09:00:00.000Z"), intervals: [] }, // 2h gap
      {
        date: "2026-06-10",
        wakeTime: new Date("2026-06-10T07:00:00.000Z"),
        sleepTime: new Date("2026-06-10T12:00:00.000Z"),
        intervals: [{ start: new Date("2026-06-10T07:00:00.000Z"), end: new Date("2026-06-10T08:00:00.000Z"), kind: "PRODUCTIVE" as const }],
      }, // 4h gap after
    ];
    const result = unloggedGap(baseContext({ weekDaySegments }));
    expect(result?.text).toContain("۴ ساعت");
  });
});

describe("selectDailyInsight", () => {
  it("returns null when nothing clears the honesty gate", () => {
    expect(selectDailyInsight(baseContext({ dataDays: 3 }), [], "user_1", new Set())).toBeNull();
  });

  it("is deterministic for the same user and day, and excludes already-shown ids", () => {
    const hiddenCost7d = emptyHiddenCost({
      items: [{ entityType: "TASK", id: "t1", title: "کار الف", categoryName: null, directCost: 0, durationMin: 60, timeCost: 300_000, hiddenCost: 300_000, date: new Date() }],
    });
    const ctx = baseContext({ hiddenCost7d });

    const first = selectDailyInsight(ctx, [], "user_1", new Set());
    const second = selectDailyInsight(ctx, [], "user_1", new Set());
    expect(first).toEqual(second);

    const excluded = selectDailyInsight(ctx, [], "user_1", new Set([first!.id]));
    expect(excluded).toBeNull(); // it was the only candidate
  });

  it("collectCandidates sorts by strength descending", () => {
    const hiddenCost7d = emptyHiddenCost({
      items: [{ entityType: "TASK", id: "t1", title: "کار الف", categoryName: null, directCost: 0, durationMin: 10, timeCost: 50_000, hiddenCost: 50_000, date: new Date() }],
    });
    const capitalSnapshots = [
      { date: "d0", investedMinutes: 0 },
      { date: "d1", investedMinutes: 60 },
      { date: "d2", investedMinutes: 120 },
      { date: "d3", investedMinutes: 150 },
      { date: "d4", investedMinutes: 200 },
      { date: "d5", investedMinutes: 240 },
      { date: "d6", investedMinutes: 600 },
    ];
    const candidates = collectCandidates(baseContext({ hiddenCost7d, capitalSnapshots }), []);
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i - 1].strength).toBeGreaterThanOrEqual(candidates[i].strength);
    }
  });
});

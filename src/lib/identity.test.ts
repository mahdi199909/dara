import { describe, expect, it } from "vitest";
import {
  weeklyHoursOnSkill,
  consecutiveWeeksHabit,
  projectsCompletedSince,
  biggestThingBuilt,
  loggingStreak,
  computeLoggingStreak,
  buildIdentityStatements,
  type IdentityContext,
} from "./identity";

const NOW = new Date("2026-01-29T12:00:00.000Z");

function baseCtx(overrides: Partial<IdentityContext> = {}): IdentityContext {
  return {
    now: NOW,
    dataDays: 30,
    skillCandidates30d: [],
    habitCandidates: [],
    completedProjectsCount: 0,
    projectWindowStart: new Date("2025-11-01T00:00:00.000Z"),
    topCategory90d: null,
    totalMinutes90d: 0,
    loggingActiveDayKeys: new Set(),
    ...overrides,
  };
}

describe("honesty gate (dataDays < 14)", () => {
  it("suppresses every pattern regardless of otherwise-qualifying data", () => {
    const ctx = baseCtx({
      dataDays: 5,
      skillCandidates30d: [{ categoryId: "c1", name: "زبان", minutes: 900 }],
      habitCandidates: [{ habitId: "h1", title: "ورزش", checkInDates: [day(28), day(21), day(14)] }],
      completedProjectsCount: 2,
      topCategory90d: { categoryId: "c2", name: "کار", minutes: 600 },
      totalMinutes90d: 2000,
      loggingActiveDayKeys: new Set(["2026-01-29", "2026-01-28", "2026-01-27"]),
    });
    expect(weeklyHoursOnSkill(ctx)).toBeNull();
    expect(consecutiveWeeksHabit(ctx)).toBeNull();
    expect(projectsCompletedSince(ctx)).toBeNull();
    expect(biggestThingBuilt(ctx)).toBeNull();
    expect(loggingStreak(ctx)).toBeNull();
  });
});

function day(d: number): Date {
  return new Date(2026, 0, d);
}

describe("weeklyHoursOnSkill", () => {
  it("picks the top skill by minutes and reports its weekly average", () => {
    const ctx = baseCtx({
      skillCandidates30d: [
        { categoryId: "c1", name: "زبان انگلیسی", minutes: 900 },
        { categoryId: "c2", name: "نقاشی", minutes: 200 },
      ],
    });
    const result = weeklyHoursOnSkill(ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("در ۳۰ روز گذشته، هفته‌ای ۳ ساعت و ۳۰ دقیقه روی «زبان انگلیسی» گذاشتی.");
    expect(result!.evidence).toBe("/reports?category=c1");
    expect(result!.strength).toBeCloseTo(210 / 420, 5);
  });

  it("returns null when the weekly average is below the floor", () => {
    const ctx = baseCtx({ skillCandidates30d: [{ categoryId: "c1", name: "زبان", minutes: 100 }] });
    expect(weeklyHoursOnSkill(ctx)).toBeNull();
  });

  it("returns null with no skill candidates", () => {
    expect(weeklyHoursOnSkill(baseCtx())).toBeNull();
  });

  it("never uses «پنهان»", () => {
    const ctx = baseCtx({ skillCandidates30d: [{ categoryId: "c1", name: "زبان", minutes: 900 }] });
    expect(weeklyHoursOnSkill(ctx)!.text).not.toContain("پنهان");
  });
});

describe("consecutiveWeeksHabit", () => {
  it("reports the habit with the longest current weekly streak", () => {
    const ctx = baseCtx({
      habitCandidates: [
        { habitId: "h1", title: "مطالعه", checkInDates: [day(28), day(21)] }, // 2 weeks
        { habitId: "h2", title: "ورزش", checkInDates: [day(28), day(21), day(14)] }, // 3 weeks
      ],
    });
    const result = consecutiveWeeksHabit(ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("۳ هفته پشت‌سرهم «ورزش» را نگه داشتی.");
    expect(result!.evidence).toBe("/habits");
  });

  it("returns null below the 2-week minimum", () => {
    const ctx = baseCtx({ habitCandidates: [{ habitId: "h1", title: "مطالعه", checkInDates: [day(28)] }] });
    expect(consecutiveWeeksHabit(ctx)).toBeNull();
  });

  it("returns null with no habit candidates", () => {
    expect(consecutiveWeeksHabit(baseCtx())).toBeNull();
  });
});

describe("projectsCompletedSince", () => {
  it("names the real count and the window start date", () => {
    const ctx = baseCtx({ completedProjectsCount: 2 });
    const result = projectsCompletedSince(ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("۲ پروژه را به پایان رساندی");
    expect(result!.evidence).toBe("/projects");
  });

  it("returns null with zero completions rather than a fabricated 'no projects' claim", () => {
    expect(projectsCompletedSince(baseCtx({ completedProjectsCount: 0 }))).toBeNull();
  });
});

describe("biggestThingBuilt", () => {
  it("names the top category and its share of the 90-day total", () => {
    const ctx = baseCtx({ topCategory90d: { categoryId: "c1", name: "کار", minutes: 600 }, totalMinutes90d: 2000 });
    const result = biggestThingBuilt(ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("بیشترین چیزی که ساختی «کار» بود — ۱۰ ساعت از کل زمانت.");
    expect(result!.strength).toBeCloseTo(0.3, 5);
  });

  it("returns null below the minimum-minutes floor", () => {
    const ctx = baseCtx({ topCategory90d: { categoryId: "c1", name: "کار", minutes: 100 }, totalMinutes90d: 500 });
    expect(biggestThingBuilt(ctx)).toBeNull();
  });

  it("returns null with no top category", () => {
    expect(biggestThingBuilt(baseCtx())).toBeNull();
  });
});

describe("computeLoggingStreak", () => {
  it("counts consecutive active days back from today", () => {
    const keys = new Set(["2026-01-29", "2026-01-28", "2026-01-27"]);
    expect(computeLoggingStreak(keys, NOW)).toBe(3);
  });

  it("gives today a pass while still in progress", () => {
    const keys = new Set(["2026-01-28"]); // yesterday only
    expect(computeLoggingStreak(keys, NOW)).toBe(1);
  });

  it("is 0 with no active days at all", () => {
    expect(computeLoggingStreak(new Set(), NOW)).toBe(0);
  });

  it("stops at the first real gap", () => {
    const keys = new Set(["2026-01-29", "2026-01-28", "2026-01-26"]); // gap on the 27th
    expect(computeLoggingStreak(keys, NOW)).toBe(2);
  });
});

describe("loggingStreak", () => {
  it("returns null below the 3-day minimum", () => {
    const ctx = baseCtx({ loggingActiveDayKeys: new Set(["2026-01-29", "2026-01-28"]) });
    expect(loggingStreak(ctx)).toBeNull();
  });

  it("states the real streak length once at the minimum", () => {
    const ctx = baseCtx({ loggingActiveDayKeys: new Set(["2026-01-29", "2026-01-28", "2026-01-27"]) });
    const result = loggingStreak(ctx);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("۳ روز پشت‌سرهم روزت را ثبت کرده‌ای.");
  });
});

describe("buildIdentityStatements", () => {
  it("collects every qualifying pattern, sorted by strength descending", () => {
    const ctx = baseCtx({
      skillCandidates30d: [{ categoryId: "c1", name: "زبان", minutes: 900 }], // strength 0.5
      completedProjectsCount: 3, // strength 1
      loggingActiveDayKeys: new Set(["2026-01-29", "2026-01-28", "2026-01-27"]), // strength ~0.214
    });
    const results = buildIdentityStatements(ctx);
    expect(results.length).toBe(3);
    expect(results[0].id).toContain("projectsCompletedSince");
    expect(results.map((r) => r.strength)).toEqual([...results.map((r) => r.strength)].sort((a, b) => b - a));
  });

  it("returns an empty array rather than inventing a statement when nothing qualifies", () => {
    expect(buildIdentityStatements(baseCtx())).toEqual([]);
  });
});

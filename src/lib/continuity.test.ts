import { describe, expect, it } from "vitest";
import { BREAK_DAYS, computeContinuity, continuityDetail, continuityHeadline, habitContinuityLine, type ContinuityDay } from "./continuity";

const TODAY = new Date(2026, 10, 2, 15, 0, 0);

/**
 * A series ending today from a string: one character per day, oldest first.
 *   "x" = showed up, "." = a miss, "-" = no habit existed yet (not an eligible day).
 */
function series(pattern: string): ContinuityDay[] {
  return [...pattern].map((ch, i) => ({
    date: new Date(2026, 10, 2 - (pattern.length - 1 - i)),
    total: ch === "-" ? 0 : 2,
    checkedIn: ch === "x" ? 1 : 0,
  }));
}

describe("computeContinuity", () => {
  it("counts the days showed up out of the days that could have been", () => {
    const c = computeContinuity(series("--xx.x.xx"), TODAY);
    expect(c.eligibleDays).toBe(7);
    expect(c.daysShownUp).toBe(5);
  });

  it("is a run while today or yesterday was shown up for", () => {
    expect(computeContinuity(series("..xxx"), TODAY)).toMatchObject({ state: "ACTIVE", currentRun: 3, daysAway: 0 });
    // Yesterday shown up, today still open: the run is alive.
    expect(computeContinuity(series("..xxx."), TODAY)).toMatchObject({ state: "ACTIVE", currentRun: 3, daysAway: 1 });
  });

  it("does not count today as a miss while it is still open", () => {
    const c = computeContinuity(series("xx."), TODAY);
    expect(c.daysShownUp).toBe(2);
    expect(c.comebacks).toBe(0);
    expect(c.state).toBe("ACTIVE");
  });

  it("is away after two or more eligible days without showing up, with no run", () => {
    const c = computeContinuity(series("xxx..."), TODAY);
    expect(c).toMatchObject({ state: "AWAY", currentRun: 0 });
    expect(c.daysAway).toBe(3);
  });

  it("calls today a return after a break, and says how long the break was", () => {
    const c = computeContinuity(series("xx...x"), TODAY);
    expect(c).toMatchObject({ state: "BACK", breakBridgedToday: 3, comebacks: 1, longestBreakReturned: 3, currentRun: 1 });
  });

  it("counts a single missed day as no break at all", () => {
    expect(BREAK_DAYS).toBe(2);
    const c = computeContinuity(series("xx.xx"), TODAY);
    expect(c.comebacks).toBe(0);
    expect(c.state).toBe("ACTIVE");
  });

  it("counts every return in the window and remembers the longest break", () => {
    const c = computeContinuity(series("x..x....xx.x"), TODAY);
    expect(c.comebacks).toBe(2); // after 2 misses and after 4
    expect(c.longestBreakReturned).toBe(4);
  });

  it("does not take the days before the first time shown up for a break", () => {
    const c = computeContinuity(series("....xx"), TODAY);
    expect(c.comebacks).toBe(0);
    expect(c.state).toBe("ACTIVE");
  });

  it("skips the days no habit existed: they are neither a miss nor a day shown up", () => {
    const c = computeContinuity(series("--xx"), TODAY);
    expect(c.eligibleDays).toBe(2);
    expect(c).toMatchObject({ daysShownUp: 2, currentRun: 2, state: "ACTIVE" });
    // A break is counted in eligible days only.
    expect(computeContinuity(series("x--.x"), TODAY).comebacks).toBe(0);
  });

  it("has no history before anything was done — also for an empty series", () => {
    expect(computeContinuity(series("...."), TODAY)).toMatchObject({ state: "NO_HISTORY", daysShownUp: 0, daysAway: null, currentRun: 0 });
    expect(computeContinuity([], TODAY)).toMatchObject({ state: "NO_HISTORY", eligibleDays: 0 });
  });

  it("reads dates that arrived as text (the API sends JSON)", () => {
    const asText = series("xx...x").map((d) => ({ ...d, date: (d.date as Date).toISOString() }));
    expect(computeContinuity(asText, TODAY).state).toBe("BACK");
  });
});

describe("the words", () => {
  it("never reproaches: a break is an invitation", () => {
    const away = computeContinuity(series("xxx..."), TODAY);
    expect(continuityHeadline(away)).toBe("امروز می‌توانی برگردی");
    expect(continuityDetail(away)).toBe("۳ از ۶ روز اخیر آمدی · آخرین بار ۳ روز پیش بود");
  });

  it("says what today is", () => {
    expect(continuityHeadline(computeContinuity(series("xx...x"), TODAY))).toBe("امروز بعد از ۳ روز برگشتی");
    expect(continuityHeadline(computeContinuity(series("..xxx"), TODAY))).toBe("۳ روز است پشت‌سر هم می‌آیی");
    expect(continuityHeadline(computeContinuity(series("..x"), TODAY))).toBe("امروز آمدی");
    expect(continuityHeadline(computeContinuity(series("..x."), TODAY))).toBe("دیروز آمدی؛ امروز هم وقت داری");
    expect(continuityHeadline(computeContinuity(series("...."), TODAY))).toBe("استمرارت با اولین عادتی که انجام بدهی شروع می‌شود");
  });

  it("gives the numbers behind it, with the returns when there were any", () => {
    expect(continuityDetail(computeContinuity(series("x..x....xx.x"), TODAY))).toBe("۵ از ۱۲ روز اخیر آمدی · ۲ بار بعد از وقفه برگشتی");
    expect(continuityDetail(computeContinuity(series("...."), TODAY))).toBe("");
  });

  it("states one habit's line as a plain fact", () => {
    expect(habitContinuityLine({ currentStreak: 5, daysSinceLastCheckIn: 0 })).toBe("۵ روز است پشت‌سر هم می‌آیی");
    expect(habitContinuityLine({ currentStreak: 1, daysSinceLastCheckIn: 0 })).toBe("امروز یا دیروز آمدی");
    expect(habitContinuityLine({ currentStreak: 0, daysSinceLastCheckIn: 4 })).toBe("۴ روز از آخرین تیک");
  });

  it("uses none of the words the product avoids: no exclamation marks, no «استریک»", () => {
    const samples = [
      continuityHeadline(computeContinuity(series("xxx..."), TODAY)),
      continuityHeadline(computeContinuity(series("xx...x"), TODAY)),
      continuityDetail(computeContinuity(series("x..x....xx.x"), TODAY)),
      habitContinuityLine({ currentStreak: 0, daysSinceLastCheckIn: 9 }),
    ].join(" ");
    expect(samples).not.toMatch(/[!！]|استریک|شکست|ناکام/);
  });
});

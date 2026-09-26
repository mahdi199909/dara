import { describe, expect, it } from "vitest";
import { streakByDay } from "./journeyStreaks";

describe("streakByDay", () => {
  it("counts the run of consecutive days that ends on each day", () => {
    const streaks = streakByDay(["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-24"]);
    expect(streaks.get("2026-09-20")).toBe(1);
    expect(streaks.get("2026-09-21")).toBe(2);
    expect(streaks.get("2026-09-22")).toBe(3);
    expect(streaks.get("2026-09-24")).toBe(1); // the 23rd was missed
  });

  it("does not mind the order the days arrive in, or a day listed twice", () => {
    const streaks = streakByDay(["2026-09-22", "2026-09-20", "2026-09-21", "2026-09-21"]);
    expect([...streaks.entries()]).toEqual([
      ["2026-09-20", 1],
      ["2026-09-21", 2],
      ["2026-09-22", 3],
    ]);
  });

  it("runs across a month and a year boundary", () => {
    const streaks = streakByDay(["2026-08-31", "2026-09-01", "2026-12-31", "2027-01-01"]);
    expect(streaks.get("2026-09-01")).toBe(2);
    expect(streaks.get("2027-01-01")).toBe(2);
  });

  it("runs across the days a clock change makes 23 or 25 hours long", () => {
    // Late March / late October: the days on either side of a daylight-saving change must still be neighbours.
    const streaks = streakByDay(["2026-03-28", "2026-03-29", "2026-03-30", "2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(streaks.get("2026-03-30")).toBe(3);
    expect(streaks.get("2026-10-26")).toBe(3);
  });

  it("is empty for no days", () => {
    expect(streakByDay([]).size).toBe(0);
  });
});

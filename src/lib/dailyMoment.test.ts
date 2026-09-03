import { describe, expect, it } from "vitest";
import { selectDailyMoment, dailyMomentSeed, type DailyMomentCandidate } from "./dailyMoment";

const discovery: DailyMomentCandidate = { type: "discovery", text: "discovery text" };
const quote: DailyMomentCandidate = { type: "quote", text: "quote text" };
const onThisDay: DailyMomentCandidate = { type: "onThisDay", text: "on this day text" };
const milestone: DailyMomentCandidate = { type: "milestone", text: "milestone text" };

describe("selectDailyMoment", () => {
  it("returns null when no candidate is available at all", () => {
    expect(selectDailyMoment({}, "seed")).toBeNull();
  });

  it("is deterministic for the same seed", () => {
    const all = { discovery, quote, onThisDay, milestone };
    const first = selectDailyMoment(all, "user_1:1405-06-12:moment");
    const second = selectDailyMoment(all, "user_1:1405-06-12:moment");
    expect(first).toEqual(second);
  });

  it("can pick different types across different users and days", () => {
    const all = { discovery, quote, onThisDay, milestone };
    const seeds = Array.from({ length: 60 }, (_, i) => dailyMomentSeed(`user_${i % 5}`, new Date(2026, 0, 1 + i)));
    const picks = new Set(seeds.map((seed) => selectDailyMoment(all, seed)?.type));
    expect(picks.size).toBeGreaterThan(1); // not the same type every single time
  });

  it("falls forward to the next type in order when the chosen one has no candidate", () => {
    // Only "onThisDay" and "milestone" available — every seed must resolve to one of these two,
    // never null, since SOME type is always available.
    for (let i = 0; i < 20; i++) {
      const seed = dailyMomentSeed("user_1", new Date(2026, 0, 1 + i));
      const result = selectDailyMoment({ onThisDay, milestone }, seed);
      expect(["onThisDay", "milestone"]).toContain(result?.type);
    }
  });

  it("returns the only available candidate regardless of seed", () => {
    for (let i = 0; i < 10; i++) {
      const seed = dailyMomentSeed("user_1", new Date(2026, 0, 1 + i));
      expect(selectDailyMoment({ quote }, seed)).toEqual(quote);
    }
  });
});

describe("dailyMomentSeed", () => {
  it("differs from a bare userId:date pairing (so it doesn't correlate with insights.ts's own seed)", () => {
    const now = new Date("2026-06-10T12:00:00.000Z");
    expect(dailyMomentSeed("user_1", now)).not.toBe("user_1:1405-03-20");
    expect(dailyMomentSeed("user_1", now)).toContain(":moment");
  });
});

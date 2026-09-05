import { describe, expect, it } from "vitest";
import { computeCompanionState, type CompanionInput } from "./companion";

const WAKE = new Date(2026, 0, 1, 7, 0);
const SLEEP = new Date(2026, 0, 1, 23, 0);
const SEED = "test-seed";

function baseInput(overrides: Partial<CompanionInput>): CompanionInput {
  return {
    now: new Date(2026, 0, 1, 12, 0),
    wakeTime: WAKE,
    sleepTime: SLEEP,
    productiveMinutes: 0,
    habitMinutes: 0,
    wasteMinutes: 0,
    neutralMinutes: 0,
    unloggedMinutes: 0,
    targetMinutes: 360,
    loggedEntriesToday: 0,
    ...overrides,
  };
}

describe("computeCompanionState", () => {
  it("returns ASLEEP before wakeTime", () => {
    const result = computeCompanionState(baseInput({ now: new Date(2026, 0, 1, 6, 0) }), SEED);
    expect(result.mood).toBe("ASLEEP");
  });

  it("returns FRESH (not SLEEPY) 30 minutes after waking with 0 minutes logged — guards against morning guilt", () => {
    const result = computeCompanionState(baseInput({ now: new Date(2026, 0, 1, 7, 30), productiveMinutes: 0 }), SEED);
    expect(result.mood).toBe("FRESH");
  });

  it("returns SLEEPY at noon with only 30 minutes logged against a 360-minute target, with an actionable message", () => {
    const result = computeCompanionState(baseInput({ now: new Date(2026, 0, 1, 12, 0), productiveMinutes: 30 }), SEED);
    expect(result.mood).toBe("SLEEPY");
    expect(result.action.kind).toBe("CAPTURE");
    expect(result.action.label.length).toBeGreaterThan(0);
  });

  it("returns CONTENT at noon exactly on the expected pace line", () => {
    // elapsed = 300min, expectedByNow = 360 * (300/960) = 112.5; pace===0.8 at achieved=90
    const result = computeCompanionState(baseInput({ now: new Date(2026, 0, 1, 12, 0), productiveMinutes: 90 }), SEED);
    expect(result.mood).toBe("CONTENT");
  });

  it("returns HAPPY with completion === 1 on reaching the target minutes", () => {
    const result = computeCompanionState(baseInput({ now: new Date(2026, 0, 1, 18, 0), productiveMinutes: 360 }), SEED);
    expect(result.mood).toBe("HAPPY");
    expect(result.completion).toBe(1);
  });

  it("returns CELEBRATING at 540 minutes (1.5x the target)", () => {
    const result = computeCompanionState(baseInput({ now: new Date(2026, 0, 1, 18, 0), productiveMinutes: 540 }), SEED);
    expect(result.mood).toBe("CELEBRATING");
  });

  it("returns BLINDFOLDED with 4 elapsed hours and 3 unlogged hours, taking priority over SLEEPY", () => {
    // productiveMinutes: 0 would otherwise pace out to SLEEPY — BLINDFOLDED must win regardless.
    const result = computeCompanionState(
      baseInput({ now: new Date(2026, 0, 1, 11, 0), productiveMinutes: 0, unloggedMinutes: 180 }),
      SEED
    );
    expect(result.mood).toBe("BLINDFOLDED");
  });

  it("degrades to ASLEEP without crashing when sleepHour <= wakeHour (capacity 0)", () => {
    const brokenSleep = new Date(2026, 0, 1, 6, 0); // before wake (7:00)
    const result = computeCompanionState(baseInput({ sleepTime: brokenSleep }), SEED);
    expect(result.mood).toBe("ASLEEP");
    expect(result.achievedMinutes).toBe(0);
    expect(result.remainingMinutes).toBe(0);
  });

  it("counts habitMinutes toward achievedMinutes", () => {
    const result = computeCompanionState(baseInput({ productiveMinutes: 0, habitMinutes: 100 }), SEED);
    expect(result.achievedMinutes).toBe(100);
  });

  it("never returns an empty message, for any mood", () => {
    const scenarios: [string, Partial<CompanionInput>][] = [
      ["ASLEEP", { now: new Date(2026, 0, 1, 6, 0) }],
      ["FRESH", { now: new Date(2026, 0, 1, 7, 30) }],
      ["SLEEPY", { now: new Date(2026, 0, 1, 12, 0), productiveMinutes: 30 }],
      ["NEUTRAL", { now: new Date(2026, 0, 1, 12, 0), productiveMinutes: 60 }],
      ["CONTENT", { now: new Date(2026, 0, 1, 12, 0), productiveMinutes: 90 }],
      ["HAPPY", { now: new Date(2026, 0, 1, 18, 0), productiveMinutes: 360 }],
      ["CELEBRATING", { now: new Date(2026, 0, 1, 18, 0), productiveMinutes: 540 }],
      ["BLINDFOLDED", { now: new Date(2026, 0, 1, 11, 0), productiveMinutes: 0, unloggedMinutes: 180 }],
    ];
    for (const [expectedMood, overrides] of scenarios) {
      const result = computeCompanionState(baseInput(overrides), SEED);
      expect(result.mood).toBe(expectedMood);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

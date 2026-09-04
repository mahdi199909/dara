import { describe, expect, it } from "vitest";
import { nextMilestoneMinutes, MILESTONE_MINUTES } from "./milestones";

describe("nextMilestoneMinutes", () => {
  it("reports the first threshold not yet reached", () => {
    expect(nextMilestoneMinutes(0)).toBe(600); // 10h
    expect(nextMilestoneMinutes(599)).toBe(600);
  });

  it("advances to the following threshold once the current one is exactly reached", () => {
    expect(nextMilestoneMinutes(600)).toBe(1500); // 25h
    expect(nextMilestoneMinutes(15000)).toBe(30000); // 250h -> 500h
  });

  it("returns null once past the highest threshold", () => {
    expect(nextMilestoneMinutes(30000)).toBeNull(); // exactly 500h
    expect(nextMilestoneMinutes(100000)).toBeNull();
  });

  it("MILESTONE_MINUTES matches the documented 10/25/50/100/250/500-hour thresholds", () => {
    expect(MILESTONE_MINUTES).toEqual([600, 1500, 3000, 6000, 15000, 30000]);
  });
});

import { describe, expect, it } from "vitest";
import { computeDaySegments, type TimedInterval } from "./dayBattery";

const wake = new Date("2026-06-10T07:00:00.000Z");
const sleep = new Date("2026-06-10T23:00:00.000Z"); // 16h capacity = 960min

describe("computeDaySegments", () => {
  it("with no logged intervals, everything up to now is UNLOGGED and the rest is REMAINING", () => {
    const now = new Date("2026-06-10T10:00:00.000Z"); // 3h elapsed
    const result = computeDaySegments(wake, sleep, now, []);

    expect(result.capacityMinutes).toBe(960);
    expect(result.unloggedMinutes).toBe(180);
    expect(result.loggedMinutes).toBe(0);
    expect(result.remainingMinutes).toBe(780);
    expect(result.dayOver).toBe(false);
    expect(result.segments.map((s) => s.kind)).toEqual(["UNLOGGED", "REMAINING"]);
  });

  it("places a single logged interval in chronological order with UNLOGGED gaps around it", () => {
    const now = new Date("2026-06-10T12:00:00.000Z"); // 5h elapsed
    const intervals: TimedInterval[] = [{ start: new Date("2026-06-10T09:00:00.000Z"), end: new Date("2026-06-10T10:00:00.000Z"), kind: "PRODUCTIVE" }];
    const result = computeDaySegments(wake, sleep, now, intervals);

    expect(result.segments.map((s) => s.kind)).toEqual(["UNLOGGED", "PRODUCTIVE", "UNLOGGED", "REMAINING"]);
    expect(result.segments[1].minutes).toBe(60);
    expect(result.loggedMinutes).toBe(60);
    expect(result.unloggedMinutes).toBe(240); // (09:00-07:00) + (12:00-10:00) = 120 + 120
    expect(result.remainingMinutes).toBe(660); // 23:00 - 12:00
  });

  it("colors segments by kind: PRODUCTIVE, NEUTRAL, and WASTE all render distinctly", () => {
    const now = new Date("2026-06-10T13:00:00.000Z");
    const intervals: TimedInterval[] = [
      { start: new Date("2026-06-10T07:00:00.000Z"), end: new Date("2026-06-10T08:00:00.000Z"), kind: "PRODUCTIVE" },
      { start: new Date("2026-06-10T08:00:00.000Z"), end: new Date("2026-06-10T09:00:00.000Z"), kind: "NEUTRAL" },
      { start: new Date("2026-06-10T09:00:00.000Z"), end: new Date("2026-06-10T10:00:00.000Z"), kind: "WASTE" },
    ];
    const result = computeDaySegments(wake, sleep, now, intervals);

    expect(result.segments.slice(0, 3).map((s) => s.kind)).toEqual(["PRODUCTIVE", "NEUTRAL", "WASTE"]);
    expect(result.loggedMinutes).toBe(180);
    expect(result.segments.some((s) => s.kind === "UNLOGGED")).toBe(true); // 10:00 -> 13:00
  });

  it("gives the earlier-starting interval its full duration, truncating a later one that overlaps its tail", () => {
    const now = new Date("2026-06-10T11:00:00.000Z");
    const intervals: TimedInterval[] = [
      { start: new Date("2026-06-10T09:00:00.000Z"), end: new Date("2026-06-10T10:30:00.000Z"), kind: "PRODUCTIVE" },
      { start: new Date("2026-06-10T10:00:00.000Z"), end: new Date("2026-06-10T10:45:00.000Z"), kind: "WASTE" }, // overlaps the tail of the PRODUCTIVE one
    ];
    const result = computeDaySegments(wake, sleep, now, intervals);

    const productive = result.segments.find((s) => s.kind === "PRODUCTIVE")!;
    const waste = result.segments.find((s) => s.kind === "WASTE")!;
    expect(productive.minutes).toBe(90); // 09:00-10:30, kept whole — it started first
    expect(waste.minutes).toBe(15); // 10:30-10:45 — its overlapping head is truncated away
    expect(result.loggedMinutes).toBe(105);
  });

  it("once the day is over, there's no REMAINING segment and the battery stops growing", () => {
    const now = new Date("2026-06-11T02:00:00.000Z"); // well past sleepTime
    const intervals: TimedInterval[] = [{ start: new Date("2026-06-10T07:00:00.000Z"), end: new Date("2026-06-10T15:00:00.000Z"), kind: "PRODUCTIVE" }];
    const result = computeDaySegments(wake, sleep, now, intervals);

    expect(result.dayOver).toBe(true);
    expect(result.remainingMinutes).toBe(0);
    expect(result.segments.some((s) => s.kind === "REMAINING")).toBe(false);
    expect(result.loggedMinutes + result.unloggedMinutes).toBe(result.capacityMinutes);
  });

  it("opening the app before today's wake hour reads as 0 elapsed, all REMAINING", () => {
    const now = new Date("2026-06-10T05:00:00.000Z"); // before wake (07:00)
    const result = computeDaySegments(wake, sleep, now, []);

    expect(result.unloggedMinutes).toBe(0);
    expect(result.loggedMinutes).toBe(0);
    expect(result.remainingMinutes).toBe(960);
    expect(result.segments).toEqual([{ kind: "REMAINING", start: wake, end: sleep, minutes: 960 }]);
  });

  it("a misconfigured sleepHour <= wakeHour degrades to a capacity-0 result instead of negative durations", () => {
    const badSleep = new Date("2026-06-10T06:00:00.000Z"); // before wake
    const result = computeDaySegments(wake, badSleep, new Date("2026-06-10T12:00:00.000Z"), []);

    expect(result.capacityMinutes).toBe(0);
    expect(result.segments).toEqual([]);
    expect(result.dayOver).toBe(true);
  });
});

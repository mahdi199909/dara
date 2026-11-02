import { describe, expect, it } from "vitest";
import {
  DEFAULT_CYCLE_LENGTH,
  DEFAULT_PERIOD_LENGTH,
  EMPTY_CYCLE,
  addDays,
  addPeriod,
  averageCycleLength,
  averagePeriodLength,
  cycleLengths,
  cycleStatus,
  daysBetween,
  monthMarks,
  removePeriod,
  sanitizeCycle,
  updatePeriod,
  validatePeriod,
  type CycleData,
  type Period,
} from "./cycle";

const period = (id: string, start: string, end: string | null): Period => ({ id, start, end });
const data = (...periods: Period[]): CycleData => ({ v: 1, periods });

describe("calendar days", () => {
  it("counts days between dates, across month and year ends", () => {
    expect(daysBetween("2026-11-02", "2026-11-02")).toBe(0);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-11-02", "2026-10-31")).toBe(-2);
  });

  it("adds days the same way", () => {
    expect(addDays("2026-10-30", 5)).toBe("2026-11-04");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("is not moved by a daylight-saving change", () => {
    // Iran (and many zones) shift clocks around late March / September; the count of calendar days must not.
    expect(daysBetween("2026-03-20", "2026-03-24")).toBe(4);
    expect(daysBetween("2026-09-20", "2026-09-24")).toBe(4);
  });
});

describe("lengths", () => {
  const periods = [period("a", "2026-06-01", "2026-06-05"), period("b", "2026-06-29", "2026-07-03"), period("c", "2026-07-28", "2026-08-01"), period("d", "2026-08-27", null)];

  it("takes the days between starts, and leaves out what a cycle cannot be", () => {
    expect(cycleLengths(periods)).toEqual([28, 29, 30]);
    expect(cycleLengths([period("a", "2026-06-01", null), period("b", "2026-06-05", null)])).toEqual([]);
    expect(cycleLengths([period("a", "2026-01-01", null), period("b", "2026-06-05", null)])).toEqual([]);
  });

  it("averages the latest cycles, or assumes the default until there is one", () => {
    expect(averageCycleLength(periods)).toEqual({ days: 29, learned: true });
    expect(averageCycleLength([])).toEqual({ days: DEFAULT_CYCLE_LENGTH, learned: false });
    expect(averageCycleLength([period("a", "2026-06-01", null)])).toEqual({ days: DEFAULT_CYCLE_LENGTH, learned: false });
  });

  it("averages how long a period lasts from the closed ones only", () => {
    expect(averagePeriodLength(periods)).toEqual({ days: 5, learned: true });
    expect(averagePeriodLength([period("a", "2026-06-01", null)])).toEqual({ days: DEFAULT_PERIOD_LENGTH, learned: false });
    expect(averagePeriodLength([period("a", "2026-06-01", "2026-06-04"), period("b", "2026-06-29", "2026-07-05")]).days).toBe(6);
  });

  it("looks only at the last six cycles", () => {
    const starts = ["2026-01-01", "2026-02-10", "2026-03-12", "2026-04-11", "2026-05-11", "2026-06-10", "2026-07-10", "2026-08-09"];
    const many = starts.map((start, i) => period(String(i), start, null));
    // 40 then six of 30: the 40 has aged out.
    expect(cycleLengths(many)).toEqual([40, 30, 30, 30, 30, 30, 30]);
    expect(averageCycleLength(many).days).toBe(30);
  });
});

describe("status", () => {
  it("knows nothing before the first period is written", () => {
    expect(cycleStatus(EMPTY_CYCLE, "2026-11-02")).toMatchObject({ lastStart: null, cycleDay: null, phase: null, nextStart: null });
  });

  it("with one period, expects the next after the assumed length", () => {
    const status = cycleStatus(data(period("a", "2026-10-20", "2026-10-24")), "2026-11-02");
    expect(status).toMatchObject({ lastStart: "2026-10-20", cycleDay: 14, inPeriod: false, nextStart: "2026-11-17", daysToNext: 15, phase: "BETWEEN", spread: 3 });
    expect(status.averageCycle.learned).toBe(false);
  });

  it("is in a period while one is open, with the day of it", () => {
    const status = cycleStatus(data(period("a", "2026-10-31", null)), "2026-11-02");
    expect(status).toMatchObject({ inPeriod: true, periodDay: 3, phase: "PERIOD", cycleDay: 3 });
    expect(status.openPeriod?.id).toBe("a");
  });

  it("is in a period on the days a closed one covers", () => {
    const status = cycleStatus(data(period("a", "2026-10-30", "2026-11-03")), "2026-11-02");
    expect(status).toMatchObject({ inPeriod: true, periodDay: 4, phase: "PERIOD", openPeriod: null });
  });

  it("says when the next is near, and when it is later than expected — plainly", () => {
    const soon = cycleStatus(data(period("a", "2026-10-06", "2026-10-10")), "2026-11-01");
    expect(soon).toMatchObject({ nextStart: "2026-11-03", daysToNext: 2, phase: "SOON" });
    const late = cycleStatus(data(period("a", "2026-10-01", "2026-10-05")), "2026-11-10");
    expect(late).toMatchObject({ nextStart: "2026-10-29", daysToNext: -12, phase: "LATE" });
  });

  it("widens the window for a person whose cycles vary, within bounds", () => {
    const irregular = data(period("a", "2026-01-01", null), period("b", "2026-01-26", null), period("c", "2026-02-28", null), period("d", "2026-03-24", null));
    // 25, 33, 24 → spread of 9 → half 5 (the cap)
    expect(cycleStatus(irregular, "2026-04-01").spread).toBe(5);
    const steady = data(period("a", "2026-01-01", null), period("b", "2026-01-29", null), period("c", "2026-02-26", null), period("d", "2026-03-26", null));
    expect(cycleStatus(steady, "2026-04-01").spread).toBe(1);
  });
});

describe("validatePeriod", () => {
  const today = "2026-11-02";
  const base = data(period("a", "2026-10-01", "2026-10-05"));

  it("accepts a period in the past, open or closed", () => {
    expect(validatePeriod(base, { start: "2026-10-29", end: "2026-11-02" }, today)).toBeNull();
    expect(validatePeriod(base, { start: "2026-10-30", end: null }, today)).toBeNull();
  });

  it("refuses what cannot be: a future day, an end before the start, a mistake in length", () => {
    expect(validatePeriod(base, { start: "2026-11-03", end: null }, today)).toMatch(/آینده/);
    expect(validatePeriod(base, { start: "2026-10-20", end: "2026-10-19" }, today)).toMatch(/قبل از شروع/);
    expect(validatePeriod(base, { start: "2026-10-20", end: "2026-11-05" }, today)).toMatch(/آینده/);
    expect(validatePeriod(base, { start: "2026-10-10", end: "2026-10-30" }, today)).toMatch(/بیشتر از ۱۴|بیشتر از 14/);
    expect(validatePeriod(base, { start: "nope", end: null }, today)).toMatch(/شروع/);
  });

  it("refuses an overlap with another period, but not with itself when it is being changed", () => {
    expect(validatePeriod(base, { start: "2026-10-04", end: "2026-10-08" }, today)).toMatch(/هم‌پوشانی/);
    expect(validatePeriod(base, { id: "a", start: "2026-10-02", end: "2026-10-06" }, today)).toBeNull();
  });

  it("allows only one that is still going on, and it must be the latest", () => {
    const open = data(period("a", "2026-10-01", "2026-10-05"), period("b", "2026-10-29", null));
    expect(validatePeriod(open, { start: "2026-10-20", end: null }, today)).toMatch(/هنوز تمام نشده/);
    expect(validatePeriod(base, { start: "2026-09-10", end: null }, today)).toMatch(/آخرین/);
  });
});

describe("editing", () => {
  it("keeps the periods in order of their start", () => {
    let d = addPeriod(EMPTY_CYCLE, period("b", "2026-10-01", null));
    d = addPeriod(d, period("a", "2026-09-01", "2026-09-05"));
    expect(d.periods.map((p) => p.id)).toEqual(["a", "b"]);
    expect(updatePeriod(d, "b", { end: "2026-10-04" }).periods[1].end).toBe("2026-10-04");
    expect(removePeriod(d, "a").periods.map((p) => p.id)).toEqual(["b"]);
  });
});

describe("what storage gives back", () => {
  it("keeps well-formed periods and drops the rest", () => {
    const clean = sanitizeCycle({
      v: 1,
      periods: [period("a", "2026-10-01", "2026-10-05"), { id: "b", start: "garbage", end: null }, { id: "c", start: "2026-10-10", end: "2026-10-01" }, null, 3, period("d", "2026-09-01", null)],
    });
    expect(clean.periods.map((p) => p.id)).toEqual(["d", "a"]);
  });

  it("falls back to empty", () => {
    expect(sanitizeCycle(undefined)).toEqual(EMPTY_CYCLE);
    expect(sanitizeCycle({ periods: "x" })).toEqual(EMPTY_CYCLE);
  });
});

describe("monthMarks", () => {
  const today = "2026-11-02";
  const d = data(period("a", "2026-10-06", "2026-10-10"), period("b", "2026-11-01", null));
  const status = cycleStatus(d, today);

  it("marks the days of the periods written down, an open one up to today", () => {
    const days = ["2026-10-05", "2026-10-06", "2026-10-10", "2026-10-11", "2026-11-01", "2026-11-02", "2026-11-03"];
    const marks = monthMarks(d, status, days, today);
    expect(marks["2026-10-05"]).toBeUndefined();
    expect(marks["2026-10-06"]).toBe("PERIOD");
    expect(marks["2026-10-10"]).toBe("PERIOD");
    expect(marks["2026-10-11"]).toBeUndefined();
    expect(marks["2026-11-01"]).toBe("PERIOD");
    expect(marks["2026-11-02"]).toBe("PERIOD");
    // Tomorrow is not a day of a period that has not ended — nothing says it will continue.
    expect(marks["2026-11-03"]).toBeUndefined();
  });

  it("marks the days the next period is expected between, only from today on", () => {
    const quiet = data(period("a", "2026-10-06", "2026-10-10"));
    const s = cycleStatus(quiet, today);
    // expected 2026-11-03 ± 3
    const marks = monthMarks(quiet, s, ["2026-10-30", "2026-11-02", "2026-11-03", "2026-11-06", "2026-11-07"], today);
    expect(marks["2026-10-30"]).toBeUndefined();
    expect(marks["2026-11-02"]).toBe("EXPECTED");
    expect(marks["2026-11-03"]).toBe("EXPECTED");
    expect(marks["2026-11-06"]).toBe("EXPECTED");
    expect(marks["2026-11-07"]).toBeUndefined();
  });
});

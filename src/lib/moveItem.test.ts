import { describe, expect, it } from "vitest";
import { canMove, cannotMoveReason, hasClockTime, movableFromEvent, movableFromTask, planEventMove, planMove, planTaskMove, tomorrowOf, type Movable } from "./moveItem";

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);
const iso = (d: Date) => d.toISOString();

const task = (over: Partial<Extract<Movable, { kind: "TASK" }>> = {}): Extract<Movable, { kind: "TASK" }> => ({
  kind: "TASK",
  id: "t1",
  title: "گزارش",
  dueDate: iso(at(2026, 11, 2)),
  startAt: null,
  endAt: null,
  ...over,
});
const event = (over: Partial<Extract<Movable, { kind: "EVENT" }>> = {}): Extract<Movable, { kind: "EVENT" }> => ({
  kind: "EVENT",
  id: "e1",
  title: "جلسه",
  startAt: iso(at(2026, 11, 2, 14, 30)),
  endAt: iso(at(2026, 11, 2, 15, 45)),
  allDay: false,
  recurring: false,
  ...over,
});

describe("a task", () => {
  it("with only a due day moves to the target day and stays without a time", () => {
    expect(planTaskMove(task(), { day: at(2026, 11, 3) })).toEqual({ dueDate: iso(at(2026, 11, 3)), startAt: null, endAt: null });
  });

  it("with a time keeps its time of day and its length when it goes to another day", () => {
    const planned = task({ startAt: iso(at(2026, 11, 2, 9, 15)), endAt: iso(at(2026, 11, 2, 10, 45)) });
    expect(planTaskMove(planned, { day: at(2026, 11, 3) })).toEqual({
      dueDate: iso(at(2026, 11, 3)),
      startAt: iso(at(2026, 11, 3, 9, 15)),
      endAt: iso(at(2026, 11, 3, 10, 45)),
    });
  });

  it("takes a new time when one is picked, and keeps the length", () => {
    const planned = task({ startAt: iso(at(2026, 11, 2, 9, 0)), endAt: iso(at(2026, 11, 2, 10, 30)) });
    expect(planTaskMove(planned, { day: at(2026, 11, 5), time: "16:20" })).toEqual({
      dueDate: iso(at(2026, 11, 5)),
      startAt: iso(at(2026, 11, 5, 16, 20)),
      endAt: iso(at(2026, 11, 5, 17, 50)),
    });
  });

  it("with a start but no end moves the start and leaves the end empty", () => {
    const planned = task({ startAt: iso(at(2026, 11, 2, 9, 0)), endAt: null });
    expect(planTaskMove(planned, { day: at(2026, 11, 3) })).toMatchObject({ startAt: iso(at(2026, 11, 3, 9, 0)), endAt: null });
  });

  it("ignores a picked time when the task has no time to change", () => {
    expect(planTaskMove(task(), { day: at(2026, 11, 3), time: "16:20" })).toEqual({ dueDate: iso(at(2026, 11, 3)), startAt: null, endAt: null });
  });
});

describe("an event", () => {
  it("keeps its time and length on another day", () => {
    expect(planEventMove(event(), { day: at(2026, 11, 3) })).toEqual({ startAt: iso(at(2026, 11, 3, 14, 30)), endAt: iso(at(2026, 11, 3, 15, 45)) });
  });

  it("takes a picked time and keeps its length", () => {
    expect(planEventMove(event(), { day: at(2026, 11, 7), time: "08:00" })).toEqual({ startAt: iso(at(2026, 11, 7, 8, 0)), endAt: iso(at(2026, 11, 7, 9, 15)) });
  });

  it("moves an all-day event by whole days, start and end together", () => {
    const allDay = event({ allDay: true, startAt: iso(at(2026, 11, 2, 0, 0)), endAt: iso(at(2026, 11, 2, 23, 59)) });
    expect(planEventMove(allDay, { day: at(2026, 11, 4, 18, 0) })).toEqual({ startAt: iso(at(2026, 11, 4, 0, 0)), endAt: iso(at(2026, 11, 4, 23, 59)) });
  });

  it("keeps its time of day across a daylight-saving change (a 23-hour day) — fields, not 24-hour sums", () => {
    // The check is on the clock time read back in local time, whatever zone the tests run in.
    const planned = event({ startAt: iso(at(2026, 3, 28, 14, 30)), endAt: iso(at(2026, 3, 28, 15, 30)) });
    const moved = planEventMove(planned, { day: at(2026, 3, 29) });
    expect(new Date(moved.startAt).getHours()).toBe(14);
    expect(new Date(moved.startAt).getMinutes()).toBe(30);
    expect(new Date(moved.startAt).getDate()).toBe(29);
  });
});

describe("planMove", () => {
  it("picks the right planner for the kind", () => {
    expect(planMove(task(), { day: at(2026, 11, 3) })).toHaveProperty("dueDate");
    expect(planMove(event(), { day: at(2026, 11, 3) })).toHaveProperty("endAt");
  });

  it("refuses a repeating event: one occurrence has no row to move", () => {
    const repeating = event({ recurring: true });
    expect(canMove(repeating)).toBe(false);
    expect(cannotMoveReason(repeating)).toMatch(/تکرارشونده/);
    expect(() => planMove(repeating, { day: at(2026, 11, 3) })).toThrow();
    expect(canMove(event())).toBe(true);
    expect(canMove(task())).toBe(true);
    expect(cannotMoveReason(task())).toBeNull();
  });

  it("knows which items have a time of day to change", () => {
    expect(hasClockTime(task())).toBe(false);
    expect(hasClockTime(task({ startAt: iso(at(2026, 11, 2, 9)) }))).toBe(true);
    expect(hasClockTime(event())).toBe(true);
    expect(hasClockTime(event({ allDay: true }))).toBe(false);
  });
});

describe("tomorrowOf", () => {
  it("is the next calendar day, also across a month and a year end", () => {
    expect(tomorrowOf(at(2026, 11, 2, 21, 0)).getDate()).toBe(3);
    const nye = tomorrowOf(at(2026, 12, 31, 22, 0));
    expect([nye.getFullYear(), nye.getMonth() + 1, nye.getDate()]).toEqual([2027, 1, 1]);
    expect(tomorrowOf(at(2026, 2, 28, 12, 0)).getMonth() + 1).toBe(3);
  });
});

describe("building a Movable from what the API returns", () => {
  it("reads a task, leaving out what it does not have", () => {
    expect(movableFromTask({ id: "t", title: "گزارش" })).toEqual({ kind: "TASK", id: "t", title: "گزارش", dueDate: null, startAt: null, endAt: null });
    expect(movableFromTask({ id: "t", title: "x", dueDate: "2026-11-02T00:00:00.000Z", startAt: "2026-11-02T08:00:00.000Z", endAt: null })).toMatchObject({ dueDate: "2026-11-02T00:00:00.000Z", startAt: "2026-11-02T08:00:00.000Z", endAt: null });
  });

  it("reads an event, and knows a series from a single one", () => {
    const base = { id: "e", title: "جلسه", startAt: "2026-11-02T08:00:00.000Z", endAt: "2026-11-02T09:00:00.000Z" };
    expect(movableFromEvent({ ...base, allDay: false, recurrenceFreq: "NONE" })).toMatchObject({ kind: "EVENT", allDay: false, recurring: false });
    expect(movableFromEvent({ ...base, recurrenceFreq: "WEEKLY" })).toMatchObject({ recurring: true });
    expect(movableFromEvent({ ...base, allDay: true, recurrenceFreq: null })).toMatchObject({ allDay: true, recurring: false });
    expect(canMove(movableFromEvent({ ...base, recurrenceFreq: "DAILY" }))).toBe(false);
  });
});

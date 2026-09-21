import { describe, expect, it } from "vitest";
import { eventEntries, findOverlaps, occupiedRange, overlapError, overlapMessage, type TimedEntry } from "./timeOverlap";

const at = (h: number, m = 0) => new Date(2026, 8, 21, h, m);
const entry = (id: string, from: Date, to: Date, kind: TimedEntry["kind"] = "TASK", title = `کار ${id}`): TimedEntry => ({ kind, id, title, start: from, end: to });

describe("findOverlaps", () => {
  const entries = [entry("a", at(9), at(10)), entry("b", at(10), at(11)), entry("c", at(13), at(14))];

  it("finds what overlaps at either end or inside", () => {
    expect(findOverlaps({ start: at(9, 30), end: at(10, 30) }, entries).map((e) => e.id)).toEqual(["a", "b"]);
    expect(findOverlaps({ start: at(9, 15), end: at(9, 45) }, entries).map((e) => e.id)).toEqual(["a"]);
    expect(findOverlaps({ start: at(8), end: at(15) }, entries).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("does not count touching edges", () => {
    expect(findOverlaps({ start: at(11), end: at(12) }, entries)).toEqual([]);
    expect(findOverlaps({ start: at(8), end: at(9) }, entries)).toEqual([]);
  });

  it("never collides an entry with itself", () => {
    expect(findOverlaps({ start: at(9), end: at(10) }, entries, { kind: "TASK", id: "a" })).toEqual([]);
    // the same id under another kind is a different entry
    expect(findOverlaps({ start: at(9), end: at(10) }, entries, { kind: "EVENT", id: "a" }).map((e) => e.id)).toEqual(["a"]);
  });

  it("has nothing to say about an empty or reversed range", () => {
    expect(findOverlaps({ start: at(9), end: at(9) }, entries)).toEqual([]);
    expect(findOverlaps({ start: at(10), end: at(9) }, entries)).toEqual([]);
  });

  it("lists conflicts in the order they happen", () => {
    const shuffled = [entries[2], entries[0], entries[1]];
    expect(findOverlaps({ start: at(8), end: at(15) }, shuffled).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});

describe("occupiedRange", () => {
  it("needs both ends in order", () => {
    expect(occupiedRange(at(9), at(10))).toEqual({ start: at(9), end: at(10) });
    expect(occupiedRange(at(9).toISOString(), at(10).toISOString())).toEqual({ start: at(9), end: at(10) });
    expect(occupiedRange(at(9), null)).toBeNull();
    expect(occupiedRange(undefined, at(10))).toBeNull();
    expect(occupiedRange(at(10), at(9))).toBeNull();
    expect(occupiedRange("not a date", at(9))).toBeNull();
  });
});

describe("eventEntries", () => {
  const base = { title: "ورزش", allDay: false, recurrenceInterval: 1, recurrenceUntil: null, recurrenceCount: null };

  it("expands a recurring event into the occurrences inside the range and skips all-day events", () => {
    const events = [
      { ...base, id: "gym", startAt: at(6), endAt: at(7), recurrenceFreq: "DAILY" },
      { ...base, id: "holiday", title: "تعطیل", startAt: at(0), endAt: at(23, 59), allDay: true, recurrenceFreq: "NONE" },
    ];
    const tomorrow = new Date(2026, 8, 22, 6, 30);
    const found = eventEntries(events, { start: tomorrow, end: new Date(2026, 8, 22, 6, 45) });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "EVENT", id: "gym", title: "ورزش" });
    expect(found[0].start.getDate()).toBe(22);
  });
});

describe("overlapMessage / overlapError", () => {
  it("names the first collision and counts the rest", () => {
    const list = [entry("a", at(10, 30), at(12), "TASK", "جلسه"), entry("b", at(11), at(11, 30), "EVENT", "تماس")];
    const message = overlapMessage(list);
    expect(message).toContain("«جلسه»");
    expect(message).toContain("(کار)");
    expect(message).toContain("۱ مورد دیگر");
    // no clock times: the server may not share the person's time zone
    expect(message).not.toMatch(/[0-9۰-۹]{1,2}:[0-9۰-۹]{2}/);
    expect(message).toContain("هم‌پوشانی");
  });

  it("is a 409 with the stable TASK-002 code and the collisions as details", () => {
    const error = overlapError([entry("a", at(10), at(11))]);
    expect(error.status).toBe(409);
    expect(error.code).toBe("TASK-002");
    expect(error.details).toEqual({ conflicts: [{ kind: "TASK", id: "a", title: "کار a", start: at(10).toISOString(), end: at(11).toISOString() }] });
  });
});

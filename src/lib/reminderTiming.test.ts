import { describe, it, expect } from "vitest";
import { installmentNotifyAt, pastDueOffsets } from "./reminderTiming";

// Built with the local-time constructor on purpose: the rules below are about the phone's own clock.
const at = (h: number, m = 0, day = 15) => new Date(2026, 8, day, h, m, 0, 0);

describe("pastDueOffsets", () => {
  it("flags the pre-ticked 30 minutes when the event starts in less than that", () => {
    const now = at(9, 50);
    expect(pastDueOffsets(at(10, 0), [30], now)).toEqual([30]);
  });

  it("keeps the lead times that are still ahead", () => {
    const now = at(9, 50);
    expect(pastDueOffsets(at(10, 0), [0, 5, 10, 30], now)).toEqual([10, 30]);
  });

  it("counts a reminder due exactly now as past — it can no longer be scheduled", () => {
    const now = at(9, 30);
    expect(pastDueOffsets(at(10, 0), [30], now)).toEqual([30]);
  });

  it("flags nothing for an event that is far enough away", () => {
    expect(pastDueOffsets(at(18, 0), [5, 30, 60], at(9, 0))).toEqual([]);
  });

  it("says nothing for a start time that could not be read", () => {
    expect(pastDueOffsets(new Date("nope"), [30], at(9, 0))).toEqual([]);
  });
});

describe("installmentNotifyAt", () => {
  it("moves a midnight reminder (a whole number of days before a due date) to 09:00 of that day", () => {
    expect(installmentNotifyAt(at(0, 0, 14)).getTime()).toBe(at(9, 0, 14).getTime());
  });

  it("moves any moment before 09:00 to 09:00", () => {
    expect(installmentNotifyAt(at(3, 30)).getTime()).toBe(at(9, 0).getTime());
    expect(installmentNotifyAt(at(8, 59)).getTime()).toBe(at(9, 0).getTime());
  });

  it("keeps a moment at or after 09:00 exactly as chosen (an hours/minutes lead time)", () => {
    expect(installmentNotifyAt(at(9, 0)).getTime()).toBe(at(9, 0).getTime());
    expect(installmentNotifyAt(at(23, 55, 14)).getTime()).toBe(at(23, 55, 14).getTime());
  });

  it("never returns an earlier moment than it was given", () => {
    for (const [h, m] of [[0, 0], [5, 15], [9, 0], [12, 30], [23, 59]]) {
      expect(installmentNotifyAt(at(h, m)).getTime()).toBeGreaterThanOrEqual(at(h, m).getTime());
    }
  });
});

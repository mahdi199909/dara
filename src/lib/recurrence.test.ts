import { describe, it, expect } from "vitest";
import { expandOccurrences } from "./recurrence";

const baseEvent = {
  id: "evt1",
  startAt: new Date(2026, 0, 5, 10, 0), // Monday
  endAt: new Date(2026, 0, 5, 11, 0),
  recurrenceFreq: "WEEKLY",
  recurrenceInterval: 1,
  recurrenceUntil: null as Date | null,
  recurrenceCount: null as number | null,
};

describe("expandOccurrences", () => {
  it("returns the single occurrence for a non-recurring event within range", () => {
    const occ = expandOccurrences({ ...baseEvent, recurrenceFreq: "NONE" }, new Date(2026, 0, 1), new Date(2026, 0, 31));
    expect(occ).toHaveLength(1);
    expect(occ[0].occurrenceId).toBe("evt1");
  });

  it("stops after recurrenceCount occurrences even if the range is wider", () => {
    const occ = expandOccurrences({ ...baseEvent, recurrenceCount: 3 }, new Date(2026, 0, 1), new Date(2026, 5, 1));
    expect(occ).toHaveLength(3);
    expect(occ.map((o) => o.startAt.getDate())).toEqual([5, 12, 19]);
  });

  it("stops at recurrenceUntil", () => {
    const occ = expandOccurrences(
      { ...baseEvent, recurrenceUntil: new Date(2026, 0, 20) },
      new Date(2026, 0, 1),
      new Date(2026, 5, 1)
    );
    expect(occ.map((o) => o.startAt.getDate())).toEqual([5, 12, 19]);
  });

  it("keeps occurrence ids stable regardless of which range slice is queried", () => {
    const fullRange = expandOccurrences({ ...baseEvent, recurrenceCount: 5 }, new Date(2026, 0, 1), new Date(2026, 5, 1));
    const laterSlice = expandOccurrences(
      { ...baseEvent, recurrenceCount: 5 },
      new Date(2026, 0, 15),
      new Date(2026, 5, 1)
    );
    const thirdOccurrence = fullRange.find((o) => o.startAt.getDate() === 19);
    const sameOccurrenceInSlice = laterSlice.find((o) => o.startAt.getDate() === 19);
    expect(thirdOccurrence?.occurrenceId).toBe(sameOccurrenceInSlice?.occurrenceId);
  });
});

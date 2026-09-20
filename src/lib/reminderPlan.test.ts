import { describe, expect, it } from "vitest";
import { customOffsetToMinutes, planReminderChanges, reminderOffsetLabel } from "./reminderPlan";

describe("planReminderChanges", () => {
  it("does nothing when the ticked offsets already match the event's reminders", () => {
    const plan = planReminderChanges(
      [
        { id: "a", offsetMinutes: 10 },
        { id: "b", offsetMinutes: 60 },
      ],
      [60, 10]
    );
    expect(plan).toEqual({ remove: [], add: [] });
  });

  it("deletes the reminder that was unticked and creates the one that was newly ticked", () => {
    const plan = planReminderChanges(
      [
        { id: "a", offsetMinutes: 10 },
        { id: "b", offsetMinutes: 60 },
      ],
      [10, 1440]
    );
    expect(plan).toEqual({ remove: ["b"], add: [1440] });
  });

  it("clears every reminder when nothing is ticked", () => {
    expect(planReminderChanges([{ id: "a", offsetMinutes: 5 }], [])).toEqual({ remove: ["a"], add: [] });
  });

  it("creates reminders for an event that had none", () => {
    expect(planReminderChanges([], [60, 5])).toEqual({ remove: [], add: [5, 60] });
  });

  it("removes a surplus duplicate of an offset that is still wanted, keeping the first row", () => {
    const plan = planReminderChanges(
      [
        { id: "a", offsetMinutes: 30 },
        { id: "dup", offsetMinutes: 30 },
      ],
      [30]
    );
    expect(plan).toEqual({ remove: ["dup"], add: [] });
  });

  it("ignores repeated wanted offsets", () => {
    expect(planReminderChanges([], [15, 15, 15])).toEqual({ remove: [], add: [15] });
  });
});

describe("reminderOffsetLabel", () => {
  it("reads minutes, hours and days naturally", () => {
    expect(reminderOffsetLabel(5)).toBe("5 دقیقه قبل");
    expect(reminderOffsetLabel(60)).toBe("1 ساعت قبل");
    expect(reminderOffsetLabel(90)).toBe("1 ساعت و 30 دقیقه قبل");
    expect(reminderOffsetLabel(1440)).toBe("1 روز قبل");
    expect(reminderOffsetLabel(60 * 24 * 3)).toBe("3 روز قبل");
    expect(reminderOffsetLabel(60 * 36)).toBe("1 روز و 12 ساعت قبل");
  });

  it("says «0 دقیقه» for a reminder at the start time itself", () => {
    expect(reminderOffsetLabel(0)).toBe("0 دقیقه قبل");
  });
});

describe("customOffsetToMinutes", () => {
  it("converts an amount and a unit to minutes", () => {
    expect(customOffsetToMinutes(45, "MINUTE")).toBe(45);
    expect(customOffsetToMinutes(2, "HOUR")).toBe(120);
    expect(customOffsetToMinutes(2, "DAY")).toBe(2880);
  });

  it("refuses zero, negatives, fractions of a minute and absurdly long lead times", () => {
    expect(customOffsetToMinutes(0, "MINUTE")).toBeNull();
    expect(customOffsetToMinutes(-5, "HOUR")).toBeNull();
    expect(customOffsetToMinutes(0.5, "MINUTE")).toBeNull();
    expect(customOffsetToMinutes(400, "DAY")).toBeNull();
    expect(customOffsetToMinutes(Number.NaN, "DAY")).toBeNull();
  });

  it("accepts a fraction that still lands on a whole number of minutes", () => {
    expect(customOffsetToMinutes(1.5, "HOUR")).toBe(90);
  });
});

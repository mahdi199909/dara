import { describe, it, expect } from "vitest";
import { formatReminderOffset } from "./reminderText";

describe("formatReminderOffset", () => {
  it("keeps sub-hour offsets in minutes", () => {
    expect(formatReminderOffset(5)).toBe("5 دقیقه");
    expect(formatReminderOffset(30)).toBe("30 دقیقه");
  });

  it("switches to hours at exactly 60 minutes", () => {
    expect(formatReminderOffset(60)).toBe("1 ساعت");
  });

  it("rounds a non-whole number of hours", () => {
    expect(formatReminderOffset(1440)).toBe("24 ساعت"); // 1 day
    expect(formatReminderOffset(100)).toBe("2 ساعت"); // 100/60 = 1.67 -> rounds to 2
  });
});

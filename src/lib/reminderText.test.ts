import { describe, it, expect } from "vitest";
import { eventReminderBody, formatReminderOffset } from "./reminderText";

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

describe("eventReminderBody", () => {
  it("says how long is left before the event", () => {
    expect(eventReminderBody("جلسه", 30)).toBe("جلسه - 30 دقیقه دیگر");
    expect(eventReminderBody("جلسه", 120)).toBe("جلسه - 2 ساعت دیگر");
  });

  it("says «now» for a reminder that rings at the start, not «0 دقیقه دیگر»", () => {
    expect(eventReminderBody("جلسه", 0)).toBe("جلسه - همین الان");
  });
});

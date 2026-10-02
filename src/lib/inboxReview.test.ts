import { describe, expect, it } from "vitest";
import { describeReview, lastReviewTime, nextReviewTimes, type InboxReviewSettings } from "./inboxReview";

// Thursday 1 October 2026, 21:30 local time
const NOW = new Date(2026, 9, 1, 21, 30);
const weekly: InboxReviewSettings = { enabled: true, frequency: "WEEKLY", weekday: 5, time: "20:00" };
const daily: InboxReviewSettings = { enabled: true, frequency: "DAILY", weekday: 5, time: "21:00" };

describe("inbox review times", () => {
  it("weekly: the next Fridays at the chosen time", () => {
    const times = nextReviewTimes(weekly, NOW, 3);
    expect(times.map((t) => [t.getDay(), t.getHours(), t.getMinutes()])).toEqual([
      [5, 20, 0],
      [5, 20, 0],
      [5, 20, 0],
    ]);
    expect(times[0].getTime()).toBeGreaterThan(NOW.getTime());
    expect(times[1].getTime() - times[0].getTime()).toBe(7 * 24 * 3_600_000);
  });

  it("daily: today's time has passed, so it starts tomorrow", () => {
    const [first, second] = nextReviewTimes(daily, NOW, 2);
    expect(first).toEqual(new Date(2026, 9, 2, 21, 0));
    expect(second).toEqual(new Date(2026, 9, 3, 21, 0));
    expect(nextReviewTimes(daily, new Date(2026, 9, 1, 20, 0), 1)[0]).toEqual(new Date(2026, 9, 1, 21, 0));
  });

  it("the last moment that already passed", () => {
    expect(lastReviewTime(daily, NOW)).toEqual(new Date(2026, 9, 1, 21, 0));
    const lastFriday = lastReviewTime(weekly, NOW)!;
    expect(lastFriday.getDay()).toBe(5);
    expect(lastFriday.getTime()).toBeLessThan(NOW.getTime());
    expect(NOW.getTime() - lastFriday.getTime()).toBeLessThan(7 * 24 * 3_600_000);
  });

  it("nothing while switched off", () => {
    const off = { ...weekly, enabled: false };
    expect(nextReviewTimes(off, NOW, 3)).toEqual([]);
    expect(lastReviewTime(off, NOW)).toBeNull();
    expect(describeReview(off)).toBe("خاموش");
  });

  it("says when, in Persian", () => {
    expect(describeReview(weekly)).toBe("هر جمعه ساعت ۲۰:۰۰");
    expect(describeReview(daily)).toBe("هر روز ساعت ۲۱:۰۰");
  });
});

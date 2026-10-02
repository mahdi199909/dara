import { describe, expect, it } from "vitest";
import { summarizeTimerSessions } from "./timerStats";

const NOW = new Date(2026, 9, 2, 18, 0);
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();

describe("timer history", () => {
  it("adds up today, the last seven days and lists the latest sessions", () => {
    const stats = summarizeTimerSessions(
      [
        { id: "a", title: "کد", startAt: at(2, 9), endAt: at(2, 9, 25), category: { name: "کار", icon: "💼" } },
        { id: "b", title: "کد", startAt: at(2, 10), endAt: at(2, 10, 50) },
        { id: "d", title: "قدیمی", startAt: new Date(2026, 8, 20, 9).toISOString(), endAt: new Date(2026, 8, 20, 10).toISOString() },
        { id: "e", title: "دیروز", startAt: at(1, 20), endAt: at(1, 20, 15) },
        { id: "f", title: "بدون زمان", startAt: null, endAt: null },
      ],
      NOW
    );
    expect(stats.todayMin).toBe(75);
    expect(stats.todaySessions).toBe(2);
    expect(stats.weekMin).toBe(90);
    expect(stats.days).toHaveLength(7);
    expect(stats.days[6]).toMatchObject({ day: "2026-10-02", minutes: 75, isToday: true });
    expect(stats.days[5]).toMatchObject({ day: "2026-10-01", minutes: 15 });
    expect(stats.recent.map((r) => r.id)).toEqual(["b", "a", "e", "d"]);
    expect(stats.recent[1].category).toBe("💼 کار");
  });

  it("is all zeros with nothing timed", () => {
    const stats = summarizeTimerSessions([], NOW);
    expect(stats.weekMin).toBe(0);
    expect(stats.recent).toEqual([]);
  });
});

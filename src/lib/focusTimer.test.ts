import { describe, expect, it } from "vitest";
import { advanceTimer, elapsedMs, finishTimer, formatClock, isLongBreak, pauseTimer, phaseEndsAt, remainingMs, resumeTimer, skipBreak, startTimer } from "./focusTimer";

const T0 = Date.UTC(2026, 9, 2, 6, 0, 0);
const min = (n: number) => n * 60_000;

describe("focus timer", () => {
  it("a stopwatch counts up, pauses and saves only the time that actually ran", () => {
    let s = startTimer({ mode: "STOPWATCH", title: " نوشتن ", categoryId: "c1" }, T0);
    expect(s.title).toBe("نوشتن");
    s = pauseTimer(s, T0 + min(10));
    expect(elapsedMs(s, T0 + min(30))).toBe(min(10));
    s = resumeTimer(s, T0 + min(30));
    const done = finishTimer(s, T0 + min(35));
    expect(done).toEqual({ title: "نوشتن", categoryId: "c1", startAt: new Date(T0 + min(20)).toISOString(), endAt: new Date(T0 + min(35)).toISOString(), durationMs: min(15) });
    expect(remainingMs(s, T0)).toBeNull();
    expect(phaseEndsAt(s)).toBeNull();
  });

  it("drops a stretch shorter than a minute", () => {
    const s = startTimer({ mode: "STOPWATCH", title: "x", categoryId: null }, T0);
    expect(finishTimer(s, T0 + 30_000)).toBeNull();
  });

  it("a countdown ends at its own moment, even when the app was closed long after", () => {
    const s = startTimer({ mode: "COUNTDOWN", title: "مطالعه", categoryId: null, countdownMin: 15 }, T0);
    expect(remainingMs(s, T0 + min(5))).toBe(min(10));
    expect(advanceTimer(s, T0 + min(14)).events).toEqual([]);
    const { state, events } = advanceTimer(s, T0 + min(90));
    expect(state).toBeNull();
    expect(events[0]).toEqual({ kind: "WORK_DONE", session: { title: "مطالعه", categoryId: null, startAt: new Date(T0).toISOString(), endAt: new Date(T0 + min(15)).toISOString(), durationMs: min(15) } });
    expect(events[1]).toEqual({ kind: "COUNTDOWN_DONE" });
  });

  it("a paused countdown does not run out", () => {
    const s = pauseTimer(startTimer({ mode: "COUNTDOWN", title: "", categoryId: null, countdownMin: 5 }, T0), T0 + min(1));
    expect(advanceTimer(s, T0 + min(60)).events).toEqual([]);
    expect(phaseEndsAt(resumeTimer(s, T0 + min(60)))).toBe(T0 + min(64));
  });

  it("a pomodoro saves the block, starts the break where the block ended, then waits for the next block", () => {
    const s = startTimer({ mode: "POMODORO", title: "کد", categoryId: null, pomodoro: { workMin: 25, breakMin: 5, longBreakMin: 15 } }, T0);
    const afterBlock = advanceTimer(s, T0 + min(27));
    expect(afterBlock.events.map((e) => e.kind)).toEqual(["WORK_DONE"]);
    expect(afterBlock.state).toMatchObject({ phase: "BREAK", running: true, blocksDone: 1, targetMs: min(5) });
    expect(remainingMs(afterBlock.state!, T0 + min(27))).toBe(min(3));

    // closed through the block and the break
    const later = advanceTimer(s, T0 + min(45));
    expect(later.events.map((e) => e.kind)).toEqual(["WORK_DONE", "BREAK_DONE"]);
    expect(later.state).toMatchObject({ phase: "WORK", running: false, blocksDone: 1, targetMs: min(25) });
    expect(advanceTimer(later.state, T0 + min(500)).events).toEqual([]);
  });

  it("every fourth break is the long one", () => {
    let s = startTimer({ mode: "POMODORO", title: "", categoryId: null, pomodoro: { workMin: 25, breakMin: 5, longBreakMin: 15 } }, T0);
    let now = T0;
    for (let block = 1; block <= 4; block++) {
      expect(isLongBreak(s)).toBe(block === 4);
      now += min(25);
      s = advanceTimer(s, now).state!;
      expect(s.targetMs).toBe(block === 4 ? min(15) : min(5));
      s = resumeTimer(skipBreak(s), now);
    }
  });

  it("finishing during a break saves nothing", () => {
    const s = advanceTimer(startTimer({ mode: "POMODORO", title: "", categoryId: null }, T0), T0 + min(26)).state!;
    expect(s.phase).toBe("BREAK");
    expect(finishTimer(s, T0 + min(27))).toBeNull();
  });

  it("shows the clock in Persian digits", () => {
    expect(formatClock(min(25))).toBe("۲۵:۰۰");
    expect(formatClock(min(61) + 5_000)).toBe("۱:۰۱:۰۵");
  });
});

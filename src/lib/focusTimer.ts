// «زمان‌سنج»: a stopwatch, a countdown and a pomodoro, as plain data and pure functions.
//
// Everything is kept as absolute times (when the running stretch began, how much ran before it), never
// as a counter that a setInterval keeps ticking: a phone suspends the WebView the moment the app is
// closed, so a counter would freeze — but "started at 10:00, 25 minutes" still says exactly when it
// ended, whenever the app is opened again. advance() is what catches up: it plays out every block that
// ended while nobody was looking, at the moment it actually ended.
//
// A finished stretch of work becomes a WorkSession, which the screen saves as a done task — so it shows
// up among the day's work, in the reports and in the day's battery like any other logged work.

export type TimerMode = "STOPWATCH" | "COUNTDOWN" | "POMODORO";
export type TimerPhase = "WORK" | "BREAK";

export interface PomodoroSettings {
  workMin: number;
  breakMin: number;
  /** After every fourth block of work the break is this long instead. */
  longBreakMin: number;
}

export const POMODORO_PRESETS: { label: string; settings: PomodoroSettings }[] = [
  { label: "۲۵ / ۵", settings: { workMin: 25, breakMin: 5, longBreakMin: 15 } },
  { label: "۵۰ / ۱۰", settings: { workMin: 50, breakMin: 10, longBreakMin: 30 } },
];
export const BLOCKS_BEFORE_LONG_BREAK = 4;
export const COUNTDOWN_PRESETS_MIN = [5, 10, 15, 25, 45, 60, 90] as const;
/** A stretch shorter than this is not worth a task of its own; it is dropped, not saved. */
export const MIN_SESSION_MS = 60_000;

export interface TimerState {
  mode: TimerMode;
  title: string;
  categoryId: string | null;
  phase: TimerPhase;
  /** False while paused, and between a finished break and the next block of a pomodoro. */
  running: boolean;
  /** When the current running stretch began (ms since epoch); null when not running. */
  segmentStartedAt: number | null;
  /** How long this phase already ran before the current stretch. */
  accumulatedMs: number;
  /** How long this phase lasts (countdown, pomodoro); null for a stopwatch. */
  targetMs: number | null;
  pomodoro: PomodoroSettings | null;
  /** Blocks of work finished so far in this pomodoro. */
  blocksDone: number;
}

export interface WorkSession {
  title: string;
  categoryId: string | null;
  startAt: string;
  endAt: string;
  durationMs: number;
}

export type TimerEvent = { kind: "WORK_DONE"; session: WorkSession | null } | { kind: "BREAK_DONE" } | { kind: "COUNTDOWN_DONE" };

const MIN = 60_000;

export function startTimer(input: { mode: TimerMode; title: string; categoryId: string | null; countdownMin?: number; pomodoro?: PomodoroSettings }, now: number): TimerState {
  const targetMs = input.mode === "COUNTDOWN" ? Math.max(1, input.countdownMin ?? 25) * MIN : input.mode === "POMODORO" ? (input.pomodoro ?? POMODORO_PRESETS[0].settings).workMin * MIN : null;
  return {
    mode: input.mode,
    title: input.title.trim(),
    categoryId: input.categoryId,
    phase: "WORK",
    running: true,
    segmentStartedAt: now,
    accumulatedMs: 0,
    targetMs,
    pomodoro: input.mode === "POMODORO" ? (input.pomodoro ?? POMODORO_PRESETS[0].settings) : null,
    blocksDone: 0,
  };
}

export function elapsedMs(state: TimerState, now: number): number {
  return state.accumulatedMs + (state.running && state.segmentStartedAt !== null ? Math.max(0, now - state.segmentStartedAt) : 0);
}

export function remainingMs(state: TimerState, now: number): number | null {
  return state.targetMs === null ? null : Math.max(0, state.targetMs - elapsedMs(state, now));
}

/** The moment the running phase ends by itself, or null (paused, a stopwatch, waiting for the next block). */
export function phaseEndsAt(state: TimerState): number | null {
  if (!state.running || state.segmentStartedAt === null || state.targetMs === null) return null;
  return state.segmentStartedAt + (state.targetMs - state.accumulatedMs);
}

export function pauseTimer(state: TimerState, now: number): TimerState {
  if (!state.running) return state;
  return { ...state, running: false, accumulatedMs: elapsedMs(state, now), segmentStartedAt: null };
}

export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.running) return state;
  return { ...state, running: true, segmentStartedAt: now };
}

function session(state: TimerState, workedMs: number, endAt: number): WorkSession | null {
  if (workedMs < MIN_SESSION_MS) return null;
  return { title: state.title, categoryId: state.categoryId, startAt: new Date(endAt - workedMs).toISOString(), endAt: new Date(endAt).toISOString(), durationMs: workedMs };
}

function breakLength(state: TimerState, blocksDone: number): number {
  const p = state.pomodoro!;
  return (blocksDone % BLOCKS_BEFORE_LONG_BREAK === 0 ? p.longBreakMin : p.breakMin) * MIN;
}

/** Whether the coming (or current) break is the long one. */
export function isLongBreak(state: TimerState): boolean {
  const blocks = state.phase === "BREAK" ? state.blocksDone : state.blocksDone + 1;
  return blocks > 0 && blocks % BLOCKS_BEFORE_LONG_BREAK === 0;
}

/**
 * Plays out everything that ended by `now`: a countdown that ran out, a pomodoro block (saved, then its
 * break starts at the moment the block ended), a break (the next block then waits for a tap). Returns
 * the new state (null once a countdown is over) and what happened, in order.
 */
export function advanceTimer(state: TimerState | null, now: number): { state: TimerState | null; events: TimerEvent[] } {
  const events: TimerEvent[] = [];
  let current = state;
  for (let guard = 0; current && guard < 4; guard++) {
    const endsAt = phaseEndsAt(current);
    if (endsAt === null || endsAt > now) break;
    if (current.mode === "COUNTDOWN") {
      events.push({ kind: "WORK_DONE", session: session(current, current.targetMs!, endsAt) }, { kind: "COUNTDOWN_DONE" });
      current = null;
    } else if (current.phase === "WORK") {
      const blocksDone = current.blocksDone + 1;
      events.push({ kind: "WORK_DONE", session: session(current, current.targetMs!, endsAt) });
      current = { ...current, phase: "BREAK", blocksDone, running: true, segmentStartedAt: endsAt, accumulatedMs: 0, targetMs: breakLength(current, blocksDone) };
    } else {
      events.push({ kind: "BREAK_DONE" });
      current = { ...current, phase: "WORK", running: false, segmentStartedAt: null, accumulatedMs: 0, targetMs: current.pomodoro!.workMin * MIN };
    }
  }
  return { state: current, events };
}

/** «پایان»: stops the timer; the work done so far in this phase becomes a session (a break is just dropped). */
export function finishTimer(state: TimerState, now: number): WorkSession | null {
  return state.phase === "WORK" ? session(state, elapsedMs(state, now), now) : null;
}

/** «رد کردن استراحت»: the break ends now and the next block waits for a tap. */
export function skipBreak(state: TimerState): TimerState {
  if (state.phase !== "BREAK") return state;
  return { ...state, phase: "WORK", running: false, segmentStartedAt: null, accumulatedMs: 0, targetMs: state.pomodoro!.workMin * MIN };
}

/** "MM:SS", or "H:MM:SS" past an hour — in Persian digits. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return text.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

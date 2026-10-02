"use client";

// The one running «زمان‌سنج» of this device, shared by the timer screen and the small running pill on
// every other screen (useSyncExternalStore), so the two never disagree or both save the same block.
//
// Kept in localStorage, not in the database: a timer belongs to the phone (or the browser tab) it runs
// on and is not synced — what is synced is its result, a done task, the moment a stretch of work ends.
// A finished stretch is queued first and then saved, so being offline or a failed request never loses it.
import { useSyncExternalStore } from "react";
import { apiPost, isNativePlatform } from "@/lib/apiClient";
import { refreshAllCaches } from "@/lib/refreshCaches";
import {
  advanceTimer,
  finishTimer,
  pauseTimer,
  phaseEndsAt,
  resumeTimer,
  skipBreak,
  startTimer,
  type PomodoroSettings,
  type TimerMode,
  type TimerState,
  type WorkSession,
} from "@/lib/focusTimer";

const STATE_KEY = "parva.focusTimer.state.v1";
const PENDING_KEY = "parva.focusTimer.pending.v1";
const PREFS_KEY = "parva.focusTimer.prefs.v1";

export const DEFAULT_SESSION_TITLE = "تمرکز";

export interface TimerPrefs {
  mode: TimerMode;
  countdownMin: number;
  pomodoro: PomodoroSettings;
}

export interface SavedNotice {
  title: string;
  durationMs: number;
  endAt: string;
}

export interface TimerSnapshot {
  state: TimerState | null;
  pending: WorkSession[];
  lastSaved: SavedNotice | null;
  /** The last event worth telling the person about while they are looking ("block done, break time"). */
  message: string | null;
  saveError: string | null;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the timer still runs for this visit
  }
}

let snapshot: TimerSnapshot = { state: null, pending: [], lastSaved: null, message: null, saveError: null };
let loaded = false;
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let lastTickAt = 0;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  snapshot = { ...snapshot, state: read<TimerState | null>(STATE_KEY, null), pending: read<WorkSession[]>(PENDING_KEY, []) };
}

function emit() {
  for (const l of listeners) l();
}

function set(patch: Partial<TimerSnapshot>, persist = true) {
  snapshot = { ...snapshot, ...patch };
  if (persist) {
    write(STATE_KEY, snapshot.state);
    write(PENDING_KEY, snapshot.pending.length > 0 ? snapshot.pending : null);
  }
  ensureTicking();
  emit();
}

/** A short beep and a buzz — only for something that happened just now, on screen. */
function chime() {
  try {
    navigator.vibrate?.([200, 100, 200]);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    osc.onended = () => void ctx.close();
  } catch {
    // no sound is fine
  }
}

/** The phone rings when the running block ends, even with the app closed. */
function armNotification(state: TimerState | null) {
  if (!isNativePlatform()) return;
  const endsAt = state ? phaseEndsAt(state) : null;
  void import("@/local/nativeNotifications").then(({ replaceFixedNotifications, TIMER_NOTIFICATION_ID }) => {
    if (!state || endsAt === null) return replaceFixedNotifications([TIMER_NOTIFICATION_ID], []);
    const title = state.title || DEFAULT_SESSION_TITLE;
    const text =
      state.mode === "COUNTDOWN"
        ? { title: "زمان تمام شد", body: `«${title}» در کارهای امروز ثبت شد.` }
        : state.phase === "WORK"
          ? { title: "بلوک تمرکز تمام شد", body: `«${title}» ثبت شد — وقت استراحت.` }
          : { title: "استراحت تمام شد", body: "برای بلوک بعدی آماده‌ای؟" };
    replaceFixedNotifications([TIMER_NOTIFICATION_ID], [{ id: TIMER_NOTIFICATION_ID, ...text, at: new Date(endsAt) }]);
  });
}

async function flushPending() {
  if (flushing || snapshot.pending.length === 0) return;
  flushing = true;
  try {
    while (snapshot.pending.length > 0) {
      const next = snapshot.pending[0];
      try {
        await apiPost("/api/tasks", {
          title: next.title || DEFAULT_SESSION_TITLE,
          categoryId: next.categoryId ?? undefined,
          status: "DONE",
          startAt: next.startAt,
          endAt: next.endAt,
          // The timer measured this time as it happened: it is recorded even on top of something planned for it.
          allowOverlap: true,
        });
      } catch (err) {
        set({ saveError: err instanceof Error ? err.message : "ثبت انجام نشد؛ دوباره تلاش می‌شود." });
        return;
      }
      set({ pending: snapshot.pending.slice(1), lastSaved: { title: next.title || DEFAULT_SESSION_TITLE, durationMs: next.durationMs, endAt: next.endAt }, saveError: null });
      refreshAllCaches();
    }
  } finally {
    flushing = false;
  }
}

/** Catches up with the clock: blocks that ended are queued for saving, the next phase begins. */
function tick() {
  load();
  const now = Date.now();
  const previousTick = lastTickAt;
  lastTickAt = now;
  const { state, events } = advanceTimer(snapshot.state, now);
  if (events.length > 0) {
    const sessions = events.flatMap((e) => (e.kind === "WORK_DONE" && e.session ? [e.session] : []));
    const last = events[events.length - 1];
    const message =
      last.kind === "COUNTDOWN_DONE" ? "زمان تمام شد." : last.kind === "BREAK_DONE" ? "استراحت تمام شد — بلوک بعدی را شروع کن." : "بلوک تمرکز تمام شد — وقت استراحت.";
    // Only while the screen was being watched (ticks a second apart); catching up after a reopen stays quiet.
    if (now - previousTick < 3_000) chime();
    set({ state, pending: [...snapshot.pending, ...sessions], message });
    armNotification(state);
  }
  void flushPending();
}

/** Ticks every second only while someone is looking and there is something to run or save. */
function ensureTicking() {
  const wanted = listeners.size > 0 && (snapshot.state !== null || snapshot.pending.length > 0);
  if (wanted && !interval) interval = setInterval(tick, 1000);
  if (!wanted && interval) {
    clearInterval(interval);
    interval = null;
  }
}

function subscribe(listener: () => void) {
  load();
  if (listeners.size === 0) document.addEventListener("visibilitychange", tick);
  listeners.add(listener);
  tick();
  ensureTicking();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) document.removeEventListener("visibilitychange", tick);
    ensureTicking();
  };
}

const SERVER_SNAPSHOT: TimerSnapshot = { state: null, pending: [], lastSaved: null, message: null, saveError: null };

export function useFocusTimer(): TimerSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT
  );
}

/** Re-renders every second while subscribed — for the running clock. */
export function useNow(active: boolean): number {
  return useSyncExternalStore(
    (l) => {
      if (!active) return () => {};
      const id = setInterval(l, 500);
      return () => clearInterval(id);
    },
    () => (active ? Math.floor(Date.now() / 500) * 500 : 0),
    () => 0
  );
}

function change(next: TimerState | null, extra: Partial<TimerSnapshot> = {}) {
  set({ state: next, message: null, ...extra });
  armNotification(next);
}

export const focusTimer = {
  start(input: { mode: TimerMode; title: string; categoryId: string | null; countdownMin?: number; pomodoro?: PomodoroSettings }) {
    load();
    change(startTimer(input, Date.now()), { lastSaved: null });
    write(PREFS_KEY, { ...readPrefs(), mode: input.mode, ...(input.countdownMin ? { countdownMin: input.countdownMin } : {}), ...(input.pomodoro ? { pomodoro: input.pomodoro } : {}) });
  },
  pause() {
    if (snapshot.state) change(pauseTimer(snapshot.state, Date.now()));
  },
  resume() {
    if (snapshot.state) change(resumeTimer(snapshot.state, Date.now()));
  },
  /** «پایان و ثبت»: the work so far is saved as a done task. */
  finish() {
    if (!snapshot.state) return;
    const session = finishTimer(snapshot.state, Date.now());
    change(null, { pending: session ? [...snapshot.pending, session] : snapshot.pending, message: session ? null : snapshot.state.phase === "WORK" ? "کمتر از یک دقیقه بود؛ ثبت نشد." : null });
    void flushPending();
  },
  /** «لغو»: stops without saving anything. */
  discard() {
    change(null);
  },
  skipBreak() {
    if (snapshot.state) change(resumeTimer(skipBreak(snapshot.state), Date.now()));
  },
  /** Changes what the running stretch is called and filed under (it is saved with these). */
  relabel(title: string, categoryId: string | null) {
    if (snapshot.state) set({ state: { ...snapshot.state, title: title.trim(), categoryId } });
  },
  retrySaving() {
    void flushPending();
  },
  dismissNotice() {
    set({ lastSaved: null, message: null }, false);
  },
};

export function readPrefs(): TimerPrefs {
  return { mode: "POMODORO", countdownMin: 25, pomodoro: { workMin: 25, breakMin: 5, longBreakMin: 15 }, ...read<Partial<TimerPrefs>>(PREFS_KEY, {}) };
}

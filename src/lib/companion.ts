// Pure mood engine for the Home page's Companion — no DB access, no Date.now() internally (time
// is injected via `now`), fully deterministic and testable in isolation. Exact port of the
// approved simulator in doc/companion-preview.html; keep the formula and the mood-priority
// order identical to that file if either ever needs to change — it's an ordered if/else chain,
// not independent conditions, since several moods' conditions can be simultaneously true (e.g. a
// CELEBRATING-level completion reached during the FRESH grace window) and the order below is the
// deliberate product decision for which one wins.
import { jalaliDateKey } from "./jalali";
import { phraseCompanion } from "./phrasing";

export type CompanionMood = "ASLEEP" | "FRESH" | "BLINDFOLDED" | "CELEBRATING" | "HAPPY" | "CONTENT" | "NEUTRAL" | "SLEEPY";

export interface CompanionInput {
  now: Date;
  wakeTime: Date;
  sleepTime: Date;
  productiveMinutes: number;
  habitMinutes: number;
  wasteMinutes: number;
  neutralMinutes: number;
  unloggedMinutes: number;
  targetMinutes: number;
  loggedEntriesToday: number;
}

export interface CompanionState {
  mood: CompanionMood;
  completion: number; // 0..1+, for the progress ring
  pace: number;
  achievedMinutes: number;
  targetMinutes: number;
  remainingMinutes: number;
  message: string;
  action: { label: string; kind: "CAPTURE" | "LOG_GAP" | "NONE" };
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function computeCompanionState(input: CompanionInput, seed: string): CompanionState {
  const nowMin = minutesOfDay(input.now);
  const wakeMin = minutesOfDay(input.wakeTime);
  const sleepMin = minutesOfDay(input.sleepTime);
  const capacity = sleepMin - wakeMin;

  // Misconfigured settings (sleepHour <= wakeHour) — degrade to a quiet, harmless state rather
  // than a negative-duration crash. Matches doc/companion-preview.html's compute() exactly,
  // including zeroing achieved/remaining rather than reporting real numbers for a day that
  // structurally can't be measured.
  if (capacity <= 0) {
    return {
      mood: "ASLEEP",
      completion: 0,
      pace: 0,
      achievedMinutes: 0,
      targetMinutes: input.targetMinutes,
      remainingMinutes: 0,
      message: phraseCompanion("ASLEEP", { achievedMinutes: 0, targetMinutes: input.targetMinutes, remainingMinutes: 0, unloggedMinutes: 0 }, seed),
      action: { label: "", kind: "NONE" },
    };
  }

  const clamped = Math.min(Math.max(nowMin, wakeMin), sleepMin);
  const elapsed = clamped - wakeMin;
  const dayProgress = elapsed / capacity;
  const achieved = input.productiveMinutes + input.habitMinutes;
  const expectedByNow = input.targetMinutes * dayProgress;
  // pace: how far ahead/behind THIS MOMENT's expectation you are — not achieved against the
  // full-day target. This is the only reason 9am with 0 logged hours reads as neutral rather
  // than as a failure: expectedByNow is itself small that early, so pace stays near 1.
  const pace = expectedByNow <= 0 ? 1 : achieved / expectedByNow;
  const completion = input.targetMinutes <= 0 ? 0 : achieved / input.targetMinutes;
  const blindness = elapsed <= 0 ? 0 : input.unloggedMinutes / elapsed;
  const dayOver = nowMin >= sleepMin;
  const remainingMinutes = Math.max(0, input.targetMinutes - achieved);

  let mood: CompanionMood;
  if (nowMin < wakeMin || nowMin > sleepMin + 60) mood = "ASLEEP";
  else if (elapsed < 90) mood = "FRESH";
  else if (elapsed >= 180 && blindness > 0.6) mood = "BLINDFOLDED";
  else if (completion >= 1.5 || (dayOver && completion >= 1)) mood = "CELEBRATING";
  else if (completion >= 1) mood = "HAPPY";
  else if (pace >= 0.8) mood = "CONTENT";
  else if (pace >= 0.4) mood = "NEUTRAL";
  else mood = "SLEEPY";

  const message = phraseCompanion(
    mood,
    { achievedMinutes: achieved, targetMinutes: input.targetMinutes, remainingMinutes, unloggedMinutes: input.unloggedMinutes },
    seed
  );

  // Label is always "ثبت کار" — BLINDFOLDED still pre-fills the day's biggest unlogged gap via
  // LOG_GAP under the hood (see onLogGap), it just no longer says something different on the
  // button itself; the smart pre-fill was a nice touch but a differently-worded button read as
  // a second, separate feature rather than the same one action.
  const action: CompanionState["action"] =
    mood === "ASLEEP" ? { label: "", kind: "NONE" } : mood === "BLINDFOLDED" ? { label: "ثبت کار", kind: "LOG_GAP" } : { label: "ثبت کار", kind: "CAPTURE" };

  return { mood, completion, pace, achievedMinutes: achieved, targetMinutes: input.targetMinutes, remainingMinutes, message, action };
}

/** Same seeding convention as dailyMomentSeed — stable within a day, mood-independent (mood
 * mixes in separately inside phraseCompanion) so callers can build this before the mood itself
 * is known, which computeCompanionState's own caller must do since mood is an output, not an
 * input, of this module. */
export function companionMessageSeed(userId: string, now: Date): string {
  return `${userId}:${jalaliDateKey(now)}:companion`;
}

// Pure functions for the habit tracker's adherence/streak/nudge logic — no DB access, so
// they're easy to unit test and reuse between the API routes and (if ever needed) the client.

export interface HabitLike {
  id: string;
  createdAt: Date;
  isActive: boolean;
  isTrial?: boolean;
}

export interface HabitCheckInLike {
  habitId: string;
  date: Date;
}

export interface DayAdherence {
  date: Date;
  total: number; // active habits that day
  checkedIn: number;
  ratio: number; // 0-1; 0 when total is 0
}

function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  let cursor = atMidnight(from);
  const end = atMidnight(to);
  while (cursor <= end) {
    days.push(cursor);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  return days;
}

/**
 * Daily adherence for [from, to]: for each day, how many habits were active (created on or
 * before that day) vs. how many were checked in. A habit created partway through the range
 * only counts against days on/after its own creation, so a brand-new habit doesn't tank the
 * ratio for days before it existed. Trial habits (see isTrial on the Habit model) are always
 * excluded — a 3-day Tiny Habits experiment shouldn't be able to break an established streak,
 * which would punish trying something new exactly when we want to encourage it.
 */
export function computeAdherenceSeries(habits: HabitLike[], checkIns: HabitCheckInLike[], from: Date, to: Date): DayAdherence[] {
  const activeHabits = habits.filter((h) => h.isActive && !h.isTrial);
  const checkInsByDay = new Map<string, Set<string>>();
  for (const c of checkIns) {
    const key = toDayKey(c.date);
    if (!checkInsByDay.has(key)) checkInsByDay.set(key, new Set());
    checkInsByDay.get(key)!.add(c.habitId);
  }

  return eachDay(from, to).map((date) => {
    const dayKey = toDayKey(date);
    const eligible = activeHabits.filter((h) => atMidnight(h.createdAt) <= date);
    const checkedInSet = checkInsByDay.get(dayKey) ?? new Set();
    const checkedIn = eligible.filter((h) => checkedInSet.has(h.id)).length;
    return {
      date,
      total: eligible.length,
      checkedIn,
      ratio: eligible.length > 0 ? checkedIn / eligible.length : 0,
    };
  });
}

/**
 * Duolingo-style streak: counts consecutive days (walking back from `today`) whose adherence
 * ratio meets `threshold`. Days with no active habits are skipped (neither break nor extend
 * the streak). `today` gets a pass while its ratio is still below threshold — the day isn't
 * over yet — but any earlier day below threshold ends the streak.
 */
export function computeCurrentStreak(series: DayAdherence[], today: Date, threshold = 0.8): number {
  const todayKey = toDayKey(today);
  let streak = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    const day = series[i];
    if (day.total === 0) continue;
    if (day.ratio >= threshold) {
      streak++;
      continue;
    }
    if (toDayKey(day.date) === todayKey) continue;
    break;
  }
  return streak;
}

/** Whole days elapsed since the most recent check-in (or since the habit was created, if it has none). */
export function daysSinceLastCheckIn(checkIns: HabitCheckInLike[], habitCreatedAt: Date, today: Date): number {
  const last = checkIns.reduce<Date | null>((max, c) => (!max || c.date > max ? c.date : max), null) ?? habitCreatedAt;
  const ms = atMidnight(today).getTime() - atMidnight(last).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** A habit is "neglected" once it's gone `neglectThresholdDays` or more without a check-in. */
export function isHabitNeglected(daysSince: number, neglectThresholdDays = 3): boolean {
  return daysSince >= neglectThresholdDays;
}

const TRIAL_LENGTH_DAYS = 3;

/** 1-based day-of-trial for display ("روز ۲ از ۳"), clamped to the trial length. */
export function trialDayNumber(trialStartDate: Date, today: Date, trialLengthDays = TRIAL_LENGTH_DAYS): number {
  const elapsed = Math.floor((atMidnight(today).getTime() - atMidnight(trialStartDate).getTime()) / 86_400_000);
  return Math.min(elapsed + 1, trialLengthDays);
}

/** True once the full trial window has passed and it's time to ask "keep it or not?". */
export function isTrialElapsed(trialStartDate: Date, today: Date, trialLengthDays = TRIAL_LENGTH_DAYS): boolean {
  const elapsed = Math.floor((atMidnight(today).getTime() - atMidnight(trialStartDate).getTime()) / 86_400_000);
  return elapsed >= trialLengthDays;
}

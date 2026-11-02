// «استمرار» — the habit tracker's old streak, rethought as the art of coming back. A streak counts days in a row and
// goes to zero at the first miss, which punishes exactly the moment a person needs a reason to return. Continuity
// counts what is true either way: how many of the recent days the person showed up (any habit done), how many times
// they came back after a break, and where they stand today — and a miss only ever leads to an invitation.
//
// Pure, and built from the adherence series the habits screens already have (src/lib/habitStreak.ts), so it works
// the same on the web and on the phone. Every number is a count of real check-in days; nothing is scored.
//
// Days on which no habit was active (a day before the first habit existed) are not eligible: they are neither a day
// shown up nor a miss — the same rule the old streak used.

/** A break is this many eligible days in a row without showing up; coming back after one is a «برگشت». */
export const BREAK_DAYS = 2;

export interface ContinuityDay {
  date: Date | string;
  /** Habits active that day. */
  total: number;
  /** Habits done that day. */
  checkedIn: number;
}

export type ContinuityState =
  /** No day in the window was shown up for. */
  | "NO_HISTORY"
  /** Showed up today, or yesterday with today still ahead. */
  | "ACTIVE"
  /** Today is a return: showed up after a break. */
  | "BACK"
  /** Two or more eligible days since the last time; today is a chance to return. */
  | "AWAY";

export interface Continuity {
  state: ContinuityState;
  /** Eligible days in the window, and how many of them had at least one habit done. */
  eligibleDays: number;
  daysShownUp: number;
  /** Returns after a break of BREAK_DAYS or more, and the longest break returned from. */
  comebacks: number;
  longestBreakReturned: number;
  /** Days showed up in a row, ending today — or yesterday while today is still open. */
  currentRun: number;
  /** Eligible days since the last day shown up: 0 = today. Null when there has been none. */
  daysAway: number | null;
  /** The break that today's return closed (0 when today is not a return). */
  breakBridgedToday: number;
}

function dayKey(date: Date | string): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function computeContinuity(series: readonly ContinuityDay[], today: Date): Continuity {
  const todayKey = dayKey(today);
  const eligible = series.filter((day) => day.total > 0);

  let daysShownUp = 0;
  let comebacks = 0;
  let longestBreakReturned = 0;
  let missRun = 0;
  let seenShownUp = false;
  let lastShownIndex = -1;
  let breakBridgedToday = 0;
  let todayShown = false;

  eligible.forEach((day, index) => {
    const isToday = dayKey(day.date) === todayKey;
    if (day.checkedIn > 0) {
      daysShownUp++;
      // Only a gap BETWEEN two days shown up is a break; the misses before the first one are just the beginning.
      if (seenShownUp && missRun >= BREAK_DAYS) {
        comebacks++;
        longestBreakReturned = Math.max(longestBreakReturned, missRun);
        if (isToday) breakBridgedToday = missRun;
      }
      seenShownUp = true;
      missRun = 0;
      lastShownIndex = index;
      if (isToday) todayShown = true;
    } else if (!isToday) {
      // Today is still open: not being done yet is not a miss.
      missRun++;
    }
  });

  const todayIndex = eligible.findIndex((day) => dayKey(day.date) === todayKey);
  const lastIndex = todayIndex >= 0 ? todayIndex : eligible.length - 1;
  const daysAway = lastShownIndex >= 0 ? lastIndex - lastShownIndex : null;

  // The run that is still alive: back from today if it was done, else back from yesterday.
  let currentRun = 0;
  if (lastShownIndex >= 0 && daysAway !== null && daysAway <= 1) {
    for (let i = lastShownIndex; i >= 0 && eligible[i].checkedIn > 0; i--) currentRun++;
  }

  let state: ContinuityState;
  if (daysShownUp === 0) state = "NO_HISTORY";
  else if (todayShown && breakBridgedToday > 0) state = "BACK";
  else if (daysAway !== null && daysAway <= 1) state = "ACTIVE";
  else state = "AWAY";

  return { state, eligibleDays: eligible.length, daysShownUp, comebacks, longestBreakReturned, currentRun, daysAway, breakBridgedToday };
}

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
function fa(n: number): string {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
}

/** The one line that stands for the habit tracker's state: warm, plain, never a reproach. */
export function continuityHeadline(c: Continuity): string {
  switch (c.state) {
    case "NO_HISTORY":
      return "استمرارت با اولین عادتی که انجام بدهی شروع می‌شود";
    case "BACK":
      return `امروز بعد از ${fa(c.breakBridgedToday)} روز برگشتی`;
    case "AWAY":
      return "امروز می‌توانی برگردی";
    case "ACTIVE":
      if (c.daysAway === 0) return c.currentRun >= 2 ? `${fa(c.currentRun)} روز است پشت‌سر هم می‌آیی` : "امروز آمدی";
      return c.currentRun >= 2 ? `${fa(c.currentRun)} روز است پشت‌سر هم می‌آیی` : "دیروز آمدی؛ امروز هم وقت داری";
  }
}

/** The numbers under it: how often the person showed up lately, and how often they came back. Empty when there is nothing to say. */
export function continuityDetail(c: Continuity): string {
  if (c.state === "NO_HISTORY") return "";
  const parts: string[] = [`${fa(c.daysShownUp)} از ${fa(c.eligibleDays)} روز اخیر آمدی`];
  if (c.comebacks > 0) parts.push(`${fa(c.comebacks)} بار بعد از وقفه برگشتی`);
  if (c.state === "AWAY" && c.daysAway !== null) parts.push(`آخرین بار ${fa(c.daysAway)} روز پیش بود`);
  return parts.join(" · ");
}

/**
 * One habit's line in a list: its run when it has one, otherwise the plain fact of how long since it was last ticked
 * (counted from when it was added, if it never was).
 */
export function habitContinuityLine(habit: { currentStreak: number; daysSinceLastCheckIn: number }): string {
  if (habit.currentStreak >= 2) return `${fa(habit.currentStreak)} روز است پشت‌سر هم می‌آیی`;
  if (habit.currentStreak === 1) return "امروز یا دیروز آمدی";
  return `${fa(habit.daysSinceLastCheckIn)} روز از آخرین تیک`;
}

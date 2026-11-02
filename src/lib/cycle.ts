// The monthly cycle section: the periods a person writes down, what their own history says about the length of a cycle
// and of a period, and when the next one is expected. It is an estimate from the person's own dates and nothing more —
// no fertile window, no advice. All of it stays on this device (src/lib/deviceStore.ts); nothing here is ever sent
// anywhere. Dates are calendar days ("YYYY-MM-DD", local), counted so that a daylight-saving change cannot move a day.
// Pure, so it can be tested.
import { dayKeyIso, parseDayKey } from "./calendarGrid";
import { toPersianDigits } from "./money";

export interface Period {
  id: string;
  /** The first day of bleeding. */
  start: string;
  /** The last day; null while the period is still going on. */
  end: string | null;
}

export interface CycleData {
  v: 1;
  periods: Period[];
}

export const EMPTY_CYCLE: CycleData = { v: 1, periods: [] };
export const CYCLE_STORAGE_KEY = "parva.cycle.v1";

/** What is assumed until the person's own dates say otherwise. */
export const DEFAULT_CYCLE_LENGTH = 28;
export const DEFAULT_PERIOD_LENGTH = 5;

/** A cycle or a period outside these is a mistake or something a tracker should not average in. */
const PLAUSIBLE_CYCLE: readonly [number, number] = [15, 60];
const PLAUSIBLE_PERIOD: readonly [number, number] = [1, 14];
/** How many of the latest cycles the average looks at. */
const RECENT_CYCLES = 6;

function dayNumber(key: string): number {
  const date = parseDayKey(key);
  if (!date) return NaN;
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/** Calendar days from one day to another (0 for the same day, negative backwards). */
export function daysBetween(fromKey: string, toKey: string): number {
  return dayNumber(toKey) - dayNumber(fromKey);
}

export function addDays(key: string, days: number): string {
  const date = parseDayKey(key) ?? new Date();
  return dayKeyIso(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

export function sortPeriods(periods: readonly Period[]): Period[] {
  return [...periods].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** The days a period covers, as a closed range; an open one covers its start (and, in a calendar, up to today). */
function rangeOf(period: Pick<Period, "start" | "end">): [number, number] {
  const from = dayNumber(period.start);
  return [from, period.end ? dayNumber(period.end) : from];
}

/** Why a period cannot be written down as it is (in the person's words), or null. */
export function validatePeriod(data: CycleData, candidate: { id?: string; start: string; end: string | null }, todayKey: string): string | null {
  if (parseDayKey(candidate.start) === null) return "روز شروع را درست انتخاب کن.";
  if (candidate.start > todayKey) return "روز شروع نمی‌تواند در آینده باشد.";
  if (candidate.end !== null) {
    if (parseDayKey(candidate.end) === null) return "روز پایان را درست انتخاب کن.";
    if (candidate.end < candidate.start) return "روز پایان قبل از شروع است.";
    if (candidate.end > todayKey) return "روز پایان نمی‌تواند در آینده باشد.";
    const length = daysBetween(candidate.start, candidate.end) + 1;
    if (length > PLAUSIBLE_PERIOD[1]) return `قاعدگی بیشتر از ${toPersianDigits(PLAUSIBLE_PERIOD[1])} روز ثبت نمی‌شود؛ اگر طولانی‌تر بوده، تاریخ‌ها را دوباره ببین.`;
  }
  const others = data.periods.filter((p) => p.id !== candidate.id);
  const [from, to] = rangeOf(candidate);
  if (others.some((p) => {
    const [otherFrom, otherTo] = rangeOf(p);
    return from <= otherTo && otherFrom <= to;
  })) {
    return "این روزها با قاعدگی دیگری که نوشته‌ای هم‌پوشانی دارد.";
  }
  if (candidate.end === null && others.some((p) => p.end === null)) return "یک قاعدگی هنوز تمام نشده است؛ اول آن را ببند.";
  // A period still going on must be the latest one.
  if (candidate.end === null && others.some((p) => p.start > candidate.start)) return "قاعدگی ادامه‌دار باید آخرین قاعدگی باشد.";
  return null;
}

export function addPeriod(data: CycleData, period: Period): CycleData {
  return { ...data, periods: sortPeriods([...data.periods, period]) };
}

export function updatePeriod(data: CycleData, id: string, patch: Partial<Pick<Period, "start" | "end">>): CycleData {
  return { ...data, periods: sortPeriods(data.periods.map((p) => (p.id === id ? { ...p, ...patch } : p))) };
}

export function removePeriod(data: CycleData, id: string): CycleData {
  return { ...data, periods: data.periods.filter((p) => p.id !== id) };
}

/** A value read back from storage, made safe: a period that is not well-formed is dropped rather than trusted. */
export function sanitizeCycle(raw: unknown): CycleData {
  if (!raw || typeof raw !== "object") return EMPTY_CYCLE;
  const list = (raw as { periods?: unknown }).periods;
  if (!Array.isArray(list)) return EMPTY_CYCLE;
  const periods = list.filter(
    (p): p is Period =>
      !!p &&
      typeof p === "object" &&
      typeof (p as Period).id === "string" &&
      parseDayKey((p as Period).start) !== null &&
      ((p as Period).end === null || (typeof (p as Period).end === "string" && parseDayKey((p as Period).end as string) !== null && (p as Period).end! >= (p as Period).start))
  );
  return { v: 1, periods: sortPeriods(periods) };
}

/** The days between one period's start and the next's, oldest first, only those a cycle can plausibly be. */
export function cycleLengths(periods: readonly Period[]): number[] {
  const sorted = sortPeriods(periods);
  const lengths: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const length = daysBetween(sorted[i - 1].start, sorted[i].start);
    if (length >= PLAUSIBLE_CYCLE[0] && length <= PLAUSIBLE_CYCLE[1]) lengths.push(length);
  }
  return lengths;
}

export interface Average {
  days: number;
  /** True when the person's own dates gave it, false when it is the assumed default. */
  learned: boolean;
}

export function averageCycleLength(periods: readonly Period[]): Average {
  const recent = cycleLengths(periods).slice(-RECENT_CYCLES);
  if (recent.length === 0) return { days: DEFAULT_CYCLE_LENGTH, learned: false };
  return { days: Math.round(recent.reduce((sum, n) => sum + n, 0) / recent.length), learned: true };
}

export function averagePeriodLength(periods: readonly Period[]): Average {
  const lengths = periods
    .filter((p) => p.end !== null)
    .map((p) => daysBetween(p.start, p.end!) + 1)
    .filter((n) => n >= PLAUSIBLE_PERIOD[0] && n <= PLAUSIBLE_PERIOD[1])
    .slice(-RECENT_CYCLES);
  if (lengths.length === 0) return { days: DEFAULT_PERIOD_LENGTH, learned: false };
  return { days: Math.round(lengths.reduce((sum, n) => sum + n, 0) / lengths.length), learned: true };
}

export type Phase = "PERIOD" | "BETWEEN" | "SOON" | "LATE";

export interface CycleStatus {
  lastStart: string | null;
  /** Today's day of the cycle, 1 on the first day of the last period. */
  cycleDay: number | null;
  /** Today falls inside the last period (still going on, or ended today or later). */
  inPeriod: boolean;
  /** The day of the period today is, when it is in one. */
  periodDay: number | null;
  openPeriod: Period | null;
  averageCycle: Average;
  averagePeriod: Average;
  /** The day the next period is expected, and how far either side of it it may fall. */
  nextStart: string | null;
  spread: number;
  /** Days until the expected start; negative when it is later than expected. */
  daysToNext: number | null;
  phase: Phase | null;
}

export function cycleStatus(data: CycleData, todayKey: string): CycleStatus {
  const periods = sortPeriods(data.periods);
  const averageCycle = averageCycleLength(periods);
  const averagePeriod = averagePeriodLength(periods);
  const last = periods[periods.length - 1];
  const lengths = cycleLengths(periods);
  // How much a cycle varies for this person: half the spread of the recent ones (at least a day, at most five); three days until there is enough to say.
  const spread = lengths.length >= 3 ? Math.max(1, Math.min(5, Math.ceil((Math.max(...lengths.slice(-RECENT_CYCLES)) - Math.min(...lengths.slice(-RECENT_CYCLES))) / 2))) : 3;

  if (!last) {
    return { lastStart: null, cycleDay: null, inPeriod: false, periodDay: null, openPeriod: null, averageCycle, averagePeriod, nextStart: null, spread, daysToNext: null, phase: null };
  }

  const openPeriod = last.end === null ? last : null;
  const cycleDay = daysBetween(last.start, todayKey) + 1;
  const inPeriod = openPeriod !== null || (last.end !== null && todayKey >= last.start && todayKey <= last.end);
  const nextStart = addDays(last.start, averageCycle.days);
  const daysToNext = daysBetween(todayKey, nextStart);

  let phase: Phase;
  if (inPeriod) phase = "PERIOD";
  else if (daysToNext < -spread) phase = "LATE";
  else if (daysToNext <= 3) phase = "SOON";
  else phase = "BETWEEN";

  return {
    lastStart: last.start,
    cycleDay: cycleDay >= 1 ? cycleDay : null,
    inPeriod,
    periodDay: inPeriod ? cycleDay : null,
    openPeriod,
    averageCycle,
    averagePeriod,
    nextStart,
    spread,
    daysToNext,
    phase,
  };
}

export const PHASE_LABELS: Record<Phase, string> = {
  PERIOD: "در دوران قاعدگی",
  BETWEEN: "بین دو قاعدگی",
  SOON: "قاعدگی بعدی نزدیک است",
  LATE: "از زمان تخمینیِ قاعدگی گذشته",
};

export type DayMark = "PERIOD" | "EXPECTED";

/**
 * What a calendar marks on each given day: the days of the periods written down (a period still going on, up to today)
 * and the days the next one is expected between (the expected start, a few days either side), from today onward — what
 * is already behind needs no expecting.
 */
export function monthMarks(data: CycleData, status: CycleStatus, days: readonly string[], todayKey: string): Record<string, DayMark> {
  const marks: Record<string, DayMark> = {};
  for (const day of days) {
    const n = dayNumber(day);
    for (const p of data.periods) {
      const from = dayNumber(p.start);
      const to = p.end ? dayNumber(p.end) : dayNumber(todayKey);
      if (n >= from && n <= to) marks[day] = "PERIOD";
    }
    if (!marks[day] && status.nextStart && day >= todayKey) {
      const start = dayNumber(status.nextStart);
      if (n >= start - status.spread && n <= start + status.spread) marks[day] = "EXPECTED";
    }
  }
  return marks;
}

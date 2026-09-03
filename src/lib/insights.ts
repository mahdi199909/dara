// The daily insight engine: one real fact about the user's own data per day, never a fabricated
// pattern. Every detector here is a pure function over InsightContext (already-fetched data —
// see computeDailyInsight in reportEngine.ts / local/reportEngine.ts for the DB-fetching wrapper
// that assembles this context and handles ShownInsight dedup) so each one is independently unit
// testable without a database.
//
// Honesty gate: every detector checks ctx.dataDays >= MIN_DATA_DAYS itself (via hasEnoughHistory)
// before anything else — a brand-new account never gets an insight, real or otherwise. Beyond
// that, the two genuinely *statistical* detectors (dayOfWeekCost, categoryDrift — patterns
// inferred across many days, which sparse data can make look real when it isn't) additionally
// require a minimum count of distinct data points, and hedge their language ("به نظر می‌رسد").
// The other five report a single *discrete* fact (a specific record, a specific past day, a
// specific threshold crossing) — there's no "sample size" to under-power there; the fact either
// happened or it didn't, so they state it plainly once the 14-day gate is cleared.
import { formatDuration, formatToman, toPersianDigits } from "./money";
import { computeTimeCost } from "./timeCost";
import { computeDaySegments, type TimedInterval } from "./dayBattery";
import { jalaliDateKey, WEEKDAYS_FA } from "./jalali";
import type { TimeAndMoneyReport, HiddenCostReport } from "./reportEngine";

export type InsightKind = "pattern" | "record" | "memory" | "hidden" | "growth";

export interface Insight {
  /** Stable per-finding key (see ShownInsight) — encodes enough of the specific finding that a
   * genuinely new fact (a different weekday, a different milestone) gets a fresh id, while the
   * same fact recurring within the suppression window is correctly deduped. */
  id: string;
  kind: InsightKind;
  text: string;
  href?: string;
  /** 0..1 — used only to rank candidates before the seeded pick from the top 3. */
  strength: number;
}

export interface CapitalSnapshotPoint {
  date: string; // jalali day key, ascending
  investedMinutes: number; // cumulative lifetime total AS OF this day (see CapitalSnapshot)
}

export interface WeekDayForGap {
  date: string; // jalali day key
  wakeTime: Date;
  sleepTime: Date;
  intervals: TimedInterval[];
}

export interface InsightContext {
  now: Date;
  /** Days since the user's very first record — the global honesty gate. Null (no records at
   * all) is treated the same as 0. */
  dataDays: number;

  report7d: TimeAndMoneyReport;
  report30d: TimeAndMoneyReport;
  report90d: TimeAndMoneyReport;
  /** The 30 days *before* report30d's window (days 31-60 ago) — categoryDrift's comparison point. */
  reportPrevious30d: TimeAndMoneyReport;
  hiddenCost7d: HiddenCostReport;
  /** Single-day reports for exactly one month ago / one year ago — onThisDay's source. A period
   * predating the account's first record just comes back as an all-zero report, which the
   * detector already treats as "no memory to surface". */
  onThisDayLastMonth: TimeAndMoneyReport;
  onThisDayLastYear: TimeAndMoneyReport;

  /** Lifetime TimeEntry minutes per category/project id (see sumCategoryLifetimeMinutes /
   * sumProjectLifetimeMinutes) — only populated for ids appearing in report30d, which is all
   * milestoneHours needs to detect a threshold crossed within the last 30 days. */
  categoryLifetimeMinutes: Record<string, number>;
  projectLifetimeMinutes: Record<string, number>;

  /** Full history, ascending by date — personalRecord derives day-over-day deltas from
   * consecutive pairs, so this needs more than just the last-30 window /api/capital exposes. */
  capitalSnapshots: CapitalSnapshotPoint[];

  /** Last 7 calendar days (oldest first), each already resolved to its own wake/sleep window and
   * logged intervals — unloggedGap's source, reusing dayBattery.ts's own sweep algorithm per day. */
  weekDaySegments: WeekDayForGap[];

  hourlyValue: number;
}

export type InsightDetector = (ctx: InsightContext) => Insight | null;

const MIN_DATA_DAYS = 14;
const MIN_SAMPLE_POINTS = 5; // for the two statistical detectors only — see file header

function hasEnoughHistory(ctx: InsightContext): boolean {
  return ctx.dataDays >= MIN_DATA_DAYS;
}

// --- 1. dayOfWeekCost --------------------------------------------------------------------

/** Sums each category's per-day minutes (already bucketed by src/lib/calendarGrid.ts's
 * dayKeyIso) into one total-per-day figure — the DB wrapper builds this from
 * computeCategoryCalendar's per-category day maps. */
export interface DailyMinutes {
  date: string; // dayKeyIso
  minutes: number;
}

export function dayOfWeekCost(ctx: InsightContext, dailyMinutes90d: DailyMinutes[]): Insight | null {
  if (!hasEnoughHistory(ctx)) return null;
  const activeDays = dailyMinutes90d.filter((d) => d.minutes > 0);
  if (activeDays.length < MIN_SAMPLE_POINTS) return null;

  const byWeekday = new Map<number, { totalMinutes: number; days: number }>();
  for (const d of dailyMinutes90d) {
    const weekday = new Date(d.date).getDay();
    const entry = byWeekday.get(weekday) ?? { totalMinutes: 0, days: 0 };
    entry.totalMinutes += d.minutes;
    entry.days += 1;
    byWeekday.set(weekday, entry);
  }
  if (byWeekday.size < 3) return null; // too little weekday variety to say anything meaningful

  const averages = Array.from(byWeekday.entries()).map(([weekday, { totalMinutes, days }]) => ({ weekday, avg: totalMinutes / days }));
  const overallAvg = averages.reduce((s, a) => s + a.avg, 0) / averages.length;
  if (overallAvg <= 0) return null;

  averages.sort((a, b) => b.avg - a.avg);
  const top = averages[0];
  if (top.avg <= overallAvg * 1.2) return null; // not meaningfully above average

  const weekdayName = WEEKDAYS_FA[top.weekday];
  const roundedMinutes = Math.round(top.avg);
  const tomans = computeTimeCost(roundedMinutes, ctx.hourlyValue);
  const text =
    tomans > 0
      ? `به نظر می‌رسد ${weekdayName}‌ها معمولاً پرمصرف‌ترین روز هفته‌ات هستند — میانگین ${formatDuration(roundedMinutes)}، حدود ${formatToman(tomans, { withSuffix: true })}.`
      : `به نظر می‌رسد ${weekdayName}‌ها معمولاً پرمصرف‌ترین روز هفته‌ات هستند — میانگین ${formatDuration(roundedMinutes)}.`;

  return {
    id: `dayOfWeekCost:${top.weekday}`,
    kind: "pattern",
    text,
    href: "/reports?preset=month",
    strength: Math.min(1, Math.max(0.2, (top.avg - overallAvg) / overallAvg)),
  };
}

// --- 2. categoryDrift ----------------------------------------------------------------------

export function categoryDrift(ctx: InsightContext): Insight | null {
  if (!hasEnoughHistory(ctx)) return null;

  const totalNow = ctx.report30d.timeByCategory.reduce((s, c) => s + c.minutes, 0);
  const totalPrev = ctx.reportPrevious30d.timeByCategory.reduce((s, c) => s + c.minutes, 0);
  // The sample here is total logged minutes, not category count — a single dominant category is
  // normal and doesn't need 5 *distinct* categories to exist for the comparison to be meaningful.
  if (totalNow < MIN_SAMPLE_POINTS * 60 || totalPrev < MIN_SAMPLE_POINTS * 60) return null;

  const allCategoryIds = new Set([...ctx.report30d.timeByCategory.map((c) => c.categoryId), ...ctx.reportPrevious30d.timeByCategory.map((c) => c.categoryId)]);

  let best: { categoryId: string; name: string; shiftPoints: number; direction: "up" | "down" } | null = null;
  for (const categoryId of allCategoryIds) {
    const nowCat = ctx.report30d.timeByCategory.find((c) => c.categoryId === categoryId);
    const prevCat = ctx.reportPrevious30d.timeByCategory.find((c) => c.categoryId === categoryId);
    const shiftPoints = (nowCat ? nowCat.minutes / totalNow : 0) * 100 - (prevCat ? prevCat.minutes / totalPrev : 0) * 100;
    if (Math.abs(shiftPoints) > 25 && (!best || Math.abs(shiftPoints) > Math.abs(best.shiftPoints))) {
      best = { categoryId, name: (nowCat ?? prevCat)!.name, shiftPoints, direction: shiftPoints > 0 ? "up" : "down" };
    }
  }
  if (!best) return null;

  const verb = best.direction === "up" ? "بیشتر شده" : "کمتر شده";
  return {
    id: `categoryDrift:${best.categoryId}`,
    kind: "pattern",
    text: `به نظر می‌رسد سهم «${best.name}» از زمانت نسبت به ماه قبل ${verb} — حدود ${toPersianDigits(Math.round(Math.abs(best.shiftPoints)))} درصد.`,
    href: "/reports?preset=month",
    strength: Math.min(1, Math.abs(best.shiftPoints) / 50),
  };
}

// --- 3. hiddenCostTop ------------------------------------------------------------------------

export function hiddenCostTop(ctx: InsightContext): Insight | null {
  if (!hasEnoughHistory(ctx)) return null;

  const top = [...ctx.hiddenCost7d.items].filter((i) => i.directCost === 0 && i.timeCost > 0).sort((a, b) => b.timeCost - a.timeCost)[0];
  if (!top) return null;

  return {
    id: `hiddenCostTop:${top.id}`,
    kind: "hidden",
    text: `«${top.title}» در حسابت صفر ثبت شده بود؛ هزینه پنهانش ${formatToman(top.timeCost, { withSuffix: true })} بود.`,
    href: "/reports?tab=hiddenCost",
    strength: Math.min(1, top.timeCost / 1_000_000),
  };
}

// --- 4. milestoneHours -----------------------------------------------------------------------

const MILESTONE_THRESHOLDS_HOURS = [250, 100, 50, 25, 10]; // descending — report the highest one just crossed

export function milestoneHours(ctx: InsightContext): Insight | null {
  if (!hasEnoughHistory(ctx)) return null;

  const candidates = [
    ...ctx.report30d.timeByCategory.map((c) => ({
      id: `category:${c.categoryId}`,
      label: c.name,
      href: `/reports?category=${c.categoryId}`,
      periodMinutes: c.minutes,
      lifetimeMinutes: ctx.categoryLifetimeMinutes[c.categoryId] ?? 0,
    })),
    ...ctx.report30d.timeByProject.map((p) => ({
      id: `project:${p.projectId}`,
      label: p.name,
      href: `/projects/detail?id=${p.projectId}`,
      periodMinutes: p.minutes,
      lifetimeMinutes: ctx.projectLifetimeMinutes[p.projectId] ?? 0,
    })),
  ];

  for (const threshold of MILESTONE_THRESHOLDS_HOURS) {
    const thresholdMin = threshold * 60;
    for (const c of candidates) {
      const before = c.lifetimeMinutes - c.periodMinutes;
      if (before < thresholdMin && c.lifetimeMinutes >= thresholdMin) {
        return {
          id: `milestoneHours:${c.id}:${threshold}`,
          kind: "growth",
          text: `«${c.label}» از مرز ${toPersianDigits(threshold)} ساعت گذشت — جمعش الان ${formatDuration(c.lifetimeMinutes)} است.`,
          href: c.href,
          strength: 0.9,
        };
      }
    }
  }
  return null;
}

// --- 5. onThisDay ----------------------------------------------------------------------------

export function onThisDay(ctx: InsightContext): Insight | null {
  if (!hasEnoughHistory(ctx)) return null;

  // Prefers the year-ago memory (more novel) when both exist.
  const candidate =
    ctx.onThisDayLastYear.totalDurationMin > 0
      ? { report: ctx.onThisDayLastYear, when: "سال" }
      : ctx.onThisDayLastMonth.totalDurationMin > 0
        ? { report: ctx.onThisDayLastMonth, when: "ماه" }
        : null;
  if (!candidate) return null;

  const top = [...candidate.report.timeByCategory].sort((a, b) => b.minutes - a.minutes)[0];
  if (!top) return null;

  return {
    id: `onThisDay:${candidate.when}:${jalaliDateKey(candidate.report.from)}`,
    kind: "memory",
    text: `همین روز، یک ${candidate.when} پیش، ${formatDuration(top.minutes)} صرف «${top.name}» کرده بودی.`,
    strength: 0.5,
  };
}

// --- 6. personalRecord -----------------------------------------------------------------------

/** Day-level only for this first round (see the plan's own "دور اول" framing) — a week-level
 * record would need the same delta history summed in rolling 7-day windows, deferred rather than
 * rushed. */
export function personalRecord(ctx: InsightContext): Insight | null {
  if (!hasEnoughHistory(ctx)) return null;
  if (ctx.capitalSnapshots.length < MIN_SAMPLE_POINTS + 1) return null; // need N+1 snapshots for N deltas

  const deltas: number[] = [];
  for (let i = 1; i < ctx.capitalSnapshots.length; i++) {
    deltas.push(Math.max(0, ctx.capitalSnapshots[i].investedMinutes - ctx.capitalSnapshots[i - 1].investedMinutes));
  }
  if (deltas.length < MIN_SAMPLE_POINTS) return null;

  const today = deltas[deltas.length - 1];
  const historicalMax = Math.max(...deltas.slice(0, -1));
  if (today <= 0 || today <= historicalMax) return null;

  return {
    id: `personalRecord:day:${today}`,
    kind: "record",
    text: `امروز ${formatDuration(today)} سرمایه‌گذاری کردی — بیشترین مقدار در یک روز تا الان.`,
    href: "/capital",
    strength: 0.95,
  };
}

// --- 7. unloggedGap --------------------------------------------------------------------------

const MIN_GAP_MINUTES = 60; // a gap under an hour isn't worth interrupting the user over

export function unloggedGap(ctx: InsightContext): Insight | null {
  if (!hasEnoughHistory(ctx)) return null;

  let largest: { date: string; start: Date; end: Date; minutes: number } | null = null;
  for (const day of ctx.weekDaySegments) {
    // now === sleepTime: a past day is always fully elapsed, so computeDaySegments reports its
    // whole window as either logged or UNLOGGED, never REMAINING.
    const result = computeDaySegments(day.wakeTime, day.sleepTime, day.sleepTime, day.intervals);
    for (const seg of result.segments) {
      if (seg.kind === "UNLOGGED" && (!largest || seg.minutes > largest.minutes)) {
        largest = { date: day.date, start: seg.start, end: seg.end, minutes: seg.minutes };
      }
    }
  }
  if (!largest || largest.minutes < MIN_GAP_MINUTES) return null;

  return {
    id: `unloggedGap:${largest.date}:${largest.start.getHours()}`,
    kind: "hidden",
    // Query params are a placeholder contract for a future Home-page capture-prefill reader —
    // no UI currently consumes them (this pass ships the engine only, not its display surface).
    href: `/?logStart=${encodeURIComponent(largest.start.toISOString())}&logEnd=${encodeURIComponent(largest.end.toISOString())}`,
    text: `${formatDuration(largest.minutes)} از این هفته هیچ‌جا ثبت نشده.`,
    strength: Math.min(1, largest.minutes / 240),
  };
}

// --- selection -------------------------------------------------------------------------------

export const ALL_DETECTORS: ((ctx: InsightContext) => Insight | null)[] = [categoryDrift, hiddenCostTop, milestoneHours, onThisDay, personalRecord, unloggedGap];

/** Runs every detector (dayOfWeekCost excluded — it needs dailyMinutes90d, which isn't part of
 * the shared InsightContext shape since only this one detector needs it; the DB wrapper calls it
 * separately and merges its result in), drops nulls, sorts by strength descending. */
export function collectCandidates(ctx: InsightContext, dailyMinutes90d: DailyMinutes[]): Insight[] {
  const results = [dayOfWeekCost(ctx, dailyMinutes90d), ...ALL_DETECTORS.map((d) => d(ctx))];
  return results.filter((i): i is Insight => i !== null).sort((a, b) => b.strength - a.strength);
}

function seededIndex(seed: string, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % max;
}

/**
 * Picks the day's insight: candidates already shown within the suppression window are filtered
 * out first, then one of the (remaining) top 3 by strength is chosen deterministically for a
 * given user+day — same user, same Jalali day => same pick; a different day => can differ.
 * Returns null (never a fabricated placeholder) if nothing clears the honesty gate or everything
 * eligible has already been shown recently.
 */
export function selectDailyInsight(ctx: InsightContext, dailyMinutes90d: DailyMinutes[], userId: string, alreadyShownIds: ReadonlySet<string>): Insight | null {
  const eligible = collectCandidates(ctx, dailyMinutes90d).filter((i) => !alreadyShownIds.has(i.id));
  if (eligible.length === 0) return null;

  const top3 = eligible.slice(0, 3);
  const index = seededIndex(`${userId}:${jalaliDateKey(ctx.now)}`, top3.length);
  return top3[index];
}

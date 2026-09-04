// A "۱۲ کار انجام دادی" is a report; "در ۳۰ روز گذشته آدمی بودی که هفته‌ای ۶ ساعت روی خودش
// سرمایه‌گذاری کرد" is an identity. People act to stay consistent with the self-image they hold,
// not to move a number — so this file turns accumulated behavior into identity-shaped sentences.
//
// Every statement is past-tense and descriptive, never prescriptive or praising ("عالی بودی",
// "ادامه بده" are exactly what this file must never produce — see the product's tone rule). No
// statement uses «پنهان» — these are broader identity reflections, not the two specific
// hidden-cost/hidden-asset moments that word is reserved for.
//
// Honesty gate: every pattern checks ctx.dataDays >= MIN_DATA_DAYS itself (via hasEnoughHistory),
// mirroring src/lib/insights.ts's identical convention — a brand-new account gets nothing here
// either. Each pattern also has its own minimum-signal floor (e.g. at least 2 weeks of a habit,
// at least 3 days of a logging streak) below which the fact isn't identity-forming yet, and
// buildIdentityStatements applies a final MIN_STRENGTH floor on top of both.
import { formatDuration, toPersianDigits } from "./money";
import { formatJalali } from "./jalali";
import { dayKeyIso } from "./calendarGrid";
import { computeConsecutiveWeeksMaintained } from "./habitStreak";

export interface IdentityStatement {
  id: string;
  text: string;
  /** A route path — the UI links the statement to it, so tapping goes to the real data behind it. */
  evidence: string;
  strength: number;
}

export interface IdentitySkillCandidate {
  categoryId: string;
  name: string;
  minutes: number;
}

export interface IdentityHabitCandidate {
  habitId: string;
  title: string;
  checkInDates: Date[];
}

export interface IdentityCategoryCandidate {
  categoryId: string;
  name: string;
  minutes: number;
}

export interface IdentityContext {
  now: Date;
  /** Days since the account's first real record — same convention as insights.ts's ctx.dataDays. */
  dataDays: number;
  /** Categories with generatesVirtualAsset=true ("مهارت") and their minutes over the last 30 days. */
  skillCandidates30d: IdentitySkillCandidate[];
  /** Active, non-trial habits with their check-in dates over a wide-enough window (~90d) to detect streaks. */
  habitCandidates: IdentityHabitCandidate[];
  /** Projects completed within the project window (see projectWindowStart). */
  completedProjectsCount: number;
  projectWindowStart: Date;
  /** The single biggest category by time (any kind) over the last 90 days, if any. */
  topCategory90d: IdentityCategoryCandidate | null;
  totalMinutes90d: number;
  /** Calendar-day keys (see calendarGrid.ts's dayKeyIso) with any real activity, wide enough (~90d) to bound the logging streak. */
  loggingActiveDayKeys: Set<string>;
}

const MIN_DATA_DAYS = 14;
const MIN_STRENGTH = 0.15;
const MIN_WEEKLY_MINUTES = 60; // at least ~1h/week average — anything less isn't identity-forming
const MIN_HABIT_STREAK_WEEKS = 2;
const MIN_TOP_CATEGORY_MINUTES = 300; // at least 5h over 90 days
const MIN_LOGGING_STREAK_DAYS = 3;

function hasEnoughHistory(ctx: IdentityContext): boolean {
  return ctx.dataDays >= MIN_DATA_DAYS;
}

/** "در ۳۰ روز گذشته، هفته‌ای X ساعت روی «مهارت» گذاشتی." — the skill (a virtual-asset-generating
 * category) with the most time over the last 30 days, expressed as a weekly average. */
export function weeklyHoursOnSkill(ctx: IdentityContext): IdentityStatement | null {
  if (!hasEnoughHistory(ctx)) return null;
  const top = [...ctx.skillCandidates30d].sort((a, b) => b.minutes - a.minutes)[0];
  if (!top) return null;

  const weeklyMinutes = Math.round((top.minutes / 30) * 7);
  if (weeklyMinutes < MIN_WEEKLY_MINUTES) return null;

  return {
    id: `weeklyHoursOnSkill:${top.categoryId}`,
    text: `در ۳۰ روز گذشته، هفته‌ای ${formatDuration(weeklyMinutes)} روی «${top.name}» گذاشتی.`,
    evidence: `/reports?category=${top.categoryId}`,
    strength: Math.min(1, weeklyMinutes / (7 * 60)),
  };
}

/** "N هفته پشت‌سرهم «عادت» را نگه داشتی." — the habit with the longest current weekly streak,
 * among habits maintained at least MIN_HABIT_STREAK_WEEKS weeks running. */
export function consecutiveWeeksHabit(ctx: IdentityContext): IdentityStatement | null {
  if (!hasEnoughHistory(ctx)) return null;

  let best: { habitId: string; title: string; weeks: number } | null = null;
  for (const h of ctx.habitCandidates) {
    const weeks = computeConsecutiveWeeksMaintained(h.checkInDates, ctx.now);
    if (weeks >= MIN_HABIT_STREAK_WEEKS && (!best || weeks > best.weeks)) {
      best = { habitId: h.habitId, title: h.title, weeks };
    }
  }
  if (!best) return null;

  return {
    id: `consecutiveWeeksHabit:${best.habitId}`,
    text: `${toPersianDigits(best.weeks)} هفته پشت‌سرهم «${best.title}» را نگه داشتی.`,
    evidence: "/habits",
    strength: Math.min(1, best.weeks / 8),
  };
}

/** "از [تاریخ]، N پروژه را به پایان رساندی." — real completions in the project window, never a
 * count fabricated from anything else. */
export function projectsCompletedSince(ctx: IdentityContext): IdentityStatement | null {
  if (!hasEnoughHistory(ctx)) return null;
  if (ctx.completedProjectsCount <= 0) return null;

  return {
    id: `projectsCompletedSince:${ctx.completedProjectsCount}`,
    text: `از ${formatJalali(ctx.projectWindowStart)}، ${toPersianDigits(ctx.completedProjectsCount)} پروژه را به پایان رساندی.`,
    evidence: "/projects",
    strength: Math.min(1, ctx.completedProjectsCount / 3),
  };
}

/** "بیشترین چیزی که ساختی «حوزه» بود — X ساعت از کل زمانت." — the single biggest category by
 * time over 90 days, any kind (not limited to skill/virtual-asset categories like
 * weeklyHoursOnSkill) — a broader "where did your time actually go" identity fact. */
export function biggestThingBuilt(ctx: IdentityContext): IdentityStatement | null {
  if (!hasEnoughHistory(ctx)) return null;
  const top = ctx.topCategory90d;
  if (!top || top.minutes < MIN_TOP_CATEGORY_MINUTES) return null;

  return {
    id: `biggestThingBuilt:${top.categoryId}`,
    text: `بیشترین چیزی که ساختی «${top.name}» بود — ${formatDuration(top.minutes)} از کل زمانت.`,
    evidence: `/reports?category=${top.categoryId}`,
    strength: ctx.totalMinutes90d > 0 ? Math.min(1, top.minutes / ctx.totalMinutes90d) : 0,
  };
}

/** How many consecutive days, walking back from `now`, have any real logged activity. Today gets
 * a pass while still in progress — a quiet morning doesn't break a streak the day isn't over. */
export function computeLoggingStreak(activeDayKeys: Set<string>, now: Date): number {
  let streak = 0;
  for (let daysAgo = 0; ; daysAgo++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
    if (activeDayKeys.has(dayKeyIso(d))) {
      streak++;
      continue;
    }
    if (daysAgo === 0) continue;
    break;
  }
  return streak;
}

/** "N روز پشت‌سرهم روزت را ثبت کرده‌ای." */
export function loggingStreak(ctx: IdentityContext): IdentityStatement | null {
  if (!hasEnoughHistory(ctx)) return null;
  const days = computeLoggingStreak(ctx.loggingActiveDayKeys, ctx.now);
  if (days < MIN_LOGGING_STREAK_DAYS) return null;

  return {
    id: `loggingStreak:${days}`,
    text: `${toPersianDigits(days)} روز پشت‌سرهم روزت را ثبت کرده‌ای.`,
    evidence: "/",
    strength: Math.min(1, days / 14),
  };
}

/**
 * Runs every pattern, drops nulls and anything under MIN_STRENGTH, sorts by strength descending.
 * Callers take as many as they need (e.g. the top 3 on /capital) — this never invents a
 * statement just to fill a slot; an empty result means there's nothing honest to say yet.
 */
export function buildIdentityStatements(ctx: IdentityContext): IdentityStatement[] {
  const results = [weeklyHoursOnSkill(ctx), consecutiveWeeksHabit(ctx), projectsCompletedSince(ctx), biggestThingBuilt(ctx), loggingStreak(ctx)];
  return results.filter((s): s is IdentityStatement => s !== null && s.strength >= MIN_STRENGTH).sort((a, b) => b.strength - a.strength);
}

// Pure selection logic for the Home page's DailyMomentCard — see src/lib/insights.ts's own
// header for the underlying "why" of variable reward scheduling. This file only decides WHICH of
// up to 4 already-computed candidates to show; it does no data fetching itself.
import { jalaliDateKey } from "./jalali";

export type DailyMomentType = "discovery" | "quote" | "onThisDay" | "milestone";

export interface DailyMomentCandidate {
  type: DailyMomentType;
  text: string;
  href?: string;
}

// Declared order doubles as the fallback walk order when a weighted pick lands on an
// unavailable type — see selectDailyMoment.
const TYPE_ORDER: DailyMomentType[] = ["discovery", "quote", "onThisDay", "milestone"];
const WEIGHTS: Record<DailyMomentType, number> = {
  discovery: 0.45,
  quote: 0.25,
  onThisDay: 0.15,
  milestone: 0.15,
};

function seededFraction(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  // MurmurHash3-style finalizer: a plain polynomial hash barely moves when only the *trailing*
  // characters differ (weighted by 31^0) — exactly the common case here, since consecutive Jalali
  // dates ("1405-06-12" -> "1405-06-13") differ only in their last digit. This mixing step gives
  // proper avalanche behavior so consecutive days land in well-distributed, unpredictable buckets.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return (hash % 10_000) / 10_000; // 0..1
}

function weightedStartIndex(seed: string): number {
  const target = seededFraction(seed) * TYPE_ORDER.reduce((s, t) => s + WEIGHTS[t], 0);
  let cumulative = 0;
  for (let i = 0; i < TYPE_ORDER.length; i++) {
    cumulative += WEIGHTS[TYPE_ORDER[i]];
    if (target < cumulative) return i;
  }
  return TYPE_ORDER.length - 1;
}

/**
 * Weighted-random pick over the 4 types (seeded, so deterministic for a given seed), falling
 * forward through the rest of TYPE_ORDER (wrapping once) when the chosen type has no candidate —
 * "کارت خالی یا placeholder هرگز نشان داده نشود": returns null only when NONE of the 4 have data.
 */
export function selectDailyMoment(candidates: Partial<Record<DailyMomentType, DailyMomentCandidate>>, seed: string): DailyMomentCandidate | null {
  const start = weightedStartIndex(seed);
  for (let i = 0; i < TYPE_ORDER.length; i++) {
    const type = TYPE_ORDER[(start + i) % TYPE_ORDER.length];
    const candidate = candidates[type];
    if (candidate) return candidate;
  }
  return null;
}

/** userId + Jalali date, distinct from insights.ts's own seed string (which has no suffix) so
 * the two independent selections (which insight, which moment TYPE) don't correlate. */
export function dailyMomentSeed(userId: string, now: Date): string {
  return `${userId}:${jalaliDateKey(now)}:moment`;
}

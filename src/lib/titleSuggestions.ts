export interface TitleUsageStat {
  title: string;
  count: number;
  lastUsedAt: string; // ISO datetime of the most recent use
}

export interface TitleSuggestion {
  title: string;
  count: number;
}

// How quickly a past title's relevance fades — short enough that a newly-started cluster of
// similar entries (e.g. a new project you just started logging time against) can out-rank an
// old, high-count one within about two weeks, long enough that something used yesterday still
// clearly outranks something used only once, in passing, an hour ago.
const RECENCY_HALF_LIFE_DAYS = 14;

/**
 * Ranks past Quick Capture titles for autocomplete. Frequency and recency both matter, blended
 * via a "frecency" score (the same idea browsers use for address-bar suggestions): log-scaled
 * count so a title used 20 times doesn't completely drown out one used 3 times, multiplied by an
 * exponential recency decay so something you've started doing again recently can outrank
 * something you did a lot of a long time ago but haven't touched since.
 *
 * When `query` is non-empty, only titles containing it (case-insensitive substring) are ranked —
 * live-filtering as the user types. An empty query ranks everything, giving a useful "things you
 * usually log" starting menu before they've typed anything at all.
 */
export function rankTitleSuggestions(candidates: TitleUsageStat[], query: string, now: Date, limit = 8): TitleSuggestion[] {
  const q = query.trim().toLowerCase();
  const matches = q ? candidates.filter((c) => c.title.toLowerCase().includes(q)) : candidates;

  return matches
    .map((c) => {
      const daysSinceUse = Math.max(0, (now.getTime() - new Date(c.lastUsedAt).getTime()) / 86_400_000);
      const recencyWeight = Math.exp(-daysSinceUse / RECENCY_HALF_LIFE_DAYS);
      const score = Math.log(1 + c.count) * recencyWeight;
      return { title: c.title, count: c.count, score };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ title, count }) => ({ title, count }));
}

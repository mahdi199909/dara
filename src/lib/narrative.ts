import { computeTimeCost } from "./timeCost";
import { phraseSpend, phraseHidden, phraseBuild } from "./phrasing";
import type { TimeAndMoneyReport, HiddenCostReport } from "./reportEngine";

/**
 * A three-act narrative for the reporting period, replacing the old seven-line accounting-table
 * dump. Render order is fixed (پرده ۱→۲→۳) per the pain→path→pride rule and is never
 * reordered by data: چه خرج کردی (pain) → چه پنهان بود (pain, surfaced) → چه ساختی (pride).
 * Any act with nothing real to report is simply omitted — never a fabricated placeholder.
 *
 * `topCategoryLifetimeMinutes` is the caller's job to fetch (see sumCategoryLifetimeMinutes in
 * reportEngine.ts / local/reportEngine.ts) for whichever category ends up being Act 3's subject
 * — this function stays pure (no DB access) so it can be unit-tested directly like everything
 * else phrasing-related.
 */
export function generateNarrative(report: TimeAndMoneyReport, hiddenCost: HiddenCostReport, topCategoryLifetimeMinutes: number): string {
  const acts: string[] = [];

  // پرده ۱ — چه خرج کردی: the period's single biggest time sink, whatever its kind.
  const topSpend = [...report.timeByCategory].sort((a, b) => b.minutes - a.minutes)[0];
  if (topSpend && topSpend.minutes > 0) {
    const tomans = computeTimeCost(topSpend.minutes, report.hourlyValue);
    acts.push(phraseSpend(topSpend.minutes, tomans, topSpend.name));
  }

  // پرده ۲ — چه پنهان بود: the single largest hidden-cost item, if the period has one at all.
  const topHidden = hiddenCost.items[0]; // already sorted by hiddenCost descending
  if (topHidden && topHidden.hiddenCost > 0) {
    acts.push(phraseHidden(topHidden.hiddenCost, topHidden.title));
  }

  // پرده ۳ — چه ساختی: the period's top PRODUCTIVE-category contribution, with its own
  // lifetime running total (not this period's total) — see phraseBuild's "جمعش الان" clause.
  const topBuild = [...report.timeByCategory].filter((c) => c.kind === "PRODUCTIVE").sort((a, b) => b.minutes - a.minutes)[0];
  if (topBuild && topBuild.minutes > 0) {
    acts.push(phraseBuild(topBuild.minutes, topBuild.name, topCategoryLifetimeMinutes));
  }

  return acts.join(" ");
}

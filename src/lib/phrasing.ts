// Centralized human copywriting for every numeric product sentence — "۳۲ ساعت" is a number,
// "۳۲ ساعت از عمرت را بابت این پرداخت کردی" is a feeling. See src/lib/narrative.ts for the
// three-act report narrative built from these; other call sites (notifications, cards) should
// route their own number-to-sentence text through here too rather than hand-rolling strings.
//
// Brand-word rule (see the product's global voice constraints): «پنهان» is reserved for exactly
// two moments — revealing a cost the user didn't account for, and revealing an asset they didn't
// know they'd built. phraseHidden and phraseBuild ARE those two moments, so they're the only
// functions here that use the word; phraseSpend and phraseCapital never do.
import { toPersianDigits, formatToman, formatDuration } from "./money";

/** "پرداخت" — a specific spend of time (and, when there's a real hourly rate, its Toman
 * equivalent) against one named thing. Omits the Toman clause entirely rather than showing
 * "۰ تومان" when the user has no hourly rate configured — a fabricated-looking zero is worse
 * than no number at all. */
export function phraseSpend(minutes: number, tomans: number, label: string): string {
  const duration = formatDuration(minutes);
  if (tomans > 0) {
    return `${duration} بابت «${label}» پرداخت کردی — معادل ${formatToman(tomans, { withSuffix: true })}.`;
  }
  return `${duration} بابت «${label}» پرداخت کردی.`;
}

/** "انباشت" — one of the two «پنهان» moments: time just added to a specific thing, framed as
 * feeding a hidden asset the user is quietly building, plus its running total. */
export function phraseBuild(minutes: number, label: string, totalMinutes: number): string {
  return `${formatDuration(minutes)} به دارایی پنهانت در «${label}» اضافه شد. جمعش الان ${formatDuration(totalMinutes)} است.`;
}

/** "هزینه پنهان" — the other «پنهان» moment: a cost that was sitting at zero in the user's own
 * accounting, with its real Toman cost surfaced. Callers should only invoke this when there's a
 * genuine hidden cost to reveal (tomans > 0) — a hidden cost of nothing isn't a real moment. */
export function phraseHidden(tomans: number, label: string): string {
  return `«${label}» در حسابت صفر ثبت شده بود؛ هزینه پنهانش ${formatToman(tomans, { withSuffix: true })} بود.`;
}

/** "سرمایه بنیان‌گذار" — the lifetime-accumulation headline (see computeFounderCapital). Extends
 * with a compact "· X مهارت · Y پروژه · Z دارایی" tail, but only the counts that are actually
 * non-zero — never claims a skill/project/asset count that isn't real. */
export function phraseCapital(minutes: number, counts: { skillCount: number; projectCount: number; assetCount: number }): string {
  const hours = toPersianDigits(Math.round(minutes / 60).toLocaleString("en-US"));
  const base = `از روز اول، ${hours} ساعت روی خودت سرمایه‌گذاری کرده‌ای`;

  const parts: string[] = [];
  if (counts.skillCount > 0) parts.push(`${toPersianDigits(counts.skillCount)} مهارت`);
  if (counts.projectCount > 0) parts.push(`${toPersianDigits(counts.projectCount)} پروژه`);
  if (counts.assetCount > 0) parts.push(`${toPersianDigits(counts.assetCount)} دارایی`);

  return parts.length === 0 ? `${base}.` : `${base} — ${parts.join(" و ")} ساخته‌ای.`;
}

// How the vision board shows and reads numbers: the person's own yardstick can be grams, pages,
// kilometres or millions of Toman, so these are plain decimal numbers rather than money.
import { toAsciiDigits, toPersianDigits } from "@/lib/money";

/** "۱۲٬۵" style: thousands grouped, at most two decimals, Persian digits. */
export function formatVisionValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return toPersianDigits(rounded.toLocaleString("en-US", { maximumFractionDigits: 2 }));
}

/** "۳۵٪" — a 0..1 ratio as a whole percentage. */
export function formatPercent(ratio: number): string {
  return `${toPersianDigits(Math.round(ratio * 100))}٪`;
}

/**
 * Reads what a person typed into a number field: Persian and Arabic digits, "٫" or "." as the decimal
 * mark, "," / "٬" as thousands separators, a leading minus. Returns null for anything else (empty,
 * letters, two decimal points) so the form can say "enter a number" instead of saving NaN.
 */
export function parseVisionNumber(text: string): number | null {
  const ascii = toAsciiDigits(text).replace(/[٬,\s]/g, "").replace(/٫/g, ".").replace(/[−–]/g, "-");
  if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(ascii)) return null;
  const n = Number(ascii);
  return Number.isFinite(n) ? n : null;
}

import { CURRENCY_UNIT_LABELS, type CurrencyUnit } from "./types";

/**
 * The largest single amount the app accepts, in Toman (999,999,999,999,999 ≈ 1e15). Money lives in
 * double-precision columns, exact for every integer up to 2^53 ≈ 9e15; this leaves room to add
 * thousands of maximal rows together without losing a Toman. Enforced by the zod schemas
 * (src/lib/schemas/money.ts) and by MoneyInput while typing.
 */
export const MAX_MONEY_TOMAN = 999_999_999_999_999;

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

// How many Toman one unit of each currency display unit is worth — 1 Toman = 10 Rial, and
// "هزار تومان" (thousand-Toman) is literally 1000 Toman, per the app's own definitions.
const UNIT_TOMAN_RATE: Record<CurrencyUnit, number> = {
  RIAL: 0.1,
  TOMAN: 1,
  THOUSAND_TOMAN: 1000,
};

/** Converts an integer Toman amount into the given display unit (may be fractional, e.g. Rial → Toman/1000). */
export function tomanToUnit(amountToman: number, unit: CurrencyUnit): number {
  return amountToman / UNIT_TOMAN_RATE[unit];
}

/** Converts a value entered in the given display unit back into integer Toman (rounded — Toman itself has no subunit). */
export function unitToToman(displayValue: number, unit: CurrencyUnit): number {
  return Math.round(displayValue * UNIT_TOMAN_RATE[unit]);
}

/**
 * Truncates a label to a fixed length with an ellipsis. Used before handing labels to
 * Recharts' category axes — its Text component auto-wraps long labels into multiple
 * `tspan` lines within the allotted axis width, which for longer Persian names renders as
 * a stack of broken word fragments rather than a clean single line.
 */
export function truncateLabel(text: string, maxLength = 16): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + "…";
}

/** Converts ASCII digits in a string/number to Persian digits for display. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** Converts Persian (and Arabic-Indic) digits in a string to ASCII digits. */
export function toAsciiDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/** Formats an integer Toman amount with thousands separators and Persian digits, e.g. 1500000 -> "۱,۵۰۰,۰۰۰". */
export function formatToman(amount: number, opts?: { persianDigits?: boolean; withSuffix?: boolean }): string {
  const persianDigits = opts?.persianDigits ?? true;
  const rounded = Math.round(amount);
  const formatted = rounded.toLocaleString("en-US");
  const withSuffix = opts?.withSuffix ? " تومان" : "";
  return (persianDigits ? toPersianDigits(formatted) : formatted) + withSuffix;
}

/**
 * Formats an integer Toman amount in the user's chosen display unit (Rial/Toman/Thousand-
 * Toman), with thousands separators and Persian digits — the unit-aware counterpart to
 * formatToman above. Thousand-Toman amounts can be fractional (e.g. 1,500 Toman = 1.5
 * thousand-Toman) so up to 1 decimal place is kept only when non-zero, never trailing ".0".
 */
export function formatMoney(amountToman: number, unit: CurrencyUnit, opts?: { persianDigits?: boolean; withSuffix?: boolean }): string {
  const persianDigits = opts?.persianDigits ?? true;
  const displayValue = tomanToUnit(amountToman, unit);
  const rounded = Math.round(displayValue * 10) / 10;
  const formatted = rounded.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const withSuffix = opts?.withSuffix ? ` ${CURRENCY_UNIT_LABELS[unit]}` : "";
  return (persianDigits ? toPersianDigits(formatted) : formatted) + withSuffix;
}

/** Formats a duration in minutes as a human string, e.g. 105 -> "1 ساعت و 45 دقیقه". */
export function formatDuration(minutes: number, opts?: { persianDigits?: boolean }): string {
  const persianDigits = opts?.persianDigits ?? true;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const p = (n: number) => (persianDigits ? toPersianDigits(n) : String(n));

  if (h === 0 && m === 0) return persianDigits ? "۰ دقیقه" : "0 دقیقه";
  if (h === 0) return `${p(m)} دقیقه`;
  if (m === 0) return `${p(h)} ساعت`;
  return `${p(h)} ساعت و ${p(m)} دقیقه`;
}

/** Two-unit short form for tight cards — "۴س ۴۰د", "۶س", "۴۰د" (never rounds, unlike compactDuration). */
export function shortDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${toPersianDigits(m)}د`;
  if (m === 0) return `${toPersianDigits(h)}س`;
  return `${toPersianDigits(h)}س ${toPersianDigits(m)}د`;
}

/** Compact duration for a small calendar cell — "۴۵د" or "۲.۵س", not the full "X ساعت و Y دقیقه". */
export function compactDuration(minutes: number): string {
  if (minutes < 60) return `${toPersianDigits(minutes)}د`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${toPersianDigits(hours)}س`;
}

/** Parses a free-form amount string (supports Persian digits, thousand separators, و "هزار"/"میلیون"/"میلیارد" suffixes) into an integer Toman value. Returns null if nothing parseable. */
export function parseAmount(raw: string): number | null {
  let s = toAsciiDigits(raw).trim();
  if (!s) return null;

  // e.g. "1.5 میلیون", "800 هزار", "2 میلیارد"
  const suffixMatch = s.match(/^([\d,.]+)\s*(میلیارد|میلیون|هزار)?/);
  if (!suffixMatch) return null;

  const numPart = suffixMatch[1].replace(/,/g, "");
  const num = parseFloat(numPart);
  if (Number.isNaN(num)) return null;

  const suffix = suffixMatch[2];
  let multiplier = 1;
  if (suffix === "هزار") multiplier = 1_000;
  else if (suffix === "میلیون") multiplier = 1_000_000;
  else if (suffix === "میلیارد") multiplier = 1_000_000_000;

  return Math.round(num * multiplier);
}

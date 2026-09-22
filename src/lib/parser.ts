import { toAsciiDigits, parseAmount } from "./money";

export type CaptureType = "TASK" | "ACTIVITY" | "EVENT" | "EXPENSE";

export interface ParsedCapture {
  title: string;
  durationMinutes: number | null;
  amount: number | null;
  date: Date | null;
  hasExplicitTime: boolean;
  categoryHint: string | null;
  /** A project name (or a fragment of one — "پروژه اتاق" for a project actually named "بازسازی
   * اتاق") pulled out of "پروژه ..." / "... برای پروژه ..." — fuzzy-matched against the person's
   * real projects by the caller (src/lib/smartCapture.ts), same "hint, not a fact" contract as
   * categoryHint. */
  projectHint: string | null;
  suggestedType: CaptureType;
}

const WEEKDAY_MAP: Record<string, number> = {
  "شنبه": 6,
  "یکشنبه": 0,
  "دوشنبه": 1,
  "سه شنبه": 2,
  "سه‌شنبه": 2,
  "چهارشنبه": 3,
  "پنجشنبه": 4,
  "جمعه": 5,
};

const WASTE_CATEGORY_KEYWORDS: Record<string, string> = {
  "اینستاگرام": "شبکه‌های اجتماعی",
  "instagram": "شبکه‌های اجتماعی",
  "یوتیوب": "شبکه‌های اجتماعی",
  "youtube": "شبکه‌های اجتماعی",
  "تلگرام": "شبکه‌های اجتماعی",
  "telegram": "شبکه‌های اجتماعی",
  "توییتر": "شبکه‌های اجتماعی",
  "twitter": "شبکه‌های اجتماعی",
  "ایکس": "شبکه‌های اجتماعی",
  "تیک تاک": "شبکه‌های اجتماعی",
  "تیک‌تاک": "شبکه‌های اجتماعی",
  "tiktok": "شبکه‌های اجتماعی",
  "فیسبوک": "شبکه‌های اجتماعی",
  "facebook": "شبکه‌های اجتماعی",
  "گیم": "سرگرمی",
  "گیمینگ": "سرگرمی",
  "gaming": "سرگرمی",
};

function stripMatch(text: string, match: RegExpMatchArray): string {
  return (text.slice(0, match.index) + " " + text.slice((match.index ?? 0) + match[0].length)).trim();
}

function extractDuration(text: string): { minutes: number; remaining: string } | null {
  // "۲ ساعت", "۲ ساعت و نیم", "۲ ساعت و ۱۵ دقیقه"
  let m = text.match(/(\d+(?:\.\d+)?)\s*ساعت(?:\s*و\s*(نیم|\d+\s*دقیقه))?/);
  if (m) {
    let minutes = Math.round(parseFloat(m[1]) * 60);
    if (m[2] === "نیم") minutes += 30;
    else if (m[2]) {
      const mm = m[2].match(/\d+/);
      if (mm) minutes += parseInt(mm[0], 10);
    }
    return { minutes, remaining: stripMatch(text, m) };
  }

  // latin "2h", "1.5h"
  m = text.match(/(\d+(?:\.\d+)?)\s*h\b/i);
  if (m) return { minutes: Math.round(parseFloat(m[1]) * 60), remaining: stripMatch(text, m) };

  // "۹۰ دقیقه"
  m = text.match(/(\d+(?:\.\d+)?)\s*دقیقه/);
  if (m) return { minutes: Math.round(parseFloat(m[1])), remaining: stripMatch(text, m) };

  // latin "90m"
  m = text.match(/(\d+(?:\.\d+)?)\s*m\b/i);
  if (m) return { minutes: Math.round(parseFloat(m[1])), remaining: stripMatch(text, m) };

  // "۱ روز"
  m = text.match(/(\d+(?:\.\d+)?)\s*روز/);
  if (m) return { minutes: Math.round(parseFloat(m[1]) * 24 * 60), remaining: stripMatch(text, m) };

  // latin "1d"
  m = text.match(/(\d+(?:\.\d+)?)\s*d\b/i);
  if (m) return { minutes: Math.round(parseFloat(m[1]) * 24 * 60), remaining: stripMatch(text, m) };

  return null;
}

// Both the written ("تومان") and the everyday-spoken ("تومن") spelling — someone typing a quick
// capture note types the way they'd say it out loud, and "تومن" is by far the more common of the two.
const TOMAN_WORD = /توم[ا]?ن/;

// Small spoken number-words that precede a scale word ("یک میلیون", "پنج هزار") — deliberately
// NOT the teens (یازده..نوزده): several of those share a leading substring with a smaller word in
// this same map ("دو" inside "دوازده", "سه" inside "سیزده"...), and without careful longest-match
// ordering that reads "دوازده میلیون" as "دو" + a stray "ازده". A spoken amount almost never needs
// a teen anyway ("دوازده میلیون" is rare next to "دوازده تا" for a count) — round tens cover the
// realistic range without that ambiguity.
const NUMBER_WORDS: Record<string, number> = {
  "یک": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5,
  "شش": 6, "هفت": 7, "هشت": 8, "نه": 9, "ده": 10,
  "بیست": 20, "سی": 30, "چهل": 40, "پنجاه": 50,
  "شصت": 60, "هفتاد": 70, "هشتاد": 80, "نود": 90, "صد": 100,
};
// Longest word first, so "بیست" is tried before any word it might otherwise partially collide
// with in the alternation — cheap insurance even though the current set has no real overlaps.
const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");

function extractAmount(text: string): { amount: number; remaining: string } | null {
  // Requires a scale word so it never collides with a bare duration number, e.g. "۱.۵ میلیون"
  let m = text.match(new RegExp(`(\\d+(?:[.,]\\d+)*)\\s*(میلیارد|میلیون|هزار)\\s*(${TOMAN_WORD.source})?`));
  if (m) {
    const amount = parseAmount(`${m[1]} ${m[2]}`);
    if (amount !== null) return { amount, remaining: stripMatch(text, m) };
  }

  // Spoken number-word + scale word, e.g. "یک میلیون", "پنج هزار تومن"
  m = text.match(new RegExp(`(${NUMBER_WORD_PATTERN})\\s*(میلیارد|میلیون|هزار)\\s*(${TOMAN_WORD.source})?`));
  if (m) {
    const amount = parseAmount(`${NUMBER_WORDS[m[1]]} ${m[2]}`);
    if (amount !== null) return { amount, remaining: stripMatch(text, m) };
  }

  // Comma-grouped numbers, e.g. "2,500,000"
  m = text.match(new RegExp(`(\\d{1,3}(?:,\\d{3})+)\\s*(${TOMAN_WORD.source})?`));
  if (m) {
    const amount = parseAmount(m[1]);
    if (amount !== null) return { amount, remaining: stripMatch(text, m) };
  }

  // Bare number explicitly tagged with تومان/تومن
  m = text.match(new RegExp(`(\\d+)\\s*${TOMAN_WORD.source}`));
  if (m) {
    const amount = parseAmount(m[1]);
    if (amount !== null) return { amount, remaining: stripMatch(text, m) };
  }

  return null;
}

function nextWeekday(now: Date, targetDay: number): Date {
  const result = new Date(now);
  const diff = (targetDay - now.getDay() + 7) % 7;
  result.setDate(now.getDate() + diff);
  return result;
}

function extractDate(text: string, now: Date): { date: Date; remaining: string } | null {
  let m = text.match(/پس\s*فردا|پس‌فردا/);
  if (m) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return { date: d, remaining: stripMatch(text, m) };
  }

  m = text.match(/فردا/);
  if (m) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { date: d, remaining: stripMatch(text, m) };
  }

  m = text.match(/دیروز/);
  if (m) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return { date: d, remaining: stripMatch(text, m) };
  }

  m = text.match(/امروز/);
  if (m) {
    return { date: new Date(now), remaining: stripMatch(text, m) };
  }

  for (const [word, dayIndex] of Object.entries(WEEKDAY_MAP)) {
    if (text.includes(word)) {
      const idx = text.indexOf(word);
      const fakeMatch = [word] as unknown as RegExpMatchArray;
      fakeMatch.index = idx;
      return { date: nextWeekday(now, dayIndex), remaining: stripMatch(text, fakeMatch) };
    }
  }

  return null;
}

function extractTime(text: string): { hour: number; minute: number; remaining: string } | null {
  let m = text.match(/ساعت\s*(\d{1,2})(?::(\d{2}))?/);
  if (m) {
    return {
      hour: parseInt(m[1], 10),
      minute: m[2] ? parseInt(m[2], 10) : 0,
      remaining: stripMatch(text, m),
    };
  }

  m = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10), remaining: stripMatch(text, m) };
  }

  return null;
}

function extractCategoryHint(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [keyword, category] of Object.entries(WASTE_CATEGORY_KEYWORDS)) {
    if (lower.includes(keyword.toLowerCase())) return category;
  }
  return null;
}

// "خرید" (purchase) is a strong enough signal to name its own category hint and be pulled out of
// the title — "خرید رنگ" reading as a bare title "رنگ" (paint) tagged هزینه/خرید is clearer than
// leaving the verb sitting in there. Unlike the WASTE_CATEGORY_KEYWORDS above (left in place —
// nothing asked for those to change), this one strips the matched word from the remaining text.
function extractPurchaseKeyword(text: string): { remaining: string } | null {
  const m = text.match(/خرید/);
  if (!m) return null;
  return { remaining: stripMatch(text, m) };
}

// "پروژه X" / "برای پروژه X" trailing the rest of the line, once everything else (duration,
// amount, date, time) has already been stripped out of it — a project mention reads as the last
// clause in every example this was built for ("خرید رنگ پروژه اتاق", "... برای پروژه بازسازی").
// The hint is fuzzy — it may be the project's exact name or just a fragment of it ("اتاق" for a
// project actually named "بازسازی اتاق") — src/lib/smartCapture.ts does the real matching once it
// has the person's actual project list.
function extractProjectHint(text: string): { hint: string; remaining: string } | null {
  const m = text.match(/(?:برای\s+)?پروژه[یِ‌]?\s+([^,،]+?)\s*$/);
  if (!m) return null;
  const hint = m[1].trim();
  if (!hint) return null;
  return { hint, remaining: stripMatch(text, m) };
}

function cleanTitle(text: string): string {
  return text
    .replace(/\s+و\s+/g, " ")
    .replace(/[،,]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseQuickCapture(rawInput: string, now: Date = new Date()): ParsedCapture {
  const normalized = toAsciiDigits(rawInput).trim();
  let remaining = normalized;

  const durationResult = extractDuration(remaining);
  if (durationResult) remaining = durationResult.remaining;

  const amountResult = extractAmount(remaining);
  if (amountResult) remaining = amountResult.remaining;

  const dateResult = extractDate(remaining, now);
  if (dateResult) remaining = dateResult.remaining;

  const timeResult = extractTime(remaining);
  if (timeResult) remaining = timeResult.remaining;

  // Project mention, then the "خرید" keyword — both read off what's left after every other
  // signal (duration/amount/date/time) is already stripped, and in that order: "خرید رنگ پروژه
  // اتاق" only reduces cleanly to "رنگ" if the trailing "پروژه اتاق" clause comes off first.
  const projectResult = extractProjectHint(remaining);
  if (projectResult) remaining = projectResult.remaining;

  const purchaseResult = extractPurchaseKeyword(remaining);
  if (purchaseResult) remaining = purchaseResult.remaining;

  let date: Date | null = null;
  const hasExplicitTime = !!timeResult;
  if (dateResult || timeResult) {
    date = dateResult ? new Date(dateResult.date) : new Date(now);
    if (timeResult) {
      date.setHours(timeResult.hour, timeResult.minute, 0, 0);
    } else {
      date.setHours(9, 0, 0, 0);
    }
  }

  // A WASTE keyword (اینستاگرام, یوتیوب, ...) is a more specific signal than the bare fact of a
  // purchase, so it wins if somehow both are present in the same line.
  const categoryHint = extractCategoryHint(normalized) ?? (purchaseResult ? "خرید" : null);
  const projectHint = projectResult?.hint ?? null;
  const title = cleanTitle(remaining) || "بدون عنوان";

  const durationMinutes = durationResult ? durationResult.minutes : null;
  const amount = amountResult ? amountResult.amount : null;

  let suggestedType: CaptureType;
  if (durationMinutes !== null && amount !== null) suggestedType = "ACTIVITY";
  else if (amount !== null) suggestedType = "EXPENSE";
  else if (date !== null) suggestedType = "EVENT"; // duration (if any) becomes the event length, not logged time
  else if (durationMinutes !== null) suggestedType = "ACTIVITY";
  else suggestedType = "TASK";

  return {
    title,
    durationMinutes,
    amount,
    date,
    hasExplicitTime,
    categoryHint,
    projectHint,
    suggestedType,
  };
}

// Text -> signals: the first half of "type a sentence, the app understands it". Pure and free of any
// clock, so the Android widget's native parser (android/.../QuickTextParser.java) can be an exact
// port of it and the two can be held to the same examples (src/lib/captureSignals.test.ts reads that
// Java file and checks every pattern in CAPTURE_GRAMMAR is spelled the same there).
//
// One line is either one of the entities the app has a screen for — a task / event / time log /
// expense / income (the default), an installment plan, paying an installment, a habit check-in, a new
// habit, a note, a savings goal, a project, a budget, a reminder — or, when nothing says otherwise, the
// plain entry the person meant. What decides is a leading keyword ("یادداشت ...", "عادت ...", "بودجه ...")
// or, for installments, the word «قسط» together with a count ("۱۲ ماهه") or a payment verb ("دادم") —
// never a guess from nothing. src/lib/captureIntent.ts gives the signals their meaning (dates, times of
// day, the entity), src/lib/captureResolve.ts finds what the words point at (which habit, which plan).
import { toAsciiDigits, parseAmount } from "./money";

export type SignalKind =
  | "ENTRY"
  | "INSTALLMENT_PLAN"
  | "INSTALLMENT_PAY"
  | "HABIT_CHECKIN"
  | "HABIT_CREATE"
  | "NOTE"
  | "SAVINGS_GOAL"
  | "PROJECT_CREATE"
  | "BUDGET"
  | "REMINDER";

/** A day named in words, kept as words: what day it is depends on the clock, which this file never reads. */
export type DaySignal =
  | { type: "REL"; offset: number } // 0 today, 1 tomorrow, 2 the day after, -1 yesterday, -2 the day before
  | { type: "WEEKDAY"; day: number } // JS getDay(): 0 Sunday .. 6 Saturday — the next such day, never today
  | { type: "JALALI"; jy: number | null; jm: number; jd: number }; // jy null = this Jalali year

export interface CaptureSignals {
  v: 2;
  kind: SignalKind;
  /** ENTRY/REMINDER: the cleaned title. NOTE: the text. HABIT_CREATE/PROJECT_CREATE: the name. Plans/goals: the name. */
  title: string;
  durationMinutes: number | null;
  /** Toman. ENTRY: the price or the income; plans: per installment or the whole (see perInstallment); goal/budget: the target/cap. */
  amount: number | null;
  /** ENTRY only: the amount came in (salary, sale ...) rather than going out. */
  income: boolean;
  day: DaySignal | null;
  time: { h: number; m: number } | null;
  categoryHint: string | null;
  projectHint: string | null;
  /** ENTRY: the line names a meeting/appointment, so it is an event even with no date. */
  eventCue: boolean;
  /** INSTALLMENT_PLAN: how many installments. */
  count: number | null;
  /** INSTALLMENT_PLAN: `amount` is what ONE installment costs (else it is the whole loan). */
  perInstallment: boolean;
  /** INSTALLMENT_PLAN: the day of the Jalali month each installment falls on, when the line named one. */
  dueDay: number | null;
  /** HABIT_CHECKIN / INSTALLMENT_PAY / BUDGET: the words that name the habit / plan / category. */
  hint: string | null;
}

// ---- grammar ------------------------------------------------------------------------------------
// Every pattern here is written to mean the same in JavaScript and in Java's regex (no lookbehind,
// no \b, no named groups), and is mirrored string for string in QuickTextParser.java.
export const CAPTURE_GRAMMAR = {
  /** Whitespace or a zero-width non-joiner (Persian writes «پس‌انداز» both with and without one). */
  SP: "[\\s\\u200c]",
  /** What may follow a leading keyword before its content. */
  SEP: "[\\s\\u200c:：\\-،,]",
  SCALE: "میلیارد|میلیون|هزار",
  TOMAN: "توم[ا]?ن",
  KW_NOTE: "یادداشت|نوت",
  KW_PROJECT_NEW: "پروژه(?:[\\s\\u200c]*ی)?[\\s\\u200c]*(?:جدید|تازه)",
  KW_HABIT_NEW: "عادت[\\s\\u200c]*(?:جدید|تازه)",
  KW_HABIT: "عادت",
  KW_BUDGET: "بودجه",
  KW_GOAL: "هدف(?:[\\s\\u200c]*گذاری)?",
  KW_REMINDER: "یادآوری|یادآور|یادم[\\s\\u200c]*(?:باشه|باشد|بنداز)|به[\\s\\u200c]*یادم[\\s\\u200c]*(?:بنداز|بیار)",
  KW_INSTALLMENT: "اقساط|قسط",
  KW_PAY: "پرداخت|پرداختم|دادم|زدم|واریز|کارسازی|تسویه",
  // Not «واریز» or «گرفتم»: both can as easily mean money going out («واریز کردم», «بلیط گرفتم»).
  KW_INCOME: "درآمد|دریافت|دریافتی|حقوق|فروختم|فروش|عیدی|پاداش|سود",
  KW_EVENT: "جلسه|رویداد|قرار[\\s\\u200c]*ملاقات|وقت[\\s\\u200c]*(?:دکتر|دندان|آرایشگاه)",
  KW_DONE: "انجام[\\s\\u200c]*(?:شد|دادم)|کردم|زدم|شد|✓|✔|✅|تیک",
  KW_TOTAL: "وام|کل|جمعا|جمعاً|مجموع|قیمت|ارزش",
  KW_PER_INSTALLMENT: "هر[\\s\\u200c]*ماه|ماهانه|ماهیانه|ماهی|قسطی",
  KW_PERIOD_LATE: "بعدازظهر|بعد[\\s\\u200c]*از[\\s\\u200c]*ظهر|عصر|شب",
  KW_PERIOD_ALL: "صبح|ظهر|بعدازظهر|بعد[\\s\\u200c]*از[\\s\\u200c]*ظهر|عصر|شب",
  MONTHS: "فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند",
} as const;

const G = CAPTURE_GRAMMAR;

const MONTH_NUMBER: Record<string, number> = {
  "فروردین": 1, "اردیبهشت": 2, "خرداد": 3, "تیر": 4, "مرداد": 5, "شهریور": 6,
  "مهر": 7, "آبان": 8, "آذر": 9, "دی": 10, "بهمن": 11, "اسفند": 12,
};

// Weekday names, longest first: «یکشنبه» contains «شنبه», so matching Saturday first would read every
// «X-شنبه» as Saturday and leave the rest of the word behind in the title.
const WEEKDAYS: Array<[string, number]> = [
  ["چهارشنبه", 3],
  ["پنج[\\s\\u200c]*شنبه", 4],
  ["سه[\\s\\u200c]*شنبه", 2],
  ["یک[\\s\\u200c]*شنبه", 0],
  ["دو[\\s\\u200c]*شنبه", 1],
  ["جمعه", 5],
  ["شنبه", 6],
];

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

// Small spoken number-words ("یک میلیون", "دو ساعت", "پنج هزار") — deliberately NOT the teens
// (یازده..نوزده): several share a leading substring with a smaller word here ("دو" inside "دوازده"),
// and a spoken amount almost never needs one. Hours of the clock do ("ساعت یازده"), see HOUR_WORDS.
export const NUMBER_WORDS: Record<string, number> = {
  "یک": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5,
  "شش": 6, "هفت": 7, "هشت": 8, "نه": 9, "ده": 10,
  "بیست": 20, "سی": 30, "چهل": 40, "پنجاه": 50,
  "شصت": 60, "هفتاد": 70, "هشتاد": 80, "نود": 90, "صد": 100,
};
const HOUR_WORDS: Record<string, number> = {
  "یک": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5, "شش": 6, "هفت": 7, "هشت": 8, "نه": 9, "ده": 10, "یازده": 11, "دوازده": 12,
};
const byLength = (a: string, b: string) => b.length - a.length;
const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).sort(byLength).join("|");
const HOUR_WORD_PATTERN = Object.keys(HOUR_WORDS).sort(byLength).join("|");

// A word starts here: the beginning of the text, or after whitespace / a zero-width joiner. Captured as
// group 1 of every pattern that uses it, so the match can be trimmed back to the word itself.
const WORD_START = "(^|[\\s\\u200c])";
// «میلیونی», «تومانی»: the possessive ی glued to an amount — part of the amount, never of the title.
const YA = "(ی(?=[\\s.,،؛:!?؟)]|$))?";

function strip(text: string, start: number, end: number): string {
  return (text.slice(0, start) + " " + text.slice(end)).trim();
}

// Non-breaking and other typographic spaces (written as escapes: the editor would turn them into the characters themselves).
const EXOTIC_SPACES = new RegExp("[\\u00a0\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]", "g");
// Direction marks and spaces a keyboard or a paste can put in front of a line.
const LEADING_MARKS = new RegExp("^[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069\\s]+");

/** Digits to ASCII, look-alike Arabic letters to Persian, exotic spaces to a plain one — one character in, one out. */
function normalize(text: string): string {
  return toAsciiDigits(text)
    .replace(EXOTIC_SPACES, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");
}


interface Extracted<T> {
  value: T;
  remaining: string;
}

function extractDuration(text: string): Extracted<number> | null {
  let m: RegExpMatchArray | null;

  // «نیم ساعت», «ربع ساعت»
  m = text.match(new RegExp(`${WORD_START}(نیم|ربع)${G.SP}*ساعت`));
  if (m) {
    const start = (m.index ?? 0) + m[1].length;
    return { value: m[2] === "نیم" ? 30 : 15, remaining: strip(text, start, (m.index ?? 0) + m[0].length) };
  }

  // «۲ ساعت», «۲ ساعت و نیم», «۲ ساعت و ربع», «۲ ساعت و ۱۵ دقیقه»
  m = text.match(/(\d+(?:\.\d+)?)\s*ساعت(?:\s*و\s*(نیم|ربع|\d+\s*دقیقه))?/);
  if (m) {
    let minutes = Math.round(parseFloat(m[1]) * 60);
    if (m[2] === "نیم") minutes += 30;
    else if (m[2] === "ربع") minutes += 15;
    else if (m[2]) {
      const mm = m[2].match(/\d+/);
      if (mm) minutes += parseInt(mm[0], 10);
    }
    return { value: minutes, remaining: strip(text, m.index ?? 0, (m.index ?? 0) + m[0].length) };
  }

  // «دو ساعت», «دو ساعت و نیم», «ده دقیقه»
  m = text.match(new RegExp(`${WORD_START}(${NUMBER_WORD_PATTERN})${G.SP}*ساعت(?:${G.SP}*و${G.SP}*(نیم|ربع))?`));
  if (m) {
    let minutes = NUMBER_WORDS[m[2]] * 60;
    if (m[3] === "نیم") minutes += 30;
    else if (m[3] === "ربع") minutes += 15;
    return { value: minutes, remaining: strip(text, (m.index ?? 0) + m[1].length, (m.index ?? 0) + m[0].length) };
  }
  m = text.match(new RegExp(`${WORD_START}(${NUMBER_WORD_PATTERN})${G.SP}*دقیقه`));
  if (m) return { value: NUMBER_WORDS[m[2]], remaining: strip(text, (m.index ?? 0) + m[1].length, (m.index ?? 0) + m[0].length) };

  m = text.match(/(\d+(?:\.\d+)?)\s*h\b/i);
  if (m) return { value: Math.round(parseFloat(m[1]) * 60), remaining: strip(text, m.index ?? 0, (m.index ?? 0) + m[0].length) };

  m = text.match(/(\d+(?:\.\d+)?)\s*دقیقه/);
  if (m) return { value: Math.round(parseFloat(m[1])), remaining: strip(text, m.index ?? 0, (m.index ?? 0) + m[0].length) };

  m = text.match(/(\d+(?:\.\d+)?)\s*m\b/i);
  if (m) return { value: Math.round(parseFloat(m[1])), remaining: strip(text, m.index ?? 0, (m.index ?? 0) + m[0].length) };

  m = text.match(/(\d+(?:\.\d+)?)\s*روز/);
  if (m) return { value: Math.round(parseFloat(m[1]) * 24 * 60), remaining: strip(text, m.index ?? 0, (m.index ?? 0) + m[0].length) };

  m = text.match(/(\d+(?:\.\d+)?)\s*d\b/i);
  if (m) return { value: Math.round(parseFloat(m[1]) * 24 * 60), remaining: strip(text, m.index ?? 0, (m.index ?? 0) + m[0].length) };

  return null;
}

interface AmountMatch {
  amount: number;
  remaining: string;
  /** The amount was written «X ی» — «یک میلیونی», «۵۰۰ هزار تومانی»: what ONE of something costs. */
  possessive: boolean;
}

// Money always has a mark that says so — a scale word (میلیون, هزار, میلیارد), the currency word, a
// comma-grouped number, or a plain number of five digits or more — so it never collides with a bare
// duration or count like the «۲» in «۲ ساعت».
function extractAmount(text: string): AmountMatch | null {
  const found = (m: RegExpMatchArray, amount: number | null, yaGroup: number, prefix = 0): AmountMatch | null => {
    if (amount === null) return null;
    const start = (m.index ?? 0) + prefix;
    return { amount, remaining: strip(text, start, (m.index ?? 0) + m[0].length), possessive: Boolean(m[yaGroup]) };
  };

  let m = text.match(new RegExp(`(\\d+(?:[.,]\\d+)*)\\s*(${G.SCALE})\\s*(${G.TOMAN})?${YA}`));
  if (m) {
    const hit = found(m, parseAmount(`${m[1]} ${m[2]}`), 4);
    if (hit) return hit;
  }

  m = text.match(new RegExp(`${WORD_START}(${NUMBER_WORD_PATTERN})\\s*(${G.SCALE})\\s*(${G.TOMAN})?${YA}`));
  if (m) {
    const hit = found(m, parseAmount(`${NUMBER_WORDS[m[2]]} ${m[3]}`), 5, m[1].length);
    if (hit) return hit;
  }

  m = text.match(new RegExp(`(\\d{1,3}(?:,\\d{3})+)\\s*(${G.TOMAN})?${YA}`));
  if (m) {
    const hit = found(m, parseAmount(m[1]), 3);
    if (hit) return hit;
  }

  m = text.match(new RegExp(`(\\d+)\\s*${G.TOMAN}${YA}`));
  if (m) {
    const hit = found(m, parseAmount(m[1]), 2);
    if (hit) return hit;
  }

  m = text.match(new RegExp(`${WORD_START}(\\d{5,})(?=[\\s]|$)`));
  if (m) {
    const hit = found(m, parseAmount(m[2]), 99, m[1].length);
    if (hit) return hit;
  }

  return null;
}

function extractDay(text: string): Extracted<DaySignal> | null {
  const rel: Array<[string, number]> = [
    ["پس[\\s\\u200c]*فردا", 2],
    ["فردا", 1],
    ["دیروز", -1],
    ["پریروز", -2],
    ["امروز", 0],
  ];
  for (const [word, offset] of rel) {
    const m = text.match(new RegExp(`${WORD_START}(?:${word})(?=${G.SP}|[.,،؛:!?؟)]|$)`));
    if (m) return { value: { type: "REL", offset }, remaining: strip(text, (m.index ?? 0) + m[1].length, (m.index ?? 0) + m[0].length) };
  }

  // «۱۴۰۵/۰۷/۲۵», «1405-7-25» — a Jalali date; a year like 2026 is left for a Gregorian one.
  let m = text.match(/(^|[^\d])(1[34]\d\d)[/-](\d{1,2})[/-](\d{1,2})(?![\d])/);
  if (m) {
    const jm = parseInt(m[3], 10);
    const jd = parseInt(m[4], 10);
    if (jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31) {
      return { value: { type: "JALALI", jy: parseInt(m[2], 10), jm, jd }, remaining: strip(text, (m.index ?? 0) + m[1].length, (m.index ?? 0) + m[0].length) };
    }
  }

  // «۲۵ مهر», «۲۵ مهر ۱۴۰۵», «۲۵ام مهر ماه»
  m = text.match(new RegExp(`${WORD_START}(\\d{1,2})${G.SP}*(?:ام${G.SP}+)?(${G.MONTHS})(?:${G.SP}+ماه)?(?:${G.SP}+(1[34]\\d\\d))?(?=${G.SP}|[.,،؛:!?؟)]|$)`));
  if (m) {
    const jd = parseInt(m[2], 10);
    if (jd >= 1 && jd <= 31) {
      const jy = m[4] ? parseInt(m[4], 10) : null;
      return { value: { type: "JALALI", jy, jm: MONTH_NUMBER[m[3]], jd }, remaining: strip(text, (m.index ?? 0) + m[1].length, (m.index ?? 0) + m[0].length) };
    }
  }

  for (const [word, day] of WEEKDAYS) {
    const wm = text.match(new RegExp(`${WORD_START}(?:${word})(?=${G.SP}|[.,،؛:!?؟)]|$)`));
    if (wm) return { value: { type: "WEEKDAY", day }, remaining: strip(text, (wm.index ?? 0) + wm[1].length, (wm.index ?? 0) + wm[0].length) };
  }

  return null;
}

/** Moves an hour into the period of the day the person named: «۵ عصر» is 17, «۱۱ شب» is 23, «۱ ظهر» is 13. */
function hourInPeriod(h: number, period: string | undefined): number {
  if (!period) return h;
  if (new RegExp(`^(?:${G.KW_PERIOD_LATE})$`).test(period)) {
    if (/^شب$/.test(period)) return h >= 6 && h < 12 ? h + 12 : h === 12 ? 0 : h;
    return h < 12 ? h + 12 : h;
  }
  if (period === "ظهر") return h >= 1 && h <= 5 ? h + 12 : h;
  return h;
}

function extractTime(text: string): Extracted<{ h: number; m: number }> | null {
  const period = `(${G.KW_PERIOD_ALL})`;
  let m: RegExpMatchArray | null;

  // «ساعت ۱۰», «ساعت ۱۰:۳۰», «ساعت ۵ و نیم», «ساعت ۵ عصر», «عصر ساعت ۵»
  m = text.match(new RegExp(`(?:${period}${G.SP}*)?ساعت${G.SP}*(\\d{1,2})(?![\\d])(?::(\\d{2}))?(?:${G.SP}*و${G.SP}*(نیم|ربع))?(?:${G.SP}*${period})?`));
  if (m) {
    const h = parseInt(m[2], 10);
    let min = m[3] ? parseInt(m[3], 10) : 0;
    if (m[4] === "نیم") min = 30;
    else if (m[4] === "ربع") min = 15;
    if (h <= 24 && min < 60) {
      return { value: { h: hourInPeriod(h, m[1] ?? m[5]) % 24, m: min }, remaining: strip(text, m.index ?? 0, (m.index ?? 0) + m[0].length) };
    }
  }

  // «ساعت ده», «ساعت دوازده و نیم»
  m = text.match(new RegExp(`(?:${period}${G.SP}*)?ساعت${G.SP}*(${HOUR_WORD_PATTERN})(?:${G.SP}*و${G.SP}*(نیم|ربع))?(?:${G.SP}*${period})?`));
  if (m) {
    const h = HOUR_WORDS[m[2]];
    const min = m[3] === "نیم" ? 30 : m[3] === "ربع" ? 15 : 0;
    return { value: { h: hourInPeriod(h, m[1] ?? m[4]) % 24, m: min }, remaining: strip(text, m.index ?? 0, (m.index ?? 0) + m[0].length) };
  }

  // «10:00»
  m = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h <= 24 && min < 60) {
      let end = (m.index ?? 0) + m[0].length;
      const tail = text.slice(end).match(new RegExp(`^${G.SP}*${period}`));
      const value = { h: hourInPeriod(h, tail?.[1]) % 24, m: min };
      if (tail) end += tail[0].length;
      return { value, remaining: strip(text, m.index ?? 0, end) };
    }
  }

  // «۵ عصر» — an hour with no «ساعت» before it but the period after it
  m = text.match(new RegExp(`${WORD_START}(\\d{1,2})${G.SP}*${period}`));
  if (m) {
    const h = parseInt(m[2], 10);
    if (h >= 1 && h <= 12) return { value: { h: hourInPeriod(h, m[3]) % 24, m: 0 }, remaining: strip(text, (m.index ?? 0) + m[1].length, (m.index ?? 0) + m[0].length) };
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

// «خرید» names its own category hint and comes out of the title: «خرید رنگ» reads as «رنگ», tagged خرید.
function extractPurchaseKeyword(text: string): { remaining: string } | null {
  const m = text.match(/خرید/);
  if (!m) return null;
  return { remaining: strip(text, m.index ?? 0, (m.index ?? 0) + m[0].length) };
}

// «پروژه X» / «برای پروژه X» / «از پروژه X» trailing the line, once everything else is out of it. The hint
// may be the project's whole name or a fragment ("اتاق" for «بازسازی اتاق»); captureResolve matches it.
function extractProjectHint(text: string): { hint: string; remaining: string } | null {
  const m = text.match(new RegExp(`(?:${WORD_START}(?:برای|از|توی|در|واسه)${G.SP}+)?پروژه[ی\\u0650\\u200c]?${G.SP}+([^,،]+?)\\s*$`));
  if (!m) return null;
  const hint = m[2].trim();
  if (!hint) return null;
  return { hint, remaining: strip(text, m.index ?? 0, (m.index ?? 0) + m[0].length) };
}

function cleanTitle(text: string): string {
  return text
    .replace(/\s+و\s+/g, " ")
    .replace(/[،,]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(new RegExp(`(?:${G.SP}+(?:از|برای|به|در|توی|واسه|با))+$`), "")
    .replace(new RegExp(`(?:${G.SP}+(?:انجام${G.SP}+دادم|انجام${G.SP}+شد|کردم))+$`), "")
    .trim();
}

function blankSignals(kind: SignalKind): CaptureSignals {
  return {
    v: 2,
    kind,
    title: "",
    durationMinutes: null,
    amount: null,
    income: false,
    day: null,
    time: null,
    categoryHint: null,
    projectHint: null,
    eventCue: false,
    count: null,
    perInstallment: false,
    dueDay: null,
    hint: null,
  };
}

function has(text: string, pattern: string): boolean {
  return new RegExp(`${WORD_START}(?:${pattern})(?=${G.SP}|[.,،؛:!?؟)]|$)`).test(text);
}

/** The words of `text` with the filler a hint should not carry («رو», «را», the verbs) taken out. */
function hintFrom(text: string, extraPatterns: string[]): string {
  let out = text;
  for (const p of extraPatterns) out = out.replace(new RegExp(`${WORD_START}(?:${p})(?=${G.SP}|[.,،؛:!?؟)]|$)`, "g"), "$1 ");
  return out.replace(/[،,:：\-]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

const FILLER = ["رو", "را", "این", "امروز", "دیروز", "فردا", "هم", "ام", "کردم", "شد"];

interface LeadingKeyword {
  /** What follows the keyword, index-aligned with the original text (see extractSignals). */
  restFrom: number;
}

function leading(text: string, keyword: string): LeadingKeyword | null {
  const m = text.match(new RegExp(`^(?:${keyword})(?=${G.SEP}|$)`));
  if (!m) return null;
  const rest = text.slice(m[0].length).match(new RegExp(`^${G.SEP}*`));
  return { restFrom: m[0].length + (rest ? rest[0].length : 0) };
}

// ENTRY's own extraction — duration, amount, day, time, project, «خرید» — in the order that lets each
// take its words out before the next looks: «۲ ساعت ۱ میلیون شکلات» must not read the «۲» as money.
function extractEntry(text: string, kind: "ENTRY" | "REMINDER"): CaptureSignals {
  const s = blankSignals(kind);
  let remaining = text;

  const duration = extractDuration(remaining);
  if (duration) {
    s.durationMinutes = duration.value;
    remaining = duration.remaining;
  }

  const amount = extractAmount(remaining);
  if (amount) {
    s.amount = amount.amount;
    remaining = amount.remaining;
  }

  const day = extractDay(remaining);
  if (day) {
    s.day = day.value;
    remaining = day.remaining;
  }

  const time = extractTime(remaining);
  if (time) {
    s.time = time.value;
    remaining = time.remaining;
  }

  const project = extractProjectHint(remaining);
  if (project) {
    s.projectHint = project.hint;
    remaining = project.remaining;
  }

  const purchase = extractPurchaseKeyword(remaining);
  if (purchase) remaining = purchase.remaining;

  // A WASTE keyword (اینستاگرام, ...) is a more specific signal than the bare fact of a purchase.
  s.categoryHint = extractCategoryHint(text) ?? (purchase ? "خرید" : null);
  s.income = s.amount !== null && has(text, G.KW_INCOME);
  s.eventCue = has(text, G.KW_EVENT);
  s.title = cleanTitle(remaining) || (kind === "REMINDER" ? "یادآوری" : "بدون عنوان");
  return s;
}

/** The line read as a plain entry whatever it starts with — also the way out when a keyword guess was wrong. */
export function extractEntrySignals(raw: string): CaptureSignals {
  return extractEntry(normalize(raw.replace(LEADING_MARKS, "")).trim(), "ENTRY");
}

/**
 * Reads one typed line. `raw` is what the person typed (any digits, any keyboard); everything is
 * looked for in a normalised copy of the same length, so a note can be cut from the original and keep
 * the digits as they were typed.
 */
export function extractSignals(raw: string): CaptureSignals {
  // No leading whitespace survives LEADING_MARKS and normalize() never changes a length, so index i of
  // `t` is index i of `original` — trimming only ever cuts the end.
  const original = raw.replace(LEADING_MARKS, "");
  const t = normalize(original).trim();

  // -- keyword-led lines ------------------------------------------------------------------------
  let k = leading(t, G.KW_NOTE);
  if (k) {
    let content = original.slice(k.restFrom).trim();
    const s = blankSignals("NOTE");
    const dayWord = content.match(/^(دیروز|پریروز)\s*[:：]\s*/);
    if (dayWord) {
      s.day = { type: "REL", offset: dayWord[1] === "دیروز" ? -1 : -2 };
      content = content.slice(dayWord[0].length).trim();
    }
    if (content) {
      s.title = content;
      return s;
    }
  }

  k = leading(t, G.KW_PROJECT_NEW);
  if (k) {
    const name = t.slice(k.restFrom).replace(/\s{2,}/g, " ").trim();
    if (name) return { ...blankSignals("PROJECT_CREATE"), title: name };
  }

  k = leading(t, G.KW_HABIT_NEW);
  if (k) {
    const title = t.slice(k.restFrom).replace(/\s{2,}/g, " ").trim();
    if (title) return { ...blankSignals("HABIT_CREATE"), title };
  }

  k = leading(t, G.KW_HABIT);
  if (k) {
    const rest = t.slice(k.restFrom);
    // Only today can be ticked off: a check-in is a toggle, and yesterday's state is not known here.
    if (!has(rest, "دیروز|پریروز|فردا|پس[\\s\\u200c]*فردا")) {
      const hint = hintFrom(rest, [G.KW_DONE, ...FILLER]);
      if (hint) return { ...blankSignals("HABIT_CHECKIN"), hint };
    }
  }

  k = leading(t, G.KW_BUDGET);
  if (k) {
    const rest = t.slice(k.restFrom);
    const amount = extractAmount(rest);
    if (amount) {
      const hint = hintFrom(amount.remaining, ["ماهانه", "ماهیانه", "هر[\\s\\u200c]*ماه", "ماهی", "سقف", G.TOMAN]);
      if (hint) return { ...blankSignals("BUDGET"), hint, amount: amount.amount };
    }
  }

  k = leading(t, G.KW_GOAL);
  if (k) {
    const rest = t.slice(k.restFrom);
    const amount = extractAmount(rest);
    if (amount) {
      const title = hintFrom(amount.remaining, ["پس[\\s\\u200c]*انداز", "به[\\s\\u200c]*مبلغ", "مبلغ", G.TOMAN]);
      return { ...blankSignals("SAVINGS_GOAL"), title: title || "هدف پس‌انداز", amount: amount.amount };
    }
  }

  k = leading(t, G.KW_REMINDER);
  if (k) {
    const s = extractEntry(t.slice(k.restFrom), "REMINDER");
    s.income = false;
    s.eventCue = false;
    return s;
  }

  // -- installments -----------------------------------------------------------------------------
  // A plan is a count («۱۲ قسط», «۱۲ ماهه») and an amount, in a line that is about installments: it has the
  // word «قسط»/«وام», or the count is written «۱۲ ماهه». Paying one is the word «قسط» with a payment verb.
  const count = t.match(new RegExp(`(\\d{1,3})${G.SP}*(?:تا${G.SP}*)?(?:قسط(?:ی)?|ماهه|ماه)(?=${G.SP}|[.,،؛:!?؟)]|$)`));
  const aboutInstallments = has(t, G.KW_INSTALLMENT) || has(t, "وام") || (count !== null && /قسط|ماهه/.test(count[0]));
  if (count && aboutInstallments) {
    const n = parseInt(count[1], 10);
    const withoutCount = strip(t, count.index ?? 0, (count.index ?? 0) + count[0].length);
    const amount = extractAmount(withoutCount);
    if (amount && n >= 1 && n <= 360) {
      let rest = amount.remaining;
      const s = blankSignals("INSTALLMENT_PLAN");
      s.count = n;
      s.amount = amount.amount;

      // «هر ماه روز ۵», «روز ۵ هر ماه», «سررسید ۵» — the day of the month, not a price per month: it comes out of
      // the line before the line's cues («هر ماه») are read.
      const dueDayPattern = new RegExp(`(?:روز|سررسید)${G.SP}*(\\d{1,2})(?:${G.SP}*ام)?(?:${G.SP}*هر${G.SP}*ماه)?`);
      let cues = t;
      const dueInLine = t.match(dueDayPattern);
      if (dueInLine) {
        const d = parseInt(dueInLine[1], 10);
        if (d >= 1 && d <= 31) {
          s.dueDay = d;
          cues = strip(t, dueInLine.index ?? 0, (dueInLine.index ?? 0) + dueInLine[0].length);
          const dueInRest = rest.match(dueDayPattern);
          if (dueInRest) rest = strip(rest, dueInRest.index ?? 0, (dueInRest.index ?? 0) + dueInRest[0].length);
        }
      }

      // Is the amount what ONE installment costs, or the whole thing? «۵ میلیونی», «هر ماه ۵ میلیون», «قسطی ۵
      // میلیون» and «قسط وام ۵ میلیون» (there «قسط» is the thing being priced) are per installment. Otherwise the
      // way the count is written decides: «۱۲ قسط ۵ میلیون» is twelve of them at 5 million unless the line calls
      // the amount the loan («وام ۶۰ میلیون ۱۲ قسط»); «۱۲ ماهه» is the length of a plan, so «لپ‌تاپ ۳۶ میلیون
      // ۱۲ ماهه» is 36 million in all.
      const pricedAsInstallment = amount.possessive || has(cues, G.KW_PER_INSTALLMENT) || has(withoutCount, G.KW_INSTALLMENT);
      const countedInInstallments = /قسط/.test(count[0]);
      s.perInstallment = pricedAsInstallment || (countedInInstallments && !has(cues, G.KW_TOTAL));

      const title = hintFrom(rest, [G.KW_PER_INSTALLMENT, "ثبت", "اضافه", "کن", "بساز", "جدید", G.TOMAN]);
      s.title = title.replace(/^(?:اقساط|قسط)$/, "") || "قسط";
      return s;
    }
  }

  if (has(t, G.KW_INSTALLMENT)) {
    if (has(t, G.KW_PAY)) {
      const s = blankSignals("INSTALLMENT_PAY");
      const amount = extractAmount(t);
      const base = amount ? amount.remaining : t;
      s.hint = hintFrom(base, [G.KW_INSTALLMENT, G.KW_PAY, "کردم", "کرد", "شد", "ثبت", "کن", ...FILLER]);
      return s;
    }
  }

  // -- everything else: one entry ---------------------------------------------------------------
  return extractEntry(t, "ENTRY");
}

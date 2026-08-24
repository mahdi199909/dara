import { toAsciiDigits, parseAmount } from "./money";

export type CaptureType = "TASK" | "ACTIVITY" | "EVENT" | "EXPENSE";

export interface ParsedCapture {
  title: string;
  durationMinutes: number | null;
  amount: number | null;
  date: Date | null;
  hasExplicitTime: boolean;
  categoryHint: string | null;
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

function extractAmount(text: string): { amount: number; remaining: string } | null {
  // Requires a scale word so it never collides with a bare duration number, e.g. "۱.۵ میلیون"
  let m = text.match(/(\d+(?:[.,]\d+)*)\s*(میلیارد|میلیون|هزار)\s*(تومان)?/);
  if (m) {
    const amount = parseAmount(`${m[1]} ${m[2]}`);
    if (amount !== null) return { amount, remaining: stripMatch(text, m) };
  }

  // Comma-grouped numbers, e.g. "2,500,000"
  m = text.match(/(\d{1,3}(?:,\d{3})+)\s*(تومان)?/);
  if (m) {
    const amount = parseAmount(m[1]);
    if (amount !== null) return { amount, remaining: stripMatch(text, m) };
  }

  // Bare number explicitly tagged with تومان
  m = text.match(/(\d+)\s*تومان/);
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

  const categoryHint = extractCategoryHint(normalized);
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
    suggestedType,
  };
}

import jalaali from "jalaali-js";
import { toPersianDigits } from "./money";

const WEEKDAYS_FA = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
const MONTHS_FA = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

export interface JalaliDate {
  jy: number;
  jm: number; // 1-12
  jd: number;
}

export function toJalali(date: Date): JalaliDate {
  const { jy, jm, jd } = jalaali.toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return { jy, jm, jd };
}

export function fromJalali(jy: number, jm: number, jd: number): Date {
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);
  return new Date(gy, gm - 1, gd);
}

/** Formats a Date as a Jalali date string, e.g. "۱۴۰۵/۰۵/۰۲" or with time "۱۴۰۵/۰۵/۰۲ - ۱۴:۲۰". */
export function formatJalali(date: Date, opts?: { withTime?: boolean; withWeekday?: boolean; long?: boolean }): string {
  const { jy, jm, jd } = toJalali(date);
  const pad = (n: number) => String(n).padStart(2, "0");

  let out: string;
  if (opts?.long) {
    out = `${jd} ${MONTHS_FA[jm - 1]} ${jy}`;
  } else {
    out = `${jy}/${pad(jm)}/${pad(jd)}`;
  }

  if (opts?.withWeekday) {
    out = `${WEEKDAYS_FA[date.getDay()]} ${out}`;
  }

  if (opts?.withTime) {
    const hh = pad(date.getHours());
    const mm = pad(date.getMinutes());
    out += ` - ${hh}:${mm}`;
  }

  return toPersianDigits(out);
}

export function formatJalaliMonthYear(date: Date): string {
  const { jy, jm } = toJalali(date);
  return toPersianDigits(`${MONTHS_FA[jm - 1]} ${jy}`);
}

export function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return toPersianDigits(`${pad(date.getHours())}:${pad(date.getMinutes())}`);
}

/** Returns the Gregorian start/end Date of a Jalali month (for calendar month view + reports). */
export function jalaliMonthRange(jy: number, jm: number): { start: Date; end: Date } {
  const start = fromJalali(jy, jm, 1);
  const daysInMonth = jalaali.jalaaliMonthLength(jy, jm);
  const end = fromJalali(jy, jm, daysInMonth);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function weekdayNameFa(date: Date): string {
  return WEEKDAYS_FA[date.getDay()];
}

export { MONTHS_FA, WEEKDAYS_FA };

// How numbers, clock times and durations are said in a Persian sentence: «ساعت ۹ و نیم صبح», «حدود دو ساعت و
// ربع», «سه کار» — the way a person tells their own day, not the way a table prints it (۰۹:۳۰, ۱۳۵ دقیقه).
// Pure and dependency-free apart from the digit converter, so the story engine can be tested on its own.
import { toPersianDigits } from "./money";

const WORDS = ["صفر", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه", "ده", "یازده", "دوازده"];

/** 0–12 in words («سه»), anything larger in Persian digits («۱۷») — how a count reads inside a sentence. */
export function faCount(n: number): string {
  const rounded = Math.round(n);
  return rounded >= 0 && rounded < WORDS.length ? WORDS[rounded] : toPersianDigits(rounded);
}

/** «الف»؛ «الف و ب»؛ «الف، ب و ج». */
export function joinFa(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join("، ")} و ${items[items.length - 1]}`;
}

/**
 * «عنوان» in Persian guillemets — the one way a person's own words (a task, a project) are set inside the narration.
 * Guillemets already inside the words are dropped: a project called «نی» would otherwise come out as «کیت «نی»», and a
 * reader cannot tell where the quotation ends.
 */
export function quote(text: string): string {
  return `«${text.replace(/[«»]/g, "")}»`;
}

/** Collapses whitespace and trims — titles arrive with stray spaces and line breaks. */
export function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A stable 32-bit hash (FNV-1a) — how the narrator varies its wording from day to day without ever varying it between renders. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One of `options`, chosen by `seed` — the same seed always gives the same one. */
export function pickBySeed<T>(options: readonly T[], seed: string): T {
  return options[hash32(seed) % options.length];
}

export type PartOfDay = "بامداد" | "صبح" | "ظهر" | "بعدازظهر" | "عصر" | "شب";

export function partOfDay(hour: number): PartOfDay {
  if (hour < 5) return "بامداد";
  if (hour < 12) return "صبح";
  if (hour < 13) return "ظهر";
  if (hour < 17) return "بعدازظهر";
  if (hour < 20) return "عصر";
  return "شب";
}

function clockWord(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${toPersianDigits(h12)} ${partOfDay(hour)}`;
}

/**
 * «۹ صبح»، «۹ و نیم صبح»، «۹ و ربع صبح»، «یک ربع به ۱۰ صبح»، «۱۲ و ۲۰ دقیقه ظهر»، «نیمه‌شب». The part of the day is
 * always said, because the digit alone is ambiguous in speech.
 */
export function spokenTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  if (h === 0 && m < 15) return "نیمه‌شب";
  if (m === 0) return clockWord(h);
  if (m === 15) return clockWord(h).replace(" ", " و ربع ");
  if (m === 30) return clockWord(h).replace(" ", " و نیم ");
  if (m === 45) return `یک ربع به ${clockWord((h + 1) % 24)}`;
  return clockWord(h).replace(" ", ` و ${toPersianDigits(m)} دقیقه `);
}

/** The same clock time without the part of the day («۹ و نیم») — for a second time in the same breath, when the part is already said. */
export function spokenTimeShort(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (m === 0) return toPersianDigits(h12);
  if (m === 15) return `${toPersianDigits(h12)} و ربع`;
  if (m === 30) return `${toPersianDigits(h12)} و نیم`;
  if (m === 45) return `یک ربع به ${toPersianDigits(h12 === 12 ? 1 : h12 + 1)}`;
  return `${toPersianDigits(h12)} و ${toPersianDigits(m)} دقیقه`;
}

/**
 * A length of time as it is told: «چند دقیقه»، «۲۰ دقیقه»، «نیم ساعت»، «یک ساعت و نیم»، «حدود دو ساعت و ربع».
 * Rounded to what a person would say (5 minutes below an hour, a quarter of an hour above), with «حدود» when the
 * rounding moved it noticeably.
 */
export function spokenDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m <= 0) return "";
  if (m < 8) return "چند دقیقه";
  const step = m < 60 ? 5 : 15;
  const rounded = Math.round(m / step) * step;
  const approx = Math.abs(rounded - m) >= 3 ? "حدود " : "";

  if (rounded < 60) {
    if (rounded === 15) return `${approx}ربع ساعت`;
    if (rounded === 30) return `${approx}نیم ساعت`;
    return `${approx}${toPersianDigits(rounded)} دقیقه`;
  }
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  const hourWord = hours === 1 ? "یک ساعت" : `${faCount(hours)} ساعت`;
  if (rest === 0) return `${approx}${hourWord}`;
  if (rest === 15) return `${approx}${hourWord} و ربع`;
  if (rest === 30) return `${approx}${hourWord} و نیم`;
  return `${approx}${hourWord} و ${toPersianDigits(rest)} دقیقه`;
}

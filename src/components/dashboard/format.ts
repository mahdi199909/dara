import { formatJalali } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";

export const LICENSE_LABELS: Record<string, string> = {
  TRIAL: "دوره‌ی آزمایشی",
  SUBSCRIBED: "مشترک",
  LIFETIME: "مادام‌العمر",
  FREE: "رایگان (بدون اشتراک)",
};

export const LICENSE_TONES: Record<string, string> = {
  TRIAL: "bg-amber-50 text-amber-800",
  SUBSCRIBED: "bg-accent-soft text-accent",
  LIFETIME: "bg-indigo-50 text-indigo-700",
  FREE: "bg-canvas text-muted",
};

export function fa(n: number | string): string {
  return toPersianDigits(typeof n === "number" ? n.toLocaleString("en-US") : n);
}

export function jalaliDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return formatJalali(new Date(iso));
}

export function jalaliDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  return formatJalali(new Date(iso), { withTime: true });
}

/** "۳ روز پیش", "همین حالا" — for "last seen". */
export function ago(iso: string | Date | null | undefined, now = Date.now()): string {
  if (!iso) return "هرگز";
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 2) return "همین حالا";
  if (min < 60) return `${fa(min)} دقیقه پیش`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${fa(h)} ساعت پیش`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${fa(d)} روز پیش`;
  return jalaliDate(iso);
}

export function remainingLabel(status: string, daysRemaining: number | null): string {
  if (status === "LIFETIME") return "بدون پایان";
  if (status === "FREE" || daysRemaining === null) return "—";
  if (daysRemaining === 0) return "امروز تمام می‌شود";
  return `${fa(daysRemaining)} روز مانده`;
}

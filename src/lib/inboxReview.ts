// «مرور صندوق ورودی»: when to remind the person to empty the inbox (GTD's regular review).
//
// The reminder only ever rings while something is waiting in the inbox: the phone arms the next few
// occasions whenever the inbox changes and cancels them all the moment it is empty. The setting is
// kept per device (like the notifications it arms), not synced.

export type ReviewFrequency = "DAILY" | "WEEKLY";

export interface InboxReviewSettings {
  enabled: boolean;
  frequency: ReviewFrequency;
  /** JavaScript's day number: 0 = یکشنبه … 5 = جمعه, 6 = شنبه. Used when weekly. */
  weekday: number;
  /** "HH:MM", 24-hour. */
  time: string;
}

/** End of the Iranian week: Friday evening. */
export const DEFAULT_INBOX_REVIEW: InboxReviewSettings = { enabled: true, frequency: "WEEKLY", weekday: 5, time: "20:00" };

/** In the order of the Iranian week, starting Saturday. */
export const WEEKDAYS_FA: { value: number; label: string }[] = [
  { value: 6, label: "شنبه" },
  { value: 0, label: "یکشنبه" },
  { value: 1, label: "دوشنبه" },
  { value: 2, label: "سه‌شنبه" },
  { value: 3, label: "چهارشنبه" },
  { value: 4, label: "پنجشنبه" },
  { value: 5, label: "جمعه" },
];

const STORAGE_KEY = "parva.inboxReview.v1";
export const INBOX_REVIEW_CHANGED_EVENT = "parva:inbox-review-changed";

function parseTime(time: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  const h = match ? Math.min(23, Number(match[1])) : 20;
  const m = match ? Math.min(59, Number(match[2])) : 0;
  return { h, m };
}

/** The next `count` moments (local time) strictly after `from`. */
export function nextReviewTimes(settings: InboxReviewSettings, from: Date, count: number): Date[] {
  if (!settings.enabled || count <= 0) return [];
  const { h, m } = parseTime(settings.time);
  const out: Date[] = [];
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate(), h, m, 0, 0);
  for (let i = 0; out.length < count && i < 366 * 2; i++) {
    const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate() + i, h, m, 0, 0);
    if (candidate.getTime() <= from.getTime()) continue;
    if (settings.frequency === "WEEKLY" && candidate.getDay() !== settings.weekday) continue;
    out.push(candidate);
  }
  return out;
}

/** The latest review moment at or before `now` (null when reminders are off). */
export function lastReviewTime(settings: InboxReviewSettings, now: Date): Date | null {
  if (!settings.enabled) return null;
  const back = new Date(now.getTime() - (settings.frequency === "WEEKLY" ? 8 : 2) * 24 * 3_600_000);
  const times = nextReviewTimes(settings, back, settings.frequency === "WEEKLY" ? 2 : 3).filter((t) => t.getTime() <= now.getTime());
  return times.length > 0 ? times[times.length - 1] : null;
}

/** "هر جمعه ساعت ۲۰:۰۰" — for the settings line. */
export function describeReview(settings: InboxReviewSettings): string {
  if (!settings.enabled) return "خاموش";
  const time = settings.time.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  if (settings.frequency === "DAILY") return `هر روز ساعت ${time}`;
  return `هر ${WEEKDAYS_FA.find((w) => w.value === settings.weekday)?.label ?? ""} ساعت ${time}`;
}

export function readInboxReviewSettings(): InboxReviewSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_INBOX_REVIEW, ...(JSON.parse(raw) as Partial<InboxReviewSettings>) } : DEFAULT_INBOX_REVIEW;
  } catch {
    return DEFAULT_INBOX_REVIEW;
  }
}

export function saveInboxReviewSettings(settings: InboxReviewSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // kept for this visit only
  }
  window.dispatchEvent(new Event(INBOX_REVIEW_CHANGED_EVENT));
}

const REVIEWED_KEY = "parva.inboxReview.lastReviewedAt";

/** When the person last opened the inbox — a review moment that passed before it no longer nags. */
export function markInboxReviewed(at = new Date()): void {
  try {
    localStorage.setItem(REVIEWED_KEY, at.toISOString());
  } catch {
    // nothing to remember then
  }
}

/** Whether a review moment has passed since the inbox was last opened. */
export function isReviewDue(settings: InboxReviewSettings, now: Date): boolean {
  const last = lastReviewTime(settings, now);
  if (!last) return false;
  try {
    const reviewed = localStorage.getItem(REVIEWED_KEY);
    return !reviewed || new Date(reviewed).getTime() < last.getTime();
  } catch {
    return true;
  }
}

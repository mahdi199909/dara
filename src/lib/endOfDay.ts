// «مرور پایان روز»: a quiet question at the end of the day — what was left? — and the way to answer it: finish each
// open thing, send it to tomorrow, or give it another moment (src/lib/moveItem.ts, the review screen).
//
// The reminder is a notification on the phone, once an evening at the time the person chose. It is kept per device (like
// the notifications it arms, and like the inbox review's setting), not synced. An evening is armed only while something
// is open (today) or planned (a later day) on that day, so it never asks about nothing; today's says how many are open,
// a later day's claims no count, because by then there is no knowing how many will still be.
import { toPersianDigits } from "./money";
import { movableFromEvent, movableFromTask, type Movable } from "./moveItem";

export interface EndOfDaySettings {
  enabled: boolean;
  /** "HH:MM", 24-hour. */
  time: string;
}

export const DEFAULT_END_OF_DAY: EndOfDaySettings = { enabled: true, time: "21:00" };

const STORAGE_KEY = "parva.endOfDay.v1";
export const END_OF_DAY_CHANGED_EVENT = "parva:end-of-day-changed";

function parseTime(time: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  return { h: match ? Math.min(23, Number(match[1])) : 21, m: match ? Math.min(59, Number(match[2])) : 0 };
}

/** The next `count` evenings' moments (local time), each strictly after `from`. */
export function nextEndOfDayTimes(settings: EndOfDaySettings, from: Date, count: number): Date[] {
  if (!settings.enabled || count <= 0) return [];
  const { h, m } = parseTime(settings.time);
  const out: Date[] = [];
  for (let i = 0; out.length < count && i < 400; i++) {
    const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, h, m, 0, 0);
    if (candidate.getTime() > from.getTime()) out.push(candidate);
  }
  return out;
}

export function readEndOfDaySettings(): EndOfDaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_END_OF_DAY, ...(JSON.parse(raw) as Partial<EndOfDaySettings>) } : DEFAULT_END_OF_DAY;
  } catch {
    return DEFAULT_END_OF_DAY;
  }
}

export function saveEndOfDaySettings(settings: EndOfDaySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not remembering is fine; the screen keeps what was picked until it is left.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(END_OF_DAY_CHANGED_EVENT));
}

/** "هر شب ساعت ۲۱:۰۰" — for the settings line. */
export function describeEndOfDay(settings: EndOfDaySettings): string {
  return settings.enabled ? `هر شب ساعت ${toPersianDigits(settings.time)}` : "خاموش";
}

export interface OpenItem {
  /** Stable for the list: kind and id (an event's occurrence start too, so two occurrences never share a key). */
  key: string;
  item: Movable;
  /** "HH:MM" local time, or null for something that belongs to the day without a clock time. */
  time: string | null;
  /** An event's occurrence start (ISO) — what ticking an occurrence done needs. */
  occurrenceDate?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type EventsAnswer = { occurrences?: any[]; taskOccurrences?: any[] };

function dayBounds(day: Date): { start: number; end: number } {
  return {
    start: new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime(),
    end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).getTime(),
  };
}

function atInstant(iso: string | null | undefined, bounds: { start: number; end: number }): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= bounds.start && t <= bounds.end;
}

/**
 * What is still open in a day, from the answer of /api/events for that day: tasks that are not done or cancelled, and
 * events whose occurrence is not ticked. What has a time comes first, in order, then what has none.
 *
 * Given `day`, an answer that covers more than that day is narrowed to it the way the API itself narrows: an event
 * occurrence that touches the day, a task whose due day or start falls in it.
 */
export function openItemsOfDay(data: EventsAnswer | undefined, day?: Date): OpenItem[] {
  const items: OpenItem[] = [];
  const bounds = day ? dayBounds(day) : null;

  for (const occ of data?.occurrences ?? []) {
    if (occ.isDone) continue;
    if (bounds && !(new Date(occ.endAt).getTime() >= bounds.start && new Date(occ.startAt).getTime() <= bounds.end)) continue;
    const allDay = Boolean(occ.event.allDay);
    items.push({
      key: `event-${occ.event.id}-${occ.startAt}`,
      // The occurrence's own start and end (what ticking it done needs); for a repeating event it is not the event's row.
      item: { ...movableFromEvent(occ.event), startAt: occ.startAt, endAt: occ.endAt },
      time: allDay ? null : timeOf(occ.startAt),
      occurrenceDate: occ.startAt,
    });
  }

  for (const task of data?.taskOccurrences ?? []) {
    if (task.status !== "TODO") continue;
    if (bounds && !atInstant(task.dueDate, bounds) && !atInstant(task.startAt, bounds)) continue;
    items.push({
      key: `task-${task.id}`,
      item: movableFromTask(task),
      time: task.startAt ? timeOf(task.startAt) : null,
    });
  }

  return items.sort((a, b) => {
    if (a.time && b.time) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
    if (a.time) return -1;
    if (b.time) return 1;
    return 0;
  });
}

/**
 * The query window of /api/events for `count` days starting with the day `now` is in: local midnight of that day to the
 * last millisecond of the last one, as ISO text — rounded to the day so a cache key built from it does not change on
 * every render.
 */
export function daysWindow(now: Date, count: number): { from: string; to: string } {
  return {
    from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
    to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + count - 1, 23, 59, 59, 999).toISOString(),
  };
}

export const todayWindow = (now: Date) => daysWindow(now, 1);

/** How many evenings ahead are armed at most, and so how many days the scheduler looks at (today and the next seven). */
export const END_OF_DAY_ARMED_EVENINGS = 7;
export const END_OF_DAY_LOOKAHEAD_DAYS = END_OF_DAY_ARMED_EVENINGS + 1;

/** Calendar days from `from`'s date to `to`'s date (0 for the same day), unmoved by a daylight-saving change. */
function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86_400_000);
}

/** How many things are open on each of `days` consecutive days from `from`'s, out of one answer of /api/events that covers them all. */
export function openCountsByDay(data: EventsAnswer | undefined, from: Date, days: number): number[] {
  return Array.from({ length: days }, (_, i) => openItemsOfDay(data, new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)).length);
}

export interface PlannedReminder {
  at: Date;
  title: string;
  body: string;
}

/**
 * The evening reminders to arm, given what the next days hold (the answer of /api/events over END_OF_DAY_LOOKAHEAD_DAYS
 * days from today): an evening only when something is open that day. Today's says how many; a later day's cannot.
 */
export function planEndOfDayReminders(settings: EndOfDaySettings, now: Date, data: EventsAnswer | undefined): PlannedReminder[] {
  const counts = openCountsByDay(data, now, END_OF_DAY_LOOKAHEAD_DAYS);
  return nextEndOfDayTimes(settings, now, END_OF_DAY_ARMED_EVENINGS).flatMap((at) => {
    const ahead = calendarDaysBetween(now, at);
    const open = counts[ahead] ?? 0;
    return open > 0 ? [{ at, ...endOfDayNotificationText(ahead === 0 ? open : null) }] : [];
  });
}

/** The notification's words. `open` is how many things are open today, or null when that cannot be known (a later evening). */
export function endOfDayNotificationText(open: number | null): { title: string; body: string } {
  const title = "مرور پایان روز";
  if (open !== null && open > 0) return { title, body: `${toPersianDigits(open)} مورد امروز هنوز باز است؛ هرکدام را تمام کن یا به فردا ببر.` };
  return { title, body: "امروز چه چیزی تمام نشد؟ هرچه مانده را به فردا یا زمان دیگری ببر." };
}

// What the "برنامهٔ سه روز آینده" home-screen widget shows, computed by the app itself.
//
// The widget used to run its own SQL for "events whose start falls today" — which misses every
// occurrence of a recurring event after the first, and knows nothing about completed occurrences.
// The calendar in the app expands recurrences (see listEvents), so the numbers are computed here,
// with that same code, and handed over through Preferences the way the capital summary is; the
// widget only draws them. The next week is published, not just the days it shows, so the widget still
// shows the right days after midnight while the app has not been opened.
//
// Everything that is going to happen, except habits: the events, the tasks due or planned for each day,
// and the installments that fall due. Each item is a finished line — its marker is part of `title`
// («☐ …» for an open task, «💳 …» for an installment) — so the widget never has to know what kind of
// thing it is drawing. The widget shows the first three days of the week and puts a heading over each
// day that has something; it has no Jalali calendar of its own, so the heading's date comes from `labels`.
import { Preferences } from "@capacitor/preferences";
import { installmentOccurrences, installmentTitle } from "../lib/installmentCalendar";
import { MONTHS_FA, toJalali, weekdayNameFa } from "../lib/jalali";
import { toPersianDigits } from "../lib/money";
import type { LocalDb } from "./db";
import { listEvents } from "./repositories/events";
import { listInstallmentPlans } from "./repositories/installments";

export const WIDGET_EVENTS_KEY = "widget_today_events";
export const WIDGET_EVENTS_DAYS = 7;

export interface WidgetEventItem {
  /** "HH:mm" in the device's time zone, or null for something that belongs to the day without a clock time. */
  t: string | null;
  title: string;
  done: boolean;
}

export interface WidgetEventsPayload {
  generatedAt: string;
  /** Keyed by the device-local date, "YYYY-MM-DD". Every day of the window is present (possibly empty). */
  days: Record<string, WidgetEventItem[]>;
  /** The heading text for each day of the window — weekday and Jalali date, e.g. "دوشنبه ۱۱ آبان". */
  labels: Record<string, string>;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "دوشنبه ۱۱ آبان". */
export function dayLabel(d: Date): string {
  const { jd, jm } = toJalali(d);
  return `${weekdayNameFa(d)} ${toPersianDigits(jd)} ${MONTHS_FA[jm - 1]}`;
}

// Within a day: what has no clock time comes first (installments, then all-day events, then tasks with only a due
// day), then what has one, by time.
const RANK_INSTALLMENT = 0;
const RANK_ALL_DAY_EVENT = 1;
const RANK_ALL_DAY_TASK = 2;
const RANK_TIMED = 3;

interface Ranked {
  rank: number;
  item: WidgetEventItem;
}

const timeOf = (at: Date) => `${pad(at.getHours())}:${pad(at.getMinutes())}`;

/** "HH:mm" strings sort as text; a missing time ties with another missing one. */
function compareTime(a: string | null, b: string | null): number {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

export function buildWidgetEventsPayload(db: LocalDb, userId: string, now: Date = new Date()): WidgetEventsPayload {
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + WIDGET_EVENTS_DAYS);

  const ranked: Record<string, Ranked[]> = {};
  const labels: Record<string, string> = {};
  for (let i = 0; i < WIDGET_EVENTS_DAYS; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    ranked[localDayKey(day)] = [];
    labels[localDayKey(day)] = dayLabel(day);
  }

  const { occurrences, taskOccurrences } = listEvents(db, userId, { from: windowStart.toISOString(), to: new Date(windowEnd.getTime() - 1).toISOString() });

  for (const occ of occurrences as Array<{ startAt: string; isDone?: boolean; event: { title: string; allDay?: boolean | number } }>) {
    const at = new Date(occ.startAt);
    const list = ranked[localDayKey(at)];
    if (!list) continue;
    const allDay = Boolean(occ.event.allDay);
    list.push({ rank: allDay ? RANK_ALL_DAY_EVENT : RANK_TIMED, item: { t: allDay ? null : timeOf(at), title: occ.event.title, done: Boolean(occ.isDone) } });
  }

  // A task belongs to the day it is planned for (its start, when it has one) or else the day it is due — the same
  // two ways the calendar finds it. A cancelled one is not going to happen.
  for (const task of taskOccurrences as Array<{ title: string; status: string; dueDate: string | null; startAt: string | null }>) {
    if (task.status === "CANCELLED") continue;
    const planned = task.startAt ? new Date(task.startAt) : null;
    const when = planned && ranked[localDayKey(planned)] ? planned : task.dueDate ? new Date(task.dueDate) : null;
    const list = when ? ranked[localDayKey(when)] : undefined;
    if (!list || !when) continue;
    const timed = planned !== null && when === planned;
    const done = task.status === "DONE";
    list.push({ rank: timed ? RANK_TIMED : RANK_ALL_DAY_TASK, item: { t: timed ? timeOf(when) : null, title: done ? task.title : `☐ ${task.title}`, done } });
  }

  for (const occurrence of installmentOccurrences(listInstallmentPlans(db, userId))) {
    const list = ranked[occurrence.dayKey];
    if (!list) continue;
    list.push({ rank: RANK_INSTALLMENT, item: { t: null, title: `💳 ${installmentTitle(occurrence)}`, done: occurrence.paid } });
  }

  const days: Record<string, WidgetEventItem[]> = {};
  for (const [key, list] of Object.entries(ranked)) {
    // Array.prototype.sort is stable, so items that tie (same rank and time) keep the order they were added in.
    days[key] = list.sort((a, b) => a.rank - b.rank || compareTime(a.item.t, b.item.t)).map((entry) => entry.item);
  }
  return { generatedAt: now.toISOString(), days, labels };
}

/** Computes the payload and stores it where TodayEventsWidgetService reads it. */
export function publishEventsToWidget(db: LocalDb, userId: string, now: Date = new Date()): Promise<void> {
  return Preferences.set({ key: WIDGET_EVENTS_KEY, value: JSON.stringify(buildWidgetEventsPayload(db, userId, now)) });
}

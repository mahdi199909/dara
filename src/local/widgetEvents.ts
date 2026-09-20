// What the "رویدادهای امروز" home-screen widget shows, computed by the app itself.
//
// The widget used to run its own SQL for "events whose start falls today" — which misses every
// occurrence of a recurring event after the first, and knows nothing about completed occurrences.
// The calendar in the app expands recurrences (see listEvents), so the numbers are computed here,
// with that same code, and handed over through Preferences the way the capital summary is; the
// widget only draws them. The next week is published, not just today, so the widget still shows the
// right day after midnight while the app has not been opened.
import { Preferences } from "@capacitor/preferences";
import type { LocalDb } from "./db";
import { listEvents } from "./repositories/events";

export const WIDGET_EVENTS_KEY = "widget_today_events";
export const WIDGET_EVENTS_DAYS = 7;

export interface WidgetEventItem {
  /** "HH:mm" in the device's time zone, or null for an all-day event. */
  t: string | null;
  title: string;
  done: boolean;
}

export interface WidgetEventsPayload {
  generatedAt: string;
  /** Keyed by the device-local date, "YYYY-MM-DD". Every day of the window is present (possibly empty). */
  days: Record<string, WidgetEventItem[]>;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function buildWidgetEventsPayload(db: LocalDb, userId: string, now: Date = new Date()): WidgetEventsPayload {
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + WIDGET_EVENTS_DAYS);

  const days: Record<string, WidgetEventItem[]> = {};
  for (let i = 0; i < WIDGET_EVENTS_DAYS; i++) {
    days[localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i))] = [];
  }

  const { occurrences } = listEvents(db, userId, { from: windowStart.toISOString(), to: new Date(windowEnd.getTime() - 1).toISOString() });
  for (const occ of occurrences as Array<{ startAt: string; isDone?: boolean; event: { title: string; allDay?: boolean | number } }>) {
    const at = new Date(occ.startAt);
    const list = days[localDayKey(at)];
    if (!list) continue;
    list.push({ t: occ.event.allDay ? null : `${pad(at.getHours())}:${pad(at.getMinutes())}`, title: occ.event.title, done: Boolean(occ.isDone) });
  }
  return { generatedAt: now.toISOString(), days };
}

/** Computes the payload and stores it where EventsWidgetService reads it. */
export function publishEventsToWidget(db: LocalDb, userId: string, now: Date = new Date()): Promise<void> {
  return Preferences.set({ key: WIDGET_EVENTS_KEY, value: JSON.stringify(buildWidgetEventsPayload(db, userId, now)) });
}

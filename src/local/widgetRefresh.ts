// Keeps the home-screen widgets in step with the app's data.
//
// The widgets (Android RemoteViews) read the app's SQLite file directly, so they only ever show
// what has been saved to that file. Before this, they were told to repaint only when the app went
// to the background or on the system's 30-minute timer — so a habit ticked, an event added or a
// row pulled in by a sync was invisible on the home screen for a long while. Now every time the
// database has been written to disk (see browserSqlJs.ts's onFlushed) the native side is asked to
// repaint them, through the AndroidWidgets bridge MainActivity exposes.
import type { LocalDb } from "./db";
import { LOCAL_USER_ID } from "./localUser";

interface AndroidWidgetsBridge {
  refresh(): void;
}

/** Repaints are coalesced to at most one per this many ms — a burst of writes is one repaint. */
export const WIDGET_REFRESH_MIN_INTERVAL_MS = 1500;

let timer: ReturnType<typeof setTimeout> | null = null;
let lastRunAt = 0;
let pendingDb: LocalDb | null = null;

function bridge(): AndroidWidgetsBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { AndroidWidgets?: AndroidWidgetsBridge }).AndroidWidgets;
}

/** Asks the native side to repaint every placed widget now. A no-op outside the Android app. */
export function requestWidgetRefresh(): void {
  try {
    bridge()?.refresh();
  } catch (err) {
    console.error("widget refresh failed", err);
  }
}

async function publishAndRefresh(db: LocalDb): Promise<void> {
  // The "سرمایه من" and "رویدادهای امروز" widgets show numbers/lists the app computes and hands over
  // through Preferences; bring them up to date first so the repaint below shows them. Each is
  // independent — one failing must not stop the other or the repaint.
  try {
    const { writeCapitalWidgetSummary } = await import("./reportEngine");
    await writeCapitalWidgetSummary(db, LOCAL_USER_ID);
  } catch (err) {
    console.error("capital widget summary failed", err);
  }
  try {
    const { publishEventsToWidget } = await import("./widgetEvents");
    await publishEventsToWidget(db, LOCAL_USER_ID);
  } catch (err) {
    console.error("events widget payload failed", err);
  }
  requestWidgetRefresh();
}

/**
 * Call after the database was saved. Refreshes what the widgets are handed (the capital summary,
 * the next week of events) and repaints them — at most once per WIDGET_REFRESH_MIN_INTERVAL_MS, with
 * the last call always honoured.
 */
export function scheduleWidgetRefresh(db: LocalDb, now: () => number = Date.now): void {
  if (!bridge()) return;
  pendingDb = db;
  if (timer) return; // one is already queued and will read the latest data
  const wait = Math.max(0, lastRunAt + WIDGET_REFRESH_MIN_INTERVAL_MS - now());
  timer = setTimeout(() => {
    timer = null;
    lastRunAt = now();
    const target = pendingDb;
    pendingDb = null;
    if (target) void publishAndRefresh(target);
  }, wait);
}

/** Test hook: forget queued work and timing between cases. */
export function resetWidgetRefreshForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  lastRunAt = 0;
  pendingDb = null;
}

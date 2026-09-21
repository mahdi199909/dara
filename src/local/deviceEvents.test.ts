// The OS reminders and the home-screen widgets, as far as the phone's log is concerned: what happened, to which
// reminder or queue, when — and never the title or the body of a reminder, or what someone typed into a widget.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => void store.set(key, value)),
    remove: vi.fn(async ({ key }: { key: string }) => void store.delete(key)),
  },
}));
const plugin = vi.hoisted(() => ({
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
  getPending: vi.fn(),
}));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: plugin }));

import { installMemoryLogger } from "@/lib/observability/testing";
import { openLocalDb, resetLocalDbForTests } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { LOCAL_USER_ID, getLocalUserId } from "./localUser";
import { cancelReminderNotification, rescheduleReminderNotification, scheduleReminderNotification, syncScheduledReminderNotifications } from "./nativeNotifications";
import { drainWidgetQueue } from "./widgetQueue";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  memory = installMemoryLogger({ level: "TRACE" });
  store.clear();
  for (const fn of Object.values(plugin)) fn.mockReset().mockResolvedValue(undefined);
  plugin.getPending.mockResolvedValue({ notifications: [] });
});
afterEach(() => memory.restore());

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const SECRET_TITLE = "قسط وام مسکن";
const SECRET_BODY = "سررسید ۱۰ میلیون تومان";

describe("OS reminders", () => {
  it("says a reminder was scheduled — its id and when it rings, not what it says", async () => {
    scheduleReminderNotification({ id: "rem-1", title: SECRET_TITLE, body: SECRET_BODY, remindAt: inAnHour() });
    await settle();
    expect(plugin.schedule).toHaveBeenCalledTimes(1);
    const record = memory.sink.find("LOCAL_NOTIFICATION_SCHEDULED")[0];
    expect(record).toMatchObject({ level: "DEBUG", layer: "local", entity_type: "reminder", entity_id: "rem-1" });
    expect(record.metadata.scheduledFor).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(memory.sink.records)).not.toContain(SECRET_TITLE);
    expect(JSON.stringify(memory.sink.records)).not.toContain("میلیون");
  });

  it("says nothing when a reminder was already due and was left to the in-app path", async () => {
    scheduleReminderNotification({ id: "rem-2", title: "t", body: "b", remindAt: new Date(Date.now() - 1000).toISOString() });
    await settle();
    expect(plugin.schedule).not.toHaveBeenCalled();
    expect(memory.sink.find("LOCAL_NOTIFICATION_SCHEDULED")).toEqual([]);
  });

  it("does not claim it scheduled anything when the operating system refused", async () => {
    plugin.schedule.mockRejectedValue(new Error("notifications are blocked"));
    scheduleReminderNotification({ id: "rem-3", title: "t", body: "b", remindAt: inAnHour() });
    await settle();
    expect(memory.sink.find("LOCAL_NOTIFICATION_SCHEDULED")).toEqual([]);
    expect(memory.sink.find("LOCAL_NOTIFICATION_FAILED")[0]).toMatchObject({ level: "ERROR", entity_id: "rem-3", operation: "schedule" });
  });

  it("says a reminder was moved, and that one moved into the past was cancelled instead", async () => {
    rescheduleReminderNotification({ id: "rem-4", title: "t", body: "b", remindAt: inAnHour() });
    await settle();
    expect(memory.sink.find("LOCAL_NOTIFICATION_RESCHEDULED")[0]).toMatchObject({ entity_id: "rem-4" });

    rescheduleReminderNotification({ id: "rem-5", title: "t", body: "b", remindAt: new Date(Date.now() - 1000).toISOString() });
    await settle();
    expect(plugin.cancel).toHaveBeenCalledTimes(1);
    expect(memory.sink.find("LOCAL_NOTIFICATION_CANCELLED")[0]).toMatchObject({ entity_id: "rem-5" });
  });

  it("says a reminder was cancelled when it was removed", async () => {
    cancelReminderNotification("rem-6");
    await settle();
    expect(memory.sink.find("LOCAL_NOTIFICATION_CANCELLED")[0]).toMatchObject({ level: "DEBUG", entity_id: "rem-6", metadata: { reason: "removed" } });
  });

  it("says how the operating system's schedule was aligned with the database", async () => {
    plugin.getPending.mockResolvedValue({ notifications: [{ id: 111 }, { id: 222 }] });
    syncScheduledReminderNotifications([{ id: "rem-7", title: SECRET_TITLE, body: SECRET_BODY, remindAt: inAnHour() }]);
    await settle();
    expect(memory.sink.find("LOCAL_NOTIFICATION_RECONCILED")[0]).toMatchObject({ layer: "local", metadata: { wanted: 1, cancelledStale: 2 } });
    expect(JSON.stringify(memory.sink.records)).not.toContain(SECRET_TITLE);
  });

  it("does not say the schedule was aligned when it could not be", async () => {
    plugin.getPending.mockRejectedValue(new Error("plugin unavailable"));
    syncScheduledReminderNotifications([]);
    await settle();
    expect(memory.sink.find("LOCAL_NOTIFICATION_RECONCILED")).toEqual([]);
    expect(memory.sink.find("LOCAL_NOTIFICATION_FAILED")).toHaveLength(1);
  });
});

describe("the widget queue", () => {
  async function phone() {
    resetLocalDbForTests();
    const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
    getLocalUserId(db);
    return db;
  }
  const capture = (title: string) => ({ title, categoryId: null, durationMinutes: 30, startedAt: "2026-09-21T08:00:00.000Z" });

  it("says how many actions arrived and how they went — never what was typed into the widget", async () => {
    const db = await phone();
    store.set("widget_pending_captures", JSON.stringify([capture("جلسه‌ی محرمانه"), capture("قرار خصوصی"), { title: "خراب" }]));
    await drainWidgetQueue(db, LOCAL_USER_ID);

    expect(memory.sink.find("WIDGET_ACTION_RECEIVED")[0]).toMatchObject({ level: "DEBUG", layer: "local", metadata: { queue: "capture", count: 2, malformed: 1 } });
    expect(memory.sink.find("WIDGET_QUEUE_PROCESSED")[0]).toMatchObject({ metadata: { queue: "capture", applied: 2, failed: 0 } });
    expect(JSON.stringify(memory.sink.records)).not.toContain("محرمانه");
    expect(JSON.stringify(memory.sink.records)).not.toContain("خصوصی");
  });

  it("counts a habit toggle queue the same way, and reports the ones that failed while the rest went on", async () => {
    const db = await phone();
    store.set("widget_pending_habit_checkins", JSON.stringify([{ habitId: "no-such-habit", date: "2026-09-21T00:00:00.000Z" }]));
    await drainWidgetQueue(db, LOCAL_USER_ID);
    expect(memory.sink.find("WIDGET_ACTION_RECEIVED")[0].metadata).toMatchObject({ queue: "habit_checkin", count: 1 });
    expect(memory.sink.find("WIDGET_QUEUE_PROCESSED")[0].metadata).toMatchObject({ queue: "habit_checkin", applied: 0, failed: 1 });
    expect(memory.sink.find("WIDGET_QUEUE_FAILED")).toHaveLength(1);
  });

  it("stays silent when there is nothing in the queue", async () => {
    const db = await phone();
    await drainWidgetQueue(db, LOCAL_USER_ID);
    expect(memory.sink.find("WIDGET_ACTION_RECEIVED")).toEqual([]);
    expect(memory.sink.find("WIDGET_QUEUE_PROCESSED")).toEqual([]);
  });
});

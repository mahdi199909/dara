import { beforeEach, describe, expect, it, vi } from "vitest";

const setSpy = vi.fn(async () => {});
vi.mock("@capacitor/preferences", () => ({ Preferences: { set: (...args: unknown[]) => setSpy(...(args as [])) } }));
vi.mock("./nativeNotifications", () => ({
  scheduleReminderNotification: () => {},
  rescheduleReminderNotification: () => {},
  cancelReminderNotifications: () => {},
  syncScheduledReminderNotifications: () => {},
}));

import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { createEvent, toggleEventCompletion } from "./repositories/events";
import { WIDGET_EVENTS_DAYS, WIDGET_EVENTS_KEY, buildWidgetEventsPayload, localDayKey, publishEventsToWidget } from "./widgetEvents";

const USER = "u1";
const T = "2026-09-01T00:00:00.000Z";

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER, "t@example.com", "h", "T", T, T]);
  return db;
}

// A fixed "now": local noon on a Saturday.
const NOW = new Date(2026, 8, 19, 12, 0, 0);
const at = (dayOffset: number, hour: number, minute = 0) => new Date(2026, 8, 19 + dayOffset, hour, minute).toISOString();

describe("buildWidgetEventsPayload", () => {
  beforeEach(() => setSpy.mockClear());

  it("has an entry for each of the next seven days, empty ones included", async () => {
    const db = await freshDb();
    const payload = buildWidgetEventsPayload(db, USER, NOW);
    expect(Object.keys(payload.days)).toHaveLength(WIDGET_EVENTS_DAYS);
    expect(Object.keys(payload.days)[0]).toBe("2026-09-19");
    expect(Object.keys(payload.days)[6]).toBe("2026-09-25");
    expect(Object.values(payload.days).every((d) => d.length === 0)).toBe(true);
  });

  it("lists an event on its day at its local time, earliest first", async () => {
    const db = await freshDb();
    createEvent(db, USER, { title: "ناهار", startAt: at(0, 13, 30), endAt: at(0, 14, 30) });
    createEvent(db, USER, { title: "جلسه", startAt: at(0, 9, 5), endAt: at(0, 10, 0) });
    createEvent(db, USER, { title: "فردا", startAt: at(1, 8), endAt: at(1, 9) });

    const { days } = buildWidgetEventsPayload(db, USER, NOW);
    expect(days["2026-09-19"].map((e) => [e.t, e.title])).toEqual([
      ["09:05", "جلسه"],
      ["13:30", "ناهار"],
    ]);
    expect(days["2026-09-20"].map((e) => e.title)).toEqual(["فردا"]);
  });

  it("includes later occurrences of a recurring event — the thing the old direct query missed", async () => {
    const db = await freshDb();
    createEvent(db, USER, { title: "کلاس هفتگی", startAt: at(-14, 17), endAt: at(-14, 18), recurrenceFreq: "WEEKLY", recurrenceInterval: 1 });

    const { days } = buildWidgetEventsPayload(db, USER, NOW);
    // Started two weeks ago, so it repeats today and again in a week.
    expect(days["2026-09-19"].map((e) => e.title)).toEqual(["کلاس هفتگی"]);
    expect(days["2026-09-25"].map((e) => e.title)).toEqual([]); // 6 days on: not a class day
  });

  it("marks an occurrence the person completed", async () => {
    const db = await freshDb();
    const event = createEvent(db, USER, { title: "ورزش", startAt: at(0, 7), endAt: at(0, 8) });
    toggleEventCompletion(db, USER, event.id, { occurrenceDate: event.startAt });

    const { days } = buildWidgetEventsPayload(db, USER, NOW);
    expect(days["2026-09-19"][0].done).toBe(true);
  });

  it("gives an all-day event no time, and leaves out a deleted event", async () => {
    const db = await freshDb();
    createEvent(db, USER, { title: "تعطیل", startAt: at(0, 0), endAt: at(0, 23, 59), allDay: true });
    const gone = createEvent(db, USER, { title: "حذف‌شده", startAt: at(0, 15), endAt: at(0, 16) });
    db.run(`UPDATE "Event" SET "deletedAt" = ? WHERE "id" = ?`, [T, gone.id]);

    const { days } = buildWidgetEventsPayload(db, USER, NOW);
    expect(days["2026-09-19"]).toEqual([{ t: null, title: "تعطیل", done: false }]);
  });
});

describe("publishEventsToWidget", () => {
  it("stores the payload as JSON under the key the widget reads", async () => {
    setSpy.mockClear();
    const db = await freshDb();
    createEvent(db, USER, { title: "جلسه", startAt: at(0, 10), endAt: at(0, 11) });

    await publishEventsToWidget(db, USER, NOW);

    expect(setSpy).toHaveBeenCalledTimes(1);
    const arg = (setSpy.mock.calls[0] as unknown as [{ key: string; value: string }])[0];
    expect(arg.key).toBe(WIDGET_EVENTS_KEY);
    expect(JSON.parse(arg.value).days[localDayKey(NOW)][0].title).toBe("جلسه");
  });
});

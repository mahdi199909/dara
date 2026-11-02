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
import { createInstallmentPlan } from "./repositories/installments";
import { createTask } from "./repositories/tasks";
import { WIDGET_EVENTS_DAYS, WIDGET_EVENTS_KEY, buildWidgetEventsPayload, dayLabel, localDayKey, publishEventsToWidget } from "./widgetEvents";

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

describe("the three-day agenda: tasks and installments join the events", () => {
  const dayKey = (offset: number) => localDayKey(new Date(2026, 8, 19 + offset));

  it("labels every day of the window with its weekday and Jalali date", async () => {
    const db = await freshDb();
    const { labels } = buildWidgetEventsPayload(db, USER, NOW);
    expect(Object.keys(labels)).toEqual(Object.keys(buildWidgetEventsPayload(db, USER, NOW).days));
    // 19 September 2026 is a Saturday, 28 Shahrivar 1405.
    expect(labels[dayKey(0)]).toBe("شنبه ۲۸ شهریور");
    expect(labels[dayKey(1)]).toBe("یکشنبه ۲۹ شهریور");
    expect(labels[dayKey(0)]).toBe(dayLabel(new Date(2026, 8, 19)));
  });

  it("lists a task on its due day as an open box with no time, and a done one as its plain title", async () => {
    const db = await freshDb();
    createTask(db, USER, { title: "پرداخت قبض", dueDate: at(1, 0) } as never);
    createTask(db, USER, { title: "تماس با بانک", dueDate: at(1, 0), status: "DONE" } as never);

    const { days } = buildWidgetEventsPayload(db, USER, NOW);
    expect(days[dayKey(1)]).toEqual([
      { t: null, title: "☐ پرداخت قبض", done: false },
      { t: null, title: "تماس با بانک", done: true },
    ]);
  });

  it("puts a task that was planned for a time on the day and at the time it starts", async () => {
    const db = await freshDb();
    createTask(db, USER, { title: "نوشتن گزارش", startAt: at(2, 14, 30), endAt: at(2, 16) } as never);

    const { days } = buildWidgetEventsPayload(db, USER, NOW);
    expect(days[dayKey(2)]).toEqual([{ t: "14:30", title: "☐ نوشتن گزارش", done: false }]);
  });

  it("leaves out a cancelled task, a deleted one and one outside the window", async () => {
    const db = await freshDb();
    createTask(db, USER, { title: "لغو‌شده", dueDate: at(1, 0), status: "CANCELLED" } as never);
    const gone = createTask(db, USER, { title: "حذف‌شده", dueDate: at(1, 0) } as never) as { id: string };
    db.run(`UPDATE "Task" SET "deletedAt" = ? WHERE "id" = ?`, [T, gone.id]);
    createTask(db, USER, { title: "ماه بعد", dueDate: at(20, 0) } as never);

    const { days } = buildWidgetEventsPayload(db, USER, NOW);
    expect(Object.values(days).flat()).toEqual([]);
  });

  it("shows an installment as a card line on the day it falls due, and marks a paid one done", async () => {
    const db = await freshDb();
    // The first falls due on 20 September 2026 (29 Shahrivar), the next on the same Jalali day a month later.
    const plan = createInstallmentPlan(db, USER, { title: "ماشین", totalAmount: 24_000_000, installmentAmount: 8_000_000, numberOfInstallments: 3, firstDueDate: "2026-09-20" } as never);
    expect(plan.installments).toHaveLength(3);

    let payload = buildWidgetEventsPayload(db, USER, NOW);
    expect(payload.days[dayKey(1)]).toEqual([{ t: null, title: "💳 ماشین — قسط ۱ از ۳", done: false }]);

    db.run(`UPDATE "Installment" SET "status" = ? WHERE "planId" = ? AND "index" = 1`, ["PAID", plan.id]);
    payload = buildWidgetEventsPayload(db, USER, NOW);
    expect(payload.days[dayKey(1)]).toEqual([{ t: null, title: "💳 ماشین — قسط ۱ از ۳", done: true }]);
  });

  it("orders a day: installments, then all-day events, then tasks with only a day, then what has a time", async () => {
    const db = await freshDb();
    createEvent(db, USER, { title: "جلسه ۹", startAt: at(1, 9), endAt: at(1, 10) });
    createTask(db, USER, { title: "کار ۸", startAt: at(1, 8), endAt: at(1, 8, 30) } as never);
    createTask(db, USER, { title: "کار بی‌ساعت", dueDate: at(1, 0) } as never);
    createEvent(db, USER, { title: "تعطیل", startAt: at(1, 0), endAt: at(1, 23, 59), allDay: true });
    createInstallmentPlan(db, USER, { title: "گوشی", totalAmount: 2, installmentAmount: 1, numberOfInstallments: 2, firstDueDate: "2026-09-20" } as never);

    const { days } = buildWidgetEventsPayload(db, USER, NOW);
    expect(days[dayKey(1)].map((item) => item.title)).toEqual(["💳 گوشی — قسط ۱ از ۲", "تعطیل", "☐ کار بی‌ساعت", "☐ کار ۸", "جلسه ۹"]);
  });

  it("does not list habits — nothing in the payload comes from them", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Habit" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["h1", USER, "ورزش صبحگاهی", T, T]);
    const { days } = buildWidgetEventsPayload(db, USER, NOW);
    expect(Object.values(days).flat()).toEqual([]);
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

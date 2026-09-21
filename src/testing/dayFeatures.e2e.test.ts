// Installments on the Jalali calendar, refusing overlapping time, daily notes and the rich search — each
// through the real web routes on a real database, and (for notes) across a sync to the phone.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("@/testing/cookieJar");
  return { cookies: () => cookieJar };
});
vi.mock("@/local/nativeNotifications", () => ({
  requestNotificationPermission: async () => {},
  scheduleReminderNotification: () => {},
  rescheduleReminderNotification: () => {},
  cancelReminderNotification: () => {},
  cancelReminderNotifications: () => {},
  syncScheduledReminderNotifications: () => {},
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {}, keys: async () => ({ keys: [] }) },
}));
vi.mock("@/lib/versionGate", () => ({ cacheVersionGate: async () => {}, checkVersionGate: async () => ({ blocked: false }) }));

import { createPhone, createServerHarness, type ServerHarness } from "@/testing/syncHarness";
import { linkPhone, syncUntilQuiet } from "@/testing/syncScenarios";
import { dueDateDay } from "@/lib/installments";
import type { NoteSearchResult, PlanSearchResult, StatsSearchResult, TimedSearchResult } from "@/lib/searchEngine";

vi.setConfig({ testTimeout: 60_000 });

let server: ServerHarness;

beforeAll(async () => {
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
  server = await createServerHarness();
}, 120_000);
afterAll(async () => {
  await server.dispose();
});

const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m).toISOString();
const jal = (value: string | Date) => {
  const { jy, jm, jd } = dueDateDay(new Date(value));
  return [jy, jm, jd];
};

describe("installments on the Jalali calendar", () => {
  it("starts on the picked first date and keeps its Jalali day every month", async () => {
    await server.registerUser();
    const res = await server.web("POST", "/api/installment-plans", { title: "دیجی پی", totalAmount: 8_000_000, installmentAmount: 2_200_000, numberOfInstallments: 4, firstDueDate: "2026-10-02" });
    expect(res.status).toBe(201);
    // 2026-10-02 is Mehr 10, 1405 — every installment falls on the 10th of a Jalali month
    expect(res.json.plan.dueDay).toBe(10);
    expect(res.json.plan.installments.map((i: { dueDate: string }) => jal(i.dueDate))).toEqual([
      [1405, 7, 10],
      [1405, 8, 10],
      [1405, 9, 10],
      [1405, 10, 10],
    ]);
  });

  it("still takes only a day of the month, starting next Jalali month", async () => {
    await server.registerUser();
    const res = await server.web("POST", "/api/installment-plans", { title: "قسط", totalAmount: 200, installmentAmount: 100, numberOfInstallments: 2, dueDay: 5 });
    expect(res.status).toBe(201);
    expect(res.json.plan.installments.every((i: { dueDate: string }) => jal(i.dueDate)[2] === 5)).toBe(true);
  });

  it("needs a day or a first date", async () => {
    await server.registerUser();
    const res = await server.web("POST", "/api/installment-plans", { title: "x", totalAmount: 200, installmentAmount: 100, numberOfInstallments: 2 });
    expect(res.status).toBe(400);
  });

  it("re-dates only the unpaid installments when the day changes, moving their reminders with them", async () => {
    const { userId } = await server.registerUser();
    const created = await server.mustWeb("POST", "/api/installment-plans", { title: "وام", totalAmount: 300, installmentAmount: 100, numberOfInstallments: 3, firstDueDate: "2026-10-02", reminderOffsets: [1440] });
    const plan = created.plan;
    const account = (await server.mustWeb("POST", "/api/accounts", { name: "نقد", type: "CASH", initialBalance: 1000 })).account;
    await server.mustWeb("POST", `/api/installments/${plan.installments[0].id}/pay`, { accountId: account.id });

    const res = await server.web("PATCH", `/api/installment-plans/${plan.id}`, { dueDay: 25 });
    expect(res.status).toBe(200);
    const after = res.json.plan.installments as Array<{ id: string; dueDate: string; status: string }>;
    expect(after[0].status).toBe("PAID");
    expect(after[0].dueDate).toBe(plan.installments[0].dueDate); // history untouched
    expect(after.slice(1).map((i) => jal(i.dueDate))).toEqual([
      [1405, 8, 25],
      [1405, 9, 25],
    ]);

    const reminder = await server.prisma.reminder.findFirstOrThrow({ where: { userId, installmentId: after[1].id } });
    expect(reminder.remindAt.getTime()).toBe(new Date(after[1].dueDate).getTime() - 1440 * 60000);
  });

  it("moves the whole schedule with a new first date until something is paid, then refuses", async () => {
    await server.registerUser();
    const plan = (await server.mustWeb("POST", "/api/installment-plans", { title: "وام", totalAmount: 200, installmentAmount: 100, numberOfInstallments: 2, firstDueDate: "2026-10-02" })).plan;

    const moved = await server.web("PATCH", `/api/installment-plans/${plan.id}`, { firstDueDate: "2026-11-21" }); // Aban 30
    expect(moved.status).toBe(200);
    expect(moved.json.plan.dueDay).toBe(30);
    expect(moved.json.plan.installments.map((i: { dueDate: string }) => jal(i.dueDate))).toEqual([
      [1405, 8, 30],
      [1405, 9, 30],
    ]);

    const account = (await server.mustWeb("POST", "/api/accounts", { name: "نقد", type: "CASH", initialBalance: 1000 })).account;
    await server.mustWeb("POST", `/api/installments/${plan.installments[0].id}/pay`, { accountId: account.id });
    const refused = await server.web("PATCH", `/api/installment-plans/${plan.id}`, { firstDueDate: "2027-01-01" });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toContain("قابل تغییر نیست");
  });
});

describe("overlapping time", () => {
  it("refuses a task on top of another, names it, and saves when told to", async () => {
    await server.registerUser();
    const first = (await server.mustWeb("POST", "/api/tasks", { title: "مطالعه", startAt: at(21, 9), endAt: at(21, 11) })).task;

    const refused = await server.web("POST", "/api/tasks", { title: "ورزش", startAt: at(21, 10), endAt: at(21, 12) });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe("TASK-002");
    expect(refused.json.error).toContain("«مطالعه»");
    expect(refused.json.details.conflicts).toEqual([{ kind: "TASK", id: first.id, title: "مطالعه", start: at(21, 9), end: at(21, 11) }]);
    expect(refused.json.requestId).toBeTruthy();

    const forced = await server.web("POST", "/api/tasks", { title: "ورزش", startAt: at(21, 10), endAt: at(21, 12), allowOverlap: true });
    expect(forced.status).toBe(201);
    expect(forced.json.task).not.toHaveProperty("allowOverlap");
  });

  it("checks a moved task but not one that is merely ticked done", async () => {
    await server.registerUser();
    const a = (await server.mustWeb("POST", "/api/tasks", { title: "الف", startAt: at(21, 9), endAt: at(21, 10) })).task;
    await server.mustWeb("POST", "/api/tasks", { title: "ب", startAt: at(21, 13), endAt: at(21, 14) });

    expect((await server.web("PATCH", `/api/tasks/${a.id}`, { startAt: at(21, 9, 30), endAt: at(21, 10, 30) })).status).toBe(200); // itself
    const refused = await server.web("PATCH", `/api/tasks/${a.id}`, { startAt: at(21, 12, 30), endAt: at(21, 13, 30) });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe("TASK-002");
    expect((await server.web("PATCH", `/api/tasks/${a.id}`, { status: "DONE" })).status).toBe(200);
    expect((await server.web("PATCH", `/api/tasks/${a.id}`, { startAt: at(21, 12, 30), endAt: at(21, 13, 30), allowOverlap: true })).status).toBe(200);
  });

  it("checks timed events against tasks, but leaves all-day events and recurring series alone when they are created", async () => {
    await server.registerUser();
    await server.mustWeb("POST", "/api/tasks", { title: "کار", startAt: at(21, 9), endAt: at(21, 10) });

    const refused = await server.web("POST", "/api/events", { title: "جلسه", startAt: at(21, 9, 30), endAt: at(21, 10, 30) });
    expect(refused.status).toBe(409);
    expect(refused.json.details.conflicts[0]).toMatchObject({ kind: "TASK", title: "کار" });

    expect((await server.web("POST", "/api/events", { title: "تعطیل", startAt: at(21, 0), endAt: at(21, 23, 59), allDay: true })).status).toBe(201);
    expect((await server.web("POST", "/api/events", { title: "تکراری", startAt: at(21, 9), endAt: at(21, 10), recurrenceFreq: "DAILY" })).status).toBe(201);
  });

  it("sees the occurrences of a recurring series and moving an event is checked against everything else", async () => {
    await server.registerUser();
    const series = (await server.mustWeb("POST", "/api/events", { title: "ورزش", startAt: at(20, 6), endAt: at(20, 7), recurrenceFreq: "DAILY" })).event;
    const refused = await server.web("POST", "/api/tasks", { title: "خواندن", startAt: at(23, 6, 30), endAt: at(23, 7, 30) });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toContain("«ورزش»");

    const meeting = (await server.mustWeb("POST", "/api/events", { title: "جلسه", startAt: at(21, 14), endAt: at(21, 15) })).event;
    await server.mustWeb("POST", "/api/tasks", { title: "کار", startAt: at(21, 16), endAt: at(21, 17) });
    expect((await server.web("PATCH", `/api/events/${meeting.id}`, { startAt: at(21, 14, 30), endAt: at(21, 15, 30) })).status).toBe(200);
    const clash = await server.web("PATCH", `/api/events/${meeting.id}`, { startAt: at(21, 16, 30), endAt: at(21, 17, 30) });
    expect(clash.status).toBe(409);
    expect(series.id).toBeTruthy();
  });
});

describe("daily notes", () => {
  it("creates, lists by day and by range, edits, deletes — each leaving an audit entry", async () => {
    const { userId } = await server.registerUser();
    const a = (await server.mustWeb("POST", "/api/notes", { day: "2026-09-21", content: "  اول  " })).note;
    const b = (await server.mustWeb("POST", "/api/notes", { day: "2026-09-21", content: "دوم" })).note;
    await server.mustWeb("POST", "/api/notes", { day: "2026-09-25", content: "سوم" });
    expect(a.content).toBe("اول"); // trimmed

    expect((await server.mustWeb("GET", "/api/notes?day=2026-09-21")).notes.map((n: { content: string }) => n.content)).toEqual(["اول", "دوم"]);
    expect((await server.mustWeb("GET", "/api/notes?from=2026-09-22&to=2026-09-30")).notes).toHaveLength(1);
    expect((await server.mustWeb("GET", "/api/notes")).notes).toHaveLength(3);

    const edited = await server.web("PATCH", `/api/notes/${a.id}`, { content: "اول (ویرایش)" });
    expect(edited.status).toBe(200);
    expect(edited.json.note.content).toBe("اول (ویرایش)");
    expect((await server.web("DELETE", `/api/notes/${b.id}`)).status).toBe(200);
    expect((await server.mustWeb("GET", "/api/notes?day=2026-09-21")).notes).toHaveLength(1);

    const audit = await server.prisma.auditLog.findMany({ where: { userId, entityType: "DailyNote" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row: { action: string }) => row.action)).toEqual(["CREATE", "CREATE", "CREATE", "UPDATE", "DELETE"]);
    expect(audit.filter((row: { event: string | null }) => row.event === "NOTE_CREATED")).toHaveLength(3);
  });

  it("refuses an empty note, an impossible day and someone else's note", async () => {
    await server.registerUser();
    expect((await server.web("POST", "/api/notes", { day: "2026-09-21", content: "   " })).status).toBe(400);
    expect((await server.web("POST", "/api/notes", { day: "2026-02-31", content: "x" })).status).toBe(400);
    expect((await server.web("GET", "/api/notes?day=nope")).status).toBe(400);
    expect((await server.web("GET", "/api/notes?day=2026-09-21&from=2026-09-01")).status).toBe(400);

    const mine = (await server.mustWeb("POST", "/api/notes", { day: "2026-09-21", content: "خصوصی" })).note;
    await server.registerUser();
    expect((await server.web("PATCH", `/api/notes/${mine.id}`, { content: "دزدی" })).status).toBe(404);
    expect((await server.web("DELETE", `/api/notes/${mine.id}`)).status).toBe(404);
    expect((await server.mustWeb("GET", "/api/notes")).notes).toEqual([]);
  });

  it("travels between the web and the phone in both directions", async () => {
    const account = await server.registerUser();
    const phone = await createPhone();
    linkPhone(phone, account);
    const fromPhone = phone.must("POST", "/api/notes", { day: "2026-09-21", content: "از گوشی" }).note;
    const fromWeb = (await server.mustWeb("POST", "/api/notes", { day: "2026-09-21", content: "از وب" })).note;

    const rounds = await syncUntilQuiet(phone);
    expect(rounds.every((r) => !r.error && r.rejectedCount === 0)).toBe(true);

    // the phone's note reached the server, the web's reached the phone — two notes on one day, no clash
    expect((await server.mustWeb("GET", "/api/notes?day=2026-09-21")).notes.map((n: { id: string }) => n.id).sort()).toEqual([fromPhone.id, fromWeb.id].sort());
    phone.activate();
    expect(phone.must("GET", "/api/notes?day=2026-09-21").notes.map((n: { id: string }) => n.id).sort()).toEqual([fromPhone.id, fromWeb.id].sort());

    // an edit and a delete travel too
    await server.mustWeb("PATCH", `/api/notes/${fromWeb.id}`, { content: "از وب (ویرایش)" });
    await new Promise((r) => setTimeout(r, 1200));
    await syncUntilQuiet(phone);
    phone.activate();
    expect(phone.must("GET", "/api/notes?day=2026-09-21").notes.find((n: { id: string }) => n.id === fromWeb.id).content).toBe("از وب (ویرایش)");
  });
});

describe("search", () => {
  it("shows a task's day, hours, length, hidden cost and money, and finds it however it is spelled", async () => {
    const { userId } = await server.registerUser();
    await server.prisma.settings.update({ where: { userId }, data: { hourlyValueOverride: 120_000 } });
    const task = (await server.mustWeb("POST", "/api/tasks", { title: "می‌خوانم کتاب", startAt: at(21, 9), endAt: at(21, 10, 30), directCost: 50_000, status: "DONE" })).task;

    for (const query of ["میخوانم", "كتاب", "می‌خوانم کتاب"]) {
      const { results } = (await server.mustWeb("GET", `/api/search?q=${encodeURIComponent(query)}`)) as { results: TimedSearchResult[] };
      const found = results.find((r) => r.type === "TASK");
      expect(found, `"${query}" finds the task`).toBeDefined();
      expect(found).toMatchObject({ id: task.id, day: "2026-09-21", durationMin: 90, done: true, directCost: 50_000, timeCost: 180_000, hiddenCost: 230_000 });
      expect(found!.href).toBe(`/calendar?day=2026-09-21&item=${task.id}`);
    }
    // the expense the task's own cost created is not a second result
    const { results } = await server.mustWeb("GET", `/api/search?q=${encodeURIComponent("کتاب")}`);
    expect(results.filter((r: { type: string }) => r.type === "TRANSACTION")).toEqual([]);
  });

  it("finds a note by what is inside it, showing the words around the match", async () => {
    await server.registerUser();
    const note = (await server.mustWeb("POST", "/api/notes", { day: "2026-09-21", content: "امروز درباره‌ی هزینه پنهان با تیم حرف زدیم و نتیجه خوب بود" })).note;
    const { results } = (await server.mustWeb("GET", `/api/search?q=${encodeURIComponent("هزینه پنهان")}`)) as { results: NoteSearchResult[] };
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: "NOTE", id: note.id, day: "2026-09-21", href: `/calendar?day=2026-09-21&item=${note.id}` });
    expect(results[0].snippet).toContain("هزینه پنهان");
  });

  it("summarises an installment plan and counts a habit's and a category's days and time", async () => {
    const { userId } = await server.registerUser();
    const plan = (await server.mustWeb("POST", "/api/installment-plans", { title: "وام خودرو", totalAmount: 3_000_000, installmentAmount: 1_000_000, numberOfInstallments: 3, firstDueDate: "2026-10-05" })).plan;
    const account = (await server.mustWeb("POST", "/api/accounts", { name: "نقد", type: "CASH", initialBalance: 5_000_000 })).account;
    await server.mustWeb("POST", `/api/installments/${plan.installments[0].id}/pay`, { accountId: account.id });

    const category = (await server.mustWeb("POST", "/api/categories", { name: "یادگیری تخصصی", kind: "PRODUCTIVE" })).category;
    const habit = (await server.mustWeb("POST", "/api/habits", { title: "یادگیری روزانه", categoryId: category.id })).habit;
    for (const day of [10, 11]) {
      await server.mustWeb("POST", `/api/habits/${habit.id}/checkin`, { date: new Date(2026, 8, day).toISOString() });
      await server.mustWeb("PATCH", `/api/habits/${habit.id}/checkin`, { date: new Date(2026, 8, day).toISOString(), durationMin: 30 });
    }
    await server.mustWeb("POST", "/api/tasks", { title: "دوره", categoryId: category.id, startAt: at(12, 9), endAt: at(12, 10) });

    const plans = (await server.mustWeb("GET", `/api/search?q=${encodeURIComponent("وام")}`)).results as PlanSearchResult[];
    expect(plans[0]).toMatchObject({ type: "INSTALLMENT", id: plan.id, totalAmount: 3_000_000, paidAmount: 1_000_000, unpaidAmount: 2_000_000, paidCount: 1, totalCount: 3 });
    expect(new Date(plans[0].nextDueDate!).getTime()).toBe(new Date(plan.installments[1].dueDate).getTime());

    const stats = (await server.mustWeb("GET", `/api/search?q=${encodeURIComponent("یادگیری")}`)).results as StatsSearchResult[];
    const habitResult = stats.find((r) => r.type === "HABIT")!;
    // (the default «یادگیری» category matches too — the one made here is found by its id)
    const categoryResult = stats.find((r) => r.type === "CATEGORY" && r.id === category.id)!;
    expect(habitResult).toMatchObject({ doneDays: 2, totalMinutes: 60, lastDay: "2026-09-11" });
    expect(habitResult.href).toBe(`/reports?tab=categoryCalendar&category=${category.id}&day=2026-09-11`);
    // the category holds the habit's hour on 2 days plus the task's hour on a third
    expect(categoryResult).toMatchObject({ doneDays: 3, totalMinutes: 120, lastDay: "2026-09-12" });
    expect(userId).toBeTruthy();
  });

  it("finds an activity and totals its time", async () => {
    await server.registerUser();
    const activity = (await server.mustWeb("POST", "/api/activities", { title: "کدنویسی روزانه", durationMin: 45 })).activity;
    const { results } = (await server.mustWeb("GET", `/api/search?q=${encodeURIComponent("کدنویسی")}`)) as { results: Array<{ type: string; id: string; totalMinutes?: number; doneDays?: number }> };
    const found = results.find((r) => r.type === "ACTIVITY");
    expect(found).toMatchObject({ id: activity.id, totalMinutes: activity.totalDurationMin });
    expect(activity.totalDurationMin).toBeGreaterThan(0);
  });

  it("returns nothing for an empty query and never shows another person's data", async () => {
    await server.registerUser();
    await server.mustWeb("POST", "/api/tasks", { title: "راز خصوصی" });
    await server.registerUser();
    expect((await server.mustWeb("GET", "/api/search?q=")).results).toEqual([]);
    expect((await server.mustWeb("GET", `/api/search?q=${encodeURIComponent("راز")}`)).results).toEqual([]);
  });
});

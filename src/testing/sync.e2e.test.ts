// End-to-end sync suite: the real phone code (on-device repositories + the real syncWithServer
// entry point) talking to the real server route handlers and a real Prisma database, with the
// production proxy's 1 MB request cap simulated. See syncHarness.ts for what is and isn't real.
//
// These are the tests that would have caught "sync never works": src/local/sync.test.ts mocks the
// network, so it never noticed that the server refused nearly every row a phone actually sends.
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
}));
vi.mock("@/lib/versionGate", () => ({ cacheVersionGate: async () => {}, checkVersionGate: async () => ({ blocked: false }) }));

import { createPhone, createServerHarness, type Phone, type ServerHarness } from "@/testing/syncHarness";
import { expectEndpointParity, iso, linkPhone, syncPhone, syncUntilQuiet, type Account } from "@/testing/syncScenarios";
import { AccountSwitchRequired, completeFirstRun, syncWithServer } from "@/lib/nativeOnboarding";
import { getLinkedAccount } from "@/local/accountSwitch";
import { DEFAULT_CATEGORIES } from "@/lib/defaultCategories";
import { SYNC_TABLES } from "@/lib/syncTables";

let server: ServerHarness;

beforeAll(async () => {
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true } });
  server = await createServerHarness();
}, 120_000);

afterAll(async () => {
  await server.dispose();
});

const tick = (ms = 8) => new Promise((r) => setTimeout(r, ms));

async function linkedPhone(account: Account): Promise<Phone> {
  const phone = await createPhone();
  linkPhone(phone, account);
  return phone;
}

async function serverCount(model: string, account: Account, extra: Record<string, unknown> = {}) {
  const config = SYNC_TABLES.find((t) => t.model === model)!;
  const where = config.ownership.type === "direct" ? { userId: account.userId, ...extra } : { [config.ownership.relationField]: { userId: account.userId }, ...extra };
  return server.prisma[model].count({ where });
}

function localCount(phone: Phone, table: string, where = "1=1", params: unknown[] = []) {
  phone.activate();
  return phone.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}" WHERE ${where}`, params)!.n;
}

const LIST_ENDPOINTS = ["/api/categories", "/api/projects", "/api/tasks", "/api/accounts", "/api/transactions", "/api/installment-plans", "/api/assets", "/api/activities", "/api/habits"];

function createEverythingOnPhone(phone: Phone) {
  const cats = phone.must("GET", "/api/categories").categories as Array<{ id: string; name: string }>;
  const work = cats.find((c) => c.name === "کار")!;
  const sport = phone.must("POST", "/api/categories", { name: "ورزش", kind: "PRODUCTIVE", generatesVirtualAsset: true, virtualAssetValuePerHour: 50000 }).category;
  phone.must("POST", "/api/categories", { name: "پوش‌آپ", parentCategoryId: sport.id });
  const project = phone.must("POST", "/api/projects", { name: "پروژه تست" }).project;
  const acct = phone.must("POST", "/api/accounts", { name: "بانک", type: "BANK_ACCOUNT", initialBalance: 1_000_000 }).account;
  phone.must("POST", "/api/tasks", { title: "تسک ۱", categoryId: work.id, projectId: project.id, directCost: 5000, estimatedCost: 20000, dueDate: iso(1) });
  phone.must("POST", "/api/tasks", { title: "تسک بدون دسته" });
  phone.must("POST", "/api/activities", { title: "فعالیت", categoryId: sport.id, durationMin: 45 });
  const event = phone.must("POST", "/api/events", { title: "جلسه", startAt: iso(1, 10), endAt: iso(1, 11), categoryId: work.id, reminderOffsets: [10] }).event;
  const habit = phone.must("POST", "/api/habits", { title: "مطالعه", categoryId: work.id, virtualAssetValuePerCheckIn: 1000 }).habit;
  phone.must("POST", `/api/habits/${habit.id}/checkin`, {});
  phone.must("POST", "/api/transactions", { type: "EXPENSE", amount: 12_000, accountId: acct.id, categoryId: work.id, description: "خرج" });
  phone.must("POST", "/api/installment-plans", { title: "قسط", totalAmount: 1_200_000, installmentAmount: 100_000, numberOfInstallments: 12, dueDay: 5, reminderOffsets: [1440] });
  phone.must("POST", "/api/assets", { name: "ماشین", purchasePrice: 500_000_000, currentValue: 450_000_000 });
  return { work, sport, project, acct, event, habit };
}

async function createEverythingOnWeb() {
  const w = (m: string, u: string, b?: unknown) => server.mustWeb(m, u, b);
  const cats = (await w("GET", "/api/categories")).categories as Array<{ id: string; name: string }>;
  const work = cats.find((c) => c.name === "کار")!;
  const sport = (await w("POST", "/api/categories", { name: "ورزش وب", kind: "PRODUCTIVE", generatesVirtualAsset: true, virtualAssetValuePerHour: 50000 })).category;
  await w("POST", "/api/categories", { name: "زیر ورزش", parentCategoryId: sport.id });
  const project = (await w("POST", "/api/projects", { name: "پروژه وب" })).project;
  const acct = (await w("POST", "/api/accounts", { name: "بانک وب", type: "BANK_ACCOUNT", initialBalance: 500000 })).account;
  await w("POST", "/api/tasks", { title: "تسک وب", categoryId: work.id, projectId: project.id, directCost: 7000, dueDate: iso(2) });
  await w("POST", "/api/activities", { title: "فعالیت وب", categoryId: sport.id, durationMin: 30 });
  const event = (await w("POST", "/api/events", { title: "رویداد وب", startAt: iso(1, 10), endAt: iso(1, 11), categoryId: work.id, reminderOffsets: [10] })).event;
  const habit = (await w("POST", "/api/habits", { title: "عادت وب", categoryId: work.id, virtualAssetValuePerCheckIn: 1000 })).habit;
  await w("POST", `/api/habits/${habit.id}/checkin`, {});
  await w("POST", "/api/transactions", { type: "EXPENSE", amount: 9000, accountId: acct.id, categoryId: work.id });
  await w("POST", "/api/installment-plans", { title: "قسط وب", totalAmount: 600000, installmentAmount: 100000, numberOfInstallments: 6, dueDay: 5, reminderOffsets: [1440] });
  await w("POST", "/api/assets", { name: "دارایی وب", purchasePrice: 1000000, currentValue: 900000 });
  return { work, sport, project, acct, event, habit };
}

describe("phone -> server -> web", () => {
  it("delivers every table's rows, and the web shows the same thing the phone does", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    createEverythingOnPhone(phone);

    const rounds = await syncUntilQuiet(phone);

    for (const r of rounds) {
      expect(r.error, r.error?.message).toBeUndefined();
      expect(r.rejectedCount, JSON.stringify(r.issues)).toBe(0);
    }
    const last = rounds[rounds.length - 1];
    expect(last.pushedCount + last.pulledCount).toBe(0); // converged: nothing left to say either way

    for (const t of SYNC_TABLES) {
      expect(await serverCount(t.model, account), `${t.table} row count, server`).toBe(localCount(phone, t.table));
    }
    for (const url of LIST_ENDPOINTS) await expectEndpointParity(server, phone, url);
  });

  it("a second sync with nothing changed makes no push request at all", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    createEverythingOnPhone(phone);
    await syncUntilQuiet(phone);
    // The push cursor re-reads the last second before it, so the sync right after another may
    // re-send what that one itself touched (e.g. the category merge) — once. In real use syncs are
    // seconds apart; here two short waits stand in for that.
    await tick(1200);
    await syncPhone(phone);
    await tick(1200);

    server.wireLog.length = 0;
    const outcome = await syncPhone(phone);

    expect(outcome.ok).toBe(true);
    expect(server.wireLog.filter((l) => l.path.endsWith("/push"))).toHaveLength(0);
  });

  it("a soft-delete on the phone (task, habit, event) disappears from the web", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    const { event, habit } = createEverythingOnPhone(phone);
    const task = phone.must("GET", "/api/tasks").tasks.find((t: { title: string }) => t.title === "تسک بدون دسته");
    await syncUntilQuiet(phone);
    expect((await server.mustWeb("GET", "/api/tasks")).tasks.map((t: { id: string }) => t.id)).toContain(task.id);

    await tick();
    phone.must("DELETE", `/api/tasks/${task.id}`);
    phone.must("DELETE", `/api/events/${event.id}`);
    phone.must("DELETE", `/api/habits/${habit.id}`);
    await syncUntilQuiet(phone);

    expect((await server.mustWeb("GET", "/api/tasks")).tasks.map((t: { id: string }) => t.id)).not.toContain(task.id);
    expect(await serverCount("event", account, { deletedAt: null })).toBe(0);
    expect(await serverCount("habit", account, { deletedAt: null })).toBe(0);
  });

  it("removing the linked expense by clearing a task's direct cost reaches the server (a soft-delete must bump updatedAt)", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    const task = phone.must("POST", "/api/tasks", { title: "با هزینه", directCost: 8000 }).task;
    await syncUntilQuiet(phone);
    expect(await serverCount("transaction", account, { deletedAt: null })).toBe(1);

    await tick();
    phone.must("PATCH", `/api/tasks/${task.id}`, { directCost: 0 });
    await syncUntilQuiet(phone);

    expect(await serverCount("transaction", account, { deletedAt: null })).toBe(0);
  });
});

describe("web -> server -> phone", () => {
  it("everything created through the web routes reaches a phone that links afterwards, and reads the same", async () => {
    const account = await server.registerUser();
    await createEverythingOnWeb();

    const phone = await linkedPhone(account);
    const rounds = await syncUntilQuiet(phone);
    for (const r of rounds) expect(r.error, r.error?.message).toBeUndefined();

    for (const t of SYNC_TABLES) {
      expect(localCount(phone, t.table), `${t.table} row count, phone`).toBe(await serverCount(t.model, account));
    }
    for (const url of LIST_ENDPOINTS) await expectEndpointParity(server, phone, url);
  });

  it("an edit on the web shows up on the phone, and a later edit on the phone shows up on the web (last write wins)", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    const task = phone.must("POST", "/api/tasks", { title: "اولیه" }).task;
    await syncUntilQuiet(phone);

    await tick();
    server.setWebSession(account.token);
    await server.mustWeb("PATCH", `/api/tasks/${task.id}`, { title: "ویرایش وب" });
    await syncUntilQuiet(phone);
    expect(phone.must("GET", "/api/tasks").tasks.find((t: { id: string }) => t.id === task.id).title).toBe("ویرایش وب");

    await tick();
    phone.must("PATCH", `/api/tasks/${task.id}`, { title: "ویرایش گوشی", status: "DONE" });
    await syncUntilQuiet(phone);
    const onWeb = (await server.mustWeb("GET", "/api/tasks")).tasks.find((t: { id: string }) => t.id === task.id);
    expect(onWeb.title).toBe("ویرایش گوشی");
    expect(onWeb.status).toBe("DONE");
  });

  it("a category deleted on the web disappears from the phone", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    await syncUntilQuiet(phone);
    const cat = (await server.mustWeb("POST", "/api/categories", { name: "موقت" })).category;
    await syncUntilQuiet(phone);
    expect(phone.must("GET", "/api/categories").categories.map((c: { id: string }) => c.id)).toContain(cat.id);

    await tick();
    await server.mustWeb("DELETE", `/api/categories/${cat.id}`);
    await syncUntilQuiet(phone);

    expect(phone.must("GET", "/api/categories").categories.map((c: { id: string }) => c.id)).not.toContain(cat.id);
  });
});

describe("hard deletes travel as tombstones", () => {
  it("un-checking a habit on the web un-checks it on the phone, and the other way round", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    const habit = phone.must("POST", "/api/habits", { title: "ورزش صبحگاهی", virtualAssetValuePerCheckIn: 2000 }).habit;
    phone.must("POST", `/api/habits/${habit.id}/checkin`, {});
    await syncUntilQuiet(phone);
    expect(await serverCount("habitCheckIn", account)).toBe(1);
    expect(await serverCount("virtualAssetEntry", account)).toBe(1);

    // web un-checks (toggle) -> phone must lose the check-in and its virtual asset
    await tick();
    server.setWebSession(account.token);
    await server.mustWeb("POST", `/api/habits/${habit.id}/checkin`, {});
    expect(await serverCount("habitCheckIn", account)).toBe(0);
    await syncUntilQuiet(phone);
    expect(localCount(phone, "HabitCheckIn")).toBe(0);
    expect(localCount(phone, "VirtualAssetEntry")).toBe(0);

    // web checks again -> phone gains it; phone un-checks -> web loses it
    await tick();
    await server.mustWeb("POST", `/api/habits/${habit.id}/checkin`, {});
    await syncUntilQuiet(phone);
    expect(localCount(phone, "HabitCheckIn")).toBe(1);
    await tick();
    phone.must("POST", `/api/habits/${habit.id}/checkin`, {});
    expect(localCount(phone, "HabitCheckIn")).toBe(0);
    const rounds = await syncUntilQuiet(phone);
    expect(rounds[0].deletionsPushed).toBeGreaterThan(0);
    expect(await serverCount("habitCheckIn", account)).toBe(0);
    expect(await serverCount("virtualAssetEntry", account)).toBe(0);
  });

  it("un-checking on the phone and re-checking straight away doesn't leave the server with a stale row", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    const habit = phone.must("POST", "/api/habits", { title: "نوشیدن آب" }).habit;
    phone.must("POST", `/api/habits/${habit.id}/checkin`, {});
    await syncUntilQuiet(phone);

    await tick();
    phone.must("POST", `/api/habits/${habit.id}/checkin`, {}); // un-check (row A deleted)
    phone.must("POST", `/api/habits/${habit.id}/checkin`, {}); // re-check (row B, same habit + day)
    const rounds = await syncUntilQuiet(phone);

    for (const r of rounds) expect(r.rejectedCount).toBe(0);
    expect(await serverCount("habitCheckIn", account)).toBe(1);
    const ids = server.prisma.habitCheckIn.findMany({ where: { habit: { userId: account.userId } } });
    expect((await ids).map((r: { id: string }) => r.id)).toEqual([phone.db.get<{ id: string }>(`SELECT "id" FROM "HabitCheckIn"`)!.id]);
  });

  it("toggling an event's completion and deleting a reminder propagate both ways", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    const event = phone.must("POST", "/api/events", { title: "جلسه", startAt: iso(0, 10), endAt: iso(0, 11), reminderOffsets: [10, 60] }).event;
    await syncUntilQuiet(phone);
    expect(await serverCount("reminder", account)).toBe(2);

    await tick();
    phone.must("POST", `/api/events/${event.id}/complete`, { occurrenceDate: event.startAt });
    await syncUntilQuiet(phone);
    expect(await serverCount("eventCompletion", account)).toBe(1);

    await tick();
    server.setWebSession(account.token);
    await server.mustWeb("POST", `/api/events/${event.id}/complete`, { occurrenceDate: event.startAt }); // toggles off
    const reminder = await server.prisma.reminder.findFirst({ where: { userId: account.userId } });
    await server.mustWeb("DELETE", `/api/reminders/${reminder.id}`);
    await syncUntilQuiet(phone);

    expect(localCount(phone, "EventCompletion")).toBe(0);
    expect(localCount(phone, "Reminder")).toBe(1);

    await tick();
    const local = phone.db.get<{ id: string }>(`SELECT "id" FROM "Reminder"`)!;
    phone.must("DELETE", `/api/reminders/${local.id}`);
    await syncUntilQuiet(phone);
    expect(await serverCount("reminder", account)).toBe(0);
  });
});

describe("first link of a fresh phone to an account", () => {
  it("does not leave the account with two copies of every default category", async () => {
    const account = await server.registerUser(); // the server seeds its own default categories at registration
    const phone = await linkedPhone(account); // ...and the phone seeded its own at first boot
    await syncUntilQuiet(phone);

    const live = (rows: Array<{ name: string }>) => rows.map((r) => r.name).sort();
    const onServer = live(await server.prisma.category.findMany({ where: { userId: account.userId, deletedAt: null } }));
    const onPhone = live(phone.db.all<{ name: string }>(`SELECT "name" FROM "Category" WHERE "deletedAt" IS NULL`));
    expect(onServer).toEqual(live(DEFAULT_CATEGORIES.map((c) => ({ name: c.name }))));
    expect(onPhone).toEqual(onServer);
    const web = (await server.mustWeb("GET", "/api/categories")).categories as Array<{ name: string }>;
    expect(live(web)).toEqual(onServer);
  });

  it("tasks the web user had filed under the server's own default categories still point at a live category", async () => {
    const account = await server.registerUser();
    const work = ((await server.mustWeb("GET", "/api/categories")).categories as Array<{ id: string; name: string }>).find((c) => c.name === "کار")!;
    await server.mustWeb("POST", "/api/tasks", { title: "کار وب", categoryId: work.id });

    const phone = await linkedPhone(account);
    await syncUntilQuiet(phone);

    const task = (await server.mustWeb("GET", "/api/tasks")).tasks.find((t: { title: string }) => t.title === "کار وب");
    expect(task.category?.name).toBe("کار");
    const onPhone = phone.must("GET", "/api/tasks").tasks.find((t: { title: string }) => t.title === "کار وب");
    expect(onPhone.category?.name).toBe("کار");
    expect(onPhone.category.id).toBe(task.category.id);
  });
});

describe("size and robustness", () => {
  it("syncs a phone with far more data than one request may carry, without hitting the proxy's body limit", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    phone.activate();
    const filler = "متن طولانی برای پر کردن حجم درخواست. ".repeat(40);
    const now = new Date().toISOString();
    for (let i = 0; i < 1500; i++) {
      phone.db.run(`INSERT INTO "Task" ("id","userId","title","description","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [`bulk_${i}`, "local-device-user", `تسک ${i}`, filler, now, now]);
    }

    server.wireLog.length = 0;
    const outcome = await syncPhone(phone);

    expect(outcome.error?.message).toBeUndefined();
    const pushes = server.wireLog.filter((l) => l.path.endsWith("/push"));
    expect(pushes.length).toBeGreaterThan(3);
    expect(pushes.every((p) => p.status === 200 && p.requestBytes < 1_000_000)).toBe(true);
    expect(await serverCount("task", account)).toBe(1500);
  }, 120_000);

  it("reports why a row was refused, keeps trying it, and delivers it once its parent exists", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    phone.activate();
    phone.db.execute("PRAGMA foreign_keys = OFF");
    const now = new Date().toISOString();
    phone.db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","accountId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
      ["orphan_tx", "local-device-user", "EXPENSE", 5000, now, "account_not_here_yet", now, now]
    );

    const first = await syncPhone(phone);
    expect(first.ok).toBe(true);
    expect(first.rejectedCount).toBe(1);
    expect(first.issues[0]).toMatchObject({ table: "Transaction", id: "orphan_tx" });
    expect(first.issues[0].reason).toMatch(/foreign key|parent/i);

    await tick();
    phone.db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["account_not_here_yet", "local-device-user", "دیررسیده", now, now]);
    const rounds = await syncUntilQuiet(phone);
    expect(rounds.every((r) => r.rejectedCount === 0)).toBe(true);
    expect(await serverCount("transaction", account)).toBe(1);
  });

  it("concurrent sync requests don't run in parallel — they collapse into at most one extra run", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    phone.must("POST", "/api/tasks", { title: "همزمان" });

    server.wireLog.length = 0;
    phone.activate();
    const outcomes = await Promise.all([syncWithServer(), syncWithServer(), syncWithServer(), syncWithServer(), syncWithServer()]);

    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(server.wireLog.filter((l) => l.path.endsWith("/push")).length).toBeLessThanOrEqual(2);
    expect(await serverCount("task", account)).toBe(1);
  });

  it("a change another device pushed late (its edit predates the receiving device's last pull) still arrives on a deep sync", async () => {
    const account = await server.registerUser();
    const phoneA = await linkedPhone(account);
    const phoneB = await linkedPhone(account);
    await syncUntilQuiet(phoneA);
    await syncUntilQuiet(phoneB);

    // A was offline for two days: its cursors are two days old, and it made an edit yesterday that
    // it only now gets to push — the row's edit time is a day old.
    phoneA.activate();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    phoneA.db.run(`UPDATE "_local_license_cache" SET "lastPushedAt" = ?, "lastPulledAt" = ?`, [twoDaysAgo, twoDaysAgo]);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    phoneA.db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["late_task", "local-device-user", "کار آفلاین دیروز", yesterday, yesterday]);
    await syncUntilQuiet(phoneA);

    const shallow = await syncPhone(phoneB, { deep: false });
    expect(shallow.pulledCount).toBe(0); // a tight cursor can't see a day-old edit — that is exactly the gap
    const deep = await syncPhone(phoneB, { deep: true });
    expect(deep.pulledCount).toBeGreaterThan(0);
    expect(localCount(phoneB, "Task", `"id" = ?`, ["late_task"])).toBe(1);
  });
});

describe("display name and preferences", () => {
  it("a phone that links to an account adopts the account's name and settings instead of overwriting them with defaults", async () => {
    const account = await server.registerUser();
    server.setWebSession(account.token);
    await tick(15);
    await server.mustWeb("PATCH", "/api/settings", { name: "مهدی وب", currencyDisplayUnit: "RIAL", monthlyIncome: 40_000_000, workingHoursMonth: 160, wakeHour: 6, theme: "dark" });

    const phone = await linkedPhone(account);
    await syncUntilQuiet(phone);

    const s = phone.must("GET", "/api/settings");
    expect(s.user.name).toBe("مهدی وب");
    expect(s.settings).toMatchObject({ currencyDisplayUnit: "RIAL", monthlyIncome: 40_000_000, workingHoursMonth: 160, wakeHour: 6, theme: "dark" });
    // ...and did not push its own factory defaults up over them.
    const onServer = await server.mustWeb("GET", "/api/settings");
    expect(onServer.settings).toMatchObject({ currencyDisplayUnit: "RIAL", monthlyIncome: 40_000_000, theme: "dark" });
    expect(onServer.user.name).toBe("مهدی وب");
  });

  it("a settings change on the phone reaches the web, and a later one on the web reaches the phone", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    await syncUntilQuiet(phone);

    await tick(15);
    phone.must("PATCH", "/api/settings", { name: "از گوشی", currencyDisplayUnit: "THOUSAND_TOMAN", dailyMomentEnabled: false, sleepHour: 22 });
    await syncUntilQuiet(phone);
    server.setWebSession(account.token);
    const web1 = await server.mustWeb("GET", "/api/settings");
    expect(web1.user.name).toBe("از گوشی");
    expect(web1.settings).toMatchObject({ currencyDisplayUnit: "THOUSAND_TOMAN", dailyMomentEnabled: false, sleepHour: 22 });

    await tick(20);
    await server.mustWeb("PATCH", "/api/settings", { currencyDisplayUnit: "TOMAN", sleepHour: 23 });
    await syncUntilQuiet(phone);
    const s = phone.must("GET", "/api/settings");
    expect(s.settings).toMatchObject({ currencyDisplayUnit: "TOMAN", sleepHour: 23, dailyMomentEnabled: false });
  });

  it("merely reading settings never counts as an edit (updatedAt stays put on both platforms)", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    server.setWebSession(account.token);

    await server.mustWeb("GET", "/api/settings");
    const webBefore = (await server.prisma.settings.findUnique({ where: { userId: account.userId } })).updatedAt.getTime();
    const phoneBefore = phone.must("GET", "/api/settings").settings.updatedAt;
    await tick(15);
    await server.mustWeb("GET", "/api/settings");
    await server.mustWeb("GET", "/api/settings");
    phone.must("GET", "/api/settings");
    phone.must("GET", "/api/settings");

    expect((await server.prisma.settings.findUnique({ where: { userId: account.userId } })).updatedAt.getTime()).toBe(webBefore);
    expect(phone.must("GET", "/api/settings").settings.updatedAt).toBe(phoneBefore);
  });
});

describe("signing in as a different account on the same phone", () => {
  it("asks first, then replaces the previous account's data instead of pushing it into the new account", async () => {
    const accountA = await server.registerUser();
    const phone = await linkedPhone(accountA);
    const taskA = phone.must("POST", "/api/tasks", { title: "مال حساب اول" }).task;
    await syncUntilQuiet(phone);
    expect(await serverCount("task", accountA)).toBe(1);

    // Log out (what BottomNav does) and try signing in as B.
    phone.must("POST", "/api/local/logout");
    const accountB = await server.registerUser();
    server.setWebSession(accountB.token);
    await server.mustWeb("POST", "/api/tasks", { title: "مال حساب دوم" });
    phone.activate();

    await expect(completeFirstRun({ mode: "login", email: accountB.email, password: "secret123" })).rejects.toBeInstanceOf(AccountSwitchRequired);
    expect(localCount(phone, "Task", `"id" = ?`, [taskA.id])).toBe(1); // nothing touched before the person agrees

    await completeFirstRun({ mode: "login", email: accountB.email, password: "secret123", confirmSwitch: true });
    await syncUntilQuiet(phone);

    const titles = phone.must("GET", "/api/tasks").tasks.map((t: { title: string }) => t.title);
    expect(titles).toEqual(["مال حساب دوم"]);
    expect(await serverCount("task", accountA)).toBe(1); // A's server copy is untouched
    expect(await serverCount("task", accountB)).toBe(1); // ...and never received A's task
  });

  it("signing back in as the SAME account keeps everything and does not ask", async () => {
    const account = await server.registerUser();
    const phone = await linkedPhone(account);
    phone.must("POST", "/api/tasks", { title: "می‌ماند" });
    await syncUntilQuiet(phone);

    phone.must("POST", "/api/local/logout");
    await completeFirstRun({ mode: "login", email: account.email, password: "secret123" });
    await syncUntilQuiet(phone);

    expect(phone.must("GET", "/api/tasks").tasks.map((t: { title: string }) => t.title)).toEqual(["می‌ماند"]);
    expect(await serverCount("task", account)).toBe(1);
  });

  it("a phone linked by an older build (which didn't remember its account) learns it on the first sync, so a later switch is still caught", async () => {
    const accountA = await server.registerUser();
    const phone = await createPhone();
    // Only the license cache, exactly what the previous build left behind — no linkedRemoteUserId.
    phone.must("POST", "/api/local/license-cache", {
      status: "TRIAL",
      trialDaysRemaining: 30,
      trialEndsAt: null,
      currentPeriodEnd: null,
      remoteUserId: accountA.userId,
      remoteEmail: accountA.email,
      token: accountA.token,
    });
    phone.must("POST", "/api/tasks", { title: "مال حساب قدیمی" });
    expect(getLinkedAccount(phone.db)).toBeNull();

    await syncUntilQuiet(phone);

    expect(getLinkedAccount(phone.db)).toEqual({ remoteUserId: accountA.userId, email: accountA.email });
    phone.must("POST", "/api/local/logout");
    const accountB = await server.registerUser();
    await expect(completeFirstRun({ mode: "login", email: accountB.email, password: "secret123" })).rejects.toBeInstanceOf(AccountSwitchRequired);
  });

  it("a phone that only ever worked offline keeps its data when it first links to an account", async () => {
    const phone = await createPhone();
    phone.must("POST", "/api/tasks", { title: "ثبت‌شده‌ی آفلاین" });
    const account = await server.registerUser();

    await completeFirstRun({ mode: "login", email: account.email, password: "secret123" });
    await syncUntilQuiet(phone);

    expect(await serverCount("task", account)).toBe(1);
    expect(phone.must("GET", "/api/tasks").tasks.map((t: { title: string }) => t.title)).toEqual(["ثبت‌شده‌ی آفلاین"]);
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import { resetLocalDbForTests } from "@/local/db";
import { createNodeSqliteDriver } from "@/local/drivers/nodeSqlite";
import { dispatchLocal, setLocalDbDriver } from "./localDispatcher";

describe("localDispatcher", () => {
  beforeEach(async () => {
    resetLocalDbForTests();
    setLocalDbDriver(await createNodeSqliteDriver(":memory:"));
  });

  it("creates and lists a task with the same JSON shape the web route returns", () => {
    const created = dispatchLocal("POST", "/api/tasks", { title: "خرید نان" });
    expect(created.status).toBe(201);
    const task = (created.json as any).task;
    expect(task.title).toBe("خرید نان");
    expect(task.status).toBe("TODO");

    const listed = dispatchLocal("GET", "/api/tasks");
    expect(listed.status).toBe(200);
    expect((listed.json as any).tasks).toHaveLength(1);
  });

  it("filters list queries via the querystring", () => {
    dispatchLocal("POST", "/api/tasks", { title: "الف", status: "DONE" });
    dispatchLocal("POST", "/api/tasks", { title: "ب", status: "TODO" });

    const done = dispatchLocal("GET", "/api/tasks?status=DONE");
    expect((done.json as any).tasks.map((t: any) => t.title)).toEqual(["الف"]);
  });

  it("routes :id params and PATCH/DELETE correctly", () => {
    const created = dispatchLocal("POST", "/api/tasks", { title: "کار" });
    const id = (created.json as any).task.id;

    const patched = dispatchLocal("PATCH", `/api/tasks/${id}`, { status: "DONE" });
    expect((patched.json as any).task.status).toBe("DONE");

    const deleted = dispatchLocal("DELETE", `/api/tasks/${id}`);
    expect((deleted.json as any).ok).toBe(true);
    expect((dispatchLocal("GET", "/api/tasks").json as any).tasks).toHaveLength(0);
  });

  it("maps validation errors to a 400 with the same error shape as handleApiError", () => {
    const res = dispatchLocal("POST", "/api/tasks", { title: "" });
    expect(res.status).toBe(400);
    expect((res.json as any).error).toBe("اطلاعات ارسالی نامعتبر است.");
  });

  it("maps a not-found ApiError to its declared status", () => {
    const res = dispatchLocal("PATCH", "/api/tasks/does-not-exist", { title: "x" });
    expect(res.status).toBe(404);
    expect((res.json as any).error).toBe("کار پیدا نشد.");
  });

  it("returns 404 for an unregistered route instead of throwing", () => {
    const res = dispatchLocal("GET", "/api/not-a-real-route");
    expect(res.status).toBe(404);
  });

  it("wires categories, projects, accounts, and transactions end-to-end through the dispatcher", () => {
    const category = (dispatchLocal("POST", "/api/categories", { name: "خانه" }).json as any).category;
    expect(dispatchLocal("GET", "/api/categories").status).toBe(200);

    const project = (dispatchLocal("POST", "/api/projects", { name: "پروژه من" }).json as any).project;
    expect((dispatchLocal("GET", `/api/projects/${project.id}`).json as any).project.id).toBe(project.id);
    // Creating a project auto-creates a paired category — should now show up in the list too.
    expect((dispatchLocal("GET", "/api/categories").json as any).categories.length).toBeGreaterThanOrEqual(2);

    const account = (dispatchLocal("POST", "/api/accounts", { name: "نقد" }).json as any).account;
    expect(account.balance).toBe(0);

    const txRes = dispatchLocal("POST", "/api/transactions", {
      type: "EXPENSE",
      amount: 50000,
      accountId: account.id,
      categoryId: category.id,
    });
    expect(txRes.status).toBe(201);
    const transaction = (txRes.json as any).transaction;
    expect(transaction.amount).toBe(50000);

    const listed = (dispatchLocal("GET", "/api/transactions").json as any).transactions;
    expect(listed[0].category.id).toBe(category.id); // GET list attaches relations, unlike POST's response
  });

  it("wires habits, activities, events, installments, assets, settings, notifications, and dashboard end-to-end", () => {
    // Habits: create, check in, log a duration.
    const habit = (dispatchLocal("POST", "/api/habits", { title: "مطالعه" }).json as any).habit;
    const checkin = dispatchLocal("POST", `/api/habits/${habit.id}/checkin`).json as any;
    expect(checkin.checkedIn).toBe(true);
    const duration = dispatchLocal("PATCH", `/api/habits/${habit.id}/checkin`, { durationMin: 20 }).json as any;
    expect(duration.checkIn.durationMin).toBe(20);
    expect((dispatchLocal("GET", "/api/habits").json as any).habits[0].checkedInToday).toBe(true);

    // Activities: create, start/stop a timer.
    const activity = (dispatchLocal("POST", "/api/activities", { title: "کدنویسی" }).json as any).activity;
    dispatchLocal("POST", `/api/activities/${activity.id}/timer/start`);
    const stopped = dispatchLocal("POST", `/api/activities/${activity.id}/timer/stop`).json as any;
    expect(stopped.activity.totalDurationMin).toBeGreaterThanOrEqual(0);

    // Events: create, complete an occurrence.
    const event = (
      dispatchLocal("POST", "/api/events", {
        title: "جلسه",
        startAt: "2026-05-01T08:00:00.000Z",
        endAt: "2026-05-01T09:00:00.000Z",
      }).json as any
    ).event;
    const completed = dispatchLocal("POST", `/api/events/${event.id}/complete`, { occurrenceDate: "2026-05-01T08:00:00.000Z" }).json as any;
    expect(completed.isDone).toBe(true);

    // Installments + Assets.
    const account = (dispatchLocal("POST", "/api/accounts", { name: "نقد" }).json as any).account;
    const plan = (
      dispatchLocal("POST", "/api/installment-plans", {
        title: "وام",
        totalAmount: 1000000,
        installmentAmount: 1000000,
        numberOfInstallments: 1,
        dueDay: 1,
      }).json as any
    ).plan;
    const paid = dispatchLocal("POST", `/api/installments/${plan.installments[0].id}/pay`, { accountId: account.id }).json as any;
    expect(paid.installment.status).toBe("PAID");

    const asset = (dispatchLocal("POST", "/api/assets", { name: "ماشین", purchasePrice: 100000000 }).json as any).asset;
    expect(asset.currentValue).toBe(100000000);

    // Settings.
    const settingsRes = dispatchLocal("PATCH", "/api/settings", { monthlyIncome: 50000000, workingHoursMonth: 160 }).json as any;
    expect(settingsRes.hourlyValue).toBeGreaterThan(0);

    // Notifications: at least does not throw, returns an envelope.
    expect((dispatchLocal("GET", "/api/notifications").json as any).notifications).toBeInstanceOf(Array);

    // Search finds the activity we created (search covers Task/Activity/Event/Transaction/
    // Asset/Project/Category — Habit was never in scope on the web route either).
    const searchResults = (dispatchLocal("GET", "/api/search?q=کدنویسی").json as any).results;
    expect(searchResults.some((r: any) => r.id === activity.id)).toBe(true);

    // Dashboard composes everything without throwing.
    const dashboard = dispatchLocal("GET", "/api/dashboard").json as any;
    expect(dashboard.netWorth).toBeDefined();
    expect(dashboard.today).toBeDefined();
  });
});

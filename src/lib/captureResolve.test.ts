import { describe, it, expect, beforeEach } from "vitest";
import { resetLocalDbForTests } from "@/local/db";
import { createNodeSqliteDriver } from "@/local/drivers/nodeSqlite";
import { dispatchLocal, setLocalDbDriver } from "./localDispatcher";
import { parseCaptureIntent } from "./captureIntent";
import { bestMatch, loadSnapshotSync, resolveCapture, snapshotNeeds, type CaptureResolution } from "./captureResolve";
import { runStepsSync } from "./captureSteps";

// Sunday 2026-05-10 09:00:30 — with seconds, like a real clock: a finished span ends at :00 of the minute, before "now".
const NOW = new Date(2026, 4, 10, 9, 0, 30);

function call(method: string, url: string, body?: unknown) {
  const res = dispatchLocal(method, url, body);
  if (res.status >= 400) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(res.json)}`);
  return res.json as any;
}

/** Types a line the way the phone does when the widget's queue is drained: resolve against what is there, then carry it out. */
function typeLine(text: string, now: Date = NOW): CaptureResolution {
  const intent = parseCaptureIntent(text, now);
  const snapshot = loadSnapshotSync(snapshotNeeds(intent), (url) => call("GET", url));
  const resolution = resolveCapture(intent, snapshot, now, { allowOverlap: true });
  runStepsSync(resolution.steps, (c) => call(c.method, c.url, c.body));
  return resolution;
}

const tasks = () => call("GET", "/api/tasks").tasks as any[];
const transactions = () => call("GET", "/api/transactions?limit=100").transactions as any[];

beforeEach(async () => {
  resetLocalDbForTests();
  setLocalDbDriver(await createNodeSqliteDriver(":memory:"));
});

describe("bestMatch", () => {
  const names = [{ n: "ورزش صبحگاهی" }, { n: "مطالعه کتاب" }, { n: "مدیتیشن شبانه" }];
  const pick = (hint: string) => bestMatch(hint, names, (x) => x.n)?.n ?? null;

  it("prefers the same name, then a name containing the hint, then a shared word", () => {
    expect(pick("مطالعه کتاب")).toBe("مطالعه کتاب");
    expect(pick("ورزش")).toBe("ورزش صبحگاهی");
    expect(pick("کتاب")).toBe("مطالعه کتاب");
    expect(pick("مدیتیشن صبحگاهی")).toBe("ورزش صبحگاهی"); // shares a whole word — the first list entry that does
    expect(pick("چیز دیگری")).toBeNull();
    expect(pick("")).toBeNull();
  });

  it("does not care about the zero-width joiner, spacing or Arabic letters", () => {
    const items = [{ n: "پس‌انداز ماشین" }];
    expect(bestMatch("پس انداز ماشين", items, (x) => x.n)).toBe(items[0]);
  });
});

describe("an entry", () => {
  it("a plain line is a task", () => {
    typeLine("مطالعه مقاله");
    expect(tasks().map((t) => t.title)).toEqual(["مطالعه مقاله"]);
  });

  it("an expense is a task with its cost — and the expense is on the books", () => {
    typeLine("شکلات یک میلیونی");
    const [task] = tasks();
    expect(task).toMatchObject({ title: "شکلات", directCost: 1_000_000 });
    const expenses = transactions().filter((t) => t.type === "EXPENSE");
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ amount: 1_000_000, description: "شکلات" });
  });

  it("an income keyword makes it income", () => {
    typeLine("حقوق ۲۰ میلیون");
    expect(tasks()[0]).toMatchObject({ title: "حقوق", incomeAmount: 20_000_000 });
    expect(transactions().filter((t) => t.type === "INCOME").map((t) => t.amount)).toEqual([20_000_000]);
  });

  it("time spent is a finished task with its start and end", () => {
    typeLine("۲ ساعت مطالعه");
    const [task] = tasks();
    expect(task).toMatchObject({ title: "مطالعه", status: "DONE" });
    expect(new Date(task.endAt).getTime() - new Date(task.startAt).getTime()).toBe(120 * 60_000);
  });

  it("a dated line is an event at the time named", () => {
    typeLine("جلسه فردا ساعت ۱۰");
    const { events } = call("GET", "/api/events");
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("جلسه");
    const start = new Date(events[0].startAt);
    expect([start.getDate(), start.getHours(), start.getMinutes()]).toEqual([11, 10, 0]);
    expect(events[0].allDay).toBe(false);
  });

  it("an event that is already over is marked done", () => {
    typeLine("دیروز ساعت ۱۰ جلسه");
    const { occurrences } = call("GET", "/api/events?from=2026-05-08T00:00:00.000Z&to=2026-05-11T00:00:00.000Z");
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].isDone).toBe(true);

    typeLine("فردا ساعت ۱۰ جلسه دوم");
    const later = call("GET", "/api/events?from=2026-05-10T00:00:00.000Z&to=2026-05-13T00:00:00.000Z").occurrences as any[];
    expect(later.find((o) => o.event.title === "جلسه دوم").isDone).toBe(false);
  });

  it("files it under the category the line points at", () => {
    const category = (call("GET", "/api/categories").categories as any[]).find((c) => c.name === "خرید");
    expect(category, "the default categories include «خرید»").toBeTruthy();
    typeLine("خرید نان");
    expect(tasks()[0]).toMatchObject({ title: "نان", categoryId: category.id });
  });

  it("makes the project the line names when there is none yet, and files the task under it", () => {
    const resolution = typeLine("خرید رنگ برای پروژه اتاق");
    expect(resolution.details.some((d) => d.label === "پروژه جدید" && d.text === "اتاق")).toBe(true);
    const { projects } = call("GET", "/api/projects");
    expect(projects.map((p: any) => p.name)).toEqual(["اتاق"]);
    const [task] = tasks();
    expect(task.title).toBe("رنگ");
    expect(task.projectId).toBe(projects[0].id);
    expect(task.categoryId).toBeTruthy();
  });

  it("uses the project that is already there — it matches on a fragment of the name", () => {
    call("POST", "/api/projects", { name: "بازسازی اتاق" });
    const resolution = typeLine("خرید رنگ برای پروژه اتاق");
    expect(resolution.details.some((d) => d.label === "پروژه" && d.text === "بازسازی اتاق")).toBe(true);
    expect(call("GET", "/api/projects").projects).toHaveLength(1);
  });
});

describe("a reminder", () => {
  it("is an event with a reminder at its start", () => {
    typeLine("یادآوری فردا ساعت ۸ صبح قرص");
    const { events } = call("GET", "/api/events");
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("قرص");
    expect(events[0].reminders).toHaveLength(1);
    expect(events[0].reminders[0].offsetMinutes).toBe(0);
  });
});

describe("installments", () => {
  it("creates a plan with its whole schedule", () => {
    typeLine("قسط ماشین ۱۲ ماهه ۵ میلیونی روز ۵ هر ماه");
    const { plans } = call("GET", "/api/installment-plans");
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ title: "قسط ماشین", totalAmount: 60_000_000, installmentAmount: 5_000_000, numberOfInstallments: 12, dueDay: 5 });
    expect(plans[0].installments).toHaveLength(12);
  });

  it("pays the next installment of the plan the line names, from the first account", () => {
    call("POST", "/api/accounts", { name: "کارت ملی", type: "BANK_ACCOUNT" });
    typeLine("وام ماشین ۶۰ میلیون ۱۲ ماهه");
    typeLine("وام خانه ۲۴ میلیون ۶ ماهه");

    const paying = typeLine("قسط ماشین رو دادم");
    expect(paying.details).toContainEqual({ label: "از حساب", text: "کارت ملی" });
    let plans = call("GET", "/api/installment-plans").plans as any[];
    const car = plans.find((p) => p.title === "وام ماشین");
    expect(car.installments.map((i: any) => i.status).slice(0, 3)).toEqual(["PAID", "PENDING", "PENDING"]);
    expect(plans.find((p) => p.title === "وام خانه").installments.every((i: any) => i.status === "PENDING")).toBe(true);
    expect(transactions().filter((t) => t.installmentId)).toHaveLength(1);

    typeLine("قسط ماشین رو دادم");
    plans = call("GET", "/api/installment-plans").plans as any[];
    expect(plans.find((p) => p.title === "وام ماشین").installments.map((i: any) => i.status).slice(0, 3)).toEqual(["PAID", "PAID", "PENDING"]);
  });

  it("with only one plan open, no name is needed; with several, one is", () => {
    typeLine("وام ماشین ۶۰ میلیون ۱۲ ماهه");
    typeLine("قسط رو دادم");
    expect((call("GET", "/api/installment-plans").plans as any[])[0].installments[0].status).toBe("PAID");

    typeLine("وام خانه ۲۴ میلیون ۶ ماهه");
    const resolution = typeLine("قسط رو دادم");
    expect(resolution.problem).toMatch(/کدام طرح/);
    expect((call("GET", "/api/installment-plans").plans as any[]).map((p) => p.installments.filter((i: any) => i.status === "PAID").length).sort()).toEqual([0, 1]);
  });

  it("makes the default cash account when there is none to pay from", () => {
    typeLine("وام ماشین ۶۰ میلیون ۱۲ ماهه");
    expect(call("GET", "/api/accounts").accounts).toHaveLength(0);
    typeLine("قسط ماشین رو دادم");
    const { accounts } = call("GET", "/api/accounts");
    expect(accounts.map((a: any) => a.name)).toEqual(["صندوق"]);
    expect(transactions().filter((t) => t.installmentId)).toHaveLength(1);
  });

  it("says so when no plan has that name", () => {
    typeLine("وام ماشین ۶۰ میلیون ۱۲ ماهه");
    const resolution = typeLine("قسط دانشگاه رو دادم");
    expect(resolution.problem).toMatch(/دانشگاه/);
    expect(resolution.steps).toEqual([]);
  });
});

describe("habits", () => {
  it("ticks a habit off for today — once", () => {
    // the habits list reports "today" by the real clock, so this one types the line on it
    const today = new Date();
    const { habit } = call("POST", "/api/habits", { title: "ورزش صبحگاهی" });
    const first = typeLine("عادت ورزش انجام شد", today);
    expect(first.details).toContainEqual({ label: "عادت", text: "ورزش صبحگاهی" });
    expect(call("GET", "/api/habits").habits.find((h: any) => h.id === habit.id).checkedInToday).toBe(true);

    // ticking it again would UN-tick it (a check-in is a toggle) — so the second time does nothing
    const second = typeLine("عادت ورزش انجام شد", today);
    expect(second.alreadyDone).toBeTruthy();
    expect(call("GET", "/api/habits").habits.find((h: any) => h.id === habit.id).checkedInToday).toBe(true);
  });

  it("says so when there is no such habit", () => {
    call("POST", "/api/habits", { title: "ورزش" });
    expect(typeLine("عادت مدیتیشن").problem).toMatch(/مدیتیشن/);
  });

  it("creates a habit, but not the same one twice", () => {
    typeLine("عادت جدید مطالعه");
    expect(call("GET", "/api/habits").habits.map((h: any) => h.title)).toEqual(["مطالعه"]);
    expect(typeLine("عادت جدید مطالعه").alreadyDone).toBeTruthy();
    expect(call("GET", "/api/habits").habits).toHaveLength(1);
  });
});

describe("notes, goals, projects and budgets", () => {
  it("writes a note on today", () => {
    typeLine("یادداشت: امروز خیلی خوب بود ۳ تا کار کردم");
    expect(call("GET", "/api/notes?day=2026-05-10").notes.map((n: any) => n.content)).toEqual(["امروز خیلی خوب بود ۳ تا کار کردم"]);
  });

  it("creates a savings goal against the first account", () => {
    call("POST", "/api/accounts", { name: "حساب پس‌انداز", type: "BANK_ACCOUNT" });
    typeLine("هدف ماشین ۲۰۰ میلیون");
    const { goals } = call("GET", "/api/savings-goals");
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ title: "ماشین", targetAmount: 200_000_000 });
  });

  it("creates a project, but not the same one twice", () => {
    typeLine("پروژه جدید بازسازی اتاق");
    expect(call("GET", "/api/projects").projects.map((p: any) => p.name)).toEqual(["بازسازی اتاق"]);
    expect(typeLine("پروژه جدید بازسازی اتاق").alreadyDone).toBeTruthy();
    expect(call("GET", "/api/projects").projects).toHaveLength(1);
  });

  it("caps a category per month, and says so when there is no such category", () => {
    const { category } = call("POST", "/api/categories", { name: "خوراک", kind: "NEUTRAL", valueType: "EXPENSE" });
    typeLine("بودجه خوراک ماهانه ۵ میلیون");
    const { budgets } = call("GET", "/api/budgets");
    expect(budgets).toHaveLength(1);
    expect(budgets[0]).toMatchObject({ categoryId: category.id, monthlyCap: 5_000_000 });

    const missing = typeLine("بودجه سفر ۵ میلیون");
    expect(missing.problem).toMatch(/سفر/);
    expect(call("GET", "/api/budgets").budgets).toHaveLength(1);
  });
});

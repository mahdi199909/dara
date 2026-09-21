// The phone's write routes, through the real dispatcher against a real SQLite (sql.js) database: each one is
// all-or-nothing, exactly like the server's (src/testing/atomicOperations.e2e.test.ts).
//
// The failure is injected in the LAST write of an operation, after the earlier ones have been made, by a
// trigger that aborts that one INSERT/UPDATE. The test then asserts that nothing the earlier writes made is left
// behind (the history entry included — on the phone it is stored inside the same transaction), that no
// "…_SUCCESS" line exists, that the failure is logged once with its stack, and that the same request succeeds
// once the fault is removed.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchLocal, listLocalRoutes, setLocalDbDriver, staleOperationRoutes, type LocalResponse } from "@/lib/localDispatcher";
import { installMemoryLogger } from "@/lib/observability/testing";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { ensureDefaultCategories, getLocalUserId, LOCAL_USER_ID, mergeDuplicateCategories } from "./localUser";

let db: LocalDb;
let userId: string;
let memory: ReturnType<typeof installMemoryLogger>;

beforeEach(async () => {
  resetLocalDbForTests();
  const driver = await createNodeSqliteDriver(":memory:");
  setLocalDbDriver(driver);
  db = openLocalDb(driver);
  userId = getLocalUserId(db);
  memory = installMemoryLogger();
});
afterEach(() => memory.restore());

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(++counter).toString(36)}`;

function count(table: string, where = "1 = 1", params: unknown[] = []): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}" WHERE ${where}`, params)!.n;
}

/**
 * Makes the database refuse one kind of write for as long as `body` runs: each definition is the head of a trigger
 * ("BEFORE INSERT ON "Transaction" WHEN …") whose body aborts the statement. Dropped afterwards even if an
 * assertion failed, so one test's fault never leaks into the next.
 */
function withFault<T>(definitions: string | string[], body: () => T): T {
  const names: string[] = [];
  try {
    for (const definition of Array.isArray(definitions) ? definitions : [definitions]) {
      const name = `fault_${unique()}`;
      db.execute(`CREATE TRIGGER ${name} ${definition} BEGIN SELECT RAISE(ABORT, 'injected fault'); END`);
      names.push(name);
    }
    return body();
  } finally {
    for (const name of names) db.execute(`DROP TRIGGER IF EXISTS ${name}`);
  }
}

/** What every rolled-back write looks like from the outside. Returns the FAILED line. */
function expectRolledBack(res: LocalResponse, operation: string, entityType: string) {
  expect(res.status).toBe(500);
  const [failed, ...more] = memory.sink.find(`${operation}_FAILED`);
  expect(more, `${operation}_FAILED is written once`).toEqual([]);
  expect(failed).toMatchObject({ level: "ERROR", entity_type: entityType, layer: "local" });
  expect(failed.error?.stack).toBeTruthy();
  expect(failed.error_code).toBeTruthy();
  expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")).toHaveLength(1);
  // …and nothing claims that it worked, or reports the same error a second time
  expect(memory.sink.find(`${operation}_SUCCESS`)).toEqual([]);
  expect(memory.sink.find("API_UNHANDLED_ERROR")).toEqual([]);
  return failed;
}

/** The order the log tells the story in: the commit, then the success line. */
function expectSuccessAfterCommit(operation: string) {
  const order = memory.sink.events();
  const commit = order.indexOf("DB_TRANSACTION_COMMIT");
  const success = order.indexOf(`${operation}_SUCCESS`);
  expect(commit, "the transaction committed").toBeGreaterThanOrEqual(0);
  expect(success, `${operation}_SUCCESS was logged`).toBeGreaterThanOrEqual(0);
  expect(commit).toBeLessThan(success);
}

const json = (res: LocalResponse) => res.json as any;
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

describe("a task with a cost", () => {
  it("is written as one step — the task, its expense, the account the expense needed and its history entry — and reported only afterwards", () => {
    const title = `cost-ok-${unique()}`;
    memory.sink.clear();

    const res = dispatchLocal("POST", "/api/tasks", { title, directCost: 45000 });
    expect(res.status).toBe(201);
    const taskId: string = json(res).task.id;
    expect(count("Transaction", `"taskId" = ?`, [taskId])).toBe(1);
    expect(db.get<{ amount: number }>(`SELECT "amount" FROM "Transaction" WHERE "taskId" = ?`, [taskId])!.amount).toBe(45000);
    expect(count("FinanceAccount")).toBe(1);
    expect(count("AuditLog", `"entityId" = ? AND "action" = 'CREATE'`, [taskId])).toBe(1);
    expectSuccessAfterCommit("TASK_CREATE");
  });

  it("is not created at all when its expense cannot be written — no task, no expense, no account, no history entry, no success line", () => {
    const title = `cost-fail-${unique()}`;

    withFault(`BEFORE INSERT ON "Transaction" WHEN NEW."description" = '${title}'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("POST", "/api/tasks", { title, directCost: 45000 });
      expectRolledBack(res, "TASK_CREATE", "Task");
      expect(json(res).details).toContain("injected fault"); // the real cause still reaches the person's error report
      expect(count("Task")).toBe(0);
      expect(count("Transaction")).toBe(0);
      expect(count("FinanceAccount")).toBe(0); // the default account made on the way went with it
      expect(count("AuditLog", `"entityType" = 'Task'`)).toBe(0);
    });

    const retry = dispatchLocal("POST", "/api/tasks", { title, directCost: 45000 });
    expect(retry.status).toBe(201);
    expect(count("Transaction", `"description" = ?`, [title])).toBe(1);
  });

  it("keeps its old cost, its old status and its old history when an edit cannot write the new expense", () => {
    const title = `edit-${unique()}`;
    const taskId: string = json(dispatchLocal("POST", "/api/tasks", { title })).task.id;
    const before = db.get<{ status: string }>(`SELECT "status" FROM "Task" WHERE "id" = ?`, [taskId])!;
    const historyBefore = count("AuditLog", `"entityId" = ?`, [taskId]);

    withFault(`BEFORE INSERT ON "Transaction" WHEN NEW."description" = '${title}'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("PATCH", `/api/tasks/${taskId}`, { directCost: 7000, status: "DONE" });
      expectRolledBack(res, "TASK_UPDATE", "Task");
    });
    const after = db.get<{ directCost: number; status: string; completedAt: string | null }>(`SELECT "directCost","status","completedAt" FROM "Task" WHERE "id" = ?`, [taskId])!;
    expect(after).toMatchObject({ directCost: 0, status: before.status, completedAt: null });
    expect(count("Transaction", `"taskId" = ?`, [taskId])).toBe(0);
    expect(count("AuditLog", `"entityId" = ?`, [taskId])).toBe(historyBefore);

    memory.sink.clear();
    const retry = dispatchLocal("PATCH", `/api/tasks/${taskId}`, { directCost: 7000, status: "DONE" });
    expect(retry.status).toBe(200);
    expect(count("Transaction", `"taskId" = ? AND "amount" = 7000`, [taskId])).toBe(1);
    expectSuccessAfterCommit("TASK_COMPLETE");
  });
});

describe("the other places an expense is born", () => {
  it("a quick-captured expense and the default account it needed are one step", () => {
    withFault(`BEFORE INSERT ON "Transaction" WHEN NEW."userId" = '${userId}'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("POST", "/api/quick-capture", { text: "قهوه 50000", type: "EXPENSE" });
      expect(res.status).toBe(500);
      expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")).toHaveLength(1);
      expect(count("FinanceAccount")).toBe(0);
      expect(count("Transaction")).toBe(0);
      expect(count("AuditLog", `"entityType" = 'Transaction'`)).toBe(0);
    });

    const retry = dispatchLocal("POST", "/api/quick-capture", { text: "قهوه 50000", type: "EXPENSE" });
    expect(retry.status).toBe(201);
    expect(count("Transaction")).toBe(1);
    expect(count("FinanceAccount")).toBe(1);
  });

  it("an activity, its logged time and its cost are one step", () => {
    const title = `activity-${unique()}`;

    withFault(`BEFORE INSERT ON "Transaction" WHEN NEW."userId" = '${userId}'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("POST", "/api/activities", { title, directCost: 12000, durationMin: 30 });
      expectRolledBack(res, "ACTIVITY_CREATE", "Activity");
      expect(count("Activity")).toBe(0);
      expect(count("TimeEntry")).toBe(0); // the 30 minutes were written first, and went too
      expect(count("FinanceAccount")).toBe(0);
    });

    memory.sink.clear();
    const retry = dispatchLocal("POST", "/api/activities", { title, directCost: 12000, durationMin: 30 });
    expect(retry.status).toBe(201);
    const activityId: string = json(retry).activity.id;
    expect(db.get<{ totalDurationMin: number }>(`SELECT "totalDurationMin" FROM "Activity" WHERE "id" = ?`, [activityId])!.totalDurationMin).toBe(30);
    expect(count("Transaction", `"activityId" = ?`, [activityId])).toBe(1);
    expectSuccessAfterCommit("ACTIVITY_CREATE");
  });

  it("an event, its cost and its reminders are one step", () => {
    const body = { title: `event-${unique()}`, startAt: inAnHour(), endAt: new Date(Date.now() + 7_200_000).toISOString(), directCost: 30000, reminderOffsets: [15, 60] };

    withFault(`BEFORE INSERT ON "Reminder" WHEN NEW."userId" = '${userId}'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("POST", "/api/events", body);
      expectRolledBack(res, "EVENT_CREATE", "Event");
      expect(count("Event")).toBe(0);
      expect(count("Transaction")).toBe(0); // the cost was written before the reminders, and went too
      expect(count("FinanceAccount")).toBe(0);
    });

    const retry = dispatchLocal("POST", "/api/events", body);
    expect(retry.status).toBe(201);
    expect(count("Reminder")).toBe(2);
    expect(count("Transaction")).toBe(1);
  });
});

describe("installments", () => {
  function planWithAccount() {
    const accountId: string = json(dispatchLocal("POST", "/api/accounts", { name: `بانک ${unique()}` })).account.id;
    return accountId;
  }
  function firstInstallmentId(): string {
    const plan = json(dispatchLocal("POST", "/api/installment-plans", { title: `plan-${unique()}`, totalAmount: 2_000_000, installmentAmount: 1_000_000, numberOfInstallments: 2, dueDay: 5 })).plan;
    return db.get<{ id: string }>(`SELECT "id" FROM "Installment" WHERE "planId" = ? AND "index" = 1`, [plan.id])!.id;
  }

  it("a plan, all of its installments and all of their reminders are created together", () => {
    const body = { title: `plan-${unique()}`, totalAmount: 3_000_000, installmentAmount: 1_000_000, numberOfInstallments: 3, dueDay: 10, reminderOffsets: [60] };

    withFault(`BEFORE INSERT ON "Reminder" WHEN NEW."userId" = '${userId}'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("POST", "/api/installment-plans", body);
      expectRolledBack(res, "INSTALLMENT_CREATE", "InstallmentPlan");
      expect(count("InstallmentPlan")).toBe(0);
      expect(count("Installment")).toBe(0);
      expect(count("AuditLog", `"entityType" = 'InstallmentPlan'`)).toBe(0);
    });

    memory.sink.clear();
    const retry = dispatchLocal("POST", "/api/installment-plans", body);
    expect(retry.status).toBe(201);
    expect(count("Installment")).toBe(3);
    expect(count("Reminder", `"targetType" = 'INSTALLMENT'`)).toBe(3);
    expectSuccessAfterCommit("INSTALLMENT_CREATE");
  });

  it("an installment is marked paid together with the expense that pays it — never one without the other", () => {
    const accountId = planWithAccount();
    const installmentId = firstInstallmentId();

    // the phone writes the expense first and marks the installment second: the failure comes after the expense exists
    withFault(`BEFORE UPDATE OF "status" ON "Installment" WHEN NEW."status" = 'PAID'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("POST", `/api/installments/${installmentId}/pay`, { accountId });
      expectRolledBack(res, "INSTALLMENT_PAY", "Installment");
      expect(db.get<{ status: string; paidAt: string | null }>(`SELECT "status","paidAt" FROM "Installment" WHERE "id" = ?`, [installmentId])).toMatchObject({ paidAt: null });
      expect(db.get<{ status: string }>(`SELECT "status" FROM "Installment" WHERE "id" = ?`, [installmentId])!.status).not.toBe("PAID");
      expect(count("Transaction", `"installmentId" = ?`, [installmentId])).toBe(0);
      expect(count("AuditLog", `"entityId" = ?`, [installmentId])).toBe(0);
    });

    memory.sink.clear();
    const paid = dispatchLocal("POST", `/api/installments/${installmentId}/pay`, { accountId });
    expect(paid.status).toBe(200);
    expect(json(paid).installment).toMatchObject({ id: installmentId, status: "PAID" });
    expect(count("Transaction", `"installmentId" = ? AND "type" = 'EXPENSE' AND "amount" = 1000000`, [installmentId])).toBe(1);
    expect(count("AuditLog", `"entityId" = ? AND "action" = 'PAYMENT'`, [installmentId])).toBe(1);
    expectSuccessAfterCommit("INSTALLMENT_PAY");
  });

  it("an installment already paid is refused as the caller's mistake — quietly, with nothing written", () => {
    const accountId = planWithAccount();
    const installmentId = firstInstallmentId();
    expect(dispatchLocal("POST", `/api/installments/${installmentId}/pay`, { accountId }).status).toBe(200);

    memory.sink.clear();
    const again = dispatchLocal("POST", `/api/installments/${installmentId}/pay`, { accountId });
    expect(again.status).toBe(409);
    expect(count("Transaction", `"installmentId" = ?`, [installmentId])).toBe(1);
    expect(count("AuditLog", `"entityId" = ? AND "action" = 'PAYMENT'`, [installmentId])).toBe(1);
    expect(memory.sink.find("INSTALLMENT_PAY_FAILED")[0]).toMatchObject({ level: "WARN" });
    expect(memory.sink.records.filter((record) => record.level === "ERROR")).toEqual([]);
  });
});

describe("habits and time", () => {
  function habitWithValue(): string {
    return json(dispatchLocal("POST", "/api/habits", { title: `habit-${unique()}`, virtualAssetValuePerCheckIn: 5000 })).habit.id;
  }

  it("a check-in and the virtual asset it earns are one step", () => {
    const habitId = habitWithValue();

    withFault(`BEFORE INSERT ON "VirtualAssetEntry" WHEN NEW."userId" = '${userId}'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("POST", `/api/habits/${habitId}/checkin`);
      expectRolledBack(res, "HABIT_CHECKIN", "HabitCheckIn");
      expect(count("HabitCheckIn", `"habitId" = ?`, [habitId])).toBe(0);
      expect(count("AuditLog", `"entityType" = 'HabitCheckIn'`)).toBe(0);
    });

    memory.sink.clear();
    const retry = dispatchLocal("POST", `/api/habits/${habitId}/checkin`);
    expect(json(retry)).toEqual({ checkedIn: true });
    expect(count("HabitCheckIn", `"habitId" = ?`, [habitId])).toBe(1);
    expect(count("VirtualAssetEntry", `"totalValue" = 5000`)).toBe(1);
    expectSuccessAfterCommit("HABIT_CHECKIN");
  });

  it("un-checking removes the check-in, its virtual asset and records both tombstones — or does none of it", () => {
    const habitId = habitWithValue();
    dispatchLocal("POST", `/api/habits/${habitId}/checkin`);
    const checkInId = db.get<{ id: string }>(`SELECT "id" FROM "HabitCheckIn" WHERE "habitId" = ?`, [habitId])!.id;

    // the asset's tombstone is written first, the check-in's second: the failure comes after a delete has already happened
    withFault(`BEFORE INSERT ON "SyncTombstone" WHEN NEW."table" = 'HabitCheckIn'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("POST", `/api/habits/${habitId}/checkin`);
      expectRolledBack(res, "HABIT_CHECKIN", "HabitCheckIn");
      expect(count("HabitCheckIn", `"id" = ?`, [checkInId])).toBe(1);
      expect(count("VirtualAssetEntry", `"habitCheckInId" = ?`, [checkInId])).toBe(1);
      expect(count("SyncTombstone")).toBe(0);
    });

    const retry = dispatchLocal("POST", `/api/habits/${habitId}/checkin`);
    expect(json(retry)).toEqual({ checkedIn: false });
    expect(count("HabitCheckIn", `"id" = ?`, [checkInId])).toBe(0);
    expect(count("VirtualAssetEntry")).toBe(0);
    const tombstones = db.all<{ table: string }>(`SELECT "table" FROM "SyncTombstone"`).map((t) => t.table).sort();
    expect(tombstones).toEqual(["HabitCheckIn", "VirtualAssetEntry"]);
  });

  it("stopping a timer and updating the activity's total are one step: a timer that failed to stop is still running", () => {
    const activityId: string = json(dispatchLocal("POST", "/api/activities", { title: `timer-${unique()}` })).activity.id;
    dispatchLocal("POST", `/api/activities/${activityId}/timer/start`);

    withFault(`BEFORE UPDATE OF "totalDurationMin" ON "Activity"`, () => {
      memory.sink.clear();
      const res = dispatchLocal("POST", `/api/activities/${activityId}/timer/stop`);
      expectRolledBack(res, "TIME_TIMER_STOP", "Activity");
      expect(db.get<{ isRunning: number; endAt: string | null; durationMin: number | null }>(`SELECT "isRunning","endAt","durationMin" FROM "TimeEntry" WHERE "activityId" = ?`, [activityId])).toMatchObject({
        isRunning: 1,
        endAt: null,
        durationMin: null,
      });
      expect(count("AuditLog", `"entityId" = ? AND "action" = 'TIMER_STOP'`, [activityId])).toBe(0);
    });

    memory.sink.clear();
    const retry = dispatchLocal("POST", `/api/activities/${activityId}/timer/stop`);
    expect(retry.status).toBe(200);
    expect(db.get<{ isRunning: number }>(`SELECT "isRunning" FROM "TimeEntry" WHERE "activityId" = ?`, [activityId])!.isRunning).toBe(0);
    expect(count("AuditLog", `"entityId" = ? AND "action" = 'TIMER_STOP'`, [activityId])).toBe(1);
    expectSuccessAfterCommit("TIME_TIMER_STOP");
  });
});

describe("projects, categories and settings", () => {
  it("a project and the category that goes with it are created together", () => {
    const name = `project-${unique()}`;

    withFault(`BEFORE INSERT ON "Category" WHEN NEW."name" = '${name}'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("POST", "/api/projects", { name });
      expectRolledBack(res, "PROJECT_CREATE", "Project");
      expect(count("Project")).toBe(0);
      expect(count("Category", `"name" = ?`, [name])).toBe(0);
    });

    expect(dispatchLocal("POST", "/api/projects", { name }).status).toBe(201);
    expect(count("Category", `"name" = ?`, [name])).toBe(1);
  });

  it("deleting a category and detaching its sub-categories are one step", () => {
    const parentId: string = json(dispatchLocal("POST", "/api/categories", { name: `parent-${unique()}` })).category.id;
    const childId: string = json(dispatchLocal("POST", "/api/categories", { name: `child-${unique()}`, parentCategoryId: parentId })).category.id;

    withFault(`BEFORE UPDATE OF "parentCategoryId" ON "Category" WHEN OLD."parentCategoryId" = '${parentId}'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("DELETE", `/api/categories/${parentId}`);
      expectRolledBack(res, "CATEGORY_DELETE", "Category");
      expect(db.get<{ deletedAt: string | null }>(`SELECT "deletedAt" FROM "Category" WHERE "id" = ?`, [parentId])!.deletedAt).toBeNull();
      expect(db.get<{ parentCategoryId: string | null }>(`SELECT "parentCategoryId" FROM "Category" WHERE "id" = ?`, [childId])!.parentCategoryId).toBe(parentId);
    });

    expect(dispatchLocal("DELETE", `/api/categories/${parentId}`).status).toBe(200);
    expect(db.get<{ deletedAt: string | null }>(`SELECT "deletedAt" FROM "Category" WHERE "id" = ?`, [parentId])!.deletedAt).not.toBeNull();
    expect(db.get<{ parentCategoryId: string | null }>(`SELECT "parentCategoryId" FROM "Category" WHERE "id" = ?`, [childId])!.parentCategoryId).toBeNull();
  });

  it("a new display name and new settings are one save", () => {
    const before = db.get<{ name: string }>(`SELECT "name" FROM "User" WHERE "id" = ?`, [userId])!;
    const name = `نام تازه ${unique()}`;

    withFault(`BEFORE UPDATE ON "Settings" WHEN NEW."userId" = '${userId}'`, () => {
      memory.sink.clear();
      const res = dispatchLocal("PATCH", "/api/settings", { name, timezone: "Asia/Tehran" });
      expectRolledBack(res, "SETTINGS_UPDATE", "Settings");
      expect(db.get<{ name: string }>(`SELECT "name" FROM "User" WHERE "id" = ?`, [userId])!.name).toBe(before.name); // the name was written first
    });

    expect(dispatchLocal("PATCH", "/api/settings", { name, timezone: "Asia/Tehran" }).status).toBe(200);
    expect(db.get<{ name: string }>(`SELECT "name" FROM "User" WHERE "id" = ?`, [userId])!.name).toBe(name);
  });
});

describe("what is not a failure of the system", () => {
  it("invalid input and an unknown id answer 400 and 404 quietly — no ERROR, no alarm, nothing written", () => {
    memory.sink.clear();
    expect(dispatchLocal("POST", "/api/tasks", { title: "" }).status).toBe(400);
    expect(dispatchLocal("PATCH", "/api/tasks/no-such-task", { title: "x" }).status).toBe(404);
    expect(memory.sink.records.filter((record) => record.level === "ERROR")).toEqual([]);
    expect(memory.sink.find("API_UNHANDLED_ERROR")).toEqual([]);
    expect(count("Task")).toBe(0);
  });

  it("reads run outside a transaction: they change nothing, and each write to the driver schedules a save of the whole file", () => {
    memory.sink.clear();
    expect(dispatchLocal("GET", "/api/tasks").status).toBe(200);
    expect(memory.sink.events().filter((event) => event.startsWith("DB_TRANSACTION"))).toEqual([]);
  });
});

describe("everything a device does on its own account", () => {
  it("the very first start — the user, their settings and the default categories — is one step", async () => {
    resetLocalDbForTests();
    const fresh = openLocalDb(await createNodeSqliteDriver(":memory:"));
    db = fresh; // (the fault helper works on `db`)

    withFault(`BEFORE INSERT ON "Category" WHEN NEW."userId" = '${LOCAL_USER_ID}'`, () => {
      expect(() => getLocalUserId(fresh)).toThrow("injected fault");
    });
    // half-way through would have left a user with no categories, and every later call returning early
    expect(fresh.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "User"`)!.n).toBe(0);
    expect(fresh.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "Settings"`)!.n).toBe(0);

    expect(getLocalUserId(fresh)).toBe(LOCAL_USER_ID);
    expect(fresh.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "Category"`)!.n).toBeGreaterThan(0);
  });

  it("adding the missing default categories is one step", () => {
    db.run(`DELETE FROM "Category"`);
    withFault(`BEFORE INSERT ON "Category" WHEN (SELECT COUNT(*) FROM "Category") >= 3`, () => {
      expect(() => ensureDefaultCategories(db, userId)).toThrow("injected fault");
    });
    expect(count("Category")).toBe(0); // the first three were inserted before the fourth failed, and went with it
    ensureDefaultCategories(db, userId);
    expect(count("Category")).toBeGreaterThan(3);
  });

  it("merging duplicate categories moves every row to the survivor and retires the duplicate — or changes nothing", () => {
    const survivor = json(dispatchLocal("POST", "/api/categories", { name: "تکراری" })).category.id as string;
    const duplicate = json(dispatchLocal("POST", "/api/categories", { name: "تکراری" })).category.id as string;
    const taskId: string = json(dispatchLocal("POST", "/api/tasks", { title: "کار", categoryId: duplicate })).task.id;

    withFault(`BEFORE UPDATE OF "deletedAt" ON "Category" WHEN NEW."id" = '${duplicate}'`, () => {
      expect(() => mergeDuplicateCategories(db, userId)).toThrow("injected fault");
    });
    expect(db.get<{ categoryId: string }>(`SELECT "categoryId" FROM "Task" WHERE "id" = ?`, [taskId])!.categoryId).toBe(duplicate); // moved first, put back
    expect(db.get<{ deletedAt: string | null }>(`SELECT "deletedAt" FROM "Category" WHERE "id" = ?`, [duplicate])!.deletedAt).toBeNull();

    mergeDuplicateCategories(db, userId);
    expect(db.get<{ categoryId: string }>(`SELECT "categoryId" FROM "Task" WHERE "id" = ?`, [taskId])!.categoryId).toBe(survivor);
    expect(db.get<{ deletedAt: string | null }>(`SELECT "deletedAt" FROM "Category" WHERE "id" = ?`, [duplicate])!.deletedAt).not.toBeNull();
  });
});

describe("the route table", () => {
  it("names only routes that exist — a renamed or removed route cannot silently lose its operation name", () => {
    expect(staleOperationRoutes()).toEqual([]);
  });

  it("gives every write route a name, or lists it here as deliberately unnamed", () => {
    // Every write route is atomic whether it is named or not; the name only decides what a failure is called in the log.
    // A new write route has to be added to one list or the other, so that this is a decision and not an oversight.
    const unnamed = new Set([
      "POST /api/events/:id/reminders",
      "DELETE /api/reminders/:id",
      "DELETE /api/virtual-assets/:id",
      "POST /api/notifications/:id/read",
      "POST /api/quick-capture",
      "POST /api/local/license-cache",
      "POST /api/local/logout",
    ]);
    const missing = listLocalRoutes()
      .filter((route) => route.method !== "GET" && !route.operation)
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !unnamed.has(key));
    expect(missing).toEqual([]);
    // and the unnamed list is not stale either
    const routes = new Set(listLocalRoutes().map((route) => `${route.method} ${route.path}`));
    expect([...unnamed].filter((key) => !routes.has(key))).toEqual([]);
  });
});

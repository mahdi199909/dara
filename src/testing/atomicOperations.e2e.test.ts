// The routes that write more than one row, against a real database: each one is all-or-nothing.
//
// The failure is injected where it hurts most — in the LAST write of an operation, after the earlier ones
// have already been made — by a SQLite trigger that aborts that one INSERT/UPDATE. For each operation the
// test then asserts what a person, the history screen and a support investigation depend on:
//   - nothing the earlier writes made is left behind (no half-created task, no expense without its
//     installment, no timer that stopped without its total, no delete without its tombstone);
//   - there is no history entry and no "…_SUCCESS" line for it — those wait for the commit;
//   - the failure is logged once, with its stack and code, and the response quotes the same code and request id;
//   - the very same request succeeds once the fault is removed, so the failure was the injected one and not
//     something the route always does.
// (The transaction primitive itself is tested in transactions.e2e.test.ts.)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { cookieJar } = await import("@/testing/cookieJar");
  return { cookies: () => cookieJar };
});

import { installMemoryLogger } from "@/lib/observability/testing";
import { createServerHarness, type HttpResult, type ServerHarness } from "@/testing/syncHarness";

vi.setConfig({ testTimeout: 60_000 });

let server: ServerHarness;
let memory: ReturnType<typeof installMemoryLogger>;

beforeAll(async () => {
  server = await createServerHarness();
}, 120_000);
afterAll(async () => {
  await server.dispose();
});
beforeEach(() => {
  memory = installMemoryLogger();
});
afterEach(() => {
  memory.restore();
});

const unique = () => Math.random().toString(36).slice(2, 10);
const count = (model: string, where: object): Promise<number> => server.prisma[model].count({ where });

/**
 * Makes the database refuse one kind of write for as long as `body` runs: each definition is the head of a
 * trigger ("BEFORE INSERT ON "Transaction" WHEN …") whose body aborts the statement. The triggers are dropped
 * afterwards even when an assertion failed, so one test's fault never leaks into the next.
 */
async function withFault<T>(definitions: string | string[], body: () => Promise<T>): Promise<T> {
  const names: string[] = [];
  try {
    for (const definition of Array.isArray(definitions) ? definitions : [definitions]) {
      const name = `fault_${unique()}`;
      await server.prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} ${definition} BEGIN SELECT RAISE(ABORT, 'injected fault'); END`);
      names.push(name);
    }
    return await body();
  } finally {
    for (const name of names) await server.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name}`);
  }
}

/** What every rolled-back operation looks like from the outside, whichever route it was. Returns the FAILED line. */
function expectRolledBack(res: HttpResult, operation: string, entityType: string) {
  expect(res.status).toBe(500);
  const [failed, ...more] = memory.sink.find(`${operation}_FAILED`);
  expect(more, `${operation}_FAILED is written once`).toEqual([]);
  expect(failed).toMatchObject({ level: "ERROR", entity_type: entityType });
  expect(failed.error?.stack).toBeTruthy();
  expect(failed.error_code).toBeTruthy();
  // the person is given the code and the request id the log carries, so the two can be matched
  expect(res.json).toMatchObject({ code: failed.error_code, requestId: failed.request_id });
  expect(memory.sink.find("DB_TRANSACTION_ROLLBACK")).toHaveLength(1);
  // …and nothing claims that it worked, or reports the same error a second time
  expect(memory.sink.find(`${operation}_SUCCESS`)).toEqual([]);
  expect(memory.sink.find("API_UNHANDLED_ERROR")).toEqual([]);
  expect(memory.sink.find("HTTP_REQUEST_COMPLETED")[0]).toMatchObject({ status_code: 500, error_code: failed.error_code, request_id: failed.request_id });
  return failed;
}

/** The order the log tells the story in: the commit, then the success line, then the request's completion. */
function expectSuccessAfterCommit(operation: string) {
  const order = memory.sink.events();
  const commit = order.indexOf("DB_TRANSACTION_COMMIT");
  const success = order.indexOf(`${operation}_SUCCESS`);
  const completed = order.indexOf("HTTP_REQUEST_COMPLETED");
  expect(commit, "the transaction committed").toBeGreaterThanOrEqual(0);
  expect(success, `${operation}_SUCCESS was logged`).toBeGreaterThanOrEqual(0);
  expect(commit).toBeLessThan(success);
  expect(success).toBeLessThan(completed);
}

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

describe("a task with a cost", () => {
  it("is written as one step — the task, its expense and the account the expense needed — and reported only afterwards", async () => {
    const { userId } = await server.registerUser();
    const title = `cost-ok-${unique()}`;
    memory.sink.clear();

    const res = await server.web("POST", "/api/tasks", { title, directCost: 45000 });
    expect(res.status).toBe(201);
    const task = await server.prisma.task.findFirstOrThrow({ where: { userId, title } });
    const expenses = await server.prisma.transaction.findMany({ where: { taskId: task.id } });
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ type: "EXPENSE", amount: 45000, description: title });
    expect(await count("financeAccount", { userId })).toBe(1);
    expect(await count("auditLog", { entityId: task.id, action: "CREATE" })).toBe(1);
    expectSuccessAfterCommit("TASK_CREATE");
  });

  it("is not created at all when its expense cannot be written — no task, no expense, no account, no history, no success line", async () => {
    const { userId } = await server.registerUser();
    const title = `cost-fail-${unique()}`;

    await withFault(`BEFORE INSERT ON "Transaction" WHEN NEW."description" = '${title}'`, async () => {
      memory.sink.clear();
      const res = await server.web("POST", "/api/tasks", { title, directCost: 45000 });
      const failed = expectRolledBack(res, "TASK_CREATE", "Task");
      expect(await count("task", { userId })).toBe(0);
      expect(await count("transaction", { userId })).toBe(0);
      expect(await count("financeAccount", { userId })).toBe(0); // the default account made on the way went with it
      expect(await count("auditLog", { requestId: failed.request_id })).toBe(0);
    });

    const retry = await server.web("POST", "/api/tasks", { title, directCost: 45000 });
    expect(retry.status).toBe(201);
    expect(await count("transaction", { userId, description: title })).toBe(1);
  });

  it("keeps its old cost, its old status and its old history when an edit cannot write the new expense", async () => {
    const { userId } = await server.registerUser();
    const title = `edit-${unique()}`;
    const created = await server.web("POST", "/api/tasks", { title });
    const taskId: string = created.json.task.id;
    const before = await server.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const historyBefore = await count("auditLog", { entityId: taskId });

    await withFault(`BEFORE INSERT ON "Transaction" WHEN NEW."description" = '${title}'`, async () => {
      memory.sink.clear();
      const res = await server.web("PATCH", `/api/tasks/${taskId}`, { directCost: 7000, status: "DONE" });
      expectRolledBack(res, "TASK_COMPLETE", "Task"); // the edit completes the task, so that is the operation that failed
    });
    const after = await server.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(after).toMatchObject({ directCost: 0, status: before.status, completedAt: null });
    expect(await count("transaction", { userId, taskId })).toBe(0);
    expect(await count("auditLog", { entityId: taskId })).toBe(historyBefore);

    memory.sink.clear();
    const retry = await server.web("PATCH", `/api/tasks/${taskId}`, { directCost: 7000, status: "DONE" });
    expect(retry.status).toBe(200);
    expect(await server.prisma.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ directCost: 7000, status: "DONE" });
    expect(await count("transaction", { taskId, type: "EXPENSE", amount: 7000 })).toBe(1);
    expectSuccessAfterCommit("TASK_COMPLETE");
  });
});

describe("the other places an expense is born", () => {
  it("a quick-captured expense and the default account it needed are one step", async () => {
    const { userId } = await server.registerUser();

    await withFault(`BEFORE INSERT ON "Transaction" WHEN NEW."userId" = '${userId}'`, async () => {
      memory.sink.clear();
      const res = await server.web("POST", "/api/quick-capture", { text: "قهوه 50000", type: "EXPENSE" });
      const failed = expectRolledBack(res, "EXPENSE_CREATE", "Transaction");
      expect(await count("financeAccount", { userId })).toBe(0);
      expect(await count("transaction", { userId })).toBe(0);
      expect(await count("auditLog", { requestId: failed.request_id })).toBe(0);
    });

    const retry = await server.web("POST", "/api/quick-capture", { text: "قهوه 50000", type: "EXPENSE" });
    expect(retry.status).toBe(201);
    expect(await count("transaction", { userId })).toBe(1);
    expect(await count("financeAccount", { userId })).toBe(1);
  });

  it("an activity, its logged time and its cost are one step", async () => {
    const { userId } = await server.registerUser();
    const title = `activity-${unique()}`;

    await withFault(`BEFORE INSERT ON "Transaction" WHEN NEW."userId" = '${userId}'`, async () => {
      memory.sink.clear();
      const res = await server.web("POST", "/api/activities", { title, directCost: 12000, durationMin: 30 });
      const failed = expectRolledBack(res, "ACTIVITY_CREATE", "Activity");
      expect(await count("activity", { userId })).toBe(0);
      expect(await count("timeEntry", { activity: { userId } })).toBe(0); // the 30 minutes were written first, and went too
      expect(await count("financeAccount", { userId })).toBe(0);
      expect(await count("auditLog", { requestId: failed.request_id })).toBe(0);
    });

    memory.sink.clear();
    const retry = await server.web("POST", "/api/activities", { title, directCost: 12000, durationMin: 30 });
    expect(retry.status).toBe(201);
    const activity = await server.prisma.activity.findFirstOrThrow({ where: { userId, title } });
    expect(activity.totalDurationMin).toBe(30);
    expect(await count("transaction", { activityId: activity.id })).toBe(1);
    expectSuccessAfterCommit("ACTIVITY_CREATE");
  });

  it("an event, its cost and its reminders are one step", async () => {
    const { userId } = await server.registerUser();
    const title = `event-${unique()}`;
    const body = { title, startAt: inAnHour(), endAt: new Date(Date.now() + 7_200_000).toISOString(), directCost: 30000, reminderOffsets: [15, 60] };

    await withFault(`BEFORE INSERT ON "Reminder" WHEN NEW."userId" = '${userId}'`, async () => {
      memory.sink.clear();
      const res = await server.web("POST", "/api/events", body);
      expectRolledBack(res, "EVENT_CREATE", "Event");
      expect(await count("event", { userId })).toBe(0);
      expect(await count("transaction", { userId })).toBe(0); // the cost was written before the reminders, and went too
      expect(await count("financeAccount", { userId })).toBe(0);
    });

    const retry = await server.web("POST", "/api/events", body);
    expect(retry.status).toBe(201);
    expect(await count("reminder", { userId })).toBe(2);
    expect(await count("transaction", { userId })).toBe(1);
  });
});

describe("installments", () => {
  async function planWithAccount(installments = 3) {
    const { userId } = await server.registerUser();
    await server.mustWeb("POST", "/api/accounts", { name: `بانک ${unique()}` });
    const account = await server.prisma.financeAccount.findFirstOrThrow({ where: { userId } });
    return { userId, accountId: account.id as string, installments };
  }

  it("a plan, all of its installments and all of their reminders are created together", async () => {
    const { userId } = await planWithAccount();
    const body = { title: `plan-${unique()}`, totalAmount: 3_000_000, installmentAmount: 1_000_000, numberOfInstallments: 3, dueDay: 10, reminderOffsets: [60] };

    await withFault(`BEFORE INSERT ON "Reminder" WHEN NEW."userId" = '${userId}'`, async () => {
      memory.sink.clear();
      const res = await server.web("POST", "/api/installment-plans", body);
      const failed = expectRolledBack(res, "INSTALLMENT_CREATE", "InstallmentPlan");
      expect(await count("installmentPlan", { userId })).toBe(0);
      expect(await count("installment", { plan: { userId } })).toBe(0);
      expect(await count("auditLog", { requestId: failed.request_id })).toBe(0);
    });

    memory.sink.clear();
    const retry = await server.web("POST", "/api/installment-plans", body);
    expect(retry.status).toBe(201);
    expect(await count("installment", { plan: { userId } })).toBe(3);
    expect(await count("reminder", { userId, targetType: "INSTALLMENT" })).toBe(3);
    expectSuccessAfterCommit("INSTALLMENT_CREATE");
  });

  async function firstInstallment(userId: string) {
    const created = await server.mustWeb("POST", "/api/installment-plans", { title: `plan-${unique()}`, totalAmount: 2_000_000, installmentAmount: 1_000_000, numberOfInstallments: 2, dueDay: 5 });
    const installment = await server.prisma.installment.findFirstOrThrow({ where: { planId: created.plan.id, index: 1 } });
    expect(installment.status).not.toBe("PAID");
    expect(userId).toBeTruthy();
    return installment;
  }

  it("an installment is marked paid together with the expense that pays it — never one without the other", async () => {
    const { userId, accountId } = await planWithAccount();
    const installment = await firstInstallment(userId);

    await withFault(`BEFORE INSERT ON "Transaction" WHEN NEW."installmentId" = '${installment.id}'`, async () => {
      memory.sink.clear();
      const res = await server.web("POST", `/api/installments/${installment.id}/pay`, { accountId });
      const failed = expectRolledBack(res, "INSTALLMENT_PAY", "Installment");
      expect(await server.prisma.installment.findUniqueOrThrow({ where: { id: installment.id } })).toMatchObject({ status: installment.status, paidAt: null });
      expect(await count("transaction", { installmentId: installment.id })).toBe(0);
      expect(await count("auditLog", { requestId: failed.request_id })).toBe(0);
    });

    memory.sink.clear();
    const paid = await server.web("POST", `/api/installments/${installment.id}/pay`, { accountId });
    expect(paid.status).toBe(200);
    expect(paid.json.installment).toMatchObject({ id: installment.id, status: "PAID" });
    expect(await count("transaction", { installmentId: installment.id, type: "EXPENSE", amount: 1_000_000 })).toBe(1);
    expect(await count("auditLog", { entityId: installment.id, action: "PAYMENT" })).toBe(1);
    expectSuccessAfterCommit("INSTALLMENT_PAY");
  });

  it("an installment already paid is refused, and no second expense appears", async () => {
    const { userId, accountId } = await planWithAccount();
    const installment = await firstInstallment(userId);
    expect((await server.web("POST", `/api/installments/${installment.id}/pay`, { accountId })).status).toBe(200);

    const again = await server.web("POST", `/api/installments/${installment.id}/pay`, { accountId });
    expect(again.status).toBe(409);
    expect(await count("transaction", { installmentId: installment.id })).toBe(1);
    expect(await count("auditLog", { entityId: installment.id, action: "PAYMENT" })).toBe(1);
  });

  it("two payments made at the same moment pay it once: one is accepted, the other refused, one expense", async () => {
    const { userId, accountId } = await planWithAccount();
    const installment = await firstInstallment(userId);

    memory.sink.clear();
    const results = await Promise.all([
      server.web("POST", `/api/installments/${installment.id}/pay`, { accountId }),
      server.web("POST", `/api/installments/${installment.id}/pay`, { accountId }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await count("transaction", { installmentId: installment.id })).toBe(1);
    expect(await count("auditLog", { entityId: installment.id, action: "PAYMENT" })).toBe(1);
    expect(memory.sink.find("INSTALLMENT_PAY_SUCCESS")).toHaveLength(1);
    // the refused one is a caller's mistake, not an error worth an alarm
    expect(memory.sink.records.filter((record) => record.level === "ERROR")).toEqual([]);
  });
});

describe("habits and time", () => {
  it("a check-in and the virtual asset it earns are one step", async () => {
    const { userId } = await server.registerUser();
    const title = `habit-${unique()}`;
    await server.mustWeb("POST", "/api/habits", { title, virtualAssetValuePerCheckIn: 5000 });
    const habit = await server.prisma.habit.findFirstOrThrow({ where: { userId, title } });

    await withFault(`BEFORE INSERT ON "VirtualAssetEntry" WHEN NEW."userId" = '${userId}'`, async () => {
      memory.sink.clear();
      const res = await server.web("POST", `/api/habits/${habit.id}/checkin`);
      const failed = expectRolledBack(res, "HABIT_CHECKIN", "HabitCheckIn");
      expect(await count("habitCheckIn", { habitId: habit.id })).toBe(0);
      expect(await count("auditLog", { requestId: failed.request_id })).toBe(0);
    });

    memory.sink.clear();
    const retry = await server.web("POST", `/api/habits/${habit.id}/checkin`);
    expect(retry.json).toEqual({ checkedIn: true });
    expect(await count("habitCheckIn", { habitId: habit.id })).toBe(1);
    expect(await count("virtualAssetEntry", { userId, totalValue: 5000 })).toBe(1);
    expectSuccessAfterCommit("HABIT_CHECKIN");
  });

  it("un-checking removes the check-in, its virtual asset and records both tombstones — or does none of it", async () => {
    const { userId } = await server.registerUser();
    const title = `habit-undo-${unique()}`;
    await server.mustWeb("POST", "/api/habits", { title, virtualAssetValuePerCheckIn: 5000 });
    const habit = await server.prisma.habit.findFirstOrThrow({ where: { userId, title } });
    await server.mustWeb("POST", `/api/habits/${habit.id}/checkin`);
    const checkIn = await server.prisma.habitCheckIn.findFirstOrThrow({ where: { habitId: habit.id } });

    // the asset's tombstone is written first, the check-in's second: the failure comes after a delete has already happened
    await withFault(`BEFORE INSERT ON "SyncTombstone" WHEN NEW."userId" = '${userId}' AND NEW."table" = 'HabitCheckIn'`, async () => {
      memory.sink.clear();
      const res = await server.web("POST", `/api/habits/${habit.id}/checkin`);
      const failed = expectRolledBack(res, "HABIT_UNDO", "HabitCheckIn");
      expect(await count("habitCheckIn", { id: checkIn.id })).toBe(1);
      expect(await count("virtualAssetEntry", { habitCheckInId: checkIn.id })).toBe(1);
      expect(await count("syncTombstone", { userId })).toBe(0);
      expect(await count("auditLog", { requestId: failed.request_id })).toBe(0);
    });

    memory.sink.clear();
    const retry = await server.web("POST", `/api/habits/${habit.id}/checkin`);
    expect(retry.json).toEqual({ checkedIn: false });
    expect(await count("habitCheckIn", { id: checkIn.id })).toBe(0);
    expect(await count("virtualAssetEntry", { userId })).toBe(0);
    const tombstones = await server.prisma.syncTombstone.findMany({ where: { userId } });
    expect(tombstones.map((t: { table: string }) => t.table).sort()).toEqual(["HabitCheckIn", "VirtualAssetEntry"]);
    expectSuccessAfterCommit("HABIT_UNDO");
  });

  it("stopping a timer and updating the activity's total are one step: a timer that failed to stop is still running", async () => {
    const { userId } = await server.registerUser();
    const created = await server.mustWeb("POST", "/api/activities", { title: `timer-${unique()}` });
    const activityId: string = created.activity.id;
    await server.mustWeb("POST", `/api/activities/${activityId}/timer/start`);

    await withFault(`BEFORE UPDATE OF "totalDurationMin" ON "Activity" WHEN NEW."userId" = '${userId}'`, async () => {
      memory.sink.clear();
      const res = await server.web("POST", `/api/activities/${activityId}/timer/stop`);
      const failed = expectRolledBack(res, "TIME_TIMER_STOP", "Activity");
      expect(await server.prisma.timeEntry.findFirstOrThrow({ where: { activityId } })).toMatchObject({ isRunning: true, endAt: null, durationMin: null });
      expect(await count("auditLog", { requestId: failed.request_id })).toBe(0);
    });

    memory.sink.clear();
    const retry = await server.web("POST", `/api/activities/${activityId}/timer/stop`);
    expect(retry.status).toBe(200);
    expect(await server.prisma.timeEntry.findFirstOrThrow({ where: { activityId } })).toMatchObject({ isRunning: false });
    expect(await count("auditLog", { entityId: activityId, action: "TIMER_STOP" })).toBe(1);
    expectSuccessAfterCommit("TIME_TIMER_STOP");
  });
});

describe("projects, categories and settings", () => {
  it("a project and the category that goes with it are created together", async () => {
    const { userId } = await server.registerUser();
    const name = `project-${unique()}`;

    await withFault(`BEFORE INSERT ON "Category" WHEN NEW."name" = '${name}'`, async () => {
      memory.sink.clear();
      const res = await server.web("POST", "/api/projects", { name });
      expectRolledBack(res, "PROJECT_CREATE", "Project");
      expect(await count("project", { userId })).toBe(0);
      expect(await count("category", { userId, name })).toBe(0);
    });

    const retry = await server.web("POST", "/api/projects", { name });
    expect(retry.status).toBe(201);
    expect(await count("category", { userId, name })).toBe(1);
  });

  it("deleting a category and detaching its sub-categories are one step", async () => {
    const { userId } = await server.registerUser();
    const parentName = `parent-${unique()}`;
    const childName = `child-${unique()}`;
    await server.mustWeb("POST", "/api/categories", { name: parentName });
    const parent = await server.prisma.category.findFirstOrThrow({ where: { userId, name: parentName } });
    await server.mustWeb("POST", "/api/categories", { name: childName, parentCategoryId: parent.id });
    const child = await server.prisma.category.findFirstOrThrow({ where: { userId, name: childName } });

    await withFault(`BEFORE UPDATE OF "parentCategoryId" ON "Category" WHEN OLD."parentCategoryId" = '${parent.id}'`, async () => {
      memory.sink.clear();
      const res = await server.web("DELETE", `/api/categories/${parent.id}`);
      expectRolledBack(res, "CATEGORY_DELETE", "Category");
      expect((await server.prisma.category.findUniqueOrThrow({ where: { id: parent.id } })).deletedAt).toBeNull();
      expect((await server.prisma.category.findUniqueOrThrow({ where: { id: child.id } })).parentCategoryId).toBe(parent.id);
    });

    const retry = await server.web("DELETE", `/api/categories/${parent.id}`);
    expect(retry.status).toBe(200);
    expect((await server.prisma.category.findUniqueOrThrow({ where: { id: parent.id } })).deletedAt).not.toBeNull();
    expect((await server.prisma.category.findUniqueOrThrow({ where: { id: child.id } })).parentCategoryId).toBeNull();
  });

  it("a new display name and new settings are one save", async () => {
    const { userId } = await server.registerUser();
    const before = await server.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const name = `نام تازه ${unique()}`;

    await withFault(
      [`BEFORE INSERT ON "Settings" WHEN NEW."userId" = '${userId}'`, `BEFORE UPDATE ON "Settings" WHEN NEW."userId" = '${userId}'`],
      async () => {
        memory.sink.clear();
        const res = await server.web("PATCH", "/api/settings", { name, timezone: "Asia/Tehran" });
        expectRolledBack(res, "SETTINGS_UPDATE", "Settings");
        expect((await server.prisma.user.findUniqueOrThrow({ where: { id: userId } })).name).toBe(before.name); // the name was written first
      }
    );

    const retry = await server.web("PATCH", "/api/settings", { name, timezone: "Asia/Tehran" });
    expect(retry.status).toBe(200);
    expect((await server.prisma.user.findUniqueOrThrow({ where: { id: userId } })).name).toBe(name);
  });
});

describe("what a phone deletes", () => {
  it("a row deleted by a phone and the tombstone that tells the other devices are one step", async () => {
    const { userId } = await server.registerUser();
    const title = `habit-push-${unique()}`;
    await server.mustWeb("POST", "/api/habits", { title });
    const habit = await server.prisma.habit.findFirstOrThrow({ where: { userId, title } });
    await server.mustWeb("POST", `/api/habits/${habit.id}/checkin`);
    const checkIn = await server.prisma.habitCheckIn.findFirstOrThrow({ where: { habitId: habit.id } });
    const push = { tables: {}, tombstones: [{ table: "HabitCheckIn", id: checkIn.id }] };

    await withFault(`BEFORE INSERT ON "SyncTombstone" WHEN NEW."userId" = '${userId}'`, async () => {
      memory.sink.clear();
      const res = await server.web("POST", "/api/sync/push", push);
      expect(res.status).toBe(500);
      expect(await count("habitCheckIn", { id: checkIn.id })).toBe(1); // still there: a delete no other device would ever hear about
      expect(await count("syncTombstone", { userId })).toBe(0);
    });

    const retry = await server.web("POST", "/api/sync/push", push);
    expect(retry.status).toBe(200);
    expect(retry.json.tombstones).toMatchObject({ applied: 1 });
    expect(await count("habitCheckIn", { id: checkIn.id })).toBe(0);
    expect(await count("syncTombstone", { userId, table: "HabitCheckIn", rowId: checkIn.id })).toBe(1);
  });
});

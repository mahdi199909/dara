// What the phone tells the operating system about an installment's reminders: when they ring
// (09:00, not midnight), that a paid installment stops ringing, and that undoing the payment
// brings them back.
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ schedule: vi.fn(), reschedule: vi.fn(), cancel: vi.fn(), sync: vi.fn() }));
vi.mock("../nativeNotifications", () => ({
  scheduleReminderNotification: native.schedule,
  rescheduleReminderNotification: native.reschedule,
  cancelReminderNotifications: native.cancel,
  syncScheduledReminderNotifications: native.sync,
}));

import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createInstallmentPlan, payInstallment, unpayInstallment, updateInstallmentPlan } from "./installments";

const USER_ID = "user_inst_rem";
const now = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [USER_ID, "r@example.com", "hash", "Rem", now(), now()]);
  db.run(`INSERT INTO "FinanceAccount" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["acc_r", USER_ID, "نقد", now(), now()]);
  return db;
}

/** A plan whose first installment falls in the Jalali month after today, so its reminders are all still ahead. */
function makePlan(db: LocalDb, reminderOffsets: number[]) {
  return createInstallmentPlan(db, USER_ID, {
    title: "وام",
    totalAmount: 2_000_000,
    installmentAmount: 1_000_000,
    numberOfInstallments: 2,
    dueDay: 10,
    reminderOffsets,
  });
}

function reminderIdsOf(db: LocalDb, installmentId: string): string[] {
  return db.all<{ id: string }>(`SELECT "id" FROM "Reminder" WHERE "installmentId" = ?`, [installmentId]).map((r) => r.id);
}

beforeEach(() => {
  for (const fn of Object.values(native)) fn.mockReset();
});

describe("scheduling an installment's reminders", () => {
  it("rings a «1 day before» reminder at 09:00 of that day — the row itself keeps the exact lead time", async () => {
    const db = await freshDb();
    makePlan(db, [1440]);

    expect(native.schedule).toHaveBeenCalledTimes(2);
    for (const [reminder] of native.schedule.mock.calls) {
      const rings = new Date(reminder.remindAt);
      expect([rings.getHours(), rings.getMinutes()]).toEqual([9, 0]);
    }
    const stored = db.all<{ offsetMinutes: number; remindAt: string }>(`SELECT "offsetMinutes","remindAt" FROM "Reminder"`);
    expect(stored.every((r) => r.offsetMinutes === 1440)).toBe(true);
    expect(stored.some((r) => new Date(r.remindAt).getHours() === 0)).toBe(true); // stored at midnight, not 09:00
  });

  it("rings an «on the due day» reminder (offset 0) at 09:00 of the due day", async () => {
    const db = await freshDb();
    const plan = makePlan(db, [0]);
    const first = native.schedule.mock.calls.map(([r]) => new Date(r.remindAt)).sort((a, b) => a.getTime() - b.getTime())[0];
    const due = new Date(plan.installments[0].dueDate);
    expect([first.getFullYear(), first.getMonth(), first.getDate(), first.getHours()]).toEqual([due.getFullYear(), due.getMonth(), due.getDate(), 9]);
  });

  it("keeps an hours-before reminder at the hour asked (it already falls after 09:00 of the day before)", async () => {
    const db = await freshDb();
    makePlan(db, [60]);
    for (const [reminder] of native.schedule.mock.calls) {
      const rings = new Date(reminder.remindAt);
      expect([rings.getHours(), rings.getMinutes()]).toEqual([23, 0]);
    }
  });
});

describe("paying and un-paying", () => {
  it("cancels the system alarms of the reminders of a paid installment — and only that installment's", async () => {
    const db = await freshDb();
    const plan = makePlan(db, [0, 1440]);
    const [first, second] = plan.installments;
    native.cancel.mockClear();

    payInstallment(db, USER_ID, first.id, { accountId: "acc_r" });

    expect(native.cancel).toHaveBeenCalledTimes(1);
    const cancelled = native.cancel.mock.calls[0][0] as string[];
    expect([...cancelled].sort()).toEqual(reminderIdsOf(db, first.id).sort());
    expect(cancelled).toHaveLength(2);
    expect(cancelled.some((id) => reminderIdsOf(db, second.id).includes(id))).toBe(false);
  });

  it("leaves the Reminder rows in place, so undoing the payment can bring them back", async () => {
    const db = await freshDb();
    const plan = makePlan(db, [0]);
    payInstallment(db, USER_ID, plan.installments[0].id, { accountId: "acc_r" });
    expect(reminderIdsOf(db, plan.installments[0].id)).toHaveLength(1);
  });

  it("asks the system to ring again for the installment once the payment is undone", async () => {
    const db = await freshDb();
    const plan = makePlan(db, [0]);
    const first = plan.installments[0];
    payInstallment(db, USER_ID, first.id, { accountId: "acc_r" });
    native.sync.mockClear();

    unpayInstallment(db, USER_ID, first.id);

    expect(native.sync).toHaveBeenCalledTimes(1);
    const wanted = native.sync.mock.calls[0][0] as Array<{ id: string }>;
    expect(wanted.map((r) => r.id)).toContain(reminderIdsOf(db, first.id)[0]);
  });

  it("does not ask the system to ring for a paid installment when something else triggers a re-arm", async () => {
    const db = await freshDb();
    const plan = makePlan(db, [0]);
    const [first, second] = plan.installments;
    payInstallment(db, USER_ID, first.id, { accountId: "acc_r" });
    native.sync.mockClear();

    // Any later reconcile (a resume, a sync) must leave the paid one out.
    const { reconcileReminderNotifications } = await import("../reminderNotifications");
    reconcileReminderNotifications(db);

    const wanted = native.sync.mock.calls[0][0] as Array<{ id: string }>;
    expect(wanted.map((r) => r.id)).toEqual(reminderIdsOf(db, second.id));
  });
});

describe("moving the due day", () => {
  it("re-times the alarms with the same 09:00 rule", async () => {
    const db = await freshDb();
    const plan = makePlan(db, [1440]);
    native.reschedule.mockClear();

    updateInstallmentPlan(db, USER_ID, plan.id, { dueDay: 20 });

    expect(native.reschedule).toHaveBeenCalled();
    for (const [reminder] of native.reschedule.mock.calls) {
      const rings = new Date(reminder.remindAt);
      expect([rings.getHours(), rings.getMinutes()]).toEqual([9, 0]);
    }
  });
});

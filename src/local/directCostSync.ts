// On-device port of src/lib/directCostSync.ts. Same find/upsert/soft-delete-linked-Transaction
// pattern for all six functions — kept as raw SQL rather than importing the (still separately
// evolving) transactions/tasks/activities repositories, mirroring how the web version itself
// bypasses its own /api/transactions route and talks to Prisma directly.
import { computeVirtualAssetValue } from "@/lib/timeCost";
import type { LocalDb } from "./db";
import { resolveDefaultAccountId } from "./accounts";

function now() {
  return new Date().toISOString();
}

export function syncActivityDirectCostTransaction(db: LocalDb, activityId: string) {
  const activity = db.get<any>(`SELECT * FROM "Activity" WHERE "id" = ?`, [activityId]);
  if (!activity) throw new Error(`Activity ${activityId} not found`);
  const existingTx = db.get<{ id: string }>(`SELECT "id" FROM "Transaction" WHERE "activityId" = ? AND "type" = 'EXPENSE' AND "deletedAt" IS NULL`, [activityId]);

  if (activity.directCost <= 0) {
    if (existingTx) db.run(`UPDATE "Transaction" SET "deletedAt" = ? WHERE "id" = ?`, [now(), existingTx.id]);
    return;
  }

  if (existingTx) {
    db.run(`UPDATE "Transaction" SET "amount" = ?, "description" = ?, "categoryId" = ?, "projectId" = ?, "taskId" = ?, "updatedAt" = ? WHERE "id" = ?`, [
      activity.directCost,
      activity.title,
      activity.categoryId,
      activity.projectId,
      activity.taskId,
      now(),
      existingTx.id,
    ]);
  } else {
    const accountId = resolveDefaultAccountId(db, activity.userId);
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","description","accountId","categoryId","projectId","taskId","activityId","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, activity.userId, "EXPENSE", activity.directCost, activity.createdAt, activity.title, accountId, activity.categoryId, activity.projectId, activity.taskId, activityId, now(), now()]
    );
  }
}

export function syncTaskDirectCostTransaction(db: LocalDb, taskId: string) {
  const task = db.get<any>(`SELECT * FROM "Task" WHERE "id" = ?`, [taskId]);
  if (!task) throw new Error(`Task ${taskId} not found`);
  const existingTx = db.get<{ id: string }>(`SELECT "id" FROM "Transaction" WHERE "taskId" = ? AND "activityId" IS NULL AND "type" = 'EXPENSE' AND "deletedAt" IS NULL`, [taskId]);

  if (task.directCost <= 0) {
    if (existingTx) db.run(`UPDATE "Transaction" SET "deletedAt" = ? WHERE "id" = ?`, [now(), existingTx.id]);
    return;
  }

  if (existingTx) {
    db.run(`UPDATE "Transaction" SET "amount" = ?, "description" = ?, "categoryId" = ?, "projectId" = ?, "updatedAt" = ? WHERE "id" = ?`, [
      task.directCost,
      task.title,
      task.categoryId,
      task.projectId,
      now(),
      existingTx.id,
    ]);
  } else {
    const accountId = resolveDefaultAccountId(db, task.userId);
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","description","accountId","categoryId","projectId","taskId","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, task.userId, "EXPENSE", task.directCost, task.startAt ?? task.dueDate ?? task.createdAt, task.title, accountId, task.categoryId, task.projectId, taskId, now(), now()]
    );
  }
}

export function syncTaskIncomeTransaction(db: LocalDb, taskId: string) {
  const task = db.get<any>(`SELECT * FROM "Task" WHERE "id" = ?`, [taskId]);
  if (!task) throw new Error(`Task ${taskId} not found`);
  const existingTx = db.get<{ id: string }>(`SELECT "id" FROM "Transaction" WHERE "taskId" = ? AND "activityId" IS NULL AND "type" = 'INCOME' AND "deletedAt" IS NULL`, [taskId]);

  if (task.incomeAmount <= 0) {
    if (existingTx) db.run(`UPDATE "Transaction" SET "deletedAt" = ? WHERE "id" = ?`, [now(), existingTx.id]);
    return;
  }

  if (existingTx) {
    db.run(`UPDATE "Transaction" SET "amount" = ?, "description" = ?, "categoryId" = ?, "projectId" = ?, "updatedAt" = ? WHERE "id" = ?`, [
      task.incomeAmount,
      task.title,
      task.categoryId,
      task.projectId,
      now(),
      existingTx.id,
    ]);
  } else {
    const accountId = resolveDefaultAccountId(db, task.userId);
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","description","accountId","categoryId","projectId","taskId","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, task.userId, "INCOME", task.incomeAmount, task.startAt ?? task.dueDate ?? task.createdAt, task.title, accountId, task.categoryId, task.projectId, taskId, now(), now()]
    );
  }
}

export function syncTaskVirtualAsset(db: LocalDb, taskId: string) {
  const task = db.get<any>(`SELECT * FROM "Task" WHERE "id" = ?`, [taskId]);
  if (!task) throw new Error(`Task ${taskId} not found`);
  const category = task.categoryId ? db.get<any>(`SELECT * FROM "Category" WHERE "id" = ?`, [task.categoryId]) : null;

  const durationMin = task.startAt && task.endAt ? Math.max(0, Math.round((new Date(task.endAt).getTime() - new Date(task.startAt).getTime()) / 60000)) : 0;

  if (category?.generatesVirtualAsset && category.virtualAssetValuePerHour && durationMin > 0) {
    const totalValue = computeVirtualAssetValue(durationMin, category.virtualAssetValuePerHour);
    const existing = db.get<{ id: string }>(`SELECT "id" FROM "VirtualAssetEntry" WHERE "taskId" = ?`, [taskId]);
    if (existing) {
      db.run(`UPDATE "VirtualAssetEntry" SET "categoryId" = ?, "durationMin" = ?, "valuePerHour" = ?, "totalValue" = ?, "updatedAt" = ? WHERE "id" = ?`, [
        category.id,
        durationMin,
        category.virtualAssetValuePerHour,
        totalValue,
        now(),
        existing.id,
      ]);
    } else {
      db.run(
        `INSERT INTO "VirtualAssetEntry" ("id","userId","taskId","categoryId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), task.userId, taskId, category.id, durationMin, category.virtualAssetValuePerHour, totalValue, task.startAt, now(), now()]
      );
    }
  } else {
    db.run(`DELETE FROM "VirtualAssetEntry" WHERE "taskId" = ?`, [taskId]);
  }
}

export function syncEventDirectCostTransaction(db: LocalDb, eventId: string) {
  const event = db.get<any>(`SELECT * FROM "Event" WHERE "id" = ?`, [eventId]);
  if (!event) throw new Error(`Event ${eventId} not found`);
  const existingTx = db.get<{ id: string }>(`SELECT "id" FROM "Transaction" WHERE "eventId" = ? AND "type" = 'EXPENSE' AND "deletedAt" IS NULL`, [eventId]);

  if (event.directCost <= 0) {
    if (existingTx) db.run(`UPDATE "Transaction" SET "deletedAt" = ? WHERE "id" = ?`, [now(), existingTx.id]);
    return;
  }

  if (existingTx) {
    db.run(`UPDATE "Transaction" SET "amount" = ?, "description" = ?, "categoryId" = ?, "projectId" = ?, "updatedAt" = ? WHERE "id" = ?`, [
      event.directCost,
      event.title,
      event.categoryId,
      event.projectId,
      now(),
      existingTx.id,
    ]);
  } else {
    const accountId = resolveDefaultAccountId(db, event.userId);
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","description","accountId","categoryId","projectId","eventId","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, event.userId, "EXPENSE", event.directCost, event.startAt, event.title, accountId, event.categoryId, event.projectId, eventId, now(), now()]
    );
  }
}

export function syncEventIncomeTransaction(db: LocalDb, eventId: string) {
  const event = db.get<any>(`SELECT * FROM "Event" WHERE "id" = ?`, [eventId]);
  if (!event) throw new Error(`Event ${eventId} not found`);
  const existingTx = db.get<{ id: string }>(`SELECT "id" FROM "Transaction" WHERE "eventId" = ? AND "type" = 'INCOME' AND "deletedAt" IS NULL`, [eventId]);

  if (event.incomeAmount <= 0) {
    if (existingTx) db.run(`UPDATE "Transaction" SET "deletedAt" = ? WHERE "id" = ?`, [now(), existingTx.id]);
    return;
  }

  if (existingTx) {
    db.run(`UPDATE "Transaction" SET "amount" = ?, "description" = ?, "categoryId" = ?, "projectId" = ?, "updatedAt" = ? WHERE "id" = ?`, [
      event.incomeAmount,
      event.title,
      event.categoryId,
      event.projectId,
      now(),
      existingTx.id,
    ]);
  } else {
    const accountId = resolveDefaultAccountId(db, event.userId);
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","description","accountId","categoryId","projectId","eventId","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, event.userId, "INCOME", event.incomeAmount, event.startAt, event.title, accountId, event.categoryId, event.projectId, eventId, now(), now()]
    );
  }
}

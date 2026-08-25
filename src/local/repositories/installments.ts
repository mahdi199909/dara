// On-device equivalent of src/app/api/installment-plans/route.ts +
// src/app/api/installment-plans/[id]/route.ts + src/app/api/installments/[id]/pay/route.ts —
// same validation (shared schemas from @/lib/schemas/installments), same schedule generation
// (@/lib/installments.ts's generateInstallmentSchedule/summarizeInstallments, reused as-is),
// same audit actions, same 404/409 messages, so the local dispatcher (Phase 3) can return
// byte-identical shapes regardless of whether it's backed by this repository or the real HTTP
// routes.
//
// Two things the web routes do outside a Prisma `include`/relation, replicated here directly
// via raw SQL against the same tables (no repository dependency, since neither table has one
// yet):
//   - POST /api/installment-plans, when reminderOffsets are supplied, creates a Reminder row
//     per (installment x offset) — see the loop in createInstallmentPlan below.
//   - POST /api/installments/[id]/pay creates a linked EXPENSE Transaction row directly (not
//     through a Transaction repository — that's separate, parallel work not available here).
import { ApiError } from "@/lib/apiErrorBase";
import { generateInstallmentSchedule, summarizeInstallments, type InstallmentSummary } from "@/lib/installments";
import type { CreateInstallmentPlanInput, PayInstallmentInput } from "@/lib/schemas/installments";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

export interface InstallmentPlanRow {
  id: string;
  userId: string;
  title: string;
  totalAmount: number;
  installmentAmount: number;
  numberOfInstallments: number;
  dueDay: number;
  startDate: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface InstallmentRow {
  id: string;
  planId: string;
  index: number;
  dueDate: string;
  amount: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstallmentPlanWithInstallments extends InstallmentPlanRow {
  installments: InstallmentRow[];
  summary: InstallmentSummary;
}

// Full column set of the "Transaction" table this local db bootstraps to (see
// src/local/generatedSchema.ts) — exported so src/local/repositories/assets.ts's getAsset can
// read the same shape back out for its `transactions` field without redeclaring it.
export interface TransactionRow {
  id: string;
  userId: string;
  type: string;
  amount: number;
  date: string;
  description: string | null;
  accountId: string;
  transferToAccountId: string | null;
  categoryId: string | null;
  taskId: string | null;
  projectId: string | null;
  assetId: string | null;
  activityId: string | null;
  eventId: string | null;
  installmentId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function now() {
  return new Date().toISOString();
}

function listPlanInstallments(db: LocalDb, planId: string): InstallmentRow[] {
  return db.all<InstallmentRow>(`SELECT * FROM "Installment" WHERE "planId" = ? ORDER BY "index" ASC`, [planId]);
}

// summarizeInstallments (src/lib/installments.ts) expects Date objects for dueDate — bridge the
// raw ISO-string rows to its expected shape without changing what we store/return.
function withSummary(plan: InstallmentPlanRow, installments: InstallmentRow[]): InstallmentPlanWithInstallments {
  const summary = summarizeInstallments(installments.map((i) => ({ amount: i.amount, status: i.status, dueDate: new Date(i.dueDate) })));
  return { ...plan, installments, summary };
}

function getOwnedPlanRow(db: LocalDb, userId: string, id: string): InstallmentPlanRow {
  const row = db.get<InstallmentPlanRow>(`SELECT * FROM "InstallmentPlan" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("طرح قسط پیدا نشد.", 404);
  return row;
}

function getOwnedPlan(db: LocalDb, userId: string, id: string): InstallmentPlanWithInstallments {
  const row = getOwnedPlanRow(db, userId, id);
  return withSummary(row, listPlanInstallments(db, row.id));
}

export function listInstallmentPlans(db: LocalDb, userId: string): InstallmentPlanWithInstallments[] {
  const rows = db.all<InstallmentPlanRow>(`SELECT * FROM "InstallmentPlan" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "createdAt" DESC`, [userId]);
  return rows.map((row) => withSummary(row, listPlanInstallments(db, row.id)));
}

export function getInstallmentPlan(db: LocalDb, userId: string, id: string): InstallmentPlanWithInstallments {
  return getOwnedPlan(db, userId, id);
}

export function createInstallmentPlan(db: LocalDb, userId: string, input: CreateInstallmentPlanInput): InstallmentPlanWithInstallments {
  const id = crypto.randomUUID();
  const ts = now();
  const startDate = input.startDate ? new Date(input.startDate) : new Date();

  const schedule = generateInstallmentSchedule({
    startDate,
    dueDay: input.dueDay,
    numberOfInstallments: input.numberOfInstallments,
    installmentAmount: input.installmentAmount,
  });

  db.run(
    `INSERT INTO "InstallmentPlan"
       ("id","userId","title","totalAmount","installmentAmount","numberOfInstallments","dueDay","startDate","notes","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.title,
      input.totalAmount,
      input.installmentAmount,
      input.numberOfInstallments,
      input.dueDay,
      startDate.toISOString(),
      input.notes ?? null,
      ts,
      ts,
    ]
  );

  for (const item of schedule) {
    db.run(
      `INSERT INTO "Installment" ("id","planId","index","dueDate","amount","status","paidAt","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), id, item.index, item.dueDate.toISOString(), item.amount, "PENDING", null, ts, ts]
    );
  }

  // Mirrors the web route's post-create reminder fan-out: one Reminder row per
  // (installment x offset), fired offsetMinutes before that installment's own dueDate.
  if (input.reminderOffsets?.length) {
    const installments = listPlanInstallments(db, id);
    for (const installment of installments) {
      for (const offsetMinutes of input.reminderOffsets) {
        const remindAt = new Date(new Date(installment.dueDate).getTime() - offsetMinutes * 60000);
        db.run(
          `INSERT INTO "Reminder" ("id","userId","targetType","eventId","installmentId","title","offsetMinutes","remindAt","notified","dismissed","createdAt")
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [crypto.randomUUID(), userId, "INSTALLMENT", null, installment.id, `سررسید قسط: ${input.title}`, offsetMinutes, remindAt.toISOString(), 0, 0, ts]
        );
      }
    }
  }

  const fresh = getOwnedPlan(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "InstallmentPlan", entityId: id, newValue: fresh });
  return fresh;
}

export function deleteInstallmentPlan(db: LocalDb, userId: string, id: string): { ok: true } {
  const existing = getOwnedPlan(db, userId, id);

  const paidCount = existing.installments.filter((i) => i.status === "PAID").length;
  if (paidCount > 0) {
    throw new ApiError("طرحی که پرداخت انجام‌شده دارد قابل حذف نیست تا صحت گزارش‌ها حفظ شود.", 409);
  }

  db.run(`UPDATE "InstallmentPlan" SET "deletedAt" = ? WHERE "id" = ?`, [now(), id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "InstallmentPlan", entityId: id, oldValue: existing });
  return { ok: true };
}

interface InstallmentWithPlanTitle extends InstallmentRow {
  planTitle: string;
}

export function payInstallment(
  db: LocalDb,
  userId: string,
  installmentId: string,
  input: PayInstallmentInput
): { installment: InstallmentRow; transaction: TransactionRow } {
  // Same ownership shape as the web route's `plan: { userId, deletedAt: null }` filter — an
  // installment belonging to someone else's (or a deleted) plan is indistinguishable from one
  // that doesn't exist at all.
  const row = db.get<InstallmentWithPlanTitle>(
    `SELECT i.*, p."title" as "planTitle" FROM "Installment" i
     JOIN "InstallmentPlan" p ON p."id" = i."planId"
     WHERE i."id" = ? AND p."userId" = ? AND p."deletedAt" IS NULL`,
    [installmentId, userId]
  );
  if (!row) throw new ApiError("قسط پیدا نشد.", 404);
  if (row.status === "PAID") throw new ApiError("این قسط قبلاً پرداخت شده است.", 409);

  const account = db.get<{ id: string }>(`SELECT "id" FROM "FinanceAccount" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [
    input.accountId,
    userId,
  ]);
  if (!account) throw new ApiError("حساب پیدا نشد.", 404);

  const { planTitle, ...existing } = row;
  const transactionId = crypto.randomUUID();
  const ts = now();

  db.run(
    `INSERT INTO "Transaction"
       ("id","userId","type","amount","date","description","accountId","transferToAccountId","categoryId","taskId","projectId","assetId","activityId","eventId","installmentId","createdAt","updatedAt","deletedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      transactionId,
      userId,
      "EXPENSE",
      existing.amount,
      ts,
      `پرداخت قسط ${existing.index} از ${planTitle}`,
      input.accountId,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      existing.id,
      ts,
      ts,
      null,
    ]
  );

  db.run(`UPDATE "Installment" SET "status" = ?, "paidAt" = ?, "updatedAt" = ? WHERE "id" = ?`, ["PAID", ts, ts, existing.id]);

  const updated = db.get<InstallmentRow>(`SELECT * FROM "Installment" WHERE "id" = ?`, [existing.id])!;
  const transaction = db.get<TransactionRow>(`SELECT * FROM "Transaction" WHERE "id" = ?`, [transactionId])!;

  writeLocalAuditLog(db, {
    userId,
    action: "PAYMENT",
    entityType: "Installment",
    entityId: existing.id,
    oldValue: existing,
    newValue: updated,
    metadata: { transactionId },
  });

  return { installment: updated, transaction };
}

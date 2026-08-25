// On-device port of src/app/api/quick-capture/route.ts.
//
// Deliberately deferred (consistent with every other resource's deferred cross-cutting sync
// calls, see src/local/repositories/tasks.ts): the ACTIVITY branch doesn't create a TimeEntry
// for `durationMinutes` yet (needs src/local/activityService.ts's addManualTimeEntry) and no
// branch runs the direct-cost-to-Transaction sync (needs src/lib/directCostSync.ts's local
// port) — both land in the final integration pass once every base repository exists.
import { ApiError } from "@/lib/apiErrorBase";
import { parseQuickCapture } from "@/lib/parser";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";
import { resolveDefaultAccountId } from "../accounts";

export interface QuickCaptureInput {
  text: string;
  type?: "TASK" | "ACTIVITY" | "EVENT" | "EXPENSE";
  title?: string;
  durationMinutes?: number;
  amount?: number;
  date?: string;
  categoryId?: string;
  projectId?: string;
  accountId?: string;
}

function resolveCategory(db: LocalDb, userId: string, categoryId: string | undefined, hint: string | null): string | undefined {
  if (categoryId) return categoryId;
  if (!hint) return undefined;
  const match = db.get<{ id: string }>(`SELECT "id" FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL AND "name" = ? LIMIT 1`, [userId, hint]);
  return match?.id;
}

export function quickCapture(
  db: LocalDb,
  userId: string,
  input: QuickCaptureInput
): { entityType: string; entity: unknown; parsed: ReturnType<typeof parseQuickCapture> } {
  const parsed = parseQuickCapture(input.text);

  const type = input.type ?? parsed.suggestedType;
  const title = input.title ?? parsed.title;
  const durationMinutes = input.durationMinutes ?? parsed.durationMinutes ?? undefined;
  const amount = input.amount ?? parsed.amount ?? undefined;
  const date = input.date ? new Date(input.date) : parsed.date ?? undefined;
  const categoryId = resolveCategory(db, userId, input.categoryId, parsed.categoryHint);

  const now = new Date().toISOString();
  let result: { entityType: string; entity: unknown };

  if (type === "TASK") {
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO "Task" ("id","userId","title","categoryId","projectId","dueDate","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`,
      [id, userId, title, categoryId ?? null, input.projectId ?? null, date ? date.toISOString() : null, now, now]
    );
    const task = db.get(`SELECT * FROM "Task" WHERE "id" = ?`, [id]);
    writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Task", entityId: id, newValue: task, metadata: { source: "quick_capture", rawText: input.text } });
    result = { entityType: "Task", entity: task };
  } else if (type === "ACTIVITY") {
    const id = crypto.randomUUID();
    const directCost = amount ?? 0;
    db.run(
      `INSERT INTO "Activity" ("id","userId","title","categoryId","projectId","directCost","totalDurationMin","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, userId, title, categoryId ?? null, input.projectId ?? null, directCost, 0, now, now]
    );
    // durationMinutes is intentionally NOT turned into a TimeEntry yet — see file-level comment.
    void durationMinutes;
    const activity = db.get(`SELECT * FROM "Activity" WHERE "id" = ?`, [id]);
    writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Activity", entityId: id, newValue: activity, metadata: { source: "quick_capture", rawText: input.text } });
    result = { entityType: "Activity", entity: activity };
  } else if (type === "EVENT") {
    const id = crypto.randomUUID();
    const startAt = date ?? new Date();
    const endAt = new Date(startAt.getTime() + (durationMinutes ?? 60) * 60000);
    db.run(
      `INSERT INTO "Event" ("id","userId","title","startAt","endAt","categoryId","projectId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, userId, title, startAt.toISOString(), endAt.toISOString(), categoryId ?? null, input.projectId ?? null, now, now]
    );
    const event = db.get(`SELECT * FROM "Event" WHERE "id" = ?`, [id]);
    writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Event", entityId: id, newValue: event, metadata: { source: "quick_capture", rawText: input.text } });
    result = { entityType: "Event", entity: event };
  } else if (type === "EXPENSE") {
    const accountId = input.accountId ?? resolveDefaultAccountId(db, userId);
    const id = crypto.randomUUID();
    db.run(
      `INSERT INTO "Transaction" ("id","userId","type","amount","date","description","accountId","categoryId","projectId","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, userId, "EXPENSE", amount ?? 0, (date ?? new Date()).toISOString(), title, accountId, categoryId ?? null, input.projectId ?? null, now, now]
    );
    const transaction = db.get(`SELECT * FROM "Transaction" WHERE "id" = ?`, [id]);
    writeLocalAuditLog(db, { userId, action: "CREATE_EXPENSE", entityType: "Transaction", entityId: id, newValue: transaction, metadata: { source: "quick_capture", rawText: input.text } });
    result = { entityType: "Transaction", entity: transaction };
  } else {
    throw new ApiError("نوع نامعتبر است.", 400);
  }

  return { ...result, parsed };
}

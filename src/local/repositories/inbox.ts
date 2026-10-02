// On-device equivalent of src/lib/inboxServer.ts (+ the /api/inbox routes) — same validation
// (shared schemas from @/lib/schemas/inbox), same order, same 404 message and response shapes.
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateInboxItemInput, InboxDestination, InboxItemDto, InboxPriority, UpdateInboxItemInput } from "@/lib/schemas/inbox";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

interface InboxRow {
  id: string;
  userId: string;
  content: string;
  priority: number;
  processedAt: string | null;
  processedTo: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

const NOT_FOUND = "این مورد در صندوق ورودی پیدا نشد.";

function now() {
  return new Date().toISOString();
}

function toDto(row: InboxRow): InboxItemDto {
  return { id: row.id, content: row.content, priority: row.priority as InboxPriority, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function getOwnedRow(db: LocalDb, userId: string, id: string): InboxRow {
  const row = db.get<InboxRow>(`SELECT * FROM "InboxItem" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL AND "processedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError(NOT_FOUND, 404);
  return row;
}

/** What is still waiting for a decision: most urgent first, then oldest first. */
export function listInboxItems(db: LocalDb, userId: string): InboxItemDto[] {
  return db
    .all<InboxRow>(`SELECT * FROM "InboxItem" WHERE "userId" = ? AND "deletedAt" IS NULL AND "processedAt" IS NULL ORDER BY "priority" DESC, "createdAt" ASC`, [userId])
    .map(toDto);
}

export function createInboxItem(db: LocalDb, userId: string, input: CreateInboxItemInput): InboxItemDto {
  const id = crypto.randomUUID();
  const ts = now();
  db.run(`INSERT INTO "InboxItem" ("id","userId","content","priority","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [id, userId, input.content, input.priority ?? 0, ts, ts]);
  const row = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "InboxItem", entityId: id, newValue: row });
  return toDto(row);
}

export function updateInboxItem(db: LocalDb, userId: string, id: string, input: UpdateInboxItemInput): InboxItemDto {
  const existing = getOwnedRow(db, userId, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.content !== undefined) {
    sets.push(`"content" = ?`);
    params.push(input.content);
  }
  if (input.priority !== undefined) {
    sets.push(`"priority" = ?`);
    params.push(input.priority);
  }
  sets.push(`"updatedAt" = ?`);
  params.push(now());
  db.run(`UPDATE "InboxItem" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);
  const row = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "InboxItem", entityId: id, oldValue: existing, newValue: row });
  return toDto(row);
}

/** The item was turned into something else (a task, an event…): it leaves the inbox for good. */
export function processInboxItem(db: LocalDb, userId: string, id: string, to: InboxDestination): { ok: true } {
  const existing = getOwnedRow(db, userId, id);
  const ts = now();
  db.run(`UPDATE "InboxItem" SET "processedAt" = ?, "processedTo" = ?, "updatedAt" = ? WHERE "id" = ?`, [ts, to, ts, id]);
  writeLocalAuditLog(db, { userId, action: "INBOX_PROCESS", entityType: "InboxItem", entityId: id, oldValue: existing, metadata: { to } });
  return { ok: true };
}

export function deleteInboxItem(db: LocalDb, userId: string, id: string): { ok: true } {
  const existing = getOwnedRow(db, userId, id);
  const ts = now();
  db.run(`UPDATE "InboxItem" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [ts, ts, id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "InboxItem", entityId: id, oldValue: existing });
  return { ok: true };
}

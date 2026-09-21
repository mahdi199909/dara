// On-device equivalent of src/app/api/notes/route.ts + src/app/api/notes/[id]/route.ts — same
// validation (shared schemas from @/lib/schemas/notes), same 404 message and the same response shape,
// so the local dispatcher answers exactly as the server does.
import { ApiError } from "@/lib/apiErrorBase";
import type { CreateNoteInput, NoteDto, NoteQuery, UpdateNoteInput } from "@/lib/schemas/notes";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

interface NoteRow {
  id: string;
  userId: string;
  day: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function now() {
  return new Date().toISOString();
}

function toDto(row: NoteRow): NoteDto {
  return { id: row.id, day: row.day, content: row.content, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function getOwnedRow(db: LocalDb, userId: string, id: string): NoteRow {
  const row = db.get<NoteRow>(`SELECT * FROM "DailyNote" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("نوت پیدا نشد.", 404);
  return row;
}

export function listNotes(db: LocalDb, userId: string, query: NoteQuery = {}): NoteDto[] {
  const where = [`"userId" = ?`, `"deletedAt" IS NULL`];
  const params: unknown[] = [userId];
  if (query.day) {
    where.push(`"day" = ?`);
    params.push(query.day);
  }
  if (query.from) {
    where.push(`"day" >= ?`);
    params.push(query.from);
  }
  if (query.to) {
    where.push(`"day" <= ?`);
    params.push(query.to);
  }
  return db.all<NoteRow>(`SELECT * FROM "DailyNote" WHERE ${where.join(" AND ")} ORDER BY "day" ASC, "createdAt" ASC`, params).map(toDto);
}

export function createNote(db: LocalDb, userId: string, input: CreateNoteInput): NoteDto {
  const id = crypto.randomUUID();
  const ts = now();
  db.run(`INSERT INTO "DailyNote" ("id","userId","day","content","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [id, userId, input.day, input.content, ts, ts]);
  const row = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "DailyNote", entityId: id, newValue: row });
  return toDto(row);
}

export function updateNote(db: LocalDb, userId: string, id: string, input: UpdateNoteInput): NoteDto {
  const existing = getOwnedRow(db, userId, id);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.day !== undefined) {
    sets.push(`"day" = ?`);
    params.push(input.day);
  }
  if (input.content !== undefined) {
    sets.push(`"content" = ?`);
    params.push(input.content);
  }
  sets.push(`"updatedAt" = ?`);
  params.push(now());
  db.run(`UPDATE "DailyNote" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  const row = getOwnedRow(db, userId, id);
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "DailyNote", entityId: id, oldValue: existing, newValue: row });
  return toDto(row);
}

export function deleteNote(db: LocalDb, userId: string, id: string): { ok: true } {
  const existing = getOwnedRow(db, userId, id);
  const ts = now();
  db.run(`UPDATE "DailyNote" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`, [ts, ts, id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "DailyNote", entityId: id, oldValue: existing });
  return { ok: true };
}

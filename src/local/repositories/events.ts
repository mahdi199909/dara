// On-device equivalent of src/app/api/events/route.ts + src/app/api/events/[id]/route.ts +
// src/app/api/events/[id]/complete/route.ts + src/app/api/events/[id]/reminders/route.ts +
// src/app/api/reminders/[id]/route.ts — same validation (shared schemas from
// @/lib/schemas/events), same recurrence expansion (@/lib/recurrence's expandOccurrences,
// reused as-is, not re-implemented), same audit actions, same error messages, so the local
// dispatcher (Phase 3) can return byte-identical shapes regardless of whether it's backed by
// this repository or the real HTTP routes.
//
// Deliberately NOT ported yet: syncEventDirectCostTransaction / syncEventIncomeTransaction (see
// @/lib/directCostSync). Those need a local Transaction repository, which is separate parallel
// work — porting them here would mean half-building another resource before this vertical
// slice is done. See the inline "Deferred" comments in createEvent/updateEvent below.
//
// Note on fidelity (see the web routes — these asymmetries are reproduced on purpose, not
// fixed, matching the exact shapes the real routes return):
//   - GET with no from/to returns { events, occurrences: [], taskOccurrences: [] }, where each
//     event has `category` + `reminders` attached but NOT `project`. GET with a range instead
//     returns { occurrences, taskOccurrences } (no `events` key at all), where each occurrence's
//     nested `event` has `category` + `project` + `reminders` attached.
//   - createEvent's returned event has only `reminders` attached (no category/project).
//   - updateEvent's returned event has NO relations attached at all (bare row).
//   - Reminders created via createEvent's reminderOffsets are not individually audit-logged;
//     only the standalone create-reminder call (createReminder here, POST /reminders on the
//     web) writes a CREATE audit entry per reminder.
import { ApiError } from "@/lib/apiErrorBase";
import { expandOccurrences } from "@/lib/recurrence";
import type { CreateEventInput, UpdateEventInput, ToggleEventCompletionInput, CreateReminderInput } from "@/lib/schemas/events";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";
import { fetchByIds } from "../relations";

interface EventRow {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  allDay: number;
  location: string | null;
  categoryId: string | null;
  projectId: string | null;
  valueType: string;
  directCost: number;
  incomeAmount: number;
  recurrenceFreq: string;
  recurrenceInterval: number;
  recurrenceUntil: string | null;
  recurrenceCount: number | null;
  recurrenceParentId: string | null;
  isCancelled: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface ReminderRow {
  id: string;
  userId: string;
  targetType: string;
  eventId: string | null;
  installmentId: string | null;
  title: string;
  offsetMinutes: number;
  remindAt: string;
  notified: number;
  dismissed: number;
  createdAt: string;
}

interface EventCompletionRow {
  id: string;
  eventId: string;
  occurrenceDate: string;
  createdAt: string;
}

// Minimal copy of tasks.ts's own (non-exported) TaskRow — only needed here to shape the
// events route's `taskOccurrences` field. See that file for the authoritative Task repository.
interface TaskRow {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  categoryId: string | null;
  projectId: string | null;
  estimatedCost: number | null;
  completedAt: string | null;
  valueType: string;
  directCost: number;
  incomeAmount: number;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
}
interface ProjectRow {
  id: string;
  name: string;
}

/** Converts SQLite's integer boolean storage to a real boolean, matching Prisma's JSON shape. */
function toEvent(row: EventRow) {
  return { ...row, allDay: !!row.allDay, isCancelled: !!row.isCancelled };
}

/** Converts SQLite's integer boolean storage to a real boolean, matching Prisma's JSON shape. */
function toReminder(row: ReminderRow) {
  return { ...row, notified: !!row.notified, dismissed: !!row.dismissed };
}

function withCategory<T extends { categoryId: string | null }>(db: LocalDb, rows: T[]): (T & { category: CategoryRow | null })[] {
  const byId = fetchByIds<CategoryRow>(db, "Category", rows.map((r) => r.categoryId));
  return rows.map((r) => ({ ...r, category: r.categoryId ? byId.get(r.categoryId) ?? null : null }));
}

function withProject<T extends { projectId: string | null }>(db: LocalDb, rows: T[]): (T & { project: ProjectRow | null })[] {
  const byId = fetchByIds<ProjectRow>(db, "Project", rows.map((r) => r.projectId));
  return rows.map((r) => ({ ...r, project: r.projectId ? byId.get(r.projectId) ?? null : null }));
}

/** Groups Reminder rows by eventId — a to-many relation, so fetchByIds (keyed by the row's own id) doesn't fit; this is its own small helper. */
function fetchRemindersForEvents(db: LocalDb, eventIds: string[]): Map<string, ReturnType<typeof toReminder>[]> {
  const unique = [...new Set(eventIds)];
  const map = new Map<string, ReturnType<typeof toReminder>[]>();
  if (unique.length === 0) return map;

  const rows = db.all<ReminderRow>(`SELECT * FROM "Reminder" WHERE "eventId" IN (${unique.map(() => "?").join(",")})`, unique);
  for (const row of rows) {
    const reminder = toReminder(row);
    const list = map.get(row.eventId!) ?? [];
    list.push(reminder);
    map.set(row.eventId!, list);
  }
  return map;
}

function withReminders<T extends { id: string }>(db: LocalDb, rows: T[]): (T & { reminders: ReturnType<typeof toReminder>[] })[] {
  const byEventId = fetchRemindersForEvents(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, reminders: byEventId.get(r.id) ?? [] }));
}

/** Matches the (identical) ownership+existence check inlined in all three of events/[id]/*, events/[id]/complete, events/[id]/reminders route.ts files. */
function getOwnedEventRow(db: LocalDb, userId: string, id: string): EventRow {
  const row = db.get<EventRow>(`SELECT * FROM "Event" WHERE "id" = ? AND "userId" = ? AND "deletedAt" IS NULL`, [id, userId]);
  if (!row) throw new ApiError("رویداد پیدا نشد.", 404);
  return row;
}

/** Shared by createEvent's reminderOffsets loop and the standalone createReminder — same INSERT, same computed title/remindAt. */
function insertReminderRow(db: LocalDb, userId: string, event: { id: string; title: string; startAt: string }, offsetMinutes: number) {
  const id = crypto.randomUUID();
  const remindAt = new Date(new Date(event.startAt).getTime() - offsetMinutes * 60000).toISOString();

  db.run(
    `INSERT INTO "Reminder" ("id","userId","targetType","eventId","installmentId","title","offsetMinutes","remindAt","notified","dismissed","createdAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, "EVENT", event.id, null, `یادآوری: ${event.title}`, offsetMinutes, remindAt, 0, 0, now()]
  );

  return toReminder(db.get<ReminderRow>(`SELECT * FROM "Reminder" WHERE "id" = ?`, [id])!);
}

export function listEvents(db: LocalDb, userId: string, range: { from?: string | null; to?: string | null } = {}) {
  const { from, to } = range;

  if (!from || !to) {
    const rows = db.all<EventRow>(`SELECT * FROM "Event" WHERE "userId" = ? AND "deletedAt" IS NULL ORDER BY "startAt" ASC`, [userId]);
    const events = withReminders(db, withCategory(db, rows.map(toEvent)));
    return { events, occurrences: [] as unknown[], taskOccurrences: [] as unknown[] };
  }

  const rangeStart = new Date(from);
  const rangeEnd = new Date(to);
  const fromIso = rangeStart.toISOString();
  const toIso = rangeEnd.toISOString();

  const eventRows = db.all<EventRow>(
    `SELECT * FROM "Event" WHERE "userId" = ? AND "deletedAt" IS NULL AND "recurrenceParentId" IS NULL`,
    [userId]
  );
  const events = withReminders(db, withProject(db, withCategory(db, eventRows.map(toEvent))));

  const taskRows = db.all<TaskRow>(
    `SELECT * FROM "Task" WHERE "userId" = ? AND "deletedAt" IS NULL AND "dueDate" >= ? AND "dueDate" <= ? ORDER BY "dueDate" ASC`,
    [userId, fromIso, toIso]
  );
  const taskOccurrences = withProject(db, withCategory(db, taskRows));

  const completions = events.length
    ? db.all<EventCompletionRow>(
        `SELECT * FROM "EventCompletion" WHERE "eventId" IN (${events.map(() => "?").join(",")}) AND "occurrenceDate" >= ? AND "occurrenceDate" <= ?`,
        [...events.map((e) => e.id), fromIso, toIso]
      )
    : [];
  const completedSet = new Set(completions.map((c) => `${c.eventId}|${new Date(c.occurrenceDate).getTime()}`));

  const occurrencesWithDates = events.flatMap((event) => {
    const recurring = {
      id: event.id,
      startAt: new Date(event.startAt),
      endAt: new Date(event.endAt),
      recurrenceFreq: event.recurrenceFreq,
      recurrenceInterval: event.recurrenceInterval,
      recurrenceUntil: event.recurrenceUntil ? new Date(event.recurrenceUntil) : null,
      recurrenceCount: event.recurrenceCount,
    };
    return expandOccurrences(recurring, rangeStart, rangeEnd).map((occ) => ({
      occurrenceId: occ.occurrenceId,
      startAt: occ.startAt,
      endAt: occ.endAt,
      event,
      isDone: completedSet.has(`${event.id}|${occ.startAt.getTime()}`),
    }));
  });

  occurrencesWithDates.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const occurrences = occurrencesWithDates.map((occ) => ({ ...occ, startAt: occ.startAt.toISOString(), endAt: occ.endAt.toISOString() }));

  return { occurrences, taskOccurrences };
}

export function createEvent(db: LocalDb, userId: string, input: CreateEventInput) {
  const id = crypto.randomUUID();
  const createdAt = now();

  db.run(
    `INSERT INTO "Event"
       ("id","userId","title","description","startAt","endAt","allDay","location","categoryId","projectId","valueType","directCost","incomeAmount","recurrenceFreq","recurrenceInterval","recurrenceUntil","recurrenceCount","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.title,
      input.description ?? null,
      new Date(input.startAt).toISOString(),
      new Date(input.endAt).toISOString(),
      input.allDay ? 1 : 0,
      input.location ?? null,
      input.categoryId ?? null,
      input.projectId ?? null,
      input.valueType ?? "EXPENSE",
      input.directCost ?? 0,
      input.incomeAmount ?? 0,
      input.recurrenceFreq ?? "NONE",
      input.recurrenceInterval ?? 1,
      input.recurrenceUntil ? new Date(input.recurrenceUntil).toISOString() : null,
      input.recurrenceCount ?? null,
      createdAt,
      createdAt,
    ]
  );

  const row = db.get<EventRow>(`SELECT * FROM "Event" WHERE "id" = ?`, [id])!;

  // Deferred (see file header): syncEventDirectCostTransaction(id) / syncEventIncomeTransaction(id)
  // would run here when row.directCost > 0 / row.incomeAmount > 0 — needs the local Transaction
  // repository (parallel work).

  if (input.reminderOffsets?.length) {
    for (const offsetMinutes of input.reminderOffsets) {
      insertReminderRow(db, userId, row, offsetMinutes); // no per-reminder audit log — matches the web route
    }
  }

  const created = toEvent(row);
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Event", entityId: id, newValue: created });

  const reminders = fetchRemindersForEvents(db, [id]).get(id) ?? [];
  return { ...created, reminders };
}

export function updateEvent(db: LocalDb, userId: string, id: string, input: UpdateEventInput) {
  const existing = getOwnedEventRow(db, userId, id);

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`"${col}" = ?`);
    params.push(value);
  };

  if (input.title !== undefined) set("title", input.title);
  if (input.description !== undefined) set("description", input.description);
  if (input.startAt !== undefined) set("startAt", new Date(input.startAt).toISOString());
  if (input.endAt !== undefined) set("endAt", new Date(input.endAt).toISOString());
  if (input.allDay !== undefined) set("allDay", input.allDay ? 1 : 0);
  if (input.location !== undefined) set("location", input.location);
  if (input.categoryId !== undefined) set("categoryId", input.categoryId);
  if (input.projectId !== undefined) set("projectId", input.projectId);
  if (input.valueType !== undefined) set("valueType", input.valueType);
  if (input.directCost !== undefined) set("directCost", input.directCost);
  if (input.incomeAmount !== undefined) set("incomeAmount", input.incomeAmount);
  if (input.recurrenceFreq !== undefined) set("recurrenceFreq", input.recurrenceFreq);
  if (input.recurrenceInterval !== undefined) set("recurrenceInterval", input.recurrenceInterval);
  if (input.recurrenceUntil !== undefined) set("recurrenceUntil", input.recurrenceUntil ? new Date(input.recurrenceUntil).toISOString() : null);
  if (input.recurrenceCount !== undefined) set("recurrenceCount", input.recurrenceCount);
  set("updatedAt", now());

  db.run(`UPDATE "Event" SET ${sets.join(", ")} WHERE "id" = ?`, [...params, id]);

  const row = db.get<EventRow>(`SELECT * FROM "Event" WHERE "id" = ?`, [id])!;

  // Deferred (see file header): syncEventDirectCostTransaction(id) / syncEventIncomeTransaction(id)
  // would run here when input.directCost / input.incomeAmount !== undefined — needs the local
  // Transaction repository (parallel work).

  if (input.startAt !== undefined) {
    const reminders = db.all<ReminderRow>(`SELECT * FROM "Reminder" WHERE "eventId" = ?`, [id]);
    const newStartMs = new Date(row.startAt).getTime();
    for (const r of reminders) {
      const remindAt = new Date(newStartMs - r.offsetMinutes * 60000).toISOString();
      db.run(`UPDATE "Reminder" SET "remindAt" = ?, "notified" = 0 WHERE "id" = ?`, [remindAt, r.id]);
    }
  }

  const fresh = toEvent(row);
  writeLocalAuditLog(db, { userId, action: "UPDATE", entityType: "Event", entityId: id, oldValue: toEvent(existing), newValue: fresh });
  return fresh;
}

export function deleteEvent(db: LocalDb, userId: string, id: string) {
  const existing = getOwnedEventRow(db, userId, id);
  db.run(`UPDATE "Event" SET "deletedAt" = ? WHERE "id" = ?`, [now(), id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Event", entityId: id, oldValue: toEvent(existing) });
  return { ok: true };
}

/**
 * Toggles completion for one occurrence of an event (identified by its own startAt, since a
 * recurring event has no per-occurrence row — see EventCompletion in prisma/schema.prisma).
 */
export function toggleEventCompletion(db: LocalDb, userId: string, eventId: string, input: ToggleEventCompletionInput) {
  const event = getOwnedEventRow(db, userId, eventId);
  const occurrenceDate = new Date(input.occurrenceDate).toISOString();

  const existing = db.get<EventCompletionRow>(`SELECT * FROM "EventCompletion" WHERE "eventId" = ? AND "occurrenceDate" = ?`, [event.id, occurrenceDate]);

  if (existing) {
    db.run(`DELETE FROM "EventCompletion" WHERE "id" = ?`, [existing.id]);
    writeLocalAuditLog(db, { userId, action: "EVENT_UNCOMPLETE", entityType: "EventCompletion", entityId: existing.id, oldValue: existing });
    return { isDone: false };
  }

  const id = crypto.randomUUID();
  db.run(`INSERT INTO "EventCompletion" ("id","eventId","occurrenceDate","createdAt") VALUES (?,?,?,?)`, [id, event.id, occurrenceDate, now()]);
  const completion = db.get<EventCompletionRow>(`SELECT * FROM "EventCompletion" WHERE "id" = ?`, [id])!;
  writeLocalAuditLog(db, { userId, action: "EVENT_COMPLETE", entityType: "EventCompletion", entityId: id, newValue: completion });
  return { isDone: true };
}

export function createReminder(db: LocalDb, userId: string, eventId: string, input: CreateReminderInput) {
  const event = getOwnedEventRow(db, userId, eventId);
  const reminder = insertReminderRow(db, userId, event, input.offsetMinutes);
  writeLocalAuditLog(db, { userId, action: "CREATE", entityType: "Reminder", entityId: reminder.id, newValue: reminder });
  return reminder;
}

export function deleteReminder(db: LocalDb, userId: string, id: string) {
  const reminder = db.get<ReminderRow>(`SELECT * FROM "Reminder" WHERE "id" = ? AND "userId" = ?`, [id, userId]);
  if (!reminder) throw new ApiError("یادآوری پیدا نشد.", 404);

  db.run(`DELETE FROM "Reminder" WHERE "id" = ?`, [id]);
  writeLocalAuditLog(db, { userId, action: "DELETE", entityType: "Reminder", entityId: id, oldValue: toReminder(reminder) });
  return { ok: true };
}

function now() {
  return new Date().toISOString();
}

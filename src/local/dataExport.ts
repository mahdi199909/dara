// Cross-device data migration: export this device's entire local database to one JSON file,
// and import such a file back into a (typically different, freshly-installed) device's database.
// See the Android freemium pivot plan — this app is local-first (see src/local/db.ts's own
// doc comment), so "move my data to a new phone" has no server to fall back on; this file *is*
// the migration path.
//
// Both directions are deliberately schema-agnostic about column lists: exportAllData does a
// bare `SELECT *` per table and importAllData INSERTs using exactly the columns present on each
// imported row (via Object.keys). That avoids hand-maintaining a per-table column list here that
// could silently drift from prisma/schema.prisma — the only thing this file hardcodes is the
// *set of tables* and their dependency order (see DATA_EXPORT_TABLES below), which changes far
// less often than individual columns do.
import type { LocalDb } from "./db";

/**
 * Bump this whenever the shape of the exported JSON changes in a way a future importAllData
 * needs to branch on (e.g. a table split/renamed). importAllData rejects a file whose version is
 * *newer* than this (this build doesn't know that shape yet); it's expected to keep accepting
 * every older version forever, the same way this app's own on-device schema keeps replaying old
 * migrations (see src/local/db.ts's bootstrap()) rather than assuming a fresh start.
 */
export const DATA_EXPORT_VERSION = 1;

/**
 * Every on-device table that holds a user's personal data, in an order where a row's foreign
 * keys always point at a table listed *before* it — so importAllData can insert top-to-bottom
 * without ever hitting "FOREIGN KEY constraint failed" for a parent that hasn't landed yet.
 *
 * This is NOT the same order prisma/schema.prisma declares these models in — that file orders
 * models for human reading, not for data-insert safety, and following it literally would break
 * here in at least two places: Reminder is declared before Installment even though
 * Reminder.installmentId references it, and Transaction is declared before InstallmentPlan/
 * Installment/Asset even though it references all three. This list is a real topological sort
 * over every foreign key in that schema (cross-checked against src/local/generatedSchema.ts's
 * CREATE TABLE statements, which are the actual on-device source of truth).
 *
 * Deliberately excludes:
 *  - "License" — a server-only concept (see prisma/schema.prisma's own comment on that model);
 *    the destination device does its own normal license check, it doesn't inherit one.
 *  - "EmailVerification" — removed from the schema entirely; doesn't exist to export.
 *  - "_local_migrations" / "_local_license_cache" — infrastructure tables src/local/db.ts
 *    creates directly (not from a prisma migration), device-specific by nature, meaningless to
 *    replay on another device.
 *
 * Event is the one table with a *same-table* self-reference (recurrenceParentId, for a single
 * edited occurrence pointing back at its recurring series) — see insertTableRows' multi-pass
 * retry, which handles that ordering without needing a topological sort of individual rows.
 */
export const DATA_EXPORT_TABLES = [
  "User",
  "Settings",
  "Project",
  "Category",
  "Task",
  "Habit",
  "Activity",
  "HabitCheckIn",
  "TimeEntry",
  "FinanceAccount",
  "Asset",
  "AssetTransaction",
  "InstallmentPlan",
  "Installment",
  "Event",
  "EventCompletion",
  "VirtualAssetEntry",
  "Transaction",
  "Reminder",
  "AuditLog",
  "Notification",
] as const;

export type DataExportTable = (typeof DATA_EXPORT_TABLES)[number];

export interface DataExportFile {
  version: number;
  exportedAt: string;
  tables: Partial<Record<string, Record<string, unknown>[]>>;
}

/**
 * Reads every row of every table above — no WHERE clause needed: a local install has exactly
 * one "user" by construction (see src/local/localUser.ts's own comment), so every row in this
 * database already belongs to it. This also sidesteps having to hand-write JOINs for the handful
 * of child tables with no userId column of their own (TimeEntry, EventCompletion, Installment,
 * AssetTransaction, HabitCheckIn) — a plain `SELECT *` can't accidentally miss a row the way a
 * join through the wrong FK chain could.
 */
export function exportAllData(db: LocalDb): DataExportFile {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of DATA_EXPORT_TABLES) {
    tables[table] = db.all<Record<string, unknown>>(`SELECT * FROM "${table}"`);
  }
  return { version: DATA_EXPORT_VERSION, exportedAt: new Date().toISOString(), tables };
}

export type ValidateExportResult = { ok: true; file: DataExportFile } | { ok: false; error: string };

/**
 * Checks that `data` (freshly JSON.parse'd from a user-picked file) is actually shaped like this
 * app's own export before anything touches the database. Deliberately lenient about *which*
 * table keys are present (an older export may predate a table this build knows about; a newer
 * build may have stopped emitting an empty one) — importAllData already treats a missing table
 * key as "zero rows" — but strict about the two fields that describe the file itself.
 */
export function validateExportFile(data: unknown): ValidateExportResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "فایل انتخاب‌شده یک فایل خروجی معتبر نیست." };
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== "number" || !Number.isInteger(obj.version) || obj.version < 1) {
    return { ok: false, error: "فایل انتخاب‌شده خروجی این برنامه نیست (فیلد نسخه یافت نشد)." };
  }
  if (obj.version > DATA_EXPORT_VERSION) {
    return { ok: false, error: `این فایل با نسخه‌ی جدیدتری از برنامه تهیه شده (نسخه ${obj.version}) و با نسخه‌ی نصب‌شده روی این گوشی سازگار نیست.` };
  }
  if (!obj.tables || typeof obj.tables !== "object" || Array.isArray(obj.tables)) {
    return { ok: false, error: "فایل انتخاب‌شده معتبر نیست (اطلاعات جدول‌ها یافت نشد)." };
  }
  for (const [key, value] of Object.entries(obj.tables as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      return { ok: false, error: `فایل انتخاب‌شده معتبر نیست (بخش «${key}» به‌درستی ساخته نشده).` };
    }
  }

  return {
    ok: true,
    file: {
      version: obj.version,
      exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : "",
      tables: obj.tables as Record<string, Record<string, unknown>[]>,
    },
  };
}

/** Row counts per table, in export/import order, skipping tables with zero rows — used both for
 * the "this will add N tasks, M habits, ... continue?" pre-import confirmation and for showing
 * what an already-produced export contains. */
export function summarizeTableCounts(tables: DataExportFile["tables"]): Array<{ table: DataExportTable; count: number }> {
  const summary: Array<{ table: DataExportTable; count: number }> = [];
  for (const table of DATA_EXPORT_TABLES) {
    const rows = tables[table];
    if (Array.isArray(rows) && rows.length > 0) summary.push({ table, count: rows.length });
  }
  return summary;
}

export interface ImportResult {
  /** Rows actually inserted, per table. */
  added: Partial<Record<string, number>>;
  /** Rows that already existed on this device (by id, or by name for Category — see
   * isCategoryDuplicate) and were left untouched, per table. */
  skipped: Partial<Record<string, number>>;
  /** Rows that were neither a duplicate nor insertable (malformed row, or a foreign key that
   * never resolved even after retrying) — see insertTableRows. Per table. */
  errors: Partial<Record<string, number>>;
}

function existsById(db: LocalDb, table: string, id: unknown): boolean {
  if (typeof id !== "string" || id.length === 0) return false;
  return db.get(`SELECT 1 FROM "${table}" WHERE "id" = ?`, [id]) !== undefined;
}

/**
 * Category needs a second duplicate check beyond plain id-matching: getLocalUserId() (see
 * src/local/localUser.ts) seeds a fresh install with its OWN copy of DEFAULT_CATEGORIES before
 * the user ever gets to import anything, using newly-randomized ids — so the source device's
 * "خانه" and the destination device's own already-seeded "خانه" are conceptually the same
 * category but never collide by id. Falling back to this device's own User/Settings/Category
 * ids for the comparison isn't needed here: LOCAL_USER_ID is a fixed constant (see
 * src/local/localUser.ts), so the imported row's own userId is already the right value to
 * compare against on-device rows with.
 */
function isCategoryDuplicate(db: LocalDb, row: Record<string, unknown>): boolean {
  if (existsById(db, "Category", row.id)) return true;
  const { userId, name } = row;
  if (typeof userId !== "string" || typeof name !== "string") return false;
  return db.get(`SELECT 1 FROM "Category" WHERE "userId" = ? AND "name" = ?`, [userId, name]) !== undefined;
}

function isDuplicateRow(db: LocalDb, table: string, row: Record<string, unknown>): boolean {
  if (table === "Category") return isCategoryDuplicate(db, row);
  return existsById(db, table, row.id);
}

/** INSERTs using exactly the columns present on `row` — see this file's top comment for why
 * that's deliberate. Throws (constraint violation, missing required column, etc.) rather than
 * swallowing anything itself; insertTableRows is what decides how to react to that. */
function insertRow(db: LocalDb, table: string, row: Record<string, unknown>): void {
  const columns = Object.keys(row);
  if (columns.length === 0) throw new Error(`row for "${table}" has no columns`);
  const columnList = columns.map((c) => `"${c}"`).join(",");
  const placeholders = columns.map(() => "?").join(",");
  db.run(`INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`, columns.map((c) => row[c]));
}

const MAX_INSERT_PASSES = 25; // far beyond any real foreign-key chain depth in this schema

/**
 * Inserts `rows` into `table`, skipping anything already present (see isDuplicateRow) and
 * tolerating a bad row rather than aborting the whole table.
 *
 * Runs in multiple passes so Event's one same-table self-reference (recurrenceParentId, for a
 * single edited occurrence pointing back at its recurring series) succeeds regardless of which
 * order the two rows happen to appear in the array: a row that fails to insert (most likely
 * because the row it references hasn't landed yet) is deferred and retried after the rest of the
 * table has had a turn, for as long as some row keeps succeeding each pass. Once a full pass
 * inserts nothing, every row still pending is genuinely broken (bad data, not just "not ready
 * yet") and gets counted as an error instead of retried forever.
 */
function insertTableRows(db: LocalDb, table: string, rows: Record<string, unknown>[]): { added: number; skipped: number; errors: number } {
  let added = 0;
  let skipped = 0;
  let pending: Record<string, unknown>[] = [];

  for (const row of rows) {
    if (isDuplicateRow(db, table, row)) {
      skipped++;
    } else {
      pending.push(row);
    }
  }

  for (let pass = 0; pass < MAX_INSERT_PASSES && pending.length > 0; pass++) {
    const stillPending: Record<string, unknown>[] = [];
    let progressed = false;
    for (const row of pending) {
      try {
        insertRow(db, table, row);
        added++;
        progressed = true;
      } catch (err) {
        console.error(`import: failed to insert a "${table}" row (id=${String(row.id)})`, err);
        stillPending.push(row);
      }
    }
    pending = stillPending;
    if (!progressed) break;
  }

  return { added, skipped, errors: pending.length };
}

/**
 * Imports a previously-validated export file into the current device's database. The one rule
 * that matters most: this only ever INSERTs a row whose id doesn't already exist (or, for
 * Category, whose (userId, name) doesn't already exist) — it never UPDATEs or DELETEs anything,
 * so running this is always purely additive and safe to retry.
 *
 * Wrapped in a single SQL transaction (BEGIN/COMMIT via LocalDb.execute — the LocalDb interface
 * has no dedicated transaction method, but both real drivers, see src/local/drivers/browserSqlJs.ts
 * and src/local/drivers/nodeSqlite.ts, pass execute()'s raw SQL straight to sql.js, which
 * understands BEGIN/COMMIT/ROLLBACK like any SQLite connection) so a truly unexpected failure
 * (not a single bad row — those are already caught inside insertTableRows and counted, not
 * thrown) leaves the database exactly as it was rather than half-imported.
 */
export function importAllData(db: LocalDb, file: DataExportFile): ImportResult {
  const result: ImportResult = { added: {}, skipped: {}, errors: {} };

  db.execute("BEGIN TRANSACTION");
  try {
    for (const table of DATA_EXPORT_TABLES) {
      const rows = file.tables[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const { added, skipped, errors } = insertTableRows(db, table, rows);
      if (added > 0) result.added[table] = added;
      if (skipped > 0) result.skipped[table] = skipped;
      if (errors > 0) result.errors[table] = errors;
    }
    db.execute("COMMIT");
  } catch (err) {
    db.execute("ROLLBACK");
    throw err;
  }

  return result;
}

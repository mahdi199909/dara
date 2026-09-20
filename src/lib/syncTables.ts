// Hand-maintained config for the incremental push/pull sync (Phase 12 — see the "فاز ۱۲" plan
// section). Deliberately schema-agnostic about individual *columns*, same philosophy as
// src/local/dataExport.ts: only the set of syncable tables, their Prisma accessor, and their
// ownership/timestamp shape is hardcoded here, so adding a column to any model never requires
// touching this file.
//
// Excluded on purpose:
//  - "User"/"Settings" as *rows*: syncing them like every other table would overwrite a real
//    account's email/password with the on-device placeholder row (src/local/localUser.ts), or hit
//    Settings' unique(userId) constraint on every user's first sync. Their user-visible fields
//    (display name, currency unit, income, theme...) travel separately — see
//    src/lib/settingsSync.ts.
//  - "License": server-only, has no on-device counterpart to sync.
//  - "AuditLog"/"Notification": local instrumentation, not user content.
//  - "ShownInsight": has neither updatedAt nor createdAt (only a semantic `shownAt`), which this
//    cursor scheme has no column for — and the cost of not syncing it is trivial (a daily insight
//    quote can resurface on a second device inside its 30-day suppression window; no real data is
//    at stake), so it isn't worth generalizing the cursor logic just for this one table.
//
// Order matches DATA_EXPORT_TABLES (src/local/dataExport.ts) minus the tables above — that
// array is already a verified topological sort over every FK in prisma/schema.prisma, so a
// pull-side client can insert top-to-bottom without hitting "FOREIGN KEY constraint failed".
export interface SyncTableConfig {
  /** Prisma model / SQL table name, e.g. "HabitCheckIn". */
  table: string;
  /** camelCase Prisma Client accessor, e.g. "habitCheckIn". */
  model: string;
  /** True for tables with an `updatedAt @updatedAt` column — these get real last-write-wins
   * upserts. False means the table is effectively append-only (AssetTransaction/EventCompletion/
   * CapitalSnapshot have no updatedAt at all): rows are inserted once by id and never updated by sync. */
  hasUpdatedAt: boolean;
  /** True for tables with a `deletedAt` column — a soft-delete round-trips like any other field
   * change. Tables without it (HabitCheckIn, TimeEntry, Installment, VirtualAssetEntry,
   * AssetTransaction, EventCompletion, Reminder) are sometimes hard-DELETEd by the app itself
   * (e.g. habitSync.ts clearing a zero-value VirtualAssetEntry) — those deletions travel as
   * tombstones instead, see TOMBSTONE_TABLES below. */
  hasDeletedAt: boolean;
  /** Direct tables carry their own `userId` column. Parent-hop tables (5 of them) have no
   * `userId` at all — ownership must be verified through the named FK column's parent row.
   * `relationField` is the Prisma *relation* field name for nested `where` filters (e.g. pull's
   * `{ [relationField]: { userId } }`) — usually equal to `parentModel` but not always: Installment's
   * relation field is `plan`, not `installmentPlan`, even though its parent model accessor is
   * `installmentPlan`. `parentModel` is what push uses to look the parent row up directly by id. */
  ownership: { type: "direct" } | { type: "parent"; parentModel: string; relationField: string; fkColumn: string };
}

export const SYNC_TABLES: SyncTableConfig[] = [
  { table: "Project", model: "project", hasUpdatedAt: true, hasDeletedAt: true, ownership: { type: "direct" } },
  { table: "Category", model: "category", hasUpdatedAt: true, hasDeletedAt: true, ownership: { type: "direct" } },
  { table: "Task", model: "task", hasUpdatedAt: true, hasDeletedAt: true, ownership: { type: "direct" } },
  { table: "Habit", model: "habit", hasUpdatedAt: true, hasDeletedAt: true, ownership: { type: "direct" } },
  { table: "Activity", model: "activity", hasUpdatedAt: true, hasDeletedAt: true, ownership: { type: "direct" } },
  { table: "HabitCheckIn", model: "habitCheckIn", hasUpdatedAt: true, hasDeletedAt: false, ownership: { type: "parent", parentModel: "habit", relationField: "habit", fkColumn: "habitId" } },
  { table: "TimeEntry", model: "timeEntry", hasUpdatedAt: true, hasDeletedAt: false, ownership: { type: "parent", parentModel: "activity", relationField: "activity", fkColumn: "activityId" } },
  { table: "FinanceAccount", model: "financeAccount", hasUpdatedAt: true, hasDeletedAt: true, ownership: { type: "direct" } },
  { table: "Asset", model: "asset", hasUpdatedAt: true, hasDeletedAt: true, ownership: { type: "direct" } },
  { table: "AssetTransaction", model: "assetTransaction", hasUpdatedAt: false, hasDeletedAt: false, ownership: { type: "parent", parentModel: "asset", relationField: "asset", fkColumn: "assetId" } },
  { table: "InstallmentPlan", model: "installmentPlan", hasUpdatedAt: true, hasDeletedAt: true, ownership: { type: "direct" } },
  { table: "Installment", model: "installment", hasUpdatedAt: true, hasDeletedAt: false, ownership: { type: "parent", parentModel: "installmentPlan", relationField: "plan", fkColumn: "planId" } },
  { table: "Event", model: "event", hasUpdatedAt: true, hasDeletedAt: true, ownership: { type: "direct" } },
  { table: "EventCompletion", model: "eventCompletion", hasUpdatedAt: false, hasDeletedAt: false, ownership: { type: "parent", parentModel: "event", relationField: "event", fkColumn: "eventId" } },
  { table: "VirtualAssetEntry", model: "virtualAssetEntry", hasUpdatedAt: true, hasDeletedAt: false, ownership: { type: "direct" } },
  { table: "Transaction", model: "transaction", hasUpdatedAt: true, hasDeletedAt: true, ownership: { type: "direct" } },
  { table: "Reminder", model: "reminder", hasUpdatedAt: true, hasDeletedAt: false, ownership: { type: "direct" } },
  // No updatedAt column — recordDailyCapitalSnapshot upserts *today's* row in place
  // (ON CONFLICT("userId","date") DO UPDATE) as more time gets logged through the day, so a
  // same-day edit after this row's first sync won't be picked up again until a fresh row is
  // created tomorrow (a new createdAt). Historical (already-finished) days are unaffected by
  // this — they're written once and never touched again — which is what actually matters here:
  // without this table, the "سرمایه من" growth history is invisible on any second device/platform.
  { table: "CapitalSnapshot", model: "capitalSnapshot", hasUpdatedAt: false, hasDeletedAt: false, ownership: { type: "direct" } },
];

/**
 * Bumped whenever the push/pull wire format gains something an older server would silently
 * ignore (tombstones, settings, per-row rejection reasons). The server echoes it in every
 * push/pull response, so a client can tell "the server applied my deletions" from "the server
 * is still on the old build and just dropped that field" — see src/local/syncRunner.ts.
 */
export const SYNC_PROTOCOL_VERSION = 2;

/**
 * The tables the app hard-DELETEs rows from (they have no deletedAt column), on both the web
 * server and the phone. Without a record of the deletion the other side just keeps its copy
 * forever — e.g. un-checking a habit on the phone left the check-in standing on the web. Every
 * such delete records a tombstone (server: SyncTombstone table; phone: _local_sync_tombstones)
 * that travels with push/pull and is applied as a DELETE on the other side.
 */
export const TOMBSTONE_TABLES: readonly string[] = ["EventCompletion", "HabitCheckIn", "Reminder", "VirtualAssetEntry"];

/**
 * Tables whose rows can point at another row of the same table. When several rows travel together
 * the parents must be sent first (a child in an earlier request than its parent is refused), so
 * senders order rows by whether this column is set — see the phone's sync and the web backup import.
 */
export const SELF_REFERENCE_COLUMN: Readonly<Record<string, string>> = { Category: "parentCategoryId", Event: "recurrenceParentId" };

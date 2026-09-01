// Hand-maintained config for the incremental push/pull sync (Phase 12 — see the "فاز ۱۲" plan
// section). Deliberately schema-agnostic about individual *columns*, same philosophy as
// src/local/dataExport.ts: only the set of syncable tables, their Prisma accessor, and their
// ownership/timestamp shape is hardcoded here, so adding a column to any model never requires
// touching this file.
//
// Excluded on purpose:
//  - "User"/"Settings": syncing these would overwrite a real account's email/password with the
//    on-device placeholder row (src/local/localUser.ts), or hit Settings' unique(userId)
//    constraint on every user's first sync. See the plan's own "دو نکته‌ی حیاتی" warning.
//  - "License": server-only, has no on-device counterpart to sync.
//  - "AuditLog"/"Notification": local instrumentation, not user content.
//
// Order matches DATA_EXPORT_TABLES (src/local/dataExport.ts) minus the four tables above — that
// array is already a verified topological sort over every FK in prisma/schema.prisma, so a
// pull-side client can insert top-to-bottom without hitting "FOREIGN KEY constraint failed".
export interface SyncTableConfig {
  /** Prisma model / SQL table name, e.g. "HabitCheckIn". */
  table: string;
  /** camelCase Prisma Client accessor, e.g. "habitCheckIn". */
  model: string;
  /** True for tables with an `updatedAt @updatedAt` column — these get real last-write-wins
   * upserts. False means the table is effectively append-only (AssetTransaction/EventCompletion/
   * Reminder have no updatedAt at all): rows are inserted once by id and never updated by sync. */
  hasUpdatedAt: boolean;
  /** True for tables with a `deletedAt` column — a soft-delete round-trips like any other field
   * change. Tables without it (HabitCheckIn, TimeEntry, Installment, VirtualAssetEntry,
   * AssetTransaction, EventCompletion, Reminder) are sometimes hard-DELETEd by the app itself
   * (e.g. habitSync.ts clearing a zero-value VirtualAssetEntry) — that deletion never syncs,
   * a known MVP limitation alongside EventCompletion/Reminder's already-documented one. */
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
  { table: "Reminder", model: "reminder", hasUpdatedAt: false, hasDeletedAt: false, ownership: { type: "direct" } },
];

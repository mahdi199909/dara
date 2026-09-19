// Server-side counterpart of src/local/tombstones.ts: every place the web app hard-DELETEs a row
// from one of the tombstoned tables (see TOMBSTONE_TABLES in syncTables.ts) goes through here, so
// the deletion is recorded in SyncTombstone and reaches phones on their next pull. A bare
// prisma.<model>.delete() would silently leave the phone's copy standing forever.
import { prisma } from "@/lib/db";

type TombstoneModel = "eventCompletion" | "habitCheckIn" | "reminder" | "virtualAssetEntry";

const TABLE_NAME: Record<TombstoneModel, string> = {
  eventCompletion: "EventCompletion",
  habitCheckIn: "HabitCheckIn",
  reminder: "Reminder",
  virtualAssetEntry: "VirtualAssetEntry",
};

async function recordTombstones(userId: string, table: string, ids: string[]) {
  for (const rowId of ids) {
    await prisma.syncTombstone.upsert({
      where: { userId_table_rowId: { userId, table, rowId } },
      create: { userId, table, rowId },
      update: { deletedAt: new Date() },
    });
  }
}

/** Deletes every row matching `where` in `model` and records a tombstone for each. */
export async function deleteRowsWithTombstones(userId: string, model: TombstoneModel, where: Record<string, unknown>): Promise<number> {
  const delegate = (prisma as unknown as Record<TombstoneModel, { findMany: (a: unknown) => Promise<Array<{ id: string }>>; deleteMany: (a: unknown) => Promise<unknown> }>)[model];
  const rows = await delegate.findMany({ where, select: { id: true } });
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  await delegate.deleteMany({ where: { id: { in: ids } } });
  await recordTombstones(userId, TABLE_NAME[model], ids);
  return ids.length;
}

/** VirtualAssetEntry carries its own userId, so callers that only know the source row (an
 * activity, task, project or habit check-in) don't need to look the owner up separately. */
export async function deleteVirtualAssetEntriesWithTombstones(where: Record<string, unknown>): Promise<number> {
  const rows = await prisma.virtualAssetEntry.findMany({ where, select: { id: true, userId: true } });
  if (rows.length === 0) return 0;
  await prisma.virtualAssetEntry.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  for (const row of rows) await recordTombstones(row.userId, "VirtualAssetEntry", [row.id]);
  return rows.length;
}

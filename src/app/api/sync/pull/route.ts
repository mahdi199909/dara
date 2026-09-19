import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { SYNC_PROTOCOL_VERSION, SYNC_TABLES } from "@/lib/syncTables";
import { readProfileForPull } from "@/lib/profileSyncServer";
import type { NextRequest } from "next/server";

type AnyModel = { findMany: (args: any) => Promise<any[]> };
function modelFor(name: string): AnyModel {
  return (prisma as unknown as Record<string, AnyModel>)[name];
}

export async function OPTIONS() {
  return corsPreflight();
}

// `since` is optional: its absence means "everything" — first sync ever, or a user who already
// has data from the web app before this device ever ran a sync.
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const sinceParam = req.nextUrl.searchParams.get("since");
    const sinceDate = sinceParam ? new Date(sinceParam) : null;
    const since = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null;

    // Captured BEFORE querying, and returned as the client's next cursor — never the client's
    // own clock — so a row written between this query and the response isn't silently skipped
    // on the next pull just because the two clocks disagree.
    const syncedAt = new Date();

    const tables: Record<string, unknown[]> = {};

    for (const config of SYNC_TABLES) {
      const where: Record<string, unknown> =
        config.ownership.type === "direct" ? { userId } : { [config.ownership.relationField]: { userId } };

      if (since) {
        where[config.hasUpdatedAt ? "updatedAt" : "createdAt"] = { gt: since };
      }

      const model = modelFor(config.model);
      tables[config.table] = await model.findMany({ where });
    }

    // Deletions the device hasn't heard about yet (rows removed on the web, or pushed by another
    // device) — see TOMBSTONE_TABLES in syncTables.ts.
    const tombstoneRows = await prisma.syncTombstone.findMany({
      where: { userId, ...(since ? { deletedAt: { gt: since } } : {}) },
      select: { table: true, rowId: true, deletedAt: true },
    });
    const tombstones = tombstoneRows.map((t) => ({ table: t.table, id: t.rowId, deletedAt: t.deletedAt.toISOString() }));

    const profile = await readProfileForPull(userId, since);

    return withCors(NextResponse.json({ protocol: SYNC_PROTOCOL_VERSION, syncedAt: syncedAt.toISOString(), tables, tombstones, profile }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

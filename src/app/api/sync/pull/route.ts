import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { SYNC_TABLES } from "@/lib/syncTables";
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
    const since = sinceParam ? new Date(sinceParam) : null;

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

    return withCors(NextResponse.json({ syncedAt: syncedAt.toISOString(), tables }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

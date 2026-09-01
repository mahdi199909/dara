import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { SYNC_TABLES } from "@/lib/syncTables";
import type { NextRequest } from "next/server";

type PushBody = { tables?: Partial<Record<string, Record<string, unknown>[]>> };
type TableResult = { upserted: number; skipped: number; rejected: number };

// Generic multi-model access is unavoidable here — this route walks all 17 syncable models
// through one code path, the same schema-agnostic trade-off src/local/dataExport.ts makes with
// raw SQL instead of typed Prisma calls.
type AnyModel = {
  findUnique: (args: any) => Promise<any>;
  create: (args: any) => Promise<any>;
  upsert: (args: any) => Promise<any>;
};
function modelFor(name: string): AnyModel {
  return (prisma as unknown as Record<string, AnyModel>)[name];
}

export async function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as PushBody;
    const tables = body.tables ?? {};

    const results: Record<string, TableResult> = {};

    for (const config of SYNC_TABLES) {
      const rows = tables[config.table];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const result: TableResult = { upserted: 0, skipped: 0, rejected: 0 };
      const model = modelFor(config.model);

      for (const row of rows) {
        try {
          if (typeof row.id !== "string" || !row.id) {
            result.rejected++;
            continue;
          }

          // Never trust a client-supplied userId — always force it to the authenticated caller,
          // whether directly (most tables) or by verifying the parent row's owner (the 5 tables
          // with no userId column of their own).
          const data: Record<string, unknown> = { ...row };
          if (config.ownership.type === "direct") {
            data.userId = userId;
          } else {
            const parentId = row[config.ownership.fkColumn];
            const parent = await modelFor(config.ownership.parentModel).findUnique({
              where: { id: parentId },
              select: { userId: true },
            });
            if (!parent || parent.userId !== userId) {
              result.rejected++;
              continue;
            }
          }

          if (config.hasUpdatedAt) {
            const incomingUpdatedAt = new Date(data.updatedAt as string);
            const existing = await model.findUnique({ where: { id: row.id }, select: { updatedAt: true } });
            if (existing && existing.updatedAt >= incomingUpdatedAt) {
              result.skipped++;
              continue;
            }
            // Calling upsert at all re-bumps updatedAt via Prisma's @updatedAt — that's fine
            // here since we already confirmed the incoming row is strictly newer.
            await model.upsert({ where: { id: row.id }, create: data, update: data });
          } else {
            const existing = await model.findUnique({ where: { id: row.id }, select: { id: true } });
            if (existing) {
              result.skipped++;
              continue;
            }
            await model.create({ data });
          }
          result.upserted++;
        } catch {
          result.rejected++;
        }
      }

      results[config.table] = result;
    }

    return withCors(NextResponse.json({ results }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

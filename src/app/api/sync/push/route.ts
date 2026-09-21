import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { corsPreflight, withCors } from "@/lib/nativeCors";
import { SYNC_PROTOCOL_VERSION, SYNC_TABLES, TOMBSTONE_TABLES, type SyncTableConfig } from "@/lib/syncTables";
import { coerceSyncRow } from "@/lib/syncCoercion";
import { applyPushedProfile } from "@/lib/profileSyncServer";
import type { ProfilePayload } from "@/lib/profileSync";
import type { NextRequest } from "next/server";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";
import { withTransaction } from "@/lib/transaction";
import { logSyncPush } from "@/lib/observability/server/syncLog";

type Row = Record<string, unknown>;
type PushBody = {
  tables?: Partial<Record<string, Row[]>>;
  tombstones?: Array<{ table?: unknown; id?: unknown }>;
  profile?: ProfilePayload;
};
type RowIssue = { id: string; reason: string };
type TableResult = { upserted: number; skipped: number; rejected: number; rejectedRows?: RowIssue[] };

// Generic multi-model access is unavoidable here — this route walks all 17 syncable models
// through one code path, the same schema-agnostic trade-off src/local/dataExport.ts makes with
// raw SQL instead of typed Prisma calls.
type AnyModel = {
  findUnique: (args: any) => Promise<any>;
  create: (args: any) => Promise<any>;
  upsert: (args: any) => Promise<any>;
  delete: (args: any) => Promise<any>;
};
function modelFor(name: string): AnyModel {
  return (prisma as unknown as Record<string, AnyModel>)[name];
}

export async function OPTIONS() {
  return corsPreflight();
}

// Mirrors src/local/sync.ts's own pull-side retry cap, same reason: a same-table self-reference
// (Category.parentCategoryId, Event.recurrenceParentId) can arrive child-before-parent within one
// table's array. The pull side has always retried this; the push side never did, so a row shaped
// like that from any device would previously be rejected once and never tried again.
const MAX_APPLY_PASSES = 25;
const MAX_REPORTED_ISSUES_PER_TABLE = 50;
const TOMBSTONE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/** What a row's owner check needs from the database — direct tables carry userId themselves,
 * parent-hop tables are owned through their parent row. */
function ownerSelect(config: SyncTableConfig) {
  return config.ownership.type === "direct" ? { userId: true } : { [config.ownership.relationField]: { select: { userId: true } } };
}
function ownerOf(config: SyncTableConfig, row: any): string | undefined {
  return config.ownership.type === "direct" ? row?.userId : row?.[config.ownership.relationField]?.userId;
}

/** A short, human-readable cause for a row the database refused — surfaced to the phone so a
 * "rejected" count is never a mystery again. */
function describeFailure(err: unknown): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2003") return `missing parent row (foreign key ${String(err.meta?.field_name ?? "").trim()})`.replace(" )", ")");
    if (err.code === "P2002") return `duplicate of an existing row (unique ${JSON.stringify(err.meta?.target ?? "")})`;
  }
  const message = err instanceof Error ? err.message : String(err);
  const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? message).slice(0, 200);
}

async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as PushBody;
    const tables = body.tables ?? {};

    const results: Record<string, TableResult> = {};
    const tombstoneSummary = { applied: 0, ignored: 0 };

    // Deletions first, so "un-check then re-check the same habit day" (delete row A, insert row B
    // for the same unique (habitId, date)) lands in the right order within a single push.
    for (const t of Array.isArray(body.tombstones) ? body.tombstones : []) {
      const config = SYNC_TABLES.find((c) => c.table === t.table);
      if (!config || !TOMBSTONE_TABLES.includes(config.table) || typeof t.id !== "string" || !t.id) {
        tombstoneSummary.ignored++;
        continue;
      }
      const model = modelFor(config.model);
      const rowId = t.id; // (a plain string from here on — the checks above narrowed it, and a callback would not keep that)
      const existing = await model.findUnique({ where: { id: rowId }, select: ownerSelect(config) });
      if (existing && ownerOf(config, existing) !== userId) {
        tombstoneSummary.ignored++; // never let one account delete another's row
        continue;
      }
      // (resolved here, not taken from `model` above: inside the transaction below it must be the transaction's own)
      // The deletion and its tombstone are one step: a delete that lost its tombstone would never reach the other devices.
      await withTransaction(
        async () => {
          if (existing) await modelFor(config.model).delete({ where: { id: rowId } });
          await prisma.syncTombstone.upsert({
            where: { userId_table_rowId: { userId, table: config.table, rowId } },
            create: { userId, table: config.table, rowId },
            update: { deletedAt: new Date() },
          });
        },
        { entityType: config.table }
      );
      tombstoneSummary.applied++;
    }
    // Bounded growth: a device offline for over a year re-syncs from scratch anyway.
    if (tombstoneSummary.applied > 0) {
      await prisma.syncTombstone.deleteMany({ where: { userId, deletedAt: { lt: new Date(Date.now() - TOMBSTONE_RETENTION_MS) } } });
    }

    for (const config of SYNC_TABLES) {
      const rows = tables[config.table];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const result: TableResult = { upserted: 0, skipped: 0, rejected: 0 };
      const issues: RowIssue[] = [];
      const model = modelFor(config.model);
      const reject = (id: string, reason: string) => {
        result.rejected++;
        if (issues.length < MAX_REPORTED_ISSUES_PER_TABLE) issues.push({ id, reason });
      };

      // Everything that can never become valid on a later pass is decided once, up front: a bad
      // id, a value that can't be represented, a parent that isn't the caller's own. Only the
      // actual write below (which can genuinely fail on self-reference ordering) is retried.
      let pending: Row[] = [];
      for (const row of rows) {
        if (typeof row.id !== "string" || !row.id) {
          reject(String(row.id ?? ""), "missing id");
          continue;
        }

        const coerced = coerceSyncRow(config.model, row);
        if (coerced.error) {
          reject(row.id, coerced.error);
          continue;
        }
        const data = coerced.data;

        // A client that predates a table's updatedAt column (a phone on an older build pushing a
        // Reminder, or a backup made by one) sends none. Without one, last-write-wins cannot order
        // the row and it would overwrite the server's copy every time — so treat it as last
        // edited when it was created, which is all such a row ever knew.
        if (config.hasUpdatedAt && (data.updatedAt === undefined || data.updatedAt === null) && data.createdAt) {
          data.updatedAt = data.createdAt;
        }

        // Never trust a client-supplied userId — always force it to the authenticated caller,
        // whether directly (most tables) or by verifying the parent row's owner (the 5 tables
        // with no userId column of their own).
        if (config.ownership.type === "direct") {
          data.userId = userId;
        } else {
          const parentId = data[config.ownership.fkColumn];
          const parent = await modelFor(config.ownership.parentModel).findUnique({
            where: { id: parentId },
            select: { userId: true },
          });
          if (!parent || parent.userId !== userId) {
            reject(row.id, "parent row not found for this account");
            continue;
          }
        }
        pending.push(data);
      }

      const lastFailure = new Map<string, string>();
      for (let pass = 0; pass < MAX_APPLY_PASSES && pending.length > 0; pass++) {
        const stillPending: Row[] = [];
        let progressed = false;

        for (const data of pending) {
          try {
            const existing = await model.findUnique({
              where: { id: data.id },
              select: { ...ownerSelect(config), ...(config.hasUpdatedAt ? { updatedAt: true } : {}) },
            });
            if (existing && ownerOf(config, existing) !== userId) {
              reject(String(data.id), "id belongs to a different account");
              progressed = true;
              continue;
            }

            // A row deleted elsewhere must not be resurrected by a device that simply hadn't heard
            // about the deletion yet — unless it was edited after the deletion (edit wins).
            if (TOMBSTONE_TABLES.includes(config.table)) {
              const tomb = await prisma.syncTombstone.findUnique({
                where: { userId_table_rowId: { userId, table: config.table, rowId: String(data.id) } },
              });
              const stamp = new Date(String(data.updatedAt ?? data.createdAt ?? 0));
              if (tomb && tomb.deletedAt >= stamp) {
                result.skipped++;
                progressed = true;
                continue;
              }
            }

            if (config.hasUpdatedAt) {
              const incomingUpdatedAt = new Date(data.updatedAt as string);
              if (existing && existing.updatedAt >= incomingUpdatedAt) {
                result.skipped++;
              } else {
                // The incoming row carries its own updatedAt, so Prisma's @updatedAt leaves it as
                // sent — last-write-wins compares real edit times, not arrival order.
                await model.upsert({ where: { id: data.id }, create: data, update: data });
                result.upserted++;
              }
            } else if (existing) {
              result.skipped++;
            } else {
              await model.create({ data });
              result.upserted++;
            }
            progressed = true; // resolved either way — not stuck on an FK ordering issue
          } catch (err) {
            // A natural-key duplicate (same habit+day, same activity's virtual asset...) already
            // exists under another id: the logical row is there, so this isn't a failure.
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
              result.skipped++;
              progressed = true;
              continue;
            }
            lastFailure.set(String(data.id), describeFailure(err));
            stillPending.push(data);
          }
        }

        pending = stillPending;
        if (!progressed) break;
      }
      // Still failing after every retry pass — a genuine problem, not an ordering fluke.
      for (const data of pending) reject(String(data.id), lastFailure.get(String(data.id)) ?? "unknown error");

      if (issues.length > 0) result.rejectedRows = issues;
      results[config.table] = result;
    }

    const profile = body.profile ? await applyPushedProfile(userId, body.profile) : undefined;

    // Counts per table and the kinds of refusal — never the rows or the refusal texts themselves.
    logSyncPush(results, tombstoneSummary, Boolean(body.profile));

    return withCors(NextResponse.json({ protocol: SYNC_PROTOCOL_VERSION, results, tombstones: tombstoneSummary, ...(profile ? { profile } : {}) }));
  } catch (err) {
    return withCors(handleApiError(err));
  }
}

const loggedPOST = withApiLogging("POST", "/api/sync/push", POST);
export { loggedPOST as POST };

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth";
import { handleApiError } from "@/lib/apiError";
import { audit } from "@/lib/audit";
import { getLogger } from "@/lib/observability";
import { SYNC_TABLES } from "@/lib/syncTables";
import { withApiLogging } from "@/lib/observability/server/withApiLogging";

// The web backup tab has no route of its own — exporting is a full /api/sync/pull and importing a
// chunked /api/sync/push (see src/lib/webBackup.ts), which the server cannot tell from an ordinary sync.
// So once the browser has finished one, it reports it here, and this leaves the trace a backup deserves:
// an audit entry (data left, or a lot of data arrived, at this moment) and the BACKUP_* / RESTORE_* lines in
// the application log. It is the client's own account of what it did — counts only, never rows — and the
// phone's equivalent (src/local/backupAudit.ts) records the same facts on the device.
const log = getLogger(null, "backup");

const KNOWN_TABLES = new Set(SYNC_TABLES.map((config) => config.table));

const recordSchema = z.object({
  kind: z.enum(["export", "import"]),
  /** Export: rows in the file. Import: rows the server stored. */
  rows: z.number().int().min(0).max(10_000_000),
  /** Rows per table (export) / stored per table (import). */
  tables: z
    .record(z.string(), z.number().int().min(0).max(10_000_000))
    .refine((tables) => Object.keys(tables).every((name) => KNOWN_TABLES.has(name)), "نام جدول نامعتبر است."),
  /** Import only: rows the server already had, and rows it refused. */
  unchanged: z.number().int().min(0).max(10_000_000).optional(),
  rejected: z.number().int().min(0).max(10_000_000).optional(),
});

async function POST(req: NextRequest) {
  try {
    await requireUserId();
    const body = recordSchema.parse(await req.json());

    if (body.kind === "export") {
      await audit.log({ event: "BACKUP_EXPORTED", entityType: "Backup", metadata: { rows: body.rows, tables: body.tables, via: "web" }, req });
      log.info("BACKUP_COMPLETED", { rows: body.rows, tables: body.tables, layer: "server" });
    } else {
      const rejected = body.rejected ?? 0;
      await audit.log({ event: "BACKUP_IMPORTED", entityType: "Backup", metadata: { stored: body.rows, unchanged: body.unchanged ?? 0, rejected, tables: body.tables, via: "web" }, req });
      log.log(rejected > 0 ? "WARN" : "INFO", rejected > 0 ? "RESTORE_PARTIAL" : "RESTORE_COMPLETED", { stored: body.rows, unchanged: body.unchanged ?? 0, rejected, tables: body.tables, layer: "server" });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

const loggedPOST = withApiLogging("POST", "/api/backup/record", POST);
export { loggedPOST as POST };

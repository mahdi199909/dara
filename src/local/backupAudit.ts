// What the phone records when a backup file is made or restored (Settings → Backup): an audit entry —
// data has just left the database as a file, or a lot of it has just arrived — and the BACKUP_* /
// RESTORE_* lines in the application log. Counts only, never rows. Called by the Settings screen once
// the file was written / the import returned, so "success" is only ever recorded for what happened.
// (The web app's equivalent is src/app/api/backup/record/route.ts.)
import type { LocalDb } from "./db";
import type { DataExportFile, ImportResult } from "./dataExport";
import { writeLocalAuditLog } from "./audit";
import { getLogger } from "../lib/observability";

// No fixed module: BACKUP_* and RESTORE_* belong to different domains.
const log = getLogger(null, "backup");

function sum(counts: Partial<Record<string, number>>): number {
  return Object.values(counts).reduce<number>((total, count) => total + (count ?? 0), 0);
}

/** Rows per table of an export file (tables without rows are left out). */
export function countExportRows(tables: DataExportFile["tables"]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(tables)) if (Array.isArray(rows) && rows.length > 0) counts[table] = rows.length;
  return counts;
}

export function recordBackupExported(db: LocalDb, userId: string, file: DataExportFile): void {
  const tables = countExportRows(file.tables);
  const rows = sum(tables);
  writeLocalAuditLog(db, { userId, action: "BACKUP_EXPORT", entityType: "Backup", metadata: { rows, tables } });
  log.info("BACKUP_COMPLETED", { rows, tables, layer: "local" });
}

export function recordBackupImported(db: LocalDb, userId: string, result: ImportResult): void {
  const added = sum(result.added);
  const skipped = sum(result.skipped);
  const errors = sum(result.errors);
  writeLocalAuditLog(db, { userId, action: "BACKUP_IMPORT", entityType: "Backup", metadata: { added, skipped, errors, tables: result.added } });
  log.log(errors > 0 ? "WARN" : "INFO", errors > 0 ? "RESTORE_PARTIAL" : "RESTORE_COMPLETED", { added, skipped, errors, tables: result.added, layer: "local" });
}

/** A backup or restore that did not finish. `error` never carries the file's rows. */
export function recordBackupFailed(kind: "export" | "import", error: unknown): void {
  log.error(kind === "export" ? "BACKUP_FAILED" : "RESTORE_FAILED", { error, errorCode: kind === "export" ? "BACKUP-001" : "BACKUP-002", layer: "local" });
}

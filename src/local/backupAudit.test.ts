import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMemoryLogger } from "@/lib/observability/testing";
import { countExportRows, recordBackupExported, recordBackupFailed, recordBackupImported } from "./backupAudit";
import type { DataExportFile, ImportResult } from "./dataExport";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { getLocalUserId } from "./localUser";

let db: LocalDb;
let userId: string;
let memory: ReturnType<typeof installMemoryLogger>;

beforeEach(async () => {
  resetLocalDbForTests();
  db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  userId = getLocalUserId(db);
  memory = installMemoryLogger();
});
afterEach(() => memory.restore());

function auditRows() {
  return db.all<{ action: string; entityType: string; event: string; source: string; metadata: string; oldValue: string | null; newValue: string | null }>(`SELECT * FROM "AuditLog" ORDER BY "createdAt", "rowid"`);
}

const file: DataExportFile = {
  version: 1,
  exportedAt: "2026-09-20T12:00:00.000Z",
  tables: { Task: [{ id: "a", title: "کار خیلی خصوصی" }, { id: "b", title: "دیگری" }], Habit: [], Transaction: [{ id: "x", amount: 250_000 }] },
};

describe("countExportRows", () => {
  it("counts rows per table and leaves out the empty ones", () => {
    expect(countExportRows(file.tables)).toEqual({ Task: 2, Transaction: 1 });
    expect(countExportRows({})).toEqual({});
  });
});

describe("recordBackupExported", () => {
  it("leaves an audit entry with counts, and BACKUP_COMPLETED in the log — never the rows", () => {
    recordBackupExported(db, userId, file);
    const [row] = auditRows().filter((r) => r.action === "BACKUP_EXPORT");
    expect(row).toMatchObject({ entityType: "Backup", event: "BACKUP_EXPORTED", source: "local" });
    expect(JSON.parse(row.metadata)).toEqual({ rows: 3, tables: { Task: 2, Transaction: 1 } });
    expect(row.oldValue).toBeNull();
    expect(row.newValue).toBeNull();
    expect(memory.sink.find("BACKUP_COMPLETED")[0]).toMatchObject({ level: "INFO", layer: "local", metadata: { rows: 3, tables: { Task: 2, Transaction: 1 } } });
    const written = JSON.stringify(memory.sink.records) + JSON.stringify(auditRows());
    expect(written).not.toContain("خصوصی");
    expect(written).not.toContain("250000");
  });
});

describe("recordBackupImported", () => {
  const clean: ImportResult = { added: { Task: 5, Habit: 1 }, skipped: { Task: 2 }, errors: {} };

  it("records a complete restore", () => {
    recordBackupImported(db, userId, clean);
    const [row] = auditRows().filter((r) => r.action === "BACKUP_IMPORT");
    expect(row).toMatchObject({ entityType: "Backup", event: "BACKUP_IMPORTED", source: "local" });
    expect(JSON.parse(row.metadata)).toEqual({ added: 6, skipped: 2, errors: 0, tables: { Task: 5, Habit: 1 } });
    expect(memory.sink.find("RESTORE_COMPLETED")[0]).toMatchObject({ level: "INFO", layer: "local", metadata: { added: 6, skipped: 2, errors: 0 } });
    expect(memory.sink.find("RESTORE_PARTIAL")).toEqual([]);
  });

  it("calls it partial, at WARN, when some rows were refused", () => {
    recordBackupImported(db, userId, { ...clean, errors: { Task: 3 } });
    expect(memory.sink.find("RESTORE_PARTIAL")[0]).toMatchObject({ level: "WARN", metadata: { errors: 3 } });
    expect(memory.sink.find("RESTORE_COMPLETED")).toEqual([]);
    expect(JSON.parse(auditRows().find((r) => r.action === "BACKUP_IMPORT")!.metadata).errors).toBe(3);
  });
});

describe("recordBackupFailed", () => {
  it("logs a failed export and a failed restore with their own codes", () => {
    recordBackupFailed("export", new Error("no space left on device"));
    recordBackupFailed("import", new Error("unexpected token"));
    expect(memory.sink.find("BACKUP_FAILED")[0]).toMatchObject({ level: "ERROR", layer: "local", error_code: "BACKUP-001" });
    expect(memory.sink.find("RESTORE_FAILED")[0]).toMatchObject({ level: "ERROR", layer: "local", error_code: "BACKUP-002" });
    expect(auditRows().filter((r) => r.action.startsWith("BACKUP_"))).toEqual([]); // nothing happened, so no history entry
  });
});

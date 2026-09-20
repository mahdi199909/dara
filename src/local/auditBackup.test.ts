// The history travels inside a backup file (AuditLog is one of the exported tables). The audit columns
// added in phase 2 must survive an export/import round trip, and a backup made before them — which has
// none of the new columns — must still restore.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMemoryLogger } from "@/lib/observability/testing";
import { writeLocalAuditLog } from "./audit";
import { exportAllData, importAllData, validateExportFile } from "./dataExport";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { getLocalUserId } from "./localUser";

let memory: ReturnType<typeof installMemoryLogger>;
beforeEach(() => {
  memory = installMemoryLogger();
});
afterEach(() => memory.restore());

async function freshDb(): Promise<{ db: LocalDb; userId: string }> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  return { db, userId: getLocalUserId(db) };
}

describe("backup files and the audit history", () => {
  it("carries the new audit columns through an export and an import", async () => {
    const source = await freshDb();
    writeLocalAuditLog(source.db, {
      userId: source.userId,
      action: "UPDATE",
      entityType: "Task",
      entityId: "t1",
      oldValue: { id: "t1", title: "a", status: "TODO" },
      newValue: { id: "t1", title: "b", status: "DONE" },
    });
    const file = exportAllData(source.db);
    expect(file.tables.AuditLog).toHaveLength(1);
    expect(file.tables.AuditLog![0]).toMatchObject({ event: "TASK_UPDATED", source: "local" });

    // it survives being written to disk and read back
    const validated = validateExportFile(JSON.parse(JSON.stringify(file)));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const target = await freshDb();
    const result = importAllData(target.db, validated.file);
    expect(result.added.AuditLog).toBe(1);
    expect(result.errors.AuditLog).toBeUndefined();
    const [row] = target.db.all<Record<string, unknown>>(`SELECT * FROM "AuditLog"`);
    expect(row).toMatchObject({ action: "UPDATE", entityType: "Task", event: "TASK_UPDATED", source: "local" });
    expect(row.localEventId).toMatch(/^lev_/);
    expect(JSON.parse(row.changes as string).changedFields.sort()).toEqual(["status", "title"]);
  });

  it("restores a backup made before the new columns existed", async () => {
    const target = await freshDb();
    const legacy = {
      version: 1,
      exportedAt: "2026-08-01T00:00:00.000Z",
      tables: {
        AuditLog: [
          { id: "legacy-1", userId: target.userId, action: "CREATE", entityType: "Task", entityId: "t9", oldValue: null, newValue: '{"title":"x"}', ipAddress: null, userAgent: null, metadata: null, createdAt: "2026-07-01T00:00:00.000Z" },
        ],
      },
    };
    const validated = validateExportFile(legacy);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const result = importAllData(target.db, validated.file);
    expect(result.added.AuditLog).toBe(1);
    const [row] = target.db.all<Record<string, unknown>>(`SELECT * FROM "AuditLog"`);
    expect(row).toMatchObject({ id: "legacy-1", action: "CREATE", event: null, source: null, changes: null });
  });
});

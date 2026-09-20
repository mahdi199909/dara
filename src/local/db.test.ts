import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";

describe("local db bootstrap", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("applies every migration on a fresh database", async () => {
    const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
    const applied = db.all<{ name: string }>(`SELECT "name" FROM "_local_migrations"`);
    expect(applied.length).toBeGreaterThan(0);
    // Proves the replay actually ran (not just recorded) — a core table from the very first
    // migration must be queryable.
    expect(() => db.all(`SELECT * FROM "User"`)).not.toThrow();
  });

  it("re-opening an already-bootstrapped database is a no-op, not a re-replay", async () => {
    const driver = await createNodeSqliteDriver(":memory:");
    openLocalDb(driver);
    resetLocalDbForTests();
    // If bootstrap() ever replayed already-applied migrations again, this second pass would hit
    // "table already exists" here and throw.
    expect(() => openLocalDb(driver)).not.toThrow();
  });

  it("applying a migration the driver hasn't seen only replays that one, not every earlier one too", async () => {
    const driver = await createNodeSqliteDriver(":memory:");
    // Simulates a real upgrading device: pre-populate _local_migrations with every migration
    // except the last, without ever having created that last migration's table. If bootstrap()
    // fell back to replaying everything whenever counts mismatch (the old, buggy behavior), this
    // would throw "table X already exists" for every earlier migration's CREATE TABLE.
    driver.execute(`CREATE TABLE "_local_migrations" ("name" TEXT NOT NULL PRIMARY KEY, "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    const { LOCAL_SCHEMA_MIGRATIONS } = await import("./generatedSchema");
    for (const migration of LOCAL_SCHEMA_MIGRATIONS.slice(0, -1)) {
      driver.execute(migration.sql);
      driver.run(`INSERT INTO "_local_migrations" ("name") VALUES (?)`, [migration.name]);
    }

    expect(() => openLocalDb(driver)).not.toThrow();

    const appliedNames = driver.all<{ name: string }>(`SELECT "name" FROM "_local_migrations"`).map((r) => r.name);
    expect(appliedNames).toEqual(LOCAL_SCHEMA_MIGRATIONS.map((m) => m.name));
  });
});

describe("the audit-history migration", () => {
  beforeEach(() => {
    resetLocalDbForTests(); // openLocalDb() otherwise hands back the previous test's database
  });

  it("upgrades a phone that already has a history without touching a single row, and the new writer works straight away", async () => {
    const { LOCAL_SCHEMA_MIGRATIONS } = await import("./generatedSchema");
    const audit = LOCAL_SCHEMA_MIGRATIONS.find((migration) => migration.name.endsWith("_audit_log_evolution"));
    expect(audit, "the audit migration must be part of the generated on-device schema (npm run local:schema)").toBeDefined();

    // A phone from before this release: every earlier migration applied, a user, and a row written by the old writer.
    const driver = await createNodeSqliteDriver(":memory:");
    driver.execute(`CREATE TABLE "_local_migrations" ("name" TEXT NOT NULL PRIMARY KEY, "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    for (const migration of LOCAL_SCHEMA_MIGRATIONS.filter((candidate) => candidate !== audit)) {
      driver.execute(migration.sql);
      driver.run(`INSERT INTO "_local_migrations" ("name") VALUES (?)`, [migration.name]);
    }
    driver.run(`INSERT INTO "User" ("id", "email", "passwordHash", "name", "updatedAt") VALUES ('u1', 'a@example.test', 'x', 'n', CURRENT_TIMESTAMP)`);
    driver.run(
      `INSERT INTO "AuditLog" ("id", "userId", "action", "entityType", "entityId", "oldValue", "newValue", "metadata", "createdAt") VALUES ('old-1', 'u1', 'UPDATE', 'Task', 't1', '{"title":"a"}', '{"title":"b"}', NULL, '2026-01-01T00:00:00.000Z')`
    );
    const columnsBefore = driver.all<{ name: string }>(`PRAGMA table_info("AuditLog")`).map((column) => column.name);
    expect(columnsBefore).not.toContain("event");

    const db = openLocalDb(driver);

    const columnsAfter = db.all<{ name: string }>(`PRAGMA table_info("AuditLog")`).map((column) => column.name);
    for (const added of ["event", "source", "requestId", "traceId", "deviceId", "localEventId", "changes"]) expect(columnsAfter, added).toContain(added);
    const [old] = db.all<Record<string, unknown>>(`SELECT * FROM "AuditLog" WHERE "id" = 'old-1'`);
    expect(old).toMatchObject({ userId: "u1", action: "UPDATE", entityType: "Task", entityId: "t1", oldValue: '{"title":"a"}', newValue: '{"title":"b"}', createdAt: "2026-01-01T00:00:00.000Z", event: null, source: null, changes: null });

    const { writeLocalAuditLog } = await import("./audit");
    writeLocalAuditLog(db, { userId: "u1", action: "CREATE", entityType: "Task", entityId: "t2", newValue: { id: "t2" } });
    const { listAuditLogs } = await import("./repositories/auditLogs");
    const { logs } = listAuditLogs(db, "u1");
    expect(logs.map((log) => log.id)).toContain("old-1");
    expect(logs).toHaveLength(2);
    expect(logs.find((log) => log.entityId === "t2")).toMatchObject({ event: "TASK_CREATED", source: "local" });
  });
});

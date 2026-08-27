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

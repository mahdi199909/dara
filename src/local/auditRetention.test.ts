import { beforeEach, describe, expect, it } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { getLocalUserId } from "./localUser";
import { LOCAL_AUDIT_RETENTION_DAYS, purgeExpiredLocalAuditLogs } from "./auditRetention";

let db: LocalDb;
let userId: string;
const NOW = new Date("2026-09-20T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function insert(id: string, createdAt: Date) {
  db.run(`INSERT INTO "AuditLog" ("id", "userId", "action", "entityType", "createdAt") VALUES (?, ?, 'CREATE', 'Task', ?)`, [id, userId, createdAt.toISOString()]);
}
function ids(): string[] {
  return db.all<{ id: string }>(`SELECT "id" FROM "AuditLog" ORDER BY "id"`).map((row) => row.id);
}

beforeEach(async () => {
  resetLocalDbForTests();
  db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  userId = getLocalUserId(db);
});

describe("purgeExpiredLocalAuditLogs", () => {
  it("keeps two years by default", () => {
    expect(LOCAL_AUDIT_RETENTION_DAYS).toBe(730);
  });

  it("deletes what is older than the retention and keeps what is not, and says how many went", () => {
    insert("ancient", new Date(NOW.getTime() - 900 * DAY));
    insert("just-expired", new Date(NOW.getTime() - 731 * DAY));
    insert("just-inside", new Date(NOW.getTime() - 729 * DAY));
    insert("recent", new Date(NOW.getTime() - 3 * DAY));
    expect(purgeExpiredLocalAuditLogs(db, NOW)).toBe(2);
    expect(ids()).toEqual(["just-inside", "recent"]);
  });

  it("does nothing on an empty or fully current history", () => {
    expect(purgeExpiredLocalAuditLogs(db, NOW)).toBe(0);
    insert("recent", NOW);
    expect(purgeExpiredLocalAuditLogs(db, NOW)).toBe(0);
    expect(ids()).toEqual(["recent"]);
  });

  it("honours another window", () => {
    insert("a", new Date(NOW.getTime() - 40 * DAY));
    insert("b", new Date(NOW.getTime() - 10 * DAY));
    expect(purgeExpiredLocalAuditLogs(db, NOW, 30)).toBe(1);
    expect(ids()).toEqual(["b"]);
  });

  it("touches nothing but the audit history", () => {
    insert("ancient", new Date(NOW.getTime() - 900 * DAY));
    const users = db.all(`SELECT * FROM "User"`).length;
    purgeExpiredLocalAuditLogs(db, NOW);
    expect(db.all(`SELECT * FROM "User"`)).toHaveLength(users);
  });
});

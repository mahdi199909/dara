import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { getLocalUserId, mergeDuplicateCategories } from "./localUser";

const ts = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  return openLocalDb(await createNodeSqliteDriver(":memory:"));
}

function insertCategory(db: LocalDb, userId: string, name: string, opts: { projectId?: string | null; createdAt?: string } = {}) {
  const id = crypto.randomUUID();
  const now = opts.createdAt ?? ts();
  db.run(
    `INSERT INTO "Category" ("id","userId","name","icon","color","kind","valueType","isActive","generatesVirtualAsset","projectId","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,1,0,?,?,?)`,
    [id, userId, name, "🏷️", "#3a8d80", "NEUTRAL", "EXPENSE", opts.projectId ?? null, now, now]
  );
  return id;
}

function insertTask(db: LocalDb, userId: string, categoryId: string | null) {
  const id = crypto.randomUUID();
  const now = ts();
  db.run(
    `INSERT INTO "Task" ("id","userId","title","status","categoryId","valueType","directCost","incomeAmount","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, "کار", "TODO", categoryId, "EXPENSE", 0, 0, now, now]
  );
  return id;
}

describe("mergeDuplicateCategories", () => {
  beforeEach(() => resetLocalDbForTests());

  it("merges same-name categories into the oldest one and repoints referencing rows", async () => {
    const db = await freshDb();
    const userId = getLocalUserId(db);
    const older = insertCategory(db, userId, "کار", { createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = insertCategory(db, userId, "کار", { createdAt: "2026-06-01T00:00:00.000Z" });
    const taskId = insertTask(db, userId, newer);

    mergeDuplicateCategories(db, userId);

    const remaining = db.all<{ id: string }>(`SELECT "id" FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL AND "name" = ?`, [userId, "کار"]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(older);

    const task = db.get<{ categoryId: string }>(`SELECT "categoryId" FROM "Task" WHERE "id" = ?`, [taskId]);
    expect(task?.categoryId).toBe(older);

    const deleted = db.get<{ deletedAt: string | null }>(`SELECT "deletedAt" FROM "Category" WHERE "id" = ?`, [newer]);
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it("does not merge same-name categories that belong to different projects (or no project)", async () => {
    const db = await freshDb();
    const userId = getLocalUserId(db);
    const projectId = crypto.randomUUID();
    db.run(`INSERT INTO "Project" ("id","userId","name","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      projectId,
      userId,
      "کار",
      "ACTIVE",
      ts(),
      ts(),
    ]);
    insertCategory(db, userId, "کار"); // plain default category
    insertCategory(db, userId, "کار", { projectId }); // a project happens to be named "کار" too

    mergeDuplicateCategories(db, userId);

    const rows = db.all(`SELECT "id" FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL AND "name" = ?`, [userId, "کار"]);
    expect(rows).toHaveLength(2);
  });

  it("is a no-op when there are no duplicates", async () => {
    const db = await freshDb();
    const userId = getLocalUserId(db);
    const before = db.all(`SELECT "id" FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]).length;

    mergeDuplicateCategories(db, userId);

    const after = db.all(`SELECT "id" FROM "Category" WHERE "userId" = ? AND "deletedAt" IS NULL`, [userId]).length;
    expect(after).toBe(before);
  });
});

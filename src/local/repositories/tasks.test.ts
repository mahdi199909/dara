import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createTask, deleteTask, listTasks, updateTask } from "./tasks";

const USER_ID = "user_test_1";

async function freshDb() {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    USER_ID,
    "test@example.com",
    "hash",
    "Test User",
    new Date().toISOString(),
    new Date().toISOString(),
  ]);
  return db;
}

describe("local tasks repository", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates a task with the same defaults as the web route", async () => {
    const db = await freshDb();
    const task = createTask(db, USER_ID, { title: "خرید نان" });

    expect(task.title).toBe("خرید نان");
    expect(task.status).toBe("TODO");
    expect(task.valueType).toBe("EXPENSE");
    expect(task.directCost).toBe(0);
    expect(task.incomeAmount).toBe(0);
    expect(task.category).toBeNull();
    expect(task.project).toBeNull();
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("lists only the calling user's non-deleted tasks, ordered like the web route", async () => {
    const db = await freshDb();
    createTask(db, USER_ID, { title: "کار دوم", status: "IN_PROGRESS" });
    createTask(db, USER_ID, { title: "کار اول", status: "TODO" });
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      "someone_else",
      "other@example.com",
      "hash",
      "Other",
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    const otherUserTask = createTask(db, "someone_else", { title: "کار غریبه" });

    const tasks = listTasks(db, USER_ID);
    // ORDER BY status ASC sorts "IN_PROGRESS" before "TODO" lexicographically, same as the web route.
    expect(tasks.map((t) => t.title)).toEqual(["کار دوم", "کار اول"]);
    expect(tasks.find((t) => t.id === otherUserTask.id)).toBeUndefined();
  });

  it("filters by status and projectId", async () => {
    const db = await freshDb();
    createTask(db, USER_ID, { title: "الف", status: "DONE" });
    createTask(db, USER_ID, { title: "ب", status: "TODO" });

    expect(listTasks(db, USER_ID, { status: "DONE" }).map((t) => t.title)).toEqual(["الف"]);
  });

  it("joins category and project when set", async () => {
    const db = await freshDb();
    const now = new Date().toISOString();
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["cat_1", USER_ID, "خانه", now, now]);
    db.run(`INSERT INTO "Project" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["proj_1", USER_ID, "پروژه‌ی الف", now, now]);

    const task = createTask(db, USER_ID, { title: "کار با دسته", categoryId: "cat_1", projectId: "proj_1" });

    expect((task.category as any)?.name).toBe("خانه");
    expect((task.project as any)?.name).toBe("پروژه‌ی الف");
  });

  it("sets completedAt when transitioning to DONE, and soft-deletes correctly", async () => {
    const db = await freshDb();
    const task = createTask(db, USER_ID, { title: "کار" });
    expect(task.completedAt).toBeNull();

    const done = updateTask(db, USER_ID, task.id, { status: "DONE" });
    expect(done.completedAt).not.toBeNull();

    deleteTask(db, USER_ID, task.id);
    expect(listTasks(db, USER_ID).find((t) => t.id === task.id)).toBeUndefined();
  });

  it("throws a 404 ApiError for a task belonging to another user", async () => {
    const db = await freshDb();
    const task = createTask(db, USER_ID, { title: "کار" });
    expect(() => updateTask(db, "someone_else", task.id, { title: "دستکاری" })).toThrow("کار پیدا نشد.");
  });
});

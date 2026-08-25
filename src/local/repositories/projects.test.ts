import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import type { LocalDb } from "../db";
import { createProject, deleteProject, getProject, listProjects, updateProject } from "./projects";
import { createTask } from "./tasks";

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

function findCategoryByProjectId(db: LocalDb, projectId: string) {
  return db.get<{ id: string; name: string; icon: string | null; kind: string; valueType: string; isActive: number; projectId: string | null }>(
    `SELECT * FROM "Category" WHERE "projectId" = ?`,
    [projectId]
  );
}

describe("local projects repository", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates a project with the same defaults as the web route, and pairs a matching category", async () => {
    const db = await freshDb();
    const project = createProject(db, USER_ID, { name: "پروژه‌ی الف" });

    expect(project.name).toBe("پروژه‌ی الف");
    expect(project.status).toBe("ACTIVE");
    expect(project.color).toBe("#3a8d80");
    expect(project.completedAt).toBeNull();
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);

    const category = findCategoryByProjectId(db, project.id);
    expect(category?.name).toBe("پروژه‌ی الف");
    expect(category?.icon).toBe("📁");
    expect(category?.kind).toBe("PRODUCTIVE");
    expect(category?.valueType).toBe("ASSET");
    expect(category?.isActive).toBe(1);
  });

  it("lists only the calling user's non-deleted projects, ordered like the web route, with task counts", async () => {
    const db = await freshDb();
    const projectA = createProject(db, USER_ID, { name: "پروژه دوم" });
    const projectB = createProject(db, USER_ID, { name: "پروژه اول" });
    // Force distinct createdAt values so ORDER BY createdAt DESC is deterministic regardless
    // of how fast the two creates above ran (they can land in the same millisecond).
    db.run(`UPDATE "Project" SET "createdAt" = ? WHERE "id" = ?`, ["2024-01-01T00:00:00.000Z", projectA.id]);
    db.run(`UPDATE "Project" SET "createdAt" = ? WHERE "id" = ?`, ["2024-01-02T00:00:00.000Z", projectB.id]);

    createTask(db, USER_ID, { title: "کار ۱", projectId: projectB.id });
    createTask(db, USER_ID, { title: "کار ۲", projectId: projectB.id });
    const deletedTask = createTask(db, USER_ID, { title: "کار حذف‌شده", projectId: projectB.id });
    db.run(`UPDATE "Task" SET "deletedAt" = ? WHERE "id" = ?`, [new Date().toISOString(), deletedTask.id]);

    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      "someone_else",
      "other@example.com",
      "hash",
      "Other",
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    const otherUserProject = createProject(db, "someone_else", { name: "پروژه غریبه" });

    const projects = listProjects(db, USER_ID);
    // ORDER BY createdAt DESC, same as the web route.
    expect(projects.map((p) => p.name)).toEqual(["پروژه اول", "پروژه دوم"]);
    expect(projects.find((p) => p.id === projectA.id)?._count.tasks).toBe(0);
    expect(projects.find((p) => p.id === projectB.id)?._count.tasks).toBe(2); // the soft-deleted task doesn't count
    expect(projects.find((p) => p.id === otherUserProject.id)).toBeUndefined();
  });

  it("getProject returns the owned project with its (non-deleted) tasks", async () => {
    const db = await freshDb();
    const project = createProject(db, USER_ID, { name: "پروژه" });
    createTask(db, USER_ID, { title: "کار پروژه", projectId: project.id });
    const deletedTask = createTask(db, USER_ID, { title: "کار حذف‌شده", projectId: project.id });
    db.run(`UPDATE "Task" SET "deletedAt" = ? WHERE "id" = ?`, [new Date().toISOString(), deletedTask.id]);

    const result = getProject(db, USER_ID, project.id);
    expect(result.project.id).toBe(project.id);
    expect(result.tasks).toHaveLength(1);
    expect((result.tasks[0] as { title: string }).title).toBe("کار پروژه");
  });

  it("renames the paired category when the project is renamed", async () => {
    const db = await freshDb();
    const project = createProject(db, USER_ID, { name: "نام قدیمی" });

    updateProject(db, USER_ID, project.id, { name: "نام جدید" });

    const category = findCategoryByProjectId(db, project.id);
    expect(category?.name).toBe("نام جدید");
  });

  it("sets completedAt on transition to COMPLETED and clears it when un-completed", async () => {
    const db = await freshDb();
    const project = createProject(db, USER_ID, { name: "پروژه" });
    expect(project.completedAt).toBeNull();

    const completed = updateProject(db, USER_ID, project.id, { status: "COMPLETED" });
    expect(completed.completedAt).not.toBeNull();

    const reactivated = updateProject(db, USER_ID, project.id, { status: "ACTIVE" });
    expect(reactivated.completedAt).toBeNull();
  });

  it("deactivates (not deletes) the paired category on project soft-delete", async () => {
    const db = await freshDb();
    const project = createProject(db, USER_ID, { name: "پروژه" });

    deleteProject(db, USER_ID, project.id);

    expect(listProjects(db, USER_ID).find((p) => p.id === project.id)).toBeUndefined();
    const category = findCategoryByProjectId(db, project.id);
    expect(category).toBeDefined();
    expect(category?.isActive).toBe(0);
  });

  it("throws a 404 ApiError for a project belonging to another user", async () => {
    const db = await freshDb();
    const project = createProject(db, USER_ID, { name: "پروژه" });
    expect(() => updateProject(db, "someone_else", project.id, { name: "دستکاری" })).toThrow("پروژه پیدا نشد.");
  });
});

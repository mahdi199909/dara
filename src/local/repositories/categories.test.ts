import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { createCategory, deleteCategory, listCategories, reorderCategories, updateCategory } from "./categories";

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

describe("local categories repository", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates a category with the same defaults as the web route", async () => {
    const db = await freshDb();
    const category = createCategory(db, USER_ID, { name: "خانه" });

    expect(category.name).toBe("خانه");
    expect(category.color).toBe("#3a8d80");
    expect(category.kind).toBe("NEUTRAL");
    expect(category.valueType).toBe("EXPENSE");
    expect(category.isActive).toBe(true);
    expect(category.generatesVirtualAsset).toBe(false);
    expect(category.virtualAssetValuePerHour).toBeNull();
    expect(category.projectId).toBeNull();
    expect(category.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("lists only the calling user's non-deleted categories, ordered like the web route", async () => {
    const db = await freshDb();
    const catB = createCategory(db, USER_ID, { name: "دوم" });
    const catA = createCategory(db, USER_ID, { name: "اول" });
    // Force distinct createdAt values so ORDER BY createdAt ASC is deterministic regardless
    // of how fast the two creates above ran (they can land in the same millisecond).
    db.run(`UPDATE "Category" SET "createdAt" = ? WHERE "id" = ?`, ["2024-01-01T00:00:00.000Z", catB.id]);
    db.run(`UPDATE "Category" SET "createdAt" = ? WHERE "id" = ?`, ["2024-01-02T00:00:00.000Z", catA.id]);
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      "someone_else",
      "other@example.com",
      "hash",
      "Other",
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    const otherUserCategory = createCategory(db, "someone_else", { name: "دسته غریبه" });

    const categories = listCategories(db, USER_ID);
    // ORDER BY createdAt ASC, same as the web route.
    expect(categories.map((c) => c.name)).toEqual(["دوم", "اول"]);
    expect(categories.find((c) => c.id === otherUserCategory.id)).toBeUndefined();
  });

  it("does not filter the list by isActive, matching the web route", async () => {
    const db = await freshDb();
    const category = createCategory(db, USER_ID, { name: "غیرفعال" });
    updateCategory(db, USER_ID, category.id, { isActive: false });

    const categories = listCategories(db, USER_ID);
    expect(categories.find((c) => c.id === category.id)?.isActive).toBe(false);
  });

  it("updates fields and can clear virtualAssetValuePerHour back to null", async () => {
    const db = await freshDb();
    const category = createCategory(db, USER_ID, {
      name: "قدیمی",
      generatesVirtualAsset: true,
      virtualAssetValuePerHour: 5000,
    });

    const updated = updateCategory(db, USER_ID, category.id, { name: "جدید", virtualAssetValuePerHour: null });
    expect(updated.name).toBe("جدید");
    expect(updated.generatesVirtualAsset).toBe(true); // untouched field stays as-is
    expect(updated.virtualAssetValuePerHour).toBeNull();
  });

  it("soft-deletes a category (excluded from the list afterwards)", async () => {
    const db = await freshDb();
    const category = createCategory(db, USER_ID, { name: "حذف‌شدنی" });

    deleteCategory(db, USER_ID, category.id);
    expect(listCategories(db, USER_ID).find((c) => c.id === category.id)).toBeUndefined();
  });

  it("throws a 404 ApiError for a category belonging to another user", async () => {
    const db = await freshDb();
    const category = createCategory(db, USER_ID, { name: "من" });
    expect(() => updateCategory(db, "someone_else", category.id, { name: "دستکاری" })).toThrow("دسته‌بندی پیدا نشد.");
  });

  it("reorders categories to match the given id order, ignoring an id it doesn't own", async () => {
    const db = await freshDb();
    const a = createCategory(db, USER_ID, { name: "الف" });
    const b = createCategory(db, USER_ID, { name: "ب" });
    const c = createCategory(db, USER_ID, { name: "ج" });

    reorderCategories(db, USER_ID, [c.id, "not-a-real-id", a.id, b.id]);

    expect(listCategories(db, USER_ID).map((cat) => cat.name)).toEqual(["ج", "الف", "ب"]);
  });

  it("puts a newly created category after everything already reordered, not back at sortOrder 0", async () => {
    const db = await freshDb();
    const a = createCategory(db, USER_ID, { name: "الف" });
    const b = createCategory(db, USER_ID, { name: "ب" });
    reorderCategories(db, USER_ID, [b.id, a.id]);

    createCategory(db, USER_ID, { name: "تازه" });

    expect(listCategories(db, USER_ID).map((cat) => cat.name)).toEqual(["ب", "الف", "تازه"]);
  });

  it("creates a sub-category under a parent and nulls it out again when the parent is deleted", async () => {
    const db = await freshDb();
    const parent = createCategory(db, USER_ID, { name: "ورزش" });
    const child = createCategory(db, USER_ID, { name: "پوش‌آپ", parentCategoryId: parent.id });
    expect(child.parentCategoryId).toBe(parent.id);

    deleteCategory(db, USER_ID, parent.id);

    const reloaded = updateCategory(db, USER_ID, child.id, { name: "پوش‌آپ" }); // re-read via a no-op-ish update
    expect(reloaded.parentCategoryId).toBeNull();
  });

  it("rejects a sub-category being used as someone else's parent (one level only)", async () => {
    const db = await freshDb();
    const parent = createCategory(db, USER_ID, { name: "ورزش" });
    const child = createCategory(db, USER_ID, { name: "پوش‌آپ", parentCategoryId: parent.id });

    expect(() => createCategory(db, USER_ID, { name: "دیگر", parentCategoryId: child.id })).toThrow(
      "یک زیردسته نمی‌تواند خودش والدِ دسته‌ی دیگری باشد."
    );
  });

  it("rejects a category being set as its own parent", async () => {
    const db = await freshDb();
    const category = createCategory(db, USER_ID, { name: "ورزش" });
    expect(() => updateCategory(db, USER_ID, category.id, { parentCategoryId: category.id })).toThrow("یک دسته‌بندی نمی‌تواند والدِ خودش باشد.");
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { DATA_EXPORT_VERSION, exportAllData, validateExportFile, importAllData, type DataExportFile } from "./dataExport";

// Deliberately the same literal value src/local/localUser.ts's LOCAL_USER_ID constant always
// bootstraps a fresh install with — dataExport.ts itself never imports that constant (it doesn't
// need to: it treats every row generically), but using the same id here is what makes these
// fixtures faithfully reproduce the real cross-device scenario, where the source and destination
// device's User/Settings rows collide by id because that id is fixed, not randomly generated.
const USER_ID = "local-device-user";

const ts = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    USER_ID,
    "local@device",
    "",
    "دستگاه اول",
    ts(),
    ts(),
  ]);
  return db;
}

function userRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { id: USER_ID, email: "local@device", passwordHash: "", name: "دستگاه دوم", createdAt: ts(), updatedAt: ts(), ...overrides };
}

function categoryRow(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    userId: USER_ID,
    name: "دسته",
    icon: "🏷️",
    color: "#3a8d80",
    kind: "NEUTRAL",
    valueType: "EXPENSE",
    isActive: 1,
    generatesVirtualAsset: 0,
    virtualAssetValuePerHour: null,
    projectId: null,
    createdAt: ts(),
    updatedAt: ts(),
    deletedAt: null,
    ...overrides,
  };
}

function projectRow(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    userId: USER_ID,
    name: "پروژه",
    description: null,
    status: "ACTIVE",
    color: "#3a8d80",
    createdAt: ts(),
    updatedAt: ts(),
    deletedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function taskRow(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    userId: USER_ID,
    title: "کار",
    description: null,
    status: "TODO",
    dueDate: null,
    categoryId: null,
    projectId: null,
    estimatedCost: null,
    completedAt: null,
    valueType: "EXPENSE",
    directCost: 0,
    incomeAmount: 0,
    startAt: null,
    endAt: null,
    createdAt: ts(),
    updatedAt: ts(),
    deletedAt: null,
    ...overrides,
  };
}

function eventRow(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    userId: USER_ID,
    title: "رویداد",
    description: null,
    startAt: ts(),
    endAt: ts(),
    allDay: 0,
    location: null,
    categoryId: null,
    projectId: null,
    valueType: "EXPENSE",
    directCost: 0,
    incomeAmount: 0,
    recurrenceFreq: "NONE",
    recurrenceInterval: 1,
    recurrenceUntil: null,
    recurrenceCount: null,
    recurrenceParentId: null,
    isCancelled: 0,
    createdAt: ts(),
    updatedAt: ts(),
    deletedAt: null,
    ...overrides,
  };
}

function fileOf(tables: DataExportFile["tables"]): DataExportFile {
  return { version: DATA_EXPORT_VERSION, exportedAt: ts(), tables };
}

describe("exportAllData", () => {
  beforeEach(() => resetLocalDbForTests());

  it("includes every known table (even empty ones) and the version/exportedAt fields", async () => {
    const db = await freshDb();
    const file = exportAllData(db);

    expect(file.version).toBe(DATA_EXPORT_VERSION);
    expect(typeof file.exportedAt).toBe("string");
    expect(new Date(file.exportedAt).toString()).not.toBe("Invalid Date");
    expect(file.tables.User).toHaveLength(1);
    expect((file.tables.User![0] as { id: string }).id).toBe(USER_ID);
    // A table nothing was inserted into still shows up as an empty array, not missing entirely —
    // the UI (and importAllData) can rely on every key from DATA_EXPORT_TABLES being present.
    expect(file.tables.Task).toEqual([]);
  });

  it("captures rows from a table with no direct userId column (e.g. via other repositories)", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [
      "cat-1",
      USER_ID,
      "خانه",
      ts(),
      ts(),
    ]);
    const file = exportAllData(db);
    expect(file.tables.Category).toHaveLength(1);
    expect((file.tables.Category![0] as { name: string }).name).toBe("خانه");
  });
});

describe("validateExportFile", () => {
  it("rejects non-object input", () => {
    expect(validateExportFile(null).ok).toBe(false);
    expect(validateExportFile("a string").ok).toBe(false);
    expect(validateExportFile([1, 2, 3]).ok).toBe(false);
  });

  it("rejects a missing or non-numeric version", () => {
    const result = validateExportFile({ tables: {} });
    expect(result.ok).toBe(false);
  });

  it("rejects a version newer than this build knows how to read", () => {
    const result = validateExportFile({ version: DATA_EXPORT_VERSION + 1, exportedAt: ts(), tables: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/جدیدتر/);
  });

  it("rejects a missing or malformed tables field", () => {
    expect(validateExportFile({ version: 1 }).ok).toBe(false);
    expect(validateExportFile({ version: 1, tables: [] }).ok).toBe(false);
    expect(validateExportFile({ version: 1, tables: { Task: "not-an-array" } }).ok).toBe(false);
  });

  it("accepts a well-formed file", () => {
    const result = validateExportFile({ version: 1, exportedAt: "2026-01-01T00:00:00.000Z", tables: { Task: [{ id: "t1" }] } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.tables.Task).toHaveLength(1);
  });
});

describe("importAllData — insert-or-skip", () => {
  beforeEach(() => resetLocalDbForTests());

  it("skips a User row that already exists by id, without touching its fields", async () => {
    const db = await freshDb();
    const file = fileOf({ User: [userRow({ name: "این اسم نباید جایگزین بشه" })] });

    const result = importAllData(db, file);

    expect(result.skipped.User).toBe(1);
    expect(result.added.User).toBeUndefined();
    const row = db.get<{ name: string }>(`SELECT "name" FROM "User" WHERE "id" = ?`, [USER_ID]);
    expect(row?.name).toBe("دستگاه اول"); // the original, pre-existing row — never overwritten
  });

  it("inserts a new row whose id doesn't exist yet", async () => {
    const db = await freshDb();
    const task = taskRow({ id: "task-from-other-phone", title: "کار وارد شده" });
    const result = importAllData(db, fileOf({ Task: [task] }));

    expect(result.added.Task).toBe(1);
    expect(result.skipped.Task).toBeUndefined();
    const row = db.get(`SELECT * FROM "Task" WHERE "id" = ?`, ["task-from-other-phone"]);
    expect(row).toBeTruthy();
  });

  it("is idempotent: importing the exact same file twice only adds rows once", async () => {
    const db = await freshDb();
    const file = fileOf({ Task: [taskRow({ id: "task-1" })], User: [userRow()] });

    const first = importAllData(db, file);
    expect(first.added.Task).toBe(1);
    expect(first.skipped.User).toBe(1);

    const second = importAllData(db, file);
    expect(second.added.Task).toBeUndefined();
    expect(second.skipped.Task).toBe(1);
    expect(second.skipped.User).toBe(1);

    const count = db.get<{ n: number }>(`SELECT COUNT(*) as n FROM "Task"`);
    expect(count?.n).toBe(1); // not duplicated
  });

  it("counts a genuinely malformed row as an error without losing the rest of the table", async () => {
    const db = await freshDb();
    const good = taskRow({ id: "good-task" });
    const bad = { id: "bad-task", userId: USER_ID }; // missing required NOT NULL "title"
    const result = importAllData(db, fileOf({ Task: [good, bad] }));

    expect(result.added.Task).toBe(1);
    expect(result.errors.Task).toBe(1);
    expect(db.get(`SELECT * FROM "Task" WHERE "id" = ?`, ["good-task"])).toBeTruthy();
    expect(db.get(`SELECT * FROM "Task" WHERE "id" = ?`, ["bad-task"])).toBeUndefined();
  });
});

describe("importAllData — Category dedup", () => {
  beforeEach(() => resetLocalDbForTests());

  it("skips an imported default category that collides by (userId, name) even though its id is different", async () => {
    const db = await freshDb();
    // Simulates the destination device's OWN fresh-install seed (see getLocalUserId in
    // src/local/localUser.ts) — a real "کار" default category with a randomly-generated id
    // that will never match the imported row's id.
    db.run(
      `INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`,
      ["cat-fresh-install", USER_ID, "کار", ts(), ts()]
    );

    const importedDefault = categoryRow({ id: "cat-from-other-phone", name: "کار" });
    const importedCustom = categoryRow({ id: "cat-custom-from-other-phone", name: "پروژه شخصی من" });
    const result = importAllData(db, fileOf({ Category: [importedDefault, importedCustom] }));

    expect(result.skipped.Category).toBe(1);
    expect(result.added.Category).toBe(1);

    const rows = db.all<{ id: string; name: string }>(`SELECT "id","name" FROM "Category" WHERE "userId" = ? ORDER BY "name"`, [USER_ID]);
    expect(rows).toHaveLength(2); // not 3 — no duplicate "کار"
    expect(rows.map((r) => r.name).sort()).toEqual(["پروژه شخصی من", "کار"]);
    // The surviving "کار" row is still the device's own original, not the imported one.
    expect(rows.find((r) => r.name === "کار")?.id).toBe("cat-fresh-install");
  });

  it("still allows a category with the same name for a genuinely different user", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      "other-user",
      "other@example.com",
      "",
      "کاربر دیگر",
      ts(),
      ts(),
    ]);
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["cat-a", USER_ID, "کار", ts(), ts()]);

    const imported = categoryRow({ id: "cat-b", userId: "other-user", name: "کار" });
    const result = importAllData(db, fileOf({ Category: [imported] }));

    expect(result.added.Category).toBe(1);
    expect(result.skipped.Category).toBeUndefined();
  });
});

describe("importAllData — foreign key insert order", () => {
  beforeEach(() => resetLocalDbForTests());

  it("inserts Project, then Category (which references it), then Task (which references both) with zero errors", async () => {
    const db = await freshDb();
    const projectId = "proj-1";
    const categoryId = "cat-1";
    const file = fileOf({
      Project: [projectRow({ id: projectId })],
      Category: [categoryRow({ id: categoryId, projectId })],
      Task: [taskRow({ id: "task-1", projectId, categoryId })],
    });

    const result = importAllData(db, file);

    expect(result.errors).toEqual({});
    expect(result.added.Project).toBe(1);
    expect(result.added.Category).toBe(1);
    expect(result.added.Task).toBe(1);
    const task = db.get<{ categoryId: string; projectId: string }>(`SELECT * FROM "Task" WHERE "id" = ?`, ["task-1"]);
    expect(task?.categoryId).toBe(categoryId);
    expect(task?.projectId).toBe(projectId);
  });

  it("inserts a Reminder that references an Installment even though InstallmentPlan/Installment aren't declared until later in prisma/schema.prisma", async () => {
    const db = await freshDb();
    const planId = "plan-1";
    const installmentId = "inst-1";
    const file = fileOf({
      InstallmentPlan: [
        {
          id: planId,
          userId: USER_ID,
          title: "قسط",
          totalAmount: 1000,
          installmentAmount: 100,
          numberOfInstallments: 10,
          dueDay: 1,
          startDate: ts(),
          notes: null,
          createdAt: ts(),
          updatedAt: ts(),
          deletedAt: null,
        },
      ],
      Installment: [{ id: installmentId, planId, index: 1, dueDate: ts(), amount: 100, status: "PENDING", paidAt: null, createdAt: ts(), updatedAt: ts() }],
      Reminder: [
        {
          id: "rem-1",
          userId: USER_ID,
          targetType: "INSTALLMENT",
          eventId: null,
          installmentId,
          title: "یادآوری قسط",
          offsetMinutes: 60,
          remindAt: ts(),
          notified: 0,
          dismissed: 0,
          createdAt: ts(),
        },
      ],
    });

    const result = importAllData(db, file);

    expect(result.errors).toEqual({});
    expect(result.added.InstallmentPlan).toBe(1);
    expect(result.added.Installment).toBe(1);
    expect(result.added.Reminder).toBe(1);
  });
});

describe("importAllData — same-table self reference (Event.recurrenceParentId)", () => {
  beforeEach(() => resetLocalDbForTests());

  it("inserts a child occurrence listed BEFORE its recurring-series parent in the array", async () => {
    const db = await freshDb();
    const parentId = "evt-parent";
    const child = eventRow({ id: "evt-child", recurrenceParentId: parentId });
    const parent = eventRow({ id: parentId, recurrenceParentId: null });

    // Worst-case ordering on purpose: the row that depends on the other comes first.
    const result = importAllData(db, fileOf({ Event: [child, parent] }));

    expect(result.errors.Event).toBeUndefined();
    expect(result.added.Event).toBe(2);
    const childRow = db.get<{ recurrenceParentId: string | null }>(`SELECT * FROM "Event" WHERE "id" = ?`, ["evt-child"]);
    expect(childRow?.recurrenceParentId).toBe(parentId);
  });
});

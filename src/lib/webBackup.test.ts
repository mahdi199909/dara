import { describe, expect, it } from "vitest";
import { LOCAL_USER_ID } from "@/local/localUser";
import { DATA_EXPORT_VERSION, validateExportFile } from "@/local/dataExport";
import { backupFileName, buildBackupFile, importBackupToServer, remapDuplicateCategories, restorableCounts, type BackupApi } from "./webBackup";

const T = "2026-09-01T00:00:00.000Z";

describe("buildBackupFile", () => {
  it("makes a file the phone's own restore accepts, with every table present", () => {
    const file = buildBackupFile({ Task: [{ id: "t1", userId: "real-server-id", title: "x", createdAt: T, updatedAt: T }] }, new Date("2026-09-19T10:00:00Z"));
    expect(file.version).toBe(DATA_EXPORT_VERSION);
    expect(file.exportedAt).toBe("2026-09-19T10:00:00.000Z");
    expect(validateExportFile(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    expect(file.tables.Habit).toEqual([]); // an empty table is present, not missing
  });

  it("gives rows the placeholder owner every phone backup uses, and leaves parent-hop rows (no userId) alone", () => {
    const file = buildBackupFile({
      Task: [{ id: "t1", userId: "real-server-id", title: "x" }],
      HabitCheckIn: [{ id: "c1", habitId: "h1", date: T }],
    });
    expect(file.tables.Task![0].userId).toBe(LOCAL_USER_ID);
    expect(file.tables.HabitCheckIn![0]).toEqual({ id: "c1", habitId: "h1", date: T });
  });
});

describe("backupFileName", () => {
  it("is dated", () => {
    expect(backupFileName(new Date("2026-09-19T23:59:00Z"))).toBe("parva-backup-2026-09-19.json");
  });
});

describe("restorableCounts", () => {
  it("counts only what a web import restores, in dependency order, skipping empty tables", () => {
    const counts = restorableCounts({
      Notification: [{ id: "n" }],
      User: [{ id: "u" }],
      Task: [{ id: "a" }, { id: "b" }],
      Category: [{ id: "c" }],
      Habit: [],
    });
    expect(counts).toEqual([
      { table: "Category", count: 1 },
      { table: "Task", count: 2 },
    ]);
  });
});

describe("remapDuplicateCategories", () => {
  const existing = [
    { id: "srv-work", name: "کار" },
    { id: "srv-home", name: "خانه" },
  ];

  it("drops a category the account has by name and re-points everything that used it", () => {
    const { tables, merged } = remapDuplicateCategories(
      {
        Category: [
          { id: "ph-work", name: "کار" },
          { id: "ph-new", name: "ورزش" },
          { id: "ph-sub", name: "پوش‌آپ", parentCategoryId: "ph-work" },
        ],
        Task: [{ id: "t1", categoryId: "ph-work" }, { id: "t2", categoryId: "ph-new" }, { id: "t3", categoryId: null }],
        Transaction: [{ id: "x1", categoryId: "ph-work" }],
      },
      existing
    );
    expect(merged).toBe(1);
    expect(tables.Category.map((c) => c.id)).toEqual(["ph-new", "ph-sub"]);
    expect(tables.Category.find((c) => c.id === "ph-sub")!.parentCategoryId).toBe("srv-work");
    expect(tables.Task.map((t) => t.categoryId)).toEqual(["srv-work", "ph-new", null]);
    expect(tables.Transaction[0].categoryId).toBe("srv-work");
  });

  it("keeps a category the account already has by id (the server merges it as the same row)", () => {
    const { tables, merged } = remapDuplicateCategories({ Category: [{ id: "srv-work", name: "کار (تغییر نام)" }] }, existing);
    expect(merged).toBe(0);
    expect(tables.Category).toHaveLength(1);
  });

  it("collapses two same-named categories inside the file itself", () => {
    const { tables, merged } = remapDuplicateCategories(
      { Category: [{ id: "a", name: "جدید" }, { id: "b", name: "جدید" }], Task: [{ id: "t", categoryId: "b" }] },
      existing
    );
    expect(merged).toBe(1);
    expect(tables.Category.map((c) => c.id)).toEqual(["a"]);
    expect(tables.Task[0].categoryId).toBe("a");
  });

  it("does not touch the input", () => {
    const input = { Category: [{ id: "ph-work", name: "کار" }], Task: [{ id: "t1", categoryId: "ph-work" }] };
    remapDuplicateCategories(input, existing);
    expect(input.Task[0].categoryId).toBe("ph-work");
    expect(input.Category).toHaveLength(1);
  });
});

describe("importBackupToServer", () => {
  function fakeApi(existingCategories: Array<{ id: string; name: string }> = []) {
    const requests: Array<{ tables: Record<string, Array<Record<string, unknown>>> }> = [];
    const api: BackupApi = {
      async get(url) {
        if (url === "/api/categories") return { categories: existingCategories };
        throw new Error("unexpected GET " + url);
      },
      async post(url, body) {
        if (url !== "/api/sync/push") throw new Error("unexpected POST " + url);
        const sent = body as { tables: Record<string, Array<Record<string, unknown>>> };
        requests.push(sent);
        const results: Record<string, unknown> = {};
        for (const [table, rows] of Object.entries(sent.tables)) results[table] = { upserted: rows.length, skipped: 0, rejected: 0 };
        return { protocol: 2, results };
      },
    };
    return { api, requests };
  }

  it("sends the tables the server syncs, in dependency order, and reports what was stored", async () => {
    const { api, requests } = fakeApi();
    const file = buildBackupFile({ Task: [{ id: "t1", title: "x" }], Category: [{ id: "c1", name: "ورزش" }], Notification: [{ id: "n" }] });
    const result = await importBackupToServer(api, file);
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0].tables)).toEqual(["Category", "Task"]); // Notification isn't synced; Category precedes Task
    expect(result.stored).toEqual({ Category: 1, Task: 1 });
    expect(result.rejected).toEqual([]);
  });

  it("splits a big backup across requests without breaking parent-before-child order", async () => {
    const { api, requests } = fakeApi();
    const events = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, title: "رویداد", recurrenceParentId: i === 0 ? null : "e0" }));
    // The child listed before its parent must still go out after it.
    const file = buildBackupFile({ Event: [...events.slice(1), events[0]] });
    await importBackupToServer(api, file, { maxBatchRows: 3 });
    expect(requests.length).toBeGreaterThan(1);
    const order = requests.flatMap((r) => (r.tables.Event ?? []).map((e) => e.id));
    expect(order[0]).toBe("e0");
    expect(order).toHaveLength(10);
  });

  it("re-points rows at the account's own categories before sending", async () => {
    const { api, requests } = fakeApi([{ id: "srv-work", name: "کار" }]);
    const file = buildBackupFile({ Category: [{ id: "ph-work", name: "کار" }], Task: [{ id: "t1", title: "x", categoryId: "ph-work" }] });
    const result = await importBackupToServer(api, file);
    expect(requests[0].tables.Category).toBeUndefined();
    expect(requests[0].tables.Task[0].categoryId).toBe("srv-work");
    expect(result.unchanged).toBe(1); // the merged category counts as already there
  });

  it("collects the rows the server refuses, with its reasons, and counts ones it didn't name", async () => {
    const api: BackupApi = {
      async get() {
        return { categories: [] };
      },
      async post() {
        return {
          protocol: 2,
          results: {
            Task: { upserted: 1, skipped: 2, rejected: 3, rejectedRows: [{ id: "bad", reason: "parent row not found" }] },
          },
        };
      },
    };
    const result = await importBackupToServer(api, buildBackupFile({ Task: [{ id: "a" }] }));
    expect(result.stored).toEqual({ Task: 1 });
    expect(result.unchanged).toBe(2);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected[0]).toEqual({ table: "Task", id: "bad", reason: "parent row not found" });
  });

  it("reports progress", async () => {
    const { api } = fakeApi();
    const seen: Array<[number, number]> = [];
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, title: "x" }));
    await importBackupToServer(api, buildBackupFile({ Task: rows }), { maxBatchRows: 2, onProgress: (d, t) => seen.push([d, t]) });
    expect(seen[seen.length - 1]).toEqual([3, 3]);
  });
});

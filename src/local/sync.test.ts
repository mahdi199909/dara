import { describe, expect, it, vi, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { LOCAL_USER_ID } from "./localUser";
import { pushLocalChanges, pullRemoteChanges, SyncHttpError } from "./sync";
import { getSyncMeta, listSyncIssues, recordSyncIssue, META_TOMBSTONES_ACKED_AT } from "./syncMeta";
import { deleteRowsWithTombstones, recordLocalTombstone } from "./tombstones";
import { installMemoryLogger } from "../lib/observability/testing";

const REMOTE_USER_ID = "remote_user_1";
const TOKEN = "jwt-1";
const T0 = "2026-01-01T00:00:00.000Z";

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [LOCAL_USER_ID, "local@device", "", "من", T0, T0]);
  return db;
}

function insertCategory(db: LocalDb, id: string, name: string, at = T0, extra: Record<string, unknown> = {}) {
  const cols = { id, userId: LOCAL_USER_ID, name, createdAt: at, updatedAt: at, ...extra };
  const keys = Object.keys(cols);
  db.run(`INSERT INTO "Category" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`, Object.values(cols));
}

function mockFetchOnce(status: number, body: unknown) {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) } as Response);
}

function sentBody(callIndex = 0) {
  const [, init] = vi.mocked(fetch).mock.calls[callIndex];
  return JSON.parse((init as RequestInit).body as string);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("pushLocalChanges", () => {
  it("with no cursor, pushes every row of every syncable table, remapping userId and converting SQLite 0/1 to real booleans", async () => {
    const db = await freshDb();
    insertCategory(db, "cat_1", "کار");
    mockFetchOnce(200, { protocol: 2, results: { Category: { upserted: 1, skipped: 0, rejected: 0 } } });

    const result = await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null);

    expect(result.pushed).toEqual({ Category: 1 });
    expect(sentBody().tables.Category).toEqual([
      {
        id: "cat_1",
        userId: REMOTE_USER_ID,
        name: "کار",
        createdAt: T0,
        updatedAt: T0,
        icon: null,
        color: "#3a8d80",
        kind: "NEUTRAL",
        valueType: "EXPENSE",
        // The server validates strictly: SQLite's 1/0 here is what used to get every category (and
        // everything that referenced one) rejected.
        isActive: true,
        sortOrder: 0,
        generatesVirtualAsset: false,
        virtualAssetValuePerHour: null,
        projectId: null,
        parentCategoryId: null,
        deletedAt: null,
      },
    ]);
  });

  it("normalizes a space-separated SQLite timestamp to ISO before sending", async () => {
    const db = await freshDb();
    insertCategory(db, "cat_1", "کار", "2026-03-04 05:06:07");
    mockFetchOnce(200, { protocol: 2, results: {} });

    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null);

    const [row] = sentBody().tables.Category;
    expect(row.createdAt).toBe("2026-03-04T05:06:07.000Z");
    expect(row.updatedAt).toBe("2026-03-04T05:06:07.000Z");
  });

  it("only pushes rows changed after the given cursor", async () => {
    const db = await freshDb();
    insertCategory(db, "cat_old", "قدیمی", T0);
    insertCategory(db, "cat_new", "جدید", "2026-02-01T00:00:00.000Z");
    mockFetchOnce(200, { protocol: 2, results: { Category: { upserted: 1, skipped: 0, rejected: 0 } } });

    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, "2026-01-15T00:00:00.000Z");

    expect(sentBody().tables.Category.map((c: { id: string }) => c.id)).toEqual(["cat_new"]);
  });

  it("re-reads a moment before the cursor so a row committed in the gap isn't skipped forever", async () => {
    const db = await freshDb();
    insertCategory(db, "cat_edge", "لبه", "2026-01-15T00:00:00.000Z");
    mockFetchOnce(200, { protocol: 2, results: { Category: { upserted: 1, skipped: 0, rejected: 0 } } });

    // Cursor lands half a second AFTER the row's own timestamp — within the overlap window.
    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, "2026-01-15T00:00:00.500Z");

    expect(sentBody().tables.Category.map((c: { id: string }) => c.id)).toEqual(["cat_edge"]);
  });

  it("never includes User or Settings rows in the tables payload, even though both have local rows", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Settings" ("id","userId","createdAt","updatedAt") VALUES (?,?,?,?)`, ["settings_1", LOCAL_USER_ID, T0, T0]);
    insertCategory(db, "cat_1", "کار");
    mockFetchOnce(200, { protocol: 2, results: { Category: { upserted: 1, skipped: 0, rejected: 0 } } });

    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null);

    const body = sentBody();
    expect(body.tables.Category).toHaveLength(1);
    expect(body.tables.User).toBeUndefined();
    expect(body.tables.Settings).toBeUndefined();
    // A settings row still at its factory state must not be sent at all — it would overwrite the
    // account's real settings with defaults.
    expect(body.profile).toBeUndefined();
  });

  it("skips the network call entirely when nothing has changed", async () => {
    const db = await freshDb();
    const result = await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, "2026-01-01T00:00:00.000Z");
    expect(fetch).not.toHaveBeenCalled();
    expect(result.pushed).toEqual({});
    expect(result.batches).toBe(0);
  });

  it("splits a large first sync into several requests, each under the size cap, keeping table order", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Project" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["p1", LOCAL_USER_ID, "پروژه", T0, T0]);
    for (let i = 0; i < 25; i++) insertCategory(db, `cat_${i}`, `دسته ${i}`);
    for (let i = 0; i < 25; i++) {
      db.run(`INSERT INTO "Task" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [`t_${i}`, LOCAL_USER_ID, `تسک ${i}`, T0, T0]);
    }
    vi.mocked(fetch).mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ protocol: 2, results: {} }) }) as Response);

    const result = await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null, { maxBatchRows: 20 });

    expect(result.batches).toBe(Math.ceil(51 / 20));
    const order: string[] = [];
    for (let i = 0; i < result.batches; i++) {
      const body = sentBody(i);
      const rows = Object.values(body.tables as Record<string, unknown[]>).reduce((s, r) => s + r.length, 0);
      expect(rows).toBeLessThanOrEqual(20);
      for (const table of Object.keys(body.tables)) if (order[order.length - 1] !== table) order.push(table);
    }
    // Parents (Project, Category) never come after their children (Task), across requests too.
    expect(order).toEqual(["Project", "Category", "Task"]);
  });

  it("sends categories' parents before their sub-categories", async () => {
    const db = await freshDb();
    // Row order in the table is child first, parent second — the way a re-parented category ends
    // up when its parent was created later than the child.
    insertCategory(db, "child", "زیرمجموعه");
    insertCategory(db, "parent", "والد");
    db.run(`UPDATE "Category" SET "parentCategoryId" = ? WHERE "id" = ?`, ["parent", "child"]);
    mockFetchOnce(200, { protocol: 2, results: {} });

    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null);

    expect(sentBody().tables.Category.map((c: { id: string }) => c.id)).toEqual(["parent", "child"]);
  });

  it("throws a SyncHttpError carrying the status when the server (or its proxy) refuses the request", async () => {
    const db = await freshDb();
    insertCategory(db, "cat_1", "کار");
    mockFetchOnce(413, "Request Entity Too Large");

    await expect(pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null)).rejects.toMatchObject({ name: "SyncHttpError", status: 413 });
    await expect(SyncHttpError.prototype.constructor).toBeDefined();
  });

  it("sends local deletions as tombstones with the first request, and marks them delivered only for a server that understands them", async () => {
    const db = await freshDb();
    recordLocalTombstone(db, "HabitCheckIn", "checkin_1", "2026-02-01T00:00:00.000Z");
    mockFetchOnce(200, { protocol: 2, results: {}, tombstones: { applied: 1, ignored: 0 } });

    const result = await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null);

    expect(sentBody().tombstones).toEqual([{ table: "HabitCheckIn", id: "checkin_1", deletedAt: "2026-02-01T00:00:00.000Z" }]);
    expect(result.tombstonesSent).toBe(1);
    expect(getSyncMeta(db, META_TOMBSTONES_ACKED_AT)).toBe(result.pushedAt);
  });

  it("does NOT mark deletions delivered when the server is an older build that ignores them", async () => {
    const db = await freshDb();
    recordLocalTombstone(db, "HabitCheckIn", "checkin_1", "2026-02-01T00:00:00.000Z");
    mockFetchOnce(200, { results: {} }); // no `protocol` field = pre-tombstone server

    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null);

    expect(getSyncMeta(db, META_TOMBSTONES_ACKED_AT)).toBeNull();
  });

  it("records rows the server rejected as issues (with the server's reason) and retries them on the next push", async () => {
    const db = await freshDb();
    insertCategory(db, "cat_bad", "بد");
    mockFetchOnce(200, { protocol: 2, results: { Category: { upserted: 0, skipped: 0, rejected: 1, rejectedRows: [{ id: "cat_bad", reason: "missing parent row" }] } } });

    const first = await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null);
    expect(first.rejected).toBe(1);
    expect(first.issues).toEqual([{ table: "Category", id: "cat_bad", reason: "missing parent row" }]);
    expect(listSyncIssues(db).map((i) => i.rowId)).toEqual(["cat_bad"]);

    // Next sync: the cursor has moved past the row, but it rides along again because it was refused.
    mockFetchOnce(200, { protocol: 2, results: { Category: { upserted: 1, skipped: 0, rejected: 0 } } });
    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, first.pushedAt);
    expect(sentBody(1).tables.Category.map((c: { id: string }) => c.id)).toEqual(["cat_bad"]);
    expect(listSyncIssues(db)).toEqual([]); // accepted this time — issue cleared
  });

  it("keeps earlier issues untouched when an older server can't say which rows it refused", async () => {
    const db = await freshDb();
    insertCategory(db, "cat_1", "کار");
    recordSyncIssue(db, "Category", "cat_1", "old reason");
    mockFetchOnce(200, { results: { Category: { upserted: 0, skipped: 0, rejected: 1 } } }); // pre-2 server: counts only

    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null);

    expect(listSyncIssues(db)).toHaveLength(1);
  });

  it("sends the display name and preferences once a person has edited them, and not again until they change", async () => {
    const db = await freshDb();
    db.run(`UPDATE "User" SET "name" = ?, "updatedAt" = ? WHERE "id" = ?`, ["مهدی", "2026-02-01T00:00:00.000Z", LOCAL_USER_ID]);
    db.run(`INSERT INTO "Settings" ("id","userId","currencyDisplayUnit","dailyQuoteEnabled","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
      "s1",
      LOCAL_USER_ID,
      "RIAL",
      0,
      T0,
      "2026-02-02T00:00:00.000Z",
    ]);
    mockFetchOnce(200, { protocol: 2, results: {}, profile: { settingsApplied: true, nameApplied: true } });

    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null);
    const { profile } = sentBody();
    expect(profile.name).toEqual({ value: "مهدی", stamp: "2026-02-01T00:00:00.000Z" });
    expect(profile.settings.stamp).toBe("2026-02-02T00:00:00.000Z");
    expect(profile.settings.values.currencyDisplayUnit).toBe("RIAL");
    // SQLite's dailyQuoteEnabled column is the application's dailyMomentEnabled, as a real boolean.
    expect(profile.settings.values.dailyMomentEnabled).toBe(false);

    // Delivered — a following push with no other changes makes no request at all.
    vi.mocked(fetch).mockClear();
    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, "2026-03-01T00:00:00.000Z");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("pullRemoteChanges", () => {
  it("with no cursor, applies every returned row, remapping userId from the real remote id to the local placeholder", async () => {
    const db = await freshDb();
    mockFetchOnce(200, {
      protocol: 2,
      syncedAt: "2026-03-01T00:00:00.000Z",
      tables: { Category: [{ id: "cat_remote", userId: REMOTE_USER_ID, name: "از سرور", createdAt: T0, updatedAt: T0 }] },
    });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.pulled).toEqual({ Category: 1 });
    expect(result.syncedAt).toBe("2026-03-01T00:00:00.000Z");
    const row = db.get<{ userId: string; name: string }>(`SELECT * FROM "Category" WHERE "id" = ?`, ["cat_remote"]);
    expect(row?.userId).toBe(LOCAL_USER_ID);
    expect(row?.name).toBe("از سرور");
  });

  it("re-reads a couple of minutes before lastPulledAt (a late-arriving change must not be skipped)", async () => {
    const db = await freshDb();
    mockFetchOnce(200, { syncedAt: "2026-03-01T00:00:00.000Z", tables: {} });

    await pullRemoteChanges(db, TOKEN, "2026-02-01T00:10:00.000Z");

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("since=2026-02-01T00%3A08%3A00.000Z");
  });

  it("a deep pull re-reads days, not minutes", async () => {
    const db = await freshDb();
    mockFetchOnce(200, { syncedAt: "2026-03-01T00:00:00.000Z", tables: {} });

    await pullRemoteChanges(db, TOKEN, "2026-02-10T00:00:00.000Z", { overlapMs: 2 * 24 * 60 * 60 * 1000 });

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("since=2026-02-08T00%3A00%3A00.000Z");
  });

  it("last-write-wins: does not overwrite a local row with an older incoming version", async () => {
    const db = await freshDb();
    insertCategory(db, "cat_1", "نسخه‌ی جدید محلی", "2026-01-01T00:00:00.000Z");
    db.run(`UPDATE "Category" SET "updatedAt" = ? WHERE "id" = ?`, ["2026-03-01T00:00:00.000Z", "cat_1"]);
    mockFetchOnce(200, {
      syncedAt: "2026-03-05T00:00:00.000Z",
      tables: { Category: [{ id: "cat_1", userId: REMOTE_USER_ID, name: "نسخه‌ی قدیمی سرور", createdAt: T0, updatedAt: "2026-01-15T00:00:00.000Z" }] },
    });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.pulled).toEqual({});
    expect(db.get<{ name: string }>(`SELECT "name" FROM "Category" WHERE "id" = ?`, ["cat_1"])?.name).toBe("نسخه‌ی جدید محلی");
  });

  it("applies a same-table self-reference (Event.recurrenceParentId) regardless of array order, via multi-pass retry", async () => {
    const db = await freshDb();
    const parent = { id: "evt_parent", userId: REMOTE_USER_ID, title: "جلسه هفتگی", startAt: "2026-01-01T09:00:00.000Z", endAt: "2026-01-01T10:00:00.000Z", recurrenceFreq: "WEEKLY", recurrenceParentId: null, createdAt: T0, updatedAt: T0 };
    const child = { id: "evt_child", userId: REMOTE_USER_ID, title: "جلسه هفتگی (تغییر یافته)", startAt: "2026-01-08T09:00:00.000Z", endAt: "2026-01-08T11:00:00.000Z", recurrenceFreq: "NONE", recurrenceParentId: "evt_parent", createdAt: T0, updatedAt: T0 };
    mockFetchOnce(200, { syncedAt: "2026-03-01T00:00:00.000Z", tables: { Event: [child, parent] } });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.pulled).toEqual({ Event: 2 });
    expect(db.get(`SELECT "id" FROM "Event" WHERE "id" = ?`, ["evt_child"])).toBeTruthy();
    expect(db.get(`SELECT "id" FROM "Event" WHERE "id" = ?`, ["evt_parent"])).toBeTruthy();
  });

  it("tolerates one malformed row without losing the rest of the batch, and reports it", async () => {
    const memory = installMemoryLogger();
    const db = await freshDb();
    mockFetchOnce(200, {
      syncedAt: "2026-03-01T00:00:00.000Z",
      tables: {
        Category: [
          { id: "cat_good", userId: REMOTE_USER_ID, name: "خوب", createdAt: T0, updatedAt: T0 },
          // A column this phone's schema has never heard of — the insert can never succeed.
          { id: "cat_bad", userId: REMOTE_USER_ID, name: "بد", noSuchColumn: 1, createdAt: T0, updatedAt: T0 },
        ],
      },
    });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.pulled).toEqual({ Category: 1 });
    expect(result.failures.map((f) => f.id)).toEqual(["cat_bad"]);
    expect(db.get(`SELECT "id" FROM "Category" WHERE "id" = ?`, ["cat_good"])).toBeTruthy();
    expect(db.get(`SELECT "id" FROM "Category" WHERE "id" = ?`, ["cat_bad"])).toBeUndefined();

    // ...and it is logged: which table, which row, the database's reason — not the row's contents.
    memory.restore();
    const failed = memory.sink.find("SYNC_PULL_ROW_FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ level: "WARN", module: "sync", layer: "local", error_code: "SYNC-008", entity_type: "Category", entity_id: "cat_bad" });
    expect(JSON.stringify(failed[0])).not.toContain("بد");
  });

  it("treats a natural-key duplicate (same habit, same day, other id) as already-there, not as a failure", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Habit" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["h1", LOCAL_USER_ID, "مطالعه", T0, T0]);
    db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["local_ci", "h1", "2026-02-01T00:00:00.000Z", T0, T0]);
    mockFetchOnce(200, {
      syncedAt: "2026-03-01T00:00:00.000Z",
      tables: { HabitCheckIn: [{ id: "server_ci", habitId: "h1", date: "2026-02-01T00:00:00.000Z", durationMin: null, createdAt: T0, updatedAt: T0 }] },
    });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.failures).toEqual([]);
    expect(db.all(`SELECT "id" FROM "HabitCheckIn"`)).toHaveLength(1);
  });

  it("applies deletions the server reports, including the virtual asset hanging off a deleted check-in", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Habit" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["h1", LOCAL_USER_ID, "مطالعه", T0, T0]);
    db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["ci1", "h1", "2026-02-01T00:00:00.000Z", T0, T0]);
    db.run(
      `INSERT INTO "VirtualAssetEntry" ("id","userId","habitCheckInId","durationMin","valuePerHour","totalValue","date","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)`,
      ["vae1", LOCAL_USER_ID, "ci1", 0, 0, 1000, "2026-02-01T00:00:00.000Z", T0, T0]
    );
    mockFetchOnce(200, { protocol: 2, syncedAt: "2026-03-01T00:00:00.000Z", tables: {}, tombstones: [{ table: "HabitCheckIn", id: "ci1", deletedAt: "2026-02-15T00:00:00.000Z" }] });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.tombstonesApplied).toBe(1);
    expect(db.all(`SELECT "id" FROM "HabitCheckIn"`)).toEqual([]);
    expect(db.all(`SELECT "id" FROM "VirtualAssetEntry"`)).toEqual([]);
  });

  it("does not resurrect a row this device deleted but hasn't yet told the server about", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Habit" ("id","userId","title","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["h1", LOCAL_USER_ID, "مطالعه", T0, T0]);
    db.run(`INSERT INTO "HabitCheckIn" ("id","habitId","date","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["ci1", "h1", "2026-02-01T00:00:00.000Z", T0, T0]);
    deleteRowsWithTombstones(db, "HabitCheckIn", `"id" = ?`, ["ci1"]);
    mockFetchOnce(200, {
      protocol: 2,
      syncedAt: "2026-03-01T00:00:00.000Z",
      tables: { HabitCheckIn: [{ id: "ci1", habitId: "h1", date: "2026-02-01T00:00:00.000Z", durationMin: null, createdAt: T0, updatedAt: T0 }] },
      tombstones: [],
    });

    await pullRemoteChanges(db, TOKEN, null);

    expect(db.all(`SELECT "id" FROM "HabitCheckIn"`)).toEqual([]);
  });

  it("adopts the server's display name and settings on a fresh install whose own are still factory defaults", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Settings" ("id","userId","createdAt","updatedAt") VALUES (?,?,?,?)`, ["s1", LOCAL_USER_ID, "2026-09-19T10:00:00.000Z", "2026-09-19T10:00:00.000Z"]);
    mockFetchOnce(200, {
      protocol: 2,
      syncedAt: "2026-09-19T10:05:00.000Z",
      tables: {},
      tombstones: [],
      profile: {
        name: { value: "مهدی", stamp: "2026-05-01T00:00:00.000Z" },
        // OLDER than the phone's default row — real data must still win over untouched defaults.
        settings: { createdAt: "2026-04-01T00:00:00.000Z", stamp: "2026-05-02T00:00:00.000Z", values: { currencyDisplayUnit: "RIAL", monthlyIncome: 30_000_000, dailyMomentEnabled: false, theme: "dark" } },
      },
    });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.profileApplied).toEqual({ settingsApplied: true, nameApplied: true });
    expect(db.get<{ name: string }>(`SELECT "name" FROM "User" WHERE "id" = ?`, [LOCAL_USER_ID])?.name).toBe("مهدی");
    const s = db.get<Record<string, unknown>>(`SELECT * FROM "Settings" WHERE "userId" = ?`, [LOCAL_USER_ID])!;
    expect(s.currencyDisplayUnit).toBe("RIAL");
    expect(s.monthlyIncome).toBe(30_000_000);
    expect(s.dailyQuoteEnabled).toBe(0);
    expect(s.theme).toBe("dark");
  });

  it("keeps settings the person edited here after the server's version", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Settings" ("id","userId","currencyDisplayUnit","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["s1", LOCAL_USER_ID, "TOMAN", "2026-01-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z"]);
    mockFetchOnce(200, {
      protocol: 2,
      syncedAt: "2026-06-05T00:00:00.000Z",
      tables: {},
      tombstones: [],
      profile: { settings: { createdAt: "2026-01-01T00:00:00.000Z", stamp: "2026-05-01T00:00:00.000Z", values: { currencyDisplayUnit: "RIAL" } } },
    });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.profileApplied.settingsApplied).toBe(false);
    expect(db.get<{ currencyDisplayUnit: string }>(`SELECT "currencyDisplayUnit" FROM "Settings"`)?.currencyDisplayUnit).toBe("TOMAN");
  });

  it("throws (and applies nothing) when the server responds with an error status", async () => {
    const db = await freshDb();
    mockFetchOnce(401, { error: "Unauthorized" });
    await expect(pullRemoteChanges(db, TOKEN, null)).rejects.toMatchObject({ name: "SyncHttpError", status: 401 });
  });
});

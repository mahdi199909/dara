import { describe, expect, it, vi, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "./db";
import { createNodeSqliteDriver } from "./drivers/nodeSqlite";
import { LOCAL_USER_ID } from "./localUser";
import { pushLocalChanges, pullRemoteChanges } from "./sync";

const REMOTE_USER_ID = "remote_user_1";
const TOKEN = "jwt-1";

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    LOCAL_USER_ID,
    "local@device",
    "",
    "من",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  ]);
  return db;
}

function mockFetchOnce(status: number, body: unknown) {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: status < 400, status, json: async () => body } as Response);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("pushLocalChanges", () => {
  it("with no cursor, pushes every row of every syncable table, remapping userId to the real remote id", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [
      "cat_1",
      LOCAL_USER_ID,
      "کار",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
    mockFetchOnce(200, { results: { Category: { upserted: 1, skipped: 0, rejected: 0 } } });

    const result = await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null);

    expect(result.pushed).toEqual({ Category: 1 });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.tables.Category).toEqual([{ id: "cat_1", userId: REMOTE_USER_ID, name: "کار", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", icon: null, color: "#3a8d80", kind: "NEUTRAL", valueType: "EXPENSE", isActive: 1, generatesVirtualAsset: 0, virtualAssetValuePerHour: null, projectId: null, deletedAt: null }]);
  });

  it("only pushes rows changed after the given cursor", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [
      "cat_old",
      LOCAL_USER_ID,
      "قدیمی",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [
      "cat_new",
      LOCAL_USER_ID,
      "جدید",
      "2026-02-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    ]);
    mockFetchOnce(200, { results: { Category: { upserted: 1, skipped: 0, rejected: 0 } } });

    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, "2026-01-15T00:00:00.000Z");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.tables.Category.map((c: { id: string }) => c.id)).toEqual(["cat_new"]);
  });

  it("never includes User or Settings in the outgoing payload, even though both have local rows", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Settings" ("id","userId","createdAt","updatedAt") VALUES (?,?,?,?)`, ["settings_1", LOCAL_USER_ID, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, ["cat_1", LOCAL_USER_ID, "کار", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
    mockFetchOnce(200, { results: { Category: { upserted: 1, skipped: 0, rejected: 0 } } });

    await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, null);

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.tables.Category).toHaveLength(1);
    expect(sentBody.tables.User).toBeUndefined();
    expect(sentBody.tables.Settings).toBeUndefined();
  });

  it("skips the network call entirely when nothing has changed", async () => {
    const db = await freshDb();
    const result = await pushLocalChanges(db, TOKEN, REMOTE_USER_ID, "2026-01-01T00:00:00.000Z");
    expect(fetch).not.toHaveBeenCalled();
    expect(result.pushed).toEqual({});
  });
});

describe("pullRemoteChanges", () => {
  it("with no cursor, applies every returned row, remapping userId from the real remote id to the local placeholder", async () => {
    const db = await freshDb();
    mockFetchOnce(200, {
      syncedAt: "2026-03-01T00:00:00.000Z",
      tables: {
        Category: [
          { id: "cat_remote", userId: REMOTE_USER_ID, name: "از سرور", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        ],
      },
    });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.pulled).toEqual({ Category: 1 });
    expect(result.syncedAt).toBe("2026-03-01T00:00:00.000Z");
    const row = db.get<{ userId: string; name: string }>(`SELECT * FROM "Category" WHERE "id" = ?`, ["cat_remote"]);
    expect(row?.userId).toBe(LOCAL_USER_ID);
    expect(row?.name).toBe("از سرور");
  });

  it("uses lastPulledAt as the ?since= query param", async () => {
    const db = await freshDb();
    mockFetchOnce(200, { syncedAt: "2026-03-01T00:00:00.000Z", tables: {} });

    await pullRemoteChanges(db, TOKEN, "2026-02-01T00:00:00.000Z");

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("since=2026-02-01T00%3A00%3A00.000Z");
  });

  it("last-write-wins: does not overwrite a local row with an older incoming version", async () => {
    const db = await freshDb();
    db.run(`INSERT INTO "Category" ("id","userId","name","createdAt","updatedAt") VALUES (?,?,?,?,?)`, [
      "cat_1",
      LOCAL_USER_ID,
      "نسخه‌ی جدید محلی",
      "2026-01-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    ]);
    mockFetchOnce(200, {
      syncedAt: "2026-03-05T00:00:00.000Z",
      tables: {
        Category: [{ id: "cat_1", userId: REMOTE_USER_ID, name: "نسخه‌ی قدیمی سرور", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-15T00:00:00.000Z" }],
      },
    });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.pulled).toEqual({});
    const row = db.get<{ name: string }>(`SELECT "name" FROM "Category" WHERE "id" = ?`, ["cat_1"]);
    expect(row?.name).toBe("نسخه‌ی جدید محلی");
  });

  it("applies a same-table self-reference (Event.recurrenceParentId) regardless of array order, via multi-pass retry", async () => {
    const db = await freshDb();
    const parent = {
      id: "evt_parent",
      userId: REMOTE_USER_ID,
      title: "جلسه هفتگی",
      startAt: "2026-01-01T09:00:00.000Z",
      endAt: "2026-01-01T10:00:00.000Z",
      recurrenceFreq: "WEEKLY",
      recurrenceParentId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const child = {
      id: "evt_child",
      userId: REMOTE_USER_ID,
      title: "جلسه هفتگی (تغییر یافته)",
      startAt: "2026-01-08T09:00:00.000Z",
      endAt: "2026-01-08T11:00:00.000Z",
      recurrenceFreq: "NONE",
      recurrenceParentId: "evt_parent",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    // Child listed BEFORE its parent — the naive single-pass insert would hit
    // "FOREIGN KEY constraint failed" on this row first.
    mockFetchOnce(200, { syncedAt: "2026-03-01T00:00:00.000Z", tables: { Event: [child, parent] } });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.pulled).toEqual({ Event: 2 });
    expect(db.get(`SELECT "id" FROM "Event" WHERE "id" = ?`, ["evt_child"])).toBeTruthy();
    expect(db.get(`SELECT "id" FROM "Event" WHERE "id" = ?`, ["evt_parent"])).toBeTruthy();
  });

  it("tolerates one malformed row without losing the rest of the batch", async () => {
    const db = await freshDb();
    mockFetchOnce(200, {
      syncedAt: "2026-03-01T00:00:00.000Z",
      tables: {
        Category: [
          { id: "cat_good", userId: REMOTE_USER_ID, name: "خوب", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
          // References a project that doesn't exist locally or in this same batch — FK violation, never resolves across retries.
          { id: "cat_bad", userId: REMOTE_USER_ID, name: "بد", projectId: "no_such_project", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        ],
      },
    });

    const result = await pullRemoteChanges(db, TOKEN, null);

    expect(result.pulled).toEqual({ Category: 1 });
    expect(db.get(`SELECT "id" FROM "Category" WHERE "id" = ?`, ["cat_good"])).toBeTruthy();
    expect(db.get(`SELECT "id" FROM "Category" WHERE "id" = ?`, ["cat_bad"])).toBeUndefined();
  });

  it("throws (and applies nothing) when the server responds with an error status", async () => {
    const db = await freshDb();
    mockFetchOnce(401, { error: "Unauthorized" });
    await expect(pullRemoteChanges(db, TOKEN, null)).rejects.toThrow();
  });
});

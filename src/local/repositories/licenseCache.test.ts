import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { clearLicenseCache, getLicenseCache, setLicenseCache } from "./licenseCache";

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  return openLocalDb(await createNodeSqliteDriver(":memory:"));
}

describe("local license cache", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("returns null before any license has ever been cached", async () => {
    const db = await freshDb();
    expect(getLicenseCache(db)).toBeNull();
  });

  it("stores and reads back a cached license", async () => {
    const db = await freshDb();
    setLicenseCache(db, {
      status: "TRIAL",
      trialDaysRemaining: 30,
      trialEndsAt: "2026-09-24T00:00:00.000Z",
      currentPeriodEnd: null,
      remoteUserId: "user_1",
      remoteEmail: "a@example.com",
    });

    const cached = getLicenseCache(db);
    expect(cached?.status).toBe("TRIAL");
    expect(cached?.trialDaysRemaining).toBe(30);
    expect(cached?.remoteEmail).toBe("a@example.com");
    expect(cached?.cachedAt).toBeTruthy();
  });

  it("overwrites the single cached row on a repeated refresh instead of inserting a second one", async () => {
    const db = await freshDb();
    setLicenseCache(db, { status: "TRIAL", trialDaysRemaining: 30, trialEndsAt: "2026-09-24T00:00:00.000Z", currentPeriodEnd: null, remoteUserId: "user_1", remoteEmail: "a@example.com" });
    setLicenseCache(db, { status: "LIFETIME", trialDaysRemaining: null, trialEndsAt: null, currentPeriodEnd: null, remoteUserId: "user_1", remoteEmail: "a@example.com" });

    expect(getLicenseCache(db)?.status).toBe("LIFETIME");
    expect(db.all(`SELECT * FROM "_local_license_cache"`)).toHaveLength(1);
  });

  it("clears the cache", async () => {
    const db = await freshDb();
    setLicenseCache(db, { status: "FREE", trialDaysRemaining: null, trialEndsAt: null, currentPeriodEnd: null, remoteUserId: "user_1", remoteEmail: "a@example.com" });
    clearLicenseCache(db);
    expect(getLicenseCache(db)).toBeNull();
  });
});

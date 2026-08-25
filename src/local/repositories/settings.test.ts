import { describe, expect, it, beforeEach } from "vitest";
import { openLocalDb, resetLocalDbForTests, type LocalDb } from "../db";
import { createNodeSqliteDriver } from "../drivers/nodeSqlite";
import { getSettings, updateSettings } from "./settings";

const USER_ID = "user_settings_1";
const now = () => new Date().toISOString();

async function freshDb(): Promise<LocalDb> {
  resetLocalDbForTests();
  const db = openLocalDb(await createNodeSqliteDriver(":memory:"));
  db.run(`INSERT INTO "User" ("id","email","passwordHash","name","createdAt","updatedAt") VALUES (?,?,?,?,?,?)`, [
    USER_ID,
    "settings@example.com",
    "hash",
    "Settings Tester",
    now(),
    now(),
  ]);
  return db;
}

describe("local settings repository", () => {
  beforeEach(() => {
    resetLocalDbForTests();
  });

  it("creates a default settings row on first get when none exists yet", async () => {
    const db = await freshDb();
    expect(db.get(`SELECT * FROM "Settings" WHERE "userId" = ?`, [USER_ID])).toBeUndefined();

    const { settings, user, hourlyValue } = getSettings(db, USER_ID);

    expect(settings.userId).toBe(USER_ID);
    expect(settings.timezone).toBe("Asia/Tehran");
    expect(settings.currency).toBe("IRT");
    expect(settings.currencyDisplayUnit).toBe("TOMAN");
    expect(settings.calendarType).toBe("jalali");
    expect(user?.name).toBe("Settings Tester");
    expect(hourlyValue).toBe(0); // no monthlyIncome/workingHoursMonth/override yet

    expect(db.get(`SELECT * FROM "Settings" WHERE "userId" = ?`, [USER_ID])).toBeTruthy();
  });

  it("is idempotent: a second get reuses the same row instead of creating another", async () => {
    const db = await freshDb();
    const first = getSettings(db, USER_ID);
    const second = getSettings(db, USER_ID);
    expect(second.settings.id).toBe(first.settings.id);
  });

  it("persists an update, updates the user's name, and recomputes hourlyValue", async () => {
    const db = await freshDb();
    getSettings(db, USER_ID); // simulate the row already existing, like a real first load would

    const { settings, hourlyValue } = updateSettings(db, USER_ID, {
      monthlyIncome: 30_000_000,
      workingHoursMonth: 160,
      name: "نام جدید",
    });

    expect(settings.monthlyIncome).toBe(30_000_000);
    expect(settings.workingHoursMonth).toBe(160);
    expect(hourlyValue).toBe(187_500); // 30,000,000 / 160

    const user = db.get<{ name: string }>(`SELECT "name" FROM "User" WHERE "id" = ?`, [USER_ID]);
    expect(user?.name).toBe("نام جدید");

    const reread = getSettings(db, USER_ID);
    expect(reread.settings.monthlyIncome).toBe(30_000_000);
  });

  it("an explicit hourlyValueOverride wins over monthlyIncome/workingHoursMonth", async () => {
    const db = await freshDb();
    getSettings(db, USER_ID);
    updateSettings(db, USER_ID, { monthlyIncome: 30_000_000, workingHoursMonth: 160 });
    const { hourlyValue } = updateSettings(db, USER_ID, { hourlyValueOverride: 500_000 });
    expect(hourlyValue).toBe(500_000);
  });

  it("stores dashboardCardPrefs as JSON and updates it in place", async () => {
    const db = await freshDb();
    getSettings(db, USER_ID);
    const { settings } = updateSettings(db, USER_ID, { dashboardCardPrefs: { netWorth: false, habits: true } });
    expect(JSON.parse(settings.dashboardCardPrefs!)).toEqual({ netWorth: false, habits: true });
  });
});

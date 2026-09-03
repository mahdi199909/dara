// On-device port of src/app/api/settings/route.ts. Settings is a 1:1-per-user singleton row —
// GET upserts a default row into existence the first time it's needed (mirrored here as a
// plain get-or-create), PATCH updates it (or creates it, matching Prisma's upsert semantics).
import type { UpdateSettingsInput } from "@/lib/schemas/settings";
import { computeHourlyValue } from "@/lib/hourlyValue";
import type { LocalDb } from "../db";
import { writeLocalAuditLog } from "../audit";

interface SettingsRow {
  id: string;
  userId: string;
  timezone: string;
  currency: string;
  currencyDisplayUnit: string;
  calendarType: string;
  monthlyIncome: number | null;
  workingHoursMonth: number | null;
  hourlyValueOverride: number | null;
  dashboardCardPrefs: string | null;
  dailyQuoteEnabled: number;
  wakeHour: number;
  sleepHour: number;
  createdAt: string;
  updatedAt: string;
}

function now() {
  return new Date().toISOString();
}

function insertDefaultSettings(db: LocalDb, userId: string): SettingsRow {
  const id = crypto.randomUUID();
  const ts = now();
  db.run(
    `INSERT INTO "Settings" ("id","userId","timezone","currency","currencyDisplayUnit","calendarType","dailyQuoteEnabled","wakeHour","sleepHour","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, "Asia/Tehran", "IRT", "TOMAN", "jalali", 1, 7, 23, ts, ts]
  );
  return db.get<SettingsRow>(`SELECT * FROM "Settings" WHERE "id" = ?`, [id])!;
}

/**
 * Faithful-port note: the web route's GET calls `prisma.settings.upsert({ update: {} , ... })`
 * unconditionally. Because Prisma auto-manages `@updatedAt` on every `update()` call — even a
 * no-op one — this bumps Settings.updatedAt on *every* GET request, not just the first one
 * that creates the row. That's reproduced here (rather than silently "fixed") so behavior
 * stays byte-identical; flagging it in case it's an unintended Prisma-upsert side effect worth
 * reviewing rather than a deliberate feature.
 */
export function getSettings(db: LocalDb, userId: string) {
  const existing = db.get<SettingsRow>(`SELECT * FROM "Settings" WHERE "userId" = ?`, [userId]);
  let settings: SettingsRow;
  if (existing) {
    db.run(`UPDATE "Settings" SET "updatedAt" = ? WHERE "userId" = ?`, [now(), userId]);
    settings = db.get<SettingsRow>(`SELECT * FROM "Settings" WHERE "userId" = ?`, [userId])!;
  } else {
    settings = insertDefaultSettings(db, userId);
  }

  const user = db.get<{ id: string; name: string; email: string }>(`SELECT "id","name","email" FROM "User" WHERE "id" = ?`, [userId]);

  return {
    // dailyQuoteEnabled comes back from SQLite as 0/1 (no native boolean type); coerced here so
    // the shape matches what Prisma returns for the same field on the web route.
    settings: { ...settings, dailyQuoteEnabled: !!settings.dailyQuoteEnabled },
    user: user ?? null,
    hourlyValue: computeHourlyValue(settings),
  };
}

export function updateSettings(db: LocalDb, userId: string, input: UpdateSettingsInput) {
  const { name, dashboardCardPrefs, ...settingsBody } = input;
  const existing = db.get<SettingsRow>(`SELECT * FROM "Settings" WHERE "userId" = ?`, [userId]);

  if (name) {
    db.run(`UPDATE "User" SET "name" = ?, "updatedAt" = ? WHERE "id" = ?`, [name, now(), userId]);
  }

  let settings: SettingsRow;
  if (existing) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, value: unknown) => {
      sets.push(`"${col}" = ?`);
      params.push(value);
    };
    if (settingsBody.timezone !== undefined) set("timezone", settingsBody.timezone);
    if (settingsBody.currency !== undefined) set("currency", settingsBody.currency);
    if (settingsBody.currencyDisplayUnit !== undefined) set("currencyDisplayUnit", settingsBody.currencyDisplayUnit);
    if (settingsBody.calendarType !== undefined) set("calendarType", settingsBody.calendarType);
    if (settingsBody.monthlyIncome !== undefined) set("monthlyIncome", settingsBody.monthlyIncome);
    if (settingsBody.workingHoursMonth !== undefined) set("workingHoursMonth", settingsBody.workingHoursMonth);
    if (settingsBody.hourlyValueOverride !== undefined) set("hourlyValueOverride", settingsBody.hourlyValueOverride);
    if (settingsBody.dailyQuoteEnabled !== undefined) set("dailyQuoteEnabled", settingsBody.dailyQuoteEnabled ? 1 : 0);
    if (settingsBody.wakeHour !== undefined) set("wakeHour", settingsBody.wakeHour);
    if (settingsBody.sleepHour !== undefined) set("sleepHour", settingsBody.sleepHour);
    if (dashboardCardPrefs !== undefined) set("dashboardCardPrefs", JSON.stringify(dashboardCardPrefs));
    set("updatedAt", now());

    db.run(`UPDATE "Settings" SET ${sets.join(", ")} WHERE "userId" = ?`, [...params, userId]);
    settings = db.get<SettingsRow>(`SELECT * FROM "Settings" WHERE "userId" = ?`, [userId])!;
  } else {
    // Mirrors the web route's `create: { userId, ...settingsBody }` branch of the upsert —
    // note dashboardCardPrefs is destructured out of the body before this spread there too,
    // so (as in the web route) a dashboardCardPrefs value provided on a PATCH that creates
    // the row for the first time is silently dropped. Reproduced faithfully; flagged as a
    // pre-existing inconsistency in the web route rather than fixed here. In practice this
    // branch is close to unreachable on-device since getLocalUserId() already creates a
    // Settings row for the local user before any repository call.
    const id = crypto.randomUUID();
    const ts = now();
    db.run(
      `INSERT INTO "Settings" ("id","userId","timezone","currency","currencyDisplayUnit","calendarType","monthlyIncome","workingHoursMonth","hourlyValueOverride","dailyQuoteEnabled","wakeHour","sleepHour","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        userId,
        settingsBody.timezone ?? "Asia/Tehran",
        settingsBody.currency ?? "IRT",
        settingsBody.currencyDisplayUnit ?? "TOMAN",
        settingsBody.calendarType ?? "jalali",
        settingsBody.monthlyIncome ?? null,
        settingsBody.workingHoursMonth ?? null,
        settingsBody.hourlyValueOverride ?? null,
        settingsBody.dailyQuoteEnabled === false ? 0 : 1,
        settingsBody.wakeHour ?? 7,
        settingsBody.sleepHour ?? 23,
        ts,
        ts,
      ]
    );
    settings = db.get<SettingsRow>(`SELECT * FROM "Settings" WHERE "id" = ?`, [id])!;
  }

  writeLocalAuditLog(db, {
    userId,
    action: "CHANGE_SETTINGS",
    entityType: "Settings",
    entityId: settings.id,
    oldValue: existing ?? null,
    newValue: settings,
  });

  return { settings: { ...settings, dailyQuoteEnabled: !!settings.dailyQuoteEnabled }, hourlyValue: computeHourlyValue(settings) };
}

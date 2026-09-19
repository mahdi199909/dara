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
  // Physical SQLite column stays "dailyQuoteEnabled" — matches the Prisma side's @map, which
  // renames only the application-facing name (see the field's own schema.prisma comment). Read
  // it under this name via raw SQL/SELECT *, then re-key to dailyMomentEnabled at the two
  // return points below, same boundary the Prisma Client does automatically on the web side.
  dailyQuoteEnabled: number;
  wakeHour: number;
  sleepHour: number;
  dailyProductiveTargetMin: number;
  companionEnabled: number;
  theme: string;
  calendarFeaturedType: string | null;
  calendarFeaturedId: string | null;
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
    `INSERT INTO "Settings" ("id","userId","timezone","currency","currencyDisplayUnit","calendarType","dailyQuoteEnabled","wakeHour","sleepHour","dailyProductiveTargetMin","companionEnabled","theme","createdAt","updatedAt")
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, "Asia/Tehran", "IRT", "TOMAN", "jalali", 1, 7, 23, 360, 1, "system", ts, ts]
  );
  return db.get<SettingsRow>(`SELECT * FROM "Settings" WHERE "id" = ?`, [id])!;
}

/**
 * Reading settings must not touch Settings.updatedAt. The web route's GET used to upsert with an
 * empty update — which Prisma turns into an updatedAt bump — and this port copied that. Once
 * settings sync between devices (src/lib/profileSync.ts), updatedAt has to mean "a person last
 * changed these", or merely opening the app on one device would make its (older) values beat a
 * real edit made on the other.
 */
export function getSettings(db: LocalDb, userId: string) {
  const existing = db.get<SettingsRow>(`SELECT * FROM "Settings" WHERE "userId" = ?`, [userId]);
  const settings = existing ?? insertDefaultSettings(db, userId);

  const user = db.get<{ id: string; name: string; email: string }>(`SELECT "id","name","email" FROM "User" WHERE "id" = ?`, [userId]);

  const { dailyQuoteEnabled, companionEnabled, ...settingsRest } = settings;
  return {
    // Comes back from SQLite as 0/1 (no native boolean type); coerced here so the shape matches
    // what Prisma returns for the same (now dailyMomentEnabled-named) field on the web route.
    settings: { ...settingsRest, dailyMomentEnabled: !!dailyQuoteEnabled, companionEnabled: !!companionEnabled },
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
    if (settingsBody.dailyMomentEnabled !== undefined) set("dailyQuoteEnabled", settingsBody.dailyMomentEnabled ? 1 : 0);
    if (settingsBody.wakeHour !== undefined) set("wakeHour", settingsBody.wakeHour);
    if (settingsBody.sleepHour !== undefined) set("sleepHour", settingsBody.sleepHour);
    if (settingsBody.dailyProductiveTargetMin !== undefined) set("dailyProductiveTargetMin", settingsBody.dailyProductiveTargetMin);
    if (settingsBody.companionEnabled !== undefined) set("companionEnabled", settingsBody.companionEnabled ? 1 : 0);
    if (settingsBody.theme !== undefined) set("theme", settingsBody.theme);
    if (settingsBody.calendarFeaturedType !== undefined) set("calendarFeaturedType", settingsBody.calendarFeaturedType);
    if (settingsBody.calendarFeaturedId !== undefined) set("calendarFeaturedId", settingsBody.calendarFeaturedId);
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
      `INSERT INTO "Settings" ("id","userId","timezone","currency","currencyDisplayUnit","calendarType","monthlyIncome","workingHoursMonth","hourlyValueOverride","dailyQuoteEnabled","wakeHour","sleepHour","dailyProductiveTargetMin","companionEnabled","theme","createdAt","updatedAt")
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        settingsBody.dailyMomentEnabled === false ? 0 : 1,
        settingsBody.wakeHour ?? 7,
        settingsBody.sleepHour ?? 23,
        settingsBody.dailyProductiveTargetMin ?? 360,
        settingsBody.companionEnabled === false ? 0 : 1,
        settingsBody.theme ?? "system",
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

  const { dailyQuoteEnabled, companionEnabled, ...settingsRest } = settings;
  return {
    settings: { ...settingsRest, dailyMomentEnabled: !!dailyQuoteEnabled, companionEnabled: !!companionEnabled },
    hourlyValue: computeHourlyValue(settings),
  };
}

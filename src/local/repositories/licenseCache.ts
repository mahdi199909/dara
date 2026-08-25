// Local-only cache of the one-time remote license check (see src/lib/nativeOnboarding.ts and
// the "_local_license_cache" table in src/local/db.ts). Always exactly zero or one row — a
// device is linked to a single remote account at a time.
import type { LocalDb } from "../db";

const SINGLETON_ID = "singleton";

export interface LicenseCache {
  status: "TRIAL" | "FREE" | "SUBSCRIBED" | "LIFETIME";
  trialDaysRemaining: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  remoteUserId: string;
  remoteEmail: string;
  cachedAt: string;
}

export function getLicenseCache(db: LocalDb): LicenseCache | null {
  const row = db.get<LicenseCache>(`SELECT * FROM "_local_license_cache" WHERE "id" = ?`, [SINGLETON_ID]);
  return row ?? null;
}

export function setLicenseCache(db: LocalDb, data: Omit<LicenseCache, "cachedAt">): LicenseCache {
  const cachedAt = new Date().toISOString();
  db.run(
    `INSERT INTO "_local_license_cache" ("id","status","trialDaysRemaining","trialEndsAt","currentPeriodEnd","remoteUserId","remoteEmail","cachedAt")
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT("id") DO UPDATE SET
       "status" = excluded."status",
       "trialDaysRemaining" = excluded."trialDaysRemaining",
       "trialEndsAt" = excluded."trialEndsAt",
       "currentPeriodEnd" = excluded."currentPeriodEnd",
       "remoteUserId" = excluded."remoteUserId",
       "remoteEmail" = excluded."remoteEmail",
       "cachedAt" = excluded."cachedAt"`,
    [SINGLETON_ID, data.status, data.trialDaysRemaining, data.trialEndsAt, data.currentPeriodEnd, data.remoteUserId, data.remoteEmail, cachedAt]
  );
  return { ...data, cachedAt };
}

export function clearLicenseCache(db: LocalDb): void {
  db.run(`DELETE FROM "_local_license_cache" WHERE "id" = ?`, [SINGLETON_ID]);
}

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
  // The session JWT from the first-run login/register call, persisted (unlike before) so the
  // app can re-check license status with the server on every later open/resume without forcing
  // the user through FirstRunGate's login form again. Null for rows written before this field
  // existed, or if a future caller genuinely has no token — re-check just skips itself then.
  token: string | null;
  // Sync cursors (see src/local/sync.ts) — null until this device's first successful sync of
  // each direction. Deliberately NOT part of setLicenseCache's replace-everything write below:
  // that function is called by the license-status refresh path, which knows nothing about sync
  // and would otherwise silently wipe these back to null on every refresh. Use
  // setLastPushedAt/setLastPulledAt instead.
  lastPushedAt: string | null;
  lastPulledAt: string | null;
  cachedAt: string;
}

export function getLicenseCache(db: LocalDb): LicenseCache | null {
  const row = db.get<LicenseCache>(`SELECT * FROM "_local_license_cache" WHERE "id" = ?`, [SINGLETON_ID]);
  return row ?? null;
}

type LicenseStatusFields = Omit<LicenseCache, "cachedAt" | "lastPushedAt" | "lastPulledAt">;

export function setLicenseCache(db: LocalDb, data: LicenseStatusFields): LicenseStatusFields & { cachedAt: string } {
  const cachedAt = new Date().toISOString();
  db.run(
    `INSERT INTO "_local_license_cache" ("id","status","trialDaysRemaining","trialEndsAt","currentPeriodEnd","remoteUserId","remoteEmail","token","cachedAt")
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT("id") DO UPDATE SET
       "status" = excluded."status",
       "trialDaysRemaining" = excluded."trialDaysRemaining",
       "trialEndsAt" = excluded."trialEndsAt",
       "currentPeriodEnd" = excluded."currentPeriodEnd",
       "remoteUserId" = excluded."remoteUserId",
       "remoteEmail" = excluded."remoteEmail",
       "token" = excluded."token",
       "cachedAt" = excluded."cachedAt"`,
    [
      SINGLETON_ID,
      data.status,
      data.trialDaysRemaining,
      data.trialEndsAt,
      data.currentPeriodEnd,
      data.remoteUserId,
      data.remoteEmail,
      data.token,
      cachedAt,
    ]
  );
  return { ...data, cachedAt };
}

/** Touches only lastPushedAt — see the field's doc comment on LicenseCache for why this stays
 * separate from setLicenseCache. No-ops if the singleton row doesn't exist yet, which can't
 * happen in practice: sync only ever runs with a token/remoteUserId read from this same row. */
export function setLastPushedAt(db: LocalDb, lastPushedAt: string): void {
  db.run(`UPDATE "_local_license_cache" SET "lastPushedAt" = ? WHERE "id" = ?`, [lastPushedAt, SINGLETON_ID]);
}

export function setLastPulledAt(db: LocalDb, lastPulledAt: string): void {
  db.run(`UPDATE "_local_license_cache" SET "lastPulledAt" = ? WHERE "id" = ?`, [lastPulledAt, SINGLETON_ID]);
}

export function clearLicenseCache(db: LocalDb): void {
  db.run(`DELETE FROM "_local_license_cache" WHERE "id" = ?`, [SINGLETON_ID]);
}

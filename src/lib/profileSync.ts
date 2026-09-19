// The user-visible parts of an account that live in "User"/"Settings" rather than in one of the
// per-row sync tables (see the exclusion note in syncTables.ts): the display name and the
// preferences (currency unit, monthly income, working hours, theme, ...). Without syncing them, a
// second device silently computes the same data differently — e.g. "value per hour" comes from
// monthlyIncome/workingHoursMonth, so an un-synced income setting makes reports disagree between
// the web and the phone even when every task and transaction matches.
//
// Pure (no Prisma, no SQLite) so the phone, the server and the tests all share one definition.

/** Prisma-side (application) names of the Settings columns that sync. `id`, `userId` and the
 * timestamps are deliberately not among them. */
export const PROFILE_SETTINGS_FIELDS = [
  "timezone",
  "currency",
  "currencyDisplayUnit",
  "calendarType",
  "monthlyIncome",
  "workingHoursMonth",
  "hourlyValueOverride",
  "dashboardCardPrefs",
  "dailyMomentEnabled",
  "wakeHour",
  "sleepHour",
  "dailyProductiveTargetMin",
  "companionEnabled",
  "theme",
  "calendarFeaturedType",
  "calendarFeaturedId",
] as const;

export type ProfileSettingsField = (typeof PROFILE_SETTINGS_FIELDS)[number];

/** The value a fresh on-device install gives the display name before the user picks one. */
export const PLACEHOLDER_NAME = "من";

/** Both sides treat a row still at its factory state as "never edited by a person" — it must
 * lose to any real data on the other side, or a freshly installed phone (whose default row
 * carries a *newer* timestamp than the server's genuine settings) would overwrite them. A row
 * created and never touched has createdAt === updatedAt (Prisma stamps both from one clock read;
 * the phone writes one string for both), so equality — allowing 1 ms of slack — is the test. */
const PRISTINE_TOLERANCE_MS = 1;

export interface ProfilePayload {
  name?: { value: string; stamp: string };
  settings?: {
    createdAt: string;
    /** When a person last changed these values. Reading them must never move it. */
    stamp: string;
    values: Partial<Record<ProfileSettingsField, unknown>>;
  };
}

export function isSettingsPristine(createdAt: string | Date, updatedAt: string | Date): boolean {
  return Math.abs(new Date(updatedAt).getTime() - new Date(createdAt).getTime()) <= PRISTINE_TOLERANCE_MS;
}

/** True when `incoming` should replace `existing`: it is real data replacing untouched defaults,
 * or a genuinely newer edit. Same rule on the server (accepting a push) and on the phone
 * (applying a pull). */
export function shouldAdoptSettings(
  existing: { createdAt: string | Date; stamp: string | Date } | null,
  incoming: { createdAt: string | Date; stamp: string | Date }
): boolean {
  const incomingPristine = isSettingsPristine(incoming.createdAt, incoming.stamp);
  if (incomingPristine) return false;
  if (!existing) return true;
  if (isSettingsPristine(existing.createdAt, existing.stamp)) return true;
  return new Date(incoming.stamp).getTime() > new Date(existing.stamp).getTime();
}

export function shouldAdoptName(
  existing: { value: string; stamp: string | Date } | null,
  incoming: { value: string; stamp: string | Date }
): boolean {
  if (!incoming.value || incoming.value === PLACEHOLDER_NAME) return false;
  if (!existing || existing.value === PLACEHOLDER_NAME) return true;
  return new Date(incoming.stamp).getTime() > new Date(existing.stamp).getTime();
}

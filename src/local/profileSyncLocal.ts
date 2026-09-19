// Phone half of the profile (display name + preferences) sync — see src/lib/profileSync.ts for
// what travels and the adopt/keep rules, and src/lib/profileSyncServer.ts for the other side.
import {
  PLACEHOLDER_NAME,
  PROFILE_SETTINGS_FIELDS,
  isSettingsPristine,
  shouldAdoptName,
  shouldAdoptSettings,
  type ProfilePayload,
  type ProfileSettingsField,
} from "@/lib/profileSync";
import type { LocalDb } from "./db";

interface LocalSettingsRow {
  createdAt: string;
  updatedAt: string;
  [column: string]: unknown;
}

// Prisma's dailyMomentEnabled is @map'd to the physical column dailyQuoteEnabled (see
// src/local/repositories/settings.ts); every other column keeps its name.
function columnFor(field: ProfileSettingsField): string {
  return field === "dailyMomentEnabled" ? "dailyQuoteEnabled" : field;
}

const BOOLEAN_FIELDS: ReadonlySet<ProfileSettingsField> = new Set<ProfileSettingsField>(["dailyMomentEnabled", "companionEnabled"]);

/** What to send the server, or an empty payload when nothing here was edited by a person since
 * `since`. A row still at its factory state is never sent — it would overwrite real settings the
 * account already has elsewhere with defaults. */
export function readLocalProfilePayload(db: LocalDb, userId: string, since: string | null): ProfilePayload {
  const payload: ProfilePayload = {};

  const settings = db.get<LocalSettingsRow>(`SELECT * FROM "Settings" WHERE "userId" = ?`, [userId]);
  if (settings && !isSettingsPristine(settings.createdAt, settings.updatedAt) && (!since || settings.updatedAt > since)) {
    const values: Partial<Record<ProfileSettingsField, unknown>> = {};
    for (const field of PROFILE_SETTINGS_FIELDS) {
      const raw = settings[columnFor(field)];
      values[field] = BOOLEAN_FIELDS.has(field) ? (raw === null || raw === undefined ? raw : !!raw) : raw;
    }
    payload.settings = { createdAt: settings.createdAt, stamp: settings.updatedAt, values };
  }

  const user = db.get<{ name: string; updatedAt: string }>(`SELECT "name","updatedAt" FROM "User" WHERE "id" = ?`, [userId]);
  if (user && user.name && user.name !== PLACEHOLDER_NAME && (!since || user.updatedAt > since)) {
    payload.name = { value: user.name, stamp: user.updatedAt };
  }

  return payload;
}

export interface ProfileApplyResult {
  settingsApplied: boolean;
  nameApplied: boolean;
}

/** Applies what the server sent, if it should win — see shouldAdoptSettings/shouldAdoptName. */
export function applyRemoteProfile(db: LocalDb, userId: string, profile: ProfilePayload | undefined): ProfileApplyResult {
  const result: ProfileApplyResult = { settingsApplied: false, nameApplied: false };
  if (!profile) return result;

  if (profile.settings) {
    const local = db.get<LocalSettingsRow>(`SELECT * FROM "Settings" WHERE "userId" = ?`, [userId]);
    const incoming = profile.settings;
    if (local && shouldAdoptSettings({ createdAt: local.createdAt, stamp: local.updatedAt }, { createdAt: incoming.createdAt, stamp: incoming.stamp })) {
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const field of PROFILE_SETTINGS_FIELDS) {
        if (!(field in incoming.values)) continue;
        const value = incoming.values[field];
        sets.push(`"${columnFor(field)}" = ?`);
        params.push(BOOLEAN_FIELDS.has(field) && value !== null && value !== undefined ? (value ? 1 : 0) : value ?? null);
      }
      // Both timestamps are copied from the server so this row's pristine/edited state, and its
      // place in last-write-wins, is exactly what the server's is.
      sets.push(`"createdAt" = ?`, `"updatedAt" = ?`);
      params.push(incoming.createdAt, incoming.stamp);
      db.run(`UPDATE "Settings" SET ${sets.join(", ")} WHERE "userId" = ?`, [...params, userId]);
      result.settingsApplied = true;
    }
  }

  if (profile.name) {
    const user = db.get<{ name: string; updatedAt: string }>(`SELECT "name","updatedAt" FROM "User" WHERE "id" = ?`, [userId]);
    if (user && shouldAdoptName({ value: user.name, stamp: user.updatedAt }, profile.name)) {
      db.run(`UPDATE "User" SET "name" = ?, "updatedAt" = ? WHERE "id" = ?`, [profile.name.value, profile.name.stamp, userId]);
      result.nameApplied = true;
    }
  }

  return result;
}

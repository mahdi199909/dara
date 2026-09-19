// Server half of the profile (display name + preferences) sync — see profileSync.ts for why this
// exists and for the shared adopt/keep rules. Prisma-backed, so never imported by on-device code.
import { prisma } from "@/lib/db";
import { coerceSyncRow } from "@/lib/syncCoercion";
import { PROFILE_SETTINGS_FIELDS, shouldAdoptName, shouldAdoptSettings, type ProfilePayload } from "@/lib/profileSync";

export interface ProfilePushResult {
  settingsApplied: boolean;
  nameApplied: boolean;
}

function isValidDate(d: Date) {
  return !Number.isNaN(d.getTime());
}

export async function applyPushedProfile(userId: string, payload: ProfilePayload): Promise<ProfilePushResult> {
  const result: ProfilePushResult = { settingsApplied: false, nameApplied: false };

  if (payload.settings) {
    const stamp = new Date(payload.settings.stamp);
    const createdAt = new Date(payload.settings.createdAt);
    if (isValidDate(stamp) && isValidDate(createdAt)) {
      const existing = await prisma.settings.findUnique({ where: { userId } });
      if (shouldAdoptSettings(existing ? { createdAt: existing.createdAt, stamp: existing.updatedAt } : null, { createdAt, stamp })) {
        // Only the allow-listed preference columns are ever taken from a device.
        const picked: Record<string, unknown> = {};
        for (const field of PROFILE_SETTINGS_FIELDS) {
          if (field in payload.settings.values) picked[field] = payload.settings.values[field];
        }
        const coerced = coerceSyncRow("settings", picked);
        if (!coerced.error) {
          // updatedAt is passed explicitly so Prisma keeps the moment the person made the change
          // (last-write-wins compares edit times, not arrival order).
          await prisma.settings.upsert({
            where: { userId },
            create: { userId, ...coerced.data, updatedAt: stamp },
            update: { ...coerced.data, updatedAt: stamp },
          });
          result.settingsApplied = true;
        }
      }
    }
  }

  if (payload.name && typeof payload.name.value === "string") {
    const stamp = new Date(payload.name.stamp);
    const value = payload.name.value.trim().slice(0, 100);
    if (isValidDate(stamp) && value) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, updatedAt: true } });
      if (user && shouldAdoptName({ value: user.name, stamp: user.updatedAt }, { value, stamp })) {
        await prisma.user.update({ where: { id: userId }, data: { name: value, updatedAt: stamp } });
        result.nameApplied = true;
      }
    }
  }

  return result;
}

/** What to hand a device that last pulled at `since` (null = everything). Omits a part that
 * hasn't changed since then, so a quiet account costs nothing extra per poll. */
export async function readProfileForPull(userId: string, since: Date | null): Promise<ProfilePayload> {
  const [settings, user] = await Promise.all([
    prisma.settings.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, updatedAt: true } }),
  ]);

  const payload: ProfilePayload = {};
  if (settings && (!since || settings.updatedAt > since)) {
    const values: Record<string, unknown> = {};
    for (const field of PROFILE_SETTINGS_FIELDS) values[field] = (settings as unknown as Record<string, unknown>)[field];
    payload.settings = { createdAt: settings.createdAt.toISOString(), stamp: settings.updatedAt.toISOString(), values };
  }
  if (user && (!since || user.updatedAt > since)) {
    payload.name = { value: user.name, stamp: user.updatedAt.toISOString() };
  }
  return payload;
}

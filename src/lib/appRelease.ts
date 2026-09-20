// Server side of the app-update check: reads the admin's optional override row and merges it with
// the release that ships in code (see resolveAppRelease). Shared by GET /api/app/version (public,
// so even a phone that never logged in learns about updates) and /api/license/status (which has
// always carried these fields), so both always say the same thing.
import { prisma } from "@/lib/db";
import { resolveAppRelease, type AppReleaseInfo } from "@/lib/appVersion";
import { getLogger } from "@/lib/observability";

const log = getLogger("release", "app-release");

export const RELEASE_SINGLETON_ID = "singleton";

export async function getAppRelease(): Promise<AppReleaseInfo> {
  try {
    const row = await prisma.appRelease.findUnique({ where: { id: RELEASE_SINGLETON_ID } });
    return resolveAppRelease(row);
  } catch (err) {
    // A version check must not fail just because the override row can't be read: the release that
    // ships in code is still the right answer.
    log.warn("RELEASE_READ_FAILED", { error: err, errorCode: "DB-002" });
    return resolveAppRelease(null);
  }
}

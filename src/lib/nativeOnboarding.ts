// Orchestrates the Android app's one-time first-run flow — see src/components/native/FirstRunGate.tsx
// (the only intended caller). Checks the local license cache; if none exists, logs in/registers
// against the real remote deployment (src/lib/remoteAuth.ts), fetches license status, and caches
// it locally via the ordinary local-dispatcher path (src/lib/apiClient.ts already routes these
// two calls through dispatchLocal on native, same as every other resource).
import { fetcher, apiPost } from "./apiClient";
import { remoteLogin, remoteRegister, fetchRemoteLicenseStatus } from "./remoteAuth";
import type { LicenseCache } from "@/local/repositories/licenseCache";

export async function getCachedLicense(): Promise<LicenseCache | null> {
  const { license } = await fetcher<{ license: LicenseCache | null }>("/api/local/license-cache");
  return license;
}

export interface FirstRunInput {
  mode: "login" | "register";
  name?: string;
  email: string;
  password: string;
}

export async function completeFirstRun(input: FirstRunInput): Promise<LicenseCache> {
  const { user, token } =
    input.mode === "register" ? await remoteRegister(input.name ?? "", input.email, input.password) : await remoteLogin(input.email, input.password);

  const status = await fetchRemoteLicenseStatus(token);

  const { license } = await apiPost<{ license: LicenseCache }>("/api/local/license-cache", {
    status: status.status,
    trialDaysRemaining: status.trialDaysRemaining,
    trialEndsAt: status.trialEndsAt,
    currentPeriodEnd: status.currentPeriodEnd,
    remoteUserId: user.id,
    remoteEmail: user.email,
    token,
  });

  // Awaited, not fire-and-forget: this may be a fresh install logging into an existing account
  // that already has server data (from the web app, or a previous device) — the user expects to
  // see it the moment first-run finishes, not after some later resume cycle. syncWithServer
  // swallows its own errors, so a failure here still lets first-run itself succeed.
  await syncWithServer();

  return license;
}

/**
 * Best-effort re-check with the server, so trial-days-remaining (and any subscribe/lifetime
 * upgrade made elsewhere) actually updates over time instead of being frozen at whatever
 * completeFirstRun cached on the very first login. Called on every app open/resume — see
 * src/components/native/FirstRunGate.tsx and WidgetQueueDrainer.tsx.
 *
 * Silently no-ops (keeping whatever's already cached) if there's no stored token yet (rows
 * written before this field existed), or if the token has since expired (the 30-day session JWT
 * — see src/lib/auth.ts) — this must never force the user back through FirstRunGate's login
 * form just because a background refresh failed offline or with a stale token.
 */
export async function refreshLicenseStatus(): Promise<void> {
  const cached = await getCachedLicense();
  if (!cached?.token) return;
  try {
    const status = await fetchRemoteLicenseStatus(cached.token);
    await apiPost("/api/local/license-cache", {
      status: status.status,
      trialDaysRemaining: status.trialDaysRemaining,
      trialEndsAt: status.trialEndsAt,
      currentPeriodEnd: status.currentPeriodEnd,
      remoteUserId: cached.remoteUserId,
      remoteEmail: cached.remoteEmail,
      token: cached.token,
    });
  } catch {
    // offline, server hiccup, or expired token — keep serving the last known-good cache
  }
}

/**
 * Pushes this device's local changes to the server, then pulls whatever changed remotely since
 * the last sync — see src/local/sync.ts for the actual push/pull logic. Called on first-run
 * completion, on every app boot, and on every resume (see FirstRunGate.tsx and
 * WidgetQueueDrainer.tsx), so "as soon as online and the app is open" from the product ask is
 * covered from every angle rather than relying on exactly one trigger firing.
 *
 * Silently no-ops (same posture as refreshLicenseStatus) if there's no cached token, or if the
 * network call fails — a device offline must never see this as an error, and the unmoved cursors
 * mean the next successful sync just picks up wherever this one left off.
 */
export async function syncWithServer(): Promise<void> {
  // The whole body is one try/catch, deliberately including the cache read itself: this must
  // never throw, on a offline device or otherwise, since every caller (completeFirstRun,
  // FirstRunGate's boot effect, WidgetQueueDrainer's resume handler) treats it as fire-and-forget
  // or best-effort.
  try {
    const cached = await getCachedLicense();
    if (!cached?.token) return;

    const [{ getLocalDbInstance }, { pushLocalChanges, pullRemoteChanges }, { setLastPushedAt, setLastPulledAt }] = await Promise.all([
      import("@/local/db"),
      import("@/local/sync"),
      import("@/local/repositories/licenseCache"),
    ]);
    const db = getLocalDbInstance();
    if (!db) return; // FirstRunGate's driver bootstrap hasn't run yet

    const { pushedAt } = await pushLocalChanges(db, cached.token, cached.remoteUserId, cached.lastPushedAt);
    setLastPushedAt(db, pushedAt);

    const { syncedAt } = await pullRemoteChanges(db, cached.token, cached.lastPulledAt);
    setLastPulledAt(db, syncedAt);
  } catch {
    // offline, server hiccup, expired token, or no local DB yet — next trigger retries from the same cursors
  }
}

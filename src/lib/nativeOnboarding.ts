// Orchestrates the Android app's one-time first-run flow — see src/components/native/FirstRunGate.tsx
// (the only intended caller). Checks the local license cache; if none exists, logs in/registers
// against the real remote deployment (src/lib/remoteAuth.ts), fetches license status, and caches
// it locally via the ordinary local-dispatcher path (src/lib/apiClient.ts already routes these
// two calls through dispatchLocal on native, same as every other resource).
import { fetcher, apiPost } from "./apiClient";
import { remoteLogin, remoteRegister, fetchRemoteLicenseStatus } from "./remoteAuth";
import { cacheVersionGate } from "./versionGate";
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
  await cacheVersionGate(status);

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

const OFFLINE_TRIAL_DAYS = 30;

/**
 * Fallback for when completeFirstRun fails because the remote server itself couldn't be reached
 * at all (see FirstRunGate.tsx's distinction between that and a real 4xx/5xx from the server) —
 * a network hiccup, or the remote host being unreachable from the user's specific network,
 * shouldn't permanently lock someone out of an app whose actual data and features are 100%
 * local. Caches a device-local TRIAL with no remoteUserId/token, so refreshLicenseStatus and
 * syncWithServer both correctly keep no-op'ing (both bail out on a falsy token) until the user
 * eventually succeeds at a real login/register — nothing here talks to the network at all.
 */
export async function continueOffline(email: string): Promise<LicenseCache> {
  const trialEndsAt = new Date(Date.now() + OFFLINE_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { license } = await apiPost<{ license: LicenseCache }>("/api/local/license-cache", {
    status: "TRIAL",
    trialDaysRemaining: OFFLINE_TRIAL_DAYS,
    trialEndsAt,
    currentPeriodEnd: null,
    remoteUserId: "",
    remoteEmail: email,
    token: null,
  });
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
    await cacheVersionGate(status);
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

export interface SyncOutcome {
  ok: boolean;
  pushedCount: number;
  pulledCount: number;
}

/**
 * Pushes this device's local changes to the server, then pulls whatever changed remotely since
 * the last sync — see src/local/sync.ts for the actual push/pull logic. Called on first-run
 * completion, on every app boot, and on every resume (see FirstRunGate.tsx and
 * WidgetQueueDrainer.tsx), so "as soon as online and the app is open" from the product ask is
 * covered from every angle rather than relying on exactly one trigger firing. Also callable
 * directly from a manual "sync now" action (see Settings' BackupTab) — the returned SyncOutcome
 * is what that UI shows; every fire-and-forget/best-effort caller just discards it.
 *
 * Silently no-ops (same posture as refreshLicenseStatus) if there's no cached token, or if the
 * network call fails — a device offline must never see this as an error, and the unmoved cursors
 * mean the next successful sync just picks up wherever this one left off.
 */
export async function syncWithServer(): Promise<SyncOutcome> {
  // The whole body is one try/catch, deliberately including the cache read itself: this must
  // never throw, on a offline device or otherwise, since every fire-and-forget/best-effort caller
  // (completeFirstRun awaits it but still only for its side effects, FirstRunGate's boot effect,
  // WidgetQueueDrainer's resume handler) needs this to resolve, never reject.
  try {
    const cached = await getCachedLicense();
    if (!cached?.token) return { ok: false, pushedCount: 0, pulledCount: 0 };

    const [{ getLocalDbInstance }, { pushLocalChanges, pullRemoteChanges }, { setLastPushedAt, setLastPulledAt }] = await Promise.all([
      import("@/local/db"),
      import("@/local/sync"),
      import("@/local/repositories/licenseCache"),
    ]);
    const db = getLocalDbInstance();
    if (!db) return { ok: false, pushedCount: 0, pulledCount: 0 }; // FirstRunGate's driver bootstrap hasn't run yet

    const { pushed, pushedAt } = await pushLocalChanges(db, cached.token, cached.remoteUserId, cached.lastPushedAt);
    setLastPushedAt(db, pushedAt);

    const { pulled, syncedAt } = await pullRemoteChanges(db, cached.token, cached.lastPulledAt);
    setLastPulledAt(db, syncedAt);

    const sum = (counts: Record<string, number>) => Object.values(counts).reduce((s, n) => s + n, 0);
    return { ok: true, pushedCount: sum(pushed), pulledCount: sum(pulled) };
  } catch {
    // offline, server hiccup, expired token, or no local DB yet — next trigger retries from the same cursors
    return { ok: false, pushedCount: 0, pulledCount: 0 };
  }
}

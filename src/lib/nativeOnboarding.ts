// Orchestrates the Android app's one-time first-run flow — see src/components/native/FirstRunGate.tsx
// (the only intended caller). Checks the local license cache; if none exists, logs in/registers
// against the real remote deployment (src/lib/remoteAuth.ts), fetches license status, and caches
// it locally via the ordinary local-dispatcher path (src/lib/apiClient.ts already routes these
// two calls through dispatchLocal on native, same as every other resource).
import { fetcher, apiPost } from "./apiClient";
import { remoteLogin, remoteRegister, fetchRemoteLicenseStatus } from "./remoteAuth";
import { cacheVersionGate } from "./versionGate";
import { updateSyncStatus } from "./syncStatus";
import type { LicenseCache } from "@/local/repositories/licenseCache";
import type { SyncOutcome } from "@/local/syncRunner";

export type { SyncOutcome } from "@/local/syncRunner";

export async function getCachedLicense(): Promise<LicenseCache | null> {
  const { license } = await fetcher<{ license: LicenseCache | null }>("/api/local/license-cache");
  return license;
}

export interface FirstRunInput {
  mode: "login" | "register";
  name?: string;
  email: string;
  password: string;
  /** Set once the person has agreed to replace another account's data on this phone. */
  confirmSwitch?: boolean;
}

/** Thrown when the account just signed into differs from the one this phone's data belongs to —
 * FirstRunGate asks the person to confirm before anything is replaced. */
export class AccountSwitchRequired extends Error {
  previousEmail: string | null;
  constructor(previousEmail: string | null) {
    super("این گوشی قبلاً با حساب دیگری همگام شده است.");
    this.name = "AccountSwitchRequired";
    this.previousEmail = previousEmail;
  }
}

export async function completeFirstRun(input: FirstRunInput): Promise<LicenseCache> {
  const { user, token } =
    input.mode === "register" ? await remoteRegister(input.name ?? "", input.email, input.password) : await remoteLogin(input.email, input.password);

  // The phone's database belongs to the device, not to a login. Signing in as somebody else must
  // not quietly merge two people's data — see src/local/accountSwitch.ts.
  const [{ getLocalDbInstance }, accountSwitch] = await Promise.all([import("@/local/db"), import("@/local/accountSwitch")]);
  const db = getLocalDbInstance();
  if (db) {
    const previous = accountSwitch.isAccountSwitch(db, user.id);
    if (previous) {
      if (!input.confirmSwitch) throw new AccountSwitchRequired(previous.email);
      accountSwitch.wipeLocalAccountData(db);
    }
    accountSwitch.setLinkedAccount(db, { remoteUserId: user.id, email: user.email });
  }

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
  await syncWithServer({ deep: true });

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

/**
 * Pulls what changed on the server, then pushes what changed on this device — see
 * src/local/syncRunner.ts for the cycle itself and src/local/sync.ts for the wire protocol.
 * Called on first-run completion, on every app boot and resume (deep: re-reads the last couple of
 * days of server changes), after local edits and periodically while the app is open (see
 * src/lib/syncScheduler.ts), and from Settings' "sync now" button — so a change reaches the other
 * side from every angle rather than relying on one trigger firing. The returned SyncOutcome is
 * what that UI shows; every fire-and-forget caller just discards it.
 *
 * Single-flight: a call that arrives while a sync is running doesn't start a second, overlapping
 * one (two would fight over the same cursors) — it queues exactly one more run and resolves with
 * that run's result, so nothing written in the meantime is left waiting for the next trigger.
 *
 * Never throws (a device offline must never see this as an error): failures come back as
 * { ok: false, error }, and the unmoved cursors mean the next successful sync just picks up
 * wherever this one left off.
 */
let inFlight: Promise<SyncOutcome> | null = null;
let rerunRequested = false;
let deepRequested = false;

export function syncWithServer(options: { deep?: boolean } = {}): Promise<SyncOutcome> {
  if (options.deep) deepRequested = true;
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  inFlight = (async () => {
    updateSyncStatus({ syncing: true });
    let outcome = await syncOnce();
    while (rerunRequested) {
      rerunRequested = false;
      outcome = await syncOnce();
    }
    return outcome;
  })().finally(() => {
    inFlight = null;
    updateSyncStatus({ syncing: false });
  });
  return inFlight;
}

async function syncOnce(): Promise<SyncOutcome> {
  const deep = deepRequested;
  deepRequested = false;
  const { emptyOutcome, runSync, classifySyncError } = await import("@/local/syncRunner");
  try {
    const cached = await getCachedLicense();
    if (!cached?.token) return { ...emptyOutcome(), notLinked: true };

    const { getLocalDbInstance } = await import("@/local/db");
    const db = getLocalDbInstance();
    if (!db) return { ...emptyOutcome(), notLinked: true }; // FirstRunGate's driver bootstrap hasn't run yet

    // A device that was linked before it started remembering its account (see accountSwitch.ts)
    // learns it here, so a later sign-in as somebody else is still caught.
    const { getLinkedAccount, setLinkedAccount } = await import("@/local/accountSwitch");
    if (!getLinkedAccount(db)) setLinkedAccount(db, { remoteUserId: cached.remoteUserId, email: cached.remoteEmail });

    const outcome = await runSync(
      db,
      { token: cached.token, remoteUserId: cached.remoteUserId, lastPushedAt: cached.lastPushedAt, lastPulledAt: cached.lastPulledAt },
      { deep }
    );
    updateSyncStatus({ last: outcome });
    return outcome;
  } catch (err) {
    // Even reading the license cache can fail on a broken/absent local database — never propagate.
    const outcome = { ...emptyOutcome(), error: classifySyncError(err) };
    updateSyncStatus({ last: outcome });
    return outcome;
  }
}

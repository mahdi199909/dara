// One full sync cycle: pull what changed on the server, tidy up, then push what changed here.
// The cursors, the device's account and the license cache are handed in (see
// src/lib/nativeOnboarding.ts's syncWithServer, the only real caller), so this stays testable
// against an in-memory database with no Capacitor around it.
//
// Order matters. Pulling first means a brand-new device links to an account that already has
// data (the web app's, or another phone's) *before* it pushes anything: default categories the
// device seeded for itself are merged with the ones the server already has instead of being sent
// up as duplicates, and a row this device deleted can't be resurrected by a pull that runs after
// its deletion was pushed.
import { LOCAL_USER_ID, mergeDuplicateCategories } from "./localUser";
import { setLastPulledAt, setLastPushedAt } from "./repositories/licenseCache";
import { PULL_OVERLAP_DEEP_MS, PULL_OVERLAP_SHORT_MS, SyncHttpError, pullRemoteChanges, pushLocalChanges, type RowIssue } from "./sync";
import { createSyncTrace, isRoutineTrigger, type SyncTrigger } from "../lib/syncTrace";
import { reconcileReminderNotifications } from "./reminderNotifications";
import { META_LAST_ERROR, META_LAST_OK_AT, setSyncMeta } from "./syncMeta";
import type { LocalDb } from "./db";
import { getLogger, syncErrorCode } from "../lib/observability";

const log = getLogger("sync", "runner");

/**
 * A whole cycle (pull, then push, over a mobile network) slower than this also writes SYNC_SLOW. A build-time setting on
 * a phone, which has no environment to read at run time: NEXT_PUBLIC_SLOW_SYNC_THRESHOLD_MS (the server's own is SLOW_SYNC_THRESHOLD_MS).
 */
const DEFAULT_SLOW_SYNC_MS = 8000;
function slowSyncMs(): number {
  const configured = Number(process.env.NEXT_PUBLIC_SLOW_SYNC_THRESHOLD_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SLOW_SYNC_MS;
}

export type SyncErrorKind = "network" | "auth" | "too-large" | "server" | "unknown";

export interface SyncFailure {
  kind: SyncErrorKind;
  status?: number;
  /** Persian, ready to show a person. */
  message: string;
}

export interface SyncOutcome {
  ok: boolean;
  /** True when this device was never linked to an account, so there was nothing to try. */
  notLinked?: boolean;
  pushedCount: number;
  pulledCount: number;
  deletionsPushed: number;
  deletionsPulled: number;
  /** Rows the server refused this time (each with the server's reason when it gave one). */
  rejectedCount: number;
  issues: RowIssue[];
  /** Rows the server sent that this device couldn't store. */
  pullFailures: number;
  error?: SyncFailure;
  /** 0 = the server predates deletion/profile sync; null = never reached it this time. */
  serverProtocol: number | null;
  finishedAt: string;
  /** The id of this cycle: the value to search for in the phone's log and, as sync_id, in the server's. */
  syncId?: string;
  durationMs?: number;
  /** What the pull created and changed on this device, and how many unsent local changes a newer server copy replaced. */
  created?: number;
  updated?: number;
  conflicts?: number;
}

export function emptyOutcome(): SyncOutcome {
  return {
    ok: false,
    pushedCount: 0,
    pulledCount: 0,
    deletionsPushed: 0,
    deletionsPulled: 0,
    rejectedCount: 0,
    issues: [],
    pullFailures: 0,
    serverProtocol: null,
    finishedAt: new Date().toISOString(),
  };
}

/** Turns whatever went wrong into one of a few situations a person can act on. */
export function classifySyncError(err: unknown): SyncFailure {
  if (err instanceof SyncHttpError) {
    if (err.status === 401 || err.status === 403) {
      return { kind: "auth", status: err.status, message: "سرور نشست شما را نمی‌پذیرد — از «بیشتر ← خروج از حساب» خارج شوید و دوباره وارد شوید." };
    }
    if (err.status === 413) {
      return { kind: "too-large", status: 413, message: "حجم یک درخواست از حد مجاز سرور بیشتر بود (کد ۴۱۳). این باید خودکار حل شود؛ اگر تکرار شد به پشتیبانی خبر بدهید." };
    }
    if (err.status >= 500) {
      return { kind: "server", status: err.status, message: `سرور موقتاً خطا داد (کد ${err.status}). چند دقیقه‌ی دیگر دوباره تلاش می‌شود.` };
    }
    return { kind: "server", status: err.status, message: `سرور درخواست را نپذیرفت (کد ${err.status}).` };
  }
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed/i.test(text)) {
    return { kind: "network", message: "اتصال به سرور برقرار نشد — اینترنت را بررسی کنید." };
  }
  return { kind: "unknown", message: `خطای همگام‌سازی: ${text}` };
}

export interface SyncLicense {
  token: string;
  remoteUserId: string;
  lastPushedAt: string | null;
  lastPulledAt: string | null;
}

export interface RunSyncOptions {
  /** Re-read the last couple of days of server changes instead of the last couple of minutes —
   * cheap insurance, used on app open/resume and manual sync, against a change another device
   * pushed late (an edit made offline carries its old edit time, which a tight cursor would skip). */
  deep?: boolean;
  /** Why this cycle started (for the log): an app open is worth an INFO line, a timer tick is not. */
  trigger?: SyncTrigger;
}

/** How many cycles in a row have failed: a cycle that starts after a failure is a retry, and says so. */
let consecutiveFailures = 0;
let lastFailureKind: SyncErrorKind | undefined;

/** Tests: forget earlier cycles. */
export function resetSyncRunnerState(): void {
  consecutiveFailures = 0;
  lastFailureKind = undefined;
}

export async function runSync(db: LocalDb, license: SyncLicense, options: RunSyncOptions = {}): Promise<SyncOutcome> {
  const outcome = emptyOutcome();
  const trace = createSyncTrace({ trigger: options.trigger, deep: options.deep });
  const ids = { syncId: trace.syncId, traceId: trace.traceId, layer: "local" as const };
  outcome.syncId = trace.syncId;
  const startedAt = performance.now();
  const firstEver = !license.lastPulledAt && !license.lastPushedAt;
  const attempt = consecutiveFailures + 1;

  // Counts, ids and durations only — never what was in a row. A cycle started by the timer or a background write is routine
  // and logs at DEBUG; one the person started, or opened the app for, logs at INFO.
  if (attempt > 1) log.warn("SYNC_RETRY", { ...ids, attempt, previousKind: lastFailureKind, trigger: trace.trigger });
  log.log(isRoutineTrigger(trace.trigger) ? "DEBUG" : "INFO", "SYNC_STARTED", { ...ids, trigger: trace.trigger, deep: trace.deep, firstEver, attempt });

  try {
    const pull = await pullRemoteChanges(db, license.token, license.lastPulledAt, {
      overlapMs: options.deep ? PULL_OVERLAP_DEEP_MS : PULL_OVERLAP_SHORT_MS,
      trace,
      lastPushedAt: license.lastPushedAt,
    });
    outcome.created = pull.created;
    outcome.updated = pull.updated;
    outcome.conflicts = pull.conflicts;
    setLastPulledAt(db, pull.syncedAt);
    outcome.pulledCount = Object.values(pull.pulled).reduce((s, n) => s + n, 0);
    outcome.deletionsPulled = pull.tombstonesApplied;
    outcome.pullFailures = pull.failures.length;
    outcome.serverProtocol = pull.protocol;

    // The device seeds its own default categories at install; the account has its own. Merge the
    // pairs now, before they are pushed anywhere (see mergeDuplicateCategories).
    if (firstEver || pull.pulled.Category) mergeDuplicateCategories(db, LOCAL_USER_ID);

    // Reminders that arrived (or were moved / deleted) from another device are only in SQLite now;
    // give the OS the same picture so they ring even with the app closed.
    if (firstEver || pull.tombstonesApplied > 0 || pull.pulled.Reminder || pull.pulled.Event || pull.pulled.Installment || pull.pulled.InstallmentPlan) {
      reconcileReminderNotifications(db);
    }

    const push = await pushLocalChanges(db, license.token, license.remoteUserId, license.lastPushedAt, { trace });
    setLastPushedAt(db, push.pushedAt);
    outcome.pushedCount = Object.values(push.pushed).reduce((s, n) => s + n, 0);
    outcome.deletionsPushed = push.tombstonesSent;
    outcome.rejectedCount = push.rejected;
    outcome.issues = push.issues;
    if (push.protocol !== null) outcome.serverProtocol = push.protocol;

    outcome.ok = true;
    consecutiveFailures = 0;
    lastFailureKind = undefined;
    setSyncMeta(db, META_LAST_OK_AT, new Date().toISOString());
    setSyncMeta(db, META_LAST_ERROR, null);
  } catch (err) {
    outcome.error = classifySyncError(err);
    setSyncMeta(db, META_LAST_ERROR, outcome.error.message);
    // Going offline is routine on a phone (WARN); anything else is a real problem (ERROR). Only
    // counts are logged — never what was in the rows.
    consecutiveFailures++;
    lastFailureKind = outcome.error.kind;
    log.log(outcome.error.kind === "network" ? "WARN" : "ERROR", "SYNC_FAILED", {
      ...ids,
      error: err,
      errorCode: syncErrorCode(outcome.error.kind),
      kind: outcome.error.kind,
      status: outcome.error.status,
      pulledCount: outcome.pulledCount,
      pushedCount: outcome.pushedCount,
      attempt,
      trigger: trace.trigger,
      // The server's own id for the request that failed: the key to its side of this failure.
      serverRequestId: err instanceof SyncHttpError ? err.requestId : undefined,
    });
  }
  outcome.finishedAt = new Date().toISOString();
  outcome.durationMs = Math.round((performance.now() - startedAt) * 100) / 100;

  const deleted = outcome.deletionsPulled + outcome.deletionsPushed;
  const changed = outcome.pulledCount > 0 || outcome.pushedCount > 0 || deleted > 0 || outcome.rejectedCount > 0;
  if (outcome.ok) {
    if (outcome.rejectedCount > 0) {
      log.warn("SYNC_PARTIAL_SUCCESS", { ...ids, errorCode: "SYNC-005", rejected: outcome.rejectedCount, pushed: outcome.pushedCount, pulled: outcome.pulledCount, durationMs: outcome.durationMs });
    } else {
      log.log(changed ? "INFO" : "DEBUG", "SYNC_SUCCESS", { ...ids, trigger: trace.trigger, durationMs: outcome.durationMs });
    }
  }
  // The end of every cycle, whatever happened: the counts a "what did this sync do?" question needs.
  log.log(changed ? "INFO" : "DEBUG", "SYNC_COMPLETED", {
    ...ids,
    ok: outcome.ok,
    trigger: trace.trigger,
    created: outcome.created ?? 0,
    updated: outcome.updated ?? 0,
    pushed: outcome.pushedCount,
    pulled: outcome.pulledCount,
    deleted,
    rejected: outcome.rejectedCount,
    conflicts: outcome.conflicts ?? 0,
    pullFailures: outcome.pullFailures,
    durationMs: outcome.durationMs,
  });
  const thresholdMs = slowSyncMs();
  if (outcome.durationMs >= thresholdMs) {
    log.warn("SYNC_SLOW", { ...ids, ok: outcome.ok, trigger: trace.trigger, pushed: outcome.pushedCount, pulled: outcome.pulledCount, durationMs: outcome.durationMs, thresholdMs });
  }
  return outcome;
}

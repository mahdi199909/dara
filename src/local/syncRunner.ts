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
import { reconcileReminderNotifications } from "./reminderNotifications";
import { META_LAST_ERROR, META_LAST_OK_AT, setSyncMeta } from "./syncMeta";
import type { LocalDb } from "./db";
import { getLogger, syncErrorCode } from "../lib/observability";

const log = getLogger("sync", "runner");

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
}

export async function runSync(db: LocalDb, license: SyncLicense, options: RunSyncOptions = {}): Promise<SyncOutcome> {
  const outcome = emptyOutcome();
  try {
    const firstEver = !license.lastPulledAt && !license.lastPushedAt;

    const pull = await pullRemoteChanges(db, license.token, license.lastPulledAt, {
      overlapMs: options.deep ? PULL_OVERLAP_DEEP_MS : PULL_OVERLAP_SHORT_MS,
    });
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

    const push = await pushLocalChanges(db, license.token, license.remoteUserId, license.lastPushedAt);
    setLastPushedAt(db, push.pushedAt);
    outcome.pushedCount = Object.values(push.pushed).reduce((s, n) => s + n, 0);
    outcome.deletionsPushed = push.tombstonesSent;
    outcome.rejectedCount = push.rejected;
    outcome.issues = push.issues;
    if (push.protocol !== null) outcome.serverProtocol = push.protocol;

    outcome.ok = true;
    setSyncMeta(db, META_LAST_OK_AT, new Date().toISOString());
    setSyncMeta(db, META_LAST_ERROR, null);
  } catch (err) {
    outcome.error = classifySyncError(err);
    setSyncMeta(db, META_LAST_ERROR, outcome.error.message);
    // Going offline is routine on a phone (WARN); anything else is a real problem (ERROR). Only
    // counts are logged — never what was in the rows.
    log.log(outcome.error.kind === "network" ? "WARN" : "ERROR", "SYNC_FAILED", {
      error: err,
      errorCode: syncErrorCode(outcome.error.kind),
      layer: "local",
      kind: outcome.error.kind,
      status: outcome.error.status,
      pulledCount: outcome.pulledCount,
      pushedCount: outcome.pushedCount,
    });
  }
  outcome.finishedAt = new Date().toISOString();
  return outcome;
}

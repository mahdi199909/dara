"use client";

// The Android app's one-time onboarding gate: nothing to do with web-page auth (see
// src/lib/auth.ts / src/middleware.ts, both untouched and web-only). On first launch it shows a
// login/register form that authenticates against the real remote deployment purely to look up
// (or start) the user's license/trial status; the result is cached on-device, so every later
// launch skips straight to the app. Not used by the actual web build at all — only
// layout.android.tsx (swapped in for the Android export, see scripts/prepare-android-export.mjs)
// renders this; the real (app)/layout.tsx never does.
//
// NOT wired into src/app/(app)/layout.tsx yet on purpose: that layout is a server component
// that redirects via a cookie-based session check, which is incompatible with the static-export
// build Phase 6 adds for Android (no server process exists at runtime to run that check against).
// Wiring this in is part of restructuring that layout in Phase 6, once there's a real Capacitor
// shell to verify the swap against.
import { useEffect, useState } from "react";
import { getCachedLicense, completeFirstRun, continueOffline, refreshLicenseStatus, syncWithServer, AccountSwitchRequired } from "@/lib/nativeOnboarding";
import { checkVersionGate, refreshVersionGate, type VersionGateResult } from "@/lib/versionGate";
import { APP_NAME } from "@/lib/appVersion";
import { getLogger } from "@/lib/observability";
import { setClientUser } from "@/lib/observability/client/clientContext";
import { ApiClientError } from "@/lib/apiClient";
import type { LocalDb } from "@/local/db";

// No fixed module: the boot steps below belong to different domains (widgets, capital, categories…).
const log = getLogger(null, "first-run-gate");

function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

// Turns any thrown value into a full, readable string — including the ApiClientError.details
// field errorResponse() in src/lib/localDispatcher.ts fills with the real exception name/message
// for local (on-device) failures. There's no ADB/log access during this testing phase, so this
// is the only way to see what actually broke; safe to keep permanently since it's still Persian
// enough (the server-side Persian message stays the headline) with the raw detail parenthesized.
function describeError(err: unknown): string {
  if (err instanceof ApiClientError) {
    const detail = err.details ? (typeof err.details === "string" ? err.details : JSON.stringify(err.details)) : null;
    return detail ? `${err.message} (${detail})` : err.message;
  }
  // A plain "TypeError: Failed to fetch" (no ApiClientError, meaning remoteAuth.ts's fetch()
  // never got a response at all) reads as an opaque browser internal to someone who isn't
  // debugging it — lead with the plain-language cause instead, keep the raw detail for support.
  if (err instanceof Error) return `اتصال به سرور برقرار نشد — اینترنت گوشی را بررسی کنید. (${err.name}: ${err.message})`;
  return `خطای غیرمنتظره: ${String(err)}`;
}

export default function FirstRunGate({ children }: { children: React.ReactNode }) {
  // Both start as if native/not-ready, regardless of platform — deciding that from
  // isNativePlatform() here (a plain const, not inside useEffect) would make the very first
  // client render disagree with what the static-export build prerendered on the server (where
  // `window` doesn't exist, so isNativePlatform() always came back false there). That mismatch
  // is what made the web-app dashboard flash/stick above the login form on a real device instead
  // of the gate replacing it outright: React had already committed the prerendered "ready" HTML
  // before the client-only useEffect below ever got a chance to correct it. Only ever branch on
  // isNativePlatform() inside the effect, which by definition never runs during that prerender.
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set when the account just signed into differs from the one this phone's data belongs to —
  // the person must confirm before that data is replaced (see completeFirstRun / accountSwitch.ts).
  const [switchPrompt, setSwitchPrompt] = useState<{ previousEmail: string | null } | null>(null);
  // Set when browserSqlJs.ts had to fall back to dara.sqlite3.bak because dara.sqlite3 itself was
  // corrupt (see loadBrowserSqliteDriver's own doc comment) — surfaced as a dismissible notice
  // once inside the app rather than blocking the gate, since the recovery already succeeded and
  // the user just needs to know some very recent data may be missing.
  const [recoveredFromBackup, setRecoveredFromBackup] = useState(false);
  const [recoveryNoticeDismissed, setRecoveryNoticeDismissed] = useState(false);
  // A hard block (see AppRelease/requireAdmin) takes priority over `ready` below regardless of
  // how it's populated — cached-only on the very first check of a boot (instant, no network
  // wait, matching this gate's existing "never delay showing the already-cached app" posture),
  // then re-derived for real once the background refresh below actually completes.
  const [versionBlock, setVersionBlock] = useState<VersionGateResult | null>(null);

  async function recheckVersionGate() {
    try {
      const { App } = await import("@capacitor/app");
      const info = await App.getInfo();
      const currentBuild = parseInt(info.build, 10) || 0;
      const result = await checkVersionGate(currentBuild);
      setVersionBlock(result.blocked ? result : null);
    } catch (err) {
      log.warn("RELEASE_UPDATE_CHECK_FAILED", { error: err, errorCode: "RELEASE-001", layer: "local", check: "version-gate" });
    }
  }

  useEffect(() => {
    if (!isNativePlatform()) {
      setReady(true);
      setChecking(false);
      return;
    }
    (async () => {
      // Logging to the phone's own file starts before anything else, so a failure during startup is on record too
      // (see src/lib/observability/client/install.ts). It never blocks getting into the app.
      try {
        const { installClientLogging } = await import("@/lib/observability/client/install");
        await installClientLogging();
        log.info("SYSTEM_STARTED", { layer: "local", trigger: "launch" });
      } catch (err) {
        log.warn("LOG_SINK_FAILED", { error: err, layer: "local", trigger: "boot" });
      }

      // The on-device database driver is loaded once here, before anything (including the
      // cached-license check right below) tries to read/write local data — see
      // src/local/drivers/browserSqlJs.ts and setLocalDbDriver in src/lib/localDispatcher.ts.
      const [{ loadBrowserSqliteDriver }, { setLocalDbDriver }, { scheduleWidgetRefresh }] = await Promise.all([
        import("@/local/drivers/browserSqlJs"),
        import("@/lib/localDispatcher"),
        import("@/local/widgetRefresh"),
      ]);
      // Every time the database reaches disk the home-screen widgets (which read that file) are
      // repainted, so they never lag behind what the app shows.
      let savedDb: LocalDb | null = null;
      const { driver, recoveredFromBackup: recovered } = await loadBrowserSqliteDriver({
        onFlushed: () => {
          if (savedDb) scheduleWidgetRefresh(savedDb);
        },
      });
      savedDb = driver;
      setLocalDbDriver(driver);
      if (recovered) setRecoveredFromBackup(true);

      // Best-effort: a stuck/malformed widget queue should never block getting into the app.
      try {
        const [{ drainWidgetQueue }, { getLocalUserId }] = await Promise.all([import("@/local/widgetQueue"), import("@/local/localUser")]);
        await drainWidgetQueue(driver, getLocalUserId(driver));
      } catch (err) {
        log.error("WIDGET_QUEUE_FAILED", { error: err, errorCode: "WIDGET-001", layer: "local", trigger: "boot" });
      }

      // Best-effort, same reasoning: today's "سرمایه من" snapshot (see reportEngine.ts's
      // recordDailyCapitalSnapshot) shouldn't block getting into the app either. Idempotent —
      // safe even if WidgetQueueDrainer's resume handler or a /api/capital read already did it
      // today.
      try {
        const [{ getLocalUserId }, { recordDailyCapitalSnapshot }] = await Promise.all([import("@/local/localUser"), import("@/local/reportEngine")]);
        recordDailyCapitalSnapshot(driver, getLocalUserId(driver));
      } catch (err) {
        log.error("CAPITAL_SNAPSHOT_FAILED", { error: err, layer: "local", trigger: "boot" });
      }

      // Best-effort: backfills any default category added after this device's install (see
      // ensureDefaultCategories's own doc comment) — a install-time-only concern, so this
      // shouldn't block getting into the app either if it somehow fails.
      try {
        const { getLocalUserId, ensureDefaultCategories, mergeDuplicateCategories } = await import("@/local/localUser");
        const userId = getLocalUserId(driver);
        ensureDefaultCategories(driver, userId);
        mergeDuplicateCategories(driver, userId);
      } catch (err) {
        log.warn("CATEGORY_DEFAULTS_FAILED", { error: err, layer: "local", trigger: "boot" });
      }

      // Best-effort: the history kept on this phone is pruned to two years on every launch (see
      // src/local/auditRetention.ts); a failure here never blocks getting into the app.
      try {
        const { purgeExpiredLocalAuditLogs } = await import("@/local/auditRetention");
        const deleted = purgeExpiredLocalAuditLogs(driver);
        if (deleted > 0) log.info("JOB_COMPLETED", { job: "audit-retention", deleted, layer: "local", trigger: "boot" });
      } catch (err) {
        log.error("JOB_FAILED", { job: "audit-retention", error: err, layer: "local", trigger: "boot" });
      }

      // Best-effort, fire-and-forget: ask for notification permission up front (Android 13+)
      // so the OS prompt happens here on first boot rather than surprising the user the first
      // time they add a task/event/installment reminder later.
      import("@/local/nativeNotifications")
        .then(({ requestNotificationPermission }) => requestNotificationPermission())
        .catch((err) => log.warn("LOCAL_NOTIFICATION_PERMISSION_FAILED", { error: err, errorCode: "NOTIF-002", layer: "local", trigger: "boot" }));

      const license = await getCachedLicense();
      setClientUser(license?.remoteUserId); // from here on the phone's records name the account the server knows
      setReady(!!license);

      // Cache-only first (no network wait — same instant-boot posture as the rest of this
      // effect), then re-derive for real once the background refresh actually lands.
      await recheckVersionGate();

      // Fire-and-forget, deliberately not awaited: re-checking with the server shouldn't delay
      // showing the (already-cached) app by a network round trip. See refreshLicenseStatus's own
      // doc comment for why a failure here is silent rather than surfaced. Same reasoning for
      // syncWithServer — WidgetQueueDrainer's resume handler is the trigger that awaits sync
      // before revalidating visible data; this boot-time one just gets the cursors moving.
      // refreshVersionGate is the public update check (no login needed), so a phone that only ever
      // worked offline is locked out of an unsupported build just like a signed-in one.
      void Promise.all([refreshLicenseStatus(), refreshVersionGate()]).then(recheckVersionGate);
      void syncWithServer({ deep: true, trigger: "boot" }).then(async (outcome) => {
        // The UI may already be showing the previous state by the time this lands.
        if (outcome.pulledCount > 0 || outcome.deletionsPulled > 0) {
          const { mutate } = await import("swr");
          mutate(() => true, undefined, { revalidate: true });
        }
      });
    })()
      .catch((err) => {
        setReady(false);
        setBootError(describeError(err));
      })
      .finally(() => setChecking(false));
  }, []);

  // A block flipped on while this device was merely backgrounded (not relaunched) must still
  // catch the user on next resume, not wait for a fresh process start — Capacitor keeps the
  // WebView alive across background/foreground, so nothing above re-runs on its own. Independent
  // of WidgetQueueDrainer's own resume listener (which refreshes everything else): duplicating
  // one lightweight GET on resume is a fine trade for not depending on listener-ordering between
  // two separate components for something this gate needs to enforce itself.
  useEffect(() => {
    if (!isNativePlatform()) return;
    let remove: (() => void) | undefined;
    import("@capacitor/app").then(({ App }) => {
      App.addListener("resume", () => {
        void Promise.all([refreshLicenseStatus(), refreshVersionGate()]).then(recheckVersionGate);
      }).then((handle) => {
        remove = () => handle.remove();
      });
    });
    return () => remove?.();
  }, []);

  async function submit(confirmSwitch: boolean) {
    setError(null);
    setNetworkError(false);
    setLoading(true);
    try {
      await completeFirstRun({ mode, name, email, password, confirmSwitch });
      setSwitchPrompt(null);
      setReady(true);
    } catch (err) {
      if (err instanceof AccountSwitchRequired) {
        setSwitchPrompt({ previousEmail: err.previousEmail });
        return;
      }
      setError(describeError(err));
      // ApiClientError means the server actually answered (with a real 4xx/5xx — wrong password,
      // duplicate email, validation, etc.) — that's a genuine problem with the submitted info, not
      // a connectivity one, so no offline fallback for those. Anything else here is the raw fetch()
      // in remoteAuth.ts never getting a response at all (offline, DNS, TLS, or the remote host
      // being unreachable from this specific network) — see continueOffline's own doc comment for
      // why that specific case gets an escape hatch instead of leaving the user stuck.
      setNetworkError(!(err instanceof ApiClientError));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submit(false);
  }

  async function onContinueOffline() {
    setError(null);
    setLoading(true);
    try {
      await continueOffline(email);
      setReady(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;

  if (versionBlock?.blocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-4" dir="rtl">
        <div className="w-full max-w-sm bg-surface rounded-2xl shadow p-6 space-y-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt={APP_NAME} className="h-14 w-14 rounded-2xl mx-auto" />
          <h1 className="text-lg font-bold text-ink">به‌روزرسانی لازم است</h1>
          <p className="text-sm text-muted leading-relaxed">
            این نسخه از {APP_NAME} دیگر پشتیبانی نمی‌شود و شامل یک تغییر مهم بوده. برای ادامه، نسخه جدید را نصب کنید.
          </p>
          {versionBlock.downloadUrl && (
            <a
              href={versionBlock.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium hover:opacity-90"
            >
              دانلود نسخه جدید
            </a>
          )}
        </div>
      </div>
    );
  }

  if (ready) {
    return (
      <>
        {recoveredFromBackup && !recoveryNoticeDismissed && (
          <div className="bg-amber-50 text-amber-900 text-xs leading-relaxed px-4 py-2 flex items-center gap-2" dir="rtl">
            <span className="flex-1">
              به‌دلیل یک مشکل فنی، اطلاعات شما از آخرین نسخه پشتیبان بازیابی شد. ممکن است چند مورد آخری که ثبت کرده بودید از دست رفته باشد.
            </span>
            <button type="button" onClick={() => setRecoveryNoticeDismissed(true)} className="shrink-0 font-medium hover:opacity-70">
              متوجه شدم
            </button>
          </div>
        )}
        {children}
      </>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4" dir="rtl">
      <div className="w-full max-w-sm bg-surface rounded-2xl shadow p-6 space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt={APP_NAME} className="h-14 w-14 rounded-2xl mx-auto" />
        <h1 className="text-lg font-bold text-ink text-center">{mode === "login" ? `ورود به ${APP_NAME}` : `ساخت حساب در ${APP_NAME}`}</h1>
        <p className="text-xs text-muted text-center leading-relaxed">
          این فقط یک‌بار لازمه — بعدش دیگه نیازی به ورود دوباره نیست. اطلاعات شخصی شما همچنان فقط روی همین گوشی می‌مونه؛ این مرحله فقط وضعیت اشتراکتون رو مشخص می‌کنه.
        </p>
        {bootError && (
          <p className="text-xs text-red-500 bg-red-50 rounded-lg p-2 leading-relaxed break-words" dir="ltr">
            {bootError}
          </p>
        )}
        {switchPrompt && (
          <div className="space-y-3 rounded-xl border border-line bg-canvas p-3 text-xs leading-relaxed text-ink">
            <p className="font-bold">این گوشی با حساب دیگری استفاده شده است</p>
            <p className="text-muted">
              اطلاعات فعلی گوشی متعلق به حساب «{switchPrompt.previousEmail ?? "قبلی"}» است. اگر با «{email}» وارد شوید، این اطلاعات از روی گوشی پاک می‌شود و اطلاعات حساب جدید جایگزینش می‌شود.
              هرچه از حساب قبلی همگام شده باشد روی سرور همان حساب می‌ماند.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void submit(true)}
                disabled={loading}
                className="flex-1 rounded-xl bg-accent text-on-accent py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {loading ? "در حال انجام..." : "بله، جایگزین کن"}
              </button>
              <button
                type="button"
                onClick={() => setSwitchPrompt(null)}
                disabled={loading}
                className="flex-1 rounded-xl border border-line py-2 text-sm text-muted hover:bg-surface disabled:opacity-40"
              >
                انصراف
              </button>
            </div>
          </div>
        )}
        <form onSubmit={onSubmit} className="space-y-3">
          {mode === "register" && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="نام"
              className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm"
              required
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ایمیل"
            dir="ltr"
            className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm text-left"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="رمز عبور"
            dir="ltr"
            className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm text-left"
            required
          />
          {error && <p className="text-xs text-red-500 leading-relaxed">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40"
          >
            {loading ? "در حال بررسی..." : mode === "login" ? "ورود" : "ثبت‌نام"}
          </button>
          {networkError && (
            <button
              type="button"
              onClick={onContinueOffline}
              disabled={loading}
              className="w-full rounded-xl border border-line text-muted py-2.5 text-sm hover:bg-canvas disabled:opacity-40"
            >
              فعلاً بدون اینترنت ادامه بده (بعداً دوباره تلاش می‌کنیم)
            </button>
          )}
        </form>
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="w-full text-center text-xs text-muted hover:text-ink"
        >
          {mode === "login" ? "حساب ندارید؟ ثبت‌نام کنید" : "قبلاً حساب دارید؟ وارد شوید"}
        </button>
      </div>
    </div>
  );
}

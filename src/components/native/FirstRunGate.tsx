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
import { getCachedLicense, completeFirstRun, continueOffline, refreshLicenseStatus, syncWithServer } from "@/lib/nativeOnboarding";
import { ApiClientError } from "@/lib/apiClient";

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
  // Set when browserSqlJs.ts had to fall back to dara.sqlite3.bak because dara.sqlite3 itself was
  // corrupt (see loadBrowserSqliteDriver's own doc comment) — surfaced as a dismissible notice
  // once inside the app rather than blocking the gate, since the recovery already succeeded and
  // the user just needs to know some very recent data may be missing.
  const [recoveredFromBackup, setRecoveredFromBackup] = useState(false);
  const [recoveryNoticeDismissed, setRecoveryNoticeDismissed] = useState(false);

  useEffect(() => {
    if (!isNativePlatform()) {
      setReady(true);
      setChecking(false);
      return;
    }
    (async () => {
      // The on-device database driver is loaded once here, before anything (including the
      // cached-license check right below) tries to read/write local data — see
      // src/local/drivers/browserSqlJs.ts and setLocalDbDriver in src/lib/localDispatcher.ts.
      const [{ loadBrowserSqliteDriver }, { setLocalDbDriver }] = await Promise.all([
        import("@/local/drivers/browserSqlJs"),
        import("@/lib/localDispatcher"),
      ]);
      const { driver, recoveredFromBackup: recovered } = await loadBrowserSqliteDriver();
      setLocalDbDriver(driver);
      if (recovered) setRecoveredFromBackup(true);

      // Best-effort: a stuck/malformed widget queue should never block getting into the app.
      try {
        const [{ drainWidgetQueue }, { getLocalUserId }] = await Promise.all([import("@/local/widgetQueue"), import("@/local/localUser")]);
        await drainWidgetQueue(driver, getLocalUserId(driver));
      } catch (err) {
        console.error("widget queue drain failed", err);
      }

      // Best-effort, same reasoning: today's "سرمایه من" snapshot (see reportEngine.ts's
      // recordDailyCapitalSnapshot) shouldn't block getting into the app either. Idempotent —
      // safe even if WidgetQueueDrainer's resume handler or a /api/capital read already did it
      // today.
      try {
        const [{ getLocalUserId }, { recordDailyCapitalSnapshot }] = await Promise.all([import("@/local/localUser"), import("@/local/reportEngine")]);
        recordDailyCapitalSnapshot(driver, getLocalUserId(driver));
      } catch (err) {
        console.error("capital snapshot on boot failed", err);
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
        console.error("ensure default categories on boot failed", err);
      }

      // Best-effort, fire-and-forget: ask for notification permission up front (Android 13+)
      // so the OS prompt happens here on first boot rather than surprising the user the first
      // time they add a task/event/installment reminder later.
      import("@/local/nativeNotifications")
        .then(({ requestNotificationPermission }) => requestNotificationPermission())
        .catch((err) => console.error("notification permission request on boot failed", err));

      const license = await getCachedLicense();
      setReady(!!license);

      // Fire-and-forget, deliberately not awaited: re-checking with the server shouldn't delay
      // showing the (already-cached) app by a network round trip. See refreshLicenseStatus's own
      // doc comment for why a failure here is silent rather than surfaced. Same reasoning for
      // syncWithServer — WidgetQueueDrainer's resume handler is the trigger that awaits sync
      // before revalidating visible data; this boot-time one just gets the cursors moving.
      void refreshLicenseStatus();
      void syncWithServer();
    })()
      .catch((err) => {
        setReady(false);
        setBootError(describeError(err));
      })
      .finally(() => setChecking(false));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNetworkError(false);
    setLoading(true);
    try {
      await completeFirstRun({ mode, name, email, password });
      setReady(true);
    } catch (err) {
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
        <img src="/icon.png" alt="پروا" className="h-14 w-14 rounded-2xl mx-auto" />
        <h1 className="text-lg font-bold text-ink text-center">{mode === "login" ? "ورود به پروا" : "ساخت حساب در پروا"}</h1>
        <p className="text-xs text-muted text-center leading-relaxed">
          این فقط یک‌بار لازمه — بعدش دیگه نیازی به ورود دوباره نیست. اطلاعات شخصی شما همچنان فقط روی همین گوشی می‌مونه؛ این مرحله فقط وضعیت اشتراکتون رو مشخص می‌کنه.
        </p>
        {bootError && (
          <p className="text-xs text-red-500 bg-red-50 rounded-lg p-2 leading-relaxed break-words" dir="ltr">
            {bootError}
          </p>
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

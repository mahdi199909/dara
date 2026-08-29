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
import { getCachedLicense, completeFirstRun, refreshLicenseStatus } from "@/lib/nativeOnboarding";
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
  if (err instanceof Error) return `خطای غیرمنتظره: ${err.name}: ${err.message}`;
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
  const [bootError, setBootError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      const driver = await loadBrowserSqliteDriver();
      setLocalDbDriver(driver);

      // Best-effort: a stuck/malformed widget queue should never block getting into the app.
      try {
        const [{ drainWidgetQueue }, { getLocalUserId }] = await Promise.all([import("@/local/widgetQueue"), import("@/local/localUser")]);
        await drainWidgetQueue(driver, getLocalUserId(driver));
      } catch (err) {
        console.error("widget queue drain failed", err);
      }

      const license = await getCachedLicense();
      setReady(!!license);

      // Fire-and-forget, deliberately not awaited: re-checking with the server shouldn't delay
      // showing the (already-cached) app by a network round trip. See refreshLicenseStatus's own
      // doc comment for why a failure here is silent rather than surfaced.
      void refreshLicenseStatus();
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
    setLoading(true);
    try {
      await completeFirstRun({ mode, name, email, password });
      setReady(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;
  if (ready) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" dir="rtl">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="پنهان" className="h-14 w-14 rounded-2xl mx-auto" />
        <h1 className="text-lg font-bold text-gray-800 text-center">{mode === "login" ? "ورود به پنهان" : "ساخت حساب در پنهان"}</h1>
        <p className="text-xs text-gray-400 text-center leading-relaxed">
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
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              required
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ایمیل"
            dir="ltr"
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-left"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="رمز عبور"
            dir="ltr"
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-left"
            required
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-600 text-white py-2.5 text-sm font-medium hover:bg-brand-700 disabled:opacity-40"
          >
            {loading ? "در حال بررسی..." : mode === "login" ? "ورود" : "ثبت‌نام"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="w-full text-center text-xs text-gray-400 hover:text-gray-600"
        >
          {mode === "login" ? "حساب ندارید؟ ثبت‌نام کنید" : "قبلاً حساب دارید؟ وارد شوید"}
        </button>
      </div>
    </div>
  );
}

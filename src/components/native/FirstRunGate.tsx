"use client";

// The Android app's one-time onboarding gate: nothing to do with web-page auth (see
// src/lib/auth.ts / src/middleware.ts, both untouched and web-only). On first launch it shows a
// login/register form that authenticates against the real remote deployment purely to look up
// (or start) the user's license/trial status; the result is cached on-device, so every later
// launch skips straight to the app. Completely inert on the web build — isNativePlatform() is
// false there, so this renders `children` immediately and touches nothing else.
//
// NOT wired into src/app/(app)/layout.tsx yet on purpose: that layout is a server component
// that redirects via a cookie-based session check, which is incompatible with the static-export
// build Phase 6 adds for Android (no server process exists at runtime to run that check against).
// Wiring this in is part of restructuring that layout in Phase 6, once there's a real Capacitor
// shell to verify the swap against.
import { useEffect, useState } from "react";
import { getCachedLicense, completeFirstRun } from "@/lib/nativeOnboarding";
import { ApiClientError } from "@/lib/apiClient";

function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

export default function FirstRunGate({ children }: { children: React.ReactNode }) {
  const native = isNativePlatform();
  const [checking, setChecking] = useState(native);
  const [ready, setReady] = useState(!native);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!native) return;
    getCachedLicense()
      .then((license) => setReady(!!license))
      .catch(() => setReady(false))
      .finally(() => setChecking(false));
  }, [native]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await completeFirstRun({ mode, name, email, password });
      setReady(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "خطا در ورود. دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;
  if (ready) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" dir="rtl">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6 space-y-4">
        <h1 className="text-lg font-bold text-gray-800 text-center">{mode === "login" ? "ورود به دارا" : "ساخت حساب در دارا"}</h1>
        <p className="text-xs text-gray-400 text-center leading-relaxed">
          این فقط یک‌بار لازمه — بعدش دیگه نیازی به ورود دوباره نیست. اطلاعات شخصی شما همچنان فقط روی همین گوشی می‌مونه؛ این مرحله فقط وضعیت اشتراکتون رو مشخص می‌کنه.
        </p>
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

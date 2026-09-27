"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import CodeSignIn from "@/components/auth/CodeSignIn";
import { inputClass, primaryButtonClass } from "@/components/auth/CodeField";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

/** Only same-site paths: `?next=https://elsewhere` must not turn the login page into a redirector. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"password" | "code">("password");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function done() {
    router.push(safeNext(searchParams.get("next")));
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiPost("/api/auth/login", { identifier, password });
      done();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "خطا در ورود");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface rounded-2xl shadow-sm border border-line p-6">
      <h2 className="text-lg font-bold mb-4 text-ink">ورود</h2>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1 mb-4" role="tablist">
        {(
          [
            ["password", "با رمز عبور"],
            ["code", "با کد یکبار مصرف"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            onClick={() => setMode(key)}
            className={`rounded-lg py-2 text-xs font-medium transition ${mode === key ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "password" ? (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-ink mb-1">ایمیل یا شماره موبایل</label>
            <input type="text" required autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} className={inputClass} dir="ltr" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-ink">رمز عبور</label>
              <Link href="/forgot-password" className="text-xs text-accent">
                رمز را فراموش کرده‌اید؟
              </Link>
            </div>
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} dir="ltr" />
          </div>
          {error && <p className="text-sm text-waste">{error}</p>}
          <button type="submit" disabled={loading} className={primaryButtonClass}>
            {loading ? "در حال ورود..." : "ورود"}
          </button>
        </form>
      ) : (
        <CodeSignIn purpose="LOGIN_OTP" onAuthenticated={done} initialIdentifier={identifier} />
      )}

      <p className="text-center text-sm text-muted mt-4">
        حساب ندارید؟{" "}
        <Link href="/register" className="text-accent font-medium">
          ثبت‌نام
        </Link>
      </p>
    </div>
  );
}

"use client";

// Two steps shared by "sign in with a one-time code" and "forgot password", on the web and in the app:
// 1) email or mobile number → a code is sent; 2) the code (and, for a reset, the new password).
// What happens after a successful sign-in is the caller's business (onAuthenticated).
import { useState } from "react";
import { ApiClientError } from "@/lib/apiClient";
import { loginWithCode, requestCode, resetPasswordWithCode, type AuthResult } from "@/lib/authApi";
import { CodeField, ResendButton, inputClass, primaryButtonClass, retryAfterOf, useCountdown } from "./CodeField";

function messageOf(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return "اتصال به سرور برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";
}

export default function CodeSignIn({
  purpose,
  onAuthenticated,
  initialIdentifier = "",
}: {
  purpose: "LOGIN_OTP" | "RESET_PASSWORD";
  onAuthenticated: (result: AuthResult) => Promise<void> | void;
  initialIdentifier?: string;
}) {
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, startCountdown] = useCountdown();
  const reset = purpose === "RESET_PASSWORD";

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await requestCode(purpose, identifier);
      setSentTo(res.sentTo);
      startCountdown(res.retryAfterSeconds);
    } catch (err) {
      setError(messageOf(err));
      const wait = retryAfterOf(err);
      if (wait) startCountdown(wait);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (reset) {
      if (password.length < 8) return setError("رمز جدید باید حداقل ۸ کاراکتر باشد.");
      if (password !== repeat) return setError("تکرار رمز جدید با خودش یکی نیست.");
    }
    setBusy(true);
    try {
      const result = reset ? await resetPasswordWithCode(identifier, code, password) : await loginWithCode(identifier, code);
      await onAuthenticated(result);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <form onSubmit={send} className="space-y-3">
        <p className="text-xs text-muted leading-relaxed">
          {reset
            ? "ایمیل یا شماره موبایل تأییدشده‌ی حسابتان را وارد کنید تا کد بازیابی برایتان بفرستیم."
            : "ایمیل یا شماره موبایل تأییدشده‌ی حسابتان را وارد کنید؛ یک کد ۶ رقمی برای ورود می‌فرستیم."}
        </p>
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="ایمیل یا شماره موبایل"
          dir="ltr"
          autoComplete="username"
          className={`${inputClass} text-left`}
          required
        />
        {error && <p className="text-xs text-waste leading-relaxed">{error}</p>}
        <button type="submit" disabled={busy || !identifier.trim() || left > 0} className={primaryButtonClass}>
          {busy ? "در حال ارسال..." : "ارسال کد"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-3">
      <p className="text-xs text-muted leading-relaxed">
        اگر حسابی با این مشخصات وجود داشته باشد، کد به <span dir="ltr">{sentTo}</span> فرستاده شد. (ایمیل را در پوشه‌ی اسپم هم ببینید.)
      </p>
      <CodeField value={code} onChange={setCode} />
      {reset && (
        <>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="رمز جدید (حداقل ۸ کاراکتر)" autoComplete="new-password" dir="ltr" className={`${inputClass} text-left`} required />
          <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="تکرار رمز جدید" autoComplete="new-password" dir="ltr" className={`${inputClass} text-left`} required />
        </>
      )}
      {error && <p className="text-xs text-waste leading-relaxed">{error}</p>}
      <button type="submit" disabled={busy || code.length !== 6} className={primaryButtonClass}>
        {busy ? "در حال بررسی..." : reset ? "ذخیره‌ی رمز جدید و ورود" : "ورود"}
      </button>
      <div className="flex items-center justify-between">
        <ResendButton secondsLeft={left} onResend={() => void send()} disabled={busy} />
        <button
          type="button"
          onClick={() => {
            setSentTo(null);
            setCode("");
            setError(null);
          }}
          className="text-xs text-muted"
        >
          تغییر ایمیل/شماره
        </button>
      </div>
    </form>
  );
}

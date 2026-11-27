"use client";

// Sign-up on an email address OR an Iranian mobile number: name + number/email + password, then the 6-digit
// code sent there. While the server cannot send email yet (AUTH-008), an email still signs up the older way
// (password only, address unverified) so registration never stops. Web and app alike.
import { useState } from "react";
import { ApiClientError } from "@/lib/apiClient";
import { registerWithCode, registerWithPassword, registerWithPhone, requestCode, type AuthResult } from "@/lib/authApi";
import { PHONE_SIGNUP_NEEDS_CODE, looksLikePhone } from "@/lib/phone";
import { CodeField, ResendButton, inputClass, primaryButtonClass, retryAfterOf, useCountdown } from "./CodeField";

function messageOf(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return "اتصال به سرور برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";
}

export default function RegisterWithCode({ onAuthenticated }: { onAuthenticated: (result: AuthResult) => Promise<void> | void }) {
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, startCountdown] = useCountdown();

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    if (password.length < 8) return setError("رمز عبور باید حداقل ۸ کاراکتر باشد.");
    setBusy(true);
    // A mobile number signs up straight away while the SMS gateway is not set up (it is verified later in Settings).
    if (!PHONE_SIGNUP_NEEDS_CODE && looksLikePhone(identifier)) {
      try {
        await onAuthenticated(await registerWithPhone(name, identifier.trim(), password));
      } catch (err) {
        setError(messageOf(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const res = await requestCode("REGISTER", identifier);
      setSentTo(res.sentTo);
      startCountdown(res.retryAfterSeconds);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "AUTH-008" && identifier.includes("@")) {
        try {
          await onAuthenticated(await registerWithPassword(name, identifier.trim(), password));
        } catch (inner) {
          setError(messageOf(inner));
        }
        return;
      }
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
    setBusy(true);
    try {
      await onAuthenticated(await registerWithCode({ name, identifier, code, password }));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <form onSubmit={send} className="space-y-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام" className={inputClass} required />
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="ایمیل یا شماره موبایل" dir="ltr" autoComplete="username" className={`${inputClass} text-left`} required />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="رمز عبور (حداقل ۸ کاراکتر)" autoComplete="new-password" dir="ltr" className={`${inputClass} text-left`} required />
        {error && <p className="text-xs text-waste leading-relaxed">{error}</p>}
        <button type="submit" disabled={busy || !name.trim() || !identifier.trim() || left > 0} className={primaryButtonClass}>
          {busy ? "در حال ارسال..." : !PHONE_SIGNUP_NEEDS_CODE && looksLikePhone(identifier) ? "ثبت‌نام" : "ثبت‌نام و ارسال کد"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-3">
      <p className="text-xs text-muted leading-relaxed">
        کد تأیید به <span dir="ltr">{sentTo}</span> فرستاده شد. (ایمیل را در پوشه‌ی اسپم هم ببینید.)
      </p>
      <CodeField value={code} onChange={setCode} />
      {error && <p className="text-xs text-waste leading-relaxed">{error}</p>}
      <button type="submit" disabled={busy || code.length !== 6} className={primaryButtonClass}>
        {busy ? "در حال ساخت حساب..." : "تأیید و ساخت حساب"}
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

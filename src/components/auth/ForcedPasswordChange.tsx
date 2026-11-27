"use client";

// Shown right after a sign-in whose password the owner reset by hand: the person picks their own password
// before going on. Web and app alike (the app passes the token the sign-in just returned; the web uses its cookie).
import { useState } from "react";
import { ApiClientError } from "@/lib/apiClient";
import { chooseNewPassword } from "@/lib/authApi";
import { inputClass, primaryButtonClass } from "./CodeField";

export default function ForcedPasswordChange({ token, onDone }: { token?: string; onDone: (newToken: string) => Promise<void> | void }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("رمز جدید باید حداقل ۸ کاراکتر باشد.");
    if (password !== repeat) return setError("تکرار رمز جدید با خودش یکی نیست.");
    setBusy(true);
    try {
      const newToken = await chooseNewPassword(password, token);
      await onDone(newToken);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "اتصال به سرور برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-ink leading-relaxed">رمز عبور شما توسط پشتیبانی بازنشانی شده است. برای ادامه یک رمز عبور تازه‌ی خودتان انتخاب کنید.</p>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="رمز جدید (حداقل ۸ کاراکتر)" autoComplete="new-password" dir="ltr" className={`${inputClass} text-left`} required />
      <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="تکرار رمز جدید" autoComplete="new-password" dir="ltr" className={`${inputClass} text-left`} required />
      {error && <p className="text-xs text-waste leading-relaxed">{error}</p>}
      <button type="submit" disabled={busy} className={primaryButtonClass}>
        {busy ? "در حال ذخیره..." : "ذخیره‌ی رمز جدید و ادامه"}
      </button>
    </form>
  );
}

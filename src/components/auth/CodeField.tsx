"use client";

// The pieces every one-time-code screen shares: the 6-digit field and the "send again in 42s" timer.
import { useEffect, useState } from "react";
import { toPersianDigits } from "@/lib/money";

export const inputClass =
  "bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";
export const primaryButtonClass =
  "w-full rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium hover:opacity-90 transition disabled:opacity-50";
export const secondaryButtonClass = "w-full rounded-xl border border-line text-muted py-2.5 text-sm hover:bg-canvas disabled:opacity-40";

export function CodeField({ value, onChange, autoFocus = true }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9۰-۹]/g, "").slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      placeholder="کد ۶ رقمی"
      dir="ltr"
      maxLength={6}
      className={`${inputClass} text-center tracking-[0.5em] text-lg font-bold`}
      aria-label="کد ۶ رقمی"
    />
  );
}

/** Seconds left until a new code may be asked for; `start(n)` restarts it. */
export function useCountdown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft];
}

export function ResendButton({ secondsLeft, onResend, disabled }: { secondsLeft: number; onResend: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onResend} disabled={disabled || secondsLeft > 0} className="text-xs text-accent disabled:text-muted">
      {secondsLeft > 0 ? `ارسال دوباره‌ی کد تا ${toPersianDigits(String(secondsLeft))} ثانیه‌ی دیگر` : "ارسال دوباره‌ی کد"}
    </button>
  );
}

/** Pulls the retry delay out of a 429's details, when the server named one. */
export function retryAfterOf(err: unknown): number | null {
  const details = (err as { details?: { retryAfterSeconds?: unknown } } | null)?.details;
  return typeof details?.retryAfterSeconds === "number" ? details.retryAfterSeconds : null;
}

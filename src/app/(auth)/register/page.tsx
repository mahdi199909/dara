"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiPost, ApiClientError } from "@/lib/apiClient";

export default function RegisterPage() {
  const router = useRouter();
  // Mirrors the native FirstRunGate flow: /api/auth/register now requires a recently-confirmed
  // EmailVerification row, so registration is a request-code step followed by a confirm-code step.
  const [step, setStep] = useState<"form" | "verify">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (step === "form") {
        await apiPost("/api/auth/verify-email/request", { email });
        setStep("verify");
        return;
      }
      await apiPost("/api/auth/verify-email/confirm", { email, code });
      await apiPost("/api/auth/register", { name, email, password });
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "خطا در ثبت‌نام");
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    setError(null);
    setResending(true);
    try {
      await apiPost("/api/auth/verify-email/request", { email });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "خطا در ارسال کد");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-lg font-bold mb-4 text-gray-800">{step === "form" ? "ساخت حساب جدید" : "تأیید ایمیل"}</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        {step === "verify" ? (
          <div>
            <label className="block text-sm text-gray-600 mb-1">کد ۶ رقمی ارسال‌شده به {email}</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="کد ۶ رقمی"
              inputMode="numeric"
              maxLength={6}
              dir="ltr"
              required
              autoFocus
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-center tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm text-gray-600 mb-1">نام</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ایمیل</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">رمز عبور</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                dir="ltr"
              />
            </div>
          </>
        )}
        {error && <p className="text-sm text-waste-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-brand-600 text-white py-2.5 text-sm font-medium hover:bg-brand-700 transition disabled:opacity-50"
        >
          {step === "form"
            ? loading
              ? "در حال ارسال کد..."
              : "ثبت‌نام"
            : loading
              ? "در حال بررسی..."
              : "تأیید و ساخت حساب"}
        </button>
      </form>
      {step === "verify" ? (
        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            onClick={() => {
              setStep("form");
              setCode("");
              setError(null);
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            اصلاح ایمیل
          </button>
          <button
            type="button"
            onClick={onResend}
            disabled={resending}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            {resending ? "در حال ارسال..." : "ارسال دوباره‌ی کد"}
          </button>
        </div>
      ) : (
        <p className="text-center text-sm text-gray-500 mt-4">
          قبلاً ثبت‌نام کرده‌اید؟{" "}
          <Link href="/login" className="text-brand-600 font-medium">
            ورود
          </Link>
        </p>
      )}
    </div>
  );
}

"use client";

// Settings → «حساب و امنیت»: verify the email, add/verify a mobile number, change the password, and sign
// out of every other device. Same component on the web and in the app — src/lib/authApi.ts decides how
// each call reaches the server.
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { ApiClientError } from "@/lib/apiClient";
import {
  changePassword,
  getAccountSecurity,
  removePhone,
  sendEmailVerificationCode,
  sendPhoneVerificationCode,
  signOutEverywhereElse,
  verifyEmail,
  verifyPhone,
  type AccountSecurity,
} from "@/lib/authApi";
import { formatJalali } from "@/lib/jalali";
import { CodeField, ResendButton, inputClass, primaryButtonClass, retryAfterOf, secondaryButtonClass, useCountdown } from "@/components/auth/CodeField";

function messageOf(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return "اتصال به سرور برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.";
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? "bg-accent-soft text-accent" : "bg-amber-50 text-amber-800"}`}>{children}</span>
  );
}

function Feedback({ error, message }: { error: string | null; message: string | null }) {
  if (error) return <p className="text-xs text-waste leading-relaxed">{error}</p>;
  if (message) return <p className="text-xs text-accent leading-relaxed">{message}</p>;
  return null;
}

function EmailCard({ account, onChanged }: { account: AccountSecurity; onChanged: () => void }) {
  const [step, setStep] = useState<"idle" | "code">("idle");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [left, startCountdown] = useCountdown();

  async function send() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await sendEmailVerificationCode();
      if ("alreadyVerified" in res) return onChanged();
      setSentTo(res.sentTo);
      setStep("code");
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
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(code);
      setMessage("ایمیل شما تأیید شد.");
      setStep("idle");
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold text-ink text-sm">ایمیل</h2>
        <Badge ok={account.emailVerified}>{account.emailVerified ? "تأییدشده" : "تأیید نشده"}</Badge>
      </div>
      <p className="text-sm text-ink" dir="ltr">
        {account.email}
      </p>
      {!account.emailVerified && (
        <>
          <p className="text-xs text-muted leading-relaxed">
            با تأیید ایمیل، اگر رمزتان را فراموش کنید می‌توانید با کدی که به همین ایمیل می‌آید دوباره وارد حساب شوید.
          </p>
          {!account.channels.email && <p className="text-xs text-amber-800 bg-amber-50 rounded-xl p-2">ارسال ایمیل هنوز روی سرور راه‌اندازی نشده است.</p>}
          {step === "idle" ? (
            <button type="button" onClick={send} disabled={busy || !account.channels.email || left > 0} className={primaryButtonClass}>
              {busy ? "در حال ارسال..." : "ارسال کد تأیید به ایمیل"}
            </button>
          ) : (
            <form onSubmit={confirm} className="space-y-2">
              <p className="text-xs text-muted">
                کد به <span dir="ltr">{sentTo}</span> فرستاده شد (پوشه‌ی اسپم را هم ببینید).
              </p>
              <CodeField value={code} onChange={setCode} />
              <button type="submit" disabled={busy || code.length !== 6} className={primaryButtonClass}>
                {busy ? "در حال بررسی..." : "تأیید ایمیل"}
              </button>
              <ResendButton secondsLeft={left} onResend={send} disabled={busy} />
            </form>
          )}
        </>
      )}
      <Feedback error={error} message={message} />
    </Card>
  );
}

function PhoneCard({ account, onChanged }: { account: AccountSecurity; onChanged: () => void }) {
  const [editing, setEditing] = useState(!account.phoneVerified);
  const [phone, setPhone] = useState("");
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [left, startCountdown] = useCountdown();

  async function send(target = phone) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await sendPhoneVerificationCode(target);
      setPendingPhone(res.phone);
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
    if (!pendingPhone) return;
    setBusy(true);
    setError(null);
    try {
      await verifyPhone(pendingPhone, code);
      setMessage("شماره موبایل تأیید شد. از این به بعد می‌توانید با همین شماره هم وارد شوید.");
      setPendingPhone(null);
      setCode("");
      setPhone("");
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("شماره موبایل از حساب برداشته شود؟ بعد از آن نمی‌توانید با این شماره وارد شوید.")) return;
    setBusy(true);
    setError(null);
    try {
      await removePhone();
      setMessage("شماره موبایل برداشته شد.");
      setEditing(true);
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold text-ink text-sm">شماره موبایل</h2>
        {account.phoneVerified && <Badge ok>تأییدشده</Badge>}
      </div>
      {account.phoneVerified && !editing ? (
        <div className="space-y-2">
          <p className="text-sm text-ink" dir="ltr">
            {account.phone}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(true)} disabled={busy} className={secondaryButtonClass}>
              تغییر شماره
            </button>
            <button type="button" onClick={remove} disabled={busy} className={secondaryButtonClass}>
              حذف شماره
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted leading-relaxed">
            با شماره‌ی تأییدشده می‌توانید با کد پیامکی وارد شوید یا رمز فراموش‌شده را بازیابی کنید.
          </p>
          {!account.channels.sms && <p className="text-xs text-amber-800 bg-amber-50 rounded-xl p-2">ارسال پیامک هنوز روی سرور راه‌اندازی نشده است.</p>}
          {!pendingPhone ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="space-y-2"
            >
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="09121234567" dir="ltr" className={`${inputClass} text-left`} />
              <button type="submit" disabled={busy || !phone.trim() || !account.channels.sms || left > 0} className={primaryButtonClass}>
                {busy ? "در حال ارسال..." : "ارسال کد تأیید با پیامک"}
              </button>
              {account.phoneVerified && (
                <button type="button" onClick={() => setEditing(false)} className="w-full text-xs text-muted">
                  انصراف
                </button>
              )}
            </form>
          ) : (
            <form onSubmit={confirm} className="space-y-2">
              <p className="text-xs text-muted">
                کد به <span dir="ltr">{pendingPhone}</span> پیامک شد.
              </p>
              <CodeField value={code} onChange={setCode} />
              <button type="submit" disabled={busy || code.length !== 6} className={primaryButtonClass}>
                {busy ? "در حال بررسی..." : "تأیید شماره"}
              </button>
              <div className="flex items-center justify-between">
                <ResendButton secondsLeft={left} onResend={() => void send(pendingPhone)} disabled={busy} />
                <button type="button" onClick={() => setPendingPhone(null)} className="text-xs text-muted">
                  شماره‌ی دیگر
                </button>
              </div>
            </form>
          )}
        </>
      )}
      <Feedback error={error} message={message} />
    </Card>
  );
}

function PasswordCard({ account }: { account: AccountSecurity }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (next.length < 8) return setError("رمز جدید باید حداقل ۸ کاراکتر باشد.");
    if (next !== repeat) return setError("تکرار رمز جدید با خودش یکی نیست.");
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setRepeat("");
      setMessage("رمز عبور عوض شد. بقیه‌ی دستگاه‌ها از حساب خارج شدند و باید با رمز جدید وارد شوند.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 space-y-3">
      <h2 className="font-bold text-ink text-sm">تغییر رمز عبور</h2>
      {account.passwordChangedAt && <p className="text-xs text-muted">آخرین تغییر: {formatJalali(new Date(account.passwordChangedAt))}</p>}
      <form onSubmit={submit} className="space-y-2">
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="رمز فعلی" autoComplete="current-password" dir="ltr" className={`${inputClass} text-left`} required />
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="رمز جدید (حداقل ۸ کاراکتر)" autoComplete="new-password" dir="ltr" className={`${inputClass} text-left`} required />
        <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="تکرار رمز جدید" autoComplete="new-password" dir="ltr" className={`${inputClass} text-left`} required />
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? "در حال ذخیره..." : "تغییر رمز"}
        </button>
      </form>
      <Feedback error={error} message={message} />
    </Card>
  );
}

function SessionsCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (!window.confirm("از همه‌ی دستگاه‌ها و مرورگرهای دیگر خارج شوید؟ این دستگاه وارد می‌ماند.")) return;
    setBusy(true);
    setError(null);
    try {
      await signOutEverywhereElse();
      setMessage("از همه‌ی دستگاه‌های دیگر خارج شدید.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 space-y-3">
      <h2 className="font-bold text-ink text-sm">دستگاه‌های واردشده</h2>
      <p className="text-xs text-muted leading-relaxed">اگر گوشی یا رایانه‌ای را گم کرده‌اید یا به کسی داده‌اید، از اینجا حساب را روی همه‌ی آن‌ها ببندید.</p>
      <button type="button" onClick={run} disabled={busy} className={secondaryButtonClass}>
        {busy ? "در حال انجام..." : "خروج از همه‌ی دستگاه‌های دیگر"}
      </button>
      <Feedback error={error} message={message} />
    </Card>
  );
}

export default function AccountSecurityTab() {
  const [account, setAccount] = useState<AccountSecurity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [native, setNative] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccount(await getAccountSecurity());
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    setNative(Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()));
    void load();
  }, [load]);

  if (error && !account) {
    return (
      <Card className="p-5 space-y-3">
        <p className="text-sm text-waste leading-relaxed">{error}</p>
        <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
          تلاش دوباره
        </button>
      </Card>
    );
  }
  if (!account) return <p className="text-sm text-muted">در حال بارگذاری...</p>;

  return (
    <div className="space-y-4">
      {account.isAdmin && !native && (
        <a href="/dashboard" className="block rounded-2xl border border-accent bg-accent-soft p-4 text-sm font-medium text-accent">
          ورود به داشبورد مدیریت ←
        </a>
      )}
      <EmailCard account={account} onChanged={load} />
      <PhoneCard account={account} onChanged={load} />
      <PasswordCard account={account} />
      <SessionsCard />
    </div>
  );
}

"use client";

// Irreversible actions on one account: erase its data, or delete the account. Both ask for the account's
// email typed out and the owner's own password; the server checks both again.
import { useState } from "react";
import { adminPost, errorMessage } from "./adminApi";
import { fa } from "./format";

type Kind = "erase-data" | "delete-account";

const TEXT: Record<Kind, { button: string; title: string; explain: string; done: string }> = {
  "erase-data": {
    button: "پاک‌کردن همه‌ی داده‌های ثبت‌شده",
    title: "پاک‌کردن داده‌ها (حساب می‌ماند)",
    explain:
      "همه‌ی کارها، رویدادها، تراکنش‌ها، حساب‌ها، عادت‌ها، یادداشت‌ها، اقساط و سابقه‌ی این حساب از سرور پاک می‌شود. خود حساب، تنظیمات و اشتراکش می‌ماند و کاربر از همه‌ی دستگاه‌ها خارج می‌شود. نسخه‌ای که روی گوشی خودِ کاربر مانده دست نمی‌خورد؛ اگر دوباره وارد شود، آن نسخه دوباره بالا می‌آید — برای جلوگیری، حساب را غیرفعال هم بکنید. در بکاپ‌های قبلی سرور هنوز هست.",
    done: "داده‌های این حساب پاک شد.",
  },
  "delete-account": {
    button: "حذف کامل حساب",
    title: "حذف کامل حساب",
    explain:
      "حساب و همه‌ی داده‌هایش، تنظیمات و اشتراکش برای همیشه از سرور حذف می‌شود و دیگر نمی‌تواند با این حساب وارد شود (می‌تواند با همین ایمیل از نو ثبت‌نام کند؛ برای جلوگیری از ورود، «غیرفعال‌کردن» را به‌جای حذف بزنید). قابل برگشت نیست، جز از بکاپ سرور.",
    done: "حساب حذف شد.",
  },
};

export default function DangerZone({ userId, email, onErased, onDeleted }: { userId: string; email: string; onErased: () => void; onDeleted: () => void }) {
  const [open, setOpen] = useState<Kind | null>(null);
  const [typedEmail, setTypedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function start(kind: Kind) {
    setOpen(kind);
    setTypedEmail("");
    setPassword("");
    setError(null);
    setDone(null);
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminPost<{ counts?: Record<string, number> }>(`/api/admin/users/${encodeURIComponent(userId)}/actions`, { action: open, confirmEmail: typedEmail, password });
      const total = Object.values(res.counts ?? {}).reduce((a, b) => a + b, 0);
      setDone(`${TEXT[open].done} (${fa(total)} ردیف)`);
      setPassword("");
      if (open === "delete-account") onDeleted();
      else onErased();
      setOpen(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const matches = typedEmail.trim().toLowerCase() === email.toLowerCase();

  return (
    <section className="space-y-3 rounded-2xl border border-waste/40 p-4">
      <h3 className="font-bold text-sm text-waste">اقدامات برگشت‌ناپذیر</h3>
      {done && <p className="text-sm text-accent bg-accent-soft rounded-xl p-2">{done}</p>}
      {!open ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => start("erase-data")} className="rounded-xl border border-waste text-waste px-3 py-2 text-xs">
            {TEXT["erase-data"].button}
          </button>
          <button type="button" onClick={() => start("delete-account")} className="rounded-xl bg-waste text-white px-3 py-2 text-xs">
            {TEXT["delete-account"].button}
          </button>
        </div>
      ) : (
        <form onSubmit={run} className="space-y-2">
          <p className="text-sm font-bold">{TEXT[open].title}</p>
          <p className="text-xs text-muted leading-relaxed">{TEXT[open].explain}</p>
          <label className="block text-xs text-muted">
            برای تأیید، ایمیل حساب را بنویسید: <span dir="ltr" className="text-ink">{email}</span>
          </label>
          <input value={typedEmail} onChange={(e) => setTypedEmail(e.target.value)} dir="ltr" autoComplete="off" className="w-full bg-surface rounded-xl border border-line px-3 py-2 text-sm" />
          <label className="block text-xs text-muted">رمز عبور خودتان (مدیر)</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="current-password" className="w-full bg-surface rounded-xl border border-line px-3 py-2 text-sm" />
          {error && <p className="text-xs text-waste">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !matches || !password} className="flex-1 rounded-xl bg-waste text-white py-2 text-sm disabled:opacity-40">
              {busy ? "در حال انجام..." : TEXT[open].title}
            </button>
            <button type="button" onClick={() => setOpen(null)} disabled={busy} className="rounded-xl border border-line px-4 py-2 text-sm">
              انصراف
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

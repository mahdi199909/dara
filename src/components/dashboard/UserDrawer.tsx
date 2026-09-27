"use client";

// One account in depth, sliding in from the left: who, how much they keep, their subscription with every
// control to change it, account actions, and what the owner already changed on it.
import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import { XIcon } from "@/components/icons";
import { LICENSE_LABELS, LICENSE_TONES, ago, fa, jalaliDate, jalaliDateTime, remainingLabel } from "./format";
import { accountAction, changeLicense, errorMessage, type LicenseChangeBody } from "./adminApi";
import DangerZone from "./DangerZone";

interface Detail {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerifiedAt: string | null;
    phone: string | null;
    phoneVerifiedAt: string | null;
    createdAt: string;
    lastSeenAt: string | null;
    lastLoginAt: string | null;
    passwordChangedAt: string | null;
    disabledAt: string | null;
    isAdmin: boolean;
  };
  license: { row: { status: string; trialEndsAt: string | null; currentPeriodEnd: string | null } | null; status: string; endsAt: string | null; daysRemaining: number | null };
  counts: Record<string, number>;
  history: { id: string; event: string | null; action: string; createdAt: string; oldValue: string | null; newValue: string | null }[];
  recentLogins: { id: string; action: string; createdAt: string; ipAddress: string | null; userAgent: string | null }[];
}

const COUNT_LABELS: Record<string, string> = {
  tasks: "کار",
  transactions: "تراکنش",
  events: "رویداد",
  habits: "عادت",
  projects: "پروژه",
  dailyNotes: "یادداشت",
  accounts: "حساب مالی",
  installmentPlans: "طرح اقساط",
};

const HISTORY_LABELS: Record<string, string> = {
  LICENSE_ADMIN_UPDATED: "تغییر اشتراک",
  USER_ADMIN_DISABLED: "غیرفعال شد",
  USER_ADMIN_ENABLED: "فعال شد",
  USER_ADMIN_SESSIONS_REVOKED: "خروج از همه‌ی دستگاه‌ها",
  USER_ADMIN_VERIFIED: "تأیید دستی ایمیل",
};

const LOGIN_LABELS: Record<string, string> = {
  LOGIN: "ورود با رمز",
  LOGIN_OTP: "ورود با کد",
  PASSWORD_RESET: "بازیابی رمز",
  PASSWORD_CHANGE: "تغییر رمز",
  LOGOUT_ALL: "خروج از همه‌ی دستگاه‌ها",
};

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function licenseSummary(json: string | null): string {
  if (!json) return "—";
  try {
    const v = JSON.parse(json) as { status?: string; currentPeriodEnd?: string | null; trialEndsAt?: string | null };
    const end = v.status === "SUBSCRIBED" ? v.currentPeriodEnd : v.status === "TRIAL" ? v.trialEndsAt : null;
    return `${LICENSE_LABELS[v.status ?? ""] ?? v.status ?? "—"}${end ? ` تا ${jalaliDate(end)}` : ""}`;
  } catch {
    return "—";
  }
}

export default function UserDrawer({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, mutate } = useSWR<Detail>(`/api/admin/users/${encodeURIComponent(userId)}`, fetcher);
  const [days, setDays] = useState("30");
  const [until, setUntil] = useState(() => new Date(Date.now() + 30 * 86_400_000));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(label: string, fn: () => Promise<unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(null);
    setFailure(null);
    try {
      await fn();
      setMessage(`${label} انجام شد.`);
      await mutate();
      onChanged();
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const license = (change: LicenseChangeBody, label: string, confirmText?: string) => run(label, () => changeLicense(userId, change), confirmText);
  const n = Math.round(Number(days));
  const daysOk = Number.isFinite(n) && n >= 1 && n <= 3650;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <button className="flex-1 bg-black/30" onClick={onClose} aria-label="بستن" />
      <div className="w-full max-w-lg h-full overflow-y-auto bg-surface border-r border-line shadow-2xl p-6 space-y-5" dir="rtl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">{data?.user.name ?? "…"}</h2>
            <p className="text-sm text-muted truncate" dir="ltr">
              {data?.user.email}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-canvas" aria-label="بستن">
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {error && <p className="text-sm text-waste">{error.message}</p>}
        {message && <p className="text-sm text-accent bg-accent-soft rounded-xl p-2">{message}</p>}
        {failure && <p className="text-sm text-waste bg-waste-soft rounded-xl p-2">{failure}</p>}

        {data && (
          <>
            <section className="grid grid-cols-2 gap-3 text-sm">
              <Info label="ایمیل" value={data.user.emailVerifiedAt ? `تأییدشده (${jalaliDate(data.user.emailVerifiedAt)})` : "تأیید نشده"} />
              <Info label="موبایل" value={data.user.phone && data.user.phoneVerifiedAt ? data.user.phone : "—"} ltr={Boolean(data.user.phone && data.user.phoneVerifiedAt)} />
              <Info label="عضویت" value={jalaliDate(data.user.createdAt)} />
              <Info label="آخرین بازدید" value={ago(data.user.lastSeenAt)} />
              <Info label="آخرین ورود" value={jalaliDateTime(data.user.lastLoginAt)} />
              <Info label="وضعیت حساب" value={data.user.disabledAt ? `غیرفعال از ${jalaliDate(data.user.disabledAt)}` : "فعال"} />
            </section>

            <section className="space-y-3 rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm">اشتراک</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs ${LICENSE_TONES[data.license.status]}`}>{LICENSE_LABELS[data.license.status]}</span>
              </div>
              <p className="text-sm">
                {data.license.endsAt ? `تا ${jalaliDate(data.license.endsAt)} — ` : ""}
                {remainingLabel(data.license.status, data.license.daysRemaining)}
              </p>

              <div className="space-y-2">
                <p className="text-xs text-muted">تمدید (به انتهای اشتراک یا دوره‌ی آزمایشیِ جاری اضافه می‌شود؛ اگر تمام شده باشد از امروز):</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    [7, "۱ هفته"],
                    [30, "۱ ماه"],
                    [90, "۳ ماه"],
                    [180, "۶ ماه"],
                    [365, "۱ سال"],
                  ].map(([d, label]) => (
                    <button
                      key={d}
                      disabled={busy || data.license.status === "LIFETIME"}
                      onClick={() => void license({ action: "extend", days: d as number }, `تمدید ${label}`)}
                      className="rounded-lg bg-accent-soft text-accent px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} className="w-24 bg-surface rounded-xl border border-line px-3 py-2 text-sm text-center" dir="ltr" />
                  <span className="text-xs text-muted">روز</span>
                  <button
                    disabled={busy || !daysOk || data.license.status === "LIFETIME"}
                    onClick={() => void license({ action: "extend", days: n }, `تمدید ${fa(n)} روز`)}
                    className="rounded-xl bg-accent text-on-accent px-3 py-2 text-xs font-medium disabled:opacity-40"
                  >
                    افزودن
                  </button>
                  <button
                    disabled={busy || !daysOk || data.license.status !== "SUBSCRIBED"}
                    onClick={() => void license({ action: "shorten", days: n }, `کم‌کردن ${fa(n)} روز`, `${fa(n)} روز از اشتراک این کاربر کم شود؟`)}
                    className="rounded-xl border border-line px-3 py-2 text-xs disabled:opacity-40"
                  >
                    کم‌کردن
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-muted">یا تاریخ پایان دقیق:</p>
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <JalaliDateInput value={until} onChange={setUntil} />
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => void license({ action: "set_until", until: localDayKey(until) }, "تنظیم تاریخ پایان", `اشتراک تا ${jalaliDate(until)} تنظیم شود؟`)}
                    className="rounded-xl bg-accent text-on-accent px-3 py-2 text-xs font-medium disabled:opacity-40"
                  >
                    تنظیم
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  disabled={busy || data.license.status === "LIFETIME"}
                  onClick={() => void license({ action: "lifetime" }, "اشتراک مادام‌العمر", "اشتراک مادام‌العمر به این کاربر داده شود؟")}
                  className="rounded-xl border border-line px-3 py-2 text-xs disabled:opacity-40"
                >
                  مادام‌العمر
                </button>
                <button
                  disabled={busy || !daysOk}
                  onClick={() => void license({ action: "trial", days: n }, `دوره‌ی آزمایشی ${fa(n)} روزه`, `دوره‌ی آزمایشی ${fa(n)} روزه از امروز شروع شود؟`)}
                  className="rounded-xl border border-line px-3 py-2 text-xs disabled:opacity-40"
                >
                  دوره‌ی آزمایشی {fa(daysOk ? n : 0)} روزه
                </button>
                <button
                  disabled={busy || data.license.status === "FREE"}
                  onClick={() => void license({ action: "free" }, "لغو اشتراک", "اشتراک این کاربر لغو شود؟ (دوره‌ی آزمایشی هم تمام می‌شود)")}
                  className="rounded-xl border border-waste text-waste px-3 py-2 text-xs disabled:opacity-40"
                >
                  لغو اشتراک
                </button>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="font-bold text-sm">داده‌های حساب</h3>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(data.counts).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-canvas p-2 text-center">
                    <p className="font-bold text-sm">{fa(v)}</p>
                    <p className="text-[11px] text-muted">{COUNT_LABELS[k] ?? k}</p>
                  </div>
                ))}
              </div>
            </section>

            {!data.user.isAdmin && (
              <section className="space-y-2">
                <h3 className="font-bold text-sm">حساب کاربری</h3>
                <div className="flex flex-wrap gap-2">
                  {!data.user.emailVerifiedAt && (
                    <button disabled={busy} onClick={() => void run("تأیید ایمیل", () => accountAction(userId, "verify-email"), "ایمیل این کاربر بدون کد تأیید شود؟")} className="rounded-xl border border-line px-3 py-2 text-xs">
                      تأیید دستی ایمیل
                    </button>
                  )}
                  <button disabled={busy} onClick={() => void run("خروج از همه‌ی دستگاه‌ها", () => accountAction(userId, "signout"), "کاربر از همه‌ی دستگاه‌ها خارج شود؟ باید دوباره وارد شود.")} className="rounded-xl border border-line px-3 py-2 text-xs">
                    خروج از همه‌ی دستگاه‌ها
                  </button>
                  {data.user.disabledAt ? (
                    <button disabled={busy} onClick={() => void run("فعال‌سازی حساب", () => accountAction(userId, "enable"))} className="rounded-xl bg-accent text-on-accent px-3 py-2 text-xs">
                      فعال‌کردن حساب
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => void run("غیرفعال‌سازی حساب", () => accountAction(userId, "disable"), "حساب این کاربر غیرفعال شود؟ از همه‌ی دستگاه‌ها خارج می‌شود و تا فعال‌سازی دوباره نمی‌تواند وارد شود. داده‌هایش پاک نمی‌شود.")}
                      className="rounded-xl border border-waste text-waste px-3 py-2 text-xs"
                    >
                      غیرفعال‌کردن حساب
                    </button>
                  )}
                </div>
              </section>
            )}

            {!data.user.isAdmin && (
              <DangerZone
                userId={userId}
                email={data.user.email}
                onErased={() => {
                  void mutate();
                  onChanged();
                }}
                onDeleted={() => {
                  onChanged();
                  onClose();
                }}
              />
            )}

            <section className="space-y-2">
              <h3 className="font-bold text-sm">ورودهای اخیر</h3>
              {data.recentLogins.length === 0 ? (
                <p className="text-xs text-muted">ثبت نشده.</p>
              ) : (
                <ul className="text-xs space-y-1">
                  {data.recentLogins.map((l) => (
                    <li key={l.id} className="flex justify-between gap-2">
                      <span>{LOGIN_LABELS[l.action] ?? l.action}</span>
                      <span className="text-muted" dir="ltr">
                        {l.ipAddress ?? ""}
                      </span>
                      <span className="text-muted">{jalaliDateTime(l.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="font-bold text-sm">تغییرات مدیر روی این حساب</h3>
              {data.history.length === 0 ? (
                <p className="text-xs text-muted">هنوز تغییری ثبت نشده.</p>
              ) : (
                <ul className="text-xs space-y-2">
                  {data.history.map((h) => (
                    <li key={h.id} className="rounded-xl bg-canvas p-2">
                      <div className="flex justify-between">
                        <span className="font-medium">{HISTORY_LABELS[h.event ?? ""] ?? h.event ?? h.action}</span>
                        <span className="text-muted">{jalaliDateTime(h.createdAt)}</span>
                      </div>
                      {h.event === "LICENSE_ADMIN_UPDATED" && (
                        <p className="text-muted mt-1">
                          {licenseSummary(h.oldValue)} ← {licenseSummary(h.newValue)}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Info({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="rounded-xl bg-canvas p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="text-sm mt-0.5" dir={ltr ? "ltr" : undefined}>
        {value}
      </p>
    </div>
  );
}

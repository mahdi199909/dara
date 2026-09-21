"use client";

import { useState, useEffect, useRef, useSyncExternalStore, Fragment } from "react";
import useSWR, { mutate as mutateGlobal } from "swr";
import { fetcher, apiPatch, apiPost, apiDelete } from "@/lib/apiClient";
import { Card, EmptyState } from "@/components/ui/Card";
import { formatJalali } from "@/lib/jalali";
import { computeHourlyValue } from "@/lib/hourlyValue";
import { toPersianDigits } from "@/lib/money";
import { describeDrop, dropIndicator, planCategoryMove, resolveDropTarget, type DropTarget } from "@/lib/categoryReorder";
import { CATEGORY_KINDS, CATEGORY_KIND_LABELS, type CategoryKind, VALUE_TYPES, VALUE_TYPE_LABELS, type ValueType, CURRENCY_UNITS, CURRENCY_UNIT_LABELS, type CurrencyUnit } from "@/lib/types";
import { PlusIcon, TrashIcon } from "@/components/icons";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import MoneyInput from "@/components/ui/MoneyInput";
import { getLocalDbInstance } from "@/local/db";
import { getSyncStatus, subscribeSyncStatus } from "@/lib/syncStatus";
import { REMOTE_API_BASE } from "@/lib/remoteAuth";
import { APP_NAME, BUNDLE_APP_VERSION, formatVersionLabel, versionCodeFromName } from "@/lib/appVersion";
import type { DataExportFile, DataExportTable, ImportResult } from "@/local/dataExport";
import type { ParsedIcsEvent } from "@/lib/icsParser";
import { Preferences } from "@capacitor/preferences";
import { TABLE_LABELS_FA } from "@/lib/backupLabels";
import WebBackupTab from "@/components/settings/WebBackupTab";
import DiagnosticReportCard from "@/components/settings/DiagnosticReportCard";
import { pickWidgetTextTone, widgetTextColor } from "@/lib/widgetContrast";
import { requestWidgetRefresh } from "@/local/widgetRefresh";
import { setThemeMode, isThemeMode, type ThemeMode } from "@/lib/theme";

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "روشن" },
  { value: "dark", label: "تیره" },
  { value: "system", label: "مطابق سیستم" },
];

// "widgets" is only shown once isNativePlatform() resolves true — a plain web session has no
// home-screen widgets. "backup" exists on both: on the phone it exports/imports the on-device
// database through the OS share sheet (BackupTab); on the web it downloads/uploads a file of the
// account's server-side data (WebBackupTab). Both read and write the same file format.
const TABS = [
  { key: "personal", label: "شخصی" },
  { key: "financial", label: "مالی" },
  { key: "categories", label: "دسته‌بندی‌ها" },
  { key: "history", label: "سابقه" },
  { key: "backup", label: "پشتیبان‌گیری" },
  { key: "widgets", label: "ویجت‌ها" },
] as const;

const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN: "ورود",
  LOGOUT: "خروج",
  REGISTER: "ثبت‌نام",
  CREATE: "ایجاد",
  UPDATE: "ویرایش",
  DELETE: "حذف",
  COMPLETE_TASK: "انجام کار",
  TIMER_START: "شروع تایمر",
  TIMER_STOP: "توقف تایمر",
  CREATE_EXPENSE: "ثبت هزینه",
  CREATE_INCOME: "ثبت درآمد",
  CREATE_TRANSFER: "انتقال وجه",
  PAYMENT: "پرداخت",
  CHANGE_SETTINGS: "تغییر تنظیمات",
  REORDER: "مرتب‌سازی",
  BACKUP_EXPORT: "ساخت فایل پشتیبان",
  BACKUP_IMPORT: "بازیابی پشتیبان",
  ADMIN_LICENSE_UPDATE: "تغییر اشتراک کاربر",
  ADMIN_RELEASE_UPDATE: "تغییر تنظیم نسخه‌ی برنامه",
};

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("personal");
  // Same SSR-safe pattern as LicenseStatusCard/MembershipUpgradeCard below: only ever branch on
  // isNativePlatform() inside an effect, never at module scope or during the first render, so
  // the static-export prerender (no `window`) and the real client render always agree.
  const [native, setNative] = useState(false);

  useEffect(() => {
    setNative(Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()));
  }, []);

  const visibleTabs = native ? TABS : TABS.filter((t) => t.key !== "widgets");

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-lg font-bold text-ink">تنظیمات</h1>

      <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 text-sm px-3.5 py-1.5 rounded-full transition ${
              tab === t.key ? "bg-accent text-on-accent" : "bg-surface border border-line text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "personal" && <PersonalTab />}
      {tab === "financial" && <FinancialTab />}
      {tab === "categories" && <CategoriesTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "backup" && (native ? <BackupTab /> : <WebBackupTab />)}
      {tab === "widgets" && <WidgetsTab />}

      <AppVersionFooter native={native} />
    </div>
  );
}

// Which build is running: the installed APK's own versionName/versionCode on Android (exactly what
// the update check compares against), the bundle's package.json version on the web.
function AppVersionFooter({ native }: { native: boolean }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (native) {
          const { App } = await import("@capacitor/app");
          const info = await App.getInfo();
          if (!cancelled) setLabel(formatVersionLabel(info.version || null, parseInt(info.build, 10) || null));
        } else if (BUNDLE_APP_VERSION) {
          setLabel(formatVersionLabel(BUNDLE_APP_VERSION, versionCodeFromName(BUNDLE_APP_VERSION)));
        }
      } catch {
        // the version line is a courtesy — never worth an error on the settings screen
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [native]);

  if (!label) return null;
  return (
    <p className="text-center text-[11px] text-muted pt-2" dir="rtl">
      {APP_NAME} · {label}
    </p>
  );
}

const LICENSE_STATUS_LABELS: Record<string, string> = {
  TRIAL: "دوره‌ی آزمایشی رایگان",
  FREE: "رایگان",
  SUBSCRIBED: "مشترک",
  LIFETIME: "اشتراک مادام‌العمر",
};

// Native-only — reads the same local license cache FirstRunGate.tsx populates on first launch.
// Renders nothing on the web build (isNativePlatform() is false there) or before that cache read
// resolves, so there's no layout shift for the common (web) case.
function LicenseStatusCard() {
  const [license, setLicense] = useState<import("@/local/repositories/licenseCache").LicenseCache | null>(null);

  useEffect(() => {
    const native = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    if (!native) return;
    import("@/lib/nativeOnboarding")
      .then(({ getCachedLicense }) => getCachedLicense())
      .then(setLicense)
      .catch(() => setLicense(null));
  }, []);

  if (!license) return null;

  return (
    <Card className="p-4">
      <div className="text-sm font-medium text-ink">{LICENSE_STATUS_LABELS[license.status] ?? license.status}</div>
      {license.status === "TRIAL" && license.trialDaysRemaining != null && (
        <div className="text-xs text-muted mt-1">{license.trialDaysRemaining} روز از دوره‌ی رایگان باقی مانده</div>
      )}
    </Card>
  );
}

// Total price per plan, not a per-month rate — see the discount math below.
const MEMBERSHIP_BASE_MONTHLY_PRICE = 200_000;
const MEMBERSHIP_PLANS = [
  { months: 1, totalPrice: 199_000, label: "یک ماهه" },
  { months: 3, totalPrice: 299_000, label: "سه ماهه" },
  { months: 6, totalPrice: 499_000, label: "شش ماهه" },
  { months: 12, totalPrice: 899_000, label: "یک‌ساله" },
] as const;

// Native-only, same convention as LicenseStatusCard above. No payment gateway yet (Zarinpal
// Payman is planned but not wired up) — this only gets the user to a manual card-to-card
// transfer, same as how businesses in Iran commonly take کارت به کارت payments directly.
function MembershipUpgradeCard() {
  const [native, setNative] = useState(false);
  const [selected, setSelected] = useState<(typeof MEMBERSHIP_PLANS)[number] | null>(null);
  const [copied, setCopied] = useState(false);
  const { format } = useCurrencyUnit();

  useEffect(() => {
    setNative(Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()));
  }, []);

  if (!native) return null;

  const cardNumber = process.env.NEXT_PUBLIC_PAYMENT_CARD_NUMBER;
  const bankName = process.env.NEXT_PUBLIC_PAYMENT_BANK_NAME;
  const cardHolder = process.env.NEXT_PUBLIC_PAYMENT_CARD_HOLDER;
  const contactId = process.env.NEXT_PUBLIC_PAYMENT_CONTACT_ID;

  async function copyCardNumber() {
    if (!cardNumber) return;
    await navigator.clipboard.writeText(cardNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-bold text-ink text-sm">ارتقا عضویت</h2>

      {!selected ? (
        <div className="grid grid-cols-2 gap-3">
          {MEMBERSHIP_PLANS.map((plan) => {
            const perMonth = plan.totalPrice / plan.months;
            const discountPercent = Math.round((1 - perMonth / MEMBERSHIP_BASE_MONTHLY_PRICE) * 100);
            return (
              <button
                key={plan.months}
                type="button"
                onClick={() => setSelected(plan)}
                className="rounded-xl border border-line p-3 text-center hover:border-accent hover:bg-accent-soft transition"
              >
                <div className="text-sm font-bold text-ink">{plan.label}</div>
                <div className="text-xs text-muted mt-1">{format(perMonth, { withSuffix: true })}/ماه</div>
                <div className="text-sm font-bold text-accent mt-1.5">{format(plan.totalPrice, { withSuffix: true })}</div>
                <div className="mt-1.5 inline-block text-[11px] bg-accent-soft text-accent rounded-full px-2 py-0.5">
                  {discountPercent}٪ تخفیف نسبت به پایه
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-accent-soft border border-accent p-4 text-center space-y-1">
            <div className="text-2xl">🎉</div>
            <p className="text-sm font-bold text-accent">تبریک! پلن {selected.label} رو انتخاب کردید</p>
            <p className="text-xs text-accent">یک قدم دیگه تا فعال‌سازی اشتراکتون مونده.</p>
          </div>

          <div className="space-y-2 text-sm">
            <p className="text-ink">
              مبلغ <strong>{format(selected.totalPrice, { withSuffix: true })}</strong> رو به شماره کارت زیر واریز کنید:
            </p>
            {cardNumber ? (
              <>
                <div className="flex items-center gap-2">
                  <div dir="ltr" className="flex-1 rounded-xl bg-canvas border border-line px-3 py-2.5 text-center font-mono tracking-wider text-ink">
                    {cardNumber}
                  </div>
                  <button
                    type="button"
                    onClick={copyCardNumber}
                    className="shrink-0 text-xs bg-canvas text-ink px-3 py-2.5 rounded-xl hover:bg-line"
                  >
                    {copied ? "کپی شد ✓" : "کپی"}
                  </button>
                </div>
                {(bankName || cardHolder) && (
                  <p className="text-xs text-muted text-center">
                    {[bankName, cardHolder].filter(Boolean).join(" — به نام ")}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-waste">
                شماره کارت هنوز تنظیم نشده — NEXT_PUBLIC_PAYMENT_CARD_NUMBER رو در .env مقداردهی کنید.
              </p>
            )}
            <p className="text-ink">
              بعد از واریز، برای فعال‌سازی اشتراک در بله یا تلگرام به این آیدی پیام بدید:{" "}
              {contactId ? (
                <strong dir="ltr">{contactId}</strong>
              ) : (
                <span className="text-xs text-waste">(NEXT_PUBLIC_PAYMENT_CONTACT_ID تنظیم نشده)</span>
              )}
            </p>
          </div>

          <button type="button" onClick={() => setSelected(null)} className="w-full text-center text-xs text-muted hover:text-ink">
            بازگشت به انتخاب پلن
          </button>
        </div>
      )}
    </Card>
  );
}

const HOURS_0_23 = Array.from({ length: 24 }, (_, h) => h);

/**
 * Which account is this? Shown at the top of the personal tab on both platforms so it's always
 * clear which email the data belongs to (and therefore which login shows the same data on the
 * other platform). On the web that's the logged-in user; on the phone it's the account this
 * device syncs with — the phone's own local user row is only a placeholder.
 */
function AccountEmailRow({ webEmail }: { webEmail?: string | null }) {
  const [state, setState] = useState<{ email: string | null; native: boolean; linked: boolean }>({ email: webEmail ?? null, native: false, linked: true });

  useEffect(() => {
    const native = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    if (!native) {
      setState({ email: webEmail ?? null, native: false, linked: true });
      return;
    }
    import("@/lib/nativeOnboarding")
      .then(({ getCachedLicense }) => getCachedLicense())
      .then((l) => setState({ email: l?.remoteEmail || null, native: true, linked: !!l?.token }))
      .catch(() => setState({ email: null, native: true, linked: false }));
  }, [webEmail]);

  if (!state.email) return null;
  return (
    <div className="rounded-xl bg-canvas px-3 py-2.5 text-sm">
      <p className="text-xs text-muted mb-0.5">ایمیل حساب</p>
      <p className="text-ink" dir="ltr">{state.email}</p>
      {state.native && !state.linked && (
        <p className="text-xs text-waste mt-1 leading-relaxed">هنوز به سرور وصل نشده — اطلاعات فقط روی همین گوشی است. برای همگام‌شدن با وب از «بیشتر ← خروج از حساب» خارج و دوباره وارد شوید.</p>
      )}
    </div>
  );
}

function PersonalTab() {
  const { data, mutate } = useSWR<any>("/api/settings", fetcher);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Tehran");
  const [wakeHour, setWakeHour] = useState(7);
  const [sleepHour, setSleepHour] = useState(23);
  const [targetHours, setTargetHours] = useState("6");
  const [saved, setSaved] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const { unit, setUnit } = useCurrencyUnit();

  async function toggleDailyMoment() {
    await apiPatch("/api/settings", { dailyMomentEnabled: !data.settings.dailyMomentEnabled });
    mutate();
  }

  async function toggleCompanion() {
    await apiPatch("/api/settings", { companionEnabled: !data.settings.companionEnabled });
    mutate();
  }

  // Applies instantly and locally (no-flash, no wait for the network round trip — see
  // src/lib/theme.ts) before persisting, unlike the other toggles above which wait for the
  // PATCH; a theme switch is exactly the kind of change where the visible feedback IS the point.
  async function changeTheme(mode: ThemeMode) {
    setTheme(mode);
    setThemeMode(mode);
    await apiPatch("/api/settings", { theme: mode });
    mutate();
  }

  useEffect(() => {
    if (data) {
      setName(data.user?.name ?? "");
      setTimezone(data.settings.timezone);
      setWakeHour(data.settings.wakeHour ?? 7);
      setSleepHour(data.settings.sleepHour ?? 23);
      setTargetHours(String((data.settings.dailyProductiveTargetMin ?? 360) / 60));
      if (isThemeMode(data.settings.theme)) setTheme(data.settings.theme);
    }
  }, [data]);

  async function save() {
    const dailyProductiveTargetMin = Math.round(Math.max(0.5, Number(targetHours) || 6) * 60);
    await apiPatch("/api/settings", { name, timezone, wakeHour, sleepHour, dailyProductiveTargetMin });
    setSaved(true);
    mutate();
    mutateGlobal("/api/day-battery");
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-4">
      <LicenseStatusCard />
      <MembershipUpgradeCard />
      <Card className="p-5 space-y-4">
      <AccountEmailRow webEmail={data?.user?.email} />
      <div>
        <label className="block text-sm text-ink mb-1">نام</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm" />
      </div>
      <div>
        <label className="block text-sm text-ink mb-1">منطقه زمانی</label>
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm" dir="ltr" />
      </div>
      <div>
        <label className="block text-sm text-ink mb-1">ساعت‌های بیداری</label>
        <div className="flex items-center gap-2">
          <select
            value={wakeHour}
            onChange={(e) => setWakeHour(Number(e.target.value))}
            className="bg-surface flex-1 rounded-xl border border-line px-3 py-2.5 text-sm"
          >
            {HOURS_0_23.map((h) => (
              <option key={h} value={h}>
                {toPersianDigits(`${h}:00`)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted shrink-0">تا</span>
          <select
            value={sleepHour}
            onChange={(e) => setSleepHour(Number(e.target.value))}
            className="bg-surface flex-1 rounded-xl border border-line px-3 py-2.5 text-sm"
          >
            {HOURS_0_23.map((h) => (
              <option key={h} value={h}>
                {toPersianDigits(`${h}:00`)}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted mt-1">ظرفیت نوار «روز» در صفحه اصلی بر همین بازه حساب می‌شود.</p>
      </div>
      <div>
        <label className="block text-sm text-ink mb-1">هدف روزانه کار مفید (ساعت)</label>
        <input
          type="number"
          dir="ltr"
          min={0.5}
          step={0.5}
          value={targetHours}
          onChange={(e) => setTargetHours(e.target.value)}
          className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm text-right"
        />
        <p className="text-xs text-muted mt-1">آدمک صفحه اصلی پیشرفت امروزت را نسبت به همین عدد نشان می‌دهد.</p>
      </div>
      <div>
        <label className="block text-sm text-ink mb-1">واحد پول</label>
        <div className="flex gap-2">
          {CURRENCY_UNITS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u as CurrencyUnit)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                unit === u ? "bg-accent text-on-accent" : "bg-canvas text-muted"
              }`}
            >
              {CURRENCY_UNIT_LABELS[u]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted mt-1">
          همه اعدادی که قبلاً ثبت کرده‌اید بر همین اساس نمایش داده می‌شوند — هر تومان = ۱۰ ریال و هر هزار تومان = ۱۰۰۰ تومان.
        </p>
      </div>
      <div className="text-sm text-muted">تقویم: شمسی</div>
      {data && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-ink">نمایش لحظه روزانه</p>
            <p className="text-xs text-muted">فقط برای کاربران ویژه، در صفحه اصلی نشان داده می‌شود.</p>
          </div>
          <button
            type="button"
            onClick={toggleDailyMoment}
            dir="ltr"
            className={`w-10 h-[22px] rounded-full transition shrink-0 flex items-center px-0.5 ${
              data.settings.dailyMomentEnabled ? "bg-accent justify-start" : "bg-line justify-end"
            }`}
            aria-label={data.settings.dailyMomentEnabled ? "غیرفعال کردن لحظه روزانه" : "فعال کردن لحظه روزانه"}
          >
            <span className="h-4 w-4 rounded-full bg-surface transition" />
          </button>
        </div>
      )}
      {data && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-ink">نمایش آدمک</p>
            <p className="text-xs text-muted">آدمک همراه در صفحه اصلی، بازتاب پیشرفت روزانه‌ات.</p>
          </div>
          <button
            type="button"
            onClick={toggleCompanion}
            dir="ltr"
            className={`w-10 h-[22px] rounded-full transition shrink-0 flex items-center px-0.5 ${
              data.settings.companionEnabled ? "bg-accent justify-start" : "bg-line justify-end"
            }`}
            aria-label={data.settings.companionEnabled ? "غیرفعال کردن آدمک" : "فعال کردن آدمک"}
          >
            <span className="h-4 w-4 rounded-full bg-on-accent transition" />
          </button>
        </div>
      )}
      {data && (
        <div>
          <p className="text-sm text-ink mb-2">ظاهر</p>
          <div className="flex gap-2">
            {THEME_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => changeTheme(value)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                  theme === value ? "bg-accent text-on-accent" : "bg-canvas text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <button onClick={save} className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium hover:opacity-90">
        {saved ? "ذخیره شد ✓" : "ذخیره"}
      </button>
      </Card>
    </div>
  );
}

function FinancialTab() {
  const { data, mutate } = useSWR<any>("/api/settings", fetcher);
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [workingHoursMonth, setWorkingHoursMonth] = useState("");
  const [hourlyValueOverride, setHourlyValueOverride] = useState("");
  const [saved, setSaved] = useState(false);
  const { format } = useCurrencyUnit();

  useEffect(() => {
    if (data) {
      setMonthlyIncome(data.settings.monthlyIncome?.toString() ?? "");
      setWorkingHoursMonth(data.settings.workingHoursMonth?.toString() ?? "");
      setHourlyValueOverride(data.settings.hourlyValueOverride?.toString() ?? "");
    }
  }, [data]);

  const previewHourlyValue = computeHourlyValue({
    monthlyIncome: monthlyIncome ? Number(monthlyIncome) : null,
    workingHoursMonth: workingHoursMonth ? Number(workingHoursMonth) : null,
    hourlyValueOverride: hourlyValueOverride ? Number(hourlyValueOverride) : null,
  });

  async function save() {
    await apiPatch("/api/settings", {
      monthlyIncome: monthlyIncome ? Number(monthlyIncome) : null,
      workingHoursMonth: workingHoursMonth ? Number(workingHoursMonth) : null,
      hourlyValueOverride: hourlyValueOverride ? Number(hourlyValueOverride) : null,
    });
    setSaved(true);
    mutate();
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card className="p-5 space-y-4">
      <div>
        <label className="block text-sm text-ink mb-1">حقوق ماهانه</label>
        <MoneyInput value={monthlyIncome} onChange={setMonthlyIncome} />
      </div>
      <div>
        <label className="block text-sm text-ink mb-1">ساعات کاری ماهانه</label>
        <input type="number" dir="ltr" value={workingHoursMonth} onChange={(e) => setWorkingHoursMonth(e.target.value)} className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm text-right" />
      </div>
      <div>
        <label className="block text-sm text-ink mb-1">ارزش هر ساعت (تنظیم دستی، اختیاری)</label>
        <MoneyInput value={hourlyValueOverride} onChange={setHourlyValueOverride} />
      </div>
      <div className="rounded-xl bg-accent-soft p-3 text-sm text-accent">
        ارزش هر ساعت شما: <strong>{format(previewHourlyValue, { withSuffix: true })}</strong>
      </div>
      <button onClick={save} className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium hover:opacity-90">
        {saved ? "ذخیره شد ✓" : "ذخیره"}
      </button>
    </Card>
  );
}

function CategoriesTab() {
  const { data, mutate } = useSWR<{ categories: any[] }>("/api/categories", fetcher);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CategoryKind>("NEUTRAL");
  const [valueType, setValueType] = useState<ValueType>("EXPENSE");
  const [icon, setIcon] = useState("🏷️");
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [editingRateFor, setEditingRateFor] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState("350000");
  const [creating, setCreating] = useState(false);
  const { format } = useCurrencyUnit();

  // Press-and-hold drag to put a category somewhere else in the list — above or below another one, inside
  // one, or at the end (the rules live in @/lib/categoryReorder). dragStartRef/dragTimerRef are refs, not
  // state, because they track a press that hasn't become a real drag yet and must never trigger a
  // re-render on their own.
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragTimerRef = useRef<number | null>(null);
  const [activeDrag, setActiveDrag] = useState<{ id: string; name: string; icon: string; x: number; y: number; target: DropTarget | null } | null>(null);
  // The drop the pointer is over right now, and where it is — refs so the release handler and the edge
  // auto-scroll always read the latest without waiting for a render.
  const dropTargetRef = useRef<DropTarget | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [confirmMove, setConfirmMove] = useState<{ sourceId: string; sourceName: string; targetId: string; targetName: string } | null>(null);

  const categories: any[] = data?.categories ?? [];
  // One level of nesting only (see prisma/schema.prisma's own comment on Category.parentCategoryId)
  // — every category is either top-level or a child of a top-level one, never both.
  const topLevelCategories = categories.filter((c) => !c.parentCategoryId);
  const childrenByParent = new Map<string, any[]>();
  for (const c of categories) {
    if (!c.parentCategoryId) continue;
    const list = childrenByParent.get(c.parentCategoryId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentCategoryId, list);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await apiPost("/api/categories", { name, kind, valueType, icon, parentCategoryId: parentCategoryId || undefined });
      setName("");
      setParentCategoryId("");
      setShowForm(false);
      mutate();
    } finally {
      setCreating(false);
    }
  }

  // Reordering only ever moves a top-level category (and its whole group of sub-categories,
  // which tag along together) relative to another top-level one — see this function's own
  // caller for why sub-category-level reordering isn't offered yet. Submits the *entire*
  // resulting flat id order in one PATCH, matching what reorderCategoriesSchema expects.
  async function moveGroup(index: number, direction: -1 | 1) {
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= topLevelCategories.length) return;
    const reordered = [...topLevelCategories];
    [reordered[index], reordered[otherIndex]] = [reordered[otherIndex], reordered[index]];
    const orderedIds = reordered.flatMap((top) => [top.id, ...(childrenByParent.get(top.id) ?? []).map((c) => c.id)]);
    await apiPatch("/api/categories/reorder", { orderedIds });
    mutate();
  }

  // Any category can be picked up: one with sub-categories moves as a whole group (it can go between
  // groups but not inside one), a childless one can also be nested or made a sub-category.
  function isDraggable(_c: any) {
    return true;
  }

  function clearPendingPress() {
    if (dragTimerRef.current) {
      window.clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
    dragStartRef.current = null;
    window.removeEventListener("pointermove", onPendingMove);
    window.removeEventListener("pointerup", clearPendingPress);
  }

  function onPendingMove(e: PointerEvent) {
    const start = dragStartRef.current;
    // A real long-press should stay put; movement before the hold timer fires means the user is
    // scrolling or just tapping, not trying to drag — bail out instead of hijacking the gesture.
    if (start && (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10)) clearPendingPress();
  }

  function startPress(e: React.PointerEvent, c: any) {
    if (!isDraggable(c)) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    const { id, name, icon } = c;
    const x = e.clientX;
    const y = e.clientY;
    window.addEventListener("pointermove", onPendingMove);
    window.addEventListener("pointerup", clearPendingPress, { once: true });
    dragTimerRef.current = window.setTimeout(() => {
      window.removeEventListener("pointermove", onPendingMove);
      window.removeEventListener("pointerup", clearPendingPress);
      dropTargetRef.current = null;
      setActiveDrag({ id, name, icon, x, y, target: null });
    }, 350);
  }

  // Attached only while a drag is actually active (not during the pending long-press window) —
  // re-runs solely when a *new* drag starts, since activeDrag.x/y/target update via the setter
  // below rather than through this effect re-running on every pointer move.
  useEffect(() => {
    if (!activeDrag) return;
    const dragId = activeDrag.id;
    const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

    // What letting go at (x, y) would mean: over a row, which third of it and which of its group; over the
    // strip under the list, the end.
    function targetAt(x: number, y: number): DropTarget | null {
      const el = document.elementFromPoint(x, y);
      if (!(el instanceof Element)) return null;
      if (el.closest("[data-category-end]")) return { kind: "end" };
      const rowEl = el.closest("[data-category-id]");
      if (!rowEl) return null;
      const rect = rowEl.getBoundingClientRect();
      const groupId = rowEl.getAttribute("data-group-id");
      const groupEls = groupId ? Array.from(document.querySelectorAll(`[data-group-id="${groupId}"]`)) : [rowEl];
      const groupTop = Math.min(...groupEls.map((e) => e.getBoundingClientRect().top));
      const groupBottom = Math.max(...groupEls.map((e) => e.getBoundingClientRect().bottom));
      return resolveDropTarget(
        categories,
        dragId,
        rowEl.getAttribute("data-category-id") as string,
        clamp01((y - rect.top) / (rect.height || 1)),
        clamp01((y - groupTop) / (groupBottom - groupTop || 1))
      );
    }

    function update(x: number, y: number) {
      pointerRef.current = { x, y };
      const target = targetAt(x, y);
      dropTargetRef.current = target;
      setActiveDrag((prev) => (prev ? { ...prev, x, y, target } : prev));
    }

    function onMove(e: PointerEvent) {
      update(e.clientX, e.clientY);
    }

    // Holding the pointer near the top or bottom edge of the screen scrolls the page, so a long list can be
    // dragged through without letting go.
    let frame = 0;
    function autoScroll() {
      const { x, y } = pointerRef.current;
      const edge = 72;
      const dy = y < edge ? -Math.ceil((edge - y) / 6) : y > window.innerHeight - edge ? Math.ceil((y - (window.innerHeight - edge)) / 6) : 0;
      if (dy !== 0) {
        window.scrollBy(0, dy);
        update(x, y);
      }
      frame = window.requestAnimationFrame(autoScroll);
    }

    function onUp() {
      const target = dropTargetRef.current;
      dropTargetRef.current = null;
      setActiveDrag(null);
      if (target) void dropOn(dragId, target);
    }

    function onCancel() {
      dropTargetRef.current = null;
      setActiveDrag(null);
    }

    pointerRef.current = { x: activeDrag.x, y: activeDrag.y };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onCancel, { once: true });
    frame = window.requestAnimationFrame(autoScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrag?.id]);

  // Letting go: between two rows it is saved at once; inside a category it first asks (that changes the
  // hierarchy, not just the order).
  async function dropOn(dragId: string, target: DropTarget) {
    const plan = planCategoryMove(categories, dragId, target);
    if (!plan || plan.noop) return;
    if (target.kind === "nest") {
      const source = categories.find((c) => c.id === dragId);
      const parent = categories.find((c) => c.id === target.rowId);
      if (source && parent) setConfirmMove({ sourceId: source.id, sourceName: source.name, targetId: parent.id, targetName: parent.name });
      return;
    }
    try {
      if (plan.changesParent) await apiPatch(`/api/categories/${dragId}`, { parentCategoryId: plan.parentCategoryId });
      await apiPatch("/api/categories/reorder", { orderedIds: plan.orderedIds });
    } catch (err) {
      alert(err instanceof Error ? err.message : "جابه‌جایی انجام نشد.");
    }
    mutate();
  }

  async function confirmMoveCategory() {
    if (!confirmMove) return;
    const plan = planCategoryMove(categories, confirmMove.sourceId, { kind: "nest", rowId: confirmMove.targetId });
    try {
      await apiPatch(`/api/categories/${confirmMove.sourceId}`, { parentCategoryId: confirmMove.targetId });
      // Last among the new parent's sub-categories.
      if (plan) await apiPatch("/api/categories/reorder", { orderedIds: plan.orderedIds });
    } catch (err) {
      alert(err instanceof Error ? err.message : "جابه‌جایی انجام نشد.");
    }
    setConfirmMove(null);
    mutate();
  }

  async function toggleActive(cat: any) {
    await apiPatch(`/api/categories/${cat.id}`, { isActive: !cat.isActive });
    mutate();
  }

  async function setCategoryValueType(cat: any, next: ValueType) {
    if (cat.valueType === next) return;
    await apiPatch(`/api/categories/${cat.id}`, { valueType: next });
    mutate();
  }

  async function disableVirtualAsset(cat: any) {
    await apiPatch(`/api/categories/${cat.id}`, { generatesVirtualAsset: false });
    mutate();
  }

  async function saveVirtualAssetRate(catId: string) {
    const rate = Number(rateInput);
    if (!rate || rate <= 0) return;
    await apiPatch(`/api/categories/${catId}`, { generatesVirtualAsset: true, virtualAssetValuePerHour: rate });
    setEditingRateFor(null);
    mutate();
  }

  async function remove(id: string) {
    await apiDelete(`/api/categories/${id}`);
    mutate();
  }

  const dropLine = activeDrag?.target ? dropIndicator(categories, activeDrag.target) : null;
  const dropHint = activeDrag?.target ? describeDrop(categories, activeDrag.id, activeDrag.target) : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        برای هر دسته‌بندی مشخص کنید «هزینه» یا «دارایی» است — همین انتخاب در فرم ثبت کار روی صفحه اصلی پیش‌فرض می‌شود.
      </p>

      <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-2 rounded-xl hover:opacity-90">
        <PlusIcon className="w-4 h-4" />
        دسته‌بندی جدید
      </button>

      {showForm && (
        <Card className="p-4">
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <input value={icon} onChange={(e) => setIcon(e.target.value)} className="bg-surface rounded-xl border border-line px-3 py-2 text-sm text-center" />
              <input className="bg-surface col-span-2 rounded-xl border border-line px-3 py-2 text-sm" required value={name} onChange={(e) => setName(e.target.value)} placeholder="نام دسته‌بندی" />
            </div>
            <select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)} className="bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm">
              {CATEGORY_KINDS.map((k) => (
                <option key={k} value={k}>{CATEGORY_KIND_LABELS[k]}</option>
              ))}
            </select>
            <select
              value={parentCategoryId}
              onChange={(e) => setParentCategoryId(e.target.value)}
              className="bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm"
            >
              <option value="">بدون والد (دسته‌بندی مستقل)</option>
              {topLevelCategories.map((c) => (
                <option key={c.id} value={c.id}>زیرِ «{c.name}»</option>
              ))}
            </select>
            <div className="flex gap-2">
              {VALUE_TYPES.map((v) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => setValueType(v)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                    valueType === v ? "bg-accent-soft text-accent border border-accent" : "bg-canvas text-muted border border-transparent"
                  }`}
                >
                  {VALUE_TYPE_LABELS[v]}
                </button>
              ))}
            </div>
            <button type="submit" disabled={creating} className="w-full rounded-xl bg-accent text-on-accent py-2 text-sm font-medium disabled:opacity-40">
              {creating ? "در حال ثبت..." : "ثبت"}
            </button>
          </form>
        </Card>
      )}

      <Card>
        {categories.length === 0 ? (
          <EmptyState message="دسته‌بندی‌ای وجود ندارد." />
        ) : (
          <ul className="divide-y divide-line">
            {topLevelCategories.map((top, index) => {
              function row(c: any, isChild: boolean) {
                // Inside a category: the row itself is lit. Above/below/between: a line marks the gap.
                const isDropTarget = activeDrag?.target?.kind === "nest" && activeDrag.target.rowId === c.id;
                const line = dropLine && dropLine.rowId === c.id ? dropLine.edge : null;
                return (
                  <li
                    key={c.id}
                    data-category-id={c.id}
                    data-group-id={top.id}
                    className={`relative px-4 py-3 space-y-2 transition-colors ${!c.isActive ? "opacity-50" : ""} ${isChild ? "bg-canvas/60" : ""} ${
                      isDropTarget ? "bg-accent-soft ring-2 ring-accent ring-inset" : ""
                    }`}
                  >
                    {line && <span aria-hidden className={`pointer-events-none absolute inset-x-3 z-10 h-[3px] rounded-full bg-accent ${line === "top" ? "-top-[2px]" : "-bottom-[2px]"}`} />}
                    <div className="flex items-center gap-3">
                      {isChild && <span className="text-muted shrink-0">└</span>}
                      {!isChild && (
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            onClick={() => moveGroup(index, -1)}
                            disabled={index === 0}
                            className="text-muted hover:text-ink disabled:opacity-20 leading-none"
                            aria-label="جابه‌جایی به بالا"
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => moveGroup(index, 1)}
                            disabled={index === topLevelCategories.length - 1}
                            className="text-muted hover:text-ink disabled:opacity-20 leading-none"
                            aria-label="جابه‌جایی به پایین"
                          >
                            ▼
                          </button>
                        </div>
                      )}
                      <div
                        className={`flex items-center gap-3 flex-1 min-w-0 ${isDraggable(c) ? "cursor-grab active:cursor-grabbing" : ""} ${
                          activeDrag?.id === c.id ? "opacity-30" : ""
                        }`}
                        style={{ touchAction: isDraggable(c) ? "none" : undefined }}
                        onPointerDown={(e) => startPress(e, c)}
                      >
                        <span className="text-lg">{c.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-ink">{c.name}</p>
                          <p className="text-xs text-muted">{CATEGORY_KIND_LABELS[c.kind as CategoryKind]}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => toggleActive(c)}
                        dir="ltr"
                        className={`w-10 h-[22px] rounded-full transition shrink-0 flex items-center px-0.5 ${
                          c.isActive ? "bg-accent justify-start" : "bg-line justify-end"
                        }`}
                        aria-label={c.isActive ? "غیرفعال کردن" : "فعال کردن"}
                      >
                        <span className="h-4 w-4 rounded-full bg-surface transition" />
                      </button>
                      <button onClick={() => remove(c.id)} className="text-muted hover:text-waste p-1 shrink-0">
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 pr-9">
                      {VALUE_TYPES.map((v) => (
                        <button
                          key={v}
                          onClick={() => setCategoryValueType(c, v)}
                          className={`text-xs px-2.5 py-1 rounded-lg ${
                            c.valueType === v ? "bg-accent text-on-accent" : "bg-canvas text-muted"
                          }`}
                        >
                          {VALUE_TYPE_LABELS[v]}
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          if (c.generatesVirtualAsset) disableVirtualAsset(c);
                          else {
                            setRateInput(c.virtualAssetValuePerHour ? String(c.virtualAssetValuePerHour) : "350000");
                            setEditingRateFor(c.id);
                          }
                        }}
                        className={`text-xs px-2.5 py-1 rounded-lg mr-auto ${
                          c.generatesVirtualAsset ? "bg-accent-soft text-accent" : "bg-canvas text-muted"
                        }`}
                      >
                        دارایی مجازی {c.generatesVirtualAsset ? `(${format(c.virtualAssetValuePerHour, { withSuffix: true })}/س)` : "خاموش"}
                      </button>
                    </div>
                    {editingRateFor === c.id && (
                      <div className="flex items-center gap-2 pr-9">
                        <MoneyInput value={rateInput} onChange={setRateInput} placeholder="ارزش هر ساعت" autoFocus />
                        <button onClick={() => saveVirtualAssetRate(c.id)} className="text-xs bg-accent text-on-accent px-3 py-1.5 rounded-lg shrink-0">
                          ثبت
                        </button>
                        <button onClick={() => setEditingRateFor(null)} className="text-xs text-muted shrink-0">
                          انصراف
                        </button>
                      </div>
                    )}
                  </li>
                );
              }

              return (
                <Fragment key={top.id}>
                  {row(top, false)}
                  {(childrenByParent.get(top.id) ?? []).map((child) => row(child, true))}
                </Fragment>
              );
            })}
            {activeDrag && (
              <li
                data-category-end
                className={`px-4 py-4 text-center text-xs transition-colors ${activeDrag.target?.kind === "end" ? "bg-accent-soft text-accent" : "text-muted"}`}
              >
                برای قرار گرفتن در انتهای فهرست، اینجا رها کنید
              </li>
            )}
          </ul>
        )}
      </Card>

      {activeDrag && (
        <div
          className="fixed z-50 flex items-center gap-2 bg-surface border border-accent rounded-xl px-3 py-2 shadow-lg pointer-events-none"
          style={{ left: activeDrag.x + 12, top: activeDrag.y + 12 }}
        >
          <span className="text-lg">{activeDrag.icon}</span>
          <div>
            <p className="text-sm text-ink leading-tight">{activeDrag.name}</p>
            {dropHint && <p className="text-[11px] text-accent leading-tight mt-0.5">{dropHint}</p>}
          </div>
        </div>
      )}

      {confirmMove && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" onClick={() => setConfirmMove(null)}>
          <div className="bg-surface rounded-2xl p-5 max-w-xs w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-ink text-center leading-6">
              آیا می‌خواهید دسته «{confirmMove.sourceName}» به دسته «{confirmMove.targetName}» افزوده شود؟
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmMove(null)} className="flex-1 py-2 rounded-xl bg-canvas text-muted text-sm">
                انصراف
              </button>
              <button onClick={confirmMoveCategory} className="flex-1 py-2 rounded-xl bg-accent text-on-accent text-sm font-medium">
                بله، اضافه شود
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryTab() {
  const { data } = useSWR<{ logs: any[] }>("/api/audit-logs", fetcher);

  return (
    <Card>
      {!data ? (
        <p className="text-sm text-muted text-center py-8">در حال بارگذاری...</p>
      ) : data.logs.length === 0 ? (
        <EmptyState message="هنوز رخدادی ثبت نشده." />
      ) : (
        <ul className="divide-y divide-line max-h-[32rem] overflow-y-auto scrollbar-thin">
          {data.logs.map((log) => (
            <li key={log.id} className="px-4 py-2.5 text-sm flex items-center justify-between">
              <span className="text-ink">
                {AUDIT_ACTION_LABELS[log.action] ?? log.action} · {log.entityType}
              </span>
              <span className="text-xs text-muted">{formatJalali(new Date(log.createdAt), { withTime: true })}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// User-facing Persian names for src/local/dataExport.ts's DATA_EXPORT_TABLES, for the
// pre-import confirmation and the post-import result summary below. Same convention as
// AUDIT_ACTION_LABELS above — an unrecognized key (shouldn't happen, but a future table this
// build doesn't have a label for yet) falls back to the raw table name rather than crashing.
/**
 * Native-only — the live view of the local<->server sync (src/local/syncRunner.ts): which account
 * this phone is linked to, when data last went up and came down, whether a sync is running right
 * now, and — the part that used to be missing — exactly why a sync failed or which rows the server
 * refused, instead of a generic "check your internet". The sync itself runs on its own (a few
 * seconds after each edit, every ~45 s while the app is open, on open/resume — see
 * src/lib/syncScheduler.ts); this card is for trusting it, and for forcing one on demand.
 * Same isNativePlatform()-inside-an-effect convention as LicenseStatusCard above. Renders nothing
 * until the cache read resolves, and nothing at all if this device was never linked to a real
 * account (continueOffline's trial path has no token, so there's genuinely nothing to sync yet).
 */
function SyncStatusCard() {
  const [license, setLicense] = useState<import("@/local/repositories/licenseCache").LicenseCache | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [issues, setIssues] = useState<Array<{ tbl: string; reason: string }>>([]);
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);

  function loadState() {
    return import("@/lib/nativeOnboarding")
      .then(({ getCachedLicense }) => getCachedLicense())
      .then(async (l) => {
        setLicense(l);
        const db = getLocalDbInstance();
        if (db) {
          const { listSyncIssues } = await import("@/local/syncMeta");
          setIssues(listSyncIssues(db).slice(0, 5));
        }
      })
      .catch(() => setLicense(null));
  }

  useEffect(() => {
    const native = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    if (!native) {
      setLoaded(true);
      return;
    }
    loadState().finally(() => setLoaded(true));
  }, []);

  // Cursors and issue rows change whenever any sync (manual, background, boot) finishes.
  const lastFinishedAt = status.last?.finishedAt;
  useEffect(() => {
    if (lastFinishedAt) void loadState();
  }, [lastFinishedAt]);

  async function handleSyncNow() {
    const { syncWithServer } = await import("@/lib/nativeOnboarding");
    await syncWithServer({ deep: true, trigger: "manual" });
  }

  if (!loaded || !license?.token) return null;

  const last = status.last && !status.last.notLinked ? status.last : null;
  const webHost = (() => {
    try {
      return new URL(REMOTE_API_BASE).host;
    } catch {
      return null;
    }
  })();

  return (
    <Card className="p-5 space-y-3">
      <h2 className="font-bold text-ink text-sm">همگام‌سازی با سرور</h2>
      <div className="rounded-xl bg-canvas px-3 py-2.5 text-sm">
        <p className="text-xs text-muted mb-0.5">حساب متصل</p>
        <p className="text-ink" dir="ltr">{license.remoteEmail}</p>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        اطلاعات همیشه روی همین گوشی ذخیره می‌شود و با همین حساب روی سرور همگام می‌ماند — چند ثانیه بعد از هر تغییر، و هر ~۴۵ ثانیه وقتی برنامه باز است.
        {webHost ? ` نسخه وب: ${webHost} (با همین ایمیل وارد شوید).` : ""}
      </p>
      <div className="text-xs text-muted space-y-1">
        <p>آخرین ارسال به سرور: {license.lastPushedAt ? formatJalali(new Date(license.lastPushedAt), { withTime: true }) : "هنوز انجام نشده"}</p>
        <p>آخرین دریافت از سرور: {license.lastPulledAt ? formatJalali(new Date(license.lastPulledAt), { withTime: true }) : "هنوز انجام نشده"}</p>
      </div>
      <button
        type="button"
        onClick={handleSyncNow}
        disabled={status.syncing}
        className="rounded-xl bg-canvas text-ink px-4 py-2 text-sm font-medium hover:bg-line disabled:opacity-40"
      >
        {status.syncing ? "در حال همگام‌سازی..." : "همگام‌سازی الان"}
      </button>

      {last?.ok && (
        <p className="text-xs text-accent">
          {`همگام‌سازی موفق — ${toPersianDigits(last.pushedCount)} مورد ارسال و ${toPersianDigits(last.pulledCount)} مورد دریافت شد`}
          {last.deletionsPushed + last.deletionsPulled > 0 ? `؛ ${toPersianDigits(last.deletionsPushed + last.deletionsPulled)} حذف هم منتقل شد` : ""}
          {"."}
        </p>
      )}
      {last && !last.ok && last.error && <p className="text-xs text-waste leading-relaxed">{last.error.message}</p>}
      {last && last.rejectedCount > 0 && (
        <p className="text-xs text-waste leading-relaxed">{toPersianDigits(last.rejectedCount)} مورد را سرور نپذیرفت — پایین‌تر دلیلش آمده و دوباره تلاش می‌شود.</p>
      )}
      {last && last.pullFailures > 0 && (
        <p className="text-xs text-waste leading-relaxed">{toPersianDigits(last.pullFailures)} مورد از سرور روی این گوشی جا نشد.</p>
      )}
      {issues.length > 0 && (
        <ul className="text-[11px] text-muted space-y-0.5 list-disc pr-4" dir="ltr">
          {issues.map((i, idx) => (
            <li key={idx}>
              {i.tbl}: {i.reason}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Native-only cross-device data migration — see src/local/dataExport.ts for the actual export/
 * import logic (this component only wires it to the filesystem/share plugins and a confirmation
 * step). Gated to native the same way LicenseStatusCard/MembershipUpgradeCard above are: the tab
 * itself is hidden on web by SettingsPage's own native check, so this component only ever
 * mounts inside the Android shell, but it's written defensively (getLocalDbInstance() can still
 * be null for an instant before FirstRunGate's bootstrap resolves) rather than assuming that.
 */
function BackupTab() {
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [pendingImport, setPendingImport] = useState<{ file: DataExportFile; counts: Array<{ table: DataExportTable; count: number }> } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const [icsPreview, setIcsPreview] = useState<ParsedIcsEvent[] | null>(null);
  const [icsError, setIcsError] = useState<string | null>(null);
  const [icsImporting, setIcsImporting] = useState(false);
  const [icsResult, setIcsResult] = useState<{ added: number; skipped: number } | null>(null);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    setExportMessage(null);
    try {
      const [{ exportAllData }, { Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
        import("@/local/dataExport"),
        import("@capacitor/filesystem"),
        import("@capacitor/share"),
      ]);
      const db = getLocalDbInstance();
      if (!db) throw new Error("پایگاه داده هنوز آماده نشده — چند لحظه دیگر دوباره تلاش کنید.");

      const startedAt = performance.now();
      const data = exportAllData(db);
      const json = JSON.stringify(data, null, 2);
      const filename = `parva-backup-${new Date().toISOString().slice(0, 10)}.json`;

      // Directory.Cache, not Documents: on a lot of real devices/Android versions the public
      // Documents directory doesn't already exist and Filesystem.writeFile only fails with
      // "Missing parent directory" rather than creating it (recursive only controls intermediate
      // *sub*directories under an existing base, it doesn't conjure the base directory itself).
      // Cache is always there (it's the app's own private storage, no scoped-storage permission
      // dance) and that's all this needs — the file's real destination is wherever the user picks
      // in the share sheet right below, not "visible in a file manager".
      await Filesystem.writeFile({ path: filename, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
      // The file exists now — leave the trace (history entry + log line). Best effort: it must never turn a made backup into an error.
      try {
        const [{ recordBackupExported }, { getLocalUserId }] = await Promise.all([import("@/local/backupAudit"), import("@/local/localUser")]);
        recordBackupExported(db, getLocalUserId(db), data, performance.now() - startedAt);
      } catch {
        // already reported by the recorder itself where it could be
      }
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
      // `files` (not `url`) is @capacitor/share's option for a local file:// attachment — see
      // node_modules/@capacitor/share's ShareOptions — so Telegram/email/etc. in the resulting
      // share sheet receive the actual file, not just a path string.
      await Share.share({ title: `پشتیبان اطلاعات ${APP_NAME}`, dialogTitle: "ارسال فایل پشتیبان", files: [uri] });

      setExportMessage(`فایل پشتیبان ساخته شد (${filename}) — از صفحه‌ی اشتراک‌گذاری، مقصد را انتخاب کنید.`);
    } catch (err) {
      void import("@/local/backupAudit").then(({ recordBackupFailed }) => recordBackupFailed("export", err));
      setExportError(err instanceof Error ? err.message : "ساخت فایل پشتیبان با خطا مواجه شد.");
    } finally {
      setExporting(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the exact same file again still fires onChange next time
    if (!file) return;

    setImportError(null);
    setImportResult(null);
    setPendingImport(null);

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setImportError("فایل انتخاب‌شده یک JSON معتبر نیست.");
        return;
      }

      const { validateExportFile, summarizeTableCounts } = await import("@/local/dataExport");
      const validated = validateExportFile(parsed);
      if (!validated.ok) {
        setImportError(validated.error);
        return;
      }
      const counts = summarizeTableCounts(validated.file.tables);
      if (counts.length === 0) {
        setImportError("این فایل هیچ داده‌ای برای وارد کردن ندارد.");
        return;
      }
      setPendingImport({ file: validated.file, counts });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "خواندن فایل با خطا مواجه شد.");
    }
  }

  async function confirmImport() {
    if (!pendingImport) return;
    setImporting(true);
    setImportError(null);
    try {
      const { importAllData } = await import("@/local/dataExport");
      const db = getLocalDbInstance();
      if (!db) throw new Error("پایگاه داده هنوز آماده نشده — چند لحظه دیگر دوباره تلاش کنید.");
      const startedAt = performance.now();
      const result = importAllData(db, pendingImport.file);
      // The import has returned — leave the trace (history entry + log line). Best effort, as above.
      try {
        const [{ recordBackupImported }, { getLocalUserId }] = await Promise.all([import("@/local/backupAudit"), import("@/local/localUser")]);
        recordBackupImported(db, getLocalUserId(db), result, performance.now() - startedAt);
      } catch {
        // already reported by the recorder itself where it could be
      }
      setImportResult(result);
      setPendingImport(null);
    } catch (err) {
      void import("@/local/backupAudit").then(({ recordBackupFailed }) => recordBackupFailed("import", err));
      setImportError(err instanceof Error ? err.message : "وارد کردن اطلاعات با خطا مواجه شد.");
    } finally {
      setImporting(false);
    }
  }

  async function handleIcsFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setIcsError(null);
    setIcsResult(null);
    setIcsPreview(null);

    try {
      const text = await file.text();
      const { parseIcs } = await import("@/lib/icsParser");
      const events = parseIcs(text);
      if (events.length === 0) {
        setIcsError("هیچ رویدادی توی این فایل پیدا نشد — فایل .ics معتبری از گوگل‌کلندر انتخاب کنید.");
        return;
      }
      setIcsPreview(events);
    } catch (err) {
      setIcsError(err instanceof Error ? err.message : "خواندن فایل با خطا مواجه شد.");
    }
  }

  async function confirmIcsImport() {
    if (!icsPreview) return;
    setIcsImporting(true);
    setIcsError(null);
    try {
      const db = getLocalDbInstance();
      if (!db) throw new Error("پایگاه داده هنوز آماده نشده — چند لحظه دیگر دوباره تلاش کنید.");
      const [{ createEvent }, { getLocalUserId }, { withLocalTransaction }] = await Promise.all([
        import("@/local/repositories/events"),
        import("@/local/localUser"),
        import("@/local/transaction"),
      ]);
      const userId = getLocalUserId(db);

      let added = 0;
      let skipped = 0;
      // All of the file or none of it: an import that failed half-way must not leave part of the calendar behind.
      // (Running it again is safe either way — see the duplicate check below.)
      withLocalTransaction(db, () => {
        for (const ev of icsPreview) {
          // Same title + same start time already exists — treat this exact event as already
          // imported rather than creating a visible duplicate. Not a perfect UID-based dedup (an
          // .ics has no persisted record of "already imported this" the way this app's own JSON
          // backup import does by row id), but good enough to make re-importing the same file safe.
          const existing = db.get<{ id: string }>(
            `SELECT "id" FROM "Event" WHERE "userId" = ? AND "title" = ? AND "startAt" = ? AND "deletedAt" IS NULL`,
            [userId, ev.title, ev.startAt.toISOString()]
          );
          if (existing) {
            skipped++;
            continue;
          }
          createEvent(db, userId, {
            title: ev.title,
            description: ev.description ?? undefined,
            startAt: ev.startAt.toISOString(),
            endAt: ev.endAt.toISOString(),
            allDay: ev.allDay,
            recurrenceFreq: ev.recurrenceFreq !== "NONE" ? ev.recurrenceFreq : undefined,
            recurrenceInterval: ev.recurrenceFreq !== "NONE" ? ev.recurrenceInterval : undefined,
            recurrenceUntil: ev.recurrenceUntil ? ev.recurrenceUntil.toISOString() : undefined,
            recurrenceCount: ev.recurrenceCount ?? undefined,
          });
          added++;
        }
      });
      setIcsResult({ added, skipped });
      setIcsPreview(null);
    } catch (err) {
      setIcsError(err instanceof Error ? err.message : "وارد کردن رویدادها با خطا مواجه شد.");
    } finally {
      setIcsImporting(false);
    }
  }

  const resultTables = importResult
    ? ([...new Set([...Object.keys(importResult.added), ...Object.keys(importResult.skipped), ...Object.keys(importResult.errors)])] as DataExportTable[])
    : [];

  return (
    <div className="space-y-4">
      <SyncStatusCard />

      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-ink text-sm">خروجی گرفتن از همه اطلاعات</h2>
        <p className="text-xs text-muted leading-relaxed">
          یک فایل شامل تمام اطلاعات شما (کارها، فعالیت‌ها، تراکنش‌ها، عادت‌ها و ...) می‌سازد تا آن را از طریق تلگرام، ایمیل، فضای ابری یا هر روش دیگری به گوشی جدید منتقل کنید.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
        >
          {exporting ? "در حال ساخت فایل..." : "ساخت و اشتراک‌گذاری فایل پشتیبان"}
        </button>
        {exportMessage && <p className="text-xs text-accent">{exportMessage}</p>}
        {exportError && <p className="text-xs text-waste">{exportError}</p>}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-ink text-sm">وارد کردن اطلاعات از فایل پشتیبان</h2>
        <p className="text-xs text-muted leading-relaxed">
          فایل پشتیبانی که قبلاً از گوشی دیگر ساخته‌اید را انتخاب کنید. این کار فقط اطلاعات جدید را اضافه می‌کند — چیزی را جایگزین یا حذف نمی‌کند.
        </p>
        <label className="inline-block rounded-xl bg-canvas text-ink px-4 py-2 text-sm font-medium cursor-pointer hover:bg-line">
          انتخاب فایل پشتیبان
          <input type="file" accept="application/json,.json" onChange={handleFileSelected} className="hidden" />
        </label>
        {importError && <p className="text-xs text-waste">{importError}</p>}

        {pendingImport && (
          <div className="rounded-xl bg-accent-soft border border-accent p-4 space-y-3">
            <p className="text-sm text-accent">
              این فایل شامل موارد زیر است — مواردی که از قبل روی این گوشی وجود داشته باشند نادیده گرفته می‌شوند:
            </p>
            <ul className="text-xs text-ink space-y-1">
              {pendingImport.counts.map(({ table, count }) => (
                <li key={table} className="flex items-center justify-between">
                  <span>{TABLE_LABELS_FA[table] ?? table}</span>
                  <span className="font-medium" dir="ltr">
                    {count.toLocaleString("fa-IR")}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmImport}
                disabled={importing}
                className="flex-1 rounded-xl bg-accent text-on-accent py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {importing ? "در حال وارد کردن..." : "تأیید و وارد کردن"}
              </button>
              <button
                type="button"
                onClick={() => setPendingImport(null)}
                disabled={importing}
                className="flex-1 rounded-xl bg-canvas text-ink py-2 text-sm"
              >
                انصراف
              </button>
            </div>
          </div>
        )}

        {importResult && (
          <div className="rounded-xl bg-canvas border border-line p-4 space-y-2">
            <p className="text-sm text-ink font-medium">نتیجه وارد کردن اطلاعات:</p>
            {resultTables.length === 0 ? (
              <p className="text-xs text-muted">هیچ داده‌ی جدیدی برای اضافه کردن پیدا نشد.</p>
            ) : (
              <ul className="text-xs text-ink space-y-1">
                {resultTables.map((table) => {
                  const added = importResult.added[table] ?? 0;
                  const skipped = importResult.skipped[table] ?? 0;
                  const errors = importResult.errors[table] ?? 0;
                  return (
                    <li key={table}>
                      <span className="text-ink">{TABLE_LABELS_FA[table] ?? table}: </span>
                      {added > 0 && <span className="text-accent">{added.toLocaleString("fa-IR")} مورد اضافه شد</span>}
                      {added > 0 && skipped > 0 && "، "}
                      {skipped > 0 && <span>{skipped.toLocaleString("fa-IR")} مورد از قبل موجود بود</span>}
                      {(added > 0 || skipped > 0) && errors > 0 && "، "}
                      {errors > 0 && <span className="text-waste">{errors.toLocaleString("fa-IR")} مورد با خطا مواجه شد</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-ink text-sm">وارد کردن رویدادها از گوگل‌کلندر</h2>
        <p className="text-xs text-muted leading-relaxed">
          از گوگل‌کلندر (تنظیمات ← Import &amp; export ← Export) یک فایل با پسوند .ics بگیرید و اینجا انتخاب کنید. رویدادهای تکرارشونده ساده
          (روزانه، هفتگی، ماهانه، سالانه) هم پشتیبانی می‌شوند. این کار فقط رویداد اضافه می‌کند — چیزی را جایگزین یا حذف نمی‌کند.
        </p>
        <label className="inline-block rounded-xl bg-canvas text-ink px-4 py-2 text-sm font-medium cursor-pointer hover:bg-line">
          انتخاب فایل .ics
          <input type="file" accept=".ics,text/calendar" onChange={handleIcsFileSelected} className="hidden" />
        </label>
        {icsError && <p className="text-xs text-waste">{icsError}</p>}

        {icsPreview && (
          <div className="rounded-xl bg-accent-soft border border-accent p-4 space-y-3">
            <p className="text-sm text-accent">
              {toPersianDigits(icsPreview.length)} رویداد توی این فایل پیدا شد. مواردی که از قبل با همین عنوان و زمان روی این گوشی وجود داشته باشند
              نادیده گرفته می‌شوند.
            </p>
            <ul className="text-xs text-ink space-y-1 max-h-40 overflow-y-auto">
              {icsPreview.slice(0, 8).map((ev, i) => (
                <li key={i} className="truncate">
                  {ev.title} — {formatJalali(ev.startAt)}
                </li>
              ))}
              {icsPreview.length > 8 && <li className="text-muted">و {toPersianDigits(icsPreview.length - 8)} مورد دیگر...</li>}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmIcsImport}
                disabled={icsImporting}
                className="flex-1 rounded-xl bg-accent text-on-accent py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {icsImporting ? "در حال وارد کردن..." : "تأیید و وارد کردن"}
              </button>
              <button
                type="button"
                onClick={() => setIcsPreview(null)}
                disabled={icsImporting}
                className="flex-1 rounded-xl bg-canvas text-ink py-2 text-sm"
              >
                انصراف
              </button>
            </div>
          </div>
        )}

        {icsResult && (
          <div className="rounded-xl bg-canvas border border-line p-4">
            <p className="text-xs text-ink">
              {icsResult.added > 0 && <span className="text-accent">{toPersianDigits(icsResult.added)} رویداد اضافه شد</span>}
              {icsResult.added > 0 && icsResult.skipped > 0 && "، "}
              {icsResult.skipped > 0 && <span>{toPersianDigits(icsResult.skipped)} مورد از قبل موجود بود</span>}
              {icsResult.added === 0 && icsResult.skipped === 0 && "هیچ رویدادی اضافه نشد."}
            </p>
          </div>
        )}
      </Card>

      <DiagnosticReportCard />
    </div>
  );
}

const WIDGET_COLOR_KEY = "widget_theme_color";
const WIDGET_OPACITY_KEY = "widget_theme_opacity";
const DEFAULT_WIDGET_COLOR = "#0e5f54";
const DEFAULT_WIDGET_OPACITY = 85;

// Background theming for the four home-screen widgets (see the four *WidgetProvider.java files)
// — a solid color behind a bit of transparency, not a real backdrop blur: classic RemoteViews
// (what Android widgets render through) has no API for blurring whatever sits behind the widget on
// the launcher, only for the widget's own background color/alpha. The text on top picks itself: a
// neutral white or near-black, whichever stays readable on the chosen color (and, for a
// see-through background, over any wallpaper) — WidgetTheme.java implements the same rule as
// pickWidgetTextTone (src/lib/widgetContrast.ts), which also drives the preview below.
function WidgetsTab() {
  const [color, setColor] = useState(DEFAULT_WIDGET_COLOR);
  const [opacity, setOpacity] = useState(DEFAULT_WIDGET_OPACITY);
  const [customized, setCustomized] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const [storedColor, storedOpacity] = await Promise.all([
        Preferences.get({ key: WIDGET_COLOR_KEY }),
        Preferences.get({ key: WIDGET_OPACITY_KEY }),
      ]);
      if (storedColor.value) setColor(storedColor.value);
      if (storedOpacity.value) setOpacity(Number(storedOpacity.value));
      setCustomized(Boolean(storedColor.value || storedOpacity.value));
    })();
  }, []);

  async function save() {
    await Promise.all([
      Preferences.set({ key: WIDGET_COLOR_KEY, value: color }),
      Preferences.set({ key: WIDGET_OPACITY_KEY, value: String(opacity) }),
    ]);
    setCustomized(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    requestWidgetRefresh(); // repaint the placed widgets now instead of at the next background/timer tick
  }

  async function resetToDefault() {
    await Promise.all([Preferences.remove({ key: WIDGET_COLOR_KEY }), Preferences.remove({ key: WIDGET_OPACITY_KEY })]);
    setColor(DEFAULT_WIDGET_COLOR);
    setOpacity(DEFAULT_WIDGET_OPACITY);
    setCustomized(false);
    requestWidgetRefresh();
  }

  // The phone's own light/dark mode only breaks a tie for a fully transparent widget.
  const prefersDark = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const previewTextColor = widgetTextColor(pickWidgetTextTone(color, opacity, prefersDark));

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-bold text-ink text-sm">رنگ و شفافیت ویجت‌ها</h2>
        <p className="text-xs text-muted leading-relaxed mt-1">
          روی پس‌زمینهٔ هر چهار ویجت صفحهٔ اصلی (ثبت سریع، عادت‌ها، رویدادهای امروز، سرمایه) اعمال می‌شود. برای دیدن تغییر، به صفحهٔ اصلی گوشی برگردید.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="bg-surface w-12 h-12 rounded-xl border border-line cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted mb-1">رنگ</p>
          <p className="text-sm text-ink font-mono" dir="ltr">{color}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted">شفافیت پس‌زمینه</p>
          <p className="text-xs text-ink font-medium" dir="ltr">{toPersianDigits(opacity)}٪</p>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="w-full"
          dir="ltr"
        />
      </div>

      <div className="rounded-2xl border border-line h-20 flex items-center justify-center text-xs font-medium" style={{ backgroundColor: `${color}${Math.round((opacity / 100) * 255).toString(16).padStart(2, "0")}`, color: previewTextColor }}>
        پیش‌نمایش تقریبی — رنگ نوشته خودکار انتخاب می‌شود
      </div>

      <div className="flex gap-2">
        <button onClick={save} className="flex-1 rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium hover:opacity-90">
          {saved ? "ذخیره شد" : "ذخیره"}
        </button>
        {customized && (
          <button onClick={resetToDefault} className="rounded-xl border border-line text-muted px-4 py-2.5 text-sm hover:bg-canvas">
            بازگشت به پیش‌فرض
          </button>
        )}
      </div>
    </Card>
  );
}

"use client";

import { useState, useEffect } from "react";
import useSWR, { mutate as mutateGlobal } from "swr";
import { fetcher, apiPatch, apiPost, apiDelete } from "@/lib/apiClient";
import { Card, EmptyState } from "@/components/ui/Card";
import { formatJalali } from "@/lib/jalali";
import { computeHourlyValue } from "@/lib/hourlyValue";
import { toPersianDigits } from "@/lib/money";
import { CATEGORY_KINDS, CATEGORY_KIND_LABELS, type CategoryKind, VALUE_TYPES, VALUE_TYPE_LABELS, type ValueType, CURRENCY_UNITS, CURRENCY_UNIT_LABELS, type CurrencyUnit } from "@/lib/types";
import { PlusIcon, TrashIcon } from "@/components/icons";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import MoneyInput from "@/components/ui/MoneyInput";
import { getLocalDbInstance } from "@/local/db";
import type { DataExportFile, DataExportTable, ImportResult } from "@/local/dataExport";

// Only shown once isNativePlatform() resolves true (see BackupTab) — a plain web session has
// no on-device database to export and no OS share sheet to hand a file to.
const TABS = [
  { key: "personal", label: "شخصی" },
  { key: "financial", label: "مالی" },
  { key: "categories", label: "دسته‌بندی‌ها" },
  { key: "history", label: "سابقه" },
  { key: "backup", label: "پشتیبان‌گیری" },
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

  const visibleTabs = native ? TABS : TABS.filter((t) => t.key !== "backup");

  return (
    <div className="px-4 py-6 space-y-4">
      <h1 className="text-lg font-bold text-gray-800">تنظیمات</h1>

      <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 text-sm px-3.5 py-1.5 rounded-full transition ${
              tab === t.key ? "bg-brand-600 text-white" : "bg-white border border-gray-200 text-gray-500"
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
      {tab === "backup" && <BackupTab />}
    </div>
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
      <div className="text-sm font-medium text-gray-700">{LICENSE_STATUS_LABELS[license.status] ?? license.status}</div>
      {license.status === "TRIAL" && license.trialDaysRemaining != null && (
        <div className="text-xs text-gray-400 mt-1">{license.trialDaysRemaining} روز از دوره‌ی رایگان باقی مانده</div>
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
      <h2 className="font-bold text-gray-800 text-sm">ارتقا عضویت</h2>

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
                className="rounded-xl border border-gray-200 p-3 text-center hover:border-brand-400 hover:bg-brand-50 transition"
              >
                <div className="text-sm font-bold text-gray-800">{plan.label}</div>
                <div className="text-xs text-gray-400 mt-1">{format(perMonth, { withSuffix: true })}/ماه</div>
                <div className="text-sm font-bold text-brand-600 mt-1.5">{format(plan.totalPrice, { withSuffix: true })}</div>
                <div className="mt-1.5 inline-block text-[11px] bg-brand-100 text-brand-700 rounded-full px-2 py-0.5">
                  {discountPercent}٪ تخفیف نسبت به پایه
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-brand-50 border border-brand-100 p-4 text-center space-y-1">
            <div className="text-2xl">🎉</div>
            <p className="text-sm font-bold text-brand-700">تبریک! پلن {selected.label} رو انتخاب کردید</p>
            <p className="text-xs text-brand-600">یک قدم دیگه تا فعال‌سازی اشتراکتون مونده.</p>
          </div>

          <div className="space-y-2 text-sm">
            <p className="text-gray-600">
              مبلغ <strong>{format(selected.totalPrice, { withSuffix: true })}</strong> رو به شماره کارت زیر واریز کنید:
            </p>
            {cardNumber ? (
              <>
                <div className="flex items-center gap-2">
                  <div dir="ltr" className="flex-1 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2.5 text-center font-mono tracking-wider text-gray-800">
                    {cardNumber}
                  </div>
                  <button
                    type="button"
                    onClick={copyCardNumber}
                    className="shrink-0 text-xs bg-gray-100 text-gray-600 px-3 py-2.5 rounded-xl hover:bg-gray-200"
                  >
                    {copied ? "کپی شد ✓" : "کپی"}
                  </button>
                </div>
                {(bankName || cardHolder) && (
                  <p className="text-xs text-gray-400 text-center">
                    {[bankName, cardHolder].filter(Boolean).join(" — به نام ")}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-waste-500">
                شماره کارت هنوز تنظیم نشده — NEXT_PUBLIC_PAYMENT_CARD_NUMBER رو در .env مقداردهی کنید.
              </p>
            )}
            <p className="text-gray-600">
              بعد از واریز، برای فعال‌سازی اشتراک در بله یا تلگرام به این آیدی پیام بدید:{" "}
              {contactId ? (
                <strong dir="ltr">{contactId}</strong>
              ) : (
                <span className="text-xs text-waste-500">(NEXT_PUBLIC_PAYMENT_CONTACT_ID تنظیم نشده)</span>
              )}
            </p>
          </div>

          <button type="button" onClick={() => setSelected(null)} className="w-full text-center text-xs text-gray-400 hover:text-gray-600">
            بازگشت به انتخاب پلن
          </button>
        </div>
      )}
    </Card>
  );
}

const HOURS_0_23 = Array.from({ length: 24 }, (_, h) => h);

function PersonalTab() {
  const { data, mutate } = useSWR<any>("/api/settings", fetcher);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Tehran");
  const [wakeHour, setWakeHour] = useState(7);
  const [sleepHour, setSleepHour] = useState(23);
  const [saved, setSaved] = useState(false);
  const { unit, setUnit } = useCurrencyUnit();

  async function toggleDailyQuote() {
    await apiPatch("/api/settings", { dailyQuoteEnabled: !data.settings.dailyQuoteEnabled });
    mutate();
  }

  useEffect(() => {
    if (data) {
      setName(data.user?.name ?? "");
      setTimezone(data.settings.timezone);
      setWakeHour(data.settings.wakeHour ?? 7);
      setSleepHour(data.settings.sleepHour ?? 23);
    }
  }, [data]);

  async function save() {
    await apiPatch("/api/settings", { name, timezone, wakeHour, sleepHour });
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
      <div>
        <label className="block text-sm text-gray-600 mb-1">نام</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">منطقه زمانی</label>
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" dir="ltr" />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">ساعت‌های بیداری</label>
        <div className="flex items-center gap-2">
          <select
            value={wakeHour}
            onChange={(e) => setWakeHour(Number(e.target.value))}
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
          >
            {HOURS_0_23.map((h) => (
              <option key={h} value={h}>
                {toPersianDigits(`${h}:00`)}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-400 shrink-0">تا</span>
          <select
            value={sleepHour}
            onChange={(e) => setSleepHour(Number(e.target.value))}
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
          >
            {HOURS_0_23.map((h) => (
              <option key={h} value={h}>
                {toPersianDigits(`${h}:00`)}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-gray-400 mt-1">ظرفیت نوار «روز» در صفحه اصلی بر همین بازه حساب می‌شود.</p>
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">واحد پول</label>
        <div className="flex gap-2">
          {CURRENCY_UNITS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u as CurrencyUnit)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                unit === u ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-500"
              }`}
            >
              {CURRENCY_UNIT_LABELS[u]}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">
          همه اعدادی که قبلاً ثبت کرده‌اید بر همین اساس نمایش داده می‌شوند — هر تومان = ۱۰ ریال و هر هزار تومان = ۱۰۰۰ تومان.
        </p>
      </div>
      <div className="text-sm text-gray-500">تقویم: شمسی</div>
      {data && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700">نمایش جمله روز</p>
            <p className="text-xs text-gray-400">فقط برای کاربران ویژه، در صفحه اصلی نشان داده می‌شود.</p>
          </div>
          <button
            type="button"
            onClick={toggleDailyQuote}
            className={`relative w-10 h-[22px] rounded-full transition shrink-0 ${data.settings.dailyQuoteEnabled ? "bg-brand-500" : "bg-gray-300"}`}
            aria-label={data.settings.dailyQuoteEnabled ? "غیرفعال کردن جمله روز" : "فعال کردن جمله روز"}
          >
            <span
              className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition"
              style={{ [data.settings.dailyQuoteEnabled ? "left" : "right"]: "3px" }}
            />
          </button>
        </div>
      )}
      <button onClick={save} className="rounded-xl bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700">
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
        <label className="block text-sm text-gray-600 mb-1">حقوق ماهانه</label>
        <MoneyInput value={monthlyIncome} onChange={setMonthlyIncome} />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">ساعات کاری ماهانه</label>
        <input type="number" dir="ltr" value={workingHoursMonth} onChange={(e) => setWorkingHoursMonth(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-right" />
      </div>
      <div>
        <label className="block text-sm text-gray-600 mb-1">ارزش هر ساعت (تنظیم دستی، اختیاری)</label>
        <MoneyInput value={hourlyValueOverride} onChange={setHourlyValueOverride} />
      </div>
      <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">
        ارزش هر ساعت شما: <strong>{format(previewHourlyValue, { withSuffix: true })}</strong>
      </div>
      <button onClick={save} className="rounded-xl bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700">
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
  const [editingRateFor, setEditingRateFor] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState("350000");
  const { format } = useCurrencyUnit();

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await apiPost("/api/categories", { name, kind, valueType, icon });
    setName("");
    setShowForm(false);
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

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        برای هر دسته‌بندی مشخص کنید «هزینه» یا «دارایی» است — همین انتخاب در فرم ثبت کار روی صفحه اصلی پیش‌فرض می‌شود.
      </p>

      <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1 text-sm bg-brand-600 text-white px-3 py-2 rounded-xl hover:bg-brand-700">
        <PlusIcon className="w-4 h-4" />
        دسته‌بندی جدید
      </button>

      {showForm && (
        <Card className="p-4">
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <input value={icon} onChange={(e) => setIcon(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-center" />
              <input className="col-span-2 rounded-xl border border-gray-200 px-3 py-2 text-sm" required value={name} onChange={(e) => setName(e.target.value)} placeholder="نام دسته‌بندی" />
            </div>
            <select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">
              {CATEGORY_KINDS.map((k) => (
                <option key={k} value={k}>{CATEGORY_KIND_LABELS[k]}</option>
              ))}
            </select>
            <div className="flex gap-2">
              {VALUE_TYPES.map((v) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => setValueType(v)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                    valueType === v ? "bg-brand-100 text-brand-700 border border-brand-300" : "bg-gray-50 text-gray-500 border border-transparent"
                  }`}
                >
                  {VALUE_TYPE_LABELS[v]}
                </button>
              ))}
            </div>
            <button type="submit" className="w-full rounded-xl bg-brand-600 text-white py-2 text-sm font-medium">ثبت</button>
          </form>
        </Card>
      )}

      <Card>
        {data?.categories.length === 0 ? (
          <EmptyState message="دسته‌بندی‌ای وجود ندارد." />
        ) : (
          <ul className="divide-y divide-gray-50">
            {data?.categories.map((c) => (
              <li key={c.id} className={`px-4 py-3 space-y-2 ${!c.isActive ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-3">
                  <span className="text-lg">{c.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">{c.name}</p>
                    <p className="text-xs text-gray-400">{CATEGORY_KIND_LABELS[c.kind as CategoryKind]}</p>
                  </div>
                  <button
                    onClick={() => toggleActive(c)}
                    className={`relative w-10 h-[22px] rounded-full transition shrink-0 ${c.isActive ? "bg-brand-500" : "bg-gray-300"}`}
                    aria-label={c.isActive ? "غیرفعال کردن" : "فعال کردن"}
                  >
                    <span
                      className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition"
                      style={{ [c.isActive ? "left" : "right"]: "3px" }}
                    />
                  </button>
                  <button onClick={() => remove(c.id)} className="text-gray-300 hover:text-waste-500 p-1 shrink-0">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 pr-9">
                  {VALUE_TYPES.map((v) => (
                    <button
                      key={v}
                      onClick={() => setCategoryValueType(c, v)}
                      className={`text-xs px-2.5 py-1 rounded-lg ${
                        c.valueType === v ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-500"
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
                      c.generatesVirtualAsset ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    دارایی مجازی {c.generatesVirtualAsset ? `(${format(c.virtualAssetValuePerHour, { withSuffix: true })}/س)` : "خاموش"}
                  </button>
                </div>
                {editingRateFor === c.id && (
                  <div className="flex items-center gap-2 pr-9">
                    <MoneyInput value={rateInput} onChange={setRateInput} placeholder="ارزش هر ساعت" autoFocus />
                    <button onClick={() => saveVirtualAssetRate(c.id)} className="text-xs bg-brand-600 text-white px-3 py-1.5 rounded-lg shrink-0">
                      ثبت
                    </button>
                    <button onClick={() => setEditingRateFor(null)} className="text-xs text-gray-400 shrink-0">
                      انصراف
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function HistoryTab() {
  const { data } = useSWR<{ logs: any[] }>("/api/audit-logs", fetcher);

  return (
    <Card>
      {!data ? (
        <p className="text-sm text-gray-400 text-center py-8">در حال بارگذاری...</p>
      ) : data.logs.length === 0 ? (
        <EmptyState message="هنوز رخدادی ثبت نشده." />
      ) : (
        <ul className="divide-y divide-gray-50 max-h-[32rem] overflow-y-auto scrollbar-thin">
          {data.logs.map((log) => (
            <li key={log.id} className="px-4 py-2.5 text-sm flex items-center justify-between">
              <span className="text-gray-700">
                {AUDIT_ACTION_LABELS[log.action] ?? log.action} · {log.entityType}
              </span>
              <span className="text-xs text-gray-400">{formatJalali(new Date(log.createdAt), { withTime: true })}</span>
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
const TABLE_LABELS_FA: Partial<Record<DataExportTable, string>> = {
  User: "کاربر",
  Settings: "تنظیمات",
  Project: "پروژه",
  Category: "دسته‌بندی",
  Task: "کار",
  Habit: "عادت",
  Activity: "فعالیت",
  HabitCheckIn: "چک‌این عادت",
  TimeEntry: "بازه زمانی",
  FinanceAccount: "حساب مالی",
  Asset: "دارایی",
  AssetTransaction: "تراکنش دارایی",
  InstallmentPlan: "طرح قسط",
  Installment: "قسط",
  Event: "رویداد",
  EventCompletion: "تکمیل رویداد",
  VirtualAssetEntry: "دارایی مجازی",
  Transaction: "تراکنش مالی",
  Reminder: "یادآور",
  AuditLog: "سابقه فعالیت",
  Notification: "اعلان",
};

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

      const data = exportAllData(db);
      const json = JSON.stringify(data, null, 2);
      const filename = `panhan-backup-${new Date().toISOString().slice(0, 10)}.json`;

      // Same Filesystem.writeFile + Directory.Documents pattern already used for the per-entity
      // CSV export (see src/app/(app)/reports/page.tsx) — plain UTF8 text, no base64 needed.
      await Filesystem.writeFile({ path: filename, data: json, directory: Directory.Documents, encoding: Encoding.UTF8 });
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Documents });
      // `files` (not `url`) is @capacitor/share's option for a local file:// attachment — see
      // node_modules/@capacitor/share's ShareOptions — so Telegram/email/etc. in the resulting
      // share sheet receive the actual file, not just a path string.
      await Share.share({ title: "پشتیبان اطلاعات پنهان", dialogTitle: "ارسال فایل پشتیبان", files: [uri] });

      setExportMessage(`فایل پشتیبان ساخته شد و در پوشه Documents ذخیره شد (${filename}).`);
    } catch (err) {
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
      const result = importAllData(db, pendingImport.file);
      setImportResult(result);
      setPendingImport(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "وارد کردن اطلاعات با خطا مواجه شد.");
    } finally {
      setImporting(false);
    }
  }

  const resultTables = importResult
    ? ([...new Set([...Object.keys(importResult.added), ...Object.keys(importResult.skipped), ...Object.keys(importResult.errors)])] as DataExportTable[])
    : [];

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-gray-800 text-sm">خروجی گرفتن از همه اطلاعات</h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          یک فایل شامل تمام اطلاعات شما (کارها، فعالیت‌ها، تراکنش‌ها، عادت‌ها و ...) می‌سازد تا آن را از طریق تلگرام، ایمیل، فضای ابری یا هر روش دیگری به گوشی جدید منتقل کنید.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="rounded-xl bg-brand-600 text-white px-4 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-40"
        >
          {exporting ? "در حال ساخت فایل..." : "ساخت و اشتراک‌گذاری فایل پشتیبان"}
        </button>
        {exportMessage && <p className="text-xs text-brand-600">{exportMessage}</p>}
        {exportError && <p className="text-xs text-waste-500">{exportError}</p>}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-bold text-gray-800 text-sm">وارد کردن اطلاعات از فایل پشتیبان</h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          فایل پشتیبانی که قبلاً از گوشی دیگر ساخته‌اید را انتخاب کنید. این کار فقط اطلاعات جدید را اضافه می‌کند — چیزی را جایگزین یا حذف نمی‌کند.
        </p>
        <label className="inline-block rounded-xl bg-gray-100 text-gray-700 px-4 py-2 text-sm font-medium cursor-pointer hover:bg-gray-200">
          انتخاب فایل پشتیبان
          <input type="file" accept="application/json,.json" onChange={handleFileSelected} className="hidden" />
        </label>
        {importError && <p className="text-xs text-waste-500">{importError}</p>}

        {pendingImport && (
          <div className="rounded-xl bg-brand-50 border border-brand-100 p-4 space-y-3">
            <p className="text-sm text-brand-700">
              این فایل شامل موارد زیر است — مواردی که از قبل روی این گوشی وجود داشته باشند نادیده گرفته می‌شوند:
            </p>
            <ul className="text-xs text-gray-600 space-y-1">
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
                className="flex-1 rounded-xl bg-brand-600 text-white py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-40"
              >
                {importing ? "در حال وارد کردن..." : "تأیید و وارد کردن"}
              </button>
              <button
                type="button"
                onClick={() => setPendingImport(null)}
                disabled={importing}
                className="flex-1 rounded-xl bg-gray-100 text-gray-600 py-2 text-sm"
              >
                انصراف
              </button>
            </div>
          </div>
        )}

        {importResult && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2">
            <p className="text-sm text-gray-700 font-medium">نتیجه وارد کردن اطلاعات:</p>
            {resultTables.length === 0 ? (
              <p className="text-xs text-gray-400">هیچ داده‌ی جدیدی برای اضافه کردن پیدا نشد.</p>
            ) : (
              <ul className="text-xs text-gray-600 space-y-1">
                {resultTables.map((table) => {
                  const added = importResult.added[table] ?? 0;
                  const skipped = importResult.skipped[table] ?? 0;
                  const errors = importResult.errors[table] ?? 0;
                  return (
                    <li key={table}>
                      <span className="text-gray-700">{TABLE_LABELS_FA[table] ?? table}: </span>
                      {added > 0 && <span className="text-brand-600">{added.toLocaleString("fa-IR")} مورد اضافه شد</span>}
                      {added > 0 && skipped > 0 && "، "}
                      {skipped > 0 && <span>{skipped.toLocaleString("fa-IR")} مورد از قبل موجود بود</span>}
                      {(added > 0 || skipped > 0) && errors > 0 && "، "}
                      {errors > 0 && <span className="text-waste-500">{errors.toLocaleString("fa-IR")} مورد با خطا مواجه شد</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

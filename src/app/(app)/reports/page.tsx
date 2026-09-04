"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { Card, StatItem, EmptyState } from "@/components/ui/Card";
import { formatDuration, truncateLabel, toPersianDigits } from "@/lib/money";
import { formatJalali, formatJalaliMonthYear, toJalali } from "@/lib/jalali";
import { getJalaliMonthGrid, addJalaliMonths, dayKeyIso } from "@/lib/calendarGrid";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts";
import HabitAdherenceChart from "@/components/habits/HabitAdherenceChart";
import { FlameIcon, ChevronRightIcon, ChevronLeftIcon } from "@/components/icons";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import DeltaChip, { type DeltaPolarity } from "@/components/DeltaChip";
import { phraseDeltaPride, phraseSamePeriodTasksCompleted, phraseSamePeriodVirtualAsset } from "@/lib/phrasing";

// The only comparison this product ever shows (its own past period — see comparePeriods). Each
// entry's polarity says which direction is "good"; totalMinutes carries no polarity — logging
// more or less total time isn't inherently good or bad — so it's excluded from the pride search
// below, though it still gets a DeltaChip (rendered neutral) next to its own stat.
const COMPARISON_METRICS: { reportKey: string; label: string; polarity: DeltaPolarity }[] = [
  { reportKey: "totalDurationMin", label: "کل زمان", polarity: "neutral" },
  { reportKey: "productiveMin", label: "زمان مفید", polarity: "higherIsBetter" },
  { reportKey: "expense", label: "هزینه", polarity: "lowerIsBetter" },
  { reportKey: "timeCost", label: "هزینه زمانی", polarity: "lowerIsBetter" },
  { reportKey: "virtualAssetValue", label: "دارایی مجازی", polarity: "higherIsBetter" },
  { reportKey: "net", label: "سود خالص", polarity: "higherIsBetter" },
];

/**
 * Pain→path→pride for the reports page: if any of the metrics above moved the "bad" way this
 * period, this line makes sure the page doesn't end on that. Names the metric with the strongest
 * real improvement; if nothing improved, falls back to an absolute (non-comparative) achievement
 * from the same period — never fabricates a positive spin when there genuinely isn't one, and
 * returns null (rendering nothing) rather than force a claim that isn't there.
 */
function computePrideLine(comparison: any): string | null {
  if (!comparison?.hasEnoughHistory) return null;
  const { current, previous } = comparison;

  let best: { label: string; percent: number; direction: "increased" | "decreased" } | null = null;
  for (const m of COMPARISON_METRICS) {
    if (m.polarity === "neutral") continue;
    const prev = previous[m.reportKey];
    const cur = current[m.reportKey];
    if (!prev) continue;
    const percent = ((cur - prev) / Math.abs(prev)) * 100;
    const isGood = m.polarity === "higherIsBetter" ? percent > 0 : percent < 0;
    if (!isGood) continue;
    if (!best || Math.abs(percent) > Math.abs(best.percent)) {
      best = { label: m.label, percent, direction: percent > 0 ? "increased" : "decreased" };
    }
  }
  if (best) return phraseDeltaPride(best.label, best.percent, best.direction);

  if (current.tasksCompleted > 0) return phraseSamePeriodTasksCompleted(current.tasksCompleted);
  if (current.virtualAssetValue > 0) return phraseSamePeriodVirtualAsset(current.virtualAssetValue);
  return null;
}

const PRESETS = [
  { key: "today", label: "امروز" },
  { key: "week", label: "این هفته" },
  { key: "month", label: "این ماه" },
  { key: "lastMonth", label: "ماه گذشته" },
  { key: "year", label: "امسال" },
];

const REPORT_TABS = [
  { key: "summary", label: "خلاصه" },
  { key: "hiddenCost", label: "هزینه پنهان" },
  { key: "habits", label: "عادت‌ها" },
  { key: "categoryCalendar", label: "تقویم دسته‌بندی‌ها" },
] as const;

export default function ReportsPage() {
  const router = useRouter();
  const [preset, setPreset] = useState("month");
  const [tab, setTab] = useState<(typeof REPORT_TABS)[number]["key"]>("summary");
  const { data } = useSWR<any>(`/api/reports?preset=${preset}`, fetcher);
  const { format } = useCurrencyUnit();

  // window.open(..., "_blank") — the old approach — targets a real browser tab, which doesn't
  // exist inside the Capacitor WebView; there it silently fails to navigate anywhere useful and
  // the SPA's own router falls back to "/". Both exports below branch on platform instead of
  // relying on browser-only APIs.
  async function exportCsv(entity: string) {
    const isNative = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    const filename = `${entity}.csv`;
    try {
      let csv: string;
      if (isNative) {
        const { dispatchLocal } = await import("@/lib/localDispatcher");
        const res = dispatchLocal("GET", `/api/export/${entity}`);
        if (res.status >= 400) throw new Error((res.json as { error?: string })?.error ?? `HTTP ${res.status}`);
        csv = res.json as string;
      } else {
        const res = await fetch(`/api/export/${entity}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        csv = await res.text();
      }

      if (isNative) {
        // Same Filesystem.writeFile + getUri + Share.share pattern already proven working for
        // the full-data backup export (see settings/page.tsx's BackupTab) — a plain alert() here
        // before gave no way to actually get the file off the device, and (being un-caught)
        // silently swallowed any real error too.
        const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
        await Filesystem.writeFile({ path: filename, data: csv, directory: Directory.Documents, encoding: Encoding.UTF8 });
        const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Documents });
        await Share.share({ title: filename, dialogTitle: "ارسال فایل خروجی", files: [uri] });
      } else {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      alert(`خروجی گرفتن ناموفق بود: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function exportPdf() {
    // jsPDF can't shape/reverse Persian (Arabic-script) text correctly — it renders as
    // disconnected, wrong-order letters. A real HTML report + the browser's native
    // print-to-PDF renders Persian perfectly since it's genuine text layout, not a
    // font-embedding workaround. See src/app/print/report/page.tsx. Plain in-app navigation
    // (not window.open) since there's no separate browser tab inside the Capacitor WebView.
    router.push(`/print/report?preset=${preset}`);
  }

  const timeColors = ["#2c7166", "#57a89c", "#b0a24a", "#c95a4c", "#8a7ac9", "#8a8a8a"];

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-gray-800">گزارش‌ها</h1>
        <div className="flex gap-2">
          <button onClick={() => exportCsv("transactions")} className="text-xs bg-gray-100 px-3 py-1.5 rounded-lg text-gray-600">CSV مالی</button>
          <button onClick={() => exportCsv("activities")} className="text-xs bg-gray-100 px-3 py-1.5 rounded-lg text-gray-600">CSV فعالیت‌ها</button>
          <button onClick={exportPdf} className="text-xs bg-brand-600 text-white px-3 py-1.5 rounded-lg">خروجی PDF</button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        {tab !== "categoryCalendar" && (
          <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`shrink-0 text-sm px-3.5 py-1.5 rounded-full transition ${
                  preset === p.key ? "bg-brand-600 text-white" : "bg-white border border-gray-200 text-gray-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          {REPORT_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-sm px-3.5 py-1.5 rounded-full transition ${
                tab === t.key ? "bg-brand-100 text-brand-700 border border-brand-300" : "bg-white border border-gray-200 text-gray-500"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "categoryCalendar" ? (
        <CategoryCalendarTab />
      ) : !data ? (
        <p className="text-sm text-gray-400 text-center py-10">در حال بارگذاری...</p>
      ) : tab === "summary" ? (
        <>
          <Card className="p-5">
            <h3 className="font-bold text-gray-800 text-sm mb-2">خلاصه</h3>
            <p className="text-sm text-gray-600 leading-7">{data.narrative}</p>
          </Card>

          <div className="grid grid-cols-1 gap-4">
            <Card className="p-5">
              <h3 className="font-bold text-gray-800 text-sm mb-3">زمان</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <StatItem
                  label="کل زمان"
                  value={formatDuration(data.report.totalDurationMin)}
                  extra={data.comparison?.hasEnoughHistory && <DeltaChip current={data.report.totalDurationMin} previous={data.comparison.previous.totalDurationMin} polarity="neutral" />}
                />
                <StatItem
                  label="زمان مفید"
                  value={formatDuration(data.report.productiveMin)}
                  tone="positive"
                  extra={data.comparison?.hasEnoughHistory && <DeltaChip current={data.report.productiveMin} previous={data.comparison.previous.productiveMin} polarity="higherIsBetter" />}
                />
                <StatItem label="زمان هدررفته" value={formatDuration(data.report.wasteMin)} tone="negative" />
                <StatItem label="نسبت مفید بودن" value={`${Math.round(data.report.productiveRatio * 100)}٪`} />
              </div>
              {data.report.timeByCategory.length > 0 && (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={data.report.timeByCategory} dataKey="minutes" nameKey="name" innerRadius={40} outerRadius={70}>
                      {data.report.timeByCategory.map((entry: any, i: number) => (
                        <Cell key={entry.categoryId} fill={entry.color || timeColors[i % timeColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatDuration(v)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="font-bold text-gray-800 text-sm mb-3">مالی</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <StatItem label="درآمد" value={format(data.report.income, { withSuffix: true })} tone="positive" />
                <StatItem
                  label="هزینه"
                  value={format(data.report.expense, { withSuffix: true })}
                  tone="negative"
                  extra={data.comparison?.hasEnoughHistory && <DeltaChip current={data.report.expense} previous={data.comparison.previous.expense} polarity="lowerIsBetter" />}
                />
                <StatItem
                  label="هزینه زمانی"
                  value={format(data.report.timeCost, { withSuffix: true })}
                  extra={data.comparison?.hasEnoughHistory && <DeltaChip current={data.report.timeCost} previous={data.comparison.previous.timeCost} polarity="lowerIsBetter" />}
                />
                <StatItem label="هزینه واقعی" value={format(data.report.realCost, { withSuffix: true })} tone="negative" />
                <StatItem
                  label="سود خالص"
                  value={format(data.report.net, { withSuffix: true })}
                  tone={data.report.net >= 0 ? "positive" : "negative"}
                  extra={data.comparison?.hasEnoughHistory && <DeltaChip current={data.report.net} previous={data.comparison.previous.net} polarity="higherIsBetter" />}
                />
                <StatItem
                  label="دارایی مجازی"
                  value={format(data.report.virtualAssetValue, { withSuffix: true })}
                  tone="positive"
                  extra={data.comparison?.hasEnoughHistory && <DeltaChip current={data.report.virtualAssetValue} previous={data.comparison.previous.virtualAssetValue} polarity="higherIsBetter" />}
                />
              </div>
              {data.report.expenseByCategory.length > 0 && (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={data.report.expenseByCategory} dataKey="amount" nameKey="name" innerRadius={40} outerRadius={70}>
                      {data.report.expenseByCategory.map((entry: any, i: number) => (
                        <Cell key={entry.categoryId} fill={entry.color || timeColors[i % timeColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => format(v, { withSuffix: true })} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {(() => {
            const prideLine = computePrideLine(data.comparison);
            return prideLine ? (
              <Card className="p-4">
                <p className="text-sm text-brand-700">{prideLine}</p>
              </Card>
            ) : null;
          })()}

          <Card className="p-5">
            <h3 className="font-bold text-gray-800 text-sm mb-3">هزینه فرصت زمان‌های اتلافی</h3>
            <p className="text-sm text-gray-600">
              در این بازه <strong>{formatDuration(data.report.wasteMin)}</strong> در فعالیت‌های اتلاف‌وقت سپری شده که معادل{" "}
              <strong className="text-waste-600">{format(data.report.opportunityCost, { withSuffix: true })}</strong> هزینه فرصت است. این عدد
              هزینه‌ای که پرداخت شده نیست، بلکه ارزش زمانی است که می‌توانست صرف کارهای دیگر شود.
            </p>
          </Card>

          {data.habitsReport && data.habitsReport.habits.length > 0 && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-bold text-gray-800 text-sm">دارایی دیجیتال از عادت‌ها</h3>
                <span className="flex items-center gap-1 text-xs text-amber-600">
                  <FlameIcon className="w-3.5 h-3.5" />
                  {toPersianDigits(data.habitsReport.currentStreak)} روز استریک
                </span>
              </div>
              <p className="text-lg font-bold text-brand-700 mt-2">{format(data.habitsReport.digitalAssetTotal, { withSuffix: true })}</p>
            </Card>
          )}

          {data.report.timeByProject.length > 0 && (
            <Card className="p-5">
              <h3 className="font-bold text-gray-800 text-sm mb-3">زمان بر اساس پروژه</h3>
              <ResponsiveContainer width="100%" height={Math.max(120, data.report.timeByProject.length * 44)}>
                <BarChart
                  data={data.report.timeByProject.map((p: any) => ({ ...p, shortName: truncateLabel(p.name, 16) }))}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="shortName"
                    width={110}
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    interval={0}
                  />
                  <Tooltip
                    formatter={(v: number) => formatDuration(v)}
                    labelFormatter={(_label, payload) => payload?.[0]?.payload?.name ?? _label}
                  />
                  <Bar dataKey="minutes" fill="#3a8d80" radius={[4, 4, 4, 4]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </>
      ) : tab === "hiddenCost" ? (
        <HiddenCostTab hiddenCost={data.hiddenCost} />
      ) : (
        <HabitsTab habitsReport={data.habitsReport} />
      )}
    </div>
  );
}

function HabitsTab({ habitsReport }: { habitsReport: any }) {
  const { format } = useCurrencyUnit();
  if (!habitsReport || habitsReport.habits.length === 0) {
    return (
      <Card>
        <EmptyState message="هنوز عادتی نساخته‌اید." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <HabitAdherenceChart series={habitsReport.series} currentStreak={habitsReport.currentStreak} defaultOpen />
      </Card>

      <Card>
        <ul className="divide-y divide-gray-50">
          {habitsReport.habits.map((h: any) => (
            <li key={h.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 flex items-center gap-2">
                <span className="shrink-0">{h.icon || "🔥"}</span>
                <div className="min-w-0">
                  <p className={`text-sm truncate ${h.isActive ? "text-gray-800" : "text-gray-400"}`}>{h.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {h.currentStreak > 0 ? `${toPersianDigits(h.currentStreak)} روز پشت‌سرهم` : `${toPersianDigits(h.daysSinceLastCheckIn)} روز از آخرین تیک`}
                  </p>
                </div>
              </div>
              <span className="text-sm font-bold text-brand-700 shrink-0">{format(h.virtualAssetValue, { withSuffix: true })}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function HiddenCostTab({ hiddenCost }: { hiddenCost: any }) {
  const { format } = useCurrencyUnit();
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-bold text-gray-800 text-sm mb-1">هزینه پنهان کارها و رویدادها</h3>
        <p className="text-xs text-gray-500 mb-4">
          مجموع هزینه مستقیمی که برای هر کار/رویداد ثبت کرده‌اید، به‌علاوه معادل تومانی زمانی که برای آن وارد کرده‌اید.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <StatItem label="هزینه مستقیم" value={format(hiddenCost.totalDirectCost, { withSuffix: true })} />
          <StatItem label="هزینه زمانی" value={format(hiddenCost.totalTimeCost, { withSuffix: true })} />
          <StatItem label="مجموع هزینه پنهان" value={format(hiddenCost.totalHiddenCost, { withSuffix: true })} tone="negative" />
        </div>
      </Card>

      <Card>
        {hiddenCost.items.length === 0 ? (
          <EmptyState message="در این بازه کار یا رویدادی با هزینه یا زمان ثبت‌شده وجود ندارد." />
        ) : (
          <ul className="divide-y divide-gray-50">
            {hiddenCost.items.map((item: any) => (
              <li key={`${item.entityType}-${item.id}`} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{item.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {item.entityType === "TASK" ? "کار" : "رویداد"}
                      {item.categoryName ? ` · ${item.categoryName}` : ""} · {formatJalali(new Date(item.date))}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-waste-600 shrink-0">{format(item.hiddenCost, { withSuffix: true })}</span>
                </div>
                {(item.directCost > 0 || item.timeCost > 0) && (
                  <div className="flex gap-3 mt-1.5 text-xs text-gray-400">
                    {item.directCost > 0 && <span>هزینه مستقیم: {format(item.directCost, { withSuffix: true })}</span>}
                    {item.timeCost > 0 && (
                      <span>
                        زمانی: {formatDuration(item.durationMin)} = {format(item.timeCost, { withSuffix: true })}
                      </span>
                    )}
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

const WEEKDAY_HEADERS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

/** Compact duration for a small calendar cell — "۴۵د" or "۲.۵س", not the full "X ساعت و Y دقیقه". */
function compactDuration(minutes: number): string {
  if (minutes < 60) return `${toPersianDigits(minutes)}د`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${toPersianDigits(hours)}س`;
}

function CategoryCalendarTab() {
  const [cursor, setCursor] = useState(new Date());
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const { jy, jm } = toJalali(cursor);
  const { data } = useSWR<{ categories: any[]; jy: number; jm: number }>(
    `/api/reports/category-calendar?jy=${jy}&jm=${jm}`,
    fetcher
  );

  function navigate(delta: number) {
    const { jy: ny, jm: nm } = addJalaliMonths(jy, jm, delta);
    setCursor(getJalaliMonthGrid(ny, nm)[8]); // a day safely inside the new month
  }

  const selected = data?.categories.find((c: any) => c.categoryId === selectedCategoryId) ?? null;
  const maxDayMinutes = selected ? Math.max(1, ...(Object.values(selected.days) as number[])) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-1">
        <button onClick={() => navigate(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <ChevronRightIcon className="w-4 h-4" />
        </button>
        <span className="text-sm text-gray-600 min-w-[7rem] text-center">{formatJalaliMonthYear(cursor)}</span>
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
      </div>

      <Card className="p-4">
        <p className="text-xs text-gray-500 mb-2">دسته‌بندی</p>
        {!data ? (
          <p className="text-sm text-gray-400">در حال بارگذاری...</p>
        ) : data.categories.length === 0 ? (
          <EmptyState message="هنوز دسته‌بندی‌ای نساخته‌اید." />
        ) : (
          <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
            {data.categories.map((c: any) => (
              <button
                key={c.categoryId}
                onClick={() => setSelectedCategoryId(selectedCategoryId === c.categoryId ? null : c.categoryId)}
                className={`shrink-0 flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition ${
                  selectedCategoryId === c.categoryId
                    ? "bg-brand-600 text-white border-brand-600"
                    : c.totalDays > 0
                      ? "bg-white text-gray-600 border-gray-200"
                      : "bg-white text-gray-300 border-gray-100"
                }`}
              >
                <span>{c.icon}</span>
                {c.name}
              </button>
            ))}
          </div>
        )}
      </Card>

      {!selected ? (
        <Card>
          <EmptyState message="یک دسته‌بندی را انتخاب کنید تا تقویم فعالیتش را ببینید." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <StatItem label="روزهای فعال این ماه" value={`${toPersianDigits(selected.totalDays)} روز`} />
            </Card>
            <Card className="p-4">
              <StatItem label="مجموع زمان این ماه" value={formatDuration(selected.totalMinutes)} tone="positive" />
            </Card>
          </div>

          <Card className="p-3">
            <div className="grid grid-cols-7 text-center text-xs text-gray-400 mb-2">
              {WEEKDAY_HEADERS.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {getJalaliMonthGrid(jy, jm).map((day) => {
                const { jm: dJm, jd } = toJalali(day);
                const inMonth = dJm === jm;
                const minutes = inMonth ? selected.days[dayKeyIso(day)] ?? 0 : 0;
                const intensity = minutes > 0 ? Math.min(1, minutes / maxDayMinutes) : 0;
                return (
                  <div
                    key={day.toISOString()}
                    className={`aspect-square rounded-xl border p-1.5 flex flex-col items-center justify-center gap-0.5 ${
                      !inMonth ? "bg-gray-50 border-transparent text-gray-300" : minutes > 0 ? "border-brand-200" : "bg-white border-gray-100"
                    }`}
                    style={minutes > 0 ? { backgroundColor: `rgba(28, 57, 187, ${0.12 + intensity * 0.55})` } : undefined}
                  >
                    <span className={`text-xs ${inMonth ? (minutes > 0 ? "text-brand-900 font-bold" : "text-gray-700") : "text-gray-300"}`}>
                      {toPersianDigits(jd)}
                    </span>
                    {minutes > 0 && <span className="text-[9px] text-brand-800">{compactDuration(minutes)}</span>}
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

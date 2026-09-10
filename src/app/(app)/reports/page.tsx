"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IBM_Plex_Mono } from "next/font/google";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { Card, StatItem, EmptyState } from "@/components/ui/Card";
import { formatDuration, truncateLabel, toPersianDigits } from "@/lib/money";
import { formatJalali, formatJalaliMonthYear, toJalali } from "@/lib/jalali";
import { getJalaliMonthGrid, addJalaliMonths, dayKeyIso } from "@/lib/calendarGrid";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts";
import HabitAdherenceChart from "@/components/habits/HabitAdherenceChart";
import { ChevronRightIcon, ChevronLeftIcon } from "@/components/icons";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import DeltaChip, { type DeltaPolarity } from "@/components/DeltaChip";
import { phraseDeltaPride, phraseSamePeriodTasksCompleted, phraseSamePeriodVirtualAsset } from "@/lib/phrasing";

// Scoped to this page only — the ledger/ring redesign's numbers read as bookkeeping entries
// (tabular, monospace) deliberately set apart from the Persian prose around them; the rest of
// the app keeps Vazirmatn's own numerals. See doc/theme-prompt.md's rebrand for the precedent of
// a page-scoped font decision documented at its point of use rather than assumed global.
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-plex-mono" });

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
  { key: "time", label: "زمان" },
  { key: "finance", label: "مالی" },
  { key: "habits", label: "عادت‌ها" },
  { key: "hiddenCost", label: "هزینه پنهان" },
  { key: "categoryCalendar", label: "تقویم دسته‌بندی‌ها" },
] as const;

const timeColors = ["#2c7166", "#57a89c", "#b0a24a", "#c95a4c", "#8a7ac9", "#8a8a8a"];

export default function ReportsPage() {
  const router = useRouter();
  const [preset, setPreset] = useState("month");
  const [tab, setTab] = useState<(typeof REPORT_TABS)[number]["key"]>("summary");
  const { data } = useSWR<any>(`/api/reports?preset=${preset}`, fetcher);

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
        csv = (res.json as { csv: string }).csv;
      } else {
        const res = await fetch(`/api/export/${entity}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        csv = await res.text();
      }

      if (isNative) {
        // Directory.Cache, not Documents — see settings/page.tsx's BackupTab for why: on a lot of
        // real devices the public Documents directory doesn't already exist, and writeFile fails
        // with "Missing parent directory" rather than creating it. Cache is always there and is
        // all a share-sheet handoff needs.
        const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
        await Filesystem.writeFile({ path: filename, data: csv, directory: Directory.Cache, encoding: Encoding.UTF8 });
        const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
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

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-ink">گزارش‌ها</h1>
        <div className="flex gap-2">
          <button onClick={() => exportCsv("transactions")} className="text-xs bg-canvas px-3 py-1.5 rounded-lg text-ink">CSV مالی</button>
          <button onClick={() => exportCsv("activities")} className="text-xs bg-canvas px-3 py-1.5 rounded-lg text-ink">CSV فعالیت‌ها</button>
          <button onClick={exportPdf} className="text-xs bg-accent text-on-accent px-3 py-1.5 rounded-lg">خروجی PDF</button>
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
                  preset === p.key ? "bg-accent text-on-accent" : "bg-surface border border-line text-muted"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-4 overflow-x-auto scrollbar-none border-b border-line">
          {REPORT_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative shrink-0 text-sm pb-2.5 transition ${tab === t.key ? "text-accent font-bold" : "text-muted"}`}
            >
              {t.label}
              {tab === t.key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent rounded-full" />}
            </button>
          ))}
        </div>
      </div>

      {tab === "categoryCalendar" ? (
        <CategoryCalendarTab />
      ) : !data ? (
        <p className="text-sm text-muted text-center py-10">در حال بارگذاری...</p>
      ) : tab === "summary" ? (
        <SummaryTab data={data} />
      ) : tab === "time" ? (
        <TimeTab data={data} />
      ) : tab === "finance" ? (
        <FinanceTab data={data} />
      ) : tab === "hiddenCost" ? (
        <HiddenCostTab hiddenCost={data.hiddenCost} />
      ) : (
        <HabitsTab habitsReport={data.habitsReport} />
      )}
    </div>
  );
}

// Deliberately Western digits + comma grouping, not toPersianDigits()/format() — this is the one
// section styled as a bookkeeping ledger (IBM Plex Mono, see plexMono above), and that font's
// "latin" subset has no Persian-numeral glyphs to render — mixing in toPersianDigits() here would
// silently fall back to a different font per-glyph and break the tabular alignment the ledger
// look depends on. Comparison text underneath each value stays in the app's normal Persian-digit
// voice (DeltaChip, computePrideLine) — only the primary figures get this treatment. Always full,
// exact Toman — the ledger shows one canonical unit regardless of the rial/thousand-toman display
// preference elsewhere in the app.
function ledgerMoney(toman: number): string {
  return Math.round(toman).toLocaleString("en-US");
}
function ledgerHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}
// formatJalali() always ends in toPersianDigits() — fine everywhere else, but the one spot this
// page uses a date (the ledger-head range) sits inside the mono treatment above, so it needs its
// own Western-digit formatting for the same reason ledgerMoney/ledgerHours do.
function ledgerDate(date: Date): string {
  const { jy, jm, jd } = toJalali(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

/** Arc path for a ring segment, measured clockwise from 12 o'clock so a 300deg sweep starting at
 * 210deg leaves a 60deg gap centered at the bottom — the same "open ring" the Parva logomark
 * itself draws, not a closed 360deg gauge borrowed from generic dashboards. */
function ringArcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const toXY = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
  };
  const [x1, y1] = toXY(startDeg);
  const [x2, y2] = toXY(startDeg + sweepDeg);
  const largeArc = sweepDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const RING_START_DEG = 210;
const RING_SWEEP_DEG = 300;

/** The month/summary tab's headline comparison — two open rings sharing one origin point, the
 * current period's arc reaching further around than the previous one's. Replaces a generic
 * line-chart sparkline with a shape that's actually this app's own (see the logo). */
function ComparisonRing({ current, previous, label }: { current: number; previous: number; label: string }) {
  const max = Math.max(current, previous, 1) * 1.2;
  const curSweep = RING_SWEEP_DEG * Math.min(1, current / max);
  const prevSweep = RING_SWEEP_DEG * Math.min(1, previous / max);

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-[132px] h-[132px] shrink-0">
        <svg viewBox="0 0 132 132" width="132" height="132">
          <path d={ringArcPath(66, 66, 60, RING_START_DEG, RING_SWEEP_DEG)} fill="none" stroke="rgb(var(--line))" strokeWidth="6" strokeLinecap="round" />
          <path d={ringArcPath(66, 66, 47, RING_START_DEG, RING_SWEEP_DEG)} fill="none" stroke="rgb(var(--line))" strokeWidth="10" strokeLinecap="round" />
          <path d={ringArcPath(66, 66, 60, RING_START_DEG, prevSweep)} fill="none" stroke="rgb(var(--muted))" strokeWidth="6" strokeLinecap="round" />
          <path d={ringArcPath(66, 66, 47, RING_START_DEG, curSweep)} fill="none" stroke="rgb(var(--accent))" strokeWidth="10" strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`${plexMono.className} text-xl font-bold text-ink`}>{ledgerHours(current)}</span>
          <span className="text-[10px] text-muted mt-0.5">{label}</span>
        </div>
      </div>
      <div className="text-xs space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
          <span className="text-muted">این بازه</span>
          <span className={`${plexMono.className} text-ink mr-auto`}>{ledgerHours(current)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-muted shrink-0" />
          <span className="text-muted">بازهٔ قبل</span>
          <span className={`${plexMono.className} text-ink mr-auto`}>{ledgerHours(previous)}</span>
        </div>
      </div>
    </div>
  );
}

function LedgerRow({
  index,
  label,
  value,
  wasteTone,
  current,
  previous,
  polarity,
}: {
  index: number;
  label: string;
  value: string;
  wasteTone?: boolean;
  current: number;
  previous: number | undefined;
  polarity: DeltaPolarity;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-line">
      <span className="text-[10px] text-muted/70 w-5 shrink-0">{String(index).padStart(2, "0")}</span>
      <span className="text-sm text-ink flex-1">{label}</span>
      <div className="text-left">
        <span className={`${plexMono.className} block text-sm font-semibold ${wasteTone ? "text-waste" : "text-ink"}`}>{value}</span>
        {previous !== undefined && (
          <span className="text-[11px]">
            <DeltaChip current={current} previous={previous} polarity={polarity} />
          </span>
        )}
      </div>
    </div>
  );
}

function SummaryTab({ data }: { data: any }) {
  const prideLine = computePrideLine(data.comparison);
  const cmp = data.comparison?.hasEnoughHistory ? data.comparison : null;

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between pb-3 border-b-2 border-ink">
        <h2 className="text-base font-extrabold text-ink">دفتر این بازه</h2>
        <span className={`${plexMono.className} text-xs text-muted`} dir="ltr">
          {ledgerDate(new Date(data.from))}–{ledgerDate(new Date(data.to))}
        </span>
      </div>

      <ComparisonRing current={data.report.productiveMin} previous={cmp?.previous.productiveMin ?? 0} label="زمان مفید" />

      {prideLine && (
        <blockquote className="border-r-2 border-accent pr-3.5 text-[13.5px] leading-8 text-ink">
          {prideLine}
        </blockquote>
      )}

      <div>
        <p className="text-[11px] font-bold text-muted mb-1">ثبت‌های این بازه</p>
        <div className="border-t border-line">
          <LedgerRow
            index={1}
            label="سود خالص"
            value={ledgerMoney(data.report.net)}
            current={data.report.net}
            previous={cmp?.previous.net}
            polarity="higherIsBetter"
          />
          <LedgerRow
            index={2}
            label="هزینه"
            value={ledgerMoney(data.report.expense)}
            wasteTone
            current={data.report.expense}
            previous={cmp?.previous.expense}
            polarity="lowerIsBetter"
          />
          <LedgerRow
            index={3}
            label="دارایی مجازی"
            value={ledgerMoney(data.report.virtualAssetValue)}
            current={data.report.virtualAssetValue}
            previous={cmp?.previous.virtualAssetValue}
            polarity="higherIsBetter"
          />
          <LedgerRow
            index={4}
            label="کارهای انجام‌شده"
            value={String(data.report.tasksCompleted)}
            current={data.report.tasksCompleted}
            previous={undefined}
            polarity="higherIsBetter"
          />
        </div>
      </div>
    </div>
  );
}

function TimeTab({ data }: { data: any }) {
  const cmp = data.comparison?.hasEnoughHistory ? data.comparison : null;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-bold text-ink text-sm mb-3">زمان</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <StatItem
            label="کل زمان"
            value={formatDuration(data.report.totalDurationMin)}
            extra={cmp && <DeltaChip current={data.report.totalDurationMin} previous={cmp.previous.totalDurationMin} polarity="neutral" />}
          />
          <StatItem
            label="زمان مفید"
            value={formatDuration(data.report.productiveMin)}
            tone="positive"
            extra={cmp && <DeltaChip current={data.report.productiveMin} previous={cmp.previous.productiveMin} polarity="higherIsBetter" />}
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
        <h3 className="font-bold text-ink text-sm mb-3">هزینه فرصت زمان‌های اتلافی</h3>
        <p className="text-sm text-ink">
          در این بازه <strong>{formatDuration(data.report.wasteMin)}</strong> در فعالیت‌های اتلاف‌وقت سپری شده که معادل{" "}
          <ByCurrency amount={data.report.opportunityCost} tone="text-waste" /> هزینه فرصت است. این عدد هزینه‌ای که پرداخت شده نیست، بلکه
          ارزش زمانی است که می‌توانست صرف کارهای دیگر شود.
        </p>
      </Card>

      {data.report.timeByProject.length > 0 && (
        <Card className="p-5">
          <h3 className="font-bold text-ink text-sm mb-3">زمان بر اساس پروژه</h3>
          <ResponsiveContainer width="100%" height={Math.max(120, data.report.timeByProject.length * 44)}>
            <BarChart data={data.report.timeByProject.map((p: any) => ({ ...p, shortName: truncateLabel(p.name, 16) }))} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="shortName" width={110} tick={{ fontSize: 12 }} tickLine={false} interval={0} />
              <Tooltip formatter={(v: number) => formatDuration(v)} labelFormatter={(_label, payload) => payload?.[0]?.payload?.name ?? _label} />
              <Bar dataKey="minutes" fill="#3a8d80" radius={[4, 4, 4, 4]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}

/** Tiny wrapper so TimeTab's opportunity-cost paragraph can call useCurrencyUnit() without
 * turning the whole paragraph into its own component just to format one inline amount. */
function ByCurrency({ amount, tone }: { amount: number; tone?: string }) {
  const { format } = useCurrencyUnit();
  return <strong className={tone}>{format(amount, { withSuffix: true })}</strong>;
}

function FinanceTab({ data }: { data: any }) {
  const { format } = useCurrencyUnit();
  const cmp = data.comparison?.hasEnoughHistory ? data.comparison : null;
  return (
    <Card className="p-5">
      <h3 className="font-bold text-ink text-sm mb-3">مالی</h3>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <StatItem label="درآمد" value={format(data.report.income, { withSuffix: true })} tone="positive" />
        <StatItem
          label="هزینه"
          value={format(data.report.expense, { withSuffix: true })}
          tone="negative"
          extra={cmp && <DeltaChip current={data.report.expense} previous={cmp.previous.expense} polarity="lowerIsBetter" />}
        />
        <StatItem
          label="هزینه زمانی"
          value={format(data.report.timeCost, { withSuffix: true })}
          extra={cmp && <DeltaChip current={data.report.timeCost} previous={cmp.previous.timeCost} polarity="lowerIsBetter" />}
        />
        <StatItem label="هزینه واقعی" value={format(data.report.realCost, { withSuffix: true })} tone="negative" />
        <StatItem
          label="سود خالص"
          value={format(data.report.net, { withSuffix: true })}
          tone={data.report.net >= 0 ? "positive" : "negative"}
          extra={cmp && <DeltaChip current={data.report.net} previous={cmp.previous.net} polarity="higherIsBetter" />}
        />
        <StatItem
          label="دارایی مجازی"
          value={format(data.report.virtualAssetValue, { withSuffix: true })}
          tone="positive"
          extra={cmp && <DeltaChip current={data.report.virtualAssetValue} previous={cmp.previous.virtualAssetValue} polarity="higherIsBetter" />}
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
        <h3 className="font-bold text-ink text-sm mb-1">دارایی دیجیتال از عادت‌ها</h3>
        <p className="text-lg font-bold text-accent mt-2">{format(habitsReport.digitalAssetTotal, { withSuffix: true })}</p>
      </Card>

      <Card className="p-5">
        <HabitAdherenceChart series={habitsReport.series} currentStreak={habitsReport.currentStreak} defaultOpen />
      </Card>

      <Card>
        <ul className="divide-y divide-line">
          {habitsReport.habits.map((h: any) => (
            <li key={h.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0 flex items-center gap-2">
                <span className="shrink-0">{h.icon || "🔥"}</span>
                <div className="min-w-0">
                  <p className={`text-sm truncate ${h.isActive ? "text-ink" : "text-muted"}`}>{h.title}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {h.currentStreak > 0 ? `${toPersianDigits(h.currentStreak)} روز پشت‌سرهم` : `${toPersianDigits(h.daysSinceLastCheckIn)} روز از آخرین تیک`}
                  </p>
                </div>
              </div>
              <span className="text-sm font-bold text-accent shrink-0">{format(h.virtualAssetValue, { withSuffix: true })}</span>
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
        <h3 className="font-bold text-ink text-sm mb-1">هزینه پنهان کارها و رویدادها</h3>
        <p className="text-xs text-muted mb-4">
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
          <ul className="divide-y divide-line">
            {hiddenCost.items.map((item: any) => (
              <li key={`${item.entityType}-${item.id}`} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm text-ink truncate">{item.title}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {item.entityType === "TASK" ? "کار" : "رویداد"}
                      {item.categoryName ? ` · ${item.categoryName}` : ""} · {formatJalali(new Date(item.date))}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-waste shrink-0">{format(item.hiddenCost, { withSuffix: true })}</span>
                </div>
                {(item.directCost > 0 || item.timeCost > 0) && (
                  <div className="flex gap-3 mt-1.5 text-xs text-muted">
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
        <button onClick={() => navigate(1)} className="p-1.5 rounded-lg hover:bg-canvas text-muted">
          <ChevronRightIcon className="w-4 h-4" />
        </button>
        <span className="text-sm text-ink min-w-[7rem] text-center">{formatJalaliMonthYear(cursor)}</span>
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-canvas text-muted">
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
      </div>

      <Card className="p-4">
        <p className="text-xs text-muted mb-2">دسته‌بندی</p>
        {!data ? (
          <p className="text-sm text-muted">در حال بارگذاری...</p>
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
                    ? "bg-accent text-on-accent border-accent"
                    : c.totalDays > 0
                      ? "bg-surface text-ink border-line"
                      : "bg-surface text-muted border-line"
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
            <div className="grid grid-cols-7 text-center text-xs text-muted mb-2">
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
                      !inMonth ? "bg-canvas border-transparent text-muted" : minutes > 0 ? "border-accent-soft" : "bg-surface border-line"
                    }`}
                    style={minutes > 0 ? { backgroundColor: `rgb(var(--accent) / ${0.12 + intensity * 0.55})` } : undefined}
                  >
                    <span className={`text-xs ${inMonth ? (minutes > 0 ? "text-accent font-bold" : "text-ink") : "text-muted"}`}>
                      {toPersianDigits(jd)}
                    </span>
                    {minutes > 0 && <span className="text-[9px] text-accent">{compactDuration(minutes)}</span>}
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

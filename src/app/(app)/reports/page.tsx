"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { Card, StatItem, EmptyState } from "@/components/ui/Card";
import { formatDuration, truncateLabel, toPersianDigits, compactDuration } from "@/lib/money";
import { formatJalali, formatJalaliMonthYear, toJalali, formatTime } from "@/lib/jalali";
import { getJalaliMonthGrid, addJalaliMonths, dayKeyIso, parseDayKey } from "@/lib/calendarGrid";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis } from "recharts";
import HabitAdherenceChart from "@/components/habits/HabitAdherenceChart";
import { ChevronRightIcon, ChevronLeftIcon } from "@/components/icons";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import DeltaChip, { type DeltaPolarity } from "@/components/DeltaChip";
import { phraseDeltaPride, phraseSamePeriodTasksCompleted, phraseSamePeriodVirtualAsset } from "@/lib/phrasing";
import { ringArcPath, RING_START_DEG, RING_SWEEP_DEG } from "@/lib/ringArc";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import { customRangeQuery, validateCustomRange } from "@/lib/reportRange";

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

/** The chip that switches the presets over to a range the person picks themselves. */
const CUSTOM_PRESET = "custom";

const REPORT_TABS = [
  { key: "summary", label: "خلاصه" },
  { key: "time", label: "زمان" },
  { key: "finance", label: "مالی" },
  { key: "habits", label: "عادت‌ها" },
  { key: "hiddenCost", label: "هزینه پنهان" },
  { key: "notes", label: "نوشته‌ها" },
  { key: "categoryCalendar", label: "تقویم دسته‌بندی‌ها" },
] as const;

const timeColors = ["#2c7166", "#57a89c", "#b0a24a", "#c95a4c", "#8a7ac9", "#8a8a8a"];

// useSearchParams needs a Suspense boundary for the static (Android) export.
export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsPageInner />
    </Suspense>
  );
}

function ReportsPageInner() {
  const router = useRouter();
  const [preset, setPreset] = useState("month");
  // A search result for a habit or category lands here as /reports?tab=categoryCalendar&category=<id>&day=YYYY-MM-DD.
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState<(typeof REPORT_TABS)[number]["key"]>(REPORT_TABS.some((t) => t.key === tabParam) ? (tabParam as (typeof REPORT_TABS)[number]["key"]) : "summary");
  // A range of the person's own choosing: whole days, from the first to the last picked (both included).
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d;
  });
  const [customTo, setCustomTo] = useState(() => new Date());
  const customError = preset === CUSTOM_PRESET ? validateCustomRange(customFrom, customTo) : null;
  const reportUrl =
    preset !== CUSTOM_PRESET ? `/api/reports?preset=${preset}` : customError ? null : `/api/reports?${customRangeQuery(customFrom, customTo)}`;
  const { data } = useSWR<any>(reportUrl, fetcher);

  // window.open(..., "_blank") — the old approach — targets a real browser tab, which doesn't
  // exist inside the Capacitor WebView; there it silently fails to navigate anywhere useful and
  // the SPA's own router falls back to "/". Both exports below branch on platform instead of
  // relying on browser-only APIs.
  async function exportCsv(entity: string) {
    const isNative = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    const filename = `${entity}.csv`;
    try {
      if (isNative) {
        const { dispatchLocal } = await import("@/lib/localDispatcher");
        const res = dispatchLocal("GET", `/api/export/${entity}`);
        if (res.status >= 400) throw new Error((res.json as { error?: string })?.error ?? `HTTP ${res.status}`);
        const csv = (res.json as { csv: string }).csv;

        // Directory.Cache, not Documents — see settings/page.tsx's BackupTab for why: on a lot of
        // real devices the public Documents directory doesn't already exist, and writeFile fails
        // with "Missing parent directory" rather than creating it. Cache is always there and is
        // all a share-sheet handoff needs.
        const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
        await Filesystem.writeFile({ path: filename, data: csv, directory: Directory.Cache, encoding: Encoding.UTF8 });
        const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
        await Share.share({ title: filename, dialogTitle: "ارسال فایل خروجی", files: [uri] });
      } else {
        const res = await fetch(`/api/export/${entity}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // res.blob() keeps the server's raw bytes — including the UTF-8 BOM toCsv() prepends —
        // intact. res.text() would decode them through TextDecoder first, which silently strips a
        // leading BOM per the WHATWG spec, so Excel then guesses the wrong codepage and garbles
        // every Persian string in the file while ASCII numbers/dates stay readable.
        const blob = await res.blob();
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
    router.push(preset === CUSTOM_PRESET ? `/print/report?${customRangeQuery(customFrom, customTo)}` : `/print/report?preset=${preset}`);
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
            <button
              onClick={() => setPreset(CUSTOM_PRESET)}
              className={`shrink-0 text-sm px-3.5 py-1.5 rounded-full transition ${
                preset === CUSTOM_PRESET ? "bg-accent text-on-accent" : "bg-surface border border-dashed border-line text-muted"
              }`}
            >
              بازه دلخواه
            </button>
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

      {tab !== "categoryCalendar" && preset === CUSTOM_PRESET && (
        <Card className="p-4 space-y-2">
          <p className="text-xs text-muted">بازه‌ی گزارش (هر دو روز شامل می‌شوند)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted mb-1 block">از تاریخ</label>
              <JalaliDateInput value={customFrom} onChange={setCustomFrom} />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">تا تاریخ</label>
              <JalaliDateInput value={customTo} onChange={setCustomTo} />
            </div>
          </div>
          {customError && <p className="text-xs text-waste">{customError}</p>}
        </Card>
      )}

      {tab === "categoryCalendar" ? (
        <CategoryCalendarTab initialCategoryId={searchParams.get("category")} initialDay={searchParams.get("day")} />
      ) : preset === CUSTOM_PRESET && customError ? null : !data ? (
        <p className="text-sm text-muted text-center py-10">در حال بارگذاری...</p>
      ) : tab === "summary" ? (
        <SummaryTab data={data} />
      ) : tab === "time" ? (
        <TimeTab data={data} />
      ) : tab === "finance" ? (
        <FinanceTab data={data} />
      ) : tab === "hiddenCost" ? (
        <HiddenCostTab hiddenCost={data.hiddenCost} />
      ) : tab === "notes" ? (
        <NotesTab data={data} />
      ) : (
        <HabitsTab habitsReport={data.habitsReport} />
      )}
    </div>
  );
}

/** The ring's center label has real room for maybe one word — "ساعت" alone, not the full
 * "X ساعت و Y دقیقه" (formatDuration, used in the legend below where there's more space). Still
 * a whole, real Persian word, just the one unit that matters at a glance. */
function ringCenterLabel(minutes: number): string {
  const hours = Math.round(minutes / 60);
  return `${toPersianDigits(hours)} ساعت`;
}

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
          <span className="text-base font-bold text-ink">{ringCenterLabel(current)}</span>
          <span className="text-[10px] text-muted mt-0.5">{label}</span>
        </div>
      </div>
      <div className="text-xs space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
          <span className="text-muted">این بازه</span>
          <span className="text-ink mr-auto font-semibold">{formatDuration(current)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-muted shrink-0" />
          <span className="text-muted">بازهٔ قبل</span>
          <span className="text-ink mr-auto font-semibold">{formatDuration(previous)}</span>
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
        <span className={`block text-sm font-semibold ${wasteTone ? "text-waste" : "text-ink"}`}>{value}</span>
        {previous !== undefined && (
          <span className="text-[11px]">
            <DeltaChip current={current} previous={previous} polarity={polarity} />
          </span>
        )}
      </div>
    </div>
  );
}

/** Its own tab (like FinanceTab) rather than folded into the summary — a period can carry enough
 * notes that burying them under the ledger numbers would make both harder to scan. */
function NotesTab({ data }: { data: any }) {
  const { data: notesData } = useSWR<{ notes: { id: string; day: string; content: string }[] }>(
    `/api/notes?from=${dayKeyIso(new Date(data.from))}&to=${dayKeyIso(new Date(data.to))}`,
    fetcher
  );
  const notes = notesData?.notes ?? [];

  return (
    <Card className="p-5">
      <h3 className="font-bold text-ink text-sm mb-3">نوشته‌ها</h3>
      {notes.length === 0 ? (
        <EmptyState message="برای این بازه نوشته‌ای ثبت نشده." />
      ) : (
        <div className="space-y-4">
          {notes.map((note) => {
            const day = parseDayKey(note.day);
            return (
              <div key={note.id} className="pb-4 border-b border-line last:border-0 last:pb-0">
                {day && <p className="text-[11px] text-muted mb-1">{formatJalali(day, { long: true })}</p>}
                <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap break-words">{note.content}</p>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function SummaryTab({ data }: { data: any }) {
  const { format } = useCurrencyUnit();
  const prideLine = computePrideLine(data.comparison);
  const cmp = data.comparison?.hasEnoughHistory ? data.comparison : null;

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between pb-3 border-b-2 border-ink">
        <h2 className="text-base font-extrabold text-ink">دفتر این بازه</h2>
        <span className="text-xs text-muted">
          {formatJalali(new Date(data.from))}–{formatJalali(new Date(data.to))}
        </span>
      </div>

      {data.narrative && (
        <p className="text-sm leading-8 text-ink">{data.narrative}</p>
      )}

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
            value={format(data.report.net, { withSuffix: true })}
            current={data.report.net}
            previous={cmp?.previous.net}
            polarity="higherIsBetter"
          />
          <LedgerRow
            index={2}
            label="هزینه"
            value={format(data.report.expense, { withSuffix: true })}
            wasteTone
            current={data.report.expense}
            previous={cmp?.previous.expense}
            polarity="lowerIsBetter"
          />
          <LedgerRow
            index={3}
            label="دارایی مجازی"
            value={format(data.report.virtualAssetValue, { withSuffix: true })}
            current={data.report.virtualAssetValue}
            previous={cmp?.previous.virtualAssetValue}
            polarity="higherIsBetter"
          />
          <LedgerRow
            index={4}
            label="کارهای انجام‌شده"
            value={toPersianDigits(data.report.tasksCompleted)}
            current={data.report.tasksCompleted}
            previous={undefined}
            polarity="higherIsBetter"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Groups a flat timeByCategory/expenseByCategory list into parent rows with their sub-categories
 * indented beneath — a parent that has no direct entries of its own (everything logged under its
 * children instead) still gets a synthetic header row here, built from a child's own carried
 * parentName, since otherwise its children's totals would have nowhere to be grouped under.
 */
function groupByParent<T extends { categoryId: string; name: string; color: string; parentCategoryId: string | null; parentName: string | null }>(
  items: T[],
  getValue: (item: T) => number
) {
  const topLevel = items.filter((i) => !i.parentCategoryId);
  const childrenByParent = new Map<string, T[]>();
  for (const i of items) {
    if (!i.parentCategoryId) continue;
    const list = childrenByParent.get(i.parentCategoryId) ?? [];
    list.push(i);
    childrenByParent.set(i.parentCategoryId, list);
  }
  const parentIds = new Set([...topLevel.map((i) => i.categoryId), ...childrenByParent.keys()]);
  return Array.from(parentIds)
    .map((parentId) => {
      const own = topLevel.find((i) => i.categoryId === parentId);
      const children = childrenByParent.get(parentId) ?? [];
      return {
        id: parentId,
        name: own?.name ?? children[0]?.parentName ?? "?",
        color: own?.color ?? children[0]?.color ?? "#999",
        value: (own ? getValue(own) : 0) + children.reduce((s, c) => s + getValue(c), 0),
        children: children.map((c) => ({ id: c.categoryId, name: c.name, color: c.color, value: getValue(c) })),
      };
    })
    .sort((a, b) => b.value - a.value);
}

function CategoryLegend({ groups, formatValue }: { groups: ReturnType<typeof groupByParent>; formatValue: (v: number) => string }) {
  return (
    <div className="space-y-1 mt-3">
      {groups.map((g) => (
        <div key={g.id}>
          <div className="flex items-center justify-between text-xs py-1">
            <span className="flex items-center gap-1.5 text-ink">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
              {g.name}
            </span>
            <span className="font-bold text-ink">{formatValue(g.value)}</span>
          </div>
          {g.children.length > 0 && (
            <div className="pr-4 border-r border-line mr-1 space-y-0.5">
              {g.children.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[11px] py-0.5">
                  <span className="flex items-center gap-1.5 text-muted">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </span>
                  <span className="text-muted">{formatValue(c.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
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
        {data.report.timeByCategory.length > 0 && (
          <CategoryLegend groups={groupByParent(data.report.timeByCategory, (i: any) => i.minutes)} formatValue={formatDuration} />
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
      {data.report.expenseByCategory.length > 0 && (
        <CategoryLegend
          groups={groupByParent(data.report.expenseByCategory, (i: any) => i.amount)}
          formatValue={(v) => format(v, { withSuffix: true })}
        />
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

function CategoryCalendarTab({ initialCategoryId, initialDay }: { initialCategoryId?: string | null; initialDay?: string | null }) {
  // Opened from a search result: that category preselected, on the month of the last day something was done in it.
  const [cursor, setCursor] = useState(() => (initialDay ? parseDayKey(initialDay) : null) ?? new Date());
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(initialCategoryId ?? null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(initialDay && initialCategoryId ? initialDay : null);
  const { jy, jm } = toJalali(cursor);
  const { data } = useSWR<{ categories: any[]; jy: number; jm: number }>(
    `/api/reports/category-calendar?jy=${jy}&jm=${jm}`,
    fetcher
  );

  function navigate(delta: number) {
    const { jy: ny, jm: nm } = addJalaliMonths(jy, jm, delta);
    setCursor(getJalaliMonthGrid(ny, nm)[8]); // a day safely inside the new month
    setSelectedDayKey(null);
  }

  const selected = data?.categories.find((c: any) => c.categoryId === selectedCategoryId) ?? null;
  const maxDayMinutes = selected ? Math.max(1, ...(Object.values(selected.days) as number[])) : 1;
  const selectedDayItems: any[] = (selectedDayKey && selected?.dayItems?.[selectedDayKey]) || [];

  const ITEM_TYPE_LABELS: Record<string, string> = { TIME_ENTRY: "فعالیت", TASK: "کار", EVENT: "رویداد", HABIT: "عادت" };

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
                onClick={() => {
                  setSelectedCategoryId(selectedCategoryId === c.categoryId ? null : c.categoryId);
                  setSelectedDayKey(null);
                }}
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
                const dayKey = dayKeyIso(day);
                const minutes = inMonth ? selected.days[dayKey] ?? 0 : 0;
                const intensity = minutes > 0 ? Math.min(1, minutes / maxDayMinutes) : 0;
                const isSelectedDay = selectedDayKey === dayKey;
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    disabled={minutes === 0}
                    onClick={() => setSelectedDayKey(isSelectedDay ? null : dayKey)}
                    className={`aspect-square rounded-xl border p-1.5 flex flex-col items-center justify-center gap-0.5 ${
                      !inMonth
                        ? "bg-canvas border-transparent text-muted"
                        : minutes > 0
                          ? isSelectedDay
                            ? "border-accent ring-2 ring-accent"
                            : "border-accent-soft"
                          : "bg-surface border-line"
                    }`}
                    style={minutes > 0 ? { backgroundColor: `rgb(var(--accent) / ${0.12 + intensity * 0.55})` } : undefined}
                  >
                    <span className={`text-xs ${inMonth ? (minutes > 0 ? "text-accent font-bold" : "text-ink") : "text-muted"}`}>
                      {toPersianDigits(jd)}
                    </span>
                    {minutes > 0 && <span className="text-[9px] text-accent">{compactDuration(minutes)}</span>}
                  </button>
                );
              })}
            </div>
          </Card>

          {selectedDayKey && selectedDayItems.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-line">
                <p className="text-sm font-bold text-ink">{formatJalali(new Date(selectedDayKey))}</p>
              </div>
              <ul className="divide-y divide-line">
                {selectedDayItems.map((item, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="text-ink truncate">{item.title}</p>
                      <p className="text-xs text-muted mt-0.5">
                        {ITEM_TYPE_LABELS[item.type] ?? item.type} · {item.timeOfDay ? formatTime(new Date(item.timeOfDay)) : "بدون زمان مشخص"}
                      </p>
                    </div>
                    <span className="text-accent font-medium shrink-0">{formatDuration(item.minutes)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

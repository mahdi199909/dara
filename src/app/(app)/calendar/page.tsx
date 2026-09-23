"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, apiPost } from "@/lib/apiClient";
import { toJalali, formatJalali, formatJalaliMonthYear, formatTime, weekdayNameFa } from "@/lib/jalali";
import { getJalaliMonthGrid, isSameDay, addJalaliMonths, parseDayKey } from "@/lib/calendarGrid";
import { Card, EmptyState } from "@/components/ui/Card";
import { ChevronRightIcon, ChevronLeftIcon, PlusIcon, CheckSquareIcon, ChartIcon } from "@/components/icons";
import EventFormModal from "@/components/calendar/EventFormModal";
import DayDetailModal from "@/components/calendar/DayDetailModal";
import DayPanel from "@/components/day/DayPanel";
import type { NoteDto } from "@/lib/schemas/notes";
import FeaturedMetricPicker from "@/components/calendar/FeaturedMetricPicker";
import { toPersianDigits, compactDuration, formatDuration, signed } from "@/lib/money";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import { dayKeyIso } from "@/lib/calendarGrid";

/** Compact Toman amount for a small calendar cell — "۵۰۰ه"/"۱.۲م", not the full formatted string. */
function compactMoney(amount: number): string {
  if (amount < 1000) return toPersianDigits(amount);
  if (amount < 1_000_000) return `${toPersianDigits(Math.round(amount / 100) / 10)}ه`;
  return `${toPersianDigits(Math.round(amount / 100_000) / 10)}م`;
}

const WEEKDAY_HEADERS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const VIEWS = [
  { key: "year", label: "سال" },
  { key: "month", label: "ماه" },
  { key: "week", label: "هفته" },
  { key: "day", label: "روز" },
  { key: "agenda", label: "برنامه" },
] as const;
const JALALI_MONTH_NAMES = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// useSearchParams needs a Suspense boundary for the static (Android) export.
export default function CalendarPage() {
  return (
    <Suspense fallback={null}>
      <CalendarPageInner />
    </Suspense>
  );
}

function CalendarPageInner() {
  const [view, setView] = useState<(typeof VIEWS)[number]["key"]>("month");
  const [cursor, setCursor] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [editingEvent, setEditingEvent] = useState<any>(null);
  const [detailDay, setDetailDay] = useState<Date | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showFeaturedPicker, setShowFeaturedPicker] = useState(false);
  const { format } = useCurrencyUnit();

  // A search result lands here as /calendar?day=YYYY-MM-DD (&item=<id> to mark what was found): show that
  // day's month and open the day itself.
  const searchParams = useSearchParams();
  const dayParam = searchParams.get("day");
  const itemParam = searchParams.get("item");
  useEffect(() => {
    const target = dayParam ? parseDayKey(dayParam) : null;
    if (!target) return;
    setView("month");
    setCursor(target);
    setDetailDay(target);
    setHighlightId(itemParam);
  }, [dayParam, itemParam]);

  const { jy, jm } = toJalali(cursor);

  // Days of the shown month that have a note, marked in the grid.
  const monthGrid = useMemo(() => (view === "month" ? getJalaliMonthGrid(jy, jm) : null), [view, jy, jm]);
  const { data: notesData } = useSWR<{ notes: NoteDto[] }>(
    monthGrid ? `/api/notes?from=${dayKeyIso(monthGrid[0])}&to=${dayKeyIso(monthGrid[monthGrid.length - 1])}` : null,
    fetcher
  );
  const noteDays = useMemo(() => new Set((notesData?.notes ?? []).map((n) => n.day)), [notesData]);

  const { data: overviewData, mutate: mutateOverview } = useSWR<{
    overview: { days: any[]; monthIncome: number; monthExpense: number; monthProductiveMinutes: number; monthFeaturedTotal: number | null; featured: any };
  }>(view === "month" ? `/api/calendar/month-overview?jy=${jy}&jm=${jm}` : null, fetcher);
  const overview = overviewData?.overview;
  const overviewByDay = useMemo(() => {
    const map = new Map<string, { income: number; expense: number; productiveMinutes: number; featuredValue: number | null }>();
    for (const d of overview?.days ?? []) map.set(d.date, d);
    return map;
  }, [overview]);

  const { data: yearOverviewData, mutate: mutateYearOverview } = useSWR<{
    overview: { months: any[]; yearIncome: number; yearExpense: number; yearProductiveMinutes: number; yearFeaturedTotal: number | null; featured: any };
  }>(view === "year" ? `/api/calendar/year-overview?jy=${jy}` : null, fetcher);
  const yearOverview = yearOverviewData?.overview;

  const range = useMemo(() => {
    if (view === "month") {
      const grid = getJalaliMonthGrid(jy, jm);
      return { from: grid[0], to: grid[grid.length - 1] };
    }
    if (view === "week") {
      const start = new Date(cursor);
      const daysSinceSaturday = (start.getDay() + 1) % 7;
      start.setDate(start.getDate() - daysSinceSaturday);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { from: start, to: end };
    }
    if (view === "day") {
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
      return { from: start, to: end };
    }
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 86400000);
    return { from: start, to: end };
  }, [view, cursor, jy, jm]);

  const { data, mutate } = useSWR<{ occurrences: any[]; taskOccurrences: any[] }>(
    `/api/events?from=${range.from.toISOString()}&to=${range.to.toISOString()}`,
    fetcher
  );

  const occurrencesByDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const occ of data?.occurrences ?? []) {
      const d = new Date(occ.startAt);
      const key = dayKey(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(occ);
    }
    for (const list of map.values()) list.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    return map;
  }, [data]);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const task of data?.taskOccurrences ?? []) {
      if (!task.dueDate) continue;
      const key = dayKey(new Date(task.dueDate));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(task);
    }
    return map;
  }, [data]);

  function navigate(delta: number) {
    if (view === "year") {
      const { jy: ny, jm: nm } = addJalaliMonths(jy, jm, delta * 12);
      setCursor(getJalaliMonthGrid(ny, nm)[8]);
    } else if (view === "month") {
      const { jy: ny, jm: nm } = addJalaliMonths(jy, jm, delta);
      setCursor(getJalaliMonthGrid(ny, nm)[8]); // a day safely inside the new month
    } else if (view === "week") {
      setCursor(new Date(cursor.getTime() + delta * 7 * 86400000));
    } else {
      setCursor(new Date(cursor.getTime() + delta * 86400000));
    }
  }

  function openEdit(occ: any) {
    setEditingEvent(occ.event);
    setShowForm(true);
  }

  async function toggleDone(occ: any) {
    await apiPost(`/api/events/${occ.event.id}/complete`, { occurrenceDate: occ.startAt });
    mutate();
  }

  function closeForm() {
    setShowForm(false);
    setEditingEvent(null);
  }

  function openMonth(targetJm: number) {
    setCursor(getJalaliMonthGrid(jy, targetJm)[8]);
    setView("month");
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-ink">تقویم</h1>
        <button
          onClick={() => { setSelectedDay(cursor); setEditingEvent(null); setShowForm(true); }}
          className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-2 rounded-xl hover:opacity-90 shrink-0"
        >
          <PlusIcon className="w-4 h-4" />
          رویداد جدید
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-4 px-4">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`shrink-0 text-sm px-3.5 py-1.5 rounded-full transition ${
              view === v.key ? "bg-accent text-on-accent" : "bg-surface border border-line text-muted"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        {view !== "agenda" ? (
          <div className="flex items-center gap-1 min-w-0">
            <button onClick={() => navigate(1)} className="p-1.5 rounded-lg hover:bg-canvas text-muted shrink-0">
              <ChevronRightIcon className="w-4 h-4" />
            </button>
            <span className="text-sm text-ink text-center truncate px-1">
              {view === "year"
                ? toPersianDigits(jy)
                : view === "month"
                  ? formatJalaliMonthYear(cursor)
                  : formatJalali(cursor, { withWeekday: view === "day" })}
            </span>
            <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-canvas text-muted shrink-0">
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <span />
        )}
        {/* The category calendar lives in Reports; this opens it on the month being looked at here. */}
        <Link
          href={`/reports?tab=categoryCalendar&day=${dayKeyIso(cursor)}`}
          className="shrink-0 flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink hover:border-accent hover:text-accent transition"
        >
          <ChartIcon className="w-3.5 h-3.5" />
          تقویم دسته‌بندی‌ها
        </Link>
      </div>

      {view === "year" && (
        <>
          <div className="flex gap-2">
            <Card className="flex-1 min-w-0 p-2.5 space-y-1">
              <p className="text-[11px] text-muted">جریان کل سال</p>
              <div className="flex items-center gap-2 text-sm font-bold">
                <span className="text-accent">{signed("+", format(yearOverview?.yearIncome ?? 0, { withSuffix: true }))}</span>
                <span className="text-waste">{signed("-", format(yearOverview?.yearExpense ?? 0, { withSuffix: true }))}</span>
              </div>
              <p className="text-[11px] text-muted truncate">
                کار مفید: <span className="text-ink font-bold">{formatDuration(yearOverview?.yearProductiveMinutes ?? 0)}</span>
              </p>
            </Card>

            <Card className="flex-1 min-w-0 p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-[11px] text-muted shrink-0">دسته منتخب</p>
                <button
                  onClick={() => setShowFeaturedPicker(true)}
                  className="min-w-0 truncate text-[11px] text-muted hover:text-ink bg-canvas rounded-full px-2 py-1"
                >
                  {yearOverview?.featured ? `${yearOverview.featured.icon ?? ""} ${yearOverview.featured.name}` : "انتخاب +"}
                </button>
              </div>
              {yearOverview?.featured && yearOverview.yearFeaturedTotal !== null ? (
                <p className="text-sm font-bold text-ink truncate">
                  {yearOverview.featured.type === "habit"
                    ? `${toPersianDigits(yearOverview.yearFeaturedTotal)} روز`
                    : formatDuration(yearOverview.yearFeaturedTotal)}
                </p>
              ) : (
                <p className="text-[11px] text-muted truncate">دسته‌ای انتخاب کن</p>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(
              yearOverview?.months ?? Array.from({ length: 12 }, (_, i) => ({ jm: i + 1, income: 0, expense: 0, productiveMinutes: 0, featuredValue: null }))
            ).map((m) => (
                <button
                  key={m.jm}
                  onClick={() => openMonth(m.jm)}
                  className={`h-24 rounded-xl border p-2 text-right flex flex-col gap-0.5 bg-surface border-line ${
                    m.jm === jm ? "ring-2 ring-brand-400" : ""
                  }`}
                >
                  <span className="text-xs text-ink">{JALALI_MONTH_NAMES[m.jm - 1]}</span>
                  <div className="flex-1 overflow-hidden flex flex-col gap-px w-full text-[9px] leading-tight font-medium">
                    {m.income > 0 && <span className="text-accent">{signed("+", compactMoney(m.income))}</span>}
                    {m.expense > 0 && <span className="text-waste">{signed("-", compactMoney(m.expense))}</span>}
                    {m.productiveMinutes > 0 && <span className="text-ink">⚡{compactDuration(m.productiveMinutes)}</span>}
                    {m.featuredValue !== null && m.featuredValue > 0 && (
                      <span className="text-muted">
                        ★{yearOverview?.featured?.type === "habit" ? toPersianDigits(m.featuredValue) + "روز" : compactDuration(m.featuredValue)}
                      </span>
                    )}
                  </div>
                </button>
              )
            )}
          </div>
        </>
      )}

      {view === "month" && (
        <>
          <div className="flex gap-2">
            <Card className="flex-1 min-w-0 p-2.5 space-y-1">
              <p className="text-[11px] text-muted">جریان کل ماه</p>
              <div className="flex items-center gap-2 text-sm font-bold">
                <span className="text-accent">{signed("+", format(overview?.monthIncome ?? 0, { withSuffix: true }))}</span>
                <span className="text-waste">{signed("-", format(overview?.monthExpense ?? 0, { withSuffix: true }))}</span>
              </div>
              <p className="text-[11px] text-muted truncate">
                کار مفید: <span className="text-ink font-bold">{formatDuration(overview?.monthProductiveMinutes ?? 0)}</span>
              </p>
            </Card>

            <Card className="flex-1 min-w-0 p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-1.5">
                <p className="text-[11px] text-muted shrink-0">دسته منتخب</p>
                <button
                  onClick={() => setShowFeaturedPicker(true)}
                  className="min-w-0 truncate text-[11px] text-muted hover:text-ink bg-canvas rounded-full px-2 py-1"
                >
                  {overview?.featured ? `${overview.featured.icon ?? ""} ${overview.featured.name}` : "انتخاب +"}
                </button>
              </div>
              {overview?.featured && overview.monthFeaturedTotal !== null ? (
                <p className="text-sm font-bold text-ink truncate">
                  {overview.featured.type === "habit" ? `${toPersianDigits(overview.monthFeaturedTotal)} روز` : formatDuration(overview.monthFeaturedTotal)}
                </p>
              ) : (
                <p className="text-[11px] text-muted truncate">دسته‌ای انتخاب کن</p>
              )}
            </Card>
          </div>

          <Card className="p-3">
            <div className="grid grid-cols-7 text-center text-xs text-muted mb-2">
              {WEEKDAY_HEADERS.map((w) => <div key={w}>{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {getJalaliMonthGrid(jy, jm).map((day) => {
                const { jm: dJm, jd } = toJalali(day);
                const inMonth = dJm === jm;
                const isToday = isSameDay(day, new Date());
                const summary = overviewByDay.get(dayKeyIso(day));
                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => setDetailDay(day)}
                    className={`h-24 rounded-xl border p-1 text-right flex flex-col gap-0.5 ${
                      inMonth ? "bg-surface border-line" : "bg-canvas border-transparent text-muted"
                    } ${isToday ? "ring-2 ring-brand-400" : ""}`}
                  >
                    <span className={`text-xs flex items-center gap-1 ${inMonth ? "text-ink" : "text-muted"}`}>
                      {toPersianDigits(jd)}
                      {noteDays.has(dayKeyIso(day)) && <span aria-label="نوت دارد" className="text-[9px] leading-none">📝</span>}
                    </span>
                    {summary && (
                      <div className="flex-1 overflow-hidden flex flex-col gap-px w-full text-[8px] leading-tight font-medium">
                        {summary.income > 0 && <span className="text-accent">{signed("+", compactMoney(summary.income))}</span>}
                        {summary.expense > 0 && <span className="text-waste">{signed("-", compactMoney(summary.expense))}</span>}
                        {summary.productiveMinutes > 0 && <span className="text-ink">⚡{compactDuration(summary.productiveMinutes)}</span>}
                        {summary.featuredValue !== null && summary.featuredValue > 0 && (
                          <span className="text-muted">★{overview?.featured?.type === "habit" ? "" : compactDuration(summary.featuredValue)}</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {detailDay && (
        <DayDetailModal
          date={detailDay}
          highlightId={highlightId}
          onClose={() => { setDetailDay(null); setHighlightId(null); }}
          onChanged={() => { mutateOverview(); mutate(); }}
        />
      )}
      {showFeaturedPicker && (
        <FeaturedMetricPicker
          onClose={() => setShowFeaturedPicker(false)}
          onSaved={() => {
            mutateOverview();
            mutateYearOverview();
          }}
        />
      )}

      {view === "week" && (
        <div className="grid grid-cols-1 gap-3">
          {Array.from({ length: 7 }, (_, i) => {
            const day = new Date(range.from.getTime() + i * 86400000);
            const events = occurrencesByDay.get(dayKey(day)) ?? [];
            const tasks = tasksByDay.get(dayKey(day)) ?? [];
            return (
              <Card key={i} className="p-3">
                <p className="text-xs text-muted mb-2">{weekdayNameFa(day)} {toPersianDigits(toJalali(day).jd)}</p>
                <div className="space-y-1.5">
                  {events.length === 0 && tasks.length === 0 ? (
                    <p className="text-xs text-muted">—</p>
                  ) : (
                    <>
                      {events.map((occ) => (
                        <button
                          key={occ.occurrenceId}
                          onClick={() => openEdit(occ)}
                          className="w-full text-right text-xs bg-accent-soft text-accent rounded-lg px-2 py-1 hover:bg-accent-soft"
                        >
                          {formatTime(new Date(occ.startAt))} · {occ.event.title}
                        </button>
                      ))}
                      {tasks.map((t) => (
                        <div key={t.id} className="text-xs bg-amber-50 text-amber-700 rounded-lg px-2 py-1">
                          ☐ {t.title}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {view === "day" && (
        <Card className="p-4">
          <DayPanel day={cursor} onChanged={() => { mutate(); }} />
        </Card>
      )}

      {view === "agenda" && (
        <div className="space-y-3">
          {Array.from(occurrencesByDay.entries()).length === 0 && Array.from(tasksByDay.entries()).length === 0 ? (
            <EmptyState message="رویداد یا کاری در ۳۰ روز آینده ثبت نشده." />
          ) : (
            Array.from(new Set([...occurrencesByDay.keys(), ...tasksByDay.keys()]))
              .map((key) => {
                const events = occurrencesByDay.get(key) ?? [];
                const tasks = tasksByDay.get(key) ?? [];
                const anyDate = events[0]?.startAt ?? tasks[0]?.dueDate;
                return { key, events, tasks, anyDate: new Date(anyDate) };
              })
              .sort((a, b) => a.anyDate.getTime() - b.anyDate.getTime())
              .map(({ key, events, tasks, anyDate }) => (
                <Card key={key} className="p-4">
                  <p className="text-xs text-muted mb-2">{formatJalali(anyDate, { withWeekday: true, long: true })}</p>
                  <ul className="space-y-1.5">
                    {events.map((occ) => (
                      <li key={occ.occurrenceId} className="flex items-center gap-2">
                        <button
                          onClick={() => toggleDone(occ)}
                          aria-label="تکمیل رویداد"
                          className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition ${
                            occ.isDone ? "bg-accent border-accent text-on-accent" : "border-line text-transparent"
                          }`}
                        >
                          <CheckSquareIcon className="w-3 h-3" strokeWidth={3} />
                        </button>
                        <button onClick={() => openEdit(occ)} className="flex-1 flex items-center gap-3 text-sm text-right hover:bg-canvas rounded-lg -mx-1 px-1">
                          <span className="text-muted w-14 shrink-0">{formatTime(new Date(occ.startAt))}</span>
                          <span className={occ.isDone ? "text-muted line-through" : "text-ink"}>{occ.event.title}</span>
                        </button>
                      </li>
                    ))}
                    {tasks.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 text-sm">
                        <span className="w-14 shrink-0 flex"><CheckSquareIcon className="w-3.5 h-3.5 text-amber-500" /></span>
                        <span className="text-ink">{t.title}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))
          )}
        </div>
      )}

      {showForm && (
        <EventFormModal
          defaultDate={selectedDay ?? cursor}
          event={editingEvent}
          onClose={closeForm}
          onCreated={() => { closeForm(); mutate(); }}
          onDeleted={() => { closeForm(); mutate(); }}
        />
      )}
    </div>
  );
}

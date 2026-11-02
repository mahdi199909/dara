"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { Card, EmptyState, StatItem } from "@/components/ui/Card";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { addJalaliMonths, dayKeyIso, getJalaliMonthGrid, parseDayKey } from "@/lib/calendarGrid";
import { formatJalali, formatJalaliMonthYear, formatTime, toJalali } from "@/lib/jalali";
import { compactDuration, formatDuration, toPersianDigits } from "@/lib/money";
import {
  heatOf,
  mergeCategoryStats,
  monthHeadline,
  orderForList,
  type CategoryCalendarItem,
  type CategoryCalendarStat,
  type MergedCategoryStat,
} from "@/lib/categoryCalendar";

const ALL = "all";
const WEEKDAY_HEADERS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
const ITEM_TYPE_LABELS: Record<string, string> = { TIME_ENTRY: "فعالیت", TASK: "کار", EVENT: "رویداد", HABIT: "عادت" };

type Shown = CategoryCalendarStat | MergedCategoryStat;
type ShownItem = CategoryCalendarItem & { category?: { name: string; icon: string | null } };

/**
 * «تقویم دسته‌بندی‌ها»: where the month's time went, one category at a time or all together.
 *
 * It opens on «همهٔ دسته‌ها» (every category added up) instead of an empty prompt, so there is something to read
 * at once; picking a category narrows the calendar to it. On a wide screen the categories are a list beside the
 * calendar, each with its own total and share, and the calendar keeps a sensible cell size instead of growing
 * with the window; on a phone the same choice is a row of buttons above it. A tapped day opens its items right
 * under the calendar (and scrolls them into view).
 */
export default function CategoryCalendarTab({ initialCategoryId, initialDay }: { initialCategoryId?: string | null; initialDay?: string | null }) {
  // Opened from a search result: that category preselected, on the month of the last day something was done in it.
  const [cursor, setCursor] = useState(() => (initialDay ? parseDayKey(initialDay) : null) ?? new Date());
  const [categoryId, setCategoryId] = useState<string>(initialCategoryId ?? ALL);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(initialDay && initialCategoryId ? initialDay : null);
  const [showIdle, setShowIdle] = useState(false);
  const dayDetailRef = useRef<HTMLDivElement>(null);

  const { jy, jm } = toJalali(cursor);
  const today = toJalali(new Date());
  const isCurrentMonth = jy === today.jy && jm === today.jm;
  const { data } = useSWR<{ categories: CategoryCalendarStat[]; jy: number; jm: number }>(`/api/reports/category-calendar?jy=${jy}&jm=${jm}`, fetcher);

  const stats = useMemo(() => data?.categories ?? [], [data]);
  const ordered = useMemo(() => orderForList(stats), [stats]);
  const headline = useMemo(() => monthHeadline(stats), [stats]);
  const merged = useMemo(() => mergeCategoryStats(stats, { name: "همهٔ دسته‌ها", icon: "🗓️", color: "#3a8d80" }), [stats]);
  const selected: Shown = (categoryId !== ALL ? stats.find((s) => s.categoryId === categoryId) : undefined) ?? merged;
  const isAll = selected === merged;

  const busiestDay = Math.max(1, ...Object.values(selected.days));
  const topCategoryMinutes = Math.max(1, ...stats.map((s) => s.totalMinutes));
  const dayItems: ShownItem[] = (selectedDayKey && (selected.dayItems[selectedDayKey] as ShownItem[] | undefined)) || [];
  const activeCategories = ordered.filter((s) => s.totalMinutes > 0);
  const idleCategories = ordered.filter((s) => s.totalMinutes === 0);
  // The list shows the idle ones only on request — except one the person is looking at, which must stay in view.
  const listed = showIdle ? ordered : [...activeCategories, ...idleCategories.filter((s) => s.categoryId === categoryId)];

  useEffect(() => {
    if (selectedDayKey) dayDetailRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedDayKey]);

  function navigate(delta: number) {
    const { jy: ny, jm: nm } = addJalaliMonths(jy, jm, delta);
    setCursor(getJalaliMonthGrid(ny, nm)[8]); // a day safely inside the new month
    setSelectedDayKey(null);
  }

  function choose(id: string) {
    setCategoryId(id);
    setSelectedDayKey(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-1">
        <button type="button" onClick={() => navigate(1)} aria-label="ماه قبل" className="p-1.5 rounded-lg hover:bg-canvas text-muted">
          <ChevronRightIcon className="w-4 h-4" />
        </button>
        <span className="text-sm text-ink min-w-[7rem] text-center">{formatJalaliMonthYear(cursor)}</span>
        <button type="button" onClick={() => navigate(-1)} aria-label="ماه بعد" className="p-1.5 rounded-lg hover:bg-canvas text-muted">
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        {!isCurrentMonth && (
          <button
            type="button"
            onClick={() => {
              setCursor(new Date());
              setSelectedDayKey(null);
            }}
            className="mr-2 text-xs text-accent border border-line rounded-full px-2.5 py-1 hover:border-accent"
          >
            این ماه
          </button>
        )}
      </div>

      {!data ? (
        <p className="text-sm text-muted text-center py-6">در حال بارگذاری...</p>
      ) : stats.length === 0 ? (
        <Card>
          <EmptyState message="هنوز دسته‌بندی‌ای نساخته‌اید." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-3">
              <StatItem label="زمان ثبت‌شدهٔ ماه" value={formatDuration(headline.totalMinutes)} tone="positive" />
            </Card>
            <Card className="p-3">
              <StatItem label="روزهای فعال" value={`${toPersianDigits(headline.activeDays)} روز`} />
            </Card>
            <Card className="p-3">
              <StatItem label="پرکارترین دسته" value={headline.busiest ? `${headline.busiest.icon ?? ""} ${headline.busiest.name}`.trim() : "—"} />
            </Card>
          </div>

          <div className="space-y-4 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start lg:gap-4 lg:space-y-0">
            {/* The categories. A phone gets a row of buttons; a wide screen a list with each one's total and share. */}
            <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1 lg:hidden" role="tablist" aria-label="دسته‌بندی">
              {[{ categoryId: ALL, name: "همه", icon: "🗓️", totalMinutes: 1 }, ...ordered].map((c) => {
                const active = (categoryId === ALL ? ALL : selected.categoryId) === c.categoryId;
                return (
                  <button
                    key={c.categoryId}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => choose(c.categoryId)}
                    className={`shrink-0 flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition ${
                      active ? "bg-accent text-on-accent border-accent" : c.totalMinutes > 0 ? "bg-surface text-ink border-line" : "bg-surface text-muted border-line"
                    }`}
                  >
                    <span>{c.icon}</span>
                    {c.name}
                  </button>
                );
              })}
            </div>

            <Card className="hidden lg:block p-2">
              <ul className="space-y-1" aria-label="دسته‌بندی">
                {[{ categoryId: ALL, name: "همهٔ دسته‌ها", icon: "🗓️", color: "#3a8d80", totalMinutes: headline.totalMinutes, totalDays: headline.activeDays }, ...listed].map((c) => {
                  const active = (categoryId === ALL ? ALL : selected.categoryId) === c.categoryId;
                  const share = c.categoryId === ALL ? 1 : c.totalMinutes / topCategoryMinutes;
                  return (
                    <li key={c.categoryId}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => choose(c.categoryId)}
                        className={`w-full text-right rounded-xl border px-3 py-2 transition ${
                          active ? "border-accent bg-accent-soft" : "border-transparent hover:bg-canvas"
                        }`}
                      >
                        <span className="flex items-center gap-2 text-sm">
                          <span>{c.icon}</span>
                          <span className={`truncate ${c.totalMinutes > 0 ? "text-ink" : "text-muted"}`}>{c.name}</span>
                        </span>
                        <span className="mt-1 flex items-center justify-between text-[11px] text-muted">
                          <span>{c.totalMinutes > 0 ? formatDuration(c.totalMinutes) : "بدون فعالیت"}</span>
                          {c.totalDays > 0 && <span>{toPersianDigits(c.totalDays)} روز</span>}
                        </span>
                        <span className="mt-1 block h-1 rounded-full bg-line overflow-hidden" aria-hidden>
                          <span className="block h-full rounded-full" style={{ width: `${Math.round(share * 100)}%`, backgroundColor: c.color }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {idleCategories.length > 0 && (
                <button type="button" onClick={() => setShowIdle((v) => !v)} className="w-full text-center text-[11px] text-muted hover:text-ink pt-2 pb-1">
                  {showIdle ? "پنهان کردن دسته‌های بدون فعالیت" : `نمایش دسته‌های بدون فعالیت (${toPersianDigits(idleCategories.length)})`}
                </button>
              )}
            </Card>

            <div className="space-y-4 min-w-0">
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-4">
                  <StatItem label={isAll ? "روزهای فعال این ماه" : `روزهای فعال ${selected.name}`} value={`${toPersianDigits(selected.totalDays)} روز`} />
                </Card>
                <Card className="p-4">
                  <StatItem label={isAll ? "مجموع زمان این ماه" : `مجموع زمان ${selected.name}`} value={formatDuration(selected.totalMinutes)} tone="positive" />
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
                    const key = dayKeyIso(day);
                    const minutes = inMonth ? selected.days[key] ?? 0 : 0;
                    const heat = heatOf(minutes, busiestDay);
                    const isSelectedDay = selectedDayKey === key;
                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        disabled={minutes === 0}
                        aria-pressed={isSelectedDay}
                        onClick={() => setSelectedDayKey(isSelectedDay ? null : key)}
                        // A square on a phone; a fixed height on a wide screen, so the grid does not grow with the window.
                        className={`aspect-square sm:aspect-auto sm:h-16 rounded-xl border p-1 flex flex-col items-center justify-center gap-0.5 ${
                          !inMonth ? "bg-canvas border-transparent text-muted" : minutes > 0 ? (isSelectedDay ? "border-accent ring-2 ring-accent" : "border-accent-soft") : "bg-surface border-line"
                        }`}
                        style={minutes > 0 ? { backgroundColor: `rgb(var(--accent) / ${0.12 + heat * 0.55})` } : undefined}
                      >
                        <span className={`text-xs ${inMonth ? (minutes > 0 ? "text-accent font-bold" : "text-ink") : "text-muted"}`}>{toPersianDigits(jd)}</span>
                        {minutes > 0 && <span className="text-[9px] text-accent">{compactDuration(minutes)}</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted">
                  <span>{selected.totalMinutes > 0 ? "هر خانه، مجموع زمان همان روز؛ روی روز بزن تا کارهایش را ببینی." : "در این ماه زمانی ثبت نشده."}</span>
                  <span className="flex items-center gap-1 shrink-0" aria-hidden>
                    کم
                    {[0.12, 0.3, 0.45, 0.67].map((alpha) => (
                      <span key={alpha} className="inline-block w-3 h-3 rounded" style={{ backgroundColor: `rgb(var(--accent) / ${alpha})` }} />
                    ))}
                    زیاد
                  </span>
                </div>
              </Card>

              {selectedDayKey && dayItems.length > 0 && (
                <div ref={dayDetailRef}>
                  <Card className="p-0 overflow-hidden">
                    <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-ink">{formatJalali(parseDayKey(selectedDayKey) ?? new Date(), { withWeekday: true, long: true })}</p>
                      <span className="text-xs text-accent font-medium">{formatDuration(selected.days[selectedDayKey] ?? 0)}</span>
                    </div>
                    <ul className="divide-y divide-line">
                      {dayItems.map((item, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                          <div className="min-w-0">
                            <p className="text-ink truncate">{item.title}</p>
                            <p className="text-xs text-muted mt-0.5">
                              {[
                                item.category ? `${item.category.icon ?? ""} ${item.category.name}`.trim() : null,
                                ITEM_TYPE_LABELS[item.type] ?? item.type,
                                item.timeOfDay ? formatTime(new Date(item.timeOfDay)) : "بدون زمان مشخص",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <span className="text-accent font-medium shrink-0">{formatDuration(item.minutes)}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher, apiPost } from "@/lib/apiClient";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import { dayKeyIso } from "@/lib/calendarGrid";
import { buildDayItems } from "@/lib/dayItems";
import { formatDuration } from "@/lib/money";
import { refreshAllCaches } from "@/lib/refreshCaches";
import { Card } from "@/components/ui/Card";
import { CheckSquareIcon, ClockIcon } from "@/components/icons";
import DayItemsList from "@/components/day/DayItemsList";
import DayNotes from "@/components/day/DayNotes";
import HabitDurationModal from "@/components/habits/HabitDurationModal";

/**
 * Everything about one calendar day, in one place: the day's notes, what was scheduled or done
 * (events, tasks and time entries — each with its time, length, money, and edit/delete), the habits
 * with a tick for that day, and the day's money movements. Opened from a tapped calendar day, from
 * the day view, and from a search result.
 */
export default function DayPanel({
  day,
  highlightId,
  onChanged,
}: {
  day: Date;
  /** The entity (task, event, note …) a search result pointed at — marked in its list. */
  highlightId?: string | null;
  onChanged?: () => void;
}) {
  const { format } = useCurrencyUnit();
  const dayStart = useMemo(() => new Date(day.getFullYear(), day.getMonth(), day.getDate()), [day]);
  const dayEnd = useMemo(() => new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 23, 59, 59, 999), [dayStart]);
  const range = `from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`;

  const { data: eventsData, mutate: mutateEvents } = useSWR<{ occurrences: any[]; taskOccurrences: any[] }>(`/api/events?${range}`, fetcher);
  const { data: activityData, mutate: mutateActivity } = useSWR<{ items: any[] }>(`/api/day-activity?${range}`, fetcher);
  const { data: detailData, mutate: mutateDetail } = useSWR<{ habits: any[]; transactions: any[] }>(`/api/calendar/day-detail?date=${dayStart.toISOString()}`, fetcher);
  const [durationHabit, setDurationHabit] = useState<any>(null);

  // Time entries are the only thing /api/day-activity adds here: its habit and money rows are shown by the
  // dedicated sections below, which carry more (every habit with a tick, every transaction of the day).
  const items = useMemo(
    () => buildDayItems(eventsData, { items: (activityData?.items ?? []).filter((i) => i.type === "TIME_ENTRY") }),
    [eventsData, activityData]
  );
  const habits = detailData?.habits ?? [];
  const transactions = detailData?.transactions ?? [];
  const loading = !eventsData || !activityData || !detailData;

  function refetch() {
    void mutateEvents();
    void mutateActivity();
    void mutateDetail();
    onChanged?.();
  }

  async function toggleHabit(habitId: string) {
    await apiPost(`/api/habits/${habitId}/checkin`, { date: dayStart.toISOString() });
    refreshAllCaches();
    refetch();
  }

  return (
    <div className="space-y-4">
      <DayNotes dayKey={dayKeyIso(dayStart)} highlightId={highlightId} onChanged={onChanged} />

      <section>
        <p className="text-xs font-medium text-muted mb-1.5">کارها و رویدادها</p>
        {loading ? (
          <p className="text-sm text-muted text-center py-4">در حال بارگذاری...</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted">رویداد یا کاری برای این روز ثبت نشده.</p>
        ) : (
          <Card className="p-3">
            <DayItemsList items={items} day={dayStart} highlightId={highlightId} onChanged={refetch} />
          </Card>
        )}
      </section>

      {habits.length > 0 && (
        <section>
          <p className="text-xs font-medium text-muted mb-1.5">عادت‌ها</p>
          <Card className="p-2 divide-y divide-line">
            {habits.map((h: any) => (
              <div key={h.id} className="flex items-center justify-between gap-2 py-2 px-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span>{h.icon}</span>
                  <p className="text-sm text-ink truncate">{h.title}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {h.checkedIn && (
                    <button type="button" onClick={() => setDurationHabit(h)} className="flex items-center gap-1 text-xs text-muted hover:text-accent" aria-label="ثبت زمان عادت">
                      <ClockIcon className="w-3.5 h-3.5" />
                      {h.durationMin ? formatDuration(h.durationMin) : "زمان"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void toggleHabit(h.id)}
                    className={`w-6 h-6 rounded-full border flex items-center justify-center transition ${
                      h.checkedIn ? "bg-accent border-accent text-on-accent" : "border-line text-transparent"
                    }`}
                    aria-label={h.checkedIn ? "لغو انجام عادت" : "ثبت انجام عادت"}
                  >
                    <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}

      {transactions.length > 0 && (
        <section>
          <p className="text-xs font-medium text-muted mb-1.5">اطلاعات مالی</p>
          <Card className="p-2 divide-y divide-line">
            {transactions.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between py-2 px-1 text-sm">
                <div>
                  <p className="text-ink">{t.description || t.category?.name || "—"}</p>
                  {t.category && (
                    <p className="text-xs text-muted">
                      {t.category.icon} {t.category.name}
                    </p>
                  )}
                </div>
                <span className={t.type === "INCOME" ? "text-accent font-bold" : t.type === "EXPENSE" ? "text-waste font-bold" : "text-muted"}>
                  {t.type === "EXPENSE" ? "-" : t.type === "INCOME" ? "+" : ""}
                  {format(t.amount, { withSuffix: true })}
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {durationHabit && (
        <HabitDurationModal
          habit={{ id: durationHabit.id, title: durationHabit.title, todayDurationMin: durationHabit.durationMin }}
          date={dayStart}
          onClose={() => setDurationHabit(null)}
          onSaved={() => {
            setDurationHabit(null);
            refreshAllCaches();
            refetch();
          }}
        />
      )}
    </div>
  );
}

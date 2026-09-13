"use client";

import useSWR from "swr";
import { fetcher, apiPost } from "@/lib/apiClient";
import { formatJalali, formatTime } from "@/lib/jalali";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import { CheckSquareIcon, XIcon } from "@/components/icons";
import { Card } from "@/components/ui/Card";

interface DayDetailModalProps {
  date: Date;
  onClose: () => void;
  onChanged: () => void; // month overview + events both need re-fetching after a toggle
}

// Full "everything that happened this day" view opened from the calendar month grid — events,
// tasks, habit check-ins, and transactions. Deliberately a separate fetch from the month
// overview: that one only carries 4 aggregate numbers per day, not the underlying rows.
export default function DayDetailModal({ date, onClose, onChanged }: DayDetailModalProps) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000 - 1);
  const dateParam = dayStart.toISOString();
  const { format } = useCurrencyUnit();

  const { data: eventsData, mutate: mutateEvents } = useSWR<{ occurrences: any[]; taskOccurrences: any[] }>(
    `/api/events?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`,
    fetcher
  );
  const { data: detailData, mutate: mutateDetail } = useSWR<{ habits: any[]; transactions: any[] }>(
    `/api/calendar/day-detail?date=${dateParam}`,
    fetcher
  );

  const events = eventsData?.occurrences ?? [];
  const tasks = eventsData?.taskOccurrences ?? [];
  const habits = detailData?.habits ?? [];
  const transactions = detailData?.transactions ?? [];
  const loading = !eventsData || !detailData;

  async function toggleEvent(occ: any) {
    await apiPost(`/api/events/${occ.event.id}/complete`, { occurrenceDate: occ.startAt });
    mutateEvents();
    onChanged();
  }

  async function toggleHabit(habitId: string) {
    await apiPost(`/api/habits/${habitId}/checkin`, { date: dateParam });
    mutateDetail();
    onChanged();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-md mx-auto bg-surface rounded-t-2xl shadow-xl max-h-[85vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 sticky top-0 bg-surface">
          <h2 className="font-bold text-ink">{formatJalali(date, { withWeekday: true, long: true })}</h2>
          <button onClick={onClose} aria-label="بستن" className="text-muted hover:text-ink p-1">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pb-6 space-y-4">
          {loading ? (
            <p className="text-sm text-muted text-center py-6">در حال بارگذاری...</p>
          ) : (
            <>
              {transactions.length > 0 && (
                <section>
                  <p className="text-xs font-medium text-muted mb-1.5">اطلاعات مالی</p>
                  <Card className="p-2 divide-y divide-line">
                    {transactions.map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between py-2 px-1 text-sm">
                        <div>
                          <p className="text-ink">{t.description || t.category?.name || "—"}</p>
                          {t.category && <p className="text-xs text-muted">{t.category.icon} {t.category.name}</p>}
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

              <section>
                <p className="text-xs font-medium text-muted mb-1.5">رویدادها و کارها</p>
                {events.length === 0 && tasks.length === 0 ? (
                  <p className="text-xs text-muted">رویداد یا کاری برای این روز ثبت نشده.</p>
                ) : (
                  <Card className="p-2 divide-y divide-line">
                    {events.map((occ: any) => (
                      <div key={occ.occurrenceId} className="flex items-center gap-2 py-2 px-1">
                        <button
                          onClick={() => toggleEvent(occ)}
                          aria-label="تکمیل رویداد"
                          className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${
                            occ.isDone ? "bg-accent border-accent text-on-accent" : "border-line text-transparent"
                          }`}
                        >
                          <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                        </button>
                        <span className="text-sm text-muted w-14 shrink-0">{formatTime(new Date(occ.startAt))}</span>
                        <p className={`text-sm flex-1 ${occ.isDone ? "text-muted line-through" : "text-ink"}`}>{occ.event.title}</p>
                      </div>
                    ))}
                    {tasks.map((t: any) => (
                      <div key={t.id} className="flex items-center gap-2 py-2 px-1">
                        <span className="w-5 h-5 shrink-0 flex items-center justify-center">
                          <CheckSquareIcon className={`w-4 h-4 ${t.status === "DONE" ? "text-accent" : "text-amber-500"}`} />
                        </span>
                        <p className={`text-sm flex-1 ${t.status === "DONE" ? "text-muted line-through" : "text-ink"}`}>{t.title}</p>
                      </div>
                    ))}
                  </Card>
                )}
              </section>

              {habits.length > 0 && (
                <section>
                  <p className="text-xs font-medium text-muted mb-1.5">عادت‌ها</p>
                  <Card className="p-2 divide-y divide-line">
                    {habits.map((h: any) => (
                      <div key={h.id} className="flex items-center justify-between py-2 px-1">
                        <div className="flex items-center gap-2">
                          <span>{h.icon}</span>
                          <p className="text-sm text-ink">{h.title}</p>
                        </div>
                        <button
                          onClick={() => toggleHabit(h.id)}
                          className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center transition ${
                            h.checkedIn ? "bg-accent border-accent text-on-accent" : "border-line text-transparent"
                          }`}
                          aria-label={h.checkedIn ? "لغو انجام عادت" : "ثبت انجام عادت"}
                        >
                          <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                        </button>
                      </div>
                    ))}
                  </Card>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, apiPost } from "@/lib/apiClient";
import { useHabits } from "@/lib/hooks";
import CaptureForm from "@/components/CaptureForm";
import HabitAdherenceChart from "@/components/habits/HabitAdherenceChart";
import HabitDurationModal from "@/components/habits/HabitDurationModal";
import { Card, EmptyState } from "@/components/ui/Card";
import { formatTime } from "@/lib/jalali";
import { formatDuration } from "@/lib/money";
import { ClockIcon, PlusIcon, XIcon, CheckSquareIcon } from "@/components/icons";

function todayRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from, to };
}

export default function HomePage() {
  const [showForm, setShowForm] = useState(false);
  const [durationHabit, setDurationHabit] = useState<any>(null);
  const { from, to } = todayRange();

  const { data, mutate } = useSWR<{ occurrences: any[] }>(
    `/api/events?from=${from.toISOString()}&to=${to.toISOString()}`,
    fetcher
  );
  const { habits, series, currentStreak, mutate: mutateHabits } = useHabits();

  // Only what's still ahead today — already-passed events would just be noise on Home.
  const now = new Date();
  const upcomingToday = (data?.occurrences ?? []).filter((occ: any) => new Date(occ.startAt) >= now);

  const hour = now.getHours();
  const greeting = hour < 5 ? "شب بخیر" : hour < 12 ? "صبح بخیر" : hour < 18 ? "ظهر بخیر" : "عصر بخیر";

  async function toggleEventDone(occ: any) {
    await apiPost(`/api/events/${occ.event.id}/complete`, { occurrenceDate: occ.startAt });
    mutate();
  }

  async function toggleHabitCheckIn(habitId: string) {
    await apiPost(`/api/habits/${habitId}/checkin`);
    mutateHabits();
  }

  // Trial habits (BJ Fogg's 3-day experiments) live only on the dedicated /habits page —
  // Home stays to committed habits, checked off like any other daily item.
  const activeHabits = habits.filter((h: any) => h.isActive && !h.isTrial);

  return (
    <div className="max-w-lg mx-auto px-4 md:px-6 py-8 space-y-6">
      <h1 className="text-xl font-bold text-gray-800 text-center">{greeting} 👋</h1>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800 text-sm">رویدادهای امروز</h2>
        </div>
        {!data ? (
          <p className="text-sm text-gray-400">در حال بارگذاری...</p>
        ) : upcomingToday.length === 0 ? (
          <EmptyState message="رویداد پیش‌رویی برای امروز نمانده." />
        ) : (
          <ul className="space-y-2">
            {upcomingToday.map((occ: any) => (
              <li key={occ.occurrenceId} className="flex items-center gap-3 text-sm">
                <button
                  onClick={() => toggleEventDone(occ)}
                  aria-label="تکمیل رویداد"
                  className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${
                    occ.isDone ? "bg-brand-600 border-brand-600 text-white" : "border-gray-300 text-transparent"
                  }`}
                >
                  <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                </button>
                <ClockIcon className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="text-gray-400 w-12 shrink-0">{formatTime(new Date(occ.startAt))}</span>
                <span className={`truncate ${occ.isDone ? "text-gray-400 line-through" : "text-gray-800"}`}>{occ.event.title}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800 text-sm">عادت‌های امروز</h2>
        </div>
        {activeHabits.length === 0 ? (
          <EmptyState message="هنوز عادتی نساخته‌اید. از منو، بخش «عادت‌ها» را ببینید." />
        ) : (
          <ul className="space-y-2 mb-3">
            {activeHabits.map((h: any) => (
              <li key={h.id} className="flex items-center gap-3 text-sm">
                <button
                  onClick={() => toggleHabitCheckIn(h.id)}
                  aria-label="تیک عادت"
                  className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${
                    h.checkedInToday ? "bg-brand-600 border-brand-600 text-white" : "border-gray-300 text-transparent"
                  }`}
                >
                  <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                </button>
                <span className="shrink-0">{h.icon || "🔥"}</span>
                <span className={`flex-1 truncate ${h.checkedInToday ? "text-gray-400 line-through" : "text-gray-800"}`}>{h.title}</span>
                {h.checkedInToday && (
                  <button
                    onClick={() => setDurationHabit(h)}
                    className="shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600 transition"
                    aria-label="ثبت زمان عادت"
                  >
                    <ClockIcon className="w-3.5 h-3.5" />
                    {h.todayDurationMin ? formatDuration(h.todayDurationMin) : "زمان"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {activeHabits.length > 0 && <HabitAdherenceChart series={series} currentStreak={currentStreak} />}
      </Card>

      <Card className="p-5">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-between text-gray-500 hover:text-gray-700 transition"
          >
            <span className="text-sm font-medium">ثبت کار</span>
            <PlusIcon className="w-5 h-5 text-brand-600" />
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-800 text-sm">ثبت کار</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            <CaptureForm
              onDone={() => {
                setShowForm(false);
                mutate();
              }}
            />
          </>
        )}
      </Card>

      {durationHabit && (
        <HabitDurationModal
          habit={durationHabit}
          onClose={() => setDurationHabit(null)}
          onSaved={() => { setDurationHabit(null); mutateHabits(); }}
        />
      )}
    </div>
  );
}

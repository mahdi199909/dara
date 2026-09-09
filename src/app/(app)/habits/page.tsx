"use client";

import { useState } from "react";
import { apiPost } from "@/lib/apiClient";
import { useHabits } from "@/lib/hooks";
import { Card, EmptyState } from "@/components/ui/Card";
import HabitFormModal from "@/components/habits/HabitFormModal";
import TrialHabitFormModal from "@/components/habits/TrialHabitFormModal";
import TrialHabitCard from "@/components/habits/TrialHabitCard";
import HabitAdherenceChart from "@/components/habits/HabitAdherenceChart";
import HabitDurationModal from "@/components/habits/HabitDurationModal";
import { formatDuration } from "@/lib/money";
import { PlusIcon, EditIcon, CheckSquareIcon, ClockIcon } from "@/components/icons";

export default function HabitsPage() {
  const { habits, series, currentStreak, mutate } = useHabits();
  const [showHabitForm, setShowHabitForm] = useState(false);
  const [editingHabit, setEditingHabit] = useState<any>(null);
  const [showTrialForm, setShowTrialForm] = useState(false);
  const [durationHabit, setDurationHabit] = useState<any>(null);

  const trialHabits = habits.filter((h: any) => h.isTrial);
  const regularHabits = habits.filter((h: any) => !h.isTrial);
  const activeHabits = regularHabits.filter((h: any) => h.isActive);
  const inactiveHabits = regularHabits.filter((h: any) => !h.isActive);

  async function toggleCheckIn(habitId: string) {
    await apiPost(`/api/habits/${habitId}/checkin`);
    mutate();
  }

  function closeHabitForm() {
    setShowHabitForm(false);
    setEditingHabit(null);
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-bold text-ink">عادت‌ها</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTrialForm(true)}
            className="flex items-center gap-1 text-sm bg-surface border border-accent-soft text-accent px-3 py-1.5 rounded-xl hover:bg-accent-soft"
          >
            <PlusIcon className="w-4 h-4" />
            عادت تستی
          </button>
          <button
            onClick={() => { setEditingHabit(null); setShowHabitForm(true); }}
            className="flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-1.5 rounded-xl hover:opacity-90"
          >
            <PlusIcon className="w-4 h-4" />
            عادت جدید
          </button>
        </div>
      </div>

      {trialHabits.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold text-ink text-sm">عادت‌های آزمایشی (۳ روزه)</h2>
          <div className="grid grid-cols-1 gap-3">
            {trialHabits.map((h: any) => (
              <TrialHabitCard key={h.id} habit={h} onChanged={mutate} />
            ))}
          </div>
        </section>
      )}

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-ink text-sm">عادت‌های من</h2>
        </div>
        {activeHabits.length === 0 ? (
          <EmptyState message="هنوز عادت همیشگی‌ای نساخته‌اید. اول یک عادت تستی رو امتحان کنید." />
        ) : (
          <ul className="space-y-2 mb-3">
            {activeHabits.map((h: any) => (
              <li key={h.id} className="flex items-center gap-3 text-sm">
                <button
                  onClick={() => toggleCheckIn(h.id)}
                  aria-label="تیک عادت"
                  className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${
                    h.checkedInToday ? "bg-accent border-accent text-on-accent" : "border-line text-transparent"
                  }`}
                >
                  <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                </button>
                <span className="shrink-0">{h.icon || "🔥"}</span>
                <span className={`flex-1 truncate ${h.checkedInToday ? "text-muted line-through" : "text-ink"}`}>{h.title}</span>
                {h.checkedInToday && (
                  <button
                    onClick={() => setDurationHabit(h)}
                    className="shrink-0 flex items-center gap-1 text-xs text-muted hover:text-accent transition"
                    aria-label="ثبت زمان عادت"
                  >
                    <ClockIcon className="w-3.5 h-3.5" />
                    {h.todayDurationMin ? formatDuration(h.todayDurationMin) : "زمان"}
                  </button>
                )}
                <button
                  onClick={() => { setEditingHabit(h); setShowHabitForm(true); }}
                  className="text-muted hover:text-muted shrink-0"
                  aria-label="ویرایش عادت"
                >
                  <EditIcon className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {activeHabits.length > 0 && <HabitAdherenceChart series={series} currentStreak={currentStreak} defaultOpen />}
      </Card>

      {inactiveHabits.length > 0 && (
        <Card className="p-5">
          <h2 className="font-bold text-muted text-sm mb-3">عادت‌های غیرفعال</h2>
          <ul className="space-y-2">
            {inactiveHabits.map((h: any) => (
              <li key={h.id} className="flex items-center gap-3 text-sm">
                <span className="shrink-0 opacity-50">{h.icon || "🔥"}</span>
                <span className="flex-1 truncate text-muted">{h.title}</span>
                <button
                  onClick={() => { setEditingHabit(h); setShowHabitForm(true); }}
                  className="text-muted hover:text-muted shrink-0"
                  aria-label="ویرایش عادت"
                >
                  <EditIcon className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {showHabitForm && (
        <HabitFormModal
          habit={editingHabit}
          onClose={closeHabitForm}
          onSaved={() => { closeHabitForm(); mutate(); }}
          onDeleted={() => { closeHabitForm(); mutate(); }}
        />
      )}
      {showTrialForm && (
        <TrialHabitFormModal onClose={() => setShowTrialForm(false)} onCreated={() => { setShowTrialForm(false); mutate(); }} />
      )}
      {durationHabit && (
        <HabitDurationModal
          habit={durationHabit}
          onClose={() => setDurationHabit(null)}
          onSaved={() => { setDurationHabit(null); mutate(); }}
        />
      )}
    </div>
  );
}

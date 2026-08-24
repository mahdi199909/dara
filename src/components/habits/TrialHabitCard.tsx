"use client";

import { useState, useEffect } from "react";
import { apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { CheckSquareIcon, XIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/money";

/**
 * One trial habit, shown as its Cue → Action → Celebration chain with a check-in control and
 * a day-of-3 progress dots. Once the 3-day window elapses (trialElapsed, computed server-side
 * in lib/habitStreak.ts), the card swaps to a keep/discard prompt instead of the checkbox.
 */
export default function TrialHabitCard({ habit, onChanged }: { habit: any; onChanged: () => void }) {
  const [celebrating, setCelebrating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => setCelebrating(false), 1800);
    return () => clearTimeout(t);
  }, [celebrating]);

  async function toggleCheckIn() {
    setBusy(true);
    try {
      const wasChecked = habit.checkedInToday;
      await apiPost(`/api/habits/${habit.id}/checkin`);
      if (!wasChecked) setCelebrating(true);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    setBusy(true);
    try {
      await apiPatch(`/api/habits/${habit.id}`, { isTrial: false });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      await apiDelete(`/api/habits/${habit.id}`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative rounded-2xl border border-brand-100 bg-brand-50/40 p-4">
      {celebrating && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg animate-in fade-in zoom-in whitespace-nowrap z-10">
          🎉 {habit.celebration}
        </div>
      )}

      {!habit.trialElapsed && (
        <button
          onClick={discard}
          disabled={busy}
          aria-label="لغو عادت تستی"
          className="absolute top-2 left-2 text-gray-300 hover:text-waste-500 p-1"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-[11px] text-gray-500 flex items-center gap-1">
            <span>👉</span> {habit.cue}
          </p>
          <p className="text-sm font-medium text-gray-800 flex items-center gap-1">
            <span>⚡</span> {habit.title}
          </p>
          <p className="text-[11px] text-gray-500 flex items-center gap-1">
            <span>🎉</span> {habit.celebration}
          </p>
        </div>

        {!habit.trialElapsed && (
          <button
            onClick={toggleCheckIn}
            disabled={busy}
            aria-label="تیک عادت تستی"
            className={`shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center transition ${
              habit.checkedInToday ? "bg-brand-600 border-brand-600 text-white" : "border-brand-300 text-transparent bg-white"
            }`}
          >
            <CheckSquareIcon className="w-4 h-4" strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex gap-1">
          {[1, 2, 3].map((d) => (
            <span
              key={d}
              className={`w-2 h-2 rounded-full ${d <= (habit.trialDayNumber ?? 1) ? "bg-brand-500" : "bg-brand-100"}`}
            />
          ))}
        </div>
        {!habit.trialElapsed && (
          <span className="text-[11px] text-gray-400">روز {toPersianDigits(habit.trialDayNumber ?? 1)} از ۳</span>
        )}
      </div>

      {habit.trialElapsed && (
        <div className="mt-3 pt-3 border-t border-brand-100">
          <p className="text-xs text-gray-600 mb-2">۳ روز امتحانش کردی — می‌خوای به عادت‌های همیشگی‌ات اضافه‌اش کنی؟</p>
          <div className="flex gap-2">
            <button
              onClick={discard}
              disabled={busy}
              className="flex-1 rounded-xl border border-gray-200 text-gray-500 text-xs py-2 hover:bg-gray-50 disabled:opacity-40"
            >
              نه، فعلاً نه
            </button>
            <button
              onClick={keep}
              disabled={busy}
              className="flex-1 rounded-xl bg-brand-600 text-white text-xs py-2 hover:bg-brand-700 disabled:opacity-40"
            >
              بله، ادامه می‌دم
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

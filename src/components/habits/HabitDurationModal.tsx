"use client";

import { useState } from "react";
import { apiPatch } from "@/lib/apiClient";
import { XIcon } from "@/components/icons";

/**
 * Logs how long the user spent on a habit today — a separate, optional follow-up to
 * checking in (which stays a single tap on its own). The duration feeds into the app's
 * normal time reporting (Reports "خلاصه" time totals + "تقویم دسته‌بندی‌ها") and adds a
 * time-based virtual asset value on top of the habit's flat per-check-in value, the same
 * way logging time anywhere else in the app already works — see habitSync.ts.
 */
export default function HabitDurationModal({
  habit,
  onClose,
  onSaved,
}: {
  habit: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [minutes, setMinutes] = useState(habit.todayDurationMin ? String(habit.todayDurationMin) : "");
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    try {
      await apiPatch(`/api/habits/${habit.id}/checkin`, { durationMin: minutes ? Number(minutes) : 0 });
      onSaved();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-full sm:max-w-xs bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800 text-sm">چقدر روی «{habit.title}» وقت گذاشتی؟</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <input
          type="number"
          dir="ltr"
          min={0}
          max={1440}
          autoFocus
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="مدت زمان (دقیقه)"
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-right"
        />
        <p className="text-xs text-gray-400 mt-1.5">
          این زمان توی گزارش کارها و هزینه زمانی حساب میشه، و اگه دسته‌بندی این عادت نرخ دارایی مجازی داشته باشه، به دارایی مجازی هم اضافه میشه.
        </p>

        <button
          onClick={save}
          disabled={loading}
          className="w-full mt-4 rounded-xl bg-brand-600 text-white py-2.5 text-sm font-medium hover:bg-brand-700 disabled:opacity-40"
        >
          {loading ? "در حال ثبت..." : "ثبت زمان"}
        </button>
      </div>
    </div>
  );
}

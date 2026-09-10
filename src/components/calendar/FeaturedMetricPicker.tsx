"use client";

import { apiPatch } from "@/lib/apiClient";
import { useCategories, useHabits } from "@/lib/hooks";

// The calendar month view's 4th per-day metric (see doc comment on computeCalendarMonthOverview)
// — the user picks one category or one habit here; the other 3 numbers (income/expense/
// productive value) are fixed and always shown. onSaved lets the caller re-fetch its own
// month-overview data (keyed by the currently-viewed jy/jm, which this component doesn't know).
export default function FeaturedMetricPicker({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { categories } = useCategories();
  const { habits } = useHabits();

  async function choose(type: "category" | "habit", id: string) {
    await apiPatch("/api/settings", { calendarFeaturedType: type, calendarFeaturedId: id });
    onSaved();
    onClose();
  }

  async function clear() {
    await apiPatch("/api/settings", { calendarFeaturedType: null, calendarFeaturedId: null });
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-md mx-auto bg-surface rounded-t-2xl shadow-xl max-h-[75vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-bold text-ink">دسته‌بندی ویژه تقویم</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-sm">
            بستن
          </button>
        </div>
        <p className="px-5 text-xs text-muted mb-3">یکی از دسته‌بندی‌ها یا عادت‌ها را انتخاب کنید تا به‌عنوان چهارمین عدد در نمای ماه نشان داده شود.</p>

        <div className="px-5 pb-2">
          <button onClick={clear} className="w-full text-right text-sm text-waste py-2.5 border-b border-line">
            بدون دسته‌بندی ویژه
          </button>
        </div>

        {categories.length > 0 && (
          <div className="px-5 pb-2">
            <p className="text-xs font-medium text-muted mb-1.5 mt-2">دسته‌بندی‌ها</p>
            <div className="space-y-1">
              {categories.filter((c: any) => c.isActive).map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => choose("category", c.id)}
                  className="w-full flex items-center gap-2 text-right text-sm py-2 px-2 rounded-lg hover:bg-canvas"
                >
                  <span>{c.icon}</span>
                  <span className="text-ink">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {habits.length > 0 && (
          <div className="px-5 pb-5">
            <p className="text-xs font-medium text-muted mb-1.5 mt-2">عادت‌ها</p>
            <div className="space-y-1">
              {habits.map((h: any) => (
                <button
                  key={h.id}
                  onClick={() => choose("habit", h.id)}
                  className="w-full flex items-center gap-2 text-right text-sm py-2 px-2 rounded-lg hover:bg-canvas"
                >
                  <span>{h.icon}</span>
                  <span className="text-ink">{h.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

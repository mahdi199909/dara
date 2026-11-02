"use client";

import { useState } from "react";
import { apiPatch } from "@/lib/apiClient";
import { XIcon } from "@/components/icons";
import { HABIT_METRICS, isMetricKind, parseAmount, type HabitMetricKind } from "@/lib/habitMetrics";

/**
 * What the person wants to say about a habit they did — all of it optional: how long it took and, for a habit that
 * measures something (Habit.metricKind), how much: kilometres, pages, kilocalories. Checking in stays a single tap
 * on its own; this is the follow-up. The minutes feed the app's normal time reporting (Reports "خلاصه" time totals +
 * "تقویم دسته‌بندی‌ها") and add a time-based virtual asset value on top of the habit's flat per-check-in value, the same
 * way logging time anywhere else in the app already works — see habitSync.ts. The amount feeds the habit's own
 * calendar and chart in Reports ← «تقویم دسته‌بندی‌ها».
 */
export default function HabitDurationModal({
  habit,
  date,
  onClose,
  onSaved,
}: {
  habit: any;
  /** The day the check-in belongs to; today when left out. */
  date?: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const kind: HabitMetricKind | null = isMetricKind(habit.metricKind) ? habit.metricKind : null;
  const [minutes, setMinutes] = useState(habit.todayDurationMin ? String(habit.todayDurationMin) : "");
  const [amount, setAmount] = useState(habit.todayAmount ? String(habit.todayAmount) : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    // An empty box clears what was there; text that is not a number is not guessed at.
    const parsedAmount = amount.trim() === "" ? 0 : parseAmount(amount);
    if (kind && parsedAmount === null) {
      setError("عدد را درست بنویس؛ مثلاً ۵ یا ۵٫۵.");
      return;
    }
    setLoading(true);
    try {
      await apiPatch(`/api/habits/${habit.id}/checkin`, {
        durationMin: minutes ? Number(minutes) : 0,
        ...(kind ? { amount: parsedAmount ?? 0 } : {}),
        ...(date ? { date: date.toISOString() } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-xs mx-auto bg-surface rounded-t-2xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-ink text-sm">«{habit.title}» — جزئیات</h3>
          <button onClick={onClose} className="text-muted hover:text-ink p-1" aria-label="بستن">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted mb-4">همه‌اش اختیاری است؛ تیک زدن به‌تنهایی کافی است.</p>

        {kind && (
          <div className="mb-3">
            <label className="text-xs text-muted mb-1.5 block">{HABIT_METRICS[kind].question}</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="مثلاً ۵٫۵"
                aria-label={HABIT_METRICS[kind].question}
                className="bg-surface flex-1 rounded-xl border border-line px-3 py-2.5 text-sm text-right"
              />
              <span className="text-xs text-muted shrink-0">{HABIT_METRICS[kind].unit}</span>
            </div>
          </div>
        )}

        <div>
          <label className="text-xs text-muted mb-1.5 block">چقدر طول کشید؟</label>
          <input
            type="number"
            dir="ltr"
            min={0}
            max={1440}
            autoFocus={!kind}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="مدت زمان (دقیقه)"
            className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm text-right"
          />
          <p className="text-xs text-muted mt-1.5">
            این زمان توی گزارش کارها و هزینه زمانی حساب میشه، و اگه دسته‌بندی این عادت نرخ دارایی مجازی داشته باشه، به دارایی مجازی هم اضافه میشه.
          </p>
        </div>

        {error && <p className="text-xs text-waste mt-2">{error}</p>}

        <button
          onClick={save}
          disabled={loading}
          className="w-full mt-4 rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "در حال ثبت..." : "ثبت"}
        </button>
      </div>
    </div>
  );
}

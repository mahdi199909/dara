"use client";

import { useState } from "react";
import { apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { useCategories } from "@/lib/hooks";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import MoneyInput from "@/components/ui/MoneyInput";
import TimeScrollPicker from "@/components/ui/TimeScrollPicker";
import { XIcon, TrashIcon } from "@/components/icons";
import { REMINDER_OFFSET_PRESETS, RECURRENCE_FREQS, type RecurrenceFreq } from "@/lib/types";

const RECURRENCE_LABELS: Record<RecurrenceFreq, string> = {
  NONE: "بدون تکرار",
  DAILY: "روزانه",
  WEEKLY: "هفتگی",
  MONTHLY: "ماهانه",
  YEARLY: "سالانه",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function timeOf(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventFormModal({
  defaultDate,
  event,
  onClose,
  onCreated,
  onDeleted,
}: {
  defaultDate: Date;
  event?: any;
  onClose: () => void;
  onCreated: () => void;
  onDeleted?: () => void;
}) {
  const { categories } = useCategories();
  const isEdit = !!event;

  const initialStart = event ? new Date(event.startAt) : defaultDate;
  const initialDurationMin = event ? Math.max(5, Math.round((new Date(event.endAt).getTime() - initialStart.getTime()) / 60000)) : 60;

  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(initialStart);
  const [startTime, setStartTime] = useState(event ? timeOf(initialStart) : "10:00");
  const [durationMin, setDurationMin] = useState(String(initialDurationMin));
  const [categoryId, setCategoryId] = useState(event?.categoryId ?? "");
  const [directCost, setDirectCost] = useState(event?.directCost ? String(event.directCost) : "");
  const [incomeAmount, setIncomeAmount] = useState(event?.incomeAmount ? String(event.incomeAmount) : "");
  const [recurrenceFreq, setRecurrenceFreq] = useState<RecurrenceFreq>(event?.recurrenceFreq ?? "NONE");
  const [recurrenceEndMode, setRecurrenceEndMode] = useState<"NEVER" | "COUNT" | "DATE">(
    event?.recurrenceCount ? "COUNT" : event?.recurrenceUntil ? "DATE" : "NEVER"
  );
  const [recurrenceCount, setRecurrenceCount] = useState(event?.recurrenceCount ? String(event.recurrenceCount) : "10");
  const [recurrenceUntil, setRecurrenceUntil] = useState(event?.recurrenceUntil ? new Date(event.recurrenceUntil) : defaultDate);
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([30]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleOffset(minutes: number) {
    setReminderOffsets((prev) => (prev.includes(minutes) ? prev.filter((m) => m !== minutes) : [...prev, minutes]));
  }

  function dayIso(d: Date) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const startAt = new Date(`${dayIso(date)}T${startTime}:00`);
      const endAt = new Date(startAt.getTime() + Number(durationMin) * 60000);

      const payload: Record<string, unknown> = {
        title,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        categoryId: categoryId || undefined,
        directCost: directCost ? Number(directCost) : 0,
        incomeAmount: incomeAmount ? Number(incomeAmount) : 0,
        recurrenceFreq,
        recurrenceCount: recurrenceFreq !== "NONE" && recurrenceEndMode === "COUNT" ? Number(recurrenceCount) : null,
        recurrenceUntil: recurrenceFreq !== "NONE" && recurrenceEndMode === "DATE" ? recurrenceUntil.toISOString() : null,
      };

      if (isEdit) {
        await apiPatch(`/api/events/${event.id}`, payload);
      } else {
        await apiPost("/api/events", { ...payload, reminderOffsets });
      }
      onCreated();
    } catch (err: any) {
      setError(err?.message ?? "ثبت انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!event) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/events/${event.id}`);
      onDeleted?.();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto scrollbar-thin">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="font-bold text-gray-800">{isEdit ? "ویرایش رویداد" : "رویداد جدید"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان رویداد" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <JalaliDateInput value={date} onChange={setDate} />
            </div>
            <TimeScrollPicker value={startTime} onChange={setStartTime} required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" dir="ltr" min={5} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="مدت (دقیقه)" className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-right" />
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
              <option value="">دسته‌بندی</option>
              {categories.filter((c: any) => c.isActive).map((c: any) => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <MoneyInput value={directCost} onChange={setDirectCost} placeholder="هزینه" />
            <MoneyInput value={incomeAmount} onChange={setIncomeAmount} placeholder="درآمد" />
          </div>

          <select value={recurrenceFreq} onChange={(e) => setRecurrenceFreq(e.target.value as RecurrenceFreq)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">
            {RECURRENCE_FREQS.map((f) => (
              <option key={f} value={f}>{RECURRENCE_LABELS[f]}</option>
            ))}
          </select>

          {recurrenceFreq !== "NONE" && (
            <div className="rounded-xl bg-gray-50 p-3 space-y-2">
              <p className="text-xs text-gray-500">پایان تکرار</p>
              <div className="flex gap-1.5">
                {(
                  [
                    { key: "NEVER", label: "بدون پایان" },
                    { key: "COUNT", label: "با تعداد" },
                    { key: "DATE", label: "با تاریخ" },
                  ] as const
                ).map((opt) => (
                  <button
                    type="button"
                    key={opt.key}
                    onClick={() => setRecurrenceEndMode(opt.key)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg ${
                      recurrenceEndMode === opt.key ? "bg-brand-600 text-white" : "bg-white text-gray-500 border border-gray-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {recurrenceEndMode === "COUNT" && (
                <input
                  type="number"
                  dir="ltr"
                  min={1}
                  max={500}
                  value={recurrenceCount}
                  onChange={(e) => setRecurrenceCount(e.target.value)}
                  placeholder="تعداد تکرار"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-right"
                />
              )}
              {recurrenceEndMode === "DATE" && <JalaliDateInput value={recurrenceUntil} onChange={setRecurrenceUntil} />}
            </div>
          )}

          {!isEdit && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">یادآوری</p>
              <div className="flex flex-wrap gap-1.5">
                {REMINDER_OFFSET_PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.minutes}
                    onClick={() => toggleOffset(p.minutes)}
                    className={`text-xs px-2.5 py-1 rounded-full ${
                      reminderOffsets.includes(p.minutes) ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-waste-600">{error}</p>}

          <div className="flex gap-2">
            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 rounded-xl border border-waste-200 text-waste-600 hover:bg-waste-50 transition disabled:opacity-40"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            )}
            <button type="submit" disabled={loading} className="flex-1 rounded-xl bg-brand-600 text-white py-2.5 text-sm font-medium hover:bg-brand-700 disabled:opacity-40">
              {loading ? "در حال ثبت..." : isEdit ? "ذخیره تغییرات" : "ثبت رویداد"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

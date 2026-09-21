"use client";

import { useState } from "react";
import { apiPatch, apiDelete, ApiClientError } from "@/lib/apiClient";
import { useCategories } from "@/lib/hooks";
import { notifySaved } from "@/lib/savedToast";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import MoneyInput from "@/components/ui/MoneyInput";
import TimePicker from "@/components/ui/TimePicker";
import CategoryChipPicker, { selectableCategories } from "@/components/CategoryChipPicker";
import OverlapNotice from "@/components/day/OverlapNotice";
import { overlapRefusal, type OverlapRefusal } from "@/lib/overlapClient";
import { dayKeyIso } from "@/lib/calendarGrid";
import { VALUE_TYPES, VALUE_TYPE_LABELS, type ValueType } from "@/lib/types";
import { XIcon, TrashIcon } from "@/components/icons";

type FlowType = "COST" | "INCOME";

function hhmm(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Edit (or delete) a task from the day's list — the same fields Quick Capture asks for: what it
 * was, its category, the day and the time it ran, and the money that moved. Saving a time that lies
 * on top of another entry shows what it collides with and lets the person save anyway.
 */
export default function TaskEditModal({
  task,
  onClose,
  onSaved,
  onDeleted,
}: {
  task: any;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { categories } = useCategories();
  const startAt = task.startAt ? new Date(task.startAt) : null;
  const endAt = task.endAt ? new Date(task.endAt) : null;

  const [title, setTitle] = useState<string>(task.title);
  const [valueType, setValueType] = useState<ValueType>((task.valueType as ValueType) ?? "EXPENSE");
  const [categoryId, setCategoryId] = useState<string | null>(task.categoryId ?? null);
  const [day, setDay] = useState<Date>(startAt ?? (task.dueDate ? new Date(task.dueDate) : new Date()));
  const [startTime, setStartTime] = useState(startAt ? hhmm(startAt) : "");
  const [endTime, setEndTime] = useState(endAt ? hhmm(endAt) : "");
  const [flowType, setFlowType] = useState<FlowType>(task.incomeAmount > 0 ? "INCOME" : "COST");
  const [amount, setAmount] = useState(task.incomeAmount > 0 ? String(task.incomeAmount) : task.directCost > 0 ? String(task.directCost) : "");
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<OverlapRefusal | null>(null);

  // A project's own category is offered under both nature tabs (same rule as Quick Capture).
  const visibleCategories = selectableCategories(categories, (c: any) => !!(c.projectId || c.valueType === valueType || c.id === task.categoryId));

  async function save(allowOverlap: boolean) {
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    setOverlap(null);
    try {
      const day10 = dayKeyIso(day);
      const start = startTime ? new Date(`${day10}T${startTime}:00`) : null;
      const end = endTime ? new Date(`${day10}T${endTime}:00`) : null;
      const money = amount ? Number(amount) : 0;

      await apiPatch(`/api/tasks/${task.id}`, {
        title,
        categoryId,
        valueType,
        dueDate: new Date(`${day10}T00:00:00`).toISOString(),
        startAt: start ? start.toISOString() : null,
        endAt: end ? end.toISOString() : null,
        directCost: flowType === "COST" ? money : 0,
        incomeAmount: flowType === "INCOME" ? money : 0,
        allowOverlap: allowOverlap || undefined,
      });
      notifySaved();
      onSaved();
    } catch (err) {
      const refusal = overlapRefusal(err);
      if (refusal) setOverlap(refusal);
      else setError(err instanceof ApiClientError ? err.message : "ذخیره انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    if (!confirm(`«${task.title}» حذف شود؟`)) return;
    setDeleting(true);
    setError(null);
    try {
      await apiDelete(`/api/tasks/${task.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "حذف انجام نشد.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-md mx-auto bg-surface rounded-t-2xl shadow-xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h2 className="font-bold text-ink">ویرایش کار</h2>
          <button onClick={onClose} className="text-muted hover:text-ink p-1" aria-label="بستن">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
          className="p-5 space-y-4"
        >
          <input
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="چیکار کردی؟"
            className="bg-surface w-full rounded-xl border border-line px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-400"
          />

          <div className="flex gap-2">
            {VALUE_TYPES.map((v) => (
              <button
                type="button"
                key={v}
                onClick={() => setValueType(v)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                  valueType === v ? "bg-accent-soft text-accent border border-accent" : "bg-canvas text-muted border border-transparent"
                }`}
              >
                {VALUE_TYPE_LABELS[v]}
              </button>
            ))}
          </div>

          <div>
            <p className="text-xs text-muted mb-1.5">دسته‌بندی</p>
            <CategoryChipPicker
              categories={visibleCategories}
              selectedId={categoryId}
              allowClear
              onPick={(c) => {
                setCategoryId(c?.id ?? null);
                if (c && !c.projectId) setValueType(c.valueType);
              }}
              emptyHint={`دسته‌بندی‌ای برای «${VALUE_TYPE_LABELS[valueType]}» فعال نیست.`}
            />
          </div>

          <div>
            <label className="text-xs text-muted mb-1.5 block">روز</label>
            <JalaliDateInput
              value={day}
              onChange={(d) => {
                setDay(d);
                setOverlap(null);
              }}
            />
          </div>

          <div>
            <label className="text-xs text-muted mb-1.5 block">زمان (اختیاری)</label>
            <div className="grid grid-cols-2 gap-2">
              <TimePicker
                value={startTime}
                onChange={(v) => {
                  setStartTime(v);
                  setOverlap(null);
                }}
                placeholder="شروع"
              />
              <TimePicker
                value={endTime}
                onChange={(v) => {
                  setEndTime(v);
                  setOverlap(null);
                }}
                placeholder="پایان"
              />
            </div>
          </div>

          <div>
            <div className="flex gap-2 mb-1.5">
              <button
                type="button"
                onClick={() => setFlowType("COST")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${flowType === "COST" ? "bg-waste-soft text-waste" : "bg-canvas text-muted"}`}
              >
                هزینه انجام‌شده
              </button>
              <button
                type="button"
                onClick={() => setFlowType("INCOME")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${flowType === "INCOME" ? "bg-accent-soft text-accent" : "bg-canvas text-muted"}`}
              >
                درآمد ثبت‌شده
              </button>
            </div>
            <MoneyInput value={amount} onChange={setAmount} placeholder="۰" />
          </div>

          {overlap && <OverlapNotice refusal={overlap} saving={loading} onSaveAnyway={() => void save(true)} />}
          {error && <p className="text-sm text-waste">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading || deleting}
              className="flex-1 rounded-xl bg-accent text-on-accent py-3 text-sm font-medium hover:opacity-90 transition disabled:opacity-40"
            >
              {loading ? "در حال ذخیره..." : "ذخیره"}
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={loading || deleting}
              aria-label="حذف کار"
              className="px-4 rounded-xl bg-waste-soft text-waste disabled:opacity-40"
            >
              <TrashIcon className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

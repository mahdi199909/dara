"use client";

import { useEffect, useState } from "react";
import { mutate } from "swr";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { useCategories } from "@/lib/hooks";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import MoneyInput from "@/components/ui/MoneyInput";
import TimeScrollPicker from "@/components/ui/TimeScrollPicker";
import { CAPTURE_TYPES, CAPTURE_TYPE_LABELS, VALUE_TYPES, VALUE_TYPE_LABELS, type CaptureEntityType, type ValueType } from "@/lib/types";

function refreshAllCaches() {
  mutate("/api/dashboard");
  mutate("/api/tasks");
  mutate((key) => typeof key === "string" && key.startsWith("/api/events"));
  mutate((key) => typeof key === "string" && key.startsWith("/api/reports"));
  mutate((key) => typeof key === "string" && key.startsWith("/api/transactions"));
  mutate("/api/accounts");
  mutate((key) => typeof key === "string" && key.startsWith("/api/virtual-assets"));
}

type FlowType = "COST" | "INCOME";

export default function CaptureForm({ onDone }: { onDone: () => void }) {
  const { categories } = useCategories();

  const [title, setTitle] = useState("");
  const [entityType, setEntityType] = useState<CaptureEntityType>("TASK");
  const [valueType, setValueType] = useState<ValueType>("EXPENSE");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [day, setDay] = useState(new Date());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [flowType, setFlowType] = useState<FlowType>("COST");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A project's auto-generated category is shown regardless of the Expense/Asset tab — a
  // project can incur both (buying a part is an expense, time spent is an asset), so tying
  // its category to only one tab would make it impossible to log the other kind against it.
  const visibleCategories = categories.filter((c: any) => c.isActive && (c.projectId || c.valueType === valueType));

  useEffect(() => {
    // Selected category no longer matches the visible (filtered) list — clear it rather
    // than silently submitting a category that doesn't match the chosen Expense/Asset nature.
    if (categoryId && !visibleCategories.some((c: any) => c.id === categoryId)) {
      setCategoryId(null);
      setProjectId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueType, categories]);

  function pickCategory(cat: any) {
    setCategoryId(cat.id);
    // Project categories are visible under both tabs (see visibleCategories above), so
    // picking one shouldn't force-switch the tab and override the هزینه/دارایی the user
    // already chose — only a regular, single-purpose category drives the tab from its tag.
    if (!cat.projectId) setValueType(cat.valueType);
    // A project's auto-generated category carries its projectId — picking it also tags
    // the entry to that project, so it shows up in the project's own cash flow / cost view
    // without a second "which project" step.
    setProjectId(cat.projectId ?? null);
  }

  function dayIso(d: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const amountNum = amount ? Number(amount) : undefined;
      const day10 = dayIso(day);

      if (entityType === "TASK") {
        const dueDate = new Date(`${day10}T00:00:00`);
        const startAt = startTime ? new Date(`${day10}T${startTime}:00`) : undefined;
        const endAt = endTime ? new Date(`${day10}T${endTime}:00`) : undefined;

        await apiPost("/api/tasks", {
          title,
          categoryId: categoryId ?? undefined,
          projectId: projectId ?? undefined,
          dueDate: dueDate.toISOString(),
          valueType,
          directCost: flowType === "COST" ? amountNum : undefined,
          incomeAmount: flowType === "INCOME" ? amountNum : undefined,
          startAt: startAt?.toISOString(),
          endAt: endAt?.toISOString(),
        });
      } else {
        let startAt: Date;
        let endAt: Date;
        let allDay: boolean;

        if (startTime) {
          startAt = new Date(`${day10}T${startTime}:00`);
          endAt = endTime ? new Date(`${day10}T${endTime}:00`) : new Date(startAt.getTime() + 60 * 60000);
          allDay = false;
        } else {
          startAt = new Date(`${day10}T00:00:00`);
          endAt = new Date(`${day10}T23:59:59`);
          allDay = true;
        }

        await apiPost("/api/events", {
          title,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          allDay,
          categoryId: categoryId ?? undefined,
          projectId: projectId ?? undefined,
          valueType,
          directCost: flowType === "COST" ? amountNum : undefined,
          incomeAmount: flowType === "INCOME" ? amountNum : undefined,
        });
      }

      refreshAllCaches();
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ثبت انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input
        autoFocus
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="چیکار کردی؟"
        className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-400"
      />

      <div className="flex gap-2">
        {CAPTURE_TYPES.map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setEntityType(t)}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
              entityType === t ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-500"
            }`}
          >
            {CAPTURE_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {VALUE_TYPES.map((v) => (
          <button
            type="button"
            key={v}
            onClick={() => setValueType(v)}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
              valueType === v ? "bg-brand-100 text-brand-700 border border-brand-300" : "bg-gray-50 text-gray-500 border border-transparent"
            }`}
          >
            {VALUE_TYPE_LABELS[v]}
          </button>
        ))}
      </div>

      <div>
        <p className="text-xs text-gray-500 mb-1.5">دسته‌بندی</p>
        {visibleCategories.length === 0 ? (
          <p className="text-xs text-gray-400">
            دسته‌بندی‌ای برای «{VALUE_TYPE_LABELS[valueType]}» فعال نیست — از تنظیمات اضافه کنید.
          </p>
        ) : (
          <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
            {visibleCategories.map((c: any) => (
              <button
                type="button"
                key={c.id}
                onClick={() => pickCategory(c)}
                className={`shrink-0 flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition ${
                  categoryId === c.id ? "bg-brand-600 text-white border-brand-600" : "bg-white text-gray-600 border-gray-200"
                }`}
              >
                <span>{c.icon}</span>
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1.5 block">روز</label>
        <JalaliDateInput value={day} onChange={setDay} />
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1.5 block">زمان (اختیاری)</label>
        <div className="grid grid-cols-2 gap-2">
          <TimeScrollPicker value={startTime} onChange={setStartTime} placeholder="شروع" />
          <TimeScrollPicker value={endTime} onChange={setEndTime} placeholder="پایان" />
        </div>
      </div>

      <div>
        <div className="flex gap-2 mb-1.5">
          <button
            type="button"
            onClick={() => setFlowType("COST")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${
              flowType === "COST" ? "bg-waste-100 text-waste-600" : "bg-gray-50 text-gray-400"
            }`}
          >
            هزینه انجام‌شده
          </button>
          <button
            type="button"
            onClick={() => setFlowType("INCOME")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${
              flowType === "INCOME" ? "bg-brand-100 text-brand-700" : "bg-gray-50 text-gray-400"
            }`}
          >
            درآمد ثبت‌شده
          </button>
        </div>
        <MoneyInput value={amount} onChange={setAmount} placeholder="۰" />
      </div>

      {error && <p className="text-sm text-waste-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-brand-600 text-white py-3 text-sm font-medium hover:bg-brand-700 transition disabled:opacity-40"
      >
        {loading ? "در حال ثبت..." : "ثبت"}
      </button>
    </form>
  );
}

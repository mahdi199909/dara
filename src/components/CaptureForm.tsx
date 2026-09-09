"use client";

import { useEffect, useState } from "react";
import { mutate } from "swr";
import { apiPost, ApiClientError } from "@/lib/apiClient";
import { useCategories } from "@/lib/hooks";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import MoneyInput from "@/components/ui/MoneyInput";
import TimePicker from "@/components/ui/TimePicker";
import { PlusIcon } from "@/components/icons";
import { CAPTURE_TYPES, CAPTURE_TYPE_LABELS, VALUE_TYPES, VALUE_TYPE_LABELS, type CaptureEntityType, type ValueType } from "@/lib/types";

function refreshAllCaches() {
  mutate("/api/dashboard");
  mutate("/api/tasks");
  mutate((key) => typeof key === "string" && key.startsWith("/api/events"));
  mutate((key) => typeof key === "string" && key.startsWith("/api/reports"));
  mutate((key) => typeof key === "string" && key.startsWith("/api/transactions"));
  mutate("/api/accounts");
  mutate((key) => typeof key === "string" && key.startsWith("/api/virtual-assets"));
  mutate("/api/day-battery");
  mutate("/api/capital");
}

type FlowType = "COST" | "INCOME";

// Plain ASCII "HH:MM", 24-hour — matches TimePicker's own value format, which submit()
// below feeds straight into `new Date(\`${day10}T${startTime}:00\`)`. Not jalali.ts's formatTime:
// that one applies toPersianDigits, which would break that exact Date-string parse.
function hhmm(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** What CaptureForm just submitted, for the Companion's immediate reaction (see its Home
 * wiring) — deliberately omits a "virtual asset" case, since that reaction already exists
 * (UpgradeToast, watching /api/virtual-assets/latest-effect) and would otherwise double up. */
export interface CaptureSummary {
  kind: "PRODUCTIVE" | "EXPENSE" | "WASTE";
  minutes?: number;
  amount?: number;
}

export default function CaptureForm({
  onDone,
  initialStart,
  initialEnd,
}: {
  onDone: (summary?: CaptureSummary) => void;
  /** Pre-fills day/start/end — see DayBattery's "tap an unlogged gap" flow, the mandatory
   * "path" in the pain→path→pride rule. Only meaningful together; a lone initialStart with no
   * initialEnd is still honored (end just stays blank for the user to fill in). */
  initialStart?: Date;
  initialEnd?: Date;
}) {
  const { categories, mutate: mutateCategories } = useCategories();
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategoryError, setAddingCategoryError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [entityType, setEntityType] = useState<CaptureEntityType>("TASK");
  const [valueType, setValueType] = useState<ValueType>("EXPENSE");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [day, setDay] = useState(initialStart ?? new Date());
  const [startTime, setStartTime] = useState(initialStart ? hhmm(initialStart) : "");
  const [endTime, setEndTime] = useState(initialEnd ? hhmm(initialEnd) : "");
  const [flowType, setFlowType] = useState<FlowType>("COST");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A project's auto-generated category is shown regardless of the Expense/Asset tab — a
  // project can incur both (buying a part is an expense, time spent is an asset), so tying
  // its category to only one tab would make it impossible to log the other kind against it.
  // Defends against duplicate rows sharing a name (e.g. a double-submitted "new category")
  // showing up twice — first-seen wins, same order the list already comes in.
  const seenCategoryNames = new Set<string>();
  const visibleCategories = categories
    .filter((c: any) => c.isActive && (c.projectId || c.valueType === valueType))
    .filter((c: any) => {
      if (seenCategoryNames.has(c.name)) return false;
      seenCategoryNames.add(c.name);
      return true;
    });

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

  async function createCategoryInline() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    setAddingCategoryError(null);
    try {
      // Defaults to EXPENSE/NEUTRAL and a generic tag icon — a category made in passing here
      // isn't worth interrupting the capture flow with the full kind/icon/color form; the user
      // can fully configure it afterwards in تنظیمات ← دسته‌بندی‌ها (see CategoriesTab).
      const { category } = await apiPost<{ category: any }>("/api/categories", { name: trimmed, valueType: "EXPENSE", icon: "🏷️" });
      await mutateCategories();
      pickCategory(category);
      setNewCategoryName("");
      setAddingCategory(false);
    } catch (err) {
      setAddingCategoryError(err instanceof ApiClientError ? err.message : "ساخت دسته‌بندی انجام نشد.");
    }
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

      const pickedCategory = categoryId ? categories.find((c: any) => c.id === categoryId) : null;
      const durationMin = startTime && endTime ? Math.round((new Date(`${day10}T${endTime}:00`).getTime() - new Date(`${day10}T${startTime}:00`).getTime()) / 60000) : undefined;
      let summary: CaptureSummary | undefined;
      if (flowType === "COST" && amountNum && amountNum > 0) {
        summary = { kind: "EXPENSE", amount: amountNum };
      } else if (pickedCategory?.kind === "WASTE") {
        summary = { kind: "WASTE" };
      } else if (pickedCategory?.kind === "PRODUCTIVE" && durationMin && durationMin > 0) {
        summary = { kind: "PRODUCTIVE", minutes: durationMin };
      }

      onDone(summary);
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
        className="bg-surface w-full rounded-xl border border-line px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-400"
      />

      <div className="flex gap-2">
        {CAPTURE_TYPES.map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setEntityType(t)}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
              entityType === t ? "bg-accent text-on-accent" : "bg-canvas text-muted"
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
              valueType === v ? "bg-accent-soft text-accent border border-accent" : "bg-canvas text-muted border border-transparent"
            }`}
          >
            {VALUE_TYPE_LABELS[v]}
          </button>
        ))}
      </div>

      <div>
        <p className="text-xs text-muted mb-1.5">دسته‌بندی</p>
        <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
          {visibleCategories.map((c: any) => (
            <button
              type="button"
              key={c.id}
              onClick={() => pickCategory(c)}
              className={`shrink-0 flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition ${
                categoryId === c.id ? "bg-accent text-on-accent border-accent" : "bg-surface text-ink border-line"
              }`}
            >
              <span>{c.icon}</span>
              {c.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAddingCategory(true)}
            className="shrink-0 flex items-center gap-1 text-sm px-3 py-1.5 rounded-full border border-dashed border-line text-muted hover:border-accent hover:text-accent transition"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            دسته‌بندی جدید
          </button>
        </div>
        {visibleCategories.length === 0 && !addingCategory && (
          <p className="text-xs text-muted mt-1">دسته‌بندی‌ای برای «{VALUE_TYPE_LABELS[valueType]}» فعال نیست.</p>
        )}
        {addingCategory && (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    createCategoryInline();
                  }
                }}
                placeholder="نام دسته‌بندی جدید"
                className="bg-surface flex-1 rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <button type="button" onClick={createCategoryInline} className="shrink-0 rounded-xl bg-accent text-on-accent px-3 py-2 text-xs font-medium">
                ثبت
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingCategory(false);
                  setNewCategoryName("");
                  setAddingCategoryError(null);
                }}
                className="shrink-0 text-xs text-muted px-1"
              >
                انصراف
              </button>
            </div>
            <p className="text-[11px] text-muted">به‌صورت پیش‌فرض «هزینه» ثبت می‌شود — تنظیمات کامل‌تر از تنظیمات ← دسته‌بندی‌ها.</p>
            {addingCategoryError && <p className="text-xs text-waste">{addingCategoryError}</p>}
          </div>
        )}
      </div>

      <div>
        <label className="text-xs text-muted mb-1.5 block">روز</label>
        <JalaliDateInput value={day} onChange={setDay} />
      </div>

      <div>
        <label className="text-xs text-muted mb-1.5 block">زمان (اختیاری)</label>
        <div className="grid grid-cols-2 gap-2">
          <TimePicker value={startTime} onChange={setStartTime} placeholder="شروع" />
          <TimePicker value={endTime} onChange={setEndTime} placeholder="پایان" />
        </div>
      </div>

      <div>
        <div className="flex gap-2 mb-1.5">
          <button
            type="button"
            onClick={() => setFlowType("COST")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${
              flowType === "COST" ? "bg-waste-soft text-waste" : "bg-canvas text-muted"
            }`}
          >
            هزینه انجام‌شده
          </button>
          <button
            type="button"
            onClick={() => setFlowType("INCOME")}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition ${
              flowType === "INCOME" ? "bg-accent-soft text-accent" : "bg-canvas text-muted"
            }`}
          >
            درآمد ثبت‌شده
          </button>
        </div>
        <MoneyInput value={amount} onChange={setAmount} placeholder="۰" />
      </div>

      {error && <p className="text-sm text-waste">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-accent text-on-accent py-3 text-sm font-medium hover:opacity-90 transition disabled:opacity-40"
      >
        {loading ? "در حال ثبت..." : "ثبت"}
      </button>
    </form>
  );
}

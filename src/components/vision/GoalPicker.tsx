"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import type { VisionItemDto } from "@/lib/schemas/vision";
import { formatVisionValue, parseVisionNumber } from "@/lib/visionFormat";

export interface GoalChoice {
  visionItemId: string | null;
  /** What the person typed, so a half-typed number is not lost; parsed with goalAmount(). */
  amountText: string;
}

export const NO_GOAL: GoalChoice = { visionItemId: null, amountText: "1" };

/** The amount a choice stands for: what was typed, 1 when it is empty or not a number. */
export function goalAmount(choice: GoalChoice): number {
  return parseVisionNumber(choice.amountText) ?? 1;
}

/**
 * «این کار به کدام هدف می‌شمارد؟» — lets a task count toward one of the person's goals on the vision
 * board. Offers only active goals that have a yardstick; shows nothing at all when there are none, so
 * a person who does not use the vision board never sees it.
 */
export default function GoalPicker({ value, onChange }: { value: GoalChoice; onChange: (next: GoalChoice) => void }) {
  const { data } = useSWR<{ items: VisionItemDto[] }>("/api/vision", fetcher);
  const goals = (data?.items ?? []).filter((i) => i.status === "ACTIVE" && i.targetValue !== null);
  if (goals.length === 0) return null;

  const chosen = goals.find((g) => g.id === value.visionItemId) ?? null;
  const unit = chosen?.unit ?? "";

  return (
    <div>
      <label className="text-xs text-muted mb-1.5 block">به کدام هدف می‌شمارد؟ (اختیاری)</label>
      <div className="flex gap-2">
        <select
          value={value.visionItemId ?? ""}
          onChange={(e) => onChange({ visionItemId: e.target.value || null, amountText: value.amountText || "1" })}
          className="bg-surface flex-1 min-w-0 rounded-xl border border-line px-3 py-2 text-sm"
          aria-label="هدف"
        >
          <option value="">بدون هدف</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.icon ? `${g.icon} ` : "🎯 "}
              {g.title}
              {g.current !== null && g.targetValue !== null ? ` (${formatVisionValue(g.current)} از ${formatVisionValue(g.targetValue)})` : ""}
            </option>
          ))}
        </select>
        {chosen && (
          <div className="relative w-28 shrink-0">
            <input
              dir="ltr"
              inputMode="decimal"
              value={value.amountText}
              onChange={(e) => onChange({ ...value, amountText: e.target.value })}
              className="bg-surface w-full rounded-xl border border-line px-3 py-2 text-sm text-right"
              aria-label={`مقدار${unit ? ` (${unit})` : ""}`}
            />
            {unit && <span className="absolute left-2 -bottom-4 text-[10px] text-muted whitespace-nowrap">{unit}</span>}
          </div>
        )}
      </div>
      {chosen && <p className="text-[11px] text-muted mt-5">هر وقت این کار انجام‌شده باشد، {formatVisionValue(goalAmount(value))} {unit} به پیشرفت «{chosen.title}» اضافه می‌شود.</p>}
    </div>
  );
}

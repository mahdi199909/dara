"use client";

import { useState } from "react";
import { useCategories } from "@/lib/hooks";
import { fetcher, apiPost } from "@/lib/apiClient";
import type { CaptureSummary } from "@/lib/captureSave";
import { resolveEntry } from "@/lib/captureResolve";
import { runSteps } from "@/lib/captureSteps";
import { refreshAllCaches } from "@/lib/refreshCaches";
import { notifySaved } from "@/lib/savedToast";
import { matchCategoryHint, matchProjectHint, type CapturePrefill } from "@/lib/smartCapture";
import { formatJalali, formatTime as formatJalaliTime } from "@/lib/jalali";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import { CAPTURE_TYPE_LABELS } from "@/lib/types";
import { XIcon } from "./icons";

/**
 * What smart capture (src/lib/smartCapture.ts) shows instead of jumping straight to the full
 * form: a one-glance summary of exactly what was understood, with تأیید (save it, as read) and
 * اصلاح (open the full form to fix something first) — reviewing a short summary is a smaller ask
 * than reviewing a whole form for the common case where the parse just got it right.
 */
export default function SmartCaptureConfirm({
  prefill,
  onConfirmed,
  onEdit,
  onCancel,
}: {
  prefill: CapturePrefill;
  onConfirmed: (summary?: CaptureSummary) => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const { categories, mutate: mutateCategories } = useCategories();
  const { format } = useCurrencyUnit();
  const [saving, setSaving] = useState(false);

  const matchedCategory = prefill.categoryHint ? matchCategoryHint(prefill.categoryHint, categories) : null;
  const matchedProjectCategory = prefill.projectHint ? matchProjectHint(prefill.projectHint, categories) : null;
  const willCreateProject = !!prefill.projectHint && !matchedProjectCategory;

  const day = prefill.day ?? new Date();
  const dayLabel = formatJalali(day, { long: true });
  const timeLabel = prefill.start ? `${formatJalaliTime(prefill.start)}${prefill.end ? ` تا ${formatJalaliTime(prefill.end)}` : ""}` : null;

  async function handleConfirm() {
    setSaving(true);
    try {
      // What is saved — and what a line typed into the phone's widget saves — is worked out in one place.
      const resolution = resolveEntry(prefill, categories, new Date());
      const results = await runSteps(resolution.steps, (call) => (call.method === "GET" ? fetcher(call.url) : apiPost(call.url, call.body)));
      // A new project comes with a category of its own (read back above with a plain fetch). Revalidating
      // through useCategories' own `mutate` matters: refreshAllCaches below never touches /api/categories,
      // so without this the SWR cache every other category picker reads from — including the next
      // smart-capture confirm card — would keep showing the pre-project list until something unrelated
      // happened to revalidate it.
      if (willCreateProject) await mutateCategories();
      refreshAllCaches();
      notifySaved();
      onConfirmed(resolution.summarize?.(results));
    } catch {
      // Any failure — including a time overlap — falls back to the full form, which already
      // knows how to show that conflict (OverlapNotice) and let the person resolve it there.
      onEdit();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onCancel}>
      <div className="w-full max-w-md mx-auto bg-surface rounded-t-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h2 className="font-bold text-ink">این ثبت بشه؟</h2>
          <button onClick={onCancel} className="text-muted hover:text-ink p-1" aria-label="بستن">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 pt-2 space-y-3">
          <div>
            <p className="text-base font-bold text-ink">{prefill.title}</p>
            <p className="text-xs text-muted mt-0.5">
              {CAPTURE_TYPE_LABELS[prefill.entityType]} · {dayLabel}
              {timeLabel ? ` · ${timeLabel}` : ""}
            </p>
          </div>

          {prefill.amount != null && (
            <div className="flex items-center gap-2 text-sm">
              <span className={prefill.flowType === "COST" ? "text-waste" : "text-accent"}>
                {prefill.flowType === "COST" ? "هزینه" : "درآمد"}
              </span>
              <span className="font-bold text-ink">{format(prefill.amount, { withSuffix: true })}</span>
            </div>
          )}

          {matchedCategory && (
            <span className="inline-block text-xs px-2.5 py-1 rounded-full bg-accent-soft text-accent">{matchedCategory.name}</span>
          )}

          {matchedProjectCategory && (
            <span className="inline-block text-xs px-2.5 py-1 rounded-full bg-accent-soft text-accent mr-1.5">
              پروژه: {matchedProjectCategory.name}
            </span>
          )}
          {willCreateProject && (
            <span className="inline-block text-xs px-2.5 py-1 rounded-full border border-dashed border-accent text-accent mr-1.5">
              پروژه جدید: {prefill.projectHint}
            </span>
          )}
        </div>

        <div className="p-5 pt-0 flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            disabled={saving}
            className="flex-1 py-3 rounded-xl bg-canvas text-ink text-sm font-medium disabled:opacity-40"
          >
            اصلاح
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="flex-1 py-3 rounded-xl bg-accent text-on-accent text-sm font-medium disabled:opacity-40"
          >
            {saving ? "در حال ثبت..." : "تأیید"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { formatTime } from "@/lib/jalali";
import type { OverlapRefusal } from "@/lib/overlapClient";

const KIND_LABEL: Record<string, string> = { TASK: "کار", EVENT: "رویداد", TIME_ENTRY: "فعالیت" };

/**
 * A warning, not a wall: shown in a form when the time it was about to save lies on top of something
 * else — what it collides with, and the two ways on: change the time, or save it overlapping on purpose.
 */
export default function OverlapNotice({
  refusal,
  saving,
  onSaveAnyway,
}: {
  refusal: OverlapRefusal;
  saving?: boolean;
  onSaveAnyway: () => void;
}) {
  return (
    <div role="alert" className="rounded-xl border border-signal-300 bg-signal-50 px-3 py-2.5 space-y-2">
      <p className="text-sm font-medium text-signal-700">هشدار: این زمان با کار دیگری هم‌پوشانی دارد</p>
      {refusal.conflicts.length > 0 ? (
        <ul className="space-y-1">
          {refusal.conflicts.slice(0, 3).map((c) => (
            <li key={`${c.kind}-${c.id}-${c.start}`} className="flex items-center justify-between gap-2 text-xs text-signal-700">
              <span className="truncate">
                «{c.title}» <span className="opacity-75">({KIND_LABEL[c.kind] ?? c.kind})</span>
              </span>
              <span className="shrink-0" dir="ltr">
                {formatTime(new Date(c.start))} – {formatTime(new Date(c.end))}
              </span>
            </li>
          ))}
          {refusal.conflicts.length > 3 && <li className="text-xs text-signal-700">و {refusal.conflicts.length - 3} مورد دیگر</li>}
        </ul>
      ) : (
        <p className="text-xs text-signal-700">{refusal.message}</p>
      )}
      <p className="text-xs text-signal-700">زمان را تغییر دهید، یا اگر عمداً هم‌زمان‌اند همین‌طور ثبتش کنید.</p>
      <button
        type="button"
        onClick={onSaveAnyway}
        disabled={saving}
        className="w-full rounded-lg border border-signal-500 text-signal-700 py-1.5 text-xs font-medium hover:bg-signal-100 disabled:opacity-40"
      >
        {saving ? "در حال ثبت..." : "ثبت با هم‌پوشانی"}
      </button>
    </div>
  );
}

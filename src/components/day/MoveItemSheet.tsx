"use client";

import { useState } from "react";
import { apiPatch, ApiClientError } from "@/lib/apiClient";
import Sheet from "@/components/ui/Sheet";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import TimePicker from "@/components/ui/TimePicker";
import OverlapNotice from "@/components/day/OverlapNotice";
import { overlapRefusal, type OverlapRefusal } from "@/lib/overlapClient";
import { cannotMoveReason, hasClockTime, planMove, tomorrowOf, type Movable, type MoveTarget } from "@/lib/moveItem";

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" of a moment, the form TimePicker speaks. */
function clockOf(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Moves a task or an event with the routes that already exist for them. A refused overlap is thrown as it came (see overlapRefusal). */
export async function applyMove(item: Movable, target: MoveTarget, allowOverlap = false): Promise<void> {
  const patch = planMove(item, target);
  const url = item.kind === "TASK" ? `/api/tasks/${item.id}` : `/api/events/${item.id}`;
  await apiPatch(url, { ...patch, ...(allowOverlap ? { allowOverlap: true } : {}) });
}

/**
 * «جابه‌جا کردن»: a task or an event to another day, and — when it has a time of day — another time. It opens on
 * tomorrow with its own time, so "just tomorrow" is one tap; a collision is a warning with a way on, not a wall.
 */
export default function MoveItemSheet({
  item,
  initialDay,
  initialRefusal,
  onClose,
  onMoved,
}: {
  item: Movable;
  /** Where the date starts; tomorrow when left out. */
  initialDay?: Date;
  /** A collision already met by a quick move, shown straight away. */
  initialRefusal?: OverlapRefusal | null;
  onClose: () => void;
  onMoved: () => void;
}) {
  const reason = cannotMoveReason(item);
  const timed = hasClockTime(item);
  const [day, setDay] = useState<Date>(() => initialDay ?? tomorrowOf(new Date()));
  const [time, setTime] = useState<string>(() => (timed && item.startAt ? clockOf(item.startAt) : ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<OverlapRefusal | null>(initialRefusal ?? null);

  async function move(allowOverlap: boolean) {
    setSaving(true);
    setError(null);
    setOverlap(null);
    try {
      await applyMove(item, { day, time: timed && time ? time : undefined }, allowOverlap);
      onMoved();
    } catch (err) {
      const refusal = overlapRefusal(err);
      if (refusal) setOverlap(refusal);
      else setError(err instanceof ApiClientError || err instanceof Error ? err.message : "جابه‌جا کردن انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="جابه‌جا کردن" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm font-medium text-ink">{item.title}</p>

        {reason ? (
          <p className="text-sm text-muted leading-relaxed">{reason}</p>
        ) : (
          <>
            <div>
              <label className="text-xs text-muted mb-1.5 block">به کدام روز؟</label>
              <JalaliDateInput value={day} onChange={(d) => { setDay(d); setOverlap(null); }} />
            </div>
            {timed && (
              <div>
                <label className="text-xs text-muted mb-1.5 block">ساعت شروع</label>
                <TimePicker value={time} onChange={(v) => { setTime(v); setOverlap(null); }} required />
              </div>
            )}
            {overlap && <OverlapNotice refusal={overlap} saving={saving} onSaveAnyway={() => void move(true)} />}
            {error && <p className="text-xs text-waste">{error}</p>}
            <div className="flex gap-2">
              <button type="button" disabled={saving} onClick={() => void move(false)} className="flex-1 rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium disabled:opacity-40">
                {saving ? "در حال جابه‌جایی..." : "جابه‌جا کن"}
              </button>
              <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2.5 text-sm text-muted">
                انصراف
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

"use client";

import { useMemo, useState } from "react";
import { apiPatch, apiPost, ApiClientError } from "@/lib/apiClient";
import Sheet from "@/components/ui/Sheet";
import TimePicker from "@/components/ui/TimePicker";
import OverlapNotice from "@/components/day/OverlapNotice";
import { overlapRefusal, type OverlapRefusal } from "@/lib/overlapClient";
import { toPersianDigits } from "@/lib/money";
import { DURATION_CHOICES, clockText, firstFreeStart, minutesOfClock, roundUp, type PlanBlock } from "@/lib/dayPlan";

/**
 * Gives a task a place on the day: a start time and a length, which become its block on the timeline. For a task that
 * is already there it sets its time; for a new block it makes the task too. It starts at the first free stretch that
 * fits the length (from now, on today), and a collision is a warning that names the other item, with a way on.
 */
export default function ScheduleSheet({
  task,
  day,
  blocks,
  fromMin,
  toMin,
  initialStartMin,
  onClose,
  onDone,
}: {
  /** An open task without a time; left out for a brand-new block. */
  task?: { id: string; title: string; boxMinutes: number | null };
  day: Date;
  blocks: readonly PlanBlock[];
  fromMin: number;
  toMin: number;
  /** Where the start is placed when the person tapped a spot on the timeline. */
  initialStartMin?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [duration, setDuration] = useState<number>(task?.boxMinutes ?? 60);
  const isToday = new Date().toDateString() === day.toDateString();
  const notBefore = isToday ? roundUp(new Date().getHours() * 60 + new Date().getMinutes()) : 0;
  const suggested = useMemo(() => firstFreeStart(blocks, duration, fromMin, toMin, notBefore), [blocks, duration, fromMin, toMin, notBefore]);
  const [time, setTime] = useState<string>(() => clockText(initialStartMin ?? firstFreeStart(blocks, task?.boxMinutes ?? 60, fromMin, toMin, notBefore) ?? Math.max(fromMin, notBefore)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<OverlapRefusal | null>(null);

  const choices = DURATION_CHOICES.includes(duration as (typeof DURATION_CHOICES)[number]) ? [...DURATION_CHOICES] : [...DURATION_CHOICES, duration].sort((a, b) => a - b);

  async function save(allowOverlap: boolean) {
    const startMin = minutesOfClock(time);
    if (startMin === null) {
      setError("ساعت شروع را انتخاب کن.");
      return;
    }
    if (!task && !title.trim()) {
      setError("اسم بلوک را بنویس.");
      return;
    }
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const startAt = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, startMin);
    const endAt = new Date(startAt.getTime() + duration * 60_000);
    setSaving(true);
    setError(null);
    setOverlap(null);
    try {
      const times = { dueDate: dayStart.toISOString(), startAt: startAt.toISOString(), endAt: endAt.toISOString(), ...(allowOverlap ? { allowOverlap: true } : {}) };
      if (task) await apiPatch(`/api/tasks/${task.id}`, times);
      else await apiPost("/api/tasks", { title: title.trim(), ...times });
      onDone();
    } catch (err) {
      const refusal = overlapRefusal(err);
      if (refusal) setOverlap(refusal);
      else setError(err instanceof ApiClientError || err instanceof Error ? err.message : "ذخیره نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title={task ? "زمان‌بندی کار" : "بلوک جدید"} onClose={onClose}>
      <div className="p-5 space-y-4">
        {task ? (
          <p className="text-sm font-medium text-ink">{task.title}</p>
        ) : (
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="این بلوک برای چیست؟ (مثلاً نوشتن گزارش)" aria-label="اسم بلوک" className="bg-surface w-full rounded-xl border border-line px-3 py-2.5 text-sm" />
        )}

        <div>
          <label className="text-xs text-muted mb-1.5 block">چقدر طول می‌کشد؟</label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="مدت">
            {choices.map((minutes) => (
              <button
                key={minutes}
                type="button"
                role="radio"
                aria-checked={duration === minutes}
                onClick={() => {
                  setDuration(minutes);
                  setOverlap(null);
                }}
                className={`text-sm px-3 py-1.5 rounded-full border transition ${duration === minutes ? "bg-accent text-on-accent border-accent" : "bg-surface text-ink border-line"}`}
              >
                {toPersianDigits(minutes)} دقیقه
              </button>
            ))}
          </div>
          {task?.boxMinutes ? <p className="text-[11px] text-muted mt-1.5">جعبهٔ این کار {toPersianDigits(task.boxMinutes)} دقیقه است.</p> : null}
        </div>

        <div>
          <label className="text-xs text-muted mb-1.5 block">ساعت شروع</label>
          <TimePicker
            value={time}
            onChange={(v) => {
              setTime(v);
              setOverlap(null);
            }}
            required
          />
          {suggested !== null && clockText(suggested) !== time && (
            <button type="button" onClick={() => setTime(clockText(suggested))} className="text-xs text-accent mt-1.5">
              اولین جای خالی: {toPersianDigits(clockText(suggested))}
            </button>
          )}
          {suggested === null && <p className="text-[11px] text-muted mt-1.5">برای این مدت جای خالیِ پیوسته‌ای در ساعت‌های امروز نیست؛ ساعت را خودت انتخاب کن.</p>}
        </div>

        {overlap && <OverlapNotice refusal={overlap} saving={saving} onSaveAnyway={() => void save(true)} />}
        {error && <p className="text-xs text-waste">{error}</p>}

        <div className="flex gap-2">
          <button type="button" disabled={saving} onClick={() => void save(false)} className="flex-1 rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium disabled:opacity-40">
            {saving ? "در حال ذخیره..." : "بگذار روی خط زمانی"}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2.5 text-sm text-muted">
            انصراف
          </button>
        </div>
      </div>
    </Sheet>
  );
}

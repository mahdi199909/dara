"use client";

import { useState } from "react";
import { apiPatch } from "@/lib/apiClient";
import Sheet from "@/components/ui/Sheet";
import { toPersianDigits, toAsciiDigits } from "@/lib/money";
import { BOX_CHOICES } from "@/lib/dayPlan";

/** The time box of one task: how long it may take. A tap on a length sets it; «بدون جعبه» takes it away. */
export default function BoxSheet({ task, onClose, onDone }: { task: { id: string; title: string; boxMinutes: number | null }; onClose: () => void; onDone: () => void }) {
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(boxMinutes: number | null) {
    setSaving(true);
    setError(null);
    try {
      await apiPatch(`/api/tasks/${task.id}`, { boxMinutes });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره نشد.");
    } finally {
      setSaving(false);
    }
  }

  function setCustomBox(e: React.FormEvent) {
    e.preventDefault();
    const minutes = Number(toAsciiDigits(custom).trim());
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      setError("مدت را به دقیقه و عدد صحیح بین ۱ تا ۱۴۴۰ بنویس.");
      return;
    }
    void set(minutes);
  }

  return (
    <Sheet title="جعبهٔ زمانی" onClose={onClose}>
      <div className="p-5 space-y-4">
        <p className="text-sm font-medium text-ink">{task.title}</p>
        <p className="text-xs text-muted leading-relaxed">جعبه یعنی «این کار حداکثر این‌قدر وقت می‌گیرد». وقتش تمام شد، کار را تمام یا برای بعد نگه می‌داری؛ مهم این است که بی‌انتها نمی‌شود.</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="طول جعبه">
          {BOX_CHOICES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              role="radio"
              aria-checked={task.boxMinutes === minutes}
              disabled={saving}
              onClick={() => void set(minutes)}
              className={`text-sm px-3 py-1.5 rounded-full border transition disabled:opacity-40 ${task.boxMinutes === minutes ? "bg-accent text-on-accent border-accent" : "bg-surface text-ink border-line"}`}
            >
              {toPersianDigits(minutes)} دقیقه
            </button>
          ))}
        </div>
        <form onSubmit={setCustomBox} className="flex items-center gap-2">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="numeric" dir="ltr" placeholder="مدت دلخواه (دقیقه)" aria-label="مدت دلخواه" className="bg-surface flex-1 rounded-xl border border-line px-3 py-2.5 text-sm text-right" />
          <button type="submit" disabled={saving || custom.trim() === ""} className="rounded-xl border border-line px-4 py-2.5 text-sm text-ink disabled:opacity-40">
            بگذار
          </button>
        </form>
        {error && <p className="text-xs text-waste">{error}</p>}
        {task.boxMinutes !== null && (
          <button type="button" disabled={saving} onClick={() => void set(null)} className="text-xs text-muted hover:text-waste">
            بدون جعبه
          </button>
        )}
      </div>
    </Sheet>
  );
}

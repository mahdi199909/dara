"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { apiPatch, apiPost, fetcher, isNativePlatform } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import TimePicker from "@/components/ui/TimePicker";
import MoveItemSheet, { applyMove } from "@/components/day/MoveItemSheet";
import { formatJalali } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";
import { refreshAllCaches } from "@/lib/refreshCaches";
import { notifySaved } from "@/lib/savedToast";
import { overlapRefusal, type OverlapRefusal } from "@/lib/overlapClient";
import { canMove, tomorrowOf } from "@/lib/moveItem";
import { describeEndOfDay, openItemsOfDay, readEndOfDaySettings, saveEndOfDaySettings, todayWindow, type EndOfDaySettings, type OpenItem } from "@/lib/endOfDay";

/**
 * «مرور پایان روز»: what is still open today, and the three honest things to do with each — finish it, send it to
 * tomorrow (the same time), or give it another moment. Nothing is judged and nothing moves by itself. The evening
 * notification (phone only) opens this screen.
 */
export default function ReviewPage() {
  const now = new Date();
  const { from, to } = useMemo(() => todayWindow(new Date()), []);
  const { data, mutate } = useSWR<{ occurrences: any[]; taskOccurrences: any[] }>(`/api/events?from=${from}&to=${to}`, fetcher);
  const items = useMemo(() => openItemsOfDay(data), [data]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ open: OpenItem; refusal: OverlapRefusal | null } | null>(null);

  async function run(open: OpenItem, action: () => Promise<void>) {
    setBusyKey(open.key);
    setError(null);
    try {
      await action();
      refreshAllCaches();
      await mutate();
      notifySaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "انجام نشد.");
    } finally {
      setBusyKey(null);
    }
  }

  const finish = (open: OpenItem) =>
    run(open, async () => {
      if (open.item.kind === "TASK") await apiPatch(`/api/tasks/${open.item.id}`, { status: "DONE" });
      else await apiPost(`/api/events/${open.item.id}/complete`, { occurrenceDate: open.occurrenceDate });
    });

  async function toTomorrow(open: OpenItem) {
    setBusyKey(open.key);
    setError(null);
    try {
      await applyMove(open.item, { day: tomorrowOf(new Date()) });
      refreshAllCaches();
      await mutate();
      notifySaved("به فردا رفت");
    } catch (err) {
      // Tomorrow at that time is taken: say by what, and let the person choose (another time, or both on purpose).
      const refusal = overlapRefusal(err);
      if (refusal) setMoving({ open, refusal });
      else setError(err instanceof Error ? err.message : "جابه‌جا کردن انجام نشد.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">مرور پایان روز</h1>
        <p className="text-xs text-muted mt-1 leading-relaxed">{formatJalali(now, { withWeekday: true, long: true })} · چه چیزی تمام نشد؟ هرکدام را تمام کن، به فردا ببر یا زمان دیگری بگذار.</p>
      </div>

      {!data ? (
        <p className="text-sm text-muted text-center py-8">در حال بارگذاری...</p>
      ) : items.length === 0 ? (
        <Card className="p-5 space-y-1">
          <p className="text-sm text-ink font-medium">امروز چیزی باز نمانده.</p>
          <p className="text-xs text-muted leading-relaxed">هر کار و رویدادِ امروز یا انجام شده یا کنار گذاشته شده است؛ روزت بسته است.</p>
        </Card>
      ) : (
        <Card>
          <p className="px-4 pt-3 text-xs text-muted">{toPersianDigits(items.length)} مورد باز</p>
          <ul className="divide-y divide-line">
            {items.map((open) => {
              const movable = canMove(open.item);
              const busy = busyKey === open.key;
              return (
                <li key={open.key} className="px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-ink break-words">{open.item.title}</p>
                      <p className="text-[11px] text-muted mt-0.5">
                        {open.item.kind === "TASK" ? "کار" : "رویداد"} · {open.time ? toPersianDigits(open.time) : "بدون ساعت"}
                        {!movable ? " · تکرارشونده" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => void finish(open)} className="rounded-xl bg-accent text-on-accent px-3 py-1.5 text-xs font-medium disabled:opacity-40">
                      تمام شد
                    </button>
                    {movable && (
                      <>
                        <button type="button" disabled={busy} onClick={() => void toTomorrow(open)} className="rounded-xl border border-line px-3 py-1.5 text-xs text-ink disabled:opacity-40">
                          فردا
                        </button>
                        <button type="button" disabled={busy} onClick={() => setMoving({ open, refusal: null })} className="rounded-xl border border-line px-3 py-1.5 text-xs text-ink disabled:opacity-40">
                          زمان دیگر…
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {error && <p className="text-xs text-waste">{error}</p>}

      <ReminderSetting />

      {moving && (
        <MoveItemSheet
          item={moving.open.item}
          initialRefusal={moving.refusal}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null);
            refreshAllCaches();
            void mutate();
            notifySaved("جابه‌جا شد");
          }}
        />
      )}
    </div>
  );
}

/** The evening reminder: on or off, and at what time. It rings on the phone only, and is kept on this device. */
function ReminderSetting() {
  const [native] = useState(() => typeof window !== "undefined" && isNativePlatform());
  const [settings, setSettings] = useState<EndOfDaySettings>(() => readEndOfDaySettings());
  const [open, setOpen] = useState(false);

  function update(patch: Partial<EndOfDaySettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveEndOfDaySettings(next);
  }

  return (
    <Card className="p-4 space-y-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between text-sm text-ink">
        <span>یادآوری شبانه</span>
        <span className="text-xs text-muted">{describeEndOfDay(settings)} · تغییر</span>
      </button>
      {open && (
        <div className="space-y-3 pt-1">
          <label className="flex items-center justify-between gap-3 text-sm text-ink">
            <span>هر شب یادم بینداز</span>
            <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" />
          </label>
          {settings.enabled && (
            <div>
              <p className="text-xs text-muted mb-1.5">چه ساعتی؟</p>
              <TimePicker value={settings.time} onChange={(time) => update({ time })} required />
            </div>
          )}
          <p className="text-[11px] text-muted leading-relaxed">
            {native
              ? "اعلان فقط وقتی کارها یا رویدادهای بازِ امروز مانده باشد می‌آید و روی همین گوشی تنظیم می‌شود."
              : "اعلان شبانه فقط در اپ اندروید می‌آید؛ این تنظیم همان‌جا اثر دارد."}
          </p>
        </div>
      )}
    </Card>
  );
}

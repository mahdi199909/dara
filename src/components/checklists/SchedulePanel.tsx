"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { apiPatch, apiPost } from "@/lib/apiClient";
import { refreshAllCaches } from "@/lib/refreshCaches";
import { DEFAULT_WORK_HOURS, planChecklist, type PlanItem, type PlannedStep } from "@/lib/checklistSchedule";
import type { ChecklistItemDto } from "@/lib/schemas/checklists";
import { dayKeyIso } from "@/lib/calendarGrid";
import { formatJalali, formatTime } from "@/lib/jalali";
import { formatDuration, toPersianDigits } from "@/lib/money";
import { Card } from "@/components/ui/Card";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import TimePicker from "@/components/ui/TimePicker";
import { Sheet } from "@/components/convert/ConvertSheet";
import { LINK_LABELS } from "./ItemSettingsSheet";

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function withTime(day: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0, 0, 0);
}

function tomorrowNine(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0, 0, 0);
}

function asPlanItems(items: ChecklistItemDto[], durations: Record<string, number> = {}): PlanItem[] {
  return items.map((i) => ({ ...i, durationMin: durations[i.id] ?? i.durationMin }));
}

function groupByDay(steps: PlannedStep[]): { day: string; date: Date; steps: PlannedStep[] }[] {
  const out: { day: string; date: Date; steps: PlannedStep[] }[] = [];
  for (const s of steps) {
    const day = dayKeyIso(s.start);
    const last = out[out.length - 1];
    if (last && last.day === day) last.steps.push(s);
    else out.push({ day, date: s.start, steps: [s] });
  }
  return out;
}

/**
 * «زمان‌بندی» — the list as a plan: from a chosen start, every step that has a duration placed in
 * order (its «بعد از / قبل از / هم‌زمان با» rule, or right after the step before it), shown by day
 * with a bar for where it falls in the whole. «افزودن به تقویم» turns the plan into tasks or events
 * after a last look at every row.
 */
export default function SchedulePanel({ items, rootId, onEditItem, onChanged }: { items: ChecklistItemDto[]; rootId: string; onEditItem: (id: string) => void; onChanged: () => Promise<unknown> }) {
  const [day, setDay] = useState<Date>(tomorrowNine);
  const [time, setTime] = useState("09:00");
  const [workHours, setWorkHours] = useState(true);
  const [includeChecked, setIncludeChecked] = useState(false);
  const [importing, setImporting] = useState(false);

  const start = withTime(day, time);
  const options = { start, workHours: workHours ? DEFAULT_WORK_HOURS : null, includeChecked };
  const plan = useMemo(() => planChecklist(asPlanItems(items), rootId, options), [items, rootId, start.getTime(), workHours, includeChecked]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(items.map((i) => [i.id, i]));
  const total = plan.start && plan.end ? Math.max(1, plan.end.getTime() - plan.start.getTime()) : 1;
  const workMin = plan.steps.reduce((s, p) => s + p.durationMin, 0);

  return (
    <div className="space-y-3">
      <Card className="p-3 space-y-3">
        <p className="text-xs text-muted leading-relaxed">
          به هر مورد با ضربه زدن رویش مدت و ترتیب بده («بعد از»، «قبل از»، «هم‌زمان با شروع»). مورد بدون ترتیب، بعد از مورد قبلی فهرست می‌آید. اینجا فقط پیش‌نمایش است؛ چیزی تا «افزودن به تقویم» ثبت نمی‌شود.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[11px] text-muted mb-1">شروع از</p>
            <JalaliDateInput value={day} onChange={setDay} />
          </div>
          <div>
            <p className="text-[11px] text-muted mb-1">ساعت</p>
            <TimePicker value={time} onChange={(v) => v && setTime(v)} required />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={workHours} onChange={(e) => setWorkHours(e.target.checked)} className="w-4 h-4 accent-accent" />
          فقط ساعت کاری (۹ تا ۱۷، بدون جمعه)
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={includeChecked} onChange={(e) => setIncludeChecked(e.target.checked)} className="w-4 h-4 accent-accent" />
          موردهای تیک‌خورده هم بیایند
        </label>
      </Card>

      {plan.problems.length > 0 && (
        <div className="rounded-xl border border-waste/40 bg-waste/10 px-3 py-2 space-y-1">
          {plan.problems.map((p) => (
            <button key={p.id} type="button" onClick={() => onEditItem(p.id)} className="block text-right text-xs text-waste">
              «{p.title}»: {p.message}
            </button>
          ))}
        </div>
      )}

      {plan.steps.length === 0 ? (
        <Card className="p-5 text-center">
          <p className="text-sm text-ink">هنوز هیچ موردی مدت ندارد.</p>
          <p className="text-xs text-muted mt-1">روی یک مورد بزن و «چقدر طول می‌کشد؟» را انتخاب کن.</p>
        </Card>
      ) : (
        <>
          <Card className="p-3">
            <p className="text-xs text-muted">
              {toPersianDigits(String(plan.steps.length))} قدم · {formatDuration(workMin)} کار · از {formatJalali(plan.start!, { withWeekday: true })} تا {formatJalali(plan.end!, { withWeekday: true })}
            </p>
          </Card>
          {groupByDay(plan.steps).map((g) => (
            <section key={g.day}>
              <p className="text-xs font-medium text-muted mb-1.5">{formatJalali(g.date, { withWeekday: true })}</p>
              <Card className="divide-y divide-line">
                {g.steps.map((s) => {
                  const item = byId.get(s.id);
                  const right = ((s.start.getTime() - plan.start!.getTime()) / total) * 100;
                  const width = Math.max(1.5, ((s.end.getTime() - s.start.getTime()) / total) * 100);
                  return (
                    <button key={s.id} type="button" onClick={() => onEditItem(s.id)} className="block w-full text-right px-3 py-2 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`text-sm ${item?.checked ? "line-through text-muted" : "text-ink"}`}>{s.title}</p>
                          <p className="text-[11px] text-muted">
                            {s.path.length > 0 && <span>{s.path.join(" › ")} · </span>}
                            {s.rule ?? "بعد از مورد قبلی"}
                            {item?.linkedType && <span className="text-accent"> · ✓ {LINK_LABELS[item.linkedType] ?? item.linkedType}</span>}
                          </p>
                        </div>
                        <span className="text-xs text-muted shrink-0 text-left" dir="ltr">
                          {formatTime(s.start)}–{formatTime(s.end)}
                        </span>
                      </div>
                      <div className="relative h-1.5 rounded-full bg-canvas">
                        <div className="absolute top-0 h-full rounded-full bg-accent" style={{ right: `${right}%`, width: `${width}%` }} />
                      </div>
                    </button>
                  );
                })}
              </Card>
            </section>
          ))}
          <button type="button" onClick={() => setImporting(true)} className="w-full rounded-xl bg-accent text-on-accent py-3 text-sm font-medium">
            افزودن به تقویم ({toPersianDigits(String(plan.steps.length))} مورد)
          </button>
        </>
      )}

      {plan.unscheduled.length > 0 && (
        <Card className="p-3 space-y-1.5">
          <p className="text-xs text-muted">بدون مدت (در برنامه نمی‌آیند):</p>
          <div className="flex flex-wrap gap-1.5">
            {plan.unscheduled.map((u) => (
              <button key={u.id} type="button" onClick={() => onEditItem(u.id)} className="px-2.5 py-1 rounded-full text-xs border border-line text-ink">
                {u.title} · مدت بده
              </button>
            ))}
          </div>
        </Card>
      )}

      {importing && (
        <CalendarImportSheet
          items={items}
          rootId={rootId}
          options={options}
          onClose={() => setImporting(false)}
          onDone={async () => {
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

/**
 * The last look before the plan goes into the calendar: every row with its day, time and length, each
 * editable (a moved row pins it there, and the rows that depend on it move with it) or removable.
 * Rows already turned into something are left out unless picked again. Nothing is saved before «ثبت».
 */
function CalendarImportSheet({
  items,
  rootId,
  options,
  onClose,
  onDone,
}: {
  items: ChecklistItemDto[];
  rootId: string;
  options: { start: Date; workHours: typeof DEFAULT_WORK_HOURS | null; includeChecked: boolean };
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [kind, setKind] = useState<"TASK" | "EVENT">("TASK");
  const [pinned, setPinned] = useState<Record<string, Date>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set(items.filter((i) => i.linkedType).map((i) => i.id)));
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<{ count: number; firstDay: string } | null>(null);

  const plan = useMemo(() => planChecklist(asPlanItems(items, durations), rootId, { ...options, pinned }), [items, rootId, options, pinned, durations]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const chosen = plan.steps.filter((s) => !excluded.has(s.id));

  async function save() {
    setSaving(true);
    setError(null);
    setProgress({ done: 0, total: chosen.length });
    let done = 0;
    try {
      for (const step of chosen) {
        const body = { title: step.title.slice(0, 200), startAt: step.start.toISOString(), endAt: step.end.toISOString(), allowOverlap: true };
        let linkedId: string | null = null;
        if (kind === "TASK") {
          const res = await apiPost<{ task: { id: string } }>("/api/tasks", { ...body, status: "TODO" });
          linkedId = res.task.id;
        } else {
          const res = await apiPost<{ event: { id: string } }>("/api/events", body);
          linkedId = res.event.id;
        }
        await apiPatch(`/api/checklists/${step.id}`, { linkedType: kind, linkedId });
        done++;
        setProgress({ done, total: chosen.length });
      }
      refreshAllCaches();
      await onDone();
      setFinished({ count: done, firstDay: chosen.length ? dayKeyIso(chosen[0].start) : dayKeyIso(new Date()) });
    } catch (err) {
      setError(`${toPersianDigits(String(done))} از ${toPersianDigits(String(chosen.length))} مورد ثبت شد؛ بقیه نه: ${err instanceof Error ? err.message : "خطا"}`);
      await onDone();
    } finally {
      setSaving(false);
    }
  }

  if (finished) {
    return (
      <Sheet title="به تقویم اضافه شد" onClose={onClose}>
        <div className="space-y-3 text-center">
          <p className="text-sm text-ink">
            {toPersianDigits(String(finished.count))} {kind === "TASK" ? "کار" : "رویداد"} با زمان‌شان در تقویم ثبت شد.
          </p>
          <Link href={`/calendar?day=${finished.firstDay}`} className="block w-full rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium">
            دیدن در تقویم
          </Link>
          <button type="button" onClick={onClose} className="w-full rounded-xl bg-canvas text-muted py-2 text-sm">
            بستن
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="پیش از افزودن به تقویم" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1">
          {(
            [
              ["TASK", "به‌صورت کار"],
              ["EVENT", "به‌صورت رویداد"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setKind(value)} className={`rounded-lg py-1.5 text-sm ${kind === value ? "bg-surface text-ink font-medium shadow-card" : "text-muted"}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted">هر ردیف را می‌توانی ویرایش یا حذف کنی؛ جابه‌جا کردن یک ردیف، ردیف‌های وابسته به آن را هم جابه‌جا می‌کند.</p>

        <ul className="divide-y divide-line rounded-xl border border-line">
          {plan.steps.map((s) => {
            const out = excluded.has(s.id);
            const linked = byId.get(s.id)?.linkedType;
            return (
              <li key={s.id} className={`px-3 py-2 ${out ? "opacity-50" : ""}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink">{s.title}</p>
                    <p className="text-[11px] text-muted">
                      {formatJalali(s.start, { withWeekday: true })} · <span dir="ltr">{formatTime(s.start)}–{formatTime(s.end)}</span> · {formatDuration(s.durationMin)}
                      {s.pinned && " · دستی"}
                    </p>
                    {linked && <p className="text-[11px] text-accent">قبلاً به {LINK_LABELS[linked] ?? linked} تبدیل شده</p>}
                  </div>
                  {out ? (
                    <button type="button" onClick={() => setExcluded((e) => new Set([...e].filter((x) => x !== s.id)))} className="text-xs text-accent shrink-0">
                      برگردان
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => setEditing(editing === s.id ? null : s.id)} className="text-xs text-accent">
                        ویرایش
                      </button>
                      <button type="button" onClick={() => setExcluded((e) => new Set([...e, s.id]))} className="text-xs text-waste" aria-label="حذف از این فهرست">
                        حذف
                      </button>
                    </div>
                  )}
                </div>
                {editing === s.id && !out && (
                  <RowEditor
                    step={s}
                    onChange={(start, durationMin) => {
                      setPinned((p) => ({ ...p, [s.id]: start }));
                      setDurations((d) => ({ ...d, [s.id]: durationMin }));
                    }}
                    onUnpin={
                      s.pinned
                        ? () =>
                            setPinned((p) => {
                              const next = { ...p };
                              delete next[s.id];
                              return next;
                            })
                        : undefined
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>

        {error && <p className="text-xs text-waste">{error}</p>}
        <button type="button" disabled={saving || chosen.length === 0} onClick={() => void save()} className="w-full rounded-xl bg-accent text-on-accent py-2.5 text-sm font-medium disabled:opacity-40">
          {saving && progress ? `در حال ثبت ${toPersianDigits(String(progress.done))} از ${toPersianDigits(String(progress.total))}...` : `ثبت ${toPersianDigits(String(chosen.length))} ${kind === "TASK" ? "کار" : "رویداد"} در تقویم`}
        </button>
      </div>
    </Sheet>
  );
}

function RowEditor({ step, onChange, onUnpin }: { step: PlannedStep; onChange: (start: Date, durationMin: number) => void; onUnpin?: () => void }) {
  const [day, setDay] = useState(step.start);
  const [time, setTime] = useState(hhmm(step.start));
  const [duration, setDuration] = useState(String(step.durationMin));

  function apply(nextDay = day, nextTime = time, nextDuration = duration) {
    const minutes = Math.max(1, Math.round(Number(nextDuration) || step.durationMin));
    onChange(withTime(nextDay, nextTime), minutes);
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-canvas p-2">
      <div className="grid grid-cols-2 gap-2">
        <JalaliDateInput
          value={day}
          onChange={(d) => {
            setDay(d);
            apply(d);
          }}
        />
        <TimePicker
          value={time}
          required
          onChange={(v) => {
            if (!v) return;
            setTime(v);
            apply(day, v);
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={duration}
          onChange={(e) => {
            setDuration(e.target.value);
            if (Number(e.target.value) >= 1) apply(day, time, e.target.value);
          }}
          className="w-24 bg-surface rounded-lg border border-line px-2 py-1.5 text-sm"
          aria-label="مدت به دقیقه"
        />
        <span className="text-xs text-muted">دقیقه</span>
        {onUnpin && (
          <button type="button" onClick={onUnpin} className="mr-auto text-xs text-muted">
            برگرداندن به زمان خودکار
          </button>
        )}
      </div>
      <p className="text-[10px] text-muted">مدت اینجا فقط برای همین ثبت است؛ مدت خود مورد در چک‌لیست عوض نمی‌شود.</p>
    </div>
  );
}

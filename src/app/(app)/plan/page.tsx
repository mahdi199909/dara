"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { apiPatch, fetcher } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import MoveItemSheet from "@/components/day/MoveItemSheet";
import ScheduleSheet from "@/components/plan/ScheduleSheet";
import BoxSheet from "@/components/plan/BoxSheet";
import { formatJalali } from "@/lib/jalali";
import { formatDuration, toPersianDigits } from "@/lib/money";
import { refreshAllCaches } from "@/lib/refreshCaches";
import { notifySaved } from "@/lib/savedToast";
import { focusTimer, useFocusTimer } from "@/lib/focusTimerStore";
import { useModes } from "@/lib/useModes";
import { canMove, movableFromEvent, movableFromTask, type Movable } from "@/lib/moveItem";
import { boxSummary, boxTotals, clockText, layOutBlocks, openTasksOfDay, planOfDay, timelineRange, type PlanBlock, type TrayTask } from "@/lib/dayPlan";

type View = "blocks" | "boxes";
const PX_PER_MIN = 1;
const MIN_BLOCK_PX = 22;

/**
 * «برنامه‌ریزی روز» — two ways to plan a day, each a mode switched on in Settings. Time blocking lays the day out on a
 * timeline: what already has a time is a block, and a task without one waits in the tray until it is given a place.
 * Time boxing gives each open task a box — how long it may take — and starts a countdown for it in the timer.
 */
export default function PlanPage() {
  const router = useRouter();
  const modes = useModes();
  const blocking = modes.modes.includes("timeBlocking");
  const boxing = modes.modes.includes("timeBoxing");
  const [view, setView] = useState<View | null>(null);
  const [day, setDay] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [scheduling, setScheduling] = useState<{ task?: TrayTask; startMin?: number } | null>(null);
  const [moving, setMoving] = useState<Movable | null>(null);
  const [boxing_, setBoxing] = useState<TrayTask | null>(null);
  const [now, setNow] = useState(() => new Date());

  // The clock line and "from now" suggestions follow the minute.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const range = useMemo(
    () => `from=${day.toISOString()}&to=${new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).toISOString()}`,
    [day]
  );
  const available = blocking || boxing;
  const { data, mutate } = useSWR<{ occurrences: any[]; taskOccurrences: any[] }>(available ? `/api/events?${range}` : null, fetcher);
  const { data: settings } = useSWR<{ settings: { wakeHour: number; sleepHour: number } }>(available ? "/api/settings" : null, fetcher);
  const wakeHour = settings?.settings.wakeHour ?? 7;
  const sleepHour = settings?.settings.sleepHour ?? 23;

  const plan = useMemo(() => planOfDay(data, day), [data, day]);
  const laid = useMemo(() => layOutBlocks(plan.blocks), [plan.blocks]);
  const { fromMin, toMin } = useMemo(() => timelineRange(plan.blocks, wakeHour, sleepHour), [plan.blocks, wakeHour, sleepHour]);
  const openTasks = useMemo(() => openTasksOfDay(data), [data]);
  const totals = useMemo(() => boxTotals(openTasks, wakeHour, sleepHour), [openTasks, wakeHour, sleepHour]);
  const timer = useFocusTimer();

  if (modes.loaded && !available) {
    return (
      <div className="px-4 py-6 space-y-3">
        <h1 className="text-lg font-bold text-ink">برنامه‌ریزی روز</h1>
        <Card className="p-5 space-y-2">
          <p className="text-sm text-ink">هیچ‌کدام از دو شیوهٔ برنامه‌ریزی روشن نیست.</p>
          <p className="text-xs text-muted leading-relaxed">از تنظیمات ← «حالت‌ها» «تایم‌بلاکینگ» (چیدن کارها روی خط زمانی) یا «تایم‌باکسینگ» (جعبهٔ زمانی برای هر کار) را روشن کن.</p>
          <Link href="/settings" className="inline-block text-sm text-accent">
            رفتن به تنظیمات
          </Link>
        </Card>
      </div>
    );
  }

  const activeView: View = view && ((view === "blocks" && blocking) || (view === "boxes" && boxing)) ? view : blocking ? "blocks" : "boxes";
  const isToday = day.toDateString() === now.toDateString();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  function changed() {
    refreshAllCaches();
    void mutate();
  }

  function shiftDay(delta: number) {
    setDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + delta));
  }

  function openBlock(block: PlanBlock) {
    const source = block.kind === "TASK" ? (data?.taskOccurrences ?? []).find((t) => t.id === block.id) : (data?.occurrences ?? []).find((o) => o.event.id === block.id)?.event;
    if (!source) return;
    const movable = block.kind === "TASK" ? movableFromTask(source) : movableFromEvent(source);
    if (canMove(movable)) setMoving(movable);
  }

  function startBox(task: TrayTask) {
    if (task.boxMinutes === null) return;
    focusTimer.start({ mode: "COUNTDOWN", title: task.title, categoryId: task.categoryId, countdownMin: task.boxMinutes });
    router.push("/timer");
  }

  async function finishTask(task: TrayTask) {
    await apiPatch(`/api/tasks/${task.id}`, { status: "DONE" });
    changed();
    notifySaved();
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-ink">برنامه‌ریزی روز</h1>
        <p className="text-xs text-muted mt-1 leading-relaxed">{activeView === "blocks" ? "روزت را بلوک‌بلوک بچین: هر کار یک جا روی خط زمانی." : "برای هر کار یک جعبهٔ زمانی بگذار و با شمارش معکوس همان‌قدر رویش کار کن."}</p>
      </div>

      {blocking && boxing && (
        <div className="flex gap-2" role="tablist" aria-label="شیوهٔ برنامه‌ریزی">
          {(
            [
              ["blocks", "بلوک‌ها"],
              ["boxes", "جعبه‌ها"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={activeView === key} onClick={() => setView(key)} className={`text-sm px-3.5 py-1.5 rounded-full border transition ${activeView === key ? "bg-accent text-on-accent border-accent" : "bg-surface text-ink border-line"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-1">
        <button type="button" onClick={() => shiftDay(-1)} aria-label="روز قبل" className="p-1.5 rounded-lg hover:bg-canvas text-muted">
          <ChevronRightIcon className="w-4 h-4" />
        </button>
        <span className="text-sm text-ink min-w-[10rem] text-center">{formatJalali(day, { withWeekday: true, long: true })}</span>
        <button type="button" onClick={() => shiftDay(1)} aria-label="روز بعد" className="p-1.5 rounded-lg hover:bg-canvas text-muted">
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        {!isToday && (
          <button
            type="button"
            onClick={() => {
              const t = new Date();
              setDay(new Date(t.getFullYear(), t.getMonth(), t.getDate()));
            }}
            className="mr-2 text-xs text-accent border border-line rounded-full px-2.5 py-1 hover:border-accent"
          >
            امروز
          </button>
        )}
      </div>

      {!data ? (
        <p className="text-sm text-muted text-center py-8">در حال بارگذاری...</p>
      ) : activeView === "blocks" ? (
        <>
          {plan.allDay.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {plan.allDay.map((a) => (
                <span key={a.id} className={`text-xs px-2.5 py-1 rounded-full border border-line ${a.done ? "text-muted line-through" : "text-ink"}`}>
                  همه‌روز · {a.title}
                </span>
              ))}
            </div>
          )}

          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted">{plan.blocks.length > 0 ? `${toPersianDigits(plan.blocks.length)} بلوک` : "هنوز بلوکی نچیده‌ای؛ روی خط زمانی بزن."}</p>
              <button type="button" onClick={() => setScheduling({})} className="flex items-center gap-1 text-xs text-accent">
                <PlusIcon className="w-3.5 h-3.5" />
                بلوک جدید
              </button>
            </div>
            <Timeline
              laid={laid}
              fromMin={fromMin}
              toMin={toMin}
              nowMin={isToday ? nowMin : null}
              onPick={(minute) => setScheduling({ startMin: minute })}
              onOpen={openBlock}
            />
          </Card>

          <Card>
            <p className="px-4 pt-3 text-xs text-muted">{plan.tray.length > 0 ? `کارهای بی‌ساعت (${toPersianDigits(plan.tray.length)})` : "کارِ بی‌ساعتی برای این روز نیست."}</p>
            {plan.tray.length > 0 && (
              <ul className="divide-y divide-line mt-2">
                {plan.tray.map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-sm text-ink truncate">{task.title}</span>
                      {task.boxMinutes !== null && <span className="block text-[11px] text-muted">جعبه: {toPersianDigits(task.boxMinutes)} دقیقه</span>}
                    </span>
                    <button type="button" onClick={() => setScheduling({ task })} className="shrink-0 rounded-xl border border-line px-3 py-1.5 text-xs text-ink hover:border-accent">
                      زمان‌بندی
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        <>
          <Card className="p-4 space-y-1">
            <p className="text-sm text-ink" data-testid="box-summary">
              {boxSummary(totals, (minutes) => formatDuration(minutes))}
            </p>
            <p className="text-[11px] text-muted leading-relaxed">وقتی شمارش معکوسِ جعبه تمام شود، مدتش مثل بقیهٔ زمان‌سنجی در کارهای امروز ثبت می‌شود؛ خودِ کار تا خودت تمامش نکنی باز می‌ماند.</p>
          </Card>

          <Card>
            {openTasks.length === 0 ? (
              <p className="p-4 text-sm text-muted">کار بازی برای این روز نیست.</p>
            ) : (
              <ul className="divide-y divide-line">
                {openTasks.map((task) => (
                  <li key={task.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-ink break-words min-w-0">{task.title}</p>
                      <button type="button" onClick={() => setBoxing(task)} className={`shrink-0 text-xs px-2.5 py-1 rounded-full border transition ${task.boxMinutes !== null ? "border-accent text-accent" : "border-line text-muted hover:border-accent"}`}>
                        {task.boxMinutes !== null ? `جعبه ${toPersianDigits(task.boxMinutes)} دقیقه` : "جعبه بگذار"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={task.boxMinutes === null || timer.state !== null}
                        onClick={() => startBox(task)}
                        className="rounded-xl bg-accent text-on-accent px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                      >
                        شروع جعبه
                      </button>
                      <button type="button" onClick={() => void finishTask(task)} className="rounded-xl border border-line px-3 py-1.5 text-xs text-ink">
                        تمام شد
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {timer.state !== null && (
              <p className="px-4 pb-3 text-[11px] text-muted">
                یک زمان‌سنج در حال اجراست؛ <Link href="/timer" className="text-accent">برو به زمان‌سنج</Link> تا تمامش کنی، بعد جعبهٔ بعدی را شروع کن.
              </p>
            )}
          </Card>
        </>
      )}

      {scheduling && (
        <ScheduleSheet
          task={scheduling.task}
          day={day}
          blocks={plan.blocks}
          fromMin={fromMin}
          toMin={toMin}
          initialStartMin={scheduling.startMin}
          onClose={() => setScheduling(null)}
          onDone={() => {
            setScheduling(null);
            changed();
            notifySaved();
          }}
        />
      )}
      {moving && (
        <MoveItemSheet
          item={moving}
          initialDay={day}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null);
            changed();
            notifySaved("جابه‌جا شد");
          }}
        />
      )}
      {boxing_ && (
        <BoxSheet
          task={boxing_}
          onClose={() => setBoxing(null)}
          onDone={() => {
            setBoxing(null);
            changed();
            notifySaved();
          }}
        />
      )}
    </div>
  );
}

/** The day's hours as rows and its blocks laid over them; a tap on an empty spot offers a new block there. */
function Timeline({
  laid,
  fromMin,
  toMin,
  nowMin,
  onPick,
  onOpen,
}: {
  laid: ReturnType<typeof layOutBlocks>;
  fromMin: number;
  toMin: number;
  nowMin: number | null;
  onPick: (startMin: number) => void;
  onOpen: (block: PlanBlock) => void;
}) {
  const height = (toMin - fromMin) * PX_PER_MIN;
  const hours: number[] = [];
  for (let m = fromMin; m < toMin; m += 60) hours.push(m);

  return (
    <div className="flex gap-2" dir="rtl">
      <div className="relative w-10 shrink-0 text-[11px] text-muted" style={{ height }} aria-hidden>
        {hours.map((m) => (
          <span key={m} className="absolute right-0" style={{ top: (m - fromMin) * PX_PER_MIN - 7 }}>
            {toPersianDigits(clockText(m))}
          </span>
        ))}
      </div>
      <div
        className="relative flex-1 cursor-pointer"
        style={{ height }}
        data-testid="timeline"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const minute = fromMin + Math.round((e.clientY - rect.top) / PX_PER_MIN / 15) * 15;
          onPick(Math.max(fromMin, Math.min(toMin - 15, minute)));
        }}
      >
        {hours.map((m) => (
          <div key={m} className="absolute inset-x-0 border-t border-line" style={{ top: (m - fromMin) * PX_PER_MIN }} />
        ))}
        {laid.map((block) => {
          const top = (block.startMin - fromMin) * PX_PER_MIN;
          const blockHeight = Math.max(MIN_BLOCK_PX, (block.endMin - block.startMin) * PX_PER_MIN - 2);
          const widthPercent = 100 / block.lanes;
          return (
            <button
              key={block.key}
              type="button"
              data-block={block.key}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(block);
              }}
              className={`absolute rounded-lg border px-2 py-0.5 text-right overflow-hidden text-[11px] leading-tight ${block.done ? "border-line text-muted line-through" : "border-accent text-ink"}`}
              style={{
                top,
                height: blockHeight,
                right: `${block.lane * widthPercent}%`,
                width: `calc(${widthPercent}% - 3px)`,
                backgroundColor: block.done ? "rgb(var(--line) / 0.5)" : block.color ? `${block.color}33` : "rgb(var(--accent) / 0.18)",
              }}
              title={`${block.title} · ${clockText(block.startMin)}–${clockText(block.endMin)}`}
            >
              <span className="font-medium">{block.title}</span>
              {blockHeight >= 38 && (
                <span className="block text-muted" dir="ltr">
                  {toPersianDigits(clockText(block.startMin))}–{toPersianDigits(clockText(block.endMin))}
                </span>
              )}
            </button>
          );
        })}
        {nowMin !== null && nowMin >= fromMin && nowMin <= toMin && (
          <div className="absolute inset-x-0 pointer-events-none" style={{ top: (nowMin - fromMin) * PX_PER_MIN }} aria-hidden>
            <div className="h-px" style={{ backgroundColor: "rgb(var(--accent))" }} />
          </div>
        )}
      </div>
    </div>
  );
}


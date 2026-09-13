"use client";

import { useState, useEffect } from "react";
import useSWR, { mutate as mutateGlobal } from "swr";
import Link from "next/link";
import { fetcher, apiPost, apiPatch } from "@/lib/apiClient";
import { useHabits } from "@/lib/hooks";
import CaptureFormModal from "@/components/CaptureFormModal";
import type { CaptureSummary } from "@/components/CaptureForm";
import HabitAdherenceChart from "@/components/habits/HabitAdherenceChart";
import HabitDurationModal from "@/components/habits/HabitDurationModal";
import DayBattery from "@/components/DayBattery";
import { EmptyState } from "@/components/ui/Card";
import { formatTime, formatJalali } from "@/lib/jalali";
import { formatDuration } from "@/lib/money";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import { selectDailyMoment, dailyMomentSeed, type DailyMomentType, type DailyMomentCandidate } from "@/lib/dailyMoment";
import { phraseCaptureReaction, type CaptureReactionKind } from "@/lib/phrasing";
import { useCompanion } from "@/components/companion/useCompanion";
import { MOOD_FA_LABEL } from "@/components/companion/moodTokens";
import { ClockIcon, CheckSquareIcon } from "@/components/icons";
import { BOTTOM_NAV_HEIGHT_PX, TOP_BAR_HEIGHT_PX } from "@/lib/layoutConstants";

type TodayFeedItem = {
  key: string;
  time: string;
  kind: "EVENT" | "TASK" | "HABIT" | "TRANSACTION" | "TIME_ENTRY";
  title: string;
  isDone?: boolean;
  onToggleDone?: () => void;
  amount?: number;
  isIncome?: boolean;
  minutes?: number;
};

type CaptureReaction = { kind: CaptureReactionKind; minutes?: number; amount?: number };

/**
 * The Companion section — mood message on its own line, then the achieved/target time at the
 * left edge and the capture button at the right edge below it. The face itself now lives in
 * AppTopBar's header (center slot), not here — see that file — so this row is purely text + one
 * bigger, explicit tap target. The button's own label/action still follows the companion's mood
 * (see computeCompanionState): "پر کردن بازه" during BLINDFOLDED, pre-filling the day's biggest
 * unlogged gap instead of opening a blank form (DayBattery.tsx's own onLogGap shape, reused
 * rather than inventing a second convention) — but it's never hidden outright even in ASLEEP,
 * since this is Home's only capture entry point (GlobalCaptureFab is deliberately absent from Home).
 */
function CompanionRow({
  reaction,
  onOpenCapture,
  onLogGap,
}: {
  reaction: CaptureReaction | null;
  onOpenCapture: () => void;
  onLogGap: (start: Date, end: Date) => void;
}) {
  const { state, enabled, largestUnloggedGap } = useCompanion();
  if (!enabled || !state) return null;

  const message = reaction ? phraseCaptureReaction(reaction.kind, { ...reaction, remainingMinutes: state.remainingMinutes }) : state.message;
  const ariaLabel = `آدمک: ${MOOD_FA_LABEL[state.mood]}، ${formatDuration(state.achievedMinutes)} از ${formatDuration(state.targetMinutes)}`;
  const buttonLabel = state.action.label || "ثبت کار";

  function handleClick() {
    if (state!.mood === "BLINDFOLDED" && largestUnloggedGap) {
      onLogGap(largestUnloggedGap.start, largestUnloggedGap.end);
    } else {
      onOpenCapture();
    }
  }

  return (
    <div className="flex-1 min-w-0 rounded-2xl bg-surface border border-line shadow-card px-3 py-2 space-y-1.5" aria-label={ariaLabel}>
      <p className="text-xs text-ink leading-snug line-clamp-2 text-right">{message}</p>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleClick}
          className="shrink-0 rounded-xl bg-accent text-on-accent px-6 py-3 text-sm font-bold active:scale-[0.98] transition"
        >
          {buttonLabel}
        </button>
        <p className="text-[11px] text-muted">
          {formatDuration(state.achievedMinutes)} از {formatDuration(state.targetMinutes)}
        </p>
      </div>
    </div>
  );
}

/**
 * Sits beside CompanionRow, same size, on Home's top row — the nearest unpaid installment
 * across every plan, one page-snapped card per swipe so scrolling the strip reveals the next
 * few without needing its own dedicated page visit. Always renders (even with nothing due) so
 * the two-column row stays a stable, equal split rather than CompanionRow silently going full
 * width whenever there's nothing to show here.
 */
function UpcomingInstallmentsCard() {
  const { data } = useSWR<{ plans: any[] }>("/api/installment-plans", fetcher);
  const { format } = useCurrencyUnit();

  const upcoming = (data?.plans ?? [])
    .flatMap((plan: any) => plan.installments.filter((i: any) => i.status !== "PAID").map((i: any) => ({ ...i, planTitle: plan.title })))
    .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 4);

  return (
    <Link
      href="/finance"
      className="flex-1 min-w-0 rounded-2xl bg-surface border border-line shadow-card px-3 py-2 flex flex-col"
    >
      <p className="text-xs text-muted mb-1">سررسید نزدیک</p>
      {upcoming.length === 0 ? (
        <p className="flex-1 text-xs text-muted flex items-center">قسطی برای پرداخت نیست.</p>
      ) : (
        <div className="flex-1 flex overflow-x-auto snap-x snap-mandatory scrollbar-thin -mx-1">
          {upcoming.map((inst) => (
            <div key={inst.id} className="w-full shrink-0 snap-center px-1 flex flex-col justify-center">
              <p className="text-sm font-bold text-ink truncate">{inst.planTitle}</p>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[11px] text-muted">{formatJalali(new Date(inst.dueDate))}</span>
                <span className="text-xs font-bold text-accent">{format(inst.amount, { withSuffix: true })}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}

interface DailyMomentInsight {
  text: string;
  href?: string;
}
interface DailyMomentCandidatesDto {
  discovery: DailyMomentInsight | null;
  onThisDay: DailyMomentInsight | null;
  milestone: DailyMomentInsight | null;
}

// Native-only, and only for non-FREE license statuses (TRIAL/SUBSCRIBED/LIFETIME all count as
// "ویژه" — trial users get the full premium feel, same as every other trial-gated feature in
// this app). Also respects Settings' own dailyMomentEnabled toggle. Renders nothing until every
// check (license, quote, and the three insight-engine candidates) has actually resolved, rather
// than showing then swapping content, to avoid both a layout flash and a visible type-switch.
//
// Rotates between 4 reward types (see src/lib/dailyMoment.ts) instead of always showing a quote —
// a predictable reward habituates and stops drawing the eye back; variability is what does.
function DailyMomentCard() {
  const [ready, setReady] = useState(false);
  const [isSpecial, setIsSpecial] = useState(false);
  const [remoteUserId, setRemoteUserId] = useState<string | null>(null);
  const [quote, setQuote] = useState<string | null>(null);
  const { data: settingsData } = useSWR<{ settings: { dailyMomentEnabled: boolean } }>("/api/settings", fetcher);
  const { data: momentData } = useSWR<{ candidates: DailyMomentCandidatesDto }>(ready && isSpecial ? "/api/daily-moment" : null, fetcher);

  useEffect(() => {
    const native = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    if (!native) {
      setReady(true);
      return;
    }
    Promise.all([
      import("@/lib/nativeOnboarding").then(({ getCachedLicense }) => getCachedLicense()),
      import("@/lib/dailyQuote").then(({ fetchDailyQuote }) => fetchDailyQuote()),
    ])
      .then(([license, fetchedQuote]) => {
        setIsSpecial(!!license && license.status !== "FREE");
        setRemoteUserId(license?.remoteUserId ?? null);
        setQuote(fetchedQuote);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const momentEnabled = settingsData ? settingsData.settings.dailyMomentEnabled !== false : false;
  if (!ready || !isSpecial || !momentEnabled || !remoteUserId || momentData === undefined) return null;

  const candidates: Partial<Record<DailyMomentType, DailyMomentCandidate>> = {};
  if (momentData.candidates.discovery) candidates.discovery = { type: "discovery", ...momentData.candidates.discovery };
  if (quote) candidates.quote = { type: "quote", text: quote };
  if (momentData.candidates.onThisDay) candidates.onThisDay = { type: "onThisDay", ...momentData.candidates.onThisDay };
  if (momentData.candidates.milestone) candidates.milestone = { type: "milestone", ...momentData.candidates.milestone };

  const picked = selectDailyMoment(candidates, dailyMomentSeed(remoteUserId, new Date()));
  if (!picked) return null;

  const card = (
    <div className="shrink-0 rounded-2xl bg-accent-soft border border-accent px-4 py-2.5">
      <p className="text-xs text-accent leading-relaxed text-center">{picked.text}</p>
    </div>
  );
  return picked.href ? <Link href={picked.href}>{card}</Link> : card;
}

function todayRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { from, to };
}

export default function HomePage() {
  const [showCapture, setShowCapture] = useState(false);
  const [captureRange, setCaptureRange] = useState<{ start: Date; end: Date } | null>(null);
  const [reaction, setReaction] = useState<CaptureReaction | null>(null);
  const [durationHabit, setDurationHabit] = useState<any>(null);
  const { format } = useCurrencyUnit();
  const { from, to } = todayRange();

  const { data, mutate } = useSWR<{ occurrences: any[]; taskOccurrences: any[] }>(
    `/api/events?from=${from.toISOString()}&to=${to.toISOString()}`,
    fetcher
  );
  const { data: dayActivity, mutate: mutateDayActivity } = useSWR<{ items: any[] }>(
    `/api/day-activity?from=${from.toISOString()}&to=${to.toISOString()}`,
    fetcher
  );
  const { habits, series, currentStreak, mutate: mutateHabits } = useHabits();

  async function toggleEventDone(occ: any) {
    await apiPost(`/api/events/${occ.event.id}/complete`, { occurrenceDate: occ.startAt });
    mutate();
  }

  async function toggleTaskDone(task: any) {
    await apiPatch(`/api/tasks/${task.id}`, { status: task.status === "DONE" ? "TODO" : "DONE" });
    mutate();
  }

  // Everything logged or scheduled for today, from every source the app has — events and tasks
  // come from /api/events (already recurrence-expanded; see that route's own comment), the rest
  // from /api/day-activity (habits, transactions, quick-capture time entries).
  const todayFeed: TodayFeedItem[] = [
    ...(data?.occurrences ?? []).map((occ: any) => ({
      key: `event-${occ.occurrenceId}`,
      time: occ.startAt,
      kind: "EVENT" as const,
      title: occ.event.title,
      isDone: occ.isDone,
      onToggleDone: () => toggleEventDone(occ),
    })),
    ...(data?.taskOccurrences ?? []).map((t: any) => ({
      key: `task-${t.id}`,
      time: t.startAt ?? t.dueDate,
      kind: "TASK" as const,
      title: t.title,
      isDone: t.status === "DONE",
      onToggleDone: () => toggleTaskDone(t),
    })),
    ...(dayActivity?.items ?? []).map((it: any) => ({
      key: `${it.type}-${it.id}`,
      time: it.timeOfDay,
      kind: it.type as "HABIT" | "TRANSACTION" | "TIME_ENTRY",
      title: it.title,
      amount: it.amount ?? undefined,
      isIncome: it.isIncome ?? undefined,
      minutes: it.minutes ?? undefined,
    })),
  ].sort((a, b) => a.time.localeCompare(b.time));

  async function toggleHabitCheckIn(habitId: string) {
    await apiPost(`/api/habits/${habitId}/checkin`);
    mutateHabits();
    mutateDayActivity();
    mutateGlobal("/api/virtual-assets/latest-effect");
  }

  // Trial habits (BJ Fogg's 3-day experiments) live only on the dedicated /habits page —
  // Home stays to committed habits, checked off like any other daily item.
  const activeHabits = habits.filter((h: any) => h.isActive && !h.isTrial);

  function openCapture(range?: { start: Date; end: Date }) {
    setCaptureRange(range ?? null);
    setShowCapture(true);
  }

  // The Companion's own reaction (a temporary delta message) — see phraseCaptureReaction.
  // Virtual-asset captures aren't handled here at all (CaptureForm never reports that kind);
  // UpgradeToast already reacts to those via /api/virtual-assets/latest-effect.
  function handleCaptureDone(summary?: CaptureSummary) {
    setShowCapture(false);
    setCaptureRange(null);
    mutate();
    mutateDayActivity();
    if (summary) {
      setReaction(summary);
      setTimeout(() => setReaction(null), 3000);
    }
  }

  return (
    <div
      className="flex flex-col gap-2 px-4 py-2 overflow-hidden"
      style={{ height: `calc(100vh - ${TOP_BAR_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px - env(safe-area-inset-bottom) - 1.5rem)` }}
    >
      <DailyMomentCard />

      <div className="shrink-0 flex items-stretch gap-2">
        <CompanionRow
          reaction={reaction}
          onOpenCapture={() => openCapture()}
          onLogGap={(start, end) => openCapture({ start, end })}
        />
        <UpcomingInstallmentsCard />
      </div>

      <DayBattery onLogGap={(start, end) => openCapture({ start, end })} />

      <div className="flex-1 min-h-0 flex flex-col bg-surface rounded-2xl border border-line shadow-card">
        <h2 className="shrink-0 font-bold text-ink text-sm px-4 pt-3 pb-2">فعالیت‌های امروز</h2>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
          {!data || !dayActivity ? (
            <p className="text-sm text-muted">در حال بارگذاری...</p>
          ) : todayFeed.length === 0 ? (
            <EmptyState message="هنوز چیزی برای امروز ثبت نشده." />
          ) : (
            <ul className="space-y-2">
              {todayFeed.map((item) => (
                <li key={item.key} className="flex items-center gap-3 text-sm">
                  {item.kind === "EVENT" || item.kind === "TASK" ? (
                    <button
                      onClick={item.onToggleDone}
                      aria-label="تکمیل"
                      className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${
                        item.isDone ? "bg-accent border-accent text-on-accent" : "border-line text-transparent"
                      }`}
                    >
                      <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                  ) : (
                    <span className="shrink-0 w-5 h-5 flex items-center justify-center text-accent">
                      {item.kind === "HABIT" ? "🔥" : item.kind === "TRANSACTION" ? (item.isIncome ? "+" : "-") : "⏱"}
                    </span>
                  )}
                  <ClockIcon className="w-4 h-4 text-muted shrink-0" />
                  <span className="text-muted w-12 shrink-0">{formatTime(new Date(item.time))}</span>
                  <span className={`flex-1 truncate ${item.isDone ? "text-muted line-through" : "text-ink"}`}>{item.title}</span>
                  {item.amount !== undefined && (
                    <span className={`shrink-0 text-xs font-bold ${item.isIncome ? "text-accent" : "text-waste"}`}>
                      {item.isIncome ? "+" : "-"}
                      {format(item.amount, { withSuffix: true })}
                    </span>
                  )}
                  {item.minutes !== undefined && <span className="shrink-0 text-xs text-muted">{formatDuration(item.minutes)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col bg-surface rounded-2xl border border-line shadow-card">
        <h2 className="shrink-0 font-bold text-ink text-sm px-4 pt-3 pb-2">عادت‌های امروز</h2>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
          {activeHabits.length === 0 ? (
            <EmptyState message="هنوز عادتی نساخته‌اید. از منو، بخش «عادت‌ها» را ببینید." />
          ) : (
            <ul className="space-y-2 mb-3">
              {activeHabits.map((h: any) => (
                <li key={h.id} className="flex items-center gap-3 text-sm">
                  <button
                    onClick={() => toggleHabitCheckIn(h.id)}
                    aria-label="تیک عادت"
                    className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${
                      h.checkedInToday ? "bg-accent border-accent text-on-accent" : "border-line text-transparent"
                    }`}
                  >
                    <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </button>
                  <span className="shrink-0">{h.icon || "🔥"}</span>
                  <span className={`flex-1 truncate ${h.checkedInToday ? "text-muted line-through" : "text-ink"}`}>{h.title}</span>
                  {h.checkedInToday && (
                    <button
                      onClick={() => setDurationHabit(h)}
                      className="shrink-0 flex items-center gap-1 text-xs text-muted hover:text-accent transition"
                      aria-label="ثبت زمان عادت"
                    >
                      <ClockIcon className="w-3.5 h-3.5" />
                      {h.todayDurationMin ? formatDuration(h.todayDurationMin) : "زمان"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {activeHabits.length > 0 && <HabitAdherenceChart series={series} currentStreak={currentStreak} />}
        </div>
      </div>

      <CaptureFormModal
        open={showCapture}
        onClose={() => setShowCapture(false)}
        onDone={handleCaptureDone}
        initialStart={captureRange?.start}
        initialEnd={captureRange?.end}
      />

      {durationHabit && (
        <HabitDurationModal
          habit={durationHabit}
          onClose={() => setDurationHabit(null)}
          onSaved={() => { setDurationHabit(null); mutateHabits(); mutateGlobal("/api/virtual-assets/latest-effect"); }}
        />
      )}
    </div>
  );
}

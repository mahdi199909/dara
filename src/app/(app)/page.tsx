"use client";

import { useState, useEffect } from "react";
import useSWR, { mutate as mutateGlobal } from "swr";
import Link from "next/link";
import { fetcher, apiPost } from "@/lib/apiClient";
import { useHabits } from "@/lib/hooks";
import CaptureFormModal from "@/components/CaptureFormModal";
import type { CaptureSummary } from "@/components/CaptureForm";
import HabitAdherenceChart from "@/components/habits/HabitAdherenceChart";
import HabitDurationModal from "@/components/habits/HabitDurationModal";
import PersonalDashboard from "@/components/home/PersonalDashboard";
import DayItemsList from "@/components/day/DayItemsList";
import { buildDayItems } from "@/lib/dayItems";
import { EmptyState } from "@/components/ui/Card";
import { formatDuration } from "@/lib/money";
import { selectDailyMoment, dailyMomentSeed, type DailyMomentType, type DailyMomentCandidate } from "@/lib/dailyMoment";
import { buildCapturePrefill } from "@/lib/smartCapture";
import type { CaptureReaction } from "@/components/home/QuickTaskInput";
import { ClockIcon, CheckSquareIcon } from "@/components/icons";
import { BOTTOM_NAV_HEIGHT_PX, TOP_BAR_HEIGHT_PX } from "@/lib/layoutConstants";
import type { CapturePrefill } from "@/lib/smartCapture";

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
  // Set only by the smart-capture text field (src/lib/smartCapture.ts) — cleared whenever any
  // other capture entry point opens the same modal, so its fields never leak into a blank/gap open.
  const [smartPrefill, setSmartPrefill] = useState<CapturePrefill | null>(null);
  const [reaction, setReaction] = useState<CaptureReaction | null>(null);
  const [durationHabit, setDurationHabit] = useState<any>(null);
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

  // Everything logged or scheduled for today, from every source the app has — events and tasks
  // come from /api/events (already recurrence-expanded; see that route's own comment), the rest
  // from /api/day-activity (habits, transactions, quick-capture time entries). The calendar's day
  // view builds its list from the same function, so the two can never disagree about a day.
  const todayFeed = buildDayItems(data, dayActivity);

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
    setSmartPrefill(null);
    setCaptureRange(range ?? null);
    setShowCapture(true);
  }

  // The smart-capture text field: parse the typed line (src/lib/smartCapture.ts) and open the
  // very same form filled in with what it found — the person still reviews and submits it themselves.
  function openSmartCapture(text: string) {
    setCaptureRange(null);
    setSmartPrefill(buildCapturePrefill(text));
    setShowCapture(true);
  }

  // The Companion's own reaction (a temporary delta message) — see phraseCaptureReaction.
  // Virtual-asset captures aren't handled here at all (CaptureForm never reports that kind);
  // UpgradeToast already reacts to those via /api/virtual-assets/latest-effect.
  function handleCaptureDone(summary?: CaptureSummary) {
    setShowCapture(false);
    setCaptureRange(null);
    setSmartPrefill(null);
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

      <PersonalDashboard
        reaction={reaction}
        onOpenCapture={() => openCapture()}
        onLogGap={(start, end) => openCapture({ start, end })}
        onSmartCapture={openSmartCapture}
      />

      <div className="flex-1 min-h-0 flex flex-col bg-surface rounded-2xl border border-line shadow-card">
        <h2 className="shrink-0 font-bold text-ink text-sm px-4 pt-3 pb-2">فعالیت‌های امروز</h2>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
          {!data || !dayActivity ? (
            <p className="text-sm text-muted">در حال بارگذاری...</p>
          ) : todayFeed.length === 0 ? (
            <EmptyState message="هنوز چیزی برای امروز ثبت نشده." />
          ) : (
            <DayItemsList
              items={todayFeed}
              day={new Date()}
              onChanged={() => {
                mutate();
                mutateDayActivity();
                mutateHabits();
              }}
            />
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
        initialStart={smartPrefill?.start ?? captureRange?.start ?? undefined}
        initialEnd={smartPrefill?.end ?? captureRange?.end ?? undefined}
        initialTitle={smartPrefill?.title}
        initialDay={smartPrefill?.day}
        initialEntityType={smartPrefill?.entityType}
        initialFlowType={smartPrefill?.flowType}
        initialAmount={smartPrefill?.amount}
        initialCategoryHint={smartPrefill?.categoryHint}
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

"use client";

import { useState, useEffect } from "react";
import useSWR, { mutate as mutateGlobal } from "swr";
import Link from "next/link";
import { fetcher, apiPost } from "@/lib/apiClient";
import { useHabits } from "@/lib/hooks";
import CaptureFormModal from "@/components/CaptureFormModal";
import HabitAdherenceChart from "@/components/habits/HabitAdherenceChart";
import HabitDurationModal from "@/components/habits/HabitDurationModal";
import { EmptyState } from "@/components/ui/Card";
import { formatTime } from "@/lib/jalali";
import { formatDuration } from "@/lib/money";
import { selectDailyMoment, dailyMomentSeed, type DailyMomentType, type DailyMomentCandidate } from "@/lib/dailyMoment";
import { ClockIcon, PlusIcon, CheckSquareIcon } from "@/components/icons";
import { BOTTOM_NAV_HEIGHT_PX, TOP_BAR_HEIGHT_PX } from "@/lib/layoutConstants";

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
    <div className="shrink-0 rounded-2xl bg-brand-50 border border-brand-100 px-4 py-2.5">
      <p className="text-xs text-brand-700 leading-relaxed text-center line-clamp-2">{picked.text}</p>
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
  const [durationHabit, setDurationHabit] = useState<any>(null);
  const { from, to } = todayRange();

  const { data, mutate } = useSWR<{ occurrences: any[] }>(
    `/api/events?from=${from.toISOString()}&to=${to.toISOString()}`,
    fetcher
  );
  const { habits, series, currentStreak, mutate: mutateHabits } = useHabits();

  // Only what's still ahead today — already-passed events would just be noise on Home.
  const now = new Date();
  const upcomingToday = (data?.occurrences ?? []).filter((occ: any) => new Date(occ.startAt) >= now);

  async function toggleEventDone(occ: any) {
    await apiPost(`/api/events/${occ.event.id}/complete`, { occurrenceDate: occ.startAt });
    mutate();
  }

  async function toggleHabitCheckIn(habitId: string) {
    await apiPost(`/api/habits/${habitId}/checkin`);
    mutateHabits();
    mutateGlobal("/api/virtual-assets/latest-effect");
  }

  // Trial habits (BJ Fogg's 3-day experiments) live only on the dedicated /habits page —
  // Home stays to committed habits, checked off like any other daily item.
  const activeHabits = habits.filter((h: any) => h.isActive && !h.isTrial);

  return (
    <div
      className="flex flex-col gap-2 px-4 py-2 overflow-hidden"
      style={{ height: `calc(100vh - ${TOP_BAR_HEIGHT_PX}px - ${BOTTOM_NAV_HEIGHT_PX}px - env(safe-area-inset-bottom) - 1.5rem)` }}
    >
      <DailyMomentCard />

      <button
        onClick={() => setShowCapture(true)}
        className="shrink-0 w-full flex items-center justify-center gap-2 rounded-2xl bg-brand-600 text-white py-3.5 font-bold text-sm shadow-md shadow-brand-600/25 active:scale-[0.98] transition"
      >
        <PlusIcon className="w-5 h-5" />
        ثبت کار
      </button>

      <div className="flex-1 min-h-0 flex flex-col bg-white rounded-2xl border border-gray-100 shadow-card">
        <h2 className="shrink-0 font-bold text-gray-800 text-sm px-4 pt-3 pb-2">رویدادهای امروز</h2>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3">
          {!data ? (
            <p className="text-sm text-gray-400">در حال بارگذاری...</p>
          ) : upcomingToday.length === 0 ? (
            <EmptyState message="رویداد پیش‌رویی برای امروز نمانده." />
          ) : (
            <ul className="space-y-2">
              {upcomingToday.map((occ: any) => (
                <li key={occ.occurrenceId} className="flex items-center gap-3 text-sm">
                  <button
                    onClick={() => toggleEventDone(occ)}
                    aria-label="تکمیل رویداد"
                    className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${
                      occ.isDone ? "bg-brand-600 border-brand-600 text-white" : "border-gray-300 text-transparent"
                    }`}
                  >
                    <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </button>
                  <ClockIcon className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="text-gray-400 w-12 shrink-0">{formatTime(new Date(occ.startAt))}</span>
                  <span className={`truncate ${occ.isDone ? "text-gray-400 line-through" : "text-gray-800"}`}>{occ.event.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col bg-white rounded-2xl border border-gray-100 shadow-card">
        <h2 className="shrink-0 font-bold text-gray-800 text-sm px-4 pt-3 pb-2">عادت‌های امروز</h2>
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
                      h.checkedInToday ? "bg-brand-600 border-brand-600 text-white" : "border-gray-300 text-transparent"
                    }`}
                  >
                    <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </button>
                  <span className="shrink-0">{h.icon || "🔥"}</span>
                  <span className={`flex-1 truncate ${h.checkedInToday ? "text-gray-400 line-through" : "text-gray-800"}`}>{h.title}</span>
                  {h.checkedInToday && (
                    <button
                      onClick={() => setDurationHabit(h)}
                      className="shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-brand-600 transition"
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

      <CaptureFormModal open={showCapture} onClose={() => setShowCapture(false)} onDone={() => { setShowCapture(false); mutate(); }} />

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

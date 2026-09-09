"use client";

import { usePathname } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/apiClient";
import { toPersianDigits } from "@/lib/money";
import { TOP_BAR_HEIGHT_PX } from "@/lib/layoutConstants";
import { useCompanion } from "@/components/companion/useCompanion";
import CompanionFace from "@/components/companion/CompanionFace";
import { MOOD_FA_LABEL } from "@/components/companion/moodTokens";
import { formatDuration } from "@/lib/money";

interface CapitalBadgeData {
  capital: { investedMinutes: number; firstRecordAt: string | null };
}

// Fixed height (not padding-based) so Home's own calc(100vh - ...) no-scroll layout can rely on
// an exact number — see TOP_BAR_HEIGHT_PX. Search and notifications used to live in the right
// slot here; both moved into BottomNav's "بیشتر" sheet instead, freeing this header up to just
// show state: total invested hours on the left (every page), the companion's face in the
// center (Home only — it needs Home's own day-battery/habit data).
export default function AppTopBar({ userName }: { userName: string }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const { state: companionState, enabled: companionEnabled } = useCompanion();

  // Shared SWR cache key with the /capital page — this doesn't add a second network round
  // trip, just a second reader of the same cached response.
  const { data } = useSWR<CapitalBadgeData>("/api/capital", fetcher);
  const minutes = data?.capital.firstRecordAt ? data.capital.investedMinutes : null;
  const hours = minutes !== null ? Math.round(minutes / 60) : null;

  return (
    <header
      className="sticky top-0 z-20 bg-surface/80 backdrop-blur border-b border-line px-4"
      style={{ height: TOP_BAR_HEIGHT_PX }}
    >
      <div className="h-full grid grid-cols-3 items-center">
        <p className="font-bold text-ink text-sm truncate">مسیر {userName}</p>

        <div className="flex justify-center">
          {isHome && companionEnabled && companionState && (
            <Link
              href="/capital"
              aria-label={`آدمک: ${MOOD_FA_LABEL[companionState.mood]}، ${formatDuration(companionState.achievedMinutes)} از ${formatDuration(companionState.targetMinutes)}`}
            >
              <CompanionFace mood={companionState.mood} completion={companionState.completion} size={40} variant="face" />
            </Link>
          )}
        </div>

        <div className="flex items-center justify-end">
          {hours !== null && (
            <Link href="/capital" className="bg-accent-soft rounded-2xl px-3 py-1 text-sm font-bold text-accent leading-none">
              {toPersianDigits(hours)} ساعت
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/apiClient";
import { toPersianDigits } from "@/lib/money";
import SearchBox from "@/components/SearchBox";
import NotificationBell from "@/components/NotificationBell";
import MilestoneProgressBar from "@/components/MilestoneProgressBar";
import { SearchIcon } from "@/components/icons";
import { TOP_BAR_HEIGHT_PX } from "@/lib/layoutConstants";
import { nextMilestoneMinutes } from "@/lib/milestones";

interface CapitalBadgeData {
  capital: { investedMinutes: number; firstRecordAt: string | null };
}

// Fixed height (not padding-based) so Home's own calc(100vh - ...) no-scroll layout can rely on
// an exact number — see TOP_BAR_HEIGHT_PX. On Home specifically, the center slot shows the
// invested-hours figure that used to be its own card further down the page (see page.tsx) —
// everywhere else this stays a plain title/search/bell strip.
export default function AppTopBar({ userName }: { userName: string }) {
  const [showSearch, setShowSearch] = useState(false);
  const pathname = usePathname();
  const isHome = pathname === "/";

  // Shares the SWR cache key with CapitalHeader/the /capital page — this doesn't add a second
  // network round trip, just a second reader of the same cached response.
  const { data } = useSWR<CapitalBadgeData>(isHome ? "/api/capital" : null, fetcher);
  const minutes = data?.capital.firstRecordAt ? data.capital.investedMinutes : null;
  const hours = minutes !== null ? Math.round(minutes / 60) : null;
  const nextMilestone = minutes !== null ? nextMilestoneMinutes(minutes) : null;

  return (
    <header
      className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-gray-100 px-4"
      style={{ height: TOP_BAR_HEIGHT_PX }}
    >
      {showSearch ? (
        <div className="h-full flex items-center gap-2">
          <SearchBox autoFocus />
          <button onClick={() => setShowSearch(false)} className="text-sm text-gray-400 shrink-0">
            بستن
          </button>
        </div>
      ) : (
        <div className="h-full grid grid-cols-3 items-center">
          <p className="font-bold text-gray-800 text-sm truncate">مسیر {userName}</p>

          <div className="flex justify-center">
            {isHome && hours !== null && minutes !== null && (
              <Link href="/capital" className="flex flex-col items-center gap-1 bg-brand-50 rounded-2xl px-3.5 py-1.5">
                <span className="text-sm font-bold text-brand-700 leading-none">{toPersianDigits(hours)} ساعت</span>
                {nextMilestone !== null && (
                  <div className="w-14">
                    <MilestoneProgressBar totalMinutes={minutes} nextMilestoneMinutes={nextMilestone} />
                  </div>
                )}
              </Link>
            )}
          </div>

          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => setShowSearch(true)}
              className="p-2 rounded-full hover:bg-gray-100 text-gray-400"
              aria-label="جستجو"
            >
              <SearchIcon className="w-5 h-5" />
            </button>
            <NotificationBell />
          </div>
        </div>
      )}
    </header>
  );
}

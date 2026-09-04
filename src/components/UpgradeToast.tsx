"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { phraseBuildAdded, phraseMilestoneProgress } from "@/lib/phrasing";
import MilestoneProgressBar from "./MilestoneProgressBar";
import { XIcon } from "@/components/icons";

interface UpgradeEffectDto {
  entryId: string;
  label: string;
  addedMinutes: number;
  categoryTotalMinutes: number;
  nextMilestoneMinutes: number | null;
}

const VISIBLE_MS = 5000;

/**
 * The honest "upgrade card" — after any record that produced a VirtualAssetEntry (see
 * computeUpgradeEffect), shows what it actually added to the running total, for ~5s. Polls
 * nothing on its own; every write path that can create one of these entries calls
 * mutate("/api/virtual-assets/latest-effect") (or the /api/virtual-assets wildcard CaptureForm
 * already uses) to wake this up. Mounted once, globally (see (app)/layout.tsx), since the
 * triggering action can happen from any page, not just Home.
 */
export default function UpgradeToast() {
  const { data } = useSWR<{ effect: UpgradeEffectDto | null }>("/api/virtual-assets/latest-effect", fetcher);
  const [shown, setShown] = useState<UpgradeEffectDto | null>(null);
  const lastEntryId = useRef<string | null>(null);

  useEffect(() => {
    const effect = data?.effect;
    if (!effect || effect.entryId === lastEntryId.current) return;
    lastEntryId.current = effect.entryId;
    setShown(effect);
    const timer = setTimeout(() => setShown(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [data]);

  if (!shown) return null;

  const nextMilestoneHours = shown.nextMilestoneMinutes !== null ? Math.round(shown.nextMilestoneMinutes / 60) : null;
  const remainingMinutes = shown.nextMilestoneMinutes !== null ? shown.nextMilestoneMinutes - shown.categoryTotalMinutes : null;

  return (
    <div className="fixed top-0 inset-x-0 z-50 flex justify-center px-4 pt-3 pointer-events-none" dir="rtl">
      <div className="pointer-events-auto w-full max-w-sm bg-white rounded-2xl border border-gray-100 shadow-card p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-sm text-gray-800">{phraseBuildAdded(shown.addedMinutes, shown.label)}</p>
            <p className="text-xs text-gray-500">{phraseMilestoneProgress(shown.categoryTotalMinutes, nextMilestoneHours, remainingMinutes)}</p>
          </div>
          <button onClick={() => setShown(null)} aria-label="بستن" className="text-gray-400 hover:text-gray-600 p-1 shrink-0">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
        <MilestoneProgressBar totalMinutes={shown.categoryTotalMinutes} nextMilestoneMinutes={shown.nextMilestoneMinutes} />
      </div>
    </div>
  );
}

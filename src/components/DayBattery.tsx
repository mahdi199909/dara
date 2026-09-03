"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { formatDuration } from "@/lib/money";
import { Card } from "@/components/ui/Card";

interface DaySegmentDto {
  kind: "PRODUCTIVE" | "NEUTRAL" | "WASTE" | "UNLOGGED" | "REMAINING";
  start: string;
  end: string;
  minutes: number;
}
interface DayBatteryDto {
  segments: DaySegmentDto[];
  capacityMinutes: number;
  loggedMinutes: number;
  unloggedMinutes: number;
  remainingMinutes: number;
  dayOver: boolean;
}

const SEGMENT_CLASS: Record<string, string> = {
  PRODUCTIVE: "bg-brand-600",
  NEUTRAL: "bg-gray-400",
  WASTE: "bg-amber-500", // not red — the day battery never judges, see the product brief
  REMAINING: "bg-gray-100",
};

// Subtle diagonal stripe for past-but-unlogged time — visually distinct from REMAINING (plain,
// future, hasn't happened yet) so "you didn't log this" and "this hasn't happened yet" never
// read as the same gray.
const UNLOGGED_STYLE: React.CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, #e5e7eb, #e5e7eb 4px, #d1d5db 4px, #d1d5db 8px)",
};

/**
 * "روزت داره تمام می‌شود" — a full-width bar of today's waking hours, filled in chronological
 * order (RTL: right = wake time, left = sleep time) by what was actually logged. Tapping an
 * unlogged gap opens the capture form pre-filled to exactly that gap — this is the mandatory
 * "مسیر" (path) the pain→path→pride rule requires right next to the "درد" of an unlogged gap.
 */
export default function DayBattery({ onLogGap }: { onLogGap: (start: Date, end: Date) => void }) {
  const { data } = useSWR<{ battery: DayBatteryDto }>("/api/day-battery", fetcher);
  const [filled, setFilled] = useState(false);
  // The fill-in transition is only meant to play once, on mount — not every time this data
  // refetches (e.g. on app resume). Dropping the transition class after it's had time to finish
  // means a later width change (segments shifting as the day moves on) just snaps in instead of
  // re-animating.
  const [animating, setAnimating] = useState(true);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setFilled(true));
    const timeout = setTimeout(() => setAnimating(false), 450);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, []);

  if (!data) return null;
  const { battery } = data;
  if (battery.capacityMinutes <= 0) return null;

  return (
    <Card className="p-4">
      <div className="w-full h-[14px] rounded-full overflow-hidden flex bg-gray-100" dir="rtl">
        {battery.segments.map((seg, i) => {
          const isUnlogged = seg.kind === "UNLOGGED";
          const widthPct = (seg.minutes / battery.capacityMinutes) * 100;
          return (
            <button
              key={i}
              type="button"
              disabled={!isUnlogged}
              onClick={() => isUnlogged && onLogGap(new Date(seg.start), new Date(seg.end))}
              aria-label={isUnlogged ? "ثبت این بازه" : undefined}
              className={`h-full shrink-0 ${animating ? "transition-[width] duration-[400ms] ease-out" : ""} ${SEGMENT_CLASS[seg.kind] ?? ""} ${
                isUnlogged ? "cursor-pointer" : "cursor-default"
              }`}
              style={{ width: filled ? `${widthPct}%` : "0%", ...(isUnlogged ? UNLOGGED_STYLE : {}) }}
            />
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-2 text-center">
        {formatDuration(battery.loggedMinutes)} ثبت‌شده · {formatDuration(battery.unloggedMinutes)} ثبت‌نشده · {formatDuration(battery.remainingMinutes)} باقی‌مانده
      </p>
    </Card>
  );
}

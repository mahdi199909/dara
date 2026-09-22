"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";

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
}

const SEGMENT_CLASS: Record<string, string> = {
  PRODUCTIVE: "bg-accent",
  NEUTRAL: "bg-muted",
  WASTE: "bg-orange-800", // brownish-orange, not red — the bar never judges, see the product brief
  REMAINING: "bg-canvas",
};

// Subtle diagonal stripe for past-but-unlogged time, distinct from REMAINING (plain, future, hasn't
// happened yet) — "you didn't log this" and "this hasn't happened yet" must never read the same.
const UNLOGGED_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgb(var(--line)), rgb(var(--line)) 4px, rgb(var(--muted)) 4px, rgb(var(--muted)) 8px)",
};

/** The bottom layer of PersonalDashboard: the same chronological, multi-segment day bar as
 * before (right = wake time, left = sleep time, RTL) — productive/neutral/waste/striped-unlogged/
 * remaining — with nothing else around it: no header line, no caption underneath. Read-only for
 * now (the segments' old tap-to-log-a-gap affordance lives in QuickTaskInput's "+" button instead,
 * whose BLINDFOLDED-mood behavior already opens the largest unlogged gap). */
export default function ProgressBar() {
  const { data } = useSWR<{ battery: DayBatteryDto }>("/api/day-battery", fetcher);
  const battery = data?.battery;
  const capacity = battery?.capacityMinutes ?? 0;

  return (
    <div className="flex-[2] min-h-0 flex items-start pt-[10px] px-[6%]" dir="rtl">
      <div className="flex-1 h-[25%] min-h-[6px] rounded-full overflow-hidden flex bg-canvas" role="img" aria-label="پیشرفت امروز">
        {battery?.segments.map((seg, i) => {
          const isUnlogged = seg.kind === "UNLOGGED";
          const widthPct = capacity > 0 ? (seg.minutes / capacity) * 100 : 0;
          return (
            <div
              key={i}
              className={`h-full shrink-0 ${SEGMENT_CLASS[seg.kind] ?? ""}`}
              style={{ width: `${widthPct}%`, ...(isUnlogged ? UNLOGGED_STYLE : {}) }}
            />
          );
        })}
      </div>
    </div>
  );
}

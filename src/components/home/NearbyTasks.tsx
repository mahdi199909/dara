"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import { toJalali, weekdayNameFa, formatTime } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";
import { isSameDay } from "@/lib/calendarGrid";

/** "امروز" / "فردا" / weekday name — a short, humane day label for a semi-tabular list row. */
function shortRelativeDay(date: Date): string {
  const today = new Date();
  if (isSameDay(date, today)) return "امروز";
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (isSameDay(date, tomorrow)) return "فردا";
  return `${weekdayNameFa(date)} ${toPersianDigits(toJalali(date).jd)}`;
}

interface NearbyItem {
  id: string;
  kind: "EVENT" | "INSTALLMENT";
  title: string;
  when: Date;
  dayLabel: string;
  amountLabel: string | null;
  overdue: boolean;
}

// Rounded to today's midnight, not the exact instant: an SWR key built from new Date().toISOString()
// changes on every millisecond, so it would never be the same string twice — SWR would see every
// render as a brand new query and refetch forever. Day-boundaries stay identical across renders
// within the same calendar day, same fix todayRange() in page.tsx already relies on.
function upcomingWindow() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/** The top layer of PersonalDashboard: upcoming events and unpaid installments together, right-
 * to-left (nearest at the right, matching RTL reading order) as a semi-tabular strip — divider
 * lines between entries, not separate cards — with a thin RTL scroll-position indicator
 * underneath. Sized to its own content (no vertical scroll; horizontal scroll carries overflow). */
export default function NearbyTasks() {
  const { from, to } = upcomingWindow();
  const { data: eventsData } = useSWR<{ occurrences: any[] }>(
    `/api/events?from=${from.toISOString()}&to=${to.toISOString()}`,
    fetcher
  );
  const { data: plansData } = useSWR<{ plans: any[] }>("/api/installment-plans", fetcher);
  const { format } = useCurrencyUnit();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollFrac, setScrollFrac] = useState(0);
  const [visibleFrac, setVisibleFrac] = useState(1);

  // The query window starts at today's midnight (for a stable SWR key — see upcomingWindow's own
  // comment), so it can include events already finished earlier today; filtered back out here.
  const now = new Date();
  const eventItems: NearbyItem[] = (eventsData?.occurrences ?? [])
    .filter((occ: any) => new Date(occ.startAt) >= now)
    .map((occ: any) => ({
      id: `event:${occ.event.id}:${occ.startAt}`,
      kind: "EVENT" as const,
      title: occ.event.title,
      when: new Date(occ.startAt),
      dayLabel: occ.event.allDay
        ? shortRelativeDay(new Date(occ.startAt))
        : `${shortRelativeDay(new Date(occ.startAt))} ${formatTime(new Date(occ.startAt))}`,
      amountLabel: occ.event.directCost ? format(occ.event.directCost, { withSuffix: true }) : null,
      overdue: false,
    }));

  const plans = plansData?.plans ?? [];
  const installmentItems: NearbyItem[] = plans
    .flatMap((plan: any) => plan.installments.filter((i: any) => i.status !== "PAID").map((i: any) => ({ ...i, planTitle: plan.title })))
    .map((inst: any) => ({
      id: `installment:${inst.id}`,
      kind: "INSTALLMENT" as const,
      title: inst.planTitle,
      when: new Date(inst.dueDate),
      dayLabel: shortRelativeDay(new Date(inst.dueDate)),
      amountLabel: format(inst.amount, { withSuffix: true }),
      overdue: inst.status === "OVERDUE",
    }));

  const upcoming = [...eventItems, ...installmentItems].sort((a, b) => a.when.getTime() - b.when.getTime()).slice(0, 12);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setVisibleFrac(el.scrollWidth > 0 ? el.clientWidth / el.scrollWidth : 1);
    // RTL scrollLeft's sign/origin differs by browser engine; the magnitude normalized against
    // the max scroll distance reads the same 0 (start) .. 1 (end) fraction everywhere.
    setScrollFrac(max > 0 ? Math.min(1, Math.abs(el.scrollLeft) / max) : 0);
  }

  return (
    <Link href="/finance" className="flex-none flex flex-col overflow-hidden">
      <p className="shrink-0 pt-3 pb-1.5 pr-[8%] text-sm font-semibold text-ink">کارهای نزدیک</p>
      {upcoming.length === 0 ? (
        <p className="shrink-0 text-xs text-muted px-[8%] pb-3">چیزی برای نمایش نیست.</p>
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          dir="rtl"
          className="shrink-0 flex items-stretch gap-3 overflow-x-auto scrollbar-none px-[8%] pb-2.5"
        >
          {upcoming.map((item, i) => (
            <div key={item.id} className="shrink-0 flex items-stretch">
              {i > 0 && <div className="self-center w-px bg-line ml-3" style={{ height: "65%" }} />}
              <div className="shrink-0 w-[24vw] max-w-[150px] flex flex-col justify-center gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span aria-hidden className={`shrink-0 w-1.5 h-1.5 rounded-full ${item.overdue ? "bg-waste" : "bg-accent"}`} />
                  <p className="text-xs font-medium text-ink truncate">{item.title}</p>
                </div>
                <p className="text-[11px] text-muted">{item.dayLabel}</p>
                {item.amountLabel && <p className="text-[11px] font-semibold text-ink">{item.amountLabel}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* No bottom padding here — QuickTaskInput's own pt-[10px] is the sole source of the gap
          to the next section, so the two don't stack into 20px. */}
      {upcoming.length > 0 && (
        <div className="shrink-0 flex items-center px-[10%]">
          <div className="relative w-[80%] h-[3px] rounded-full bg-line overflow-hidden mr-0 ml-auto" dir="rtl">
            <div
              className="absolute inset-y-0 rounded-full bg-accent"
              style={{ width: `${Math.max(visibleFrac, 0.15) * 100}%`, right: `${scrollFrac * (1 - Math.max(visibleFrac, 0.15)) * 100}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  );
}

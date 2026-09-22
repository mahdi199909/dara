"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/apiClient";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import { toJalali, weekdayNameFa } from "@/lib/jalali";
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

/** The top layer of PersonalDashboard: the nearest unpaid installments, right-to-left (newest/
 * nearest at the right, matching RTL reading order) as a semi-tabular strip — divider lines
 * between entries, not separate cards — with a thin RTL scroll-position indicator underneath. */
export default function NearbyTasks() {
  const { data } = useSWR<{ plans: any[] }>("/api/installment-plans", fetcher);
  const { format } = useCurrencyUnit();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollFrac, setScrollFrac] = useState(0);
  const [visibleFrac, setVisibleFrac] = useState(1);

  const plans = data?.plans ?? [];
  const upcoming = plans
    .flatMap((plan: any) => plan.installments.filter((i: any) => i.status !== "PAID").map((i: any) => ({ ...i, planTitle: plan.title })))
    .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 8);

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
    <Link href="/finance" className="flex-[2] min-h-0 flex flex-col overflow-hidden">
      {/* CSS resolves percentage padding-top against the container's WIDTH, not its height (a
          long-standing box-model quirk) — an 8%-of-height top offset has no plain-CSS equivalent,
          so this uses a fixed rem gap instead (still non-px, per the brief's own allowance for
          rem/em/vw/clamp on this kind of fine spacing). Horizontal padding has no such quirk. */}
      <p className="shrink-0 pt-2.5 pr-[8%] text-sm font-semibold text-ink">کارهای نزدیک</p>
      {upcoming.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center px-4">
          <p className="text-xs text-muted">قسطی برای پرداخت نیست.</p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          dir="rtl"
          className="flex-1 min-h-0 flex items-stretch overflow-x-auto scrollbar-none px-2"
        >
          {upcoming.map((inst, i) => (
            <div key={inst.id} className="shrink-0 flex items-stretch">
              {i > 0 && <div className="self-center w-px bg-line" style={{ height: "65%" }} />}
              <div className="shrink-0 w-[22vw] max-w-[140px] flex flex-col justify-center gap-1 px-2.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span aria-hidden className={`shrink-0 w-1.5 h-1.5 rounded-full ${inst.status === "OVERDUE" ? "bg-waste" : "bg-accent"}`} />
                  <p className="text-xs font-medium text-ink truncate">{inst.planTitle}</p>
                </div>
                <p className="text-[11px] text-muted">{shortRelativeDay(new Date(inst.dueDate))}</p>
                <p className="text-[11px] font-semibold text-ink">{format(inst.amount, { withSuffix: true })}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="shrink-0 h-[3%] min-h-[3px] flex items-center px-[10%] pb-1.5">
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

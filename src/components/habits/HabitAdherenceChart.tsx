"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { toJalali } from "@/lib/jalali";
import { toPersianDigits } from "@/lib/money";
import { ChevronDownIcon, FlameIcon } from "@/components/icons";

function shortJalali(dateIso: string) {
  const { jm, jd } = toJalali(new Date(dateIso));
  return toPersianDigits(`${jd}/${jm}`);
}

/** Collapsible line chart of daily habit adherence (% of active habits checked in each day). */
export default function HabitAdherenceChart({ series, currentStreak, defaultOpen = false }: { series: any[]; currentStreak: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  const chartData = series.map((d) => ({ date: d.date, percent: Math.round(d.ratio * 100) }));
  const hasData = chartData.some((d) => d.percent > 0);

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between text-sm text-gray-600 py-1">
        <span className="flex items-center gap-1.5">
          <FlameIcon className={`w-4 h-4 ${currentStreak > 0 ? "text-amber-500" : "text-gray-300"}`} />
          <span>{currentStreak > 0 ? `${toPersianDigits(currentStreak)} روز پشت‌سرهم` : "بدون استریک فعال"}</span>
        </span>
        <span className="flex items-center gap-1 text-gray-400">
          نمودار پایبندی
          <ChevronDownIcon className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="mt-2">
          {!hasData ? (
            <p className="text-xs text-gray-400 text-center py-4">هنوز داده‌ای برای رسم نمودار نیست.</p>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" tickFormatter={shortJalali} tick={{ fontSize: 10 }} interval="preserveStartEnd" tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} width={32} tickFormatter={(v) => toPersianDigits(v)} />
                <ReferenceLine y={80} stroke="#c9b45a" strokeDasharray="4 4" />
                <Tooltip
                  labelFormatter={(v) => shortJalali(v as string)}
                  formatter={(v: number) => [`${toPersianDigits(v)}٪`, "پایبندی"]}
                />
                <Line type="monotone" dataKey="percent" stroke="#3a8d80" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
}

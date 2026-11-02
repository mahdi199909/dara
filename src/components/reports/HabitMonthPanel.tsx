"use client";

import { useMemo, useState } from "react";
import { Card, StatItem } from "@/components/ui/Card";
import { dayKeyIso, getJalaliMonthGrid, parseDayKey } from "@/lib/calendarGrid";
import { formatJalali, toJalali } from "@/lib/jalali";
import { formatDuration, toPersianDigits } from "@/lib/money";
import { HABIT_METRICS, describeDay, formatAmount, formatNumber } from "@/lib/habitMetrics";
import { chartMetric, monthBars, summarizeHabitMonth, type HabitCalendarStat } from "@/lib/habitCalendar";

const WEEKDAY_HEADERS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

/**
 * One habit's month: how many days it was done (at the top, for every habit — a habit that is only ticked has nothing
 * else to say), the total of its own measure and of its minutes when it has them, a calendar of the days with what each
 * tick logged, and a bar chart of the measure (or of the minutes) day by day. Everything but the tick is optional, so a
 * day without a number is still a day done.
 */
export default function HabitMonthPanel({ stat, jy, jm }: { stat: HabitCalendarStat; jy: number; jm: number }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const summary = useMemo(() => summarizeHabitMonth(stat), [stat]);
  const metric = chartMetric(stat);
  const kind = stat.metricKind;
  const grid = useMemo(() => getJalaliMonthGrid(jy, jm), [jy, jm]);
  const monthDays = useMemo(
    () => grid.filter((day) => toJalali(day).jm === jm).map((day) => ({ key: dayKeyIso(day), label: toJalali(day).jd })),
    [grid, jm]
  );
  const bars = useMemo(() => (metric ? monthBars(stat, metric, monthDays) : []), [stat, metric, monthDays]);
  const selected = selectedKey ? stat.days[selectedKey] : undefined;

  return (
    <div className="space-y-4 min-w-0">
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <StatItem label={`روزهای انجام‌شدهٔ ${stat.title}`} value={`${toPersianDigits(summary.daysDone)} روز`} tone="positive" />
        </Card>
        {kind && summary.amountDays > 0 ? (
          <Card className="p-4">
            <StatItem label={`مجموع ${HABIT_METRICS[kind].label.replace(/ \(.*\)$/, "")}`} value={formatAmount(kind, summary.totalAmount)} />
          </Card>
        ) : summary.totalMinutes > 0 ? (
          <Card className="p-4">
            <StatItem label="مجموع زمان" value={formatDuration(summary.totalMinutes)} />
          </Card>
        ) : (
          <Card className="p-4">
            <StatItem label="جزئیات" value="فقط تیک" />
          </Card>
        )}
      </div>

      {kind && summary.amountDays > 0 && (summary.totalMinutes > 0 || summary.best) && (
        <p className="text-xs text-muted leading-relaxed">
          {[
            summary.best ? `بیشترین در یک روز: ${formatAmount(kind, summary.best.amount)} (${formatJalali(parseDayKey(summary.best.key) ?? new Date(), { long: true })})` : null,
            summary.totalMinutes > 0 ? `مجموع زمان: ${formatDuration(summary.totalMinutes)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <Card className="p-3">
        <div className="grid grid-cols-7 text-center text-xs text-muted mb-2">
          {WEEKDAY_HEADERS.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.map((day) => {
            const { jm: dayJm, jd } = toJalali(day);
            const inMonth = dayJm === jm;
            const key = dayKeyIso(day);
            const done = inMonth ? stat.days[key] : undefined;
            const isSelected = selectedKey === key;
            const shown = done && kind && done.amount !== null ? formatNumber(done.amount, HABIT_METRICS[kind].decimals) : done ? "✓" : null;
            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={!done}
                aria-pressed={isSelected}
                onClick={() => setSelectedKey(isSelected ? null : key)}
                className={`aspect-square sm:aspect-auto sm:h-16 rounded-xl border p-1 flex flex-col items-center justify-center gap-0.5 ${
                  !inMonth ? "bg-canvas border-transparent text-muted" : done ? (isSelected ? "border-accent ring-2 ring-accent" : "border-accent-soft") : "bg-surface border-line"
                }`}
                style={done ? { backgroundColor: "rgb(var(--accent) / 0.22)" } : undefined}
              >
                <span className={`text-xs ${inMonth ? (done ? "text-accent font-bold" : "text-ink") : "text-muted"}`}>{toPersianDigits(jd)}</span>
                {shown && <span className="text-[10px] text-accent">{shown}</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted">
          {summary.daysDone > 0 ? "هر خانهٔ رنگی یک روزِ انجام‌شده است؛ عددش همان است که آن روز نوشتی، و اگر چیزی ننوشتی فقط ✓ دارد." : "در این ماه این عادت انجام نشده."}
        </p>
      </Card>

      {selectedKey && selected && (
        <Card className="p-4">
          <p className="text-sm font-bold text-ink">{formatJalali(parseDayKey(selectedKey) ?? new Date(), { withWeekday: true, long: true })}</p>
          <p className="text-sm text-muted mt-1">{describeDay(kind, selected.amount, selected.minutes) ?? "انجام شد؛ جزئیاتی نوشته نشده."}</p>
        </Card>
      )}

      {metric && (
        <Card className="p-4">
          <p className="text-xs text-muted mb-2">{metric === "amount" && kind ? `${HABIT_METRICS[kind].label.replace(/ \(.*\)$/, "")} هر روز` : "زمانِ هر روز (دقیقه)"}</p>
          <MonthBars bars={bars} metric={metric} kind={kind} />
        </Card>
      )}
    </div>
  );
}

/** Day by day bars, the first day of the month on the right (the way the calendar above reads). */
function MonthBars({ bars, metric, kind }: { bars: ReturnType<typeof monthBars>; metric: "amount" | "minutes"; kind: HabitCalendarStat["metricKind"] }) {
  const width = 320;
  const height = 120;
  const base = 100;
  const step = width / Math.max(1, bars.length);
  const tallest = Math.max(0, ...bars.map((b) => b.value));
  const unit = metric === "amount" && kind ? HABIT_METRICS[kind].unit : "دقیقه";
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={`نمودار روزانه، بیشترین ${formatNumber(tallest, 1)} ${unit}`} style={{ direction: "ltr" }}>
      <line x1={0} y1={base} x2={width} y2={base} style={{ stroke: "rgb(var(--line))" }} strokeWidth={1} />
      {bars.map((bar, i) => {
        const x = (bars.length - 1 - i) * step;
        const h = bar.height * (base - 14);
        return (
          <g key={bar.key}>
            {bar.value > 0 && (
              <rect x={x + step * 0.18} y={base - h} width={step * 0.64} height={h} rx={2} style={{ fill: "rgb(var(--accent))" }}>
                <title>{`${toPersianDigits(bar.label)}: ${formatNumber(bar.value, metric === "amount" && kind ? HABIT_METRICS[kind].decimals : 0)} ${unit}`}</title>
              </rect>
            )}
            {(bar.label === 1 || bar.label % 5 === 0) && (
              <text x={x + step / 2} y={base + 13} fontSize={9} textAnchor="middle" style={{ fill: "rgb(var(--muted))" }}>
                {toPersianDigits(bar.label)}
              </text>
            )}
          </g>
        );
      })}
      {tallest > 0 && (
        <text x={width - 2} y={10} fontSize={9} textAnchor="end" style={{ fill: "rgb(var(--muted))" }}>
          {`${formatNumber(tallest, 1)} ${unit}`}
        </text>
      )}
    </svg>
  );
}

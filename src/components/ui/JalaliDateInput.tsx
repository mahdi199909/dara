"use client";

import { useState } from "react";
import { toJalali, formatJalaliMonthYear } from "@/lib/jalali";
import { getJalaliMonthGrid, isSameDay, addJalaliMonths, fromJalali } from "@/lib/calendarGrid";
import { toPersianDigits } from "@/lib/money";
import { ChevronRightIcon, ChevronLeftIcon, CalendarIcon } from "@/components/icons";

const WEEKDAY_HEADERS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

/** Formats a Date as a compact Jalali date string, e.g. "۱ شهریور ۱۴۰۵". */
function formatShort(date: Date): string {
  const { jd } = toJalali(date);
  return toPersianDigits(jd) + " " + formatJalaliMonthYear(date);
}

export default function JalaliDateInput({
  value,
  onChange,
  className = "",
}: {
  value: Date;
  onChange: (date: Date) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(value);
  const { jy, jm } = toJalali(cursor);

  function pick(day: Date) {
    // Preserve the existing time-of-day from `value` — this picker only controls the date part.
    const next = new Date(day);
    next.setHours(value.getHours(), value.getMinutes(), value.getSeconds(), 0);
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setCursor(value);
          setOpen((v) => !v);
        }}
        className={`w-full flex items-center justify-between rounded-xl border border-line px-3 py-2.5 text-sm bg-surface hover:border-line transition ${className}`}
      >
        <span className="text-ink">{formatShort(value)}</span>
        <CalendarIcon className="w-4 h-4 text-muted" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-2 w-72 bg-surface rounded-2xl shadow-lg border border-line p-3">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => setCursor(fromJalali(addJalaliMonths(jy, jm, 1).jy, addJalaliMonths(jy, jm, 1).jm, 1))} className="p-1.5 rounded-lg hover:bg-canvas text-muted">
                <ChevronRightIcon className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium text-ink">{formatJalaliMonthYear(cursor)}</span>
              <button type="button" onClick={() => setCursor(fromJalali(addJalaliMonths(jy, jm, -1).jy, addJalaliMonths(jy, jm, -1).jm, 1))} className="p-1.5 rounded-lg hover:bg-canvas text-muted">
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center text-xs text-muted mb-1">
              {WEEKDAY_HEADERS.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {getJalaliMonthGrid(jy, jm).map((day) => {
                const { jm: dJm, jd } = toJalali(day);
                const inMonth = dJm === jm;
                const selected = isSameDay(day, value);
                const isToday = isSameDay(day, new Date());
                return (
                  <button
                    type="button"
                    key={day.toISOString()}
                    onClick={() => pick(day)}
                    className={`h-8 rounded-lg text-xs transition ${
                      selected
                        ? "bg-accent text-on-accent font-medium"
                        : inMonth
                          ? isToday
                            ? "bg-accent-soft text-accent font-medium"
                            : "text-ink hover:bg-canvas"
                          : "text-muted hover:bg-canvas"
                    }`}
                  >
                    {toPersianDigits(jd)}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => pick(new Date())}
              className="w-full mt-2 text-xs text-accent hover:bg-accent-soft rounded-lg py-1.5"
            >
              امروز
            </button>
          </div>
        </>
      )}
    </div>
  );
}

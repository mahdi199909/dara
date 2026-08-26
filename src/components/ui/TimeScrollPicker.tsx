"use client";

import { useState, useRef, useEffect } from "react";
import { toPersianDigits } from "@/lib/money";
import { XIcon, ClockIcon } from "@/components/icons";

const ROW_HEIGHT = 40;
const VISIBLE_ROWS = 5;
const PADDING = Math.floor(VISIBLE_ROWS / 2) * ROW_HEIGHT;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function WheelColumn({ count, value, onChange }: { count: number; value: number; onChange: (v: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const skipNextScroll = useRef(true);
  const settleTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Jump to the initial value the moment this column mounts (the picker modal remounts its
  // columns every time it opens) — no animation, this is just "where the wheel starts".
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: value * ROW_HEIGHT });
    const t = setTimeout(() => {
      skipNextScroll.current = false;
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    if (skipNextScroll.current) return;
    if (settleTimeout.current) clearTimeout(settleTimeout.current);
    // Wait for scrolling to settle (CSS scroll-snap does the visual snapping; this just
    // reads where it landed) rather than reacting to every intermediate scroll frame.
    settleTimeout.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const index = Math.max(0, Math.min(count - 1, Math.round(el.scrollTop / ROW_HEIGHT)));
      onChange(index);
      el.scrollTo({ top: index * ROW_HEIGHT, behavior: "smooth" });
    }, 120);
  }

  function selectIndex(i: number) {
    onChange(i);
    scrollRef.current?.scrollTo({ top: i * ROW_HEIGHT, behavior: "smooth" });
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="w-14 overflow-y-scroll scrollbar-none relative z-20"
      style={{ height: VISIBLE_ROWS * ROW_HEIGHT, scrollSnapType: "y mandatory", paddingBlock: PADDING }}
    >
      {Array.from({ length: count }, (_, i) => (
        <button
          type="button"
          key={i}
          onClick={() => selectIndex(i)}
          className={`w-full flex items-center justify-center text-lg tabular-nums transition-colors ${
            i === value ? "text-brand-700 font-bold" : "text-gray-300"
          }`}
          style={{ height: ROW_HEIGHT, scrollSnapAlign: "center" }}
        >
          {toPersianDigits(pad2(i))}
        </button>
      ))}
    </div>
  );
}

/**
 * Replaces the native `<input type="time">` (whose UI varies wildly by browser/OS and is
 * generally cramped/awkward) with a scroll-wheel time picker in a bottom-sheet modal,
 * matching the app's existing modal pattern (EventFormModal, HabitFormModal, etc).
 * value/onChange keep the exact "" | "HH:MM" contract the native input had, so every call
 * site swaps in with no change to its own state or submit logic.
 */
export default function TimeScrollPicker({
  value,
  onChange,
  placeholder,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Hides the "پاک کردن" button — for a time that can't meaningfully be empty (e.g. an event's start time). */
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(12);
  const [m, setM] = useState(0);

  function openPicker() {
    const [hh, mm] = value ? value.split(":").map(Number) : [12, 0];
    setH(hh);
    setM(mm);
    setOpen(true);
  }

  function confirm() {
    onChange(`${pad2(h)}:${pad2(m)}`);
    setOpen(false);
  }

  function clear() {
    onChange("");
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        dir="ltr"
        className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-center hover:border-gray-300 transition"
      >
        <ClockIcon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        {value ? toPersianDigits(value) : <span className="text-gray-400">{placeholder}</span>}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xs mx-auto bg-white rounded-t-2xl shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 text-sm">انتخاب ساعت</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            <div className="relative flex items-center justify-center gap-1" dir="ltr" style={{ height: VISIBLE_ROWS * ROW_HEIGHT }}>
              <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 rounded-lg bg-brand-50 border-y border-brand-200 z-0" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white via-transparent to-white z-10" />
              <WheelColumn count={24} value={h} onChange={setH} />
              <span className="text-lg font-bold text-gray-400 z-20">:</span>
              <WheelColumn count={60} value={m} onChange={setM} />
            </div>

            <div className="flex gap-2 mt-5">
              {!required && (
                <button
                  type="button"
                  onClick={clear}
                  className="flex-1 rounded-xl border border-gray-200 text-gray-500 text-sm py-2.5 hover:bg-gray-50"
                >
                  پاک کردن
                </button>
              )}
              <button
                type="button"
                onClick={confirm}
                className="flex-1 rounded-xl bg-brand-600 text-white text-sm py-2.5 hover:bg-brand-700"
              >
                تأیید
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

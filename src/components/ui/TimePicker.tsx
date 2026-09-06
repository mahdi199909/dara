"use client";

import { useEffect, useRef, useState } from "react";
import { toAsciiDigits, toPersianDigits } from "@/lib/money";
import { XIcon, ClockIcon } from "@/components/icons";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_STEP = 5;
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

// Clock-face layout: 24 hours don't fit one legible ring, so the hour dial stacks two
// concentric rings (0-11 inner, 12-23 outer, same 12 angular slots) — the minute dial (already
// only 12 five-minute marks) fits a single ring at the outer radius, same visual language.
const DIAL_SIZE = 256;
const DIAL_CENTER = DIAL_SIZE / 2;
const OUTER_RADIUS = 100;
const INNER_RADIUS = 64;
const OUTER_BTN = 40;
const INNER_BTN = 34;

/** Position of slot `index` of `count` evenly-spaced slots around a clock face, slot 0 at 12 o'clock, clockwise. */
function polarPos(index: number, count: number, radius: number) {
  const angle = ((index * (360 / count)) * Math.PI) / 180;
  return { x: DIAL_CENTER + radius * Math.sin(angle), y: DIAL_CENTER - radius * Math.cos(angle) };
}

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, n));
}

/**
 * Bottom-sheet time input, styled as a clock face. Starting from empty, it's a two-step dial —
 * every hour arranged like a clock (0-11 outer ring, 12-23 inner ring), then every 5-minute mark
 * on a single ring — that commits the instant a minute is tapped. Re-opening an already-set
 * value switches to direct typing instead, since the 5-minute dial can't itself land on an odd
 * minute (e.g. :37).
 * value/onChange speak plain "" | "HH:MM" (24-hour, ASCII digits).
 */
export default function TimePicker({
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
  const [mode, setMode] = useState<"dial" | "type">("dial");
  const [step, setStep] = useState<"hour" | "minute">("hour");
  const [h, setH] = useState(0);
  const [hourText, setHourText] = useState("");
  const [minuteText, setMinuteText] = useState("");
  const [focusField, setFocusField] = useState<"hour" | "minute">("hour");
  const hourInputRef = useRef<HTMLInputElement>(null);
  const minuteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || mode !== "type") return;
    const t = setTimeout(() => {
      (focusField === "hour" ? hourInputRef : minuteInputRef).current?.select();
    }, 50);
    return () => clearTimeout(t);
  }, [open, mode, focusField]);

  function openPicker() {
    if (value) {
      const [hh, mm] = value.split(":");
      setHourText(toPersianDigits(hh));
      setMinuteText(toPersianDigits(mm));
      setFocusField("hour");
      setMode("type");
    } else {
      setStep("hour");
      setMode("dial");
    }
    setOpen(true);
  }

  function pickHour(i: number) {
    setH(i);
    setStep("minute");
  }

  function pickMinute(i: number) {
    onChange(`${pad2(h)}:${pad2(i)}`);
    setOpen(false);
  }

  function switchToTypeFromMinuteStep() {
    setHourText(toPersianDigits(pad2(h)));
    setMinuteText("");
    setFocusField("minute");
    setMode("type");
  }

  function digitsOnly(raw: string) {
    return toAsciiDigits(raw).replace(/\D/g, "").slice(0, 2);
  }

  function confirmTyped() {
    const hh = clamp(Number(toAsciiDigits(hourText)) || 0, 23);
    const mm = clamp(Number(toAsciiDigits(minuteText)) || 0, 59);
    onChange(`${pad2(hh)}:${pad2(mm)}`);
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
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xs mx-auto bg-white rounded-t-2xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 text-sm">
                {mode === "type" ? placeholder || "زمان" : step === "hour" ? "ساعت را انتخاب کن" : "دقیقه را انتخاب کن"}
              </h3>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            {mode === "dial" && step === "hour" && (
              <div className="relative mx-auto" style={{ width: DIAL_SIZE, height: DIAL_SIZE }} dir="ltr">
                <div className="absolute inset-0 rounded-full bg-gray-50" />
                <div
                  className="absolute rounded-full border border-gray-200"
                  style={{
                    left: DIAL_CENTER - (INNER_RADIUS + INNER_BTN / 2),
                    top: DIAL_CENTER - (INNER_RADIUS + INNER_BTN / 2),
                    width: (INNER_RADIUS + INNER_BTN / 2) * 2,
                    height: (INNER_RADIUS + INNER_BTN / 2) * 2,
                  }}
                />
                {HOURS.slice(0, 12).map((i) => {
                  const { x, y } = polarPos(i, 12, INNER_RADIUS);
                  return (
                    <button
                      type="button"
                      key={i}
                      onClick={() => pickHour(i)}
                      className="absolute flex items-center justify-center rounded-full text-xs tabular-nums text-gray-500 hover:bg-brand-50 hover:text-brand-700 transition"
                      style={{ left: x - INNER_BTN / 2, top: y - INNER_BTN / 2, width: INNER_BTN, height: INNER_BTN }}
                    >
                      {toPersianDigits(pad2(i))}
                    </button>
                  );
                })}
                {HOURS.slice(12, 24).map((i) => {
                  const { x, y } = polarPos(i - 12, 12, OUTER_RADIUS);
                  return (
                    <button
                      type="button"
                      key={i}
                      onClick={() => pickHour(i)}
                      className="absolute flex items-center justify-center rounded-full text-sm tabular-nums text-gray-700 hover:bg-brand-50 hover:text-brand-700 transition"
                      style={{ left: x - OUTER_BTN / 2, top: y - OUTER_BTN / 2, width: OUTER_BTN, height: OUTER_BTN }}
                    >
                      {toPersianDigits(pad2(i))}
                    </button>
                  );
                })}
                <div className="absolute rounded-full bg-gray-300" style={{ left: DIAL_CENTER - 3, top: DIAL_CENTER - 3, width: 6, height: 6 }} />
              </div>
            )}

            {mode === "dial" && step === "minute" && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <button type="button" onClick={() => setStep("hour")} className="text-xs text-gray-400 hover:text-gray-600">
                    ← بازگشت به ساعت
                  </button>
                  <button type="button" onClick={switchToTypeFromMinuteStep} className="text-xs text-brand-600 hover:text-brand-700">
                    دقیقه‌ی دقیق‌تر؟ تایپ کن
                  </button>
                </div>
                <div className="relative mx-auto" style={{ width: DIAL_SIZE, height: DIAL_SIZE }} dir="ltr">
                  <div className="absolute inset-0 rounded-full bg-gray-50" />
                  {MINUTES.map((i, idx) => {
                    const { x, y } = polarPos(idx, 12, OUTER_RADIUS);
                    return (
                      <button
                        type="button"
                        key={i}
                        onClick={() => pickMinute(i)}
                        className="absolute flex items-center justify-center rounded-full text-sm tabular-nums text-gray-700 hover:bg-brand-50 hover:text-brand-700 transition"
                        style={{ left: x - OUTER_BTN / 2, top: y - OUTER_BTN / 2, width: OUTER_BTN, height: OUTER_BTN }}
                      >
                        {toPersianDigits(pad2(i))}
                      </button>
                    );
                  })}
                  <div className="absolute rounded-full bg-gray-300" style={{ left: DIAL_CENTER - 3, top: DIAL_CENTER - 3, width: 6, height: 6 }} />
                </div>
              </div>
            )}

            {mode === "type" && (
              <div className="flex items-center justify-center gap-2" dir="ltr">
                <input
                  ref={hourInputRef}
                  type="text"
                  inputMode="numeric"
                  value={hourText}
                  onChange={(e) => setHourText(toPersianDigits(digitsOnly(e.target.value)))}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    confirmTyped();
                  }}
                  className="w-16 rounded-xl border border-gray-200 py-3 text-center text-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                <span className="text-lg font-bold text-gray-400">:</span>
                <input
                  ref={minuteInputRef}
                  type="text"
                  inputMode="numeric"
                  value={minuteText}
                  onChange={(e) => setMinuteText(toPersianDigits(digitsOnly(e.target.value)))}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    confirmTyped();
                  }}
                  placeholder={toPersianDigits("00")}
                  className="w-16 rounded-xl border border-gray-200 py-3 text-center text-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
            )}

            <div className="flex gap-2 mt-5">
              {!required && (
                <button type="button" onClick={clear} className="flex-1 rounded-xl border border-gray-200 text-gray-500 text-sm py-2.5 hover:bg-gray-50">
                  پاک کردن
                </button>
              )}
              {mode === "type" && (
                <button type="button" onClick={confirmTyped} className="flex-1 rounded-xl bg-brand-600 text-white text-sm py-2.5 hover:bg-brand-700">
                  تأیید
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

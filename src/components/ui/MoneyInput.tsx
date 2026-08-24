"use client";

import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import { toAsciiDigits, toPersianDigits } from "@/lib/money";
import { CURRENCY_UNIT_LABELS } from "@/lib/types";

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats a raw "123456.7"-style string (ASCII digits, at most one dot) with thousands separators on the integer part. */
function formatTyped(raw: string): string {
  const [intPart, ...rest] = raw.split(".");
  const grouped = groupThousands(intPart.replace(/^0+(?=\d)/, ""));
  return rest.length ? `${grouped}.${rest.join("")}` : grouped;
}

/** Strips a formatted string down to raw digits + at most one decimal point (Persian digits accepted). */
function sanitize(input: string): string {
  const ascii = toAsciiDigits(input);
  const firstDot = ascii.indexOf(".");
  const digitsAndDot = ascii.replace(/[^\d.]/g, "");
  if (firstDot === -1) return digitsAndDot;
  // Keep only the first "." — anything after collapses into digits.
  const [head, ...tail] = digitsAndDot.split(".");
  return `${head}.${tail.join("")}`;
}

function countDigitsBefore(str: string, index: number): number {
  let count = 0;
  for (let i = 0; i < index && i < str.length; i++) {
    if (/\d/.test(str[i])) count++;
  }
  return count;
}

function positionAfterNDigits(str: string, n: number): number {
  if (n <= 0) return 0;
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (/\d/.test(str[i])) {
      count++;
      if (count === n) return i + 1;
    }
  }
  return str.length;
}

/**
 * Drop-in replacement for a raw `<input type="number">` money field. `value`/`onChange`
 * still speak integer Toman as a string (identical contract to the plain input it replaces —
 * every call site's submit logic is untouched), but the visible text is live-formatted with
 * thousands separators in the user's chosen display unit (lib/currencyUnit.tsx) as they type,
 * so they can see at a glance how many more digits/zeros they still need to enter.
 */
export default function MoneyInput({
  value,
  onChange,
  placeholder,
  required,
  autoFocus,
  className = "",
}: {
  value: string;
  onChange: (tomanValue: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const { unit, toToman, fromToman } = useCurrencyUnit();
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorFix = useRef<number | null>(null);

  // The raw (unformatted, ASCII-digit) text the user is editing, in the CURRENT display
  // unit — kept separate from the formatted `display` text so re-grouping on every keystroke
  // doesn't fight with what the user is actively typing.
  const [raw, setRaw] = useState(() => {
    const toman = value ? Number(value) : 0;
    if (!toman) return "";
    const displayValue = fromToman(toman);
    return Number.isInteger(displayValue) ? String(displayValue) : String(Math.round(displayValue * 100) / 100);
  });

  // Re-derive `raw` when the incoming Toman value changes from OUTSIDE this input (e.g. the
  // form loaded fetched data, or the field was reset) — but not on every render, so it
  // doesn't clobber what's being actively typed.
  const lastExternalValue = useRef(value);
  useEffect(() => {
    if (value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    const toman = value ? Number(value) : 0;
    if (!toman) {
      setRaw("");
      return;
    }
    const displayValue = fromToman(toman);
    setRaw(Number.isInteger(displayValue) ? String(displayValue) : String(Math.round(displayValue * 100) / 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const display = formatTyped(raw);

  useLayoutEffect(() => {
    if (cursorFix.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(cursorFix.current, cursorFix.current);
      cursorFix.current = null;
    }
  }, [display]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    // el.value/el.selectionStart already reflect the browser's native (uncontrolled) edit —
    // the cursor index is only valid against THIS string, not the previous render's
    // `display`. toAsciiDigits is a 1:1 character swap (same length/positions), so the
    // cursor index stays valid after normalizing digits for counting.
    const nativeValueAscii = toAsciiDigits(el.value);
    const nativeCursor = el.selectionStart ?? el.value.length;
    const digitsBefore = countDigitsBefore(nativeValueAscii, nativeCursor);

    const newRaw = sanitize(el.value);
    setRaw(newRaw);

    const newDisplay = formatTyped(newRaw);
    cursorFix.current = Math.min(positionAfterNDigits(newDisplay, digitsBefore), newDisplay.length);

    const displayNum = newRaw === "" || newRaw === "." ? 0 : parseFloat(newRaw);
    onChange(displayNum ? String(toToman(displayNum)) : "");
  }

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        dir="ltr"
        required={required}
        autoFocus={autoFocus}
        value={toPersianDigits(display)}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-right pl-14"
      />
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
        {CURRENCY_UNIT_LABELS[unit]}
      </span>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BOTTOM_NAV_HEIGHT_PX } from "@/lib/layoutConstants";
import { elapsedMs, formatClock, remainingMs } from "@/lib/focusTimer";
import { useFocusTimer, useNow } from "@/lib/focusTimerStore";

/**
 * While a «زمان‌سنج» runs, a small clock on every other screen that leads back to it. Being mounted on
 * every screen is also what keeps the timer catching up and saving finished blocks wherever the person is.
 */
export default function FocusTimerPill() {
  const pathname = usePathname();
  const { state } = useFocusTimer();
  const now = useNow(Boolean(state) && pathname !== "/timer");
  if (!state || pathname === "/timer") return null;

  const at = now || Date.now();
  const shown = remainingMs(state, at) ?? elapsedMs(state, at);
  const waiting = !state.running;

  return (
    <Link
      href="/timer"
      style={{ bottom: `calc(${BOTTOM_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom) + 1.5rem)` }}
      className={`fixed right-4 z-30 flex items-center gap-2 rounded-full border px-3.5 py-2 shadow-lg text-sm ${
        state.phase === "BREAK" ? "bg-signal-soft border-signal/40 text-signal" : "bg-surface border-line text-ink"
      }`}
      aria-label="زمان‌سنج"
    >
      <span className={`w-2 h-2 rounded-full ${waiting ? "bg-muted" : state.phase === "BREAK" ? "bg-signal" : "bg-accent animate-pulse"}`} />
      <span className="tabular-nums font-medium" dir="ltr">
        {formatClock(shown)}
      </span>
      {state.phase === "BREAK" && <span className="text-xs">استراحت</span>}
    </Link>
  );
}

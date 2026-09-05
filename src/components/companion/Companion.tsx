"use client";

import type { CompanionState } from "@/lib/companion";
import { formatDuration } from "@/lib/money";
import CompanionFace from "./CompanionFace";
import { MOOD_FA_LABEL } from "./moodTokens";

export interface CompanionProps {
  state: CompanionState;
  onAction?: () => void;
  size?: number;
  variant?: "face" | "figure";
}

/**
 * Face + speech bubble + action button, in that column order. All Persian copy (message, action
 * label) is a prop sourced from src/lib/phrasing.ts via computeCompanionState — nothing here is
 * hardcoded except the aria-label's mood name, which comes from moodTokens' small data table,
 * not inline text.
 */
export default function Companion({ state, onAction, size = 96, variant = "face" }: CompanionProps) {
  const { mood, completion, message, action, achievedMinutes, targetMinutes } = state;
  const isWarn = mood === "BLINDFOLDED";
  const ariaLabel = `آدمک: ${MOOD_FA_LABEL[mood]}، ${formatDuration(achievedMinutes)} از ${formatDuration(targetMinutes)}`;

  return (
    <div className="flex flex-col items-center gap-2">
      <CompanionFace mood={mood} completion={completion} size={size} variant={variant} label={ariaLabel} />

      <div
        className={`relative rounded-2xl border px-4 py-2.5 text-center text-sm leading-relaxed max-w-[280px] ${
          isWarn ? "bg-signal-100 border-signal-500/40 text-signal-700" : "bg-brand-50 border-brand-100 text-brand-700"
        }`}
      >
        {message}
        <span
          className={`absolute -bottom-[6px] right-1/2 translate-x-1/2 rotate-45 w-3 h-3 border-b border-r ${
            isWarn ? "bg-signal-100 border-signal-500/40" : "bg-brand-50 border-brand-100"
          }`}
        />
      </div>

      {action.kind !== "NONE" && (
        <button
          type="button"
          onClick={onAction}
          className="rounded-2xl bg-brand-600 text-white px-5 py-2.5 text-sm font-bold shadow-md shadow-brand-600/25 active:scale-[0.98] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

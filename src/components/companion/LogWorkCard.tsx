"use client";

import { useState } from "react";
import { useCompanion } from "./useCompanion";
import { MOOD_FA_LABEL } from "./moodTokens";
import { phraseCaptureReaction, type CaptureReactionKind } from "@/lib/phrasing";
import { formatDuration } from "@/lib/money";
import { PlusIcon } from "@/components/icons";

export type CaptureReaction = { kind: CaptureReactionKind; minutes?: number; amount?: number };

/** A small note/document glyph — the icon set has nothing "this becomes an entry" shaped. */
function NoteIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M13 3v5h5" />
      <path d="M8.5 12.5h7M8.5 15.5h7M8.5 18h4.5" />
    </svg>
  );
}

/**
 * Home's capture bar: a big "+" that opens the full form blank, and a free-text field next to it —
 * type what you did in your own words ("۲ ساعت رو پروژه کار کردم، ۵۰۰ تومن خرج ناهار شد") and the
 * same form opens already filled in for you to check and submit (src/lib/smartCapture.ts parses
 * it; nothing is ever saved without that review). No numbers, no ring, no sentence here — the
 * day's progress lives in the day battery right below, and the companion's mood in the header.
 *
 * The "+" button still follows the companion's mood the way the whole card used to (see
 * computeCompanionState): during BLINDFOLDED it pre-fills the day's biggest unlogged gap instead
 * of a blank form, and it's never hidden outright — this is Home's only capture entry point
 * (GlobalCaptureFab is deliberately absent from Home).
 */
export default function LogWorkCard({
  reaction,
  onOpenCapture,
  onLogGap,
  onSmartCapture,
}: {
  reaction: CaptureReaction | null;
  onOpenCapture: () => void;
  onLogGap: (start: Date, end: Date) => void;
  /** The typed line, once the person submits it — Home parses it (smartCapture.ts) and opens the form filled in. */
  onSmartCapture: (text: string) => void;
}) {
  const { state, enabled, largestUnloggedGap } = useCompanion();
  const [text, setText] = useState("");
  if (!enabled || !state) return null;

  function handlePlus() {
    if (state!.mood === "BLINDFOLDED" && largestUnloggedGap) {
      onLogGap(largestUnloggedGap.start, largestUnloggedGap.end);
    } else {
      onOpenCapture();
    }
  }

  function submitText() {
    const value = text.trim();
    if (!value) return;
    onSmartCapture(value);
    setText("");
  }

  const ariaLabel = `آدمک: ${MOOD_FA_LABEL[state.mood]}، ${formatDuration(state.achievedMinutes)} از ${formatDuration(state.targetMinutes)}`;

  return (
    <div className="flex-1 min-w-0 rounded-2xl bg-surface border border-line shadow-card p-2 flex items-center gap-2" aria-label={ariaLabel}>
      <button
        type="button"
        onClick={handlePlus}
        aria-label="ثبت کار"
        className="shrink-0 w-12 h-12 rounded-full bg-accent text-on-accent flex items-center justify-center shadow-sm active:scale-95 transition"
      >
        <PlusIcon className="w-5 h-5" strokeWidth={2.5} />
      </button>

      {reaction ? (
        <p className="flex-1 min-w-0 px-2 text-xs font-medium text-accent leading-snug line-clamp-2">
          {phraseCaptureReaction(reaction.kind, { ...reaction, remainingMinutes: state.remainingMinutes })}
        </p>
      ) : (
        <div className="flex-1 min-w-0 flex items-center gap-1.5 rounded-xl bg-canvas px-3 py-2.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitText();
              }
            }}
            enterKeyHint="send"
            placeholder="ثبت ..."
            aria-label="ثبت با متن آزاد"
            className="flex-1 min-w-0 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={submitText}
            disabled={!text.trim()}
            aria-label="تجزیه و باز کردن فرم"
            className="shrink-0 text-muted disabled:opacity-40 hover:text-accent transition"
          >
            <NoteIcon className="w-[18px] h-[18px]" />
          </button>
        </div>
      )}
    </div>
  );
}

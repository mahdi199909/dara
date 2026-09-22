"use client";

import { useState } from "react";
import { useCompanion } from "@/components/companion/useCompanion";
import { phraseCaptureReaction, type CaptureReactionKind } from "@/lib/phrasing";
import { PlusIcon } from "@/components/icons";

export type CaptureReaction = { kind: CaptureReactionKind; minutes?: number; amount?: number };

/** A small note/document glyph — doubles as the "parse and open the form" submit control. */
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
 * The middle, dominant layer of PersonalDashboard: a free-text field ("ثبت ...") on the right and
 * a big round "+" on the left. Typing a line and submitting parses it (src/lib/smartCapture.ts)
 * and opens the capture form pre-filled for review — nothing saves without that review. The "+"
 * always opens the form too; capture must work even with the companion mood feature turned off,
 * so unlike the rest of the companion widgets this one doesn't hide itself when useCompanion is
 * disabled — it just falls back to a plain blank-form open instead of the BLINDFOLDED gap-fill.
 */
export default function QuickTaskInput({
  reaction,
  onOpenCapture,
  onLogGap,
  onSmartCapture,
}: {
  reaction: CaptureReaction | null;
  onOpenCapture: () => void;
  onLogGap: (start: Date, end: Date) => void;
  onSmartCapture: (text: string) => void;
}) {
  const { state, largestUnloggedGap } = useCompanion();
  const [text, setText] = useState("");

  function handlePlus() {
    if (state?.mood === "BLINDFOLDED" && largestUnloggedGap) {
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

  return (
    // Intrinsic height (padding + line-height), not a flex-grow share of the dashboard — the
    // capsule/button are sized to themselves, not to an ambiguous percentage of this row, which
    // is what made the 10px-gap math fight earlier passes. The row's own py-[10px] is the exact
    // spacing asked for above (from NearbyTasks) and below (to ProgressBar).
    <div className="flex-none flex items-center gap-[3%] px-[4%] py-[10px] border-t border-line" dir="rtl">
      {reaction ? (
        <p className="flex-1 min-w-0 flex items-center px-4 py-3 rounded-full bg-canvas text-xs font-medium text-accent leading-snug line-clamp-2">
          {phraseCaptureReaction(reaction.kind, { ...reaction, remainingMinutes: state?.remainingMinutes ?? 0 })}
        </p>
      ) : (
        <div className="flex-1 min-w-0 flex items-center gap-2 rounded-full bg-canvas shadow-sm px-4 py-3">
          {/* Icon first so it sits at the input's own right edge (RTL: first child = rightmost),
              right where the placeholder/typed text starts, matching a leading-icon search field. */}
          <button
            type="button"
            onClick={submitText}
            disabled={!text.trim()}
            aria-label="تجزیه و باز کردن فرم"
            className="shrink-0 text-muted disabled:opacity-40 hover:text-accent transition"
          >
            <NoteIcon className="w-[18px] h-[18px]" />
          </button>
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
            className="flex-1 min-w-0 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none text-right"
          />
        </div>
      )}

      {/* ~90% of the capsule's own rendered height (py-3 + line-height ≈ 44px). */}
      <button
        type="button"
        onClick={handlePlus}
        aria-label="ثبت کار"
        className="shrink-0 h-11 w-11 rounded-full bg-accent text-on-accent flex items-center justify-center shadow-sm active:scale-95 transition"
      >
        <PlusIcon className="w-[38%] h-[38%]" strokeWidth={2.5} />
      </button>
    </div>
  );
}

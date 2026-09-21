"use client";

import { useCompanion } from "./useCompanion";
import { MOOD_FA_LABEL, MOOD_TOKENS, RING_TRACK_COLOR } from "./moodTokens";
import { phraseCaptureReaction, type CaptureReactionKind } from "@/lib/phrasing";
import { formatDuration, shortDuration, toPersianDigits } from "@/lib/money";
import { PlusIcon } from "@/components/icons";

export type CaptureReaction = { kind: CaptureReactionKind; minutes?: number; amount?: number };

const RING_SIZE = 56;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** The day's progress toward the productive-time target; a check mark once it is reached. */
function ProgressRing({ completion, color }: { completion: number; color: string }) {
  const shown = Math.min(Math.max(completion, 0), 1);
  return (
    <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }} aria-hidden>
      <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="w-full h-full -rotate-90">
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" strokeWidth={RING_STROKE} stroke={RING_TRACK_COLOR} />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          stroke={color}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - shown)}
          style={{ transition: "stroke-dashoffset 700ms ease-out" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-ink">
        {completion >= 1 ? "✓" : `${toPersianDigits(Math.round(shown * 100))}٪`}
      </span>
    </div>
  );
}

/**
 * Home's «ثبت کار» card: a progress ring, the two numbers that matter — productive time against
 * the daily target, and everything logged today (the same figure DayBattery shows) — and one big
 * button. No explanatory sentence: the ring and the labelled numbers say it, and the companion's
 * mood already lives in the top bar's face. The only words that appear are the short reaction to
 * something that was just logged, for the few seconds it stays.
 *
 * The button's label/action still follows the companion's mood (see computeCompanionState):
 * during BLINDFOLDED it pre-fills the day's biggest unlogged gap instead of opening a blank form,
 * and it is never hidden outright — this is Home's only capture entry point (GlobalCaptureFab is
 * deliberately absent from Home).
 */
export default function LogWorkCard({
  reaction,
  onOpenCapture,
  onLogGap,
}: {
  reaction: CaptureReaction | null;
  onOpenCapture: () => void;
  onLogGap: (start: Date, end: Date) => void;
}) {
  const { state, enabled, largestUnloggedGap, loggedMinutes } = useCompanion();
  if (!enabled || !state) return null;

  const ariaLabel = `آدمک: ${MOOD_FA_LABEL[state.mood]}، ${formatDuration(state.achievedMinutes)} از ${formatDuration(state.targetMinutes)}`;
  const buttonLabel = state.action.label || "ثبت کار";

  function handleClick() {
    if (state!.mood === "BLINDFOLDED" && largestUnloggedGap) {
      onLogGap(largestUnloggedGap.start, largestUnloggedGap.end);
    } else {
      onOpenCapture();
    }
  }

  return (
    <div className="flex-1 min-w-0 rounded-2xl bg-surface border border-line shadow-card p-3 flex flex-col gap-2.5" aria-label={ariaLabel}>
      <div className="flex items-center gap-3 min-h-[56px]">
        <ProgressRing completion={state.completion} color={MOOD_TOKENS[state.mood].ring} />
        {reaction ? (
          <p className="flex-1 min-w-0 text-xs font-medium text-accent leading-snug line-clamp-3">
            {phraseCaptureReaction(reaction.kind, { ...reaction, remainingMinutes: state.remainingMinutes })}
          </p>
        ) : (
          <dl className="flex-1 min-w-0 space-y-1">
            <div>
              <dt className="text-[10px] text-muted leading-none">کار مفید</dt>
              <dd className="mt-0.5 text-sm font-bold text-ink leading-tight whitespace-nowrap">
                {shortDuration(state.achievedMinutes)} <span className="text-[11px] font-normal text-muted">از {shortDuration(state.targetMinutes)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-muted leading-none">کل ثبت‌شده</dt>
              <dd className="mt-0.5 text-sm font-bold text-ink leading-tight whitespace-nowrap">{shortDuration(loggedMinutes)}</dd>
            </div>
          </dl>
        )}
      </div>
      <button
        type="button"
        onClick={handleClick}
        className="w-full rounded-xl bg-accent text-on-accent py-2.5 text-sm font-bold flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98] transition"
      >
        <PlusIcon className="w-4 h-4" strokeWidth={2.5} />
        {buttonLabel}
      </button>
    </div>
  );
}

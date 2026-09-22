"use client";

import NearbyTasks from "./NearbyTasks";
import QuickTaskInput, { type CaptureReaction } from "./QuickTaskInput";
import ProgressBar from "./ProgressBar";

/**
 * Home's top block: three layers fused into one card with no gaps between them — nearest events
 * and installments, the capture bar, and today's progress. Each layer sizes to its own content
 * (NearbyTasks needs to fit every item without a vertical scrollbar; horizontal scroll carries
 * overflow) rather than a fixed share of a forced total height — an earlier pass fought
 * percentage-of-ambiguous-parent heights for this and kept losing the gap-size argument.
 */
export default function PersonalDashboard({
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
  return (
    <div className="shrink-0 rounded-2xl bg-surface border border-line shadow-card overflow-hidden flex flex-col">
      <NearbyTasks />
      <QuickTaskInput reaction={reaction} onOpenCapture={onOpenCapture} onLogGap={onLogGap} onSmartCapture={onSmartCapture} />
      <ProgressBar />
    </div>
  );
}

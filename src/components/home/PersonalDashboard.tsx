"use client";

import NearbyTasks from "./NearbyTasks";
import QuickTaskInput, { type CaptureReaction } from "./QuickTaskInput";
import ProgressBar from "./ProgressBar";

/**
 * Home's top block: three layers fused into one card with no gaps between them — nearest
 * installments, the capture bar, and today's progress — sized 20:40:10 (کارهای نزدیک : ثبت‌کار :
 * پیشرفت) so ثبت‌کار, the thing people actually do here, gets by far the most room.
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
    <div className="shrink-0 h-[29vh] rounded-2xl bg-surface border border-line shadow-card overflow-hidden flex flex-col">
      <NearbyTasks />
      <QuickTaskInput reaction={reaction} onOpenCapture={onOpenCapture} onLogGap={onLogGap} onSmartCapture={onSmartCapture} />
      <ProgressBar />
    </div>
  );
}

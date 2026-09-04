/** A thin progress bar toward the next hour milestone (see computeUpgradeEffect) — shared by
 * UpgradeToast and the assets page so the same "how close am I" visual reads the same everywhere.
 * With no next milestone (already past the highest threshold), renders full rather than empty —
 * there's nothing left to progress toward, not zero progress made. */
export default function MilestoneProgressBar({ totalMinutes, nextMilestoneMinutes }: { totalMinutes: number; nextMilestoneMinutes: number | null }) {
  const pct = nextMilestoneMinutes ? Math.min(100, Math.max(0, (totalMinutes / nextMilestoneMinutes) * 100)) : 100;
  return (
    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
      <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

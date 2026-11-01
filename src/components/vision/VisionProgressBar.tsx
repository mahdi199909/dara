/** A thin horizontal bar for a 0..1 progress, in the item's own colour. Reads as a progress bar to assistive tech. */
export default function VisionProgressBar({ ratio, color, thin = false }: { ratio: number; color: string; thin?: boolean }) {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={`w-full rounded-full bg-line overflow-hidden ${thin ? "h-1.5 mt-1.5" : "h-2.5"}`}
    >
      <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, backgroundColor: color }} />
    </div>
  );
}

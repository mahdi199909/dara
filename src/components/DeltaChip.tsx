import { TrendUpIcon, TrendDownIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/money";

export type DeltaPolarity = "higherIsBetter" | "lowerIsBetter" | "neutral";

/**
 * "نسبت به بازه قبل" — the only comparison this product ever shows: the user's own previous
 * period (see comparePeriods), never another user, a benchmark, or a goal. `polarity` decides
 * which direction reads as good — a drop in expense is positive, a drop in productive minutes is
 * not — so the arrow follows the arithmetic sign but the color follows the metric's meaning. A
 * "bad" delta stays neutral gray, never red or alarmed; "neutral" metrics (no inherent
 * good/bad direction, e.g. total minutes tracked) are always gray regardless of direction.
 * Renders nothing when there's no previous value to derive a real percentage from, or when
 * nothing changed — a 0% chip has nothing to say.
 */
export default function DeltaChip({ current, previous, polarity }: { current: number; previous: number; polarity: DeltaPolarity }) {
  if (!previous) return null;
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  if (percent === 0) return null;

  const up = percent > 0;
  const isGood = polarity === "neutral" ? null : polarity === "higherIsBetter" ? up : !up;
  const toneClass = isGood === true ? "text-brand-700" : "text-gray-400";

  return (
    <span className={`inline-flex items-center gap-1 text-xs ${toneClass}`}>
      {up ? <TrendUpIcon className="w-3 h-3" /> : <TrendDownIcon className="w-3 h-3" />}
      {toPersianDigits(Math.round(Math.abs(percent)))}٪ نسبت به بازه قبل
    </span>
  );
}

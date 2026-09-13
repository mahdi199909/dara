// Shared "open ring" SVG arc math — the same gauge shape the Parva logomark itself draws (a
// 300deg sweep starting at 210deg, leaving a 60deg gap centered at the bottom), used anywhere a
// progress/comparison ring is needed instead of a generic closed 360deg gauge or a line chart.
export function ringArcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const toXY = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
  };
  const [x1, y1] = toXY(startDeg);
  const [x2, y2] = toXY(startDeg + sweepDeg);
  const largeArc = sweepDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export const RING_START_DEG = 210;
export const RING_SWEEP_DEG = 300;

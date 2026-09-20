// Which text tone a home-screen widget uses on top of the background colour and opacity the person
// picked in Settings. The Java side (WidgetTheme.useLightText) implements exactly this rule so the
// preview in Settings and the real widgets always agree.
//
// The rule: a widget's translucent background lets the wallpaper show through, and the wallpaper is
// unknown. So for each candidate text colour (white, black) take its WORST contrast over the two
// extreme backdrops (a black and a white wallpaper) and pick the candidate whose worst case is
// better. For an opaque background that is simply "the higher-contrast one"; for a see-through one
// it is the tone that stays readable however the wallpaper turns out. A dead heat (a fully
// transparent widget) follows the phone's light/dark mode.

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an [r, g, b] colour (0..255 each). */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function blend(rgb: readonly [number, number, number], backdrop: number, alpha: number): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round(alpha * rgb[i] + (1 - alpha) * backdrop)) as [number, number, number];
}

/** "light" = white text, "dark" = near-black text. */
export function pickWidgetTextTone(hexColor: string, opacityPercent: number, prefersDark: boolean): "light" | "dark" {
  const rgb = parseHex(hexColor);
  if (!rgb) return prefersDark ? "light" : "dark";
  const alpha = Math.max(0, Math.min(100, opacityPercent)) / 100;
  const overBlack = relativeLuminance(blend(rgb, 0, alpha));
  const overWhite = relativeLuminance(blend(rgb, 255, alpha));
  const whiteWorst = Math.min(contrast(1, overBlack), contrast(1, overWhite));
  const blackWorst = Math.min(contrast(0, overBlack), contrast(0, overWhite));
  if (Math.abs(whiteWorst - blackWorst) < 0.01) return prefersDark ? "light" : "dark";
  return whiteWorst > blackWorst ? "light" : "dark";
}

/** The CSS colour for that tone — neutral (no tint), like the widget's own text. */
export function widgetTextColor(tone: "light" | "dark"): string {
  return tone === "light" ? "#FFFFFF" : "#111111";
}

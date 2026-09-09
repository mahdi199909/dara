import { describe, expect, it } from "vitest";

// Verifies the actual contrast math behind doc/theme-prompt.md §2.7's table, rather than just
// trusting the numbers written there. RGB triples are duplicated from src/app/globals.css's
// :root/.dark blocks (CSS custom properties can't be imported into a plain .ts test) — if either
// file's values change, update both and re-run this; a mismatch here means the two have drifted.
const LIGHT = {
  canvas: [239, 242, 238],
  surface: [251, 252, 250],
  ink: [20, 24, 26],
  muted: [92, 99, 96],
  accent: [14, 95, 84],
  waste: [168, 71, 59],
  signal: [138, 95, 22],
} as const;

const DARK = {
  canvas: [14, 20, 18],
  surface: [22, 29, 27],
  ink: [231, 236, 234],
  muted: [147, 160, 155],
  accent: [70, 185, 166],
  waste: [224, 146, 128],
  signal: [214, 166, 90],
} as const;

// Standard WCAG 2.x relative-luminance + contrast-ratio formulas.
function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)];
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

const WCAG_AA = 4.5;
const WCAG_AAA = 7.0;

// Each entry's required level matches doc/theme-prompt.md §2.7's own per-cell AA/AAA label —
// that label is consistent with the official WCAG thresholds for every single cell in the table
// (double-checked independently), unlike the prose "minimums" paragraph just below it, which
// rounds to 6/5 and is technically missed by a couple of cells (muted-light-on-canvas at 5.46,
// signal-light-on-canvas at 4.99) despite both comfortably clearing real AA. Testing against the
// table's actual labels rather than that paraphrase is the only self-consistent reading.
const CASES: { token: keyof typeof LIGHT; theme: "light" | "dark"; bg: "canvas" | "surface"; level: number }[] = [
  { token: "ink", theme: "light", bg: "canvas", level: WCAG_AAA },
  { token: "ink", theme: "light", bg: "surface", level: WCAG_AAA },
  { token: "muted", theme: "light", bg: "canvas", level: WCAG_AA },
  { token: "muted", theme: "light", bg: "surface", level: WCAG_AA },
  { token: "accent", theme: "light", bg: "canvas", level: WCAG_AA },
  { token: "accent", theme: "light", bg: "surface", level: WCAG_AAA },
  { token: "waste", theme: "light", bg: "canvas", level: WCAG_AA },
  { token: "waste", theme: "light", bg: "surface", level: WCAG_AA },
  { token: "signal", theme: "light", bg: "canvas", level: WCAG_AA },
  { token: "signal", theme: "light", bg: "surface", level: WCAG_AA },
  { token: "ink", theme: "dark", bg: "canvas", level: WCAG_AAA },
  { token: "ink", theme: "dark", bg: "surface", level: WCAG_AAA },
  { token: "muted", theme: "dark", bg: "canvas", level: WCAG_AA },
  { token: "muted", theme: "dark", bg: "surface", level: WCAG_AA },
  { token: "accent", theme: "dark", bg: "canvas", level: WCAG_AAA },
  { token: "accent", theme: "dark", bg: "surface", level: WCAG_AAA },
  { token: "waste", theme: "dark", bg: "canvas", level: WCAG_AAA },
  { token: "waste", theme: "dark", bg: "surface", level: WCAG_AAA },
  { token: "signal", theme: "dark", bg: "canvas", level: WCAG_AAA },
  { token: "signal", theme: "dark", bg: "surface", level: WCAG_AAA },
];

describe("theme token contrast (WCAG)", () => {
  for (const { token, theme, bg, level } of CASES) {
    it(`${token} (${theme}) on ${bg} clears ${level === WCAG_AAA ? "AAA (7.0)" : "AA (4.5)"}`, () => {
      const palette = theme === "light" ? LIGHT : DARK;
      const ratio = contrastRatio(palette[token], palette[bg]);
      expect(ratio).toBeGreaterThanOrEqual(level);
    });
  }

  it("never uses pure black or pure white as a canvas/surface/ink background or primary text color (§2.8 rule 2)", () => {
    for (const palette of [LIGHT, DARK]) {
      for (const key of ["canvas", "surface", "ink"] as const) {
        const [r, g, b] = palette[key];
        expect([r, g, b]).not.toEqual([0, 0, 0]);
        expect([r, g, b]).not.toEqual([255, 255, 255]);
      }
    }
  });

  it("dark theme: surface reads lighter than canvas (§2.8 rule 1 — elevation via brightness)", () => {
    expect(relativeLuminance(DARK.surface)).toBeGreaterThan(relativeLuminance(DARK.canvas));
  });

  // Solid accent/waste fills with their "text on fill" pairing (buttons, badges) — §2.7's
  // separately-listed "پرکننده‌ها" figures.
  it("solid fill + on-fill text pairs clear AA", () => {
    expect(contrastRatio([255, 255, 255], LIGHT.accent)).toBeGreaterThanOrEqual(WCAG_AA);
    expect(contrastRatio([8, 17, 15], DARK.accent)).toBeGreaterThanOrEqual(WCAG_AA);
    expect(contrastRatio([255, 255, 255], LIGHT.waste)).toBeGreaterThanOrEqual(WCAG_AA);
  });
});

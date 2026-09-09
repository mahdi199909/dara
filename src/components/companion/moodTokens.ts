// Color tokens per Companion mood — see doc/companion-preview.html for the approved visual
// reference this mirrors exactly. Updated in place for the Persian Blue -> deep-teal rebrand
// (doc/theme-prompt.md §2.1) by swapping each old brand-scale hex for its new value at the same
// scale position — not a redesign. Deliberately NOT wired to the light/dark CSS variables like
// the rest of the app: doc/companion-preview.html has no approved dark-mode version of this
// face, and guessing 5 moods' worth of dark-mode fill/ink pairs isn't something to do without
// that reference. The face renders with these same fixed colors in both themes for now — a
// known, flagged gap (same treatment the widget dark-theme work gets in this same PR), not an
// oversight. ASLEEP/SLEEPY intentionally stay plain gray in both themes either way — a
// "drained of color" sleepy face was never meant to carry brand color.
import type { CompanionMood } from "@/lib/companion";

export interface MoodTokens {
  fill: string; // face/head/body fill
  ink: string; // eyes, mouth, "z"s — everything drawn "on" the face
  ring: string; // progress-ring fill color
}

// Same for every mood — the unfilled portion of the progress ring never changes color. Uses the
// `line` CSS variable directly (this file is plain TS, not Tailwind classes) so at least the
// track itself — unlike the mood fills above — does stay theme-correct.
export const RING_TRACK_COLOR = "rgb(var(--line))";
export const BLINDFOLD_BAND_COLOR = "#c9862e"; // signal-500 (unchanged by the rebrand)
// Alternating brand-600 / signal-500, in render order — never red, matches the product's
// "no color ever means judgment" rule.
export const CONFETTI_COLORS = ["#0e5f54", "#c9862e"];

export const MOOD_TOKENS: Record<CompanionMood, MoodTokens> = {
  ASLEEP: { fill: "#e5e7eb", ink: "#9ca3af", ring: "#d1d5db" },
  SLEEPY: { fill: "#e5e7eb", ink: "#6b7280", ring: "#d1d5db" },
  FRESH: { fill: "#f0f7f6", ink: "#0a4f46", ring: "#0e5f54" },
  NEUTRAL: { fill: "#f0f7f6", ink: "#074039", ring: "#0e5f54" },
  CONTENT: { fill: "#dbeeeb", ink: "#074039", ring: "#0e5f54" },
  HAPPY: { fill: "#b7e1dc", ink: "#0a4f46", ring: "#0e5f54" },
  CELEBRATING: { fill: "#88d3c9", ink: "#05322c", ring: "#0e5f54" },
  BLINDFOLDED: { fill: "#f7eeda", ink: "#8a5f16", ring: "#c9862e" },
};

// Used only as CompanionFace's aria-label fallback when no `label` prop is given — not shown as
// visible UI copy, so it doesn't compete with phrasing.ts's mandate over actual bubble/button text.
export const MOOD_FA_LABEL: Record<CompanionMood, string> = {
  ASLEEP: "خواب",
  FRESH: "تازه",
  SLEEPY: "کسل",
  NEUTRAL: "خنثی",
  CONTENT: "راضی",
  HAPPY: "خوشحال",
  CELEBRATING: "سرخوش",
  BLINDFOLDED: "چشم‌بسته",
};

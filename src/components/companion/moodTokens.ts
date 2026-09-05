// Color tokens per Companion mood — see doc/companion-preview.html for the approved visual
// reference this mirrors exactly. The app is light-only (no dark theme), so this is the only
// palette that will ever exist for this component.
import type { CompanionMood } from "@/lib/companion";

export interface MoodTokens {
  fill: string; // face/head/body fill
  ink: string; // eyes, mouth, "z"s — everything drawn "on" the face
  ring: string; // progress-ring fill color
}

// Same for every mood — the unfilled portion of the progress ring never changes color.
export const RING_TRACK_COLOR = "#e5e7eb";
export const BLINDFOLD_BAND_COLOR = "#c9862e"; // signal-500
// Alternating brand-600 / signal-500, in render order — never red, matches the product's
// "no color ever means judgment" rule.
export const CONFETTI_COLORS = ["#1c39bb", "#c9862e"];

export const MOOD_TOKENS: Record<CompanionMood, MoodTokens> = {
  ASLEEP: { fill: "#e5e7eb", ink: "#9ca3af", ring: "#d1d5db" },
  SLEEPY: { fill: "#e5e7eb", ink: "#6b7280", ring: "#d1d5db" },
  FRESH: { fill: "#eef1fb", ink: "#182e96", ring: "#1c39bb" },
  NEUTRAL: { fill: "#eef1fb", ink: "#152773", ring: "#1c39bb" },
  CONTENT: { fill: "#d9defa", ink: "#152773", ring: "#1c39bb" },
  HAPPY: { fill: "#b3bdf0", ink: "#182e96", ring: "#1c39bb" },
  CELEBRATING: { fill: "#8695e3", ink: "#13215d", ring: "#1c39bb" },
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

import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-vazirmatn)", "Vazirmatn", "Tahoma", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(10, 31, 27, 0.04), 0 4px 16px -4px rgba(10, 31, 27, 0.08)",
        "card-hover": "0 2px 4px rgba(10, 31, 27, 0.06), 0 8px 24px -6px rgba(10, 31, 27, 0.12)",
      },
      colors: {
        // Deep teal, replacing the original Persian Blue (2026-09 rebrand to پروا) — see
        // doc/theme-prompt.md §2.1 for the exact values and the contrast table they were
        // checked against. Kept as a full numeric scale (not just the two shades semantic
        // tokens below use) for charts and other spots that need a specific shade rather than
        // "the current accent".
        brand: {
          50: "#F0F7F6",
          100: "#DBEEEB",
          200: "#B7E1DC",
          300: "#88D3C9",
          400: "#46B9A6",
          500: "#279183",
          600: "#0E5F54",
          700: "#0A4F46",
          800: "#074039",
          900: "#05322C",
        },
        // DEFAULT/soft live in the same object as the numeric scale (not split into a separate
        // token) so both `bg-waste-600` (a specific shade, e.g. for a chart series) and
        // `bg-waste`/`bg-waste-soft` (the theme-aware semantic pair, driven by the CSS variables
        // below) resolve from one Tailwind color entry.
        waste: {
          50: "#FDF3F2",
          100: "#FBE1DE",
          200: "#F2C0B9",
          300: "#E09280",
          400: "#D4705C",
          500: "#C95A4C",
          600: "#A8473B",
          700: "#8A3A30",
          800: "#6E2E26",
          900: "#57241E",
          DEFAULT: "rgb(var(--waste) / <alpha-value>)",
          soft: "rgb(var(--waste-soft) / <alpha-value>)",
        },
        // "Attention" color for the Companion's BLINDFOLDED mood only — deliberately not
        // `waste`: missing data isn't waste, and this mood is never about judging the user.
        signal: {
          50: "#FCF7EC",
          100: "#F7EEDA",
          300: "#E8C68C",
          400: "#D6A65A",
          500: "#C9862E",
          600: "#A97022",
          700: "#8A5F16",
          DEFAULT: "rgb(var(--signal) / <alpha-value>)",
          soft: "rgb(var(--signal-soft) / <alpha-value>)",
        },
        // Semantic tokens — the only colors components should reference (see doc/theme-prompt.md
        // §1). Each resolves via a CSS variable in globals.css whose *value* flips between
        // :root (light) and .dark; components never branch on theme themselves. The
        // rgb(var(...) / <alpha-value>) pattern (var holds space-separated R G B channels, not
        // a hex string) is what makes Tailwind's opacity modifiers work, e.g. `bg-surface/60`.
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
        },
        "on-accent": "rgb(var(--on-accent) / <alpha-value>)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;

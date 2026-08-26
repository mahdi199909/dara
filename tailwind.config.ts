import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-vazirmatn)", "Vazirmatn", "Tahoma", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(19, 33, 93, 0.04), 0 4px 16px -4px rgba(19, 33, 93, 0.08)",
        "card-hover": "0 2px 4px rgba(19, 33, 93, 0.06), 0 8px 24px -6px rgba(19, 33, 93, 0.12)",
      },
      colors: {
        brand: {
          // Persian Blue, per the user's own request for a palette suited to a task-logging app.
          50: "#eef1fb",
          100: "#d9defa",
          200: "#b3bdf0",
          300: "#8695e3",
          400: "#5c6cd4",
          500: "#3947c4",
          600: "#1c39bb",
          700: "#182e96",
          800: "#152773",
          900: "#13215d",
        },
        waste: {
          50: "#fdf3f2",
          100: "#fbe1de",
          500: "#c95a4c",
          600: "#a8473b",
        },
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

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-vazirmatn)", "Vazirmatn", "Tahoma", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(27, 60, 55, 0.04), 0 4px 16px -4px rgba(27, 60, 55, 0.08)",
        "card-hover": "0 2px 4px rgba(27, 60, 55, 0.06), 0 8px 24px -6px rgba(27, 60, 55, 0.12)",
      },
      colors: {
        brand: {
          50: "#eef7f6",
          100: "#d7ece9",
          200: "#b0d9d3",
          300: "#82c1b8",
          400: "#57a89c",
          500: "#3a8d80",
          600: "#2c7166",
          700: "#255a52",
          800: "#1f4842",
          900: "#1b3c37",
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

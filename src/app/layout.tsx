import type { Metadata, Viewport } from "next";
import { Vazirmatn } from "next/font/google";
import Script from "next/script";
import { CurrencyUnitProvider } from "@/lib/currencyUnit";
import ThemeSystemListener from "@/components/ThemeSystemListener";
import "./globals.css";

// Kept as a hand-written string (not a call into src/lib/theme.ts) because it runs via
// next/script's beforeInteractive strategy — injected into the initial HTML and executed by the
// browser while still parsing <head>, before hydration and before any app bundle loads, so it
// literally cannot import anything. This is the standard no-flash pattern (see e.g. next-themes):
// paint the right theme class on the very first frame instead of rendering light and correcting
// to dark a moment later. src/lib/theme.ts's resolveIsDark() mirrors this exact logic for every
// other (post-hydration) call site — keep the two in sync if the resolution rule ever changes.
const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("parva-theme")||"system";var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;

// IRANSans isn't free to embed on a public site without a purchased license from
// fontiran.com — Vazirmatn is the standard open (SIL OFL), redistributable substitute in
// the Persian web community, comparable in style/readability and purpose-built for this
// exact use case. Loaded as a single variable font so every weight comes from one file.
const vazirmatn = Vazirmatn({
  subsets: ["arabic"],
  variable: "--font-vazirmatn",
  display: "swap",
  weight: "variable",
});

export const metadata: Metadata = {
  title: "پروا | سیستم‌عامل شخصی",
  description: "پروا | سیستم‌عامل شخصی",
  manifest: "/manifest.json",
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EFF2EE" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1412" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={vazirmatn.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <ThemeSystemListener />
        <CurrencyUnitProvider>{children}</CurrencyUnitProvider>
      </body>
    </html>
  );
}

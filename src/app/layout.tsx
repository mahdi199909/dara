import type { Metadata, Viewport } from "next";
import { Vazirmatn } from "next/font/google";
import { CurrencyUnitProvider } from "@/lib/currencyUnit";
import "./globals.css";

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
  title: "دارا",
  description: "سیستم‌عامل شخصی برای مدیریت زمان، وظایف و مالی",
  manifest: "/manifest.json",
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1c39bb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={vazirmatn.variable}>
      <body className="font-sans antialiased">
        <CurrencyUnitProvider>{children}</CurrencyUnitProvider>
      </body>
    </html>
  );
}

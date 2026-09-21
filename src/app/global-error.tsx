"use client";

// The last line of defence: shown when the root layout itself fails, where none of the app's styles or providers can
// be relied on — hence its own <html>, plain inline styles (the app's light and dark colours) and no imports beyond
// the logger.
import { useEffect } from "react";
import { reportRenderError } from "@/lib/observability/client/globalErrors";

const DARK = "@media (prefers-color-scheme: dark) { body { background: #0E1412 !important; color: #E7ECEA !important; } .muted { color: #93A09B !important; } .retry { background: #46B9A6 !important; color: #08110F !important; } }";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportRenderError(error, "global");
  }, [error]);

  return (
    <html lang="fa" dir="rtl">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#EFF2EE", color: "#14181A" }}>
        <style>{DARK}</style>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 360, textAlign: "center" }}>
            <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>مشکلی پیش آمد</h1>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.8, margin: "0 0 16px", color: "#5C6360" }}>
              برنامه نتوانست بالا بیاید. دوباره تلاش کنید؛ اگر تکرار شد، برنامه را ببندید و دوباره باز کنید.
            </p>
            <button
              type="button"
              onClick={reset}
              className="retry"
              style={{ border: 0, borderRadius: 12, padding: "8px 16px", fontSize: 14, cursor: "pointer", background: "#0E5F54", color: "#FFFFFF" }}
            >
              تلاش دوباره
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

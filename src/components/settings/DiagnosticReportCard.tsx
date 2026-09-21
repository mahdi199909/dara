"use client";

// Settings → گزارش تشخیصی. Builds the technical report of the phone's own log (see
// src/lib/observability/client/diagnostics.ts) and opens the share sheet, where the person chooses where it goes.
// Nothing is sent by the app on its own. Only shown inside the Android app: the log file exists only there.
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { toPersianDigits } from "@/lib/money";

export default function DiagnosticReportCard() {
  const [native, setNative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Decided after mount, never during render: the static export prerenders this without a `window`.
  useEffect(() => {
    setNative(Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()));
  }, []);

  if (!native) return null;

  async function make() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { shareDiagnosticReport } = await import("@/lib/observability/client/shareReport");
      const report = await shareDiagnosticReport();
      setMessage(`گزارش ساخته شد (${toPersianDigits(report.recordCount)} رویداد) — از صفحه‌ی اشتراک‌گذاری، مقصد را انتخاب کنید.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ساخت گزارش با خطا مواجه شد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 space-y-3">
      <h2 className="font-bold text-ink text-sm">گزارش تشخیصی</h2>
      <p className="text-xs text-muted leading-relaxed">
        اگر برنامه درست کار نمی‌کند و پشتیبانی از شما گزارش خواسته، اینجا یک فایل فنی می‌سازید. این فایل فقط رویدادها، شمارش‌ها و شناسه‌های فنی را دارد — عنوان
        کارها، یادداشت‌ها، مبلغ‌ها، ایمیل و رمز عبور در آن نیست. برنامه آن را خودش جایی نمی‌فرستد؛ مقصد را خودتان انتخاب می‌کنید.
      </p>
      <button
        type="button"
        onClick={make}
        disabled={busy}
        className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
      >
        {busy ? "در حال ساخت گزارش..." : "ساخت و اشتراک‌گذاری گزارش تشخیصی"}
      </button>
      {message && <p className="text-xs text-accent">{message}</p>}
      {error && <p className="text-xs text-waste">{error}</p>}
    </Card>
  );
}

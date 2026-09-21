"use client";

// What a person sees when a screen fails to render — instead of Next's blank fallback — and the one place such
// a failure is written down (UI_RENDER_ERROR, with the stack; never what was on the screen). `reset` re-renders the
// segment, which is enough for the usual cause: a bad value that has since gone away.
import { useEffect, useState } from "react";
import { reportRenderError } from "@/lib/observability/client/globalErrors";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [native, setNative] = useState(false);

  useEffect(() => {
    reportRenderError(error, "segment");
  }, [error]);

  useEffect(() => {
    setNative(Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()));
  }, []);

  return (
    <div dir="rtl" className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-lg font-bold text-ink">مشکلی پیش آمد</h1>
        <p className="text-sm text-muted leading-relaxed">
          این صفحه نتوانست نمایش داده شود. دوباره تلاش کنید؛ اگر تکرار شد، برنامه را ببندید و دوباره باز کنید.
          {native ? " اگر باز هم ادامه داشت، از «تنظیمات ← گزارش تشخیصی» می‌توانید جزئیات فنی را برای پشتیبانی بفرستید." : ""}
        </p>
        <button type="button" onClick={reset} className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium hover:opacity-90">
          تلاش دوباره
        </button>
        {error.digest ? (
          <p className="text-xs text-muted" dir="ltr">
            {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}

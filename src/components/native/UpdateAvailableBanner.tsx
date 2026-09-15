"use client";

// The non-blocking sibling of FirstRunGate's forced-update screen — see checkVersionGate. Only
// ever renders on native (mounted from layout.android.tsx only), and only once a newer build
// exists without the current one being outright unsupported yet.
import { useEffect, useState } from "react";
import { checkVersionGate } from "@/lib/versionGate";

export default function UpdateAvailableBanner() {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        const currentBuild = parseInt(info.build, 10) || 0;
        const result = await checkVersionGate(currentBuild);
        if (!result.blocked && result.updateAvailable) setDownloadUrl(result.downloadUrl || null);
      } catch (err) {
        console.error("update-available check failed", err);
      }
    })();
  }, []);

  if (!downloadUrl || dismissed) return null;

  return (
    <div className="bg-accent-soft text-accent text-xs leading-relaxed px-4 py-2 flex items-center gap-2" dir="rtl">
      <span className="flex-1">نسخه جدیدی از پروا در دسترس است.</span>
      <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 font-medium underline">
        دانلود
      </a>
      <button type="button" onClick={() => setDismissed(true)} className="shrink-0 font-medium hover:opacity-70">
        بعداً
      </button>
    </div>
  );
}

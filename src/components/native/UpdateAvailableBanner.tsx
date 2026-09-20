"use client";

// The non-blocking sibling of FirstRunGate's forced-update screen — see checkVersionGate. Only
// ever renders on native (mounted from layout.android.tsx only), and only once a newer build
// exists without the current one being outright unsupported yet. It asks the server on every
// launch and every resume (the public GET /api/app/version, so no login is needed), showing what
// was cached last time straight away and correcting itself once the answer arrives.
import { useEffect, useState } from "react";
import { checkVersionGate, refreshVersionGate } from "@/lib/versionGate";
import { updateNoticeText } from "@/lib/appVersion";

interface Notice {
  downloadUrl: string;
  latestVersionCode: number;
  text: string;
}

export default function UpdateAvailableBanner() {
  const [notice, setNotice] = useState<Notice | null>(null);
  // "بعداً" hides this release's notice until the app is restarted; a newer release shows again.
  const [dismissedCode, setDismissedCode] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let removeResumeListener: (() => void) | undefined;

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        const currentBuild = parseInt(info.build, 10) || 0;

        async function evaluate() {
          const result = await checkVersionGate(currentBuild);
          if (cancelled) return;
          if (result.blocked || !result.updateAvailable || !result.downloadUrl) {
            setNotice(null);
            return;
          }
          setNotice({
            downloadUrl: result.downloadUrl,
            latestVersionCode: result.latestVersionCode,
            text: updateNoticeText(result.latestVersionName, info.version || null),
          });
        }

        async function check() {
          await evaluate();
          if (await refreshVersionGate()) await evaluate();
        }

        void check();
        const handle = await App.addListener("resume", () => void check());
        // Unmounted while the listener was being registered: nothing will ever call the cleanup.
        if (cancelled) {
          void handle.remove();
          return;
        }
        removeResumeListener = () => void handle.remove();
      } catch (err) {
        console.error("update-available check failed", err);
      }
    })();

    return () => {
      cancelled = true;
      removeResumeListener?.();
    };
  }, []);

  if (!notice || dismissedCode === notice.latestVersionCode) return null;

  return (
    <div className="bg-accent-soft text-accent text-xs leading-relaxed px-4 py-2 flex items-center gap-2" dir="rtl">
      <span className="flex-1">{notice.text}</span>
      <a href={notice.downloadUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 font-medium underline">
        دانلود
      </a>
      <button type="button" onClick={() => setDismissedCode(notice.latestVersionCode)} className="shrink-0 font-medium hover:opacity-70">
        بعداً
      </button>
    </div>
  );
}

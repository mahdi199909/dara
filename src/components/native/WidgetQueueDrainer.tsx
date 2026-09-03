"use client";

// Four jobs on every app resume, all stemming from the same fact: Capacitor keeps the WebView
// alive across a simple background/foreground cycle, so nothing re-runs FirstRunGate's one-time
// bootstrap effect just because the user switched back to an already-running app.
//
// 1. Drain captures and habit check-in toggles logged through the home-screen widgets while the
//    app wasn't in the foreground — see src/local/widgetQueue.ts for why the widgets hand off
//    through a queue rather than writing the shared database directly.
// 2. Re-check license/trial status with the server (see nativeOnboarding.ts's own doc comment
//    on refreshLicenseStatus) — otherwise trial-days-remaining stays frozen at whatever
//    FirstRunGate's very first login cached, forever.
// 3. Push local changes and pull remote ones (see nativeOnboarding.ts's syncWithServer) —
//    AWAITED, unlike the fire-and-forget license refresh above: the mutate() below is what makes
//    a freshly-pulled row actually visible, so revalidating before sync lands would just show the
//    same stale data one resume cycle early.
// 4. Refresh every SWR-cached page unconditionally, not only when the steps above found
//    something: revalidateOnFocus is deliberately off (see SWRProvider.tsx — it caused a request
//    storm), so without this, reopening the app after any amount of time shows whatever was
//    cached from before, stale, until the user happens to navigate somewhere new.
import { useEffect } from "react";
import { mutate } from "swr";
import { getLocalDbInstance } from "@/local/db";
import { refreshLicenseStatus, syncWithServer } from "@/lib/nativeOnboarding";

function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

export default function WidgetQueueDrainer() {
  useEffect(() => {
    if (!isNativePlatform()) return;
    let remove: (() => void) | undefined;

    (async () => {
      const [{ App }, { drainWidgetQueue }, { getLocalUserId }] = await Promise.all([
        import("@capacitor/app"),
        import("@/local/widgetQueue"),
        import("@/local/localUser"),
      ]);
      const handle = await App.addListener("resume", async () => {
        const db = getLocalDbInstance();
        if (db) {
          try {
            await drainWidgetQueue(db, getLocalUserId(db));
          } catch (err) {
            console.error("widget queue drain on resume failed", err);
          }
        }
        // Unconditional, and outside the try/catch above: a failed drain shouldn't also
        // suppress refreshing the data that WAS already there before this resume.
        void refreshLicenseStatus();
        await syncWithServer();
        mutate(() => true, undefined, { revalidate: true });
      });
      remove = () => handle.remove();
    })();

    return () => remove?.();
  }, []);

  return null;
}

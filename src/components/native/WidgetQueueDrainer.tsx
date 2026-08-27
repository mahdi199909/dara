"use client";

// Two jobs on every app resume, both stemming from the same fact: Capacitor keeps the WebView
// alive across a simple background/foreground cycle, so nothing re-runs FirstRunGate's one-time
// bootstrap effect just because the user switched back to an already-running app.
//
// 1. Drain captures logged through the home-screen widget while the app wasn't in the
//    foreground — see src/local/widgetQueue.ts for why the widget hands off through a queue
//    rather than writing the shared database directly.
// 2. Refresh every SWR-cached page unconditionally, not only when the drain above found
//    something: revalidateOnFocus is deliberately off (see SWRProvider.tsx — it caused a request
//    storm), so without this, reopening the app after any amount of time shows whatever was
//    cached from before, stale, until the user happens to navigate somewhere new.
import { useEffect } from "react";
import { mutate } from "swr";
import { getLocalDbInstance } from "@/local/db";

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
        mutate(() => true, undefined, { revalidate: true });
      });
      remove = () => handle.remove();
    })();

    return () => remove?.();
  }, []);

  return null;
}

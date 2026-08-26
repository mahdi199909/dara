"use client";

// Handles the case FirstRunGate's own one-time bootstrap doesn't cover: the app was already
// running (just backgrounded, not cold-launched) when the user logged a capture through the
// home-screen widget. Capacitor keeps the WebView alive across a simple background/foreground
// cycle, so nothing re-runs FirstRunGate's effect — this listens for the app resume event
// instead and drains the same queue then. See src/local/widgetQueue.ts for why the widget
// hands off through a queue rather than writing the shared database directly.
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
        if (!db) return; // shouldn't happen post-FirstRunGate, but never crash the resume path over it
        try {
          const drained = await drainWidgetQueue(db, getLocalUserId(db));
          if (drained > 0) mutate(() => true, undefined, { revalidate: true });
        } catch (err) {
          console.error("widget queue drain on resume failed", err);
        }
      });
      remove = () => handle.remove();
    })();

    return () => remove?.();
  }, []);

  return null;
}

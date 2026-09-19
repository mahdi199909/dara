"use client";

import { SWRConfig } from "swr";

function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

/**
 * Global SWR defaults.
 *
 * Inside the Android app, `revalidateOnFocus`/`revalidateOnReconnect` stay off: they refetch EVERY
 * mounted hook on each focus/visibility/online event, and that WebView fires those in rapid bursts
 * — a real request storm (confirmed: dozens of duplicate requests per second, all pages
 * affected). Mutations already call `mutate()` explicitly after every write, and the app's own
 * resume handler and sync scheduler (WidgetQueueDrainer.tsx, SyncScheduler.tsx) refresh the
 * screen whenever a sync brings something in.
 *
 * On the web there is no such refresh path — data is read straight from the server — so a change
 * made on the phone (which reaches the server within seconds) would otherwise sit unseen in an
 * already-open tab until the next navigation or manual reload, which reads as "the web doesn't
 * sync". Web therefore polls (only while the tab is visible — SWR's default) and revalidates on
 * focus with a long throttle, so a burst of focus events costs at most one refetch per hook a minute.
 */
export default function SWRProvider({ children }: { children: React.ReactNode }) {
  const native = isNativePlatform();
  return (
    <SWRConfig
      value={
        native
          ? { revalidateOnFocus: false, revalidateOnReconnect: false, dedupingInterval: 4000 }
          : { revalidateOnFocus: true, focusThrottleInterval: 60_000, revalidateOnReconnect: true, refreshInterval: 30_000, dedupingInterval: 4000 }
      }
    >
      {children}
    </SWRConfig>
  );
}

"use client";

// The phone's notification status for a component that has to react to it — the "notifications are
// off" banner, the event form's notice and the Settings card. Read once on mount and again every
// time the app returns to the foreground, which is when a switch flipped in system settings (the
// only place a refused permission can be given) shows up. Does nothing outside the Android app.
import { useCallback, useEffect, useState } from "react";
import type { NotificationStatus } from "@/local/notificationStatus";

function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

export function useNotificationStatus(): { status: NotificationStatus | null; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<NotificationStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!isNativePlatform()) return;
    try {
      const { readNotificationStatus } = await import("@/local/notificationStatus");
      setStatus(await readNotificationStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!isNativePlatform()) return;
    let cancelled = false;
    let removeResumeListener: (() => void) | undefined;

    void refresh();
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("resume", () => void refresh());
        // Unmounted while the listener was being registered: nothing will ever call the cleanup.
        if (cancelled) {
          void handle.remove();
          return;
        }
        removeResumeListener = () => void handle.remove();
      } catch {
        // The status simply stops refreshing on its own; the next mount reads it again.
      }
    })();

    return () => {
      cancelled = true;
      removeResumeListener?.();
    };
  }, [refresh]);

  return { status, refresh };
}

/** A reminder cannot ring: notifications are not allowed for the app, or the person muted its reminders channel. */
export function notificationsBlocked(status: NotificationStatus | null): boolean {
  return !!status && status.available && (status.permission !== "granted" || status.channelMuted);
}

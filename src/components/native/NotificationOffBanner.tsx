"use client";

// The visible half of "why don't my reminders come?". When notifications are not allowed for the
// app (or the person muted its reminders channel) every system notification is silently dropped —
// nothing on screen said so, which is exactly how a phone ends up "never getting" one. Shown only
// on native, and only while there is a reminder that would otherwise ring, so someone who does not
// use reminders is never nagged. "بعداً" hides it until the app is restarted.
import { useEffect, useState } from "react";
import { notificationsBlocked, useNotificationStatus } from "./useNotificationStatus";

export default function NotificationOffBanner() {
  const { status, refresh } = useNotificationStatus();
  const [hasUpcomingReminder, setHasUpcomingReminder] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const blocked = notificationsBlocked(status);
  // Allowed, but the reminders channel itself is muted — the switch to flip is in system settings.
  const channelMuted = blocked && status?.permission === "granted";

  useEffect(() => {
    if (!blocked) {
      setHasUpcomingReminder(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [{ getLocalDbInstance }, { upcomingReminderNotifications }] = await Promise.all([import("@/local/db"), import("@/local/reminderNotifications")]);
        const db = getLocalDbInstance();
        if (!cancelled) setHasUpcomingReminder(!!db && upcomingReminderNotifications(db, new Date(), 1).length > 0);
      } catch {
        if (!cancelled) setHasUpcomingReminder(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blocked, status]);

  if (dismissed || !blocked || !hasUpcomingReminder) return null;

  async function fix() {
    setBusy(true);
    try {
      const { enableNotifications, openNotificationSettings } = await import("@/local/notificationStatus");
      if (channelMuted) openNotificationSettings();
      else await enableNotifications();
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  return (
    <div className="bg-waste-soft text-waste text-xs leading-relaxed px-4 py-2 flex items-center gap-2" dir="rtl" role="alert">
      <span className="flex-1">
        {channelMuted
          ? "اعلان «یادآورها» در تنظیمات گوشی بی‌صدا شده است؛ یادآورهای شما دیده نمی‌شوند."
          : "اعلان‌ها برای برنامه خاموش است؛ یادآورهای شما زنگ نمی‌خورند."}
      </span>
      <button type="button" onClick={fix} disabled={busy} className="shrink-0 font-medium underline disabled:opacity-50">
        {channelMuted ? "باز کردن تنظیمات" : "روشن کردن"}
      </button>
      <button type="button" onClick={() => setDismissed(true)} className="shrink-0 font-medium hover:opacity-70">
        بعداً
      </button>
    </div>
  );
}

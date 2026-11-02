"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher, isNativePlatform } from "@/lib/apiClient";
import { END_OF_DAY_CHANGED_EVENT, END_OF_DAY_LOOKAHEAD_DAYS, daysWindow, planEndOfDayReminders, readEndOfDaySettings } from "@/lib/endOfDay";

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Phone only: arms the «مرور پایان روز» reminders for the evenings that have something in them — the open things of
 * today, the planned things of the next days (see planEndOfDayReminders) — and none for an evening with nothing.
 * Re-arms whenever what those days hold (the same /api/events answer the other screens write through), the setting, or
 * the day itself changes; a tap on the notification opens /review. Renders nothing.
 */
export default function EndOfDayScheduler() {
  const [native] = useState(() => typeof window !== "undefined" && isNativePlatform());
  const [today, setToday] = useState(() => new Date());
  const [settingsVersion, setSettingsVersion] = useState(0);
  const { from, to } = useMemo(() => daysWindow(today, END_OF_DAY_LOOKAHEAD_DAYS), [today]);
  const { data } = useSWR<{ occurrences: any[]; taskOccurrences: any[] }>(native ? `/api/events?from=${from}&to=${to}` : null, fetcher);

  useEffect(() => {
    if (!native) return;
    const bump = () => setSettingsVersion((v) => v + 1);
    window.addEventListener(END_OF_DAY_CHANGED_EVENT, bump);
    return () => window.removeEventListener(END_OF_DAY_CHANGED_EVENT, bump);
  }, [native]);

  // The window is built for a day; when the day turns (the app kept open past midnight, or brought back from the
  // background the next morning) it is rebuilt, so "today" never means yesterday.
  useEffect(() => {
    if (!native) return;
    const check = () => setToday((previous) => (sameDay(previous, new Date()) ? previous : new Date()));
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [native]);

  useEffect(() => {
    if (!native || !data) return;
    const planned = planEndOfDayReminders(readEndOfDaySettings(), new Date(), data);
    void import("@/local/nativeNotifications").then(({ replaceFixedNotifications, END_OF_DAY_NOTIFICATION_IDS }) => {
      replaceFixedNotifications(
        END_OF_DAY_NOTIFICATION_IDS,
        planned.map((reminder, i) => ({ id: END_OF_DAY_NOTIFICATION_IDS[i], title: reminder.title, body: reminder.body, at: reminder.at, extra: { route: "/review" } }))
      );
    });
  }, [native, data, settingsVersion]);

  return null;
}

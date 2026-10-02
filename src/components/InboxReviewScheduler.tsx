"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetcher, isNativePlatform } from "@/lib/apiClient";
import { INBOX_REVIEW_CHANGED_EVENT, nextReviewTimes, readInboxReviewSettings } from "@/lib/inboxReview";
import { toPersianDigits } from "@/lib/money";
import type { InboxItemDto } from "@/lib/schemas/inbox";

/**
 * Phone only: keeps the «مرور صندوق ورودی» reminders armed exactly while the inbox has something in it —
 * the next few review moments when it does, none at all when it is empty. Re-arms whenever the inbox
 * (the same SWR key the inbox screen writes through) or the review setting changes. Renders nothing.
 */
export default function InboxReviewScheduler() {
  const [native] = useState(() => typeof window !== "undefined" && isNativePlatform());
  const { data } = useSWR<{ items: InboxItemDto[] }>(native ? "/api/inbox" : null, fetcher);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const count = data?.items.length;

  useEffect(() => {
    if (!native) return;
    const bump = () => setSettingsVersion((v) => v + 1);
    window.addEventListener(INBOX_REVIEW_CHANGED_EVENT, bump);
    return () => window.removeEventListener(INBOX_REVIEW_CHANGED_EVENT, bump);
  }, [native]);

  useEffect(() => {
    if (!native || count === undefined) return;
    const settings = readInboxReviewSettings();
    void import("@/local/nativeNotifications").then(({ replaceFixedNotifications, INBOX_REVIEW_NOTIFICATION_IDS }) => {
      const times = count > 0 ? nextReviewTimes(settings, new Date(), INBOX_REVIEW_NOTIFICATION_IDS.length) : [];
      replaceFixedNotifications(
        INBOX_REVIEW_NOTIFICATION_IDS,
        times.map((at, i) => ({
          id: INBOX_REVIEW_NOTIFICATION_IDS[i],
          title: "وقت خالی کردن صندوق ورودی",
          body: `${toPersianDigits(String(count))} مورد منتظر تصمیم توست: کار، رویداد، تراکنش… یا دور ریختن.`,
          at,
        }))
      );
    });
  }, [native, count, settingsVersion]);

  return null;
}

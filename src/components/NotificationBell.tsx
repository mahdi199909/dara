"use client";

import { useState } from "react";
import { useNotifications } from "@/lib/hooks";
import { apiPost } from "@/lib/apiClient";
import { mutate } from "swr";
import { BellIcon, XIcon } from "./icons";

export default function NotificationBell() {
  const { notifications } = useNotifications();
  const [open, setOpen] = useState(false);

  async function markRead(id: string) {
    await apiPost(`/api/notifications/${id}/read`);
    mutate("/api/notifications");
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-full hover:bg-canvas text-muted"
        aria-label="اعلان‌ها"
      >
        <BellIcon className="w-5 h-5" />
        {notifications.length > 0 && (
          <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-waste-500 pulse-dot" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          {/* The bell sits at the far-left of the header in this layout (both mobile and
              desktop share one AppTopBar), so the panel must open rightward/inward — anchoring
              via right-0 here would extend it further left, off the edge of the viewport. */}
          <div className="absolute left-0 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto scrollbar-thin bg-surface rounded-2xl shadow-lg border border-line z-40">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <span className="font-medium text-sm text-ink">اعلان‌ها</span>
              <button onClick={() => setOpen(false)}>
                <XIcon className="w-4 h-4 text-muted" />
              </button>
            </div>
            {notifications.length === 0 ? (
              <p className="text-sm text-muted text-center py-8">اعلان جدیدی نیست.</p>
            ) : (
              <ul className="divide-y divide-line">
                {notifications.map((n: any) => (
                  <li key={n.id} className="px-4 py-3 text-sm hover:bg-canvas cursor-pointer" onClick={() => markRead(n.id)}>
                    <p className="font-medium text-ink">{n.title}</p>
                    <p className="text-muted text-xs mt-0.5">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

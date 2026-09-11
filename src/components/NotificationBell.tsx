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
    <>
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
        <div className="fixed inset-0 z-50 bg-canvas flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
            <span className="font-bold text-ink">اعلان‌ها</span>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-full hover:bg-surface" aria-label="بستن">
              <XIcon className="w-5 h-5 text-muted" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {notifications.length === 0 ? (
              <p className="text-sm text-muted text-center py-16">اعلان جدیدی نیست.</p>
            ) : (
              <ul className="divide-y divide-line">
                {notifications.map((n: any) => (
                  <li key={n.id} className="px-4 py-4 text-sm hover:bg-surface cursor-pointer" onClick={() => markRead(n.id)}>
                    <p className="font-medium text-ink">{n.title}</p>
                    <p className="text-muted text-xs mt-1">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

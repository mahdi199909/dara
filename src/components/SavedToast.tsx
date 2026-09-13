"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeSaved } from "@/lib/savedToast";
import { BOTTOM_NAV_HEIGHT_PX } from "@/lib/layoutConstants";

const VISIBLE_MS = 1600;

/**
 * A brief, low-key "این ثبت شد" confirmation — after the critical data-loss bug, users have
 * reason to doubt a save actually landed rather than just vanished. Every write path that should
 * reassure the user calls notifySaved() right after its request resolves (see savedToast.ts);
 * this is the one global listener, mounted once in (app)/layout.tsx like UpgradeToast.
 */
export default function SavedToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      subscribeSaved((msg) => {
        setMessage(msg);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setMessage(null), VISIBLE_MS);
      }),
    []
  );

  if (!message) return null;

  return (
    <div
      className="fixed inset-x-0 z-50 flex justify-center px-4 pointer-events-none"
      style={{ bottom: `calc(${BOTTOM_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom) + 0.75rem)` }}
      dir="rtl"
    >
      <div className="flex items-center gap-1.5 bg-ink text-canvas text-xs font-medium rounded-full px-4 py-2 shadow-card">
        <span>✓</span>
        {message}
      </div>
    </div>
  );
}

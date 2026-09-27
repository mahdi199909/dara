"use client";

// One-click extensions in the users table: +1 month, +3 months, +1 year, added to whatever is running.
import { useState } from "react";
import { changeLicense, errorMessage } from "./adminApi";

const PRESETS = [
  [30, "۱ ماه"],
  [90, "۳ ماه"],
  [365, "۱ سال"],
] as const;

export default function QuickExtend({ userId, disabled, onDone }: { userId: string; disabled?: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);

  async function extend(days: number, label: string) {
    if (!window.confirm(`اشتراک این کاربر ${label} تمدید شود؟`)) return;
    setBusy(days);
    try {
      await changeLicense(userId, { action: "extend", days });
      onDone();
    } catch (err) {
      window.alert(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (disabled) return <span className="text-xs text-muted">—</span>;
  return (
    <div className="flex gap-1">
      {PRESETS.map(([days, label]) => (
        <button
          key={days}
          onClick={() => void extend(days, label)}
          disabled={busy !== null}
          className="rounded-lg bg-accent-soft text-accent px-2 py-1 text-[11px] font-medium whitespace-nowrap hover:opacity-80 disabled:opacity-40"
        >
          {busy === days ? "…" : label}
        </button>
      ))}
    </div>
  );
}

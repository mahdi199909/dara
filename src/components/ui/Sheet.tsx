"use client";

import { useEffect } from "react";
import { XIcon } from "@/components/icons";

/**
 * A bottom sheet over the page — the same look the event and capture forms already use, as one
 * component: a dimmed backdrop (tap to close), a rounded panel that scrolls on its own when it is
 * taller than the screen, a title and a close button. Escape closes it too.
 */
export default function Sheet({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** A little wider on larger screens (lists with two columns). */
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`w-full ${wide ? "max-w-xl" : "max-w-md"} mx-auto bg-surface rounded-t-2xl shadow-xl max-h-[90vh] overflow-y-auto scrollbar-thin`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="بستن" className="text-muted hover:text-ink p-1">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

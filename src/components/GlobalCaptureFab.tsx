"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import CaptureFormModal from "./CaptureFormModal";
import { PlusIcon } from "./icons";
import { BOTTOM_NAV_HEIGHT_PX } from "@/lib/layoutConstants";

export default function GlobalCaptureFab() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Home already has its own dedicated "ثبت کار" button — skip the redundant FAB there.
  if (pathname === "/") return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ bottom: `calc(${BOTTOM_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom) + 1rem)` }}
        className="fixed left-6 z-30 h-14 w-14 rounded-full bg-brand-600 text-white flex items-center justify-center shadow-lg shadow-brand-600/30 hover:bg-brand-700 transition"
        aria-label="ثبت کار"
      >
        <PlusIcon className="w-6 h-6" />
      </button>

      <CaptureFormModal open={open} onClose={() => setOpen(false)} onDone={() => setOpen(false)} />
    </>
  );
}

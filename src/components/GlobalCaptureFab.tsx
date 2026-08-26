"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import CaptureForm from "./CaptureForm";
import { PlusIcon, XIcon } from "./icons";
import { BOTTOM_NAV_HEIGHT_PX } from "@/lib/layoutConstants";

export default function GlobalCaptureFab() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Home already has its own inline "ثبت کار" entry point — skip the redundant FAB there.
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

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
          <div className="w-full max-w-md mx-auto bg-white rounded-t-2xl shadow-xl max-h-[90vh] overflow-y-auto scrollbar-thin">
            <div className="flex items-center justify-between px-5 pt-5 pb-1">
              <h2 className="font-bold text-gray-800">ثبت کار</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <CaptureForm onDone={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import CaptureForm from "./CaptureForm";
import { XIcon } from "./icons";

/** The bottom-sheet capture form — shared by GlobalCaptureFab (every page except Home) and
 * Home's own dedicated "ثبت کار" button, so the two entry points stay visually/behaviorally
 * identical rather than drifting apart as two hand-rolled copies. */
export default function CaptureFormModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-md mx-auto bg-white rounded-t-2xl shadow-xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <h2 className="font-bold text-gray-800">ثبت کار</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1" aria-label="بستن">
            <XIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">
          <CaptureForm onDone={onDone} />
        </div>
      </div>
    </div>
  );
}

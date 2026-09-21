"use client";

import { formatJalali } from "@/lib/jalali";
import { XIcon } from "@/components/icons";
import DayPanel from "@/components/day/DayPanel";

interface DayDetailModalProps {
  date: Date;
  onClose: () => void;
  onChanged: () => void; // month overview + events both need re-fetching after a change
  /** The task, event or note a search result pointed at — marked inside the day. */
  highlightId?: string | null;
}

// The "everything about this day" sheet opened from the calendar month grid (and from a search
// result): the day's note, what was scheduled or done with its time and money, the habits and the
// day's financial movements — see DayPanel. Deliberately a separate fetch from the month overview,
// which only carries a few aggregate numbers per day, not the underlying rows.
export default function DayDetailModal({ date, onClose, onChanged, highlightId }: DayDetailModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-md mx-auto bg-surface rounded-t-2xl shadow-xl max-h-[88vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 sticky top-0 bg-surface z-10">
          <h2 className="font-bold text-ink">{formatJalali(date, { withWeekday: true, long: true })}</h2>
          <button onClick={onClose} aria-label="بستن" className="text-muted hover:text-ink p-1">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pb-6">
          <DayPanel day={date} highlightId={highlightId} onChanged={onChanged} />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { formatTime } from "@/lib/jalali";
import { formatDuration, shortDuration, signed } from "@/lib/money";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import type { DayItem } from "@/lib/dayItems";
import { CheckSquareIcon, EditIcon, TrashIcon, XIcon } from "@/components/icons";

const KIND_LABEL: Record<DayItem["kind"], string> = { EVENT: "رویداد", TASK: "کار", HABIT: "عادت", TRANSACTION: "تراکنش", TIME_ENTRY: "فعالیت" };

/** Three dots in a column — the "more" mark for a row (the icon set's own "more" is a four-square grid, which reads as a menu). */
function DotsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

/**
 * One line of a day's list: a done-box (tasks and events) or a marker, the time it ran, what it was,
 * its category and length, the money that moved, and a ⋯ button that opens edit/delete. The menu is a
 * small sheet rather than a popover so a scrolling list around it can never clip it.
 */
export default function DayItemRow({
  item,
  highlighted,
  onToggleDone,
  onEdit,
  onDelete,
}: {
  item: DayItem;
  highlighted?: boolean;
  onToggleDone?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { format } = useCurrencyUnit();
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMenu = Boolean(onEdit || onDelete);
  const showsBox = item.kind === "EVENT" || item.kind === "TASK";
  const category = item.category?.name ? `${item.category.icon ?? ""} ${item.category.name}`.trim() : item.category?.icon ?? null;

  return (
    <li
      data-day-item={item.key}
      className={`flex items-center gap-2.5 text-sm rounded-lg ${highlighted ? "bg-accent-soft -mx-2 px-2 py-1" : ""}`}
    >
      {showsBox ? (
        <button
          type="button"
          onClick={onToggleDone}
          aria-label="تکمیل"
          className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${
            item.isDone ? "bg-accent border-accent text-on-accent" : "border-line text-transparent"
          }`}
        >
          <CheckSquareIcon className="w-3.5 h-3.5" strokeWidth={2.5} />
        </button>
      ) : (
        <span className="shrink-0 w-5 h-5 flex items-center justify-center text-accent">
          {item.kind === "HABIT" ? "🔥" : item.kind === "TRANSACTION" ? (item.isIncome ? "+" : "-") : "⏱"}
        </span>
      )}

      <div className="shrink-0 w-11 text-[12px] leading-tight text-muted" dir="ltr">
        {item.start ? (
          <>
            <div className="text-ink">{formatTime(new Date(item.start))}</div>
            {item.end && <div>{formatTime(new Date(item.end))}</div>}
          </>
        ) : (
          <span>—</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`truncate ${item.isDone ? "text-muted line-through" : "text-ink"}`}>{item.title}</p>
        <p className="truncate text-[11px] text-muted">
          {[category ?? KIND_LABEL[item.kind], item.minutes ? shortDuration(item.minutes) : null].filter(Boolean).join(" · ")}
        </p>
      </div>

      {item.amount !== undefined && (
        <span className={`shrink-0 text-xs font-bold ${item.isIncome ? "text-accent" : "text-waste"}`}>
          {signed(item.isIncome ? "+" : "-", format(item.amount, { withSuffix: true }))}
        </span>
      )}

      {hasMenu && (
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="گزینه‌ها" className="shrink-0 p-1 -mr-1 text-muted hover:text-ink">
          <DotsIcon className="w-4 h-4" />
        </button>
      )}

      {menuOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={() => setMenuOpen(false)}>
          <div className="w-full max-w-xs mx-auto bg-surface rounded-t-2xl shadow-xl p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 pb-1">
              <div className="min-w-0">
                <p className="font-bold text-ink text-sm truncate">{item.title}</p>
                <p className="text-[11px] text-muted">
                  {KIND_LABEL[item.kind]}
                  {item.minutes ? ` · ${formatDuration(item.minutes)}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="بستن" className="p-1 text-muted hover:text-ink">
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            {onEdit && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onEdit();
                }}
                className="w-full flex items-center gap-2 rounded-xl bg-canvas px-3 py-3 text-sm text-ink"
              >
                <EditIcon className="w-4 h-4 text-muted" />
                ویرایش
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                className="w-full flex items-center gap-2 rounded-xl bg-waste-soft px-3 py-3 text-sm text-waste"
              >
                <TrashIcon className="w-4 h-4" />
                حذف
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

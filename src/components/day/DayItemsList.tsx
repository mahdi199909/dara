"use client";

import { useState } from "react";
import { apiPost, apiPatch, apiDelete } from "@/lib/apiClient";
import { refreshAllCaches } from "@/lib/refreshCaches";
import type { DayItem } from "@/lib/dayItems";
import DayItemRow from "@/components/day/DayItemRow";
import TaskEditModal from "@/components/day/TaskEditModal";
import EventFormModal from "@/components/calendar/EventFormModal";
import HabitDurationModal from "@/components/habits/HabitDurationModal";

/**
 * A day's items with everything a person does to them: tick a task or event done, edit it, delete it.
 * Home's «فعالیت‌های امروز» and the calendar's day view both render this, so an item behaves the same
 * wherever it is seen. Edit opens the form of what the item is (the event form for an event, the task
 * form for a task, the duration sheet for a habit check-in); deleting asks first and reports a refusal.
 */
export default function DayItemsList({
  items,
  day,
  onChanged,
  highlightId,
}: {
  items: DayItem[];
  /** The day the list is for — a habit check-in is looked up on it. */
  day: Date;
  /** Called after anything changed, so the caller re-fetches what it shows. */
  onChanged: () => void;
  /** An entity id to mark (the search result that led here). */
  highlightId?: string | null;
}) {
  const [editing, setEditing] = useState<DayItem | null>(null);
  // The day's own midnight — the check-in routes bucket by day, and this is the instant they expect for it.
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());

  function changed() {
    refreshAllCaches();
    onChanged();
  }

  async function guarded(action: () => Promise<unknown>, fallback: string) {
    try {
      await action();
      changed();
    } catch (err) {
      alert(err instanceof Error ? err.message : fallback);
    }
  }

  function toggleDone(item: DayItem) {
    if (item.kind === "EVENT") {
      return guarded(() => apiPost(`/api/events/${item.id}/complete`, { occurrenceDate: item.source.startAt }), "ثبت انجام نشد.");
    }
    if (item.kind === "TASK") {
      return guarded(() => apiPatch(`/api/tasks/${item.id}`, { status: item.isDone ? "TODO" : "DONE" }), "ثبت انجام نشد.");
    }
  }

  function remove(item: DayItem) {
    if (item.kind === "EVENT") {
      const recurring = item.source.event.recurrenceFreq && item.source.event.recurrenceFreq !== "NONE";
      if (!confirm(recurring ? `«${item.title}» تکرارشونده است؛ همه تکرارهایش حذف شود؟` : `«${item.title}» حذف شود؟`)) return;
      return guarded(() => apiDelete(`/api/events/${item.id}`), "حذف انجام نشد.");
    }
    if (item.kind === "TASK") {
      if (!confirm(`«${item.title}» حذف شود؟`)) return;
      return guarded(() => apiDelete(`/api/tasks/${item.id}`), "حذف انجام نشد.");
    }
    if (item.kind === "HABIT" && item.source.habitId) {
      if (!confirm(`انجام «${item.title}» برای این روز برداشته شود؟`)) return;
      // The check-in is a toggle: posting for the same day takes the tick off.
      return guarded(() => apiPost(`/api/habits/${item.source.habitId}/checkin`, { date: dayStart.toISOString() }), "حذف انجام نشد.");
    }
    if (item.kind === "TRANSACTION") {
      if (!confirm(`«${item.title}» حذف شود؟`)) return;
      return guarded(() => apiDelete(`/api/transactions/${item.id}`), "حذف انجام نشد.");
    }
  }

  // Time entries have no route to edit or delete them, so their rows carry no menu.
  const editable = (item: DayItem) => item.kind === "EVENT" || item.kind === "TASK" || (item.kind === "HABIT" && !!item.source.habitId);
  const deletable = (item: DayItem) => item.kind !== "TIME_ENTRY" && (item.kind !== "HABIT" || !!item.source.habitId);

  return (
    <>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <DayItemRow
            key={item.key}
            item={item}
            highlighted={!!highlightId && item.id === highlightId}
            onToggleDone={() => void toggleDone(item)}
            onEdit={editable(item) ? () => setEditing(item) : undefined}
            onDelete={deletable(item) ? () => void remove(item) : undefined}
          />
        ))}
      </ul>

      {editing?.kind === "EVENT" && (
        <EventFormModal
          defaultDate={new Date(editing.source.startAt)}
          event={editing.source.event}
          onClose={() => setEditing(null)}
          onCreated={() => {
            setEditing(null);
            changed();
          }}
          onDeleted={() => {
            setEditing(null);
            changed();
          }}
        />
      )}
      {editing?.kind === "TASK" && (
        <TaskEditModal
          task={editing.source}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            changed();
          }}
          onDeleted={() => {
            setEditing(null);
            changed();
          }}
        />
      )}
      {editing?.kind === "HABIT" && (
        <HabitDurationModal
          habit={{ id: editing.source.habitId, title: editing.title, todayDurationMin: editing.minutes }}
          date={dayStart}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            changed();
          }}
        />
      )}
    </>
  );
}

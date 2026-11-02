// Moving a task or an event to another day or time — to tomorrow, or to a moment the person picks — as the patch the
// existing routes already accept (PATCH /api/tasks/:id and /api/events/:id). Pure.
//
// Dates are worked out with the calendar's own fields (year, month, day, hour, minute), never by adding 24 hours, so a
// daylight-saving change cannot move a time of day; the length of something that has a start and an end is kept exactly.

export type Movable =
  | { kind: "TASK"; id: string; title: string; dueDate: string | null; startAt: string | null; endAt: string | null }
  | { kind: "EVENT"; id: string; title: string; startAt: string; endAt: string; allDay: boolean; recurring: boolean };

export interface TaskMovePatch {
  dueDate: string;
  startAt: string | null;
  endAt: string | null;
}

export interface EventMovePatch {
  startAt: string;
  endAt: string;
}

/** A moment in the day the item should go to (its time of day is not used unless `time` is left out for a timed item). */
export interface MoveTarget {
  day: Date;
  /** "HH:MM" — the new start time of something that has a time; left out, it keeps the time it had. */
  time?: string;
}

/** A task as /api/events (taskOccurrences) or /api/tasks returns it. */
export function movableFromTask(task: { id: string; title: string; dueDate?: string | null; startAt?: string | null; endAt?: string | null }): Extract<Movable, { kind: "TASK" }> {
  return { kind: "TASK", id: task.id, title: task.title, dueDate: task.dueDate ?? null, startAt: task.startAt ?? null, endAt: task.endAt ?? null };
}

/** An event as it sits inside an occurrence of /api/events (the event's own start and end, not the occurrence's). */
export function movableFromEvent(event: { id: string; title: string; startAt: string; endAt: string; allDay?: boolean | null; recurrenceFreq?: string | null }): Extract<Movable, { kind: "EVENT" }> {
  return {
    kind: "EVENT",
    id: event.id,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: Boolean(event.allDay),
    recurring: Boolean(event.recurrenceFreq) && event.recurrenceFreq !== "NONE",
  };
}

/** Whether a move is possible at all. One occurrence of a repeating event has no row of its own to move. */
export function canMove(item: Movable): boolean {
  return item.kind === "TASK" || !item.recurring;
}

/** Why it cannot be moved, in the person's words; null when it can. */
export function cannotMoveReason(item: Movable): string | null {
  return canMove(item) ? null : "این رویداد تکرارشونده است؛ یک بارش را نمی‌شود جابه‌جا کرد. از تقویم خودِ رویداد را ویرایش کن.";
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The same calendar date as `day` with the clock time of `clock`. */
function onDayAtClockOf(day: Date, clock: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), clock.getHours(), clock.getMinutes(), clock.getSeconds(), clock.getMilliseconds());
}

function onDayAt(day: Date, time: string, fallback: Date): Date {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return onDayAtClockOf(day, fallback);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.min(23, Number(match[1])), Math.min(59, Number(match[2])), 0, 0);
}

/** Tomorrow, as a moment in that day. */
export function tomorrowOf(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, now.getHours(), now.getMinutes());
}

export function planTaskMove(task: Extract<Movable, { kind: "TASK" }>, target: MoveTarget): TaskMovePatch {
  const dueDate = startOfDay(target.day).toISOString();
  if (!task.startAt) return { dueDate, startAt: null, endAt: null };

  const oldStart = new Date(task.startAt);
  const start = target.time ? onDayAt(target.day, target.time, oldStart) : onDayAtClockOf(target.day, oldStart);
  const length = task.endAt ? new Date(task.endAt).getTime() - oldStart.getTime() : null;
  return { dueDate, startAt: start.toISOString(), endAt: length === null ? null : new Date(start.getTime() + length).toISOString() };
}

export function planEventMove(event: Extract<Movable, { kind: "EVENT" }>, target: MoveTarget): EventMovePatch {
  const oldStart = new Date(event.startAt);
  const oldEnd = new Date(event.endAt);

  if (event.allDay) {
    // Whole days: the start and the end both move by the number of calendar days between the old day and the new one.
    const days = Math.round((Date.UTC(target.day.getFullYear(), target.day.getMonth(), target.day.getDate()) - Date.UTC(oldStart.getFullYear(), oldStart.getMonth(), oldStart.getDate())) / 86_400_000);
    const shift = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
    return { startAt: shift(oldStart).toISOString(), endAt: shift(oldEnd).toISOString() };
  }

  const start = target.time ? onDayAt(target.day, target.time, oldStart) : onDayAtClockOf(target.day, oldStart);
  return { startAt: start.toISOString(), endAt: new Date(start.getTime() + (oldEnd.getTime() - oldStart.getTime())).toISOString() };
}

/** The patch that moves `item` to `target`, for the route that owns it. Throws for an item that cannot be moved. */
export function planMove(item: Movable, target: MoveTarget): TaskMovePatch | EventMovePatch {
  if (!canMove(item)) throw new Error("این مورد را نمی‌شود جابه‌جا کرد.");
  return item.kind === "TASK" ? planTaskMove(item, target) : planEventMove(item, target);
}

/** Does the item have a time of day the person may want to change? (A task with only a due day, or an all-day event, has none.) */
export function hasClockTime(item: Movable): boolean {
  return item.kind === "TASK" ? item.startAt !== null : !item.allDay;
}

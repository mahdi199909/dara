// One day's list of things — what Home shows as «فعالیت‌های امروز» and the calendar shows for a
// picked day: calendar events (each occurrence of a recurring one), tasks, and what /api/day-activity
// adds (finished time entries, habit check-ins, independent transactions). Pure: the callers fetch,
// this only merges and orders, so the two places can never disagree about what a day contains.

export type DayItemKind = "EVENT" | "TASK" | "HABIT" | "TRANSACTION" | "TIME_ENTRY";

export interface DayItem {
  key: string;
  kind: DayItemKind;
  /** The entity's own id — the event's, the task's, the habit check-in's, the transaction's, the time entry's. */
  id: string;
  title: string;
  /** When it starts (ISO); null for something that belongs to the day but has no clock time (a task with only a due day). */
  start: string | null;
  end: string | null;
  minutes?: number;
  isDone?: boolean;
  amount?: number;
  isIncome?: boolean;
  category?: { name?: string | null; icon?: string | null } | null;
  /** The original occurrence / task / activity row, for the edit forms. */
  source: any;
}

interface DayActivityRow {
  type: "HABIT" | "TRANSACTION" | "TIME_ENTRY";
  id: string;
  habitId?: string | null;
  title: string;
  timeOfDay: string;
  isIncome: boolean | null;
  amount: number | null;
  minutes: number | null;
  categoryIcon: string | null;
  categoryColor: string | null;
}

function minutesBetween(start: string | null, end: string | null): number | undefined {
  if (!start || !end) return undefined;
  const m = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  return m > 0 ? m : undefined;
}

export function buildDayItems(
  events: { occurrences?: any[]; taskOccurrences?: any[] } | undefined,
  dayActivity: { items?: DayActivityRow[] } | undefined
): DayItem[] {
  const items: DayItem[] = [];

  for (const occ of events?.occurrences ?? []) {
    const timed = !occ.event.allDay;
    items.push({
      key: `event-${occ.occurrenceId}`,
      kind: "EVENT",
      id: occ.event.id,
      title: occ.event.title,
      start: timed ? occ.startAt : null,
      end: timed ? occ.endAt : null,
      minutes: timed ? minutesBetween(occ.startAt, occ.endAt) : undefined,
      isDone: occ.isDone,
      amount: occ.event.directCost > 0 ? occ.event.directCost : occ.event.incomeAmount > 0 ? occ.event.incomeAmount : undefined,
      isIncome: occ.event.directCost > 0 ? false : occ.event.incomeAmount > 0 ? true : undefined,
      category: occ.event.category ?? null,
      source: occ,
    });
  }

  for (const task of events?.taskOccurrences ?? []) {
    items.push({
      key: `task-${task.id}`,
      kind: "TASK",
      id: task.id,
      title: task.title,
      start: task.startAt ?? null,
      end: task.endAt ?? null,
      minutes: minutesBetween(task.startAt ?? null, task.endAt ?? null),
      isDone: task.status === "DONE",
      amount: task.directCost > 0 ? task.directCost : task.incomeAmount > 0 ? task.incomeAmount : undefined,
      isIncome: task.directCost > 0 ? false : task.incomeAmount > 0 ? true : undefined,
      category: task.category ?? null,
      source: task,
    });
  }

  for (const row of dayActivity?.items ?? []) {
    items.push({
      key: `${row.type}-${row.id}`,
      kind: row.type,
      id: row.id,
      title: row.title,
      start: row.timeOfDay,
      end: null,
      minutes: row.minutes ?? undefined,
      amount: row.amount ?? undefined,
      isIncome: row.isIncome ?? undefined,
      category: row.categoryIcon ? { icon: row.categoryIcon } : null,
      source: row,
    });
  }

  // Things with no clock time belong to the day as a whole: they come first, then the rest in time order.
  return items.sort((a, b) => {
    if (!a.start && !b.start) return 0;
    if (!a.start) return -1;
    if (!b.start) return 1;
    return a.start.localeCompare(b.start);
  });
}

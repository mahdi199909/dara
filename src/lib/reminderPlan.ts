/** A reminder row of an event as the API returns it. */
export interface ExistingReminder {
  id: string;
  offsetMinutes: number;
}

export interface ReminderPlan {
  /** Ids of reminders to delete (no longer wanted, or a duplicate of an offset already kept). */
  remove: string[];
  /** Offsets, in minutes before the event, that have no reminder yet and need one created. */
  add: number[];
}

/**
 * What to delete and create so an event's reminders end up exactly as the user ticked them in the
 * form. Reminders are separate rows (one per offset), so editing them is a diff, not an update:
 * an offset that is still ticked keeps its row (and whether it already fired), an unticked one is
 * deleted, a newly ticked one is created. A second row for an offset that already has one
 * (possible from older builds) is treated as surplus and removed.
 */
export function planReminderChanges(existing: readonly ExistingReminder[], wanted: readonly number[]): ReminderPlan {
  const wantedSet = new Set(wanted);
  const kept = new Set<number>();
  const remove: string[] = [];
  for (const r of existing) {
    if (wantedSet.has(r.offsetMinutes) && !kept.has(r.offsetMinutes)) kept.add(r.offsetMinutes);
    else remove.push(r.id);
  }
  const add = [...wantedSet].filter((m) => !kept.has(m)).sort((a, b) => a - b);
  return { remove, add };
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 60 * 24;

/** "10 دقیقه قبل" / "2 ساعت قبل" / "1 روز و 12 ساعت قبل" — how a reminder offset reads on its chip. */
export function reminderOffsetLabel(minutes: number): string {
  const days = Math.floor(minutes / MINUTES_PER_DAY);
  const hours = Math.floor((minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const mins = minutes % MINUTES_PER_HOUR;
  const parts: string[] = [];
  if (days) parts.push(`${days} روز`);
  if (hours) parts.push(`${hours} ساعت`);
  if (mins || parts.length === 0) parts.push(`${mins} دقیقه`);
  return `${parts.join(" و ")} قبل`;
}

/** Longest lead time the form accepts for a custom reminder (one year). */
export const MAX_REMINDER_OFFSET_MINUTES = 60 * 24 * 365;

/** Converts what the user typed into the custom-reminder box (an amount plus a unit) to minutes, or null when it isn't a usable lead time. */
export function customOffsetToMinutes(amount: number, unit: "MINUTE" | "HOUR" | "DAY"): number | null {
  const factor = unit === "DAY" ? MINUTES_PER_DAY : unit === "HOUR" ? MINUTES_PER_HOUR : 1;
  const minutes = amount * factor;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_REMINDER_OFFSET_MINUTES) return null;
  return minutes;
}

/** Hour of the day (phone's local time) at which a reminder on a date-only due date rings — see installmentNotifyAt. */
export const INSTALLMENT_NOTIFY_HOUR = 9;

/**
 * The lead times in `offsets` whose reminder moment (start − lead) is no longer ahead of `now`.
 * The phone only hands the system reminders that lie in the future, so an event that starts in 10
 * minutes with the pre-ticked «30 دقیقه قبل» would never ring; the event form uses this to say so
 * instead of letting it pass without a word.
 */
export function pastDueOffsets(startAt: Date, offsets: readonly number[], now: Date = new Date()): number[] {
  const start = startAt.getTime();
  if (Number.isNaN(start)) return [];
  return offsets.filter((minutes) => start - minutes * 60_000 <= now.getTime());
}

/**
 * When the system notification for an installment reminder rings. An installment's due date is the
 * local midnight of its day, so «1 روز قبل» lands at 00:00 of the day before — the middle of the
 * night, when nobody looks at the phone, and already in the past for an installment that is due
 * tomorrow (which then never rang at all). A moment earlier than 09:00 is therefore moved to 09:00
 * of the same day; one that is already later than that (a reminder set in hours or minutes) is kept.
 */
export function installmentNotifyAt(remindAt: Date): Date {
  const morning = new Date(remindAt.getFullYear(), remindAt.getMonth(), remindAt.getDate(), INSTALLMENT_NOTIFY_HOUR, 0, 0, 0);
  return remindAt.getTime() < morning.getTime() ? morning : remindAt;
}

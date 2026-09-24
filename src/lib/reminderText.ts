/** "۳۰ دقیقه" / "۲ ساعت" — the offset-before-due-time phrase shared by the in-app lazy-fire path
 * (src/local/repositories/notifications.ts) and native notification scheduling
 * (src/local/nativeNotifications.ts call sites) so both describe the same reminder identically. */
export function formatReminderOffset(offsetMinutes: number): string {
  return offsetMinutes >= 60 ? `${Math.round(offsetMinutes / 60)} ساعت` : `${offsetMinutes} دقیقه`;
}

/**
 * The line an event's reminder shows — «جلسه - 30 دقیقه دیگر», and «جلسه - همین الان» for a reminder
 * set to ring at the start itself (an offset of 0, which used to read «0 دقیقه دیگر»). One
 * function for the system notification, the in-app bell on the phone and the server's bell, so a
 * reminder never reads differently depending on where it shows up.
 */
export function eventReminderBody(eventTitle: string, offsetMinutes: number): string {
  return offsetMinutes <= 0 ? `${eventTitle} - همین الان` : `${eventTitle} - ${formatReminderOffset(offsetMinutes)} دیگر`;
}

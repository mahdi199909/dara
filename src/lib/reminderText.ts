/** "۳۰ دقیقه" / "۲ ساعت" — the offset-before-due-time phrase shared by the in-app lazy-fire path
 * (src/local/repositories/notifications.ts) and native notification scheduling
 * (src/local/nativeNotifications.ts call sites) so both describe the same reminder identically. */
export function formatReminderOffset(offsetMinutes: number): string {
  return offsetMinutes >= 60 ? `${Math.round(offsetMinutes / 60)} ساعت` : `${offsetMinutes} دقیقه`;
}

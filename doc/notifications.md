# Notifications on the phone

How a reminder becomes a system notification on Android, every reason one can fail to arrive, and how to find out
which. (Users' view of the same feature: `doc/product-proposal.md` §6.21. The log side: `doc/logging/android.md`.)

## The pipeline

```
Reminder row (SQLite)            src/local/repositories/{events,installments}.ts
   │  created / moved / deleted
   ▼
scheduleReminderNotification()   src/local/nativeNotifications.ts   ── one serial queue to the plugin ──►  @capacitor/local-notifications
rescheduleReminderNotification()                                                                            AlarmManager alarm + stored copy
cancelReminderNotification(s)                                                                               (SharedPreferences NOTIFICATION_STORE)
   ▲
   │  "make the OS's schedule = the database"
reconcileReminderNotifications() src/local/reminderNotifications.ts   ← every launch, every return to the app
                                                                        (≥ 30 s apart), after a sync that changed
                                                                        reminders, and after anything that changes a
                                                                        recurring event
```

- The OS notification id is a Java-`hashCode` of the reminder's UUID (`reminderNotificationId`); a repeat of a recurring
  event uses the id `"<reminder id>::<n>"`. One reserved id, `TEST_NOTIFICATION_ID`, is the Settings test notification.
- Everything is fire-and-forget from the caller's point of view (a synchronous DB write never waits on the plugin), but
  runs **in call order** through one promise queue. That order matters: a reconcile reads `getPending()`, cancels what is
  no longer wanted and schedules what is; interleaved with a reminder created a moment after its snapshot it would cancel
  that brand-new alarm as stale.
- The in-app bell (`repositories/notifications.ts`, `/api/notifications`) is a separate, older mechanism: it only shows
  a due reminder while the app is open and polling.

## Why a notification might not arrive — and what handles it

| Cause | What used to happen | Now |
|---|---|---|
| The reminder's moment is already past when the event is saved (most often the pre-ticked «30 دقیقه قبل» on an event that starts sooner) | Skipped without a word; smallest lead time was 5 minutes | `EventFormModal` warns (`pastDueOffsets`) and offers «در لحظه شروع» (offset `0`, a real preset now); `LOCAL_NOTIFICATION_SKIPPED` in the log |
| Notification permission refused / never asked (Android 13+), or notifications blocked in system settings | The answer to the prompt was discarded; every `schedule()` was rejected and logged at ERROR only | Result is returned and logged (`LOCAL_NOTIFICATION_PERMISSION_FAILED` with `permission`); banner (`NotificationOffBanner`) when a reminder is waiting; notice in the event form; Settings card with «روشن کردن» (asks, or opens the app's notification settings when Android will not ask again) |
| The reminders channel was muted by the person | Invisible | `channelMuted` in `readNotificationStatus()`, banner/card row, «باز کردن تنظیمات» |
| Default channel importance (no heads-up banner, easy to miss) | Everything rang on the plugin's `default` channel | Own channel `parva_reminders`, importance HIGH (4), created once per run; falls back to the default channel if creation fails |
| Inexact alarms (`setAndAllowWhileIdle`): batched with other apps' alarms, held back by battery modes, minutes to hours late | Every reminder was inexact on purpose (to avoid the exact-alarm settings redirect) | Exact alarm **only when the system already allows it** (`checkExactNotificationSetting`, asked per call — a stale «yes» would make the plugin bounce the person to a settings screen mid-save). Manifest declares `USE_EXACT_ALARM` (Android 13+ grants it, no screen); Android 12 pre-grants `SCHEDULE_EXACT_ALARM`; Android 14 without it → card row «اجازه دادن» (`allowExactAlarms`) |
| Android drops **all** of an app's alarms when the APK is replaced or the app is force-stopped | Silent until the app was opened (the plugin re-arms on plugin load) and even then only its own stored copies | Manifest re-declares the plugin's `LocalNotificationRestoreReceiver` with `MY_PACKAGE_REPLACED` (re-arms right after an update); TS reconcile on every launch and return |
| A reminder saved while notifications were off, or one whose transaction rolled back | Never armed / armed for nothing until the next sync happened to touch it | Reconcile makes the OS schedule = the DB (skipped while notifications are off, so it never pops the permission dialog behind the person's back; re-run once they are allowed) |
| `rescheduleReminderNotification` used the plugin's `update()`, which **silently ignores an id it does not know** | A reminder that had been skipped as past (or created while off) and then moved into the future never rang | Reschedule is a plain `schedule()` (same id replaces the pending one) |
| Recurring events: a Reminder row is one moment, so only the first occurrence rang | Weekly/daily reminders rang once | `upcomingRepeatReminders`: the next 60 days, ≤ 14 repeats per reminder, ids `<reminder>::<n>`, re-derived on every reconcile (and immediately when such an event or its reminders change) |
| Installment due dates are local midnight, so «1 روز قبل» is 00:00 of the day before (the middle of the night, or already past for an installment due tomorrow) | Rang at midnight or never | `installmentNotifyAt`: a moment earlier than 09:00 rings at 09:00 of that day; the row keeps the exact lead time. Preset 0 is labelled «در روز سررسید» there |
| Paid installments kept ringing | «قسط … به زودی سررسید می‌شود» after paying | Paying cancels the alarms; the reconcile query skips PAID installments; undoing the payment reconciles again |
| Body read «0 دقیقه دیگر» for an offset of 0 | — | `eventReminderBody` → «… - همین الان» (used by the OS notification, the phone's bell and the server's bell) |
| The phone's battery manager (Xiaomi/Huawei/Oppo/Vivo autostart, Samsung «sleeping apps», Android battery optimization) stops a closed app's alarms | Invisible; nothing the app could say | `AndroidNotifications` bridge: `ignoringBatteryOptimizations()`, `manufacturer()`, openers for the battery list, the brand's autostart screen and the app's notification settings; `batteryBrandOf` (src/lib/phoneBrand.ts) gives brand-specific advice; the «آزمایش با برنامه‌ی بسته» test exercises the real alarm path |

## Diagnosing a phone that "never gets" notifications

1. **Settings → شخصی → اعلان‌ها و یادآورها.** Every row is a yes/no with its fix button. Then press
   «اعلان آزمایشی همین حالا» (permission, channel, heads-up) and «آزمایش با برنامه‌ی بسته (۱ دقیقه بعد)» — close the app,
   swipe it out of the recents and wait a minute. Arrives → alarms work; the reminder that did not come was skipped or
   mistimed (see the log). Does not arrive → the battery manager (the card's brand advice) or exact alarms.
2. **The diagnostic report** (Settings → پشتیبان‌گیری → گزارش تشخیصی): `LOCAL_NOTIFICATION_STATUS` at every launch and
   return; `LOCAL_NOTIFICATION_SKIPPED` (DEBUG) says why a given reminder was left out; `LOCAL_NOTIFICATION_FAILED`
   (`NOTIF-001`) carries the plugin's own error; `LOCAL_NOTIFICATION_PERMISSION_FAILED` (`NOTIF-002`) a refusal.
3. `adb shell dumpsys alarm | grep ir.parvaapp` lists what AlarmManager actually holds (type `RTC_WAKEUP`, exact vs
   inexact); `adb shell dumpsys notification | grep -A5 parva_reminders` shows the channel's importance.

## Pitfalls (each one bit, or nearly did)

- **Never return the plugin from a promise.** A Capacitor plugin is a proxy that answers to every property name, `then`
  included; an `async` function that returns the bare `LocalNotifications` makes the promise call `plugin.then()` →
  «LocalNotifications.then() is not implemented on web» (an unhandled rejection in tests; a hung call on a phone). Box it
  (`loadPlugin()` returns `{ plugin }`). The plugin mocks in `nativeNotifications.test.ts` / `notificationStatus.test.ts`
  are deliberately thenable (`then: vi.fn()`, never resolves) so a regression hangs the tests.
- `isExactNotification` defaults to **true** in the plugin, and on Android 12+ without the permission it opens the
  «Alarms & reminders» screen instead of scheduling. Always pass it explicitly, and only `true` after a fresh
  `checkExactNotificationSetting()`.
- A notification channel's importance is fixed at creation; changing `HIGH_IMPORTANCE` later does nothing for phones that
  already have the channel (they would need a new channel id).
- `schedule()` on Android 13+ requests `POST_NOTIFICATIONS` when it is missing — so the reconcile checks
  `checkPermissions()` first and does nothing unless it is `granted`.
- `getPending()` returns the plugin's *stored* notifications, not the live alarms, so it cannot tell that Android dropped
  the alarms; the reconcile therefore always re-schedules everything wanted instead of diffing.
- Android caps an app at 500 pending alarms and throws past that; the reconcile keeps the soonest 100.
- Reminders created from the **widget** are only written when the app next opens (the widget queues them, see
  `src/local/widgetQueue.ts`), so they cannot ring before then. Closing that gap needs the widget's own Java to schedule an
  alarm, which in turn needs the day/time resolution (`resolveDaySignal`) ported to Java. Not done.
- The Java bridge and the manifest changes are only ever compiled by CI (the master push's «Build the debug APK» step);
  there is no JDK on the development machine.

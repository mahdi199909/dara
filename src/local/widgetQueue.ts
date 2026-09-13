// Consumes captures (and habit check-in toggles) queued by the Android home-screen widgets —
// see android/app/src/main/java/ir/mganic/dara/QuickCaptureActivity.java and
// HabitsWidgetProvider.java — that native code never touches the app's own SQLite file directly
// (a concurrent write there could be silently overwritten by this app's own in-memory database
// the next time it saves), so it hands off through @capacitor/preferences instead. This drains
// those hand-off queues into real rows using the same repository functions the rest of the app
// already relies on.
//
// Called once at native bootstrap (src/components/native/FirstRunGate.tsx) and again on every
// app resume (src/components/native/WidgetQueueDrainer.tsx) — an action made while the app
// wasn't running only becomes visible the next time either of those fires, not the instant the
// widget is used. (HabitsWidgetProvider papers over that gap on its own side with an optimistic
// SharedPreferences overlay it reads back from this same queue's storage — see that class's doc
// comment — so the checkbox itself doesn't wait for a drain to look right.)
import { Preferences } from "@capacitor/preferences";
import type { LocalDb } from "./db";
import { createActivity } from "./repositories/activities";
import { addManualTimeEntry } from "./activityService";
import { toggleHabitCheckIn } from "./repositories/habits";

const QUEUE_KEY = "widget_pending_captures";
// Kept as a separate key rather than folded into QUEUE_KEY above so the existing capture entry
// shape/detection (isQueuedCapture, purely structural, no discriminator field) never has to
// change to accommodate a second entry kind — see HabitsWidgetProvider.java's own read of this
// same key for the native-side half of this contract.
const HABIT_CHECKIN_QUEUE_KEY = "widget_pending_habit_checkins";

// Purely informational provenance — no drain behavior branches on it today. Optional so every
// entry queued by the native code before this field existed (structural detection, no
// discriminator — see the const above) still validates and drains exactly as before; a future
// notification-action entry (see NotificationActionReceiver, not yet built) is the first producer
// of "notification", but the shape is ready for it now rather than needing a second migration.
type QueueEntrySource = "widget" | "notification";

function isValidSource(v: unknown): v is QueueEntrySource | undefined {
  return v === undefined || v === "widget" || v === "notification";
}

interface QueuedCapture {
  title: string;
  categoryId: string | null;
  durationMinutes: number;
  startedAt: string;
  source?: QueueEntrySource;
}

function isQueuedCapture(v: unknown): v is QueuedCapture {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as QueuedCapture).title === "string" &&
    typeof (v as QueuedCapture).durationMinutes === "number" &&
    typeof (v as QueuedCapture).startedAt === "string" &&
    isValidSource((v as QueuedCapture).source)
  );
}

// `date` is the ISO string of the device's local midnight for the day the checkbox was tapped
// (not necessarily "today" at drain time — see HabitsWidgetProvider.todayIsoUtc()), so a toggle
// queued right before midnight and drained after it still lands on the day the user actually
// meant.
interface QueuedHabitCheckIn {
  habitId: string;
  date: string;
  source?: QueueEntrySource;
}

function isQueuedHabitCheckIn(v: unknown): v is QueuedHabitCheckIn {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as QueuedHabitCheckIn).habitId === "string" &&
    typeof (v as QueuedHabitCheckIn).date === "string" &&
    isValidSource((v as QueuedHabitCheckIn).source)
  );
}

async function drainCaptureQueue(db: LocalDb, userId: string): Promise<number> {
  const { value } = await Preferences.get({ key: QUEUE_KEY });
  if (!value) return 0;

  let entries: unknown[];
  try {
    entries = JSON.parse(value);
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }

  const valid = entries.filter(isQueuedCapture);
  let applied = 0;
  // Entries that fail stay queued for the next drain instead of being wiped along with the
  // ones that succeeded — this used to unconditionally clear the whole queue after the loop, so
  // a single throwing entry (the native widget already shows "ثبت شد" before this ever runs, so
  // the user has no other signal anything went wrong) silently and PERMANENTLY lost that capture,
  // with no log line anywhere. Retrying forever on every app open/resume is the safer failure
  // mode here — a capture that never manages to apply just sits harmlessly in the queue instead
  // of vanishing.
  const failed: unknown[] = [];
  for (const entry of valid) {
    try {
      const activity = createActivity(db, userId, {
        title: entry.title,
        categoryId: entry.categoryId ?? undefined,
      });
      addManualTimeEntry(db, activity.id, {
        startAt: new Date(entry.startedAt),
        durationMin: entry.durationMinutes,
      });
      applied++;
    } catch (err) {
      console.error("drainCaptureQueue: failed to apply a queued widget capture, will retry next drain", entry, err);
      failed.push(entry);
    }
  }

  if (failed.length > 0) {
    await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(failed) });
  } else {
    await Preferences.remove({ key: QUEUE_KEY });
  }
  return applied;
}

// Each queued entry is replayed as a plain toggle (the same call the in-app checklist UI makes),
// in order — not "set final state to checked/unchecked". That's deliberate: it means an even
// number of taps on the same habit+day (check, uncheck, check, uncheck...) drains back to
// exactly its original state and an odd number flips it exactly once, with no need for the
// widget to precompute or agree on a "final" intended state up front. It also means a habit
// deleted from the dedicated /habits page while the app was closed can't crash the drain — a
// missing habit just makes that one toggleHabitCheckIn call throw, which is caught and skipped.
async function drainHabitCheckInQueue(db: LocalDb, userId: string): Promise<number> {
  const { value } = await Preferences.get({ key: HABIT_CHECKIN_QUEUE_KEY });
  if (!value) return 0;

  let entries: unknown[];
  try {
    entries = JSON.parse(value);
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }

  const valid = entries.filter(isQueuedHabitCheckIn);
  let applied = 0;
  // Same fix as drainCaptureQueue above — keep failed entries queued for retry instead of
  // wiping them along with the ones that succeeded.
  const failed: unknown[] = [];
  for (const entry of valid) {
    try {
      toggleHabitCheckIn(db, userId, entry.habitId, { date: entry.date });
      applied++;
    } catch (err) {
      console.error("drainHabitCheckInQueue: failed to apply a queued habit toggle, will retry next drain", entry, err);
      failed.push(entry);
    }
  }

  if (failed.length > 0) {
    await Preferences.set({ key: HABIT_CHECKIN_QUEUE_KEY, value: JSON.stringify(failed) });
  } else {
    await Preferences.remove({ key: HABIT_CHECKIN_QUEUE_KEY });
  }
  return applied;
}

export async function drainWidgetQueue(db: LocalDb, userId: string): Promise<number> {
  const capturesDrained = await drainCaptureQueue(db, userId);
  const checkInsDrained = await drainHabitCheckInQueue(db, userId);
  return capturesDrained + checkInsDrained;
}

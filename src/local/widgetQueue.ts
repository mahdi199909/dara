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
import { withLocalTransaction } from "./transaction";
import { getLogger } from "../lib/observability";
import { ApiError } from "../lib/apiErrorBase";
import { dispatchLocalOn } from "../lib/localDispatcher";
import { intentFromSignals, parseCaptureIntent } from "../lib/captureIntent";
import { loadSnapshotSync, resolveCapture, snapshotNeeds, type CaptureResolution } from "../lib/captureResolve";
import { runStepsSync, type CaptureCall } from "../lib/captureSteps";
import { captureSignalsSchema } from "../lib/captureSignalsSchema";
import type { CaptureSignals } from "../lib/captureSignals";

const log = getLogger("widgets", "queue");

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
  /** Toman — a direct cost to attach to the same Activity (see createActivity's own directCost
   * field, which already syncs a linked EXPENSE Transaction via syncActivityDirectCostTransaction
   * — nothing extra needed here beyond passing it through). Optional field added after the
   * original queue shape shipped, so an older-APK entry simply won't have it — undefined and null
   * both mean "no amount named", same as categoryId's own null. */
  amount?: number | null;
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
    isValidSource((v as QueuedCapture).source) &&
    ((v as QueuedCapture).amount === undefined || (v as QueuedCapture).amount === null || typeof (v as QueuedCapture).amount === "number")
  );
}

// What the widget's own parser (QuickTextParser.java, a port of src/lib/captureSignals.ts) understood
// of a typed line, sent as the signals themselves plus the line as typed. The signals are what the person
// confirmed in the widget's preview, so they are what gets saved; the line is only there so that
// something the signals point at that no longer exists (a habit that was deleted since) can still be
// kept as a plain entry instead of being lost. `startedAt` is when it was typed: «فردا» means the day
// after THAT, however long the app took to open.
interface QueuedSignalsCapture {
  v: 2;
  text: string;
  signals: CaptureSignals;
  startedAt: string;
  source?: QueueEntrySource;
}

function readSignalsCapture(v: unknown): QueuedSignalsCapture | null {
  if (!v || typeof v !== "object") return null;
  const entry = v as { v?: unknown; text?: unknown; signals?: unknown; startedAt?: unknown; source?: unknown };
  if (entry.v !== 2 || typeof entry.startedAt !== "string" || Number.isNaN(new Date(entry.startedAt).getTime()) || !isValidSource(entry.source)) return null;
  const signals = captureSignalsSchema.safeParse(entry.signals);
  if (!signals.success) return null;
  return { v: 2, text: typeof entry.text === "string" ? entry.text : "", signals: signals.data, startedAt: entry.startedAt, source: entry.source };
}

/** Carries out one line the widget understood — exactly as the app's own «ثبت...» field would after تأیید. */
function applySignalsCapture(db: LocalDb, userId: string, entry: QueuedSignalsCapture): { fellBack: boolean } {
  const now = new Date(entry.startedAt);
  const exec = (call: CaptureCall) => {
    const res = dispatchLocalOn(db, userId, call.method, call.url, call.body);
    if (res.status >= 400) throw new ApiError((res.json as { error?: string }).error ?? "خطایی رخ داد.", res.status);
    return res.json;
  };
  const resolve = (intent: ReturnType<typeof intentFromSignals>): CaptureResolution =>
    // The person already looked at this in the widget: it is saved, not argued with (no overlap refusal).
    resolveCapture(intent, loadSnapshotSync(snapshotNeeds(intent), (url) => exec({ method: "GET", url })), now, { allowOverlap: true });

  const asEntry = () => resolve(parseCaptureIntent(entry.text || entry.signals.title, now, { forceEntry: true }));

  let resolution = resolve(intentFromSignals(entry.signals, now));
  let fellBack = false;
  if (resolution.problem) {
    // It named something that is not there (a habit, a plan, a category): keep what was typed as a plain entry.
    resolution = asEntry();
    fellBack = true;
  }

  try {
    withLocalTransaction(db, () => runStepsSync(resolution.steps, exec));
  } catch (err) {
    // A line the app itself refuses (a validation error, never a fault in the database) would fail the same
    // way on every retry and hold up the queue forever — keep it as a plain entry instead.
    if (fellBack || !(err instanceof ApiError) || err.status >= 500) throw err;
    withLocalTransaction(db, () => runStepsSync(asEntry().steps, exec));
    fellBack = true;
  }
  return { fellBack };
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

  const valid = entries.filter((entry) => readSignalsCapture(entry) !== null || isQueuedCapture(entry));
  // The native half (the widget's own Java code) cannot write to the app's log; this is where its actions first become visible.
  if (valid.length > 0) log.debug("WIDGET_ACTION_RECEIVED", { layer: "local", queue: "capture", count: valid.length, malformed: entries.length - valid.length });
  let applied = 0;
  let keptAsEntry = 0;
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
      const signalsEntry = readSignalsCapture(entry);
      if (signalsEntry) {
        if (applySignalsCapture(db, userId, signalsEntry).fellBack) keptAsEntry++;
        applied++;
        continue;
      }

      // An entry from before the widget sent signals: a title, a duration and maybe an amount, saved
      // as an Activity — the way it has always been.
      const capture = entry as QueuedCapture;
      // The activity, its time and its direct cost are one step. Were a later part to fail after
      // the activity was written, the entry would stay queued (see above) and every retry would
      // add one more activity. (No operation name: the failure is reported below as
      // WIDGET_QUEUE_FAILED, which says what happens to the entry next.)
      withLocalTransaction(db, () => {
        // createActivity's own directCost handling already syncs a linked EXPENSE Transaction
        // (see local/repositories/activities.ts) — passing the amount through is the whole job.
        const activity = createActivity(db, userId, {
          title: capture.title,
          categoryId: capture.categoryId ?? undefined,
          directCost: capture.amount ?? undefined,
        });
        // A pure-expense capture (amount named, no duration) has nothing to time-log — durationMinutes
        // is 0 for exactly that case (see QuickCaptureActivity's own default logic), never a
        // fabricated entry for time that was never claimed to have been spent.
        if (capture.durationMinutes > 0) {
          addManualTimeEntry(db, activity.id, {
            startAt: new Date(capture.startedAt),
            durationMin: capture.durationMinutes,
          });
        }
      });
      applied++;
    } catch (err) {
      // The entry (what the person typed into the widget) is deliberately NOT logged.
      log.error("WIDGET_QUEUE_FAILED", { error: err, errorCode: "WIDGET-001", layer: "local", queue: "capture", willRetry: true });
      failed.push(entry);
    }
  }

  if (failed.length > 0) {
    await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(failed) });
  } else {
    await Preferences.remove({ key: QUEUE_KEY });
  }
  if (valid.length > 0) log.debug("WIDGET_QUEUE_PROCESSED", { layer: "local", queue: "capture", applied, failed: failed.length, keptAsEntry });
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
  if (valid.length > 0) log.debug("WIDGET_ACTION_RECEIVED", { layer: "local", queue: "habit_checkin", count: valid.length, malformed: entries.length - valid.length });
  let applied = 0;
  // Same fix as drainCaptureQueue above — keep failed entries queued for retry instead of
  // wiping them along with the ones that succeeded.
  const failed: unknown[] = [];
  for (const entry of valid) {
    try {
      // The check-in, the virtual asset it earns and its history entry are one step.
      withLocalTransaction(db, () => toggleHabitCheckIn(db, userId, entry.habitId, { date: entry.date }));
      applied++;
    } catch (err) {
      log.error("WIDGET_QUEUE_FAILED", { error: err, errorCode: "WIDGET-001", layer: "local", queue: "habit_checkin", entityType: "habit", entityId: entry.habitId, willRetry: true });
      failed.push(entry);
    }
  }

  if (failed.length > 0) {
    await Preferences.set({ key: HABIT_CHECKIN_QUEUE_KEY, value: JSON.stringify(failed) });
  } else {
    await Preferences.remove({ key: HABIT_CHECKIN_QUEUE_KEY });
  }
  if (valid.length > 0) log.debug("WIDGET_QUEUE_PROCESSED", { layer: "local", queue: "habit_checkin", applied, failed: failed.length });
  return applied;
}

export async function drainWidgetQueue(db: LocalDb, userId: string): Promise<number> {
  const capturesDrained = await drainCaptureQueue(db, userId);
  const checkInsDrained = await drainHabitCheckInQueue(db, userId);
  return capturesDrained + checkInsDrained;
}

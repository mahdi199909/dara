// Consumes captures queued by the Android home-screen widget (see
// android/app/src/main/java/ir/mganic/dara/QuickCaptureActivity.java) — that native code never
// touches the app's own SQLite file directly (a concurrent write there could be silently
// overwritten by this app's own in-memory database the next time it saves), so it hands off
// through @capacitor/preferences instead. This drains that hand-off queue into real Activity +
// TimeEntry rows using the same repository functions the rest of the app already relies on.
//
// Called once at native bootstrap (src/components/native/FirstRunGate.tsx) and again on every
// app resume (src/components/native/WidgetQueueDrainer.tsx) — a capture made while the app
// wasn't running only becomes visible the next time either of those fires, not the instant the
// widget is used.
import { Preferences } from "@capacitor/preferences";
import type { LocalDb } from "./db";
import { createActivity } from "./repositories/activities";
import { addManualTimeEntry } from "./activityService";

const QUEUE_KEY = "widget_pending_captures";

interface QueuedCapture {
  title: string;
  categoryId: string | null;
  durationMinutes: number;
  startedAt: string;
}

function isQueuedCapture(v: unknown): v is QueuedCapture {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as QueuedCapture).title === "string" &&
    typeof (v as QueuedCapture).durationMinutes === "number" &&
    typeof (v as QueuedCapture).startedAt === "string"
  );
}

export async function drainWidgetQueue(db: LocalDb, userId: string): Promise<number> {
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
  for (const entry of valid) {
    const activity = createActivity(db, userId, {
      title: entry.title,
      categoryId: entry.categoryId ?? undefined,
    });
    addManualTimeEntry(db, activity.id, {
      startAt: new Date(entry.startedAt),
      durationMin: entry.durationMinutes,
    });
  }

  await Preferences.remove({ key: QUEUE_KEY });
  return valid.length;
}

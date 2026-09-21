// When background syncs happen, beyond the ones tied to opening/resuming the app (see
// FirstRunGate.tsx and WidgetQueueDrainer.tsx). Without these, a task added on the phone reached
// the web only the next time the app was reopened, and a change made on the web never appeared
// on a phone that simply stayed open — which reads as "sync doesn't work".
//
//  - noteLocalWrite(): called by apiClient.ts after every successful local write. Debounced, so a
//    burst of edits (typing into a form, ticking several habits) becomes one sync a few seconds
//    after the last change instead of one per keystroke.
//  - startForegroundPolling(): while the app is on screen, pull remote changes every so often.
//
// Both go through syncWithServer, which is single-flight (a request that arrives mid-sync just
// queues one more run), and refresh the on-screen data whenever a sync brought something in.
import { mutate } from "swr";
import { getLogger } from "./observability";

const log = getLogger("sync", "scheduler");

const DEBOUNCE_MS = 3_000;
const POLL_INTERVAL_MS = 45_000;

function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function backgroundSync(trigger: "local-write" | "poll"): Promise<void> {
  try {
    const { syncWithServer } = await import("./nativeOnboarding");
    const outcome = await syncWithServer({ trigger });
    if (outcome.pulledCount > 0 || outcome.deletionsPulled > 0) mutate(() => true, undefined, { revalidate: true });
  } catch (err) {
    // syncWithServer never throws by design; this only catches something unexpected around it.
    log.error("SYNC_FAILED", { error: err, errorCode: "SYNC-009", layer: "local", trigger });
  }
}

let pendingWrites = 0;

export function noteLocalWrite(): void {
  if (!isNativePlatform()) return;
  pendingWrites++;
  // A write is waiting for the next sync: the phone-side half of "the expense is on the phone but not on the web" (scenario: offline).
  log.debug("SYNC_PENDING", { layer: "local", syncStatus: "PENDING", pendingWrites, debounceMs: DEBOUNCE_MS });
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    pendingWrites = 0;
    void backgroundSync("local-write");
  }, DEBOUNCE_MS);
}

/** Returns a stop function. Only ticks while the page is visible (a backgrounded app has its own
 * resume-triggered sync, and shouldn't wake the radio every 45 s for nothing). */
export function startForegroundPolling(): () => void {
  if (!isNativePlatform()) return () => {};
  const id = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void backgroundSync("poll");
  }, POLL_INTERVAL_MS);
  return () => clearInterval(id);
}

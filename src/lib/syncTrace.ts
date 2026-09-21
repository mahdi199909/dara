// The identity of one sync cycle. Every record the phone writes while a cycle runs carries its sync id, and the same
// id (with a W3C trace id and the device id) goes to the server as headers, so the server's records for the requests
// of that cycle can be found with the very same value — see remoteFetch.ts and doc/logging/sync.md.
import { newId, newTraceId } from "./observability";

/** Why a cycle started. Routine background triggers log at DEBUG; the ones a person can see log at INFO. */
export type SyncTrigger = "boot" | "resume" | "first-run" | "manual" | "logout" | "local-write" | "poll" | "unknown";

const ROUTINE: ReadonlySet<SyncTrigger> = new Set<SyncTrigger>(["local-write", "poll"]);

export interface SyncTrace {
  /** sync_<ULID> — the id of this cycle. */
  syncId: string;
  /** One W3C trace per cycle: every request of the cycle is a span of it. */
  traceId: string;
  trigger: SyncTrigger;
  deep: boolean;
}

export function createSyncTrace(options: { trigger?: SyncTrigger; deep?: boolean } = {}): SyncTrace {
  return { syncId: newId("sync"), traceId: newTraceId(), trigger: options.trigger ?? "unknown", deep: options.deep ?? false };
}

/** A cycle started by the timer or by a background write says little on its own; one the person started or opened the app for does. */
export function isRoutineTrigger(trigger: SyncTrigger): boolean {
  return ROUTINE.has(trigger);
}

/**
 * When several callers ask for a sync while one is running they share one more run; it keeps the trigger that says
 * the most (an app open beats a timer tick).
 */
export function moreInformativeTrigger(current: SyncTrigger | undefined, requested: SyncTrigger | undefined): SyncTrigger | undefined {
  if (!requested) return current;
  if (!current) return requested;
  if (isRoutineTrigger(current) && !isRoutineTrigger(requested)) return requested;
  return current;
}

// A tiny observable holding "is a sync running right now, and how did the last one go" so the UI
// (Settings' sync card, and anything else that wants a status dot) can show it live without
// polling. Module-level state is fine here: there is exactly one sync engine per app instance.
import type { SyncOutcome } from "@/local/syncRunner";

export interface SyncStatusSnapshot {
  syncing: boolean;
  last: SyncOutcome | null;
}

let snapshot: SyncStatusSnapshot = { syncing: false, last: null };
const listeners = new Set<() => void>();

export function getSyncStatus(): SyncStatusSnapshot {
  return snapshot;
}

export function updateSyncStatus(patch: Partial<SyncStatusSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

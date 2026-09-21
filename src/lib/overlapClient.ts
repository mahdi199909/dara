// The client's reading of a refused save: the server (or the phone's own routes) answers 409 with the
// code TASK-002 and the entries the time collides with — see src/lib/timeOverlap.ts.
import { ApiClientError } from "./apiClient";
import type { OverlapConflict } from "./timeOverlap";

export const TIME_OVERLAP_CODE = "TASK-002";

export interface OverlapRefusal {
  message: string;
  conflicts: OverlapConflict[];
}

/** The collision a failed save reports, or null when the failure was something else. */
export function overlapRefusal(err: unknown): OverlapRefusal | null {
  if (!(err instanceof ApiClientError) || err.code !== TIME_OVERLAP_CODE) return null;
  const details = err.details as { conflicts?: OverlapConflict[] } | undefined;
  return { message: err.message, conflicts: details?.conflicts ?? [] };
}

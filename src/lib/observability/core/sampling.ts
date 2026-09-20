// Sampling: thin out only what is safe to lose. ERROR and above, every security event, every audit
// entry and every sync failure (anything the registry marks `protected`) is ALWAYS kept. Only DEBUG,
// TRACE and events flagged high-volume can be sampled — and the decision is made per request/trace,
// so a request's records are either all kept or all dropped together instead of leaving holes.
import { LEVEL_VALUE, type Level } from "./levels";

export interface SamplingConfig {
  /** Fraction (0..1) of DEBUG records kept. */
  debug: number;
  /** Fraction of TRACE records kept. */
  trace: number;
  /** Fraction of INFO records kept when the event is flagged high-volume (HTTP_REQUEST_COMPLETED…). */
  highVolumeInfo: number;
}

export const DEFAULT_SAMPLING: SamplingConfig = { debug: 1, trace: 1, highVolumeInfo: 1 };

/** FNV-1a 32-bit hash mapped to [0, 1): stable for one key, evenly spread across keys. */
export function hashToUnit(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x100000000;
}

export interface SamplingInput {
  level: Level;
  /** True for ERROR+, security, audit and sync-failure events. */
  protected: boolean;
  highVolume: boolean;
  /** request_id / trace_id / sync_id — the unit that is kept or dropped as a whole. */
  correlationKey?: string;
}

export function shouldKeep(input: SamplingInput, config: SamplingConfig, random: () => number = Math.random): boolean {
  if (input.protected || LEVEL_VALUE[input.level] >= LEVEL_VALUE.WARN) return true;

  let rate = 1;
  if (input.level === "TRACE") rate = config.trace;
  else if (input.level === "DEBUG") rate = config.debug;
  else if (input.level === "INFO" && input.highVolume) rate = config.highVolumeInfo;

  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const draw = input.correlationKey ? hashToUnit(input.correlationKey) : random();
  return draw < rate;
}

// Changing what the server logs while it runs — no deployment, no restart (the "dynamic debugging" of the logging
// specification): turn SYNC up to DEBUG for twenty minutes while FINANCE stays at INFO, or trace one person's requests.
// The mechanism is the LevelController; this is the owner-facing layer on top of it and its rules:
//
//   - a verbose setting (TRACE / DEBUG) must expire — 30 minutes unless another time is asked, at most 24 hours — so
//     that "I turned it up to look at something" cannot become "the disk is full and everyone's activity is in the log";
//   - a quieter setting (INFO and above) may be permanent until the next restart;
//   - everything can be put back to what the environment configured (LOG_LEVEL, LOG_LEVEL_OVERRIDES) in one step.
//
// The route (src/app/api/admin/logging/route.ts) checks that the caller is the owner and writes the audit entry; this
// file holds no request handling, so it is testable on its own.
import { LEVEL_VALUE, type Level } from "../core/levels";
import type { LevelEntries } from "../core/levelControl";
import type { LoggerCore } from "../core/logger";
import { getLogger, getRootCore } from "../root";

export const DEFAULT_TTL_MINUTES = 30;
export const MAX_TTL_MINUTES = 24 * 60;
const MINUTE_MS = 60_000;

const log = getLogger(null, "admin");

export type LoggingChange =
  | { kind: "base"; level: Level; ttlMinutes?: number }
  | { kind: "scope"; key: string; level: Level; ttlMinutes?: number }
  | { kind: "user"; userId: string; level: Level; ttlMinutes?: number }
  | { kind: "clear-scope"; key: string }
  | { kind: "clear-user"; userId: string }
  | { kind: "reset" };

export interface LoggingState {
  base: Level;
  /** What the environment set at startup (LOG_LEVEL): where "reset" goes back to. */
  configuredBase: Level;
  /** Until when the base level holds, when it was changed for a limited time. */
  baseExpiresAt: string | null;
  overrides: Array<{ scope: string; level: Level; expiresAt: string | null; /** True for a rule LOG_LEVEL_OVERRIDES set. */ configured: boolean }>;
  users: Array<{ userId: string; level: Level; expiresAt: string | null }>;
}

interface Baseline {
  base: Level;
  overrides: Record<string, Level>;
}

interface AdminState {
  baseline: Baseline | null;
  baseTimer: ReturnType<typeof setTimeout> | null;
  baseExpiresAt: number | null;
}

const HOLDER = Symbol.for("parva.observability.adminLogging.v1");

function state(): AdminState {
  const holder = globalThis as unknown as Record<symbol, AdminState | undefined>;
  return (holder[HOLDER] ??= { baseline: null, baseTimer: null, baseExpiresAt: null });
}

function isVerbose(level: Level): boolean {
  return LEVEL_VALUE[level] <= LEVEL_VALUE.DEBUG;
}

/**
 * How long a change lasts: a verbose level always has an end (the default when none was asked, never beyond the
 * maximum); a quiet one only when the caller wanted it to. Returns minutes, or null for "until cleared or restarted".
 */
export function resolveTtlMinutes(level: Level, requested: number | undefined): number | null {
  const asked = requested !== undefined && Number.isFinite(requested) && requested > 0 ? Math.min(Math.ceil(requested), MAX_TTL_MINUTES) : undefined;
  if (asked !== undefined) return asked;
  return isVerbose(level) ? DEFAULT_TTL_MINUTES : null;
}

/**
 * Remembers what the environment configured, so that "reset" has somewhere to go back to. Called once at startup;
 * also taken lazily on first use — nothing changes levels before this API does.
 */
export function rememberConfiguredLevels(core: LoggerCore = getRootCore()): void {
  const current = state();
  if (current.baseline) return;
  const entries = core.levels.entries();
  current.baseline = { base: entries.base, overrides: Object.fromEntries(entries.overrides.filter((rule) => rule.expiresAt === null).map((rule) => [rule.key, rule.level])) };
}

/** Forgets the baseline and any pending revert (tests). */
export function resetAdminLogging(): void {
  const current = state();
  if (current.baseTimer) clearTimeout(current.baseTimer);
  delete (globalThis as unknown as Record<symbol, AdminState | undefined>)[HOLDER];
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function describeLogging(core: LoggerCore = getRootCore()): LoggingState {
  rememberConfiguredLevels(core);
  const current = state();
  const entries: LevelEntries = core.levels.entries();
  const configured = current.baseline!;
  return {
    base: entries.base,
    configuredBase: configured.base,
    baseExpiresAt: iso(current.baseExpiresAt),
    overrides: entries.overrides.map((rule) => ({ scope: rule.key, level: rule.level, expiresAt: iso(rule.expiresAt), configured: rule.expiresAt === null && configured.overrides[rule.key] === rule.level })),
    users: entries.users.map((rule) => ({ userId: rule.userId, level: rule.level, expiresAt: iso(rule.expiresAt) })),
  };
}

function cancelBaseTimer(): void {
  const current = state();
  if (current.baseTimer) clearTimeout(current.baseTimer);
  current.baseTimer = null;
  current.baseExpiresAt = null;
}

function setBase(core: LoggerCore, level: Level, ttlMinutes: number | null): void {
  const current = state();
  cancelBaseTimer();
  core.levels.setBase(level);
  if (ttlMinutes !== null && level !== current.baseline!.base) {
    current.baseExpiresAt = Date.now() + ttlMinutes * MINUTE_MS;
    current.baseTimer = setTimeout(() => {
      current.baseTimer = null;
      current.baseExpiresAt = null;
      core.levels.setBase(current.baseline!.base);
      log.info("LOG_LEVEL_CHANGED", { scope: "base", level: current.baseline!.base, reason: "expired", source: "admin" });
    }, ttlMinutes * MINUTE_MS);
    (current.baseTimer as { unref?: () => void }).unref?.(); // a pending revert must never keep the process alive
  }
}

export interface AppliedChange {
  before: LoggingState;
  after: LoggingState;
  /** What was asked for and how long it will last, for the audit entry. Never a person's details beyond an opaque id. */
  summary: { kind: LoggingChange["kind"]; scope?: string; level?: Level; ttlMinutes: number | null; userId?: string };
}

/** Applies one change to `core` and reports what the levels were and became. */
export function applyLoggingChange(change: LoggingChange, core: LoggerCore = getRootCore()): AppliedChange {
  const before = describeLogging(core);
  const baseline = state().baseline!;
  let summary: AppliedChange["summary"];

  switch (change.kind) {
    case "base": {
      const ttlMinutes = resolveTtlMinutes(change.level, change.ttlMinutes);
      setBase(core, change.level, ttlMinutes);
      summary = { kind: "base", scope: "base", level: change.level, ttlMinutes };
      break;
    }
    case "scope": {
      const ttlMinutes = resolveTtlMinutes(change.level, change.ttlMinutes);
      core.levels.setOverride(change.key, change.level, ttlMinutes === null ? undefined : ttlMinutes * MINUTE_MS);
      summary = { kind: "scope", scope: change.key.toUpperCase(), level: change.level, ttlMinutes };
      break;
    }
    case "user": {
      const ttlMinutes = resolveTtlMinutes(change.level, change.ttlMinutes);
      core.levels.setUserOverride(change.userId, change.level, ttlMinutes === null ? undefined : ttlMinutes * MINUTE_MS);
      summary = { kind: "user", scope: "user", level: change.level, ttlMinutes, userId: change.userId };
      break;
    }
    case "clear-scope": {
      const key = change.key.toUpperCase();
      const configured = baseline.overrides[key];
      // A rule the environment configured goes back to its configured level; one added at runtime is removed.
      if (configured) core.levels.setOverride(key, configured);
      else core.levels.clearOverride(key);
      summary = { kind: "clear-scope", scope: key, level: configured, ttlMinutes: null };
      break;
    }
    case "clear-user": {
      core.levels.clearUserOverride(change.userId);
      summary = { kind: "clear-user", scope: "user", ttlMinutes: null, userId: change.userId };
      break;
    }
    case "reset": {
      cancelBaseTimer();
      const now = core.levels.entries();
      for (const rule of now.overrides) core.levels.clearOverride(rule.key);
      for (const rule of now.users) core.levels.clearUserOverride(rule.userId);
      for (const [key, level] of Object.entries(baseline.overrides)) core.levels.setOverride(key, level);
      core.levels.setBase(baseline.base);
      summary = { kind: "reset", scope: "all", level: baseline.base, ttlMinutes: null };
      break;
    }
  }

  const after = describeLogging(core);
  // Written after the change, so a change that turns things up is itself recorded at the new level. (A change that
  // silences INFO drops this line, which is why the route also writes the durable audit entry.)
  log.info("LOG_LEVEL_CHANGED", { scope: summary.scope, level: summary.level ?? "default", ttlMinutes: summary.ttlMinutes, action: change.kind, source: "admin" });
  return { before, after, summary };
}

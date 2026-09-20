// How an audit entry describes a change: the field-level difference between the state before and after
// (never a whole object where a difference will do), and how money is treated in it.
//
// An audit entry is the person's own history and lives in the same database as the data it describes,
// so by default it keeps real values — masking a task's amount in a row that sits next to the
// transaction holding that amount would protect nothing, and a masked value can never be un-masked
// later. AUDIT_MONEY_MODE (server) can switch to "redacted" (from/to become [REDACTED_MONEY]) or
// "flag" (only "this field changed"); the snapshots stored beside the diff are masked the same way,
// so one setting means one thing. Application logs are a different layer and always mask money.
//
// Pure and isomorphic: the server's writer and the phone's writer share it.
import { computeChanges, type Changes, type MoneyMode } from "./diff";
import { REDACTED_MONEY, classifyKey } from "./redact";

export type AuditMoneyMode = MoneyMode;
export type AuditChanges = Changes;

/** Above this the stored diff is reduced to the list of changed fields (a note pasted whole is not a diff worth keeping twice). */
export const MAX_CHANGES_CHARS = 16_000;

export function parseAuditMoneyMode(value: string | undefined | null): AuditMoneyMode {
  const mode = value?.trim().toLowerCase();
  return mode === "redacted" || mode === "flag" ? mode : "values";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * The difference between two states of one entity, or null when either side is not a plain record (a
 * creation or a deletion has no "before"/"after" pair — the snapshot beside it says everything).
 * Money fields follow `mode`; fields that are secrets by name are only ever flagged as changed.
 */
export function buildAuditChanges(previous: unknown, next: unknown, mode: AuditMoneyMode = "values"): AuditChanges | null {
  if (!isPlainRecord(previous) || !isPlainRecord(next)) return null;
  const keys = Array.from(new Set([...Object.keys(previous), ...Object.keys(next)]));
  return computeChanges(
    previous,
    next,
    {
      money: keys.filter((key) => classifyKey(key) === "money"),
      flagOnly: keys.filter((key) => classifyKey(key) === "secret"),
    },
    mode
  );
}

/** The JSON stored in the `changes` column; null when there is no diff. Never throws. */
export function serializeChanges(changes: AuditChanges | null): string | null {
  if (!changes) return null;
  try {
    const text = JSON.stringify(changes);
    if (text.length <= MAX_CHANGES_CHARS) return text;
    return JSON.stringify({ changedFields: changes.changedFields, changes: {}, truncated: true });
  } catch {
    return JSON.stringify({ changedFields: changes.changedFields, changes: {}, truncated: true });
  }
}

/**
 * The stored snapshot (oldValue / newValue) with money fields masked when the mode asks for it — the
 * default ("values") returns it untouched. Walks plain objects and arrays; everything else is left as is.
 */
export function maskMoneyInSnapshot(value: unknown, mode: AuditMoneyMode): unknown {
  if (mode === "values") return value;
  return mask(value, 0);
}

function mask(value: unknown, depth: number): unknown {
  if (depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => mask(item, depth + 1));
  if (!isPlainRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = classifyKey(key) === "money" && item !== null && item !== undefined ? REDACTED_MONEY : mask(item, depth + 1);
  }
  return out;
}

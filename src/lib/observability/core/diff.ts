// The difference between two states of one entity — what an audit entry records instead of a whole
// snapshot of the object. Only the fields that actually changed, and for the ones that must not be
// readable in a log (money, secrets, user-authored text) only the fact that they changed, or a
// masked value, depending on the policy. Pure and side-effect free.
import { REDACTED_MONEY, redactValue } from "./redact";

/** How money fields are recorded: readable, masked, or reduced to "changed". */
export type MoneyMode = "values" | "redacted" | "flag";

export interface FieldPolicy {
  /** Compare only these fields (default: every field of either state). */
  include?: readonly string[];
  /** Never compare these. Default: id, userId, createdAt, updatedAt (bookkeeping, not changes). */
  exclude?: readonly string[];
  /** Fields holding money; see MoneyMode. */
  money?: readonly string[];
  /** Fields whose values must never be recorded, only that they changed. */
  flagOnly?: readonly string[];
}

export type FieldChange = { from: unknown; to: unknown } | { changed: true };
export interface Changes {
  changes: Record<string, FieldChange>;
  changedFields: string[];
}

export const DEFAULT_EXCLUDED_FIELDS: readonly string[] = ["id", "userId", "createdAt", "updatedAt"];

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null;
}

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

/** Structural equality for the value shapes a database row holds; null and undefined are the same "empty". */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (isEmpty(a) || isEmpty(b)) return false;
  const x = comparable(a);
  const y = comparable(b);
  if (typeof x !== "object" || typeof y !== "object") return Object.is(x, y);
  if (x === null || y === null) return x === y;
  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
    return x.every((item, i) => valuesEqual(item, y[i]));
  }
  const xk = Object.keys(x as object);
  const yk = Object.keys(y as object);
  if (xk.length !== yk.length) return false;
  return xk.every((key) => valuesEqual((x as Record<string, unknown>)[key], (y as Record<string, unknown>)[key]));
}

/**
 * Compares `previous` (null for a creation) with `next` (null for a deletion) field by field.
 * Values that are recorded pass through redactValue, so a secret or a stray token inside a value
 * can never reach an audit entry either.
 */
export function computeChanges(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
  policy: FieldPolicy = {},
  moneyMode: MoneyMode = "values"
): Changes {
  const before = previous ?? {};
  const after = next ?? {};
  const excluded = new Set(policy.exclude ?? DEFAULT_EXCLUDED_FIELDS);
  const money = new Set(policy.money ?? []);
  const flagOnly = new Set(policy.flagOnly ?? []);
  const candidates = policy.include ? [...policy.include] : Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));

  const changes: Record<string, FieldChange> = {};
  const changedFields: string[] = [];

  for (const field of candidates) {
    if (excluded.has(field)) continue;
    const from = before[field];
    const to = after[field];
    if (valuesEqual(from, to)) continue;
    changedFields.push(field);

    if (flagOnly.has(field) || (money.has(field) && moneyMode === "flag")) {
      changes[field] = { changed: true };
    } else if (money.has(field) && moneyMode === "redacted") {
      changes[field] = { from: isEmpty(from) ? null : REDACTED_MONEY, to: isEmpty(to) ? null : REDACTED_MONEY };
    } else {
      changes[field] = {
        from: isEmpty(from) ? null : redactValue(from, { moneyMode: "keep" }),
        to: isEmpty(to) ? null : redactValue(to, { moneyMode: "keep" }),
      };
    }
  }

  return { changes, changedFields };
}

// Pure value normalizers shared by the phone (before it pushes a row) and the server (before it
// hands a pushed row to Prisma) — see src/local/sync.ts and src/lib/syncCoercion.ts. Kept free of
// any Prisma/SQLite import so both sides can bundle it.

/** "2026-09-15 12:00:00" (SQLite's CURRENT_TIMESTAMP shape: space-separated, UTC, no zone marker),
 * a proper ISO string, a Date or an epoch number → canonical ISO string; anything Date can't
 * parse → null. */
export function toIsoDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value !== "string" || !value) return null;
  const spaced = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value);
  const d = new Date(spaced ? value.replace(" ", "T") + "Z" : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** SQLite hands booleans back as 0/1 — accept those (and their string spellings) as well as real booleans. */
export function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

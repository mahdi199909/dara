// Shared "fetch related rows by id, keyed for O(1) lookup" helper — the local equivalent of
// Prisma's `include`. Every repository that needs to attach a joined Category/Project/etc.
// onto a list of rows should use this instead of hand-rolling its own IN-query + Map each time.
import type { LocalDb } from "./db";

export function fetchByIds<T extends { id: string }>(db: LocalDb, table: string, ids: (string | null)[]): Map<string, T> {
  const unique = [...new Set(ids.filter((v): v is string => v !== null))];
  if (unique.length === 0) return new Map();
  const rows = db.all<T>(`SELECT * FROM "${table}" WHERE "id" IN (${unique.map(() => "?").join(",")})`, unique);
  return new Map(rows.map((r) => [r.id, r]));
}

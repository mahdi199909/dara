// Splits rows bound for /api/sync/push into requests that stay under the reverse proxy's body
// cap (nginx's default is 1 MB and answers a bare 413 beyond it). Shared by the phone's sync and
// the web app's backup import, which push through the same endpoint.
export type WireRow = Record<string, unknown>;

export interface Batch {
  tables: Record<string, WireRow[]>;
  bytes: number;
  rows: number;
}

/**
 * Packs rows into batches of at most `maxBytes` (JSON size) and `maxRows`, keeping the input's
 * table order and each table's row order — so a parent table's rows never land in a later request
 * than a child's. A single row bigger than the cap still gets a batch of its own.
 */
export function buildBatches(perTable: Array<{ table: string; rows: WireRow[] }>, maxBytes: number, maxRows: number): Batch[] {
  const encoder = new TextEncoder();
  const batches: Batch[] = [];
  let current: Batch = { tables: {}, bytes: 0, rows: 0 };
  for (const { table, rows } of perTable) {
    for (const row of rows) {
      const size = encoder.encode(JSON.stringify(row)).length + 2;
      if (current.rows > 0 && (current.bytes + size > maxBytes || current.rows + 1 > maxRows)) {
        batches.push(current);
        current = { tables: {}, bytes: 0, rows: 0 };
      }
      (current.tables[table] ??= []).push(row);
      current.bytes += size;
      current.rows++;
    }
  }
  if (current.rows > 0) batches.push(current);
  return batches;
}

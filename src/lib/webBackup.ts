// Backup / restore for the web app, in the SAME file format the Android app's backup uses
// (src/local/dataExport.ts), so a file from either can be restored on the other.
//
// Nothing here needs a server route of its own: exporting is a full pull (/api/sync/pull with no
// cursor — every row the account owns) and importing is a chunked push (/api/sync/push, the
// endpoint the phone syncs through). So a backup made on the web and one made on the phone
// describe the same rows the same way, and importing behaves exactly like a device that had been
// offline: rows the account already has at the same or a newer version are left alone, newer ones
// are taken, nothing is ever deleted.
import { DATA_EXPORT_VERSION, type DataExportFile } from "@/local/dataExport";
import { LOCAL_USER_ID } from "@/local/localUser";
import { SELF_REFERENCE_COLUMN, SYNC_TABLES } from "@/lib/syncTables";
import { buildBatches, type WireRow } from "@/lib/syncBatching";

/** The two calls this needs, injected so the same code runs against fetch (the browser) and against route handlers (tests). Both throw on a failed request. */
export interface BackupApi {
  get(url: string): Promise<any>;
  post(url: string, body: unknown): Promise<any>;
}

/** Talks to the app's own origin with the logged-in session cookie. */
export function browserBackupApi(): BackupApi {
  async function call(url: string, init?: RequestInit) {
    const res = await fetch(url, { credentials: "same-origin", ...init });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // not JSON — fall through to the status
    }
    if (!res.ok) {
      if (res.status === 413) throw new Error("حجم درخواست از حد مجاز سرور بیشتر بود.");
      throw new Error(json?.error ?? `درخواست ناموفق بود (کد ${res.status}).`);
    }
    return json;
  }
  return {
    get: (url) => call(url),
    post: (url, body) => call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  };
}

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

/**
 * Wraps the tables of a full pull as a backup file. Rows of tables that carry their own userId get
 * the placeholder owner id every phone backup uses (LOCAL_USER_ID): a phone restoring this file
 * compares rows against its own single local user, and the real server-side id would mean nothing
 * there (the server, in turn, overwrites it with the logged-in account's id on import).
 */
export function buildBackupFile(tables: Record<string, WireRow[]>, now: Date = new Date()): DataExportFile {
  const out: Record<string, WireRow[]> = {};
  for (const config of SYNC_TABLES) {
    const rows = tables[config.table] ?? [];
    out[config.table] = config.ownership.type === "direct" ? rows.map((row) => ({ ...row, userId: LOCAL_USER_ID })) : rows;
  }
  return { version: DATA_EXPORT_VERSION, exportedAt: now.toISOString(), tables: out };
}

/** Reads everything the account has from the server and returns it as a backup file. */
export async function exportServerBackup(api: BackupApi, now: Date = new Date()): Promise<DataExportFile> {
  const pull = await api.get("/api/sync/pull");
  return buildBackupFile(pull?.tables ?? {}, now);
}

/** "parva-backup-2026-09-19.json" */
export function backupFileName(now: Date = new Date()): string {
  return `parva-backup-${now.toISOString().slice(0, 10)}.json`;
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

/** The tables of a backup that a web import actually restores, with their row counts (a phone backup also carries its own User/Settings/notifications, which are not restored here). */
export function restorableCounts(tables: DataExportFile["tables"]): Array<{ table: string; count: number }> {
  const out: Array<{ table: string; count: number }> = [];
  for (const config of SYNC_TABLES) {
    const rows = tables[config.table];
    if (Array.isArray(rows) && rows.length > 0) out.push({ table: config.table, count: rows.length });
  }
  return out;
}

const CATEGORY_REFERENCE_COLUMNS = ["categoryId", "parentCategoryId"] as const;

/**
 * A backup made on a phone carries that phone's own copy of the default categories («کار»,
 * «ورزش»…) under different ids than the account's. Importing them as they are would leave every
 * default category twice. Instead a category the account doesn't have by id but does have by name
 * is dropped from the file and everything that pointed at it is re-pointed to the account's own —
 * the same rule the phone's own restore applies (src/local/dataExport.ts).
 */
export function remapDuplicateCategories(
  tables: Record<string, WireRow[]>,
  existing: ReadonlyArray<{ id: string; name: string }>
): { tables: Record<string, WireRow[]>; merged: number } {
  const existingIds = new Set(existing.map((c) => c.id));
  const idByName = new Map<string, string>();
  for (const c of existing) if (!idByName.has(c.name)) idByName.set(c.name, c.id);

  const remap = new Map<string, string>();
  const keptCategories = (tables.Category ?? []).filter((row) => {
    const id = String(row.id);
    if (existingIds.has(id)) return true; // the same category — the server merges it by id
    const name = String(row.name ?? "");
    const match = idByName.get(name);
    if (match) {
      remap.set(id, match);
      return false;
    }
    idByName.set(name, id); // also collapses a duplicate within the file itself
    return true;
  });
  if (remap.size === 0) return { tables, merged: 0 };

  const out: Record<string, WireRow[]> = {};
  for (const [table, rows] of Object.entries(tables)) {
    const source = table === "Category" ? keptCategories : rows;
    out[table] = source.map((row) => {
      let copy: WireRow | null = null;
      for (const column of CATEGORY_REFERENCE_COLUMNS) {
        const value = row[column];
        if (typeof value === "string" && remap.has(value)) (copy ??= { ...row })[column] = remap.get(value);
      }
      return copy ?? row;
    });
  }
  return { tables: out, merged: remap.size };
}

export interface WebImportResult {
  /** Rows the server stored (new, or a newer version of one it had), per table. */
  stored: Record<string, number>;
  /** Rows the server already had at the same or a newer version, or that were merged into an existing category. */
  unchanged: number;
  /** Rows the server refused, with the reason it gave. */
  rejected: Array<{ table: string; id: string; reason: string }>;
  requests: number;
}

export interface WebImportOptions {
  maxBatchBytes?: number;
  maxBatchRows?: number;
  onProgress?: (done: number, total: number) => void;
}

// Well under the reverse proxy's 1 MB request cap (see src/lib/syncBatching.ts).
const MAX_BATCH_BYTES = 300_000;
const MAX_BATCH_ROWS = 300;

/** Sends a parsed backup to the server through the sync endpoint, in several requests. */
export async function importBackupToServer(api: BackupApi, file: DataExportFile, options: WebImportOptions = {}): Promise<WebImportResult> {
  const existing: Array<{ id: string; name: string }> = (await api.get("/api/categories"))?.categories ?? [];
  const source: Record<string, WireRow[]> = {};
  for (const config of SYNC_TABLES) {
    const rows = file.tables[config.table];
    if (Array.isArray(rows) && rows.length > 0) source[config.table] = rows as WireRow[];
  }
  const { tables, merged } = remapDuplicateCategories(source, existing);

  const perTable: Array<{ table: string; rows: WireRow[] }> = [];
  for (const config of SYNC_TABLES) {
    const rows = tables[config.table];
    if (!rows || rows.length === 0) continue;
    // Parents first, so a child never lands in an earlier request than the row it points at.
    const selfRef = SELF_REFERENCE_COLUMN[config.table];
    const ordered = selfRef ? [...rows].sort((a, b) => Number(a[selfRef] != null) - Number(b[selfRef] != null)) : rows;
    perTable.push({ table: config.table, rows: ordered });
  }

  const batches = buildBatches(perTable, options.maxBatchBytes ?? MAX_BATCH_BYTES, options.maxBatchRows ?? MAX_BATCH_ROWS);
  const result: WebImportResult = { stored: {}, unchanged: merged, rejected: [], requests: batches.length };

  for (let i = 0; i < batches.length; i++) {
    options.onProgress?.(i, batches.length);
    const json = await api.post("/api/sync/push", { tables: batches[i].tables });
    for (const [table, r] of Object.entries<any>(json?.results ?? {})) {
      if (r.upserted > 0) result.stored[table] = (result.stored[table] ?? 0) + r.upserted;
      result.unchanged += r.skipped ?? 0;
      const named = new Set<string>();
      for (const issue of r.rejectedRows ?? []) {
        named.add(issue.id);
        result.rejected.push({ table, id: issue.id, reason: issue.reason });
      }
      // An older server reports only a count, not which rows — keep the count so nothing is hidden.
      const unnamed = (r.rejected ?? 0) - named.size;
      for (let k = 0; k < unnamed; k++) result.rejected.push({ table, id: "", reason: "توسط سرور پذیرفته نشد." });
    }
  }
  options.onProgress?.(batches.length, batches.length);
  return result;
}

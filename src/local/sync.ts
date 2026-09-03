// Incremental push/pull sync with the remote server (Phase 12 — "فاز ۱۲" in the plan). Pure
// push/pull primitives only: no license-cache reading/writing here (see
// src/lib/nativeOnboarding.ts's syncWithServer, which owns reading the cached token/cursors,
// calling these, persisting the new cursors, and swallowing network errors so a device offline
// never disrupts the app). Kept decoupled from licenseCache.ts on purpose — easy to unit-test
// with a bare token/cursor and a mocked fetch, no cache row needs to exist first.
//
// Uses raw fetch() against REMOTE_API_BASE, like src/lib/remoteAuth.ts — never apiClient.ts,
// whose fetcher/apiPost/etc. always route to the local dispatcher on native regardless of URL.
import { REMOTE_API_BASE } from "@/lib/remoteAuth";
import { SYNC_TABLES, type SyncTableConfig } from "@/lib/syncTables";
import { LOCAL_USER_ID } from "./localUser";
import type { LocalDb } from "./db";

type Row = Record<string, unknown>;

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Push: local -> server
// ---------------------------------------------------------------------------

/** Rows changed since `since` (or every row, when `since` is null — this device's first-ever
 * push), with userId remapped local -> remote for direct-ownership tables. Parent-hop tables
 * carry no userId of their own, so nothing to remap; the server verifies their ownership by
 * walking the FK instead (see src/app/api/sync/push/route.ts). */
function collectChangedRows(db: LocalDb, config: SyncTableConfig, since: string | null, remoteUserId: string): Row[] {
  const cursorColumn = config.hasUpdatedAt ? "updatedAt" : "createdAt";
  const rows = since
    ? db.all<Row>(`SELECT * FROM "${config.table}" WHERE "${cursorColumn}" > ?`, [since])
    : db.all<Row>(`SELECT * FROM "${config.table}"`);

  if (config.ownership.type !== "direct") return rows;
  return rows.map((row) => ({ ...row, userId: remoteUserId }));
}

export interface PushResult {
  pushed: Record<string, number>;
  /** This device's own clock, captured before reading local rows — persist as the next
   * lastPushedAt so a row written mid-push isn't missed by the following sync. */
  pushedAt: string;
}

export async function pushLocalChanges(db: LocalDb, token: string, remoteUserId: string, lastPushedAt: string | null): Promise<PushResult> {
  const pushedAt = new Date().toISOString();

  const tables: Record<string, Row[]> = {};
  for (const config of SYNC_TABLES) {
    const rows = collectChangedRows(db, config, lastPushedAt, remoteUserId);
    if (rows.length > 0) tables[config.table] = rows;
  }

  if (Object.keys(tables).length === 0) return { pushed: {}, pushedAt };

  const res = await fetch(`${REMOTE_API_BASE}/api/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ tables }),
  });
  if (!res.ok) throw new Error(`sync push failed: ${res.status}`);

  const body = (await res.json()) as { results: Record<string, { upserted: number; skipped: number; rejected: number }> };
  const pushed: Record<string, number> = {};
  for (const [table, r] of Object.entries(body.results)) {
    if (r.upserted > 0) pushed[table] = r.upserted;
  }
  return { pushed, pushedAt };
}

// ---------------------------------------------------------------------------
// Pull: server -> local
// ---------------------------------------------------------------------------

const MAX_APPLY_PASSES = 25; // mirrors src/local/dataExport.ts's own retry cap for the same reason: Event.recurrenceParentId's same-table self-reference

/** Writes one pulled row into the local table, INSERTing if it's new or UPDATEing if the
 * incoming row is strictly newer — the pull-side mirror of the push route's own upsert-if-newer
 * rule. Tables with no updatedAt (append-only: AssetTransaction/EventCompletion/Reminder) only
 * ever insert; an existing row is left alone since there's no timestamp to compare. Throws on a
 * genuine failure (most likely a not-yet-inserted FK target from later in this same batch) —
 * applyRowsWithRetry decides how to react to that. */
function upsertRowIfNewer(db: LocalDb, table: string, row: Row, hasUpdatedAt: boolean): boolean {
  const columns = Object.keys(row);
  const existing = hasUpdatedAt
    ? db.get<{ updatedAt: string }>(`SELECT "updatedAt" FROM "${table}" WHERE "id" = ?`, [row.id])
    : db.get<{ id: string }>(`SELECT "id" FROM "${table}" WHERE "id" = ?`, [row.id]);

  if (existing) {
    if (!hasUpdatedAt) return false;
    if (new Date((existing as { updatedAt: string }).updatedAt) >= new Date(row.updatedAt as string)) return false;
    const nonId = columns.filter((c) => c !== "id");
    db.run(`UPDATE "${table}" SET ${nonId.map((c) => `"${c}" = ?`).join(",")} WHERE "id" = ?`, [...nonId.map((c) => row[c]), row.id]);
  } else {
    db.run(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`, columns.map((c) => row[c]));
  }
  return true;
}

function applyRowsWithRetry(db: LocalDb, table: string, rows: Row[], hasUpdatedAt: boolean): number {
  let applied = 0;
  let pending = rows;

  for (let pass = 0; pass < MAX_APPLY_PASSES && pending.length > 0; pass++) {
    const stillPending: Row[] = [];
    let progressed = false;
    for (const row of pending) {
      try {
        if (upsertRowIfNewer(db, table, row, hasUpdatedAt)) applied++;
        progressed = true; // resolved either way (applied or correctly skipped as stale) — not stuck on an FK ordering issue
      } catch (err) {
        console.error(`sync pull: failed to apply a "${table}" row (id=${String(row.id)})`, err);
        stillPending.push(row);
      }
    }
    pending = stillPending;
    if (!progressed) break;
  }

  return applied;
}

export interface PullResult {
  pulled: Record<string, number>;
  /** The server's clock, not this device's — persist as the next lastPulledAt. */
  syncedAt: string;
}

export async function pullRemoteChanges(db: LocalDb, token: string, lastPulledAt: string | null): Promise<PullResult> {
  const url = `${REMOTE_API_BASE}/api/sync/pull${lastPulledAt ? `?since=${encodeURIComponent(lastPulledAt)}` : ""}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`sync pull failed: ${res.status}`);

  const body = (await res.json()) as { syncedAt: string; tables: Record<string, Row[]> };
  const pulled: Record<string, number> = {};

  db.execute("BEGIN TRANSACTION");
  try {
    for (const config of SYNC_TABLES) {
      const remoteRows = body.tables[config.table];
      if (!Array.isArray(remoteRows) || remoteRows.length === 0) continue;

      const localRows = config.ownership.type === "direct" ? remoteRows.map((row) => ({ ...row, userId: LOCAL_USER_ID })) : remoteRows;

      const applied = applyRowsWithRetry(db, config.table, localRows, config.hasUpdatedAt);
      if (applied > 0) pulled[config.table] = applied;
    }
    db.execute("COMMIT");
  } catch (err) {
    db.execute("ROLLBACK");
    throw err;
  }

  return { pulled, syncedAt: body.syncedAt };
}

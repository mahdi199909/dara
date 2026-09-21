// Incremental push/pull sync with the remote server (Phase 12 — "فاز ۱۲" in the plan). Pure
// push/pull primitives only: no license-cache reading/writing here (see src/local/syncRunner.ts,
// which owns reading the cached token/cursors, calling these, persisting the new cursors and
// turning failures into something a person can read). Kept decoupled from licenseCache.ts on
// purpose — easy to unit-test with a bare token/cursor and a mocked fetch.
//
// Uses raw fetch() against REMOTE_API_BASE, like src/lib/remoteAuth.ts — never apiClient.ts,
// whose fetcher/apiPost/etc. always route to the local dispatcher on native regardless of URL.
import { REMOTE_API_BASE } from "@/lib/remoteAuth";
import { remoteFetch } from "@/lib/remoteFetch";
import type { SyncTrace } from "@/lib/syncTrace";
import { SELF_REFERENCE_COLUMN, SYNC_TABLES, TOMBSTONE_TABLES, type SyncTableConfig } from "@/lib/syncTables";
import { toBoolean, toIsoDate } from "@/lib/syncNormalize";
import { buildBatches } from "@/lib/syncBatching";
import type { ProfilePayload } from "@/lib/profileSync";
import { LOCAL_USER_ID } from "./localUser";
import type { LocalDb } from "./db";
import { withLocalTransaction } from "./transaction";
import { META_TOMBSTONES_ACKED_AT, clearSyncIssue, getSyncMeta, recordSyncIssue, retryableIssues, setSyncMeta } from "./syncMeta";
import { applyRemoteTombstone, hasLocalTombstoneAtOrAfter, listLocalTombstonesSince } from "./tombstones";
import { applyRemoteProfile, readLocalProfilePayload } from "./profileSyncLocal";
import { getLogger } from "../lib/observability";

const log = getLogger("sync", "wire");

type Row = Record<string, unknown>;

/** A non-2xx answer from the server (or the proxy in front of it) — carries the status so the
 * caller can tell "too big" from "not logged in" from "server is down". */
export class SyncHttpError extends Error {
  status: number;
  bodySnippet: string;
  /** The server's X-Request-Id for the failed request, when it sent one: the key to its own log line. */
  requestId?: string;
  constructor(status: number, what: string, bodySnippet: string, requestId?: string) {
    super(`sync ${what} failed: ${status}`);
    this.name = "SyncHttpError";
    this.status = status;
    this.bodySnippet = bodySnippet;
    this.requestId = requestId;
  }
}

/** The server's own id for a request it answered (exposed to the app through CORS); undefined from older servers and test doubles. */
function serverRequestId(res: Response): string | undefined {
  return res.headers?.get?.("x-request-id") ?? undefined;
}

/** What every sync record of one cycle carries, so all of it can be found with the cycle's id. */
function traceFields(trace: SyncTrace | undefined): { syncId?: string; traceId?: string } {
  return trace ? { syncId: trace.syncId, traceId: trace.traceId } : {};
}

const MAX_LOGGED_IDS_PER_TABLE = 20;
const MAX_LOGGED_IDS = 60;

/** Row counts per table, e.g. { Task: 3, Habit: 1 }. */
function countsByTable(perTable: Array<{ table: string; rows: Row[] }>): Record<string, number> {
  return Object.fromEntries(perTable.map((entry) => [entry.table, entry.rows.length]));
}

/**
 * The ids of the rows that left the phone in a push, per table, capped. Ids are random values and say nothing
 * about a row's content; they are what lets "did this expense go through?" be answered from the log alone.
 */
function cappedIds(perTable: Array<{ table: string; rows: Row[] }>): { ids: Record<string, string[]>; truncated: boolean } {
  const ids: Record<string, string[]> = {};
  let total = 0;
  let truncated = false;
  for (const { table, rows } of perTable) {
    const room = Math.max(0, Math.min(MAX_LOGGED_IDS_PER_TABLE, MAX_LOGGED_IDS - total));
    const taken = rows.slice(0, room).map((row) => String(row.id));
    if (taken.length > 0) ids[table] = taken;
    total += taken.length;
    if (rows.length > taken.length) truncated = true;
  }
  return { ids, truncated };
}

async function httpError(res: Response, what: string): Promise<SyncHttpError> {
  let snippet = "";
  try {
    snippet = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
  } catch {
    // body unreadable — the status alone is still useful
  }
  return new SyncHttpError(res.status, what, snippet, serverRequestId(res));
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function isoMinus(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() - ms).toISOString();
}

// ---------------------------------------------------------------------------
// Push: local -> server
// ---------------------------------------------------------------------------

// The server's reverse proxy rejects any request body over ~1 MB (nginx's default) with a bare
// 413 — a first sync of a phone with real history is easily bigger than that. Every push is
// therefore split into several requests well under it; tables stay in dependency order across
// them (parents before children), so a child never arrives before its parent's request.
const MAX_BATCH_BYTES = 300_000;
const MAX_BATCH_ROWS = 300;
// Both cursors are re-read a little early on every sync. A row is stamped with the moment it was
// written, but committed a moment later (and clocks disagree by seconds): reading exactly from the
// last cursor could skip a row that landed in that gap forever. Re-sending a little is harmless —
// the receiving side skips anything it already has at that timestamp. (The push side only needs a
// sliver: its timestamps and its cursor come from the same clock.)
const PUSH_OVERLAP_MS = 1_000;
export const PULL_OVERLAP_SHORT_MS = 2 * 60 * 1000;
export const PULL_OVERLAP_DEEP_MS = 2 * 24 * 60 * 60 * 1000;

const columnTypeCache = new WeakMap<LocalDb, Map<string, Map<string, string>>>();

/** Declared SQLite column types for a table (e.g. "BOOLEAN", "DATETIME") — the local schema is
 * generated from Prisma's, so these tell us exactly which columns need converting for the server. */
function columnTypes(db: LocalDb, table: string): Map<string, string> {
  let perDb = columnTypeCache.get(db);
  if (!perDb) {
    perDb = new Map();
    columnTypeCache.set(db, perDb);
  }
  let cols = perDb.get(table);
  if (!cols) {
    cols = new Map();
    for (const c of db.all<{ name: string; type: string }>(`PRAGMA table_info("${table}")`)) cols.set(c.name, (c.type || "").toUpperCase());
    perDb.set(table, cols);
  }
  return cols;
}

/** SQLite has no boolean type (it stores 0/1) and will keep whatever date string was written;
 * the server validates strictly. Convert the two so every row is exactly what the server's
 * database expects — this alone is what lets Categories, Habits, Events, Reminders, Accounts,
 * Transactions... reach the server at all. */
function toWireRow(db: LocalDb, config: SyncTableConfig, row: Row, remoteUserId: string): Row {
  const types = columnTypes(db, config.table);
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    const type = types.get(key);
    if (value === null || value === undefined) out[key] = null;
    else if (type === "BOOLEAN") out[key] = toBoolean(value) ?? value;
    else if (type === "DATETIME") out[key] = toIsoDate(value) ?? value;
    else out[key] = value;
  }
  if (config.ownership.type === "direct") out.userId = remoteUserId;
  return out;
}

/** Rows changed since `since` (or every row, when `since` is null — this device's first-ever
 * push), converted for the server. Parent-hop tables carry no userId of their own, so nothing to
 * remap; the server verifies their ownership by walking the FK instead. */
function collectChangedRows(db: LocalDb, config: SyncTableConfig, since: string | null, remoteUserId: string): Row[] {
  const cursorColumn = config.hasUpdatedAt ? "updatedAt" : "createdAt";
  const rows = since
    ? db.all<Row>(`SELECT * FROM "${config.table}" WHERE "${cursorColumn}" > ?`, [since])
    : db.all<Row>(`SELECT * FROM "${config.table}"`);
  const wire = rows.map((row) => toWireRow(db, config, row, remoteUserId));

  // Tables that reference themselves: send parents before children so a child never lands in an
  // earlier request than its parent (the server also retries within one request, but not across).
  const selfRef = SELF_REFERENCE_COLUMN[config.table];
  if (selfRef) wire.sort((a, b) => Number(a[selfRef] != null) - Number(b[selfRef] != null));
  return wire;
}

export interface RowIssue {
  table: string;
  id: string;
  reason: string;
}

export interface PushOptions {
  maxBatchBytes?: number;
  maxBatchRows?: number;
  overlapMs?: number;
  /** The cycle this push belongs to: its id goes on every record written and to the server as headers. */
  trace?: SyncTrace;
}

export interface PushResult {
  /** Rows the server newly stored, per table. */
  pushed: Record<string, number>;
  /** Rows the server already had at the same or a newer version. */
  skipped: number;
  /** Rows the server refused (see `issues` for why, when the server says). */
  rejected: number;
  issues: RowIssue[];
  /** This device's own clock, captured before reading local rows — persist as the next
   * lastPushedAt so a row written mid-push isn't missed by the following sync. */
  pushedAt: string;
  /** The protocol version the server answered with; 0 = an older server that ignores tombstones
   * and profile data (so those must not be marked as delivered), null = nothing was sent. */
  protocol: number | null;
  batches: number;
  tombstonesSent: number;
  /** How long the requests took, in total. */
  durationMs: number;
  /** The server's X-Request-Id for each request that was answered (none from an older server). */
  serverRequestIds: string[];
}

const META_PROFILE_PUSHED_AT = "profilePushedAt";

export async function pushLocalChanges(
  db: LocalDb,
  token: string,
  remoteUserId: string,
  lastPushedAt: string | null,
  options: PushOptions = {}
): Promise<PushResult> {
  const pushedAt = new Date().toISOString();
  const since = lastPushedAt ? isoMinus(lastPushedAt, options.overlapMs ?? PUSH_OVERLAP_MS) : null;

  // Rows the server refused last time (e.g. a parent that hadn't arrived yet) ride along again.
  const retrying = retryableIssues(db);

  const perTable: Array<{ table: string; rows: Row[] }> = [];
  for (const config of SYNC_TABLES) {
    const rows = collectChangedRows(db, config, since, remoteUserId);
    const seen = new Set(rows.map((r) => String(r.id)));
    for (const issue of retrying) {
      if (issue.tbl !== config.table || seen.has(issue.rowId)) continue;
      const row = db.get<Row>(`SELECT * FROM "${config.table}" WHERE "id" = ?`, [issue.rowId]);
      if (row) rows.push(toWireRow(db, config, row, remoteUserId));
      else clearSyncIssue(db, config.table, issue.rowId); // deleted since — nothing left to retry
    }
    if (rows.length > 0) perTable.push({ table: config.table, rows });
  }

  const tombstones = listLocalTombstonesSince(db, getSyncMeta(db, META_TOMBSTONES_ACKED_AT));
  const profile: ProfilePayload = readLocalProfilePayload(db, LOCAL_USER_ID, getSyncMeta(db, META_PROFILE_PUSHED_AT));
  const hasProfile = !!(profile.name || profile.settings);

  const empty: PushResult = { pushed: {}, skipped: 0, rejected: 0, issues: [], pushedAt, protocol: null, batches: 0, tombstonesSent: 0, durationMs: 0, serverRequestIds: [] };
  if (perTable.length === 0 && tombstones.length === 0 && !hasProfile) return empty;

  // Even with nothing but deletions/profile to say, one request still has to go out.
  const batches = buildBatches(perTable, options.maxBatchBytes ?? MAX_BATCH_BYTES, options.maxBatchRows ?? MAX_BATCH_ROWS);
  if (batches.length === 0) batches.push({ tables: {}, bytes: 0, rows: 0 });

  const result: PushResult = { ...empty, batches: batches.length, tombstonesSent: tombstones.length, protocol: 0 };
  const trace = options.trace;
  const recordCount = perTable.reduce((sum, entry) => sum + entry.rows.length, 0);
  const requestsStartedAt = performance.now();
  // Counts and sizes only; never a row. (The ids of the rows are written once the server has answered, below.)
  log.debug("SYNC_PUSH_STARTED", {
    ...traceFields(trace),
    layer: "local",
    recordCount,
    batches: batches.length,
    payloadBytes: batches.reduce((sum, batch) => sum + batch.bytes, 0),
    tombstones: tombstones.length,
    profile: hasProfile,
    tables: countsByTable(perTable),
  });

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    // Deletions and profile data go with the first request: deletions must land before any row
    // that re-creates the same natural key (un-check then re-check a habit day).
    const body = {
      tables: batch.tables,
      ...(i === 0 && tombstones.length > 0 ? { tombstones } : {}),
      ...(i === 0 && hasProfile ? { profile } : {}),
    };
    const res = await remoteFetch(
      `${REMOTE_API_BASE}/api/sync/push`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify(body),
      },
      trace
    );
    const requestId = serverRequestId(res);
    if (requestId) result.serverRequestIds.push(requestId);
    if (!res.ok) {
      // The proxy in front of the server refuses a body over its limit with a bare 413; batching is meant to keep us well under it.
      if (res.status === 413) {
        log.warn("SYNC_SIZE_LIMIT_EXCEEDED", { ...traceFields(trace), layer: "local", errorCode: "SYNC-004", batch: i + 1, batches: batches.length, batchRows: batch.rows, batchBytes: batch.bytes, serverRequestId: requestId });
      }
      throw await httpError(res, "push");
    }

    const json = (await res.json()) as {
      protocol?: number;
      results?: Record<string, { upserted: number; skipped: number; rejected: number; rejectedRows?: Array<{ id: string; reason: string }> }>;
    };
    result.protocol = json.protocol ?? 0;

    for (const [table, r] of Object.entries(json.results ?? {})) {
      if (r.upserted > 0) result.pushed[table] = (result.pushed[table] ?? 0) + r.upserted;
      result.skipped += r.skipped;
      result.rejected += r.rejected;

      const rejectedIds = new Set<string>();
      for (const issue of r.rejectedRows ?? []) {
        rejectedIds.add(issue.id);
        result.issues.push({ table, id: issue.id, reason: issue.reason });
        recordSyncIssue(db, table, issue.id, issue.reason);
      }
      // Only when the server named every rejected row can the rest be considered accepted — an
      // older server (no rejectedRows) or one that capped its list leaves earlier issues in place.
      if (result.protocol >= 2 && rejectedIds.size === r.rejected) {
        for (const sent of batch.tables[table] ?? []) {
          if (!rejectedIds.has(String(sent.id))) clearSyncIssue(db, table, String(sent.id));
        }
      }
    }
  }

  // Deletions and profile data only count as delivered by a server that understands them.
  if (result.protocol !== null && result.protocol >= 2) {
    setSyncMeta(db, META_TOMBSTONES_ACKED_AT, pushedAt);
    setSyncMeta(db, META_PROFILE_PUSHED_AT, pushedAt);
  }

  result.durationMs = Math.round((performance.now() - requestsStartedAt) * 100) / 100;
  const pushedTotal = Object.values(result.pushed).reduce((sum, n) => sum + n, 0);
  if (result.rejected > 0) {
    // Which rows the server refused and why (its reason, capped): the one place ids are always written.
    log.warn("SYNC_PAYLOAD_REJECTED", {
      ...traceFields(trace),
      layer: "local",
      errorCode: "SYNC-005",
      rejected: result.rejected,
      rows: result.issues.slice(0, 20).map((issue) => ({ table: issue.table, id: issue.id, reason: issue.reason })),
    });
  }
  const { ids, truncated } = cappedIds(perTable);
  // INFO when something left the phone (the ids let "did entity X go through?" be answered from the log), DEBUG when it was only a check-in.
  log.log(pushedTotal > 0 || result.rejected > 0 || tombstones.length > 0 ? "INFO" : "DEBUG", "SYNC_PUSH_SUCCESS", {
    ...traceFields(trace),
    layer: "local",
    durationMs: result.durationMs,
    batches: batches.length,
    recordCount,
    pushed: pushedTotal,
    skipped: result.skipped,
    rejected: result.rejected,
    tombstonesSent: tombstones.length,
    protocol: result.protocol,
    serverRequestIds: result.serverRequestIds,
    sentIds: ids,
    ...(truncated ? { sentIdsTruncated: true } : {}),
  });
  return result;
}

// ---------------------------------------------------------------------------
// Pull: server -> local
// ---------------------------------------------------------------------------

const MAX_APPLY_PASSES = 25; // mirrors src/local/dataExport.ts's own retry cap for the same reason: Event.recurrenceParentId's same-table self-reference

interface RowFailure {
  table: string;
  id: string;
  reason: string;
}

const isSet = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

/**
 * A reminder that already fired (`notified`) or was dismissed on this device stays that way when
 * the server's newer copy of the SAME reminder — same time — arrives. Both flags only ever move
 * one way; letting a stale "not fired yet" copy win would re-fire every past reminder as a fresh
 * notification (this is exactly what the first sync after Reminder gained an updatedAt would do:
 * the server's rows are stamped with the upgrade time, newer than anything on the phone). A
 * changed `remindAt` means the reminder was rescheduled, so the incoming flags apply as they are
 * — it is due again. When the merge keeps a flag the server doesn't have, the row is re-stamped
 * so the flag travels back on the next push instead of the web firing it a second time.
 */
function keepFiredReminderFlags(local: Row, incoming: Row): Row {
  if (new Date(String(local.remindAt)).getTime() !== new Date(String(incoming.remindAt)).getTime()) return incoming;
  const notified = isSet(local.notified) || isSet(incoming.notified);
  const dismissed = isSet(local.dismissed) || isSet(incoming.dismissed);
  const changed = notified !== isSet(incoming.notified) || dismissed !== isSet(incoming.dismissed);
  return { ...incoming, notified: notified ? 1 : 0, dismissed: dismissed ? 1 : 0, ...(changed ? { updatedAt: new Date().toISOString() } : {}) };
}

/** Writes one pulled row into the local table, INSERTing if it's new or UPDATEing if the
 * incoming row is strictly newer — the pull-side mirror of the push route's own upsert-if-newer
 * rule. Tables with no updatedAt (append-only: AssetTransaction/EventCompletion/CapitalSnapshot)
 * only ever insert; an existing row is left alone since there's no timestamp to compare. Throws
 * on a genuine failure (most likely a not-yet-inserted FK target from later in this same batch) —
 * applyRowsWithRetry decides how to react to that. */
function upsertRowIfNewer(db: LocalDb, table: string, row: Row, hasUpdatedAt: boolean, onOverwrite?: (existing: Row, incoming: Row) => void): "created" | "updated" | null {
  const existing = hasUpdatedAt
    ? db.get<Row>(`SELECT ${table === "Reminder" ? "*" : '"updatedAt"'} FROM "${table}" WHERE "id" = ?`, [row.id])
    : db.get<{ id: string }>(`SELECT "id" FROM "${table}" WHERE "id" = ?`, [row.id]);

  if (existing) {
    if (!hasUpdatedAt) return null;
    if (new Date((existing as Row).updatedAt as string) >= new Date(row.updatedAt as string)) return null;
    onOverwrite?.(existing as Row, row);
    const next = table === "Reminder" ? keepFiredReminderFlags(existing as Row, row) : row;
    const nonId = Object.keys(next).filter((c) => c !== "id");
    db.run(`UPDATE "${table}" SET ${nonId.map((c) => `"${c}" = ?`).join(",")} WHERE "id" = ?`, [...nonId.map((c) => next[c]), row.id]);
    return "updated";
  }
  const columns = Object.keys(row);
  db.run(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`, columns.map((c) => row[c]));
  return "created";
}

function applyRowsWithRetry(
  db: LocalDb,
  table: string,
  rows: Row[],
  hasUpdatedAt: boolean,
  onOverwrite?: (existing: Row, incoming: Row) => void
): { applied: number; created: number; updated: number; failures: RowFailure[] } {
  let applied = 0;
  let created = 0;
  let updated = 0;
  let pending = rows;
  const lastError = new Map<string, string>();

  for (let pass = 0; pass < MAX_APPLY_PASSES && pending.length > 0; pass++) {
    const stillPending: Row[] = [];
    let progressed = false;
    for (const row of pending) {
      try {
        const outcome = upsertRowIfNewer(db, table, row, hasUpdatedAt, onOverwrite);
        if (outcome) {
          applied++;
          if (outcome === "created") created++;
          else updated++;
        }
        progressed = true; // resolved either way (applied or correctly skipped as stale) — not stuck on an FK ordering issue
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // The same logical row already exists here under another id (same habit+day, same
        // activity's virtual asset...) — nothing to retry, and nothing lost.
        if (/UNIQUE constraint failed/i.test(message)) {
          progressed = true;
          continue;
        }
        lastError.set(String(row.id), message);
        stillPending.push(row);
      }
    }
    pending = stillPending;
    if (!progressed) break;
  }

  const failures = pending.map((row) => ({ table, id: String(row.id), reason: lastError.get(String(row.id)) ?? "unknown error" }));
  for (const f of failures) log.warn("SYNC_PULL_ROW_FAILED", { errorCode: "SYNC-008", layer: "local", entityType: table, entityId: f.id, reason: f.reason });
  return { applied, created, updated, failures };
}

export interface PullOptions {
  /** How far back before the stored cursor to re-read — see PULL_OVERLAP_*. */
  overlapMs?: number;
  /** The cycle this pull belongs to: its id goes on every record written and to the server as headers. */
  trace?: SyncTrace;
  /**
   * When this device last pushed. A row the server sends that is newer than this device's copy AND whose local copy
   * changed after this moment overwrites a change that was never sent: SYNC_CONFLICT (the newer edit wins). Null
   * (never pushed: the first sync of an account) means there is nothing to compare against, so nothing is called a conflict.
   */
  lastPushedAt?: string | null;
}

export interface PullResult {
  pulled: Record<string, number>;
  /** The server's clock, not this device's — persist as the next lastPulledAt. */
  syncedAt: string;
  tombstonesApplied: number;
  /** Rows the server sent that this device couldn't store (FK never resolved, unknown column...). */
  failures: RowFailure[];
  profileApplied: { settingsApplied: boolean; nameApplied: boolean };
  /** 0 = an older server that sends neither tombstones nor profile data. */
  protocol: number;
  /** Rows the server sent (most of them already here), and how many of those created or changed a row on this device. */
  received: number;
  created: number;
  updated: number;
  /** Rows the server's newer copy replaced although this device had changed them since it last pushed. */
  conflicts: number;
  durationMs: number;
  /** The server's X-Request-Id for the request (none from an older server). */
  serverRequestId?: string;
}

export async function pullRemoteChanges(db: LocalDb, token: string, lastPulledAt: string | null, options: PullOptions = {}): Promise<PullResult> {
  const since = lastPulledAt ? isoMinus(lastPulledAt, options.overlapMs ?? PULL_OVERLAP_SHORT_MS) : null;
  const url = `${REMOTE_API_BASE}/api/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ""}`;
  const trace = options.trace;
  const startedAt = performance.now();
  log.debug("SYNC_PULL_STARTED", { ...traceFields(trace), layer: "local", firstEver: since === null, overlapMs: options.overlapMs ?? PULL_OVERLAP_SHORT_MS });
  const res = await remoteFetch(url, { headers: authHeaders(token) }, trace);
  if (!res.ok) throw await httpError(res, "pull");
  const requestId = serverRequestId(res);

  const body = (await res.json()) as {
    protocol?: number;
    syncedAt: string;
    tables: Record<string, Row[]>;
    tombstones?: Array<{ table: string; id: string }>;
    profile?: ProfilePayload;
  };
  const pulled: Record<string, number> = {};
  const failures: RowFailure[] = [];
  let tombstonesApplied = 0;
  let profileApplied = { settingsApplied: false, nameApplied: false };
  let created = 0;
  let updated = 0;
  const received = Object.values(body.tables ?? {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
  const conflictIds: Record<string, string[]> = {};
  let conflicts = 0;
  const lastPushed = options.lastPushedAt ? new Date(options.lastPushedAt).getTime() : null;

  // The whole pull lands together or not at all (synchronous, so nothing else on the phone runs in between).
  withLocalTransaction(db, () => {
    // Deletions first, so a row deleted elsewhere and re-created under the same natural key
    // (un-check then re-check) arrives after the old one is gone.
    for (const t of body.tombstones ?? []) {
      if (!TOMBSTONE_TABLES.includes(t.table)) continue;
      applyRemoteTombstone(db, t.table, t.id);
      tombstonesApplied++;
    }

    profileApplied = applyRemoteProfile(db, LOCAL_USER_ID, body.profile);

    for (const config of SYNC_TABLES) {
      let remoteRows = body.tables[config.table];
      if (!Array.isArray(remoteRows) || remoteRows.length === 0) continue;

      // A row this device just deleted may still exist on the server until the deletion is pushed
      // — pulling it straight back would silently undo the delete.
      if (TOMBSTONE_TABLES.includes(config.table)) {
        remoteRows = remoteRows.filter((r) => !hasLocalTombstoneAtOrAfter(db, config.table, String(r.id), String(r.updatedAt ?? r.createdAt ?? "")));
      }

      const localRows = config.ownership.type === "direct" ? remoteRows.map((row) => ({ ...row, userId: LOCAL_USER_ID })) : remoteRows;

      const { applied, created: made, updated: changed, failures: failed } = applyRowsWithRetry(db, config.table, localRows, config.hasUpdatedAt, (existing, incoming) => {
        // The server's newer copy is about to replace this one. If this one had changed since the last push, that change was never sent.
        if (lastPushed === null || !(new Date(String(existing.updatedAt)).getTime() > lastPushed)) return;
        conflicts++;
        const list = (conflictIds[config.table] ??= []);
        if (list.length < MAX_LOGGED_IDS_PER_TABLE) list.push(String(incoming.id));
      });
      if (applied > 0) pulled[config.table] = applied;
      created += made;
      updated += changed;
      failures.push(...failed);
    }
  });

  const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
  const appliedTotal = Object.values(pulled).reduce((sum, n) => sum + n, 0);
  if (conflicts > 0) {
    // Both sides changed the same row and the newer edit won: which rows, so "my edit disappeared" can be traced to here.
    log.info("SYNC_CONFLICT", { ...traceFields(trace), layer: "local", errorCode: "SYNC-006", conflicts, winner: "server", ids: conflictIds });
  }
  log.log(appliedTotal > 0 || tombstonesApplied > 0 || failures.length > 0 ? "INFO" : "DEBUG", "SYNC_PULL_SUCCESS", {
    ...traceFields(trace),
    layer: "local",
    durationMs,
    received,
    recordCount: appliedTotal,
    created,
    updated,
    deleted: tombstonesApplied,
    failures: failures.length,
    tables: pulled,
    protocol: body.protocol ?? 0,
    serverRequestId: requestId,
  });

  return { pulled, syncedAt: body.syncedAt, tombstonesApplied, failures, profileApplied, protocol: body.protocol ?? 0, received, created, updated, conflicts, durationMs, serverRequestId: requestId };
}

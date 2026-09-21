# Logging synchronisation

Sync between a phone and the server is the most delicate flow in Parva: a change made offline on the
phone must reach the server and then the web, without loss or duplication. A support question like
*"I recorded an expense on my phone but it is not on the web"* must be answerable from the logs, step by
step. Status: **[done]** — the server's side of every push and pull since phase 1, the phone's side and the
correlation between them since phase 4 (ships with the next APK).

## How sync works (what the logs describe)

- The phone keeps two cursors (last pull / last push); each cycle **pulls** what changed on the
  server, merges duplicates, reconciles OS reminders, then **pushes** what changed locally
  (`src/local/syncRunner.ts`). Conflicts are last-write-wins on `updatedAt`.
- 18 tables travel (`SYNC_TABLES`), plus deletions as tombstones and the profile/settings. The
  audit log does not travel (each platform keeps its own history).
- Requests are split under the proxy's 1 MB body limit. The server answers with a protocol version and,
  per table, how many rows were upserted, skipped (an equal-or-newer copy already existed) or rejected.
- There is no per-row queue: a local row is "pending" when its `updatedAt` is later than the last
  successful push.

## Today **[done]**

The phone logs the outcome of a failed cycle and each row it could not apply:

| Event | Level | Fields |
| --- | --- | --- |
| `SYNC_FAILED` | WARN (offline) / ERROR | `error_code`, `metadata.kind` (network/auth/too-large/server/unknown), `metadata.status`, counts pulled/pushed so far, `layer: local` |
| `SYNC_PULL_ROW_FAILED` | WARN | `error_code: SYNC-008`, `entity_type`, `entity_id`, `metadata.reason` (the database's own message) |

`kind` → code: network `SYNC-001`, server `SYNC-002`, auth `SYNC-003`, too-large `SYNC-004`,
unknown `SYNC-009`. Only counts and ids are logged, never rows or tokens (see [security.md](security.md)).

### The server's side **[done, phase 1]**

Every `/api/sync/push` and `/api/sync/pull` is an ordinary request first: an `HTTP_REQUEST_COMPLETED` with
`request_id`, `user_id`, status and duration (`POST /api/sync/push` at INFO, the poll at DEBUG). On top of
that the routes write one summary record each (`src/lib/observability/server/syncLog.ts`):

| Event | Level | Fields (all in `metadata`) |
| --- | --- | --- |
| `SYNC_PUSH_SUCCESS` | INFO when rows/deletions/profile were applied, DEBUG when nothing changed | `counts` {upserted, skipped, rejected}, `tables` (the same per table), `tombstones` {applied, ignored}, `profile` |
| `SYNC_PARTIAL_SUCCESS` | WARN | as above plus `rejections`: `"Table: kind of refusal"` → count |
| `SYNC_SLOW` | WARN | the request took ≥ `SLOW_SYNC_THRESHOLD_MS` (default 3000; a push can carry a whole backup) — written by `withApiLogging` in place of `API_SLOW_REQUEST` for `/api/sync/*`, with `duration_ms`, `dbQueries`, `dbMs` |
| `SYNC_PULL_SUCCESS` | INFO when rows/deletions were sent, DEBUG when the device was up to date | `rows`, `tables` (rows per table), `tombstones`, `incremental` (a cursor was given) |

The kinds of refusal are a closed list, never the refused text (a refusal's own message quotes the value
that failed): `missing id`, `parent row not found for this account`, `id belongs to a different account`,
`missing parent row`, `duplicate of an existing row`, `<field>: required value is missing | not a boolean |
not a valid date | not an integer | not a number | value is larger than the server allows`, or `other`.
No row, id or value is logged. If the request carries the app's `X-Parva-Sync-Id`, `X-Parva-Device-Id`
and `traceparent` (the app sends them since phase 4; the server has accepted them since phase 1), each of these
records — and every other record of that request — carries `sync_id`, `device_id` and the phone's `trace_id`.

## The phone's side, and one id for the whole cycle **[done, phase 4]**

Each cycle gets a `sync_id` (`sync_…`) and a W3C trace (`trace_id`). Every record the phone writes during it carries
both, and both — with the device id — travel to the server with each request of the cycle (`X-Parva-Sync-Id`,
`traceparent`, `X-Parva-Device-Id`; `src/lib/remoteFetch.ts`), where they are stamped on every record of the request
(phase 1). The phone in turn writes down the server's own `X-Request-Id` for each request it made. One search on either
id finds both sides.

```
phone   SYNC_STARTED           sync_id  trigger  deep  firstEver  attempt
phone   SYNC_PULL_STARTED
server  HTTP_REQUEST_COMPLETED GET /api/sync/pull   request_id=req_…  sync_id  trace_id  device_id  user_id  status_code
phone   SYNC_PULL_SUCCESS      received  recordCount  created  updated  deleted  tables  serverRequestId  duration_ms
phone   SYNC_PUSH_STARTED      recordCount  batches  payloadBytes  tables
server  HTTP_REQUEST_COMPLETED POST /api/sync/push  request_id=req_…  sync_id …
server  SYNC_PUSH_SUCCESS      counts per table, tombstones                            (phase 1)
phone   SYNC_PUSH_SUCCESS      pushed  skipped  rejected  serverRequestIds  sentIds (per table, capped)
phone   SYNC_SUCCESS           duration_ms
phone   SYNC_COMPLETED         ok  created  updated  pushed  pulled  deleted  rejected  conflicts  duration_ms
```

| Event (phone, `layer: local`) | Level | What it says |
| --- | --- | --- |
| `SYNC_STARTED` | INFO for a cycle a person can see (app open, resume, manual, first run, sign-out); DEBUG for the timer and background writes | `trigger`, `deep`, `firstEver`, `attempt` |
| `SYNC_PULL_STARTED` / `SYNC_PUSH_STARTED` | DEBUG | sizes and counts only |
| `SYNC_PULL_SUCCESS` | INFO when something was applied, else DEBUG | rows received, created, updated, deleted; per table; the server's request id |
| `SYNC_PUSH_SUCCESS` | INFO when something left the phone, else DEBUG | `pushed` / `skipped` / `rejected`; the server's request ids; **`sentIds`** — the ids of the rows sent, per table, at most 20 a table and 60 in all (`sentIdsTruncated`). Ids are random values and say nothing about a row |
| `SYNC_SUCCESS` | INFO when something changed, else DEBUG | the cycle finished with no failure |
| `SYNC_PARTIAL_SUCCESS` | WARN | the server refused some rows (`SYNC-005`) |
| `SYNC_SLOW` | WARN | the whole cycle took ≥ `NEXT_PUBLIC_SLOW_SYNC_THRESHOLD_MS` (default 8000), written after `SYNC_COMPLETED` with the cycle's `sync_id`, `ok`, `pushed`, `pulled` and `duration_ms` |
| `SYNC_PAYLOAD_REJECTED` | WARN | which rows were refused and the server's reason (capped at 20) — the one place ids are always written |
| `SYNC_SIZE_LIMIT_EXCEEDED` | WARN | a request answered 413 (`SYNC-004`): which batch, its rows and bytes, the server's request id |
| `SYNC_FAILED` | WARN (offline) / ERROR | as before, plus `attempt`, `trigger` and `serverRequestId` — the key to the server's side of the failure |
| `SYNC_RETRY` | WARN | a cycle that starts after a failed one: `attempt`, `previousKind` |
| `SYNC_CONFLICT` | INFO | the server's newer copy of a row replaced one this phone had changed since it last pushed (the newer edit wins, `SYNC-006`): how many, which rows (capped), `winner: server`. Not raised on the first sync of an account (nothing to compare against) |
| `SYNC_COMPLETED` | INFO when something changed, else DEBUG | the end of every cycle, whatever happened: `ok` and all the counts |
| `SYNC_RERUN_QUEUED` | DEBUG | a sync was asked for while one was running: one more run is queued |
| `SYNC_PENDING` | DEBUG | a local write is waiting for the next sync (`sync_status: PENDING`) |
| `SYNC_CORRELATION_UNSUPPORTED` | INFO | the server did not accept the correlation headers (see below) |

A quiet cycle stays quiet: one that found nothing to do writes DEBUG lines only, so the log holds what changed and what
failed, not every 45-second tick. Nothing here contains a row, a title, an amount, an e-mail address or the token.

### Reconstructing an incident

*"I recorded an expense on my phone but it is not on the web."* From the user, a time and the entity id:

```
phone  <OP>_SUCCESS   entity_id=…  local_event_id=lev_…  sync_status=PENDING         (search: entity_id)
phone  SYNC_PUSH_SUCCESS  whose sentIds contain that id → sync_id=sync_…, serverRequestIds=[req_…]
server every record with that sync_id: HTTP_REQUEST_COMPLETED (status, duration), SYNC_PUSH_SUCCESS (counts)
phone  SYNC_COMPLETED / SYNC_FAILED / SYNC_PARTIAL_SUCCESS with the same sync_id
web    the next data refresh
```

If the id is in no push, the change never left the phone: look for `SYNC_FAILED` / `SYNC_RETRY` after the write, and for
a phone that is offline or signed out. If it was rejected, `SYNC_PAYLOAD_REJECTED` names it and says why. If the
server never logged the cycle's `sync_id`, the request did not reach it (or the server predates the headers — see
below). This path is exercised end to end, phone and server, in `src/testing/syncCorrelation.e2e.test.ts`.

### An app that is newer than its server

The app calls the server from a WebView with another origin, so the browser asks the server's permission (a CORS
preflight) for each header it sends. A server built before phase 1 does not list the correlation headers, so the browser
refuses the request, and `fetch` reports that exactly like being offline. Updating the app before the server would
therefore have stopped every sync. `remoteFetch` handles it: a request that fails that way is retried once without the
headers (safe — a refused preflight means the request was never sent); if that works the server does not accept them,
`SYNC_CORRELATION_UNSUPPORTED` is written once, requests go without them for half an hour, and then they are tried again,
so an upgraded server is noticed without restarting the app. Being really offline behaves as it always did.

**Deploy order: the server first, then the APK.** `src/lib/nativeCors.test.ts` keeps the two lists from drifting: every
header the app adds must be in the server's allow-list, on every route the phone calls.

### Naming

The requirement's example names `EXPENSE_CREATED_LOCAL` and `SYNC_PENDING` are, here, `EXPENSE_CREATE_SUCCESS` with
`layer: local` and `SYNC_PENDING`: one name for an operation on both platforms, and `layer` says where it happened.

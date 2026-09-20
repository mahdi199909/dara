# Logging synchronisation

Sync between a phone and the server is the most delicate flow in Parva: a change made offline on the
phone must reach the server and then the web, without loss or duplication. A support question like
*"I recorded an expense on my phone but it is not on the web"* must be answerable from the logs, step by
step. Status: **[done]** exists today, **[planned 4]** with the sync-correlation work.

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

## Planned **[planned 4]**

**One id for the whole cycle.** Each cycle gets a `sync_id`; every record the phone writes during it
carries it, and it is sent to the server (`X-Parva-Sync-Id`, with `traceparent` and
`X-Parva-Device-Id`), so the server's records for the same cycle have the same id:

```
phone   SYNC_STARTED          sync_id=sync_…  trigger=resume
phone   SYNC_PULL_STARTED / SYNC_PULL_SUCCESS   record_count, duration_ms
phone   SYNC_PUSH_STARTED     record_count, payload_size
server  HTTP_REQUEST_COMPLETED  POST /api/sync/push  request_id=req_…  sync_id=sync_…  status=200  duration_ms
server  SYNC_PUSH_SUCCESS     created/updated/skipped/rejected per table, tombstones applied
phone   SYNC_COMPLETED        created, updated, deleted, rejected, duration_ms
```

Failures use `SYNC_FAILED`, `SYNC_RETRY`, `SYNC_PARTIAL_SUCCESS` (server refused some rows),
`SYNC_PAYLOAD_REJECTED` (ids and reasons, capped), `SYNC_SIZE_LIMIT_EXCEEDED` (a 413 and the split that
followed), `SYNC_CONFLICT` (a last-write-wins skip). Entity ids per row are logged only at DEBUG (or
always for rejected rows), so "did entity X go through?" can be answered by raising `SYNC=debug` for that
user for a short while.

**Reconstructing an incident** from `user_id` + `timestamp` + `entity_id`:

```
phone  EXPENSE_CREATE_SUCCESS (layer local, local_event_id, sync_status PENDING)
phone  SYNC_STARTED → … SYNC_PUSH_STARTED (sync_id)
server HTTP_REQUEST_COMPLETED (request_id, sync_id) → auth → validation → database → response
phone  SYNC_COMPLETED / SYNC_FAILED / SYNC_PARTIAL_SUCCESS (rejected row + reason)
web    the next data refresh
```

Success is only ever logged after the operation is committed: the server logs `SYNC_PUSH_SUCCESS`
after its writes returned, and the phone logs `SYNC_COMPLETED` after it stored the new cursors.

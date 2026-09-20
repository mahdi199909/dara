# Debugging with the logs

## Reading logs (phases 0–1)

**Server.** The app writes one JSON object per line to stdout; Docker keeps it (rotated: five files of
20 MB per container once the phase-1 `docker-compose.yml` is deployed). Every record of one request
shares its `request_id`, and the same id is in the `X-Request-Id` response header and in the `requestId`
of an error body — so *"what happened to this request?"* is one search:

```bash
# everything one request did (the id comes from the person's screenshot / the response)
docker logs parva-app-1 --since 24h 2>&1 | jq -c 'select(.request_id == "req_01M2ZYFN7M8FZEBAAME2FDSWC5")'

# what went wrong in the last hour
docker logs parva-app-1 --since 1h 2>&1 | jq -c 'select(.level == "ERROR" or .level == "CRITICAL")'

# failures by code
docker logs parva-app-1 2>&1 | jq -r 'select(.error_code != null) | .error_code' | sort | uniq -c | sort -rn

# the slowest requests / database calls
docker logs parva-app-1 2>&1 | jq -c 'select(.event == "API_SLOW_REQUEST") | {path, duration_ms, dbQueries: .metadata.dbQueries, dbMs: .metadata.dbMs}'
docker logs parva-app-1 2>&1 | jq -c 'select(.event == "DB_SLOW_QUERY") | {entity_type, operation, duration_ms}'

# who is failing to log in (hashed accounts, IPs)
docker logs parva-app-1 2>&1 | jq -c 'select(.event == "AUTH_LOGIN_FAILED" or .event == "AUTH_RATE_LIMITED") | {timestamp, ip: .metadata.ip, account: .metadata.emailHash, reason: .metadata.reason}'

# what did the last sync from a phone do?
docker logs parva-app-1 2>&1 | jq -c 'select(.module == "sync") | {timestamp, event, counts: .metadata.counts, rejections: .metadata.rejections}'
```

(`2>&1` because `docker logs` replays the container's stderr on stderr.) Successful *reads* are logged
at DEBUG only, so the default INFO shows writes, failures and security events. To watch everything for
a while: set `LOG_LEVEL=debug` in the server's `.env` and `docker compose up -d`, and set it back.

**Development.** `npm run dev` prints one readable line per record (`LOG_FORMAT=pretty`);
`LOG_LEVEL=debug` is the default there. **Tests** are quiet (errors only); a test that needs to see
what was logged uses `installMemoryLogger()` from `src/lib/observability/testing.ts`.

**Phone.** The WebView writes each record as an expandable object to the console — open
`chrome://inspect` on a computer with the phone connected. A persistent local log file and a
diagnostics export arrive in phase 4 (see [android.md](android.md)).

## Turning detail up

Per environment, no code change: set `LOG_LEVEL` and redeploy, e.g. only sync at DEBUG while the rest
stays at INFO:

```
LOG_LEVEL=info,SYNC=debug
```

Keys match an event's domain (`SYNC`, `AUTH`, `DB`, `HTTP`…), a module (`finance`, `sync`, `widgets`)
or a logger's component (`sync-runner`). Inside a running process
`LoggerCore.levels.setOverride("SYNC", "DEBUG", ttlMs)` and `setUserOverride(userId, "DEBUG", ttlMs)`
do the same without a redeploy and expire on their own; an admin endpoint for it is planned (phase 5).
Slow-request and slow-query thresholds: `LOG_SLOW_REQUEST_MS` (1000) and `LOG_SLOW_QUERY_MS` (300).

## What the code emits today

Server request path (phase 1):

| Event | Level | Meaning | Where |
| --- | --- | --- | --- |
| `HTTP_REQUEST_COMPLETED` | DEBUG (GET 2xx) · INFO (write 2xx) · WARN (4xx) · ERROR (5xx) | one per API request: `method`, `path`, `status_code`, `duration_ms`, `error_code`, `metadata.route`, `dbQueries`, `dbMs` | `withApiLogging` |
| `HTTP_REQUEST_STARTED` | DEBUG | the request arrived | `withApiLogging` |
| `API_SLOW_REQUEST` | WARN | the request took ≥ `LOG_SLOW_REQUEST_MS` (with its database share) | `withApiLogging` |
| `API_UNHANDLED_ERROR` | ERROR | a route handler (server) or the on-device dispatcher threw something unexpected; `error_code` `SYS-001` or a `DB-…` code; stack on the server only | `handleApiError`, `withApiLogging`, `dispatchLocal` |
| `DB_QUERY_ERROR` / `DB_CONNECTION_ERROR` / `DB_CONNECTION_POOL_EXHAUSTED` | WARN (constraint, missing row) / ERROR | a Prisma call failed: model, operation, duration, `DB-001…007`; **no SQL, no arguments** | `prisma.ts` |
| `DB_SLOW_QUERY` | WARN | a Prisma call took ≥ `LOG_SLOW_QUERY_MS`; model + operation only | `prisma.ts` |
| `AUTH_LOGIN_FAILED` / `AUTH_RATE_LIMITED` / `AUTH_REGISTER_FAILED` | WARN | security events: reason, IP, hashed account (`AUTH-001/002/005`) | `authEvents.ts` |
| `AUTH_SESSION_INVALID` / `AUTH_FORBIDDEN` | WARN | no/invalid session (`AUTH-003`, from the Edge middleware or the route), or a non-owner on an admin route (`AUTH-004`) | `middleware.ts`, `auth.ts`, `admin.ts` |
| `AUTH_LOGIN_SUCCESS` / `AUTH_REGISTER_SUCCESS` / `AUTH_LOGOUT_SUCCESS` | INFO | who signed in/out (user id, IP on the first two) | `authEvents.ts` |
| `SYNC_PUSH_SUCCESS` / `SYNC_PARTIAL_SUCCESS` / `SYNC_PULL_SUCCESS` | DEBUG–INFO / WARN / DEBUG–INFO | what a sync request did: rows per table, written / skipped / refused, and the *kinds* of refusal | `syncLog.ts` |
| `SYSTEM_STARTED` / `SYSTEM_UNHANDLED_ERROR` / `SYSTEM_SHUTDOWN` | INFO / CRITICAL / INFO | process lifecycle | `startup.ts` |

Everywhere (phase 0):

| Event | Level | Meaning | Where |
| --- | --- | --- | --- |
| `AUDIT_WRITE_FAILED` | ERROR | an audit entry could not be written; the operation itself was unaffected (`AUDIT-001`); ids only, never the audited values | `writeAuditLog`, `writeLocalAuditLog` |
| `TASK_UPDATE_SUCCESS` and the other `*_SUCCESS` operation events | INFO | a write committed and was recorded in the history: `entity_type`, `entity_id`, `operation`, `changedFields` (names only), `auditId` / `local_event_id` — one per audited write, server and phone | `writeAuditLog`, `writeLocalAuditLog` |
| `JOB_COMPLETED` / `JOB_FAILED` (`job: audit-retention`) | INFO / ERROR | the daily prune of old audit entries (`deleted`, `retentionDays`); DEBUG when nothing was old enough | `auditRetention` |
| `BACKUP_COMPLETED` / `RESTORE_COMPLETED` / `RESTORE_PARTIAL` / `BACKUP_FAILED` / `RESTORE_FAILED` | INFO / INFO / WARN / ERROR | a backup file was made / restored (counts only) — on the phone and, reported by the browser, on the server | `backupAudit`, `/api/backup/record` |
| `SYNC_FAILED` | WARN/ERROR | a sync cycle did not finish; `metadata.kind` = network / auth / too-large / server / unknown, `error_code` `SYNC-001…009` | `runSync`, `syncScheduler` |
| `SYNC_PULL_ROW_FAILED` | WARN | a row from the server could not be stored on the device (`SYNC-008`); table + id only | `pullRemoteChanges` |
| `DB_LOCAL_RECOVERED` | ERROR | the on-device database file was corrupt and its backup copy was loaded (`DB-008`) | `browserSqlJs` |
| `DB_LOCAL_FLUSH_CALLBACK_FAILED` | ERROR | the handler that runs after the device database is saved failed | `browserSqlJs` |
| `IMPORT_ROW_FAILED` | WARN | a backup row could not be inserted on this pass (it may be retried); table + id only | `importAllData` |
| `WIDGET_QUEUE_FAILED` | ERROR | a queued widget action failed and stays queued (`WIDGET-001`); never what was typed | `widgetQueue`, boot/resume |
| `WIDGET_REFRESH_FAILED` | ERROR | a widget repaint or its data failed (`WIDGET-002`); `metadata.step` says which | `widgetRefresh` |
| `LOCAL_NOTIFICATION_FAILED` / `_PERMISSION_FAILED` | ERROR / WARN | scheduling, moving or cancelling an OS reminder failed (`NOTIF-001`), or permission was not granted (`NOTIF-002`); `operation`, reminder id | `nativeNotifications` |
| `CAPITAL_SNAPSHOT_FAILED`, `CATEGORY_DEFAULTS_FAILED`, `SETTINGS_THEME_SYNC_FAILED`, `SYSTEM_DEEP_LINK_FAILED` | ERROR / WARN | boot/resume tasks that failed without stopping the app | `FirstRunGate`, `WidgetQueueDrainer`, … |
| `RELEASE_READ_FAILED`, `RELEASE_UPDATE_CHECK_FAILED` | WARN | the release override row could not be read (built-in release used) / the app could not ask about updates (`RELEASE-001`) | `appRelease`, update banner |
| `LOG_LEVEL_CHANGED` | INFO | a level was changed at runtime | `Logger.setLevel/setOverride` |
| `LOG_INTERNAL_ERROR` | ERROR | a record could not be built; a reduced one was written (`LOG-001`) | logger |

Every event is documented, including those reserved for later phases, in [events.md](events.md);
every code in [error-codes.md](error-codes.md).

## Playbooks

**"I got an error."** Ask for the request id (the app will show it once phase 4 lands; today it is in
the `requestId` of the error response, e.g. from the browser's network tab). Search the log for it:
you get the request line, the auth context, each database failure, the unhandled error with its
stack, and the completion record with the status and code — in order.

**Sync keeps failing on one phone.** Find `SYNC_FAILED` and read `metadata.kind`:
`network` (`SYNC-001`) offline/blocked; `auth` (`SYNC-003`) the server refuses the session — sign out and in;
`too-large` (`SYNC-004`) a request exceeded the proxy limit (should self-heal by batching — a repeat
is a bug); `server` (`SYNC-002`) the server answered 5xx — look at the server's own `HTTP_REQUEST_COMPLETED`
(`path` `/api/sync/push`, `status_code` ≥ 500) and the `API_UNHANDLED_ERROR` next to it at that time;
`unknown` (`SYNC-009`) read `error`. `SYNC_PULL_ROW_FAILED` lists rows the phone could not store. On
the server, `SYNC_PARTIAL_SUCCESS` says how many rows a push had refused and why
(`Transaction: amount: value is larger than the server allows`, `Habit: parent row not found for this account`).

**A login problem.** `AUTH_LOGIN_FAILED` with `reason: no_such_user` means the address is not registered
(or was mistyped); `wrong_password` means it exists. The same `emailHash` across lines is the same
account. `AUTH_RATE_LIMITED` means ten failures in ten minutes from one address for one account.

**Something changed and nobody knows why.** The audit trail is the source: Settings → History (or
`GET /api/audit-logs`). Each entry says which fact it records (`event`), which request wrote it
(`requestId` — the same id the application log carries, so `jq 'select(.request_id == "req_…")'` gives the
rest of the story) and, for an update, what exactly changed (`changes`). On the phone the join key is
`localEventId` ↔ `local_event_id`. Application logs explain *system* behaviour, not user actions; queries
for both are in [audit.md](audit.md).

**The server is slow.** `API_SLOW_REQUEST` shows `dbQueries` and `dbMs`: a request with a large `dbMs` is
waiting on the database (look at `DB_SLOW_QUERY` with the same `request_id` for the model and
operation); one with a small `dbMs` is spending its time elsewhere (bcrypt on login, for one).

## Reconstructing "the expense is on the phone but not on the web"

What can be established now: the phone's sync outcomes (`SYNC_FAILED` kinds), the rows it failed to
apply (`SYNC_PULL_ROW_FAILED`), what the server did with each push (`SYNC_PUSH_SUCCESS` /
`SYNC_PARTIAL_SUCCESS`, by table and reason), and what the audit trail recorded on each side. What is
still missing, and comes with phase 4, is the *link* between the two logs: the phone will send its
`sync_id`, `device_id` and a `traceparent` (the server already accepts and stamps them) and tag each
local write with a `local_event_id`. See [sync.md](sync.md) for the intended timeline.

# Debugging with the logs

## Reading logs today (phase 0)

**Server.** The app writes one JSON object per line to stdout; Docker keeps it.

```bash
docker logs parva-app-1 --since 1h | jq -c 'select(.level == "ERROR" or .level == "CRITICAL")'
docker logs parva-app-1 | jq -c 'select(.event == "API_UNHANDLED_ERROR") | {timestamp, error_code, error: .error.message}'
docker logs parva-app-1 | jq -c 'select(.error_code != null) | .error_code' | sort | uniq -c | sort -rn
```

(Docker's json-file driver is not rotated on the VPS yet — that is part of phase 1. Until then, do
not turn the level to DEBUG for long.)

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

Keys match an event's domain (`SYNC`, `AUTH`, `DB`…), a module (`finance`, `sync`, `widgets`) or a
logger's component (`sync-runner`). Inside a running process `LoggerCore.levels.setOverride("SYNC",
"DEBUG", ttlMs)` and `setUserOverride(userId, "DEBUG", ttlMs)` do the same without a redeploy and
expire on their own; an admin endpoint for it is planned (phase 5).

## What the code emits today

| Event | Level | Meaning | Where |
| --- | --- | --- | --- |
| `API_UNHANDLED_ERROR` | ERROR | a route handler (server) or the on-device dispatcher threw something unexpected; `error_code` `SYS-001` or a `DB-…` code | `handleApiError`, `dispatchLocal` |
| `AUDIT_WRITE_FAILED` | ERROR | an audit entry could not be written; the operation itself was unaffected (`AUDIT-001`); ids only, never the audited values | `writeAuditLog`, `writeLocalAuditLog` |
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

**Sync keeps failing on one phone.** Find `SYNC_FAILED` and read `metadata.kind`:
`network` (`SYNC-001`) offline/blocked; `auth` (`SYNC-003`) the server refuses the session — sign out and in;
`too-large` (`SYNC-004`) a request exceeded the proxy limit (should self-heal by batching — a repeat
is a bug); `server` (`SYNC-002`) the server answered 5xx — look at the server's own errors at that
time; `unknown` (`SYNC-009`) read `error`. `SYNC_PULL_ROW_FAILED` lists rows the phone could not store.

**Something changed and nobody knows why.** The audit trail is the source: Settings → History (or
`GET /api/audit-logs`). Application logs explain *system* behaviour, not user actions.

**An error the person saw.** They saw the generic message; the server's `API_UNHANDLED_ERROR` record
has the cause and stack, with the `error_code` to search for.

## Reconstructing "the expense is on the phone but not on the web"

Today you can establish: the phone's sync outcomes (`SYNC_FAILED` kinds), rows it failed to apply
(`SYNC_PULL_ROW_FAILED`), and what the audit trail recorded on each side. What is still missing, and
comes with the planned phases, is the *link* between the two: a `request_id` on every server record
(phase 1), a `sync_id` shared by the phone's and the server's records and a `local_event_id` per
write (phase 4), and the server logging what each push applied or refused (phase 4). See
[sync.md](sync.md) for the intended timeline.

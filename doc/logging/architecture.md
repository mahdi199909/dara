# Logging architecture

Parva's logging is a subsystem of its own (`src/lib/observability/`), not scattered `console.log`
calls. Its purpose: **if a person says a year later "my data is wrong", we can reconstruct what
happened** — without logging more than that, without leaking anything private, and without ever
slowing down or breaking the application.

Status of each part is marked **[done]** (phases 0 to 5, in the code today) or **[planned N]** (phase N
of the rollout below). Nothing marked planned is claimed to exist.

## 1. Three layers, deliberately separate

| Layer | Question it answers | Where it lives | Retention |
| --- | --- | --- | --- |
| **Application log** | What is the system doing, and what went wrong? (technical, for developers) | server: stdout JSON lines → Docker's rotated `json-file` log **[done]**; on the phone a rotated local file **[planned 4]**. Never in PostgreSQL. | server: a ~100 MB ring in Docker; a 14-day file/shipper is **[planned 5]** |
| **Audit log** | What did the *person* change, and when? (part of the product: Settings → History) | the existing `AuditLog` table, on the server and on the device | long (default 2 years), independent, configurable **[done, phase 2]** |
| **Observability data** | How is the system behaving? (rates, latency, failures) | in-process metrics registry, `/api/admin/metrics` **[planned 5]**; trace/span ids on every record | live |

The audit log is **not** replaced or changed by the application log: `writeAuditLog` and
`writeLocalAuditLog` keep their signatures, tables and the History screen. Phase 2 *extended* it —
additive columns, the canonical event, the request that wrote each row, a field-level diff for updates,
retention, and the routes that used to leave no trace — see [audit.md](audit.md).

## 2. What exists now (phase 0) **[done]**

```
call site ──► Logger (handle: module/component/bound context)
                 │
                 ▼
            LoggerCore ── LevelController (base, per-domain/module/component, per-user, TTL)
                 │      ── context: static + providers + bound + call fields
                 │      ── event registry (name, default level/message, protected/security)
                 │      ── sampling (never ERROR+, security, protected)
                 │      ── redaction + size limits ── error serialisation
                 ▼
           LogSink[]  ── ConsoleSink (json | object | pretty)
                       ── MemorySink (tests / ring buffer)
                       ── BatchingSink(any sink): bounded async queue, circuit breaker, fallback
```

Module layout:

- `core/levels.ts`, `core/levelControl.ts` — TRACE < DEBUG < INFO < WARN < ERROR < CRITICAL; `LOG_LEVEL=info,SYNC=debug` syntax; runtime overrides with TTL and a per-user "trace this person" override that can only make that user *more* verbose.
- `core/events.ts` — the typed event catalogue (see [events.md](events.md)). `EventName` is derived from it, so an unknown event does not compile.
- `core/errorCodes.ts` — `DOMAIN-NNN` codes (see [error-codes.md](error-codes.md)), plus `classifyError` (Prisma/Zod/Auth by shape) and `syncErrorCode`.
- `core/ids.ts`, `core/trace.ts` — ULID-based ids (`req_`, `sync_`, `lev_`, `sess_`, `dev_`, `job_`) and W3C `traceparent` parsing/formatting, so OpenTelemetry can be attached later without changing a call site.
- `core/redact.ts` — see [security.md](security.md).
- `core/sink.ts` — `LogSink` interface, console/memory/null sinks, `BatchingSink`.
- `core/sampling.ts`, `core/metrics.ts`, `core/diff.ts` — sampling, a tiny metrics registry (counters, histograms, Prometheus text), the field-level diff the audit trail will use.
- `core/logger.ts` — `Logger`/`LoggerCore`; `config.ts` — environment → configuration; `root.ts` — the shared logger and `getLogger()`; `testing.ts` — memory-logger helpers.

Usage:

```ts
import { getLogger } from "@/lib/observability";
const log = getLogger("sync", "runner");           // module + component

log.info("TASK_CREATE_SUCCESS", { taskId });        // context is added automatically
log.warn("SYNC_RETRY", { syncId, attempt });
log.error("SYNC_FAILED", { syncId, errorCode: "SYNC-002", error });

await log.operation("EXPENSE_CREATE", { expenseId }, async () => { /* work incl. commit */ });
//   EXPENSE_CREATE_STARTED (DEBUG) → EXPENSE_CREATE_SUCCESS (INFO, duration) | EXPENSE_CREATE_FAILED (ERROR, error, duration)
//   SUCCESS is written only after the callback returned — never before the commit.
```

A getLogger(null, "component") handle has no fixed module: each event then takes the module of its
own domain, so `LOG_LEVEL=info,SYNC=debug` reaches it.

## 2b. The server pipeline (phase 1) **[done]**

Every API request now travels through one instrumented path:

```
client ──► nginx ──► middleware.ts (Edge)         401 for a missing/invalid session: AUTH_SESSION_INVALID + X-Request-Id
                        │
                        ▼
                 route handler, wrapped by withApiLogging(method, "/api/tasks/[id]", handler)
                        │   beginRequest: request_id (ours), trace_id/span_id (adopts a valid `traceparent`),
                        │                 device_id / sync_id from the app's headers (validated)
                        │   an AsyncLocalStorage carries it to everything below
                        ▼
      requireUserId ─► setRequestUser (every later record has user_id) · AUTH_SESSION_INVALID
      business code ─► prisma.* ─► observability extension: timing, DB_SLOW_QUERY, DB_QUERY_ERROR (+ per-request tally)
      handleApiError ─► { error, code, requestId } · API_UNHANDLED_ERROR (with stack, server-side only)
                        │
                        ▼
      HTTP_REQUEST_COMPLETED  method · path · status_code · duration_ms · error_code · route · dbQueries · dbMs
      API_SLOW_REQUEST        when duration_ms ≥ LOG_SLOW_REQUEST_MS
```

Modules (`src/lib/observability/server/`, server-only — the Android export never bundles them):

| File | Role |
| --- | --- |
| `requestContext.ts` | the per-request context on an `AsyncLocalStorage` (kept on `globalThis`, so a second bundle of the module shares it), header validation, the context provider that stamps records |
| `withApiLogging.ts` | the route wrapper: runs the handler inside the context, writes the completion record, sets `X-Request-Id`, counts `http_requests_total` / `http_request_duration_ms`; if any of that fails the handler's response still goes out |
| `prisma.ts` | the Prisma client extension (`$allOperations`): duration, slow-query line, failure classification (DB-001…DB-007) — **no SQL, no arguments**; the engine's `error`/`warn` events, scrubbed |
| `authEvents.ts` | login/register/logout/rate-limit/forbidden/invalid-session events; e-mails only as a keyed hash |
| `syncLog.ts` | what a sync push/pull did, as counts per table and *kinds* of refusal |
| `startup.ts` | `SYSTEM_STARTED`, a structured CRITICAL for an uncaught exception / unhandled rejection, `SYSTEM_SHUTDOWN`; started by `src/instrumentation.ts` |

How a route is wired (all 64 are; `OPTIONS` preflights are not):

```ts
async function GET(req: NextRequest) { … }                     // unchanged
const loggedGET = withApiLogging("GET", "/api/tasks", GET);    // the route pattern, not the real path
export { loggedGET as GET };
```

**Levels.** A successful read (`GET`) completes at DEBUG, a successful write (`POST/PATCH/DELETE`) at
INFO, any 4xx at WARN, any 5xx at ERROR — so production INFO shows what changed and what failed, not
every page load; `LOG_LEVEL=debug` (or `LOG_LEVEL=info,HTTP=debug`) shows everything.

**Error responses.** Every error body now has a stable `code` and the `requestId`:
`{ "error": "<Persian message>", "code": "AUTH-001", "requestId": "req_…" }` (validation errors still
carry `details`). `ApiError` can name its code; otherwise one is derived from the status
(400/422 → `VAL-001`, 401 → `AUTH-003`, 403 → `AUTH-004`, 404 → `DB-007`, 429 → `AUTH-002`, 5xx → `SYS-001`,
or the database code when Prisma failed). A person quoting the request id lets you find the whole
story with one search.

**What is never logged:** request bodies, query strings, headers, cookies, tokens, SQL, Prisma
arguments, money, titles/notes, e-mail addresses. See [security.md](security.md).

**Process events.** `SYSTEM_STARTED` (node version, pid, level), `SYSTEM_UNHANDLED_ERROR` (CRITICAL),
`SYSTEM_SHUTDOWN`. Next.js already keeps the process alive after an uncaught error; ours only makes it
visible.

**Docker.** `docker-compose.yml` caps each container's log at 5 × 20 MB (Postgres 3 × 10 MB) so logs
can never fill the disk, and passes `GIT_COMMIT` so every record says which build wrote it.

## 2c. Atomic operations (phase 3) **[done]**

**The rule.** An operation that writes more than one row — a task and its expense, an installment and the payment
that settles it, a timer and the total it feeds — is one database transaction: every write commits together or none
does. And what says "it worked" (the history entry, the `*_SUCCESS` line) is written only once the commit has
happened, so the logs and the History screen can never claim something that was rolled back.

### The server: `withTransaction` (`src/lib/transaction.ts`)

```ts
const { task, fresh } = await withTransaction(
  async () => {
    const task = await prisma.task.create({ … });
    if (task.directCost > 0) await syncTaskDirectCostTransaction(task.id);   // helpers join by themselves
    return { task, fresh: await prisma.task.findUnique({ … }) };
  },
  { operation: "TASK_CREATE", entityType: "Task" }
);
await writeAuditLog({ … });   // reached only after the commit
```

How helpers join without being handed anything: `prisma` (from `src/lib/db.ts`) is a thin proxy. While a
`withTransaction` callback runs, an `AsyncLocalStorage` (`observability/server/transactionContext.ts`) holds the Prisma
transaction client and the proxy routes every call to it; outside a transaction it is the ordinary client. A
`withTransaction` inside another simply joins it — the outermost one owns the commit and the rollback.
**Pitfall:** never keep a model delegate taken outside a transaction (`const model = prisma.task`) and use it inside:
it would bypass the transaction (and, on SQLite, deadlock against it). Resolve delegates inside the callback, as
`sync/push` and `tombstones.ts` do.

| Outcome | What the log says |
| --- | --- |
| commit | `DB_TRANSACTION_COMMIT` (DEBUG, `duration_ms`); then the work queued with `afterCommit()` runs: the audit row and the `*_SUCCESS` line |
| the callback failed | `DB_TRANSACTION_ROLLBACK` and, when an operation was named, `<OPERATION>_FAILED` (`TASK_CREATE_FAILED` …) with the stack; queued work is discarded |
| the caller's own mistake (404, 409, invalid input) | the same lines one level down (DEBUG / WARN instead of WARN / ERROR): it is the expected outcome, and the request record says so too |
| the transaction itself failed (timeout, lost connection, failed commit) | `DB_TRANSACTION_FAILED` (ERROR, `DB-003`); Prisma's `P2028` / `P2034` classify as `DB-003` |

The error is then answered by `handleApiError` as before (`{ error, code, requestId }`, 500) but is not logged a second
time: a transaction that already wrote `<OPERATION>_FAILED` marks the error as reported. Metrics:
`db_transactions_total{outcome}` and `db_transaction_duration_ms`.

Limits: an interactive transaction waits at most 5 s for a connection and runs at most 15 s. Audit entries stay
*after* the commit on the server (a failed insert would poison a PostgreSQL transaction); one that cannot be stored is
`AUDIT_WRITE_FAILED` and never fails the operation.

**Where it is used:** every route that writes more than one row — tasks, activities (with the timer and time
entries), projects, events, habit check-ins, installment plans and the payment of an installment, assets, categories,
settings, quick capture, the sync push's "delete + tombstone" step, and the shared tombstone helpers
(`src/lib/tombstones.ts`).

**Installment payment is exactly once.** The installment is claimed with a conditional update (`status ≠ PAID → PAID`)
inside the transaction that also creates the expense: of two payments made at the same moment one wins and the other
gets 409 and writes nothing, and a failure between the two steps leaves neither.

### The phone: `withLocalTransaction` (`src/local/transaction.ts`)

The same rule and the same events (with `layer: "local"`) for the on-device SQLite:

- `dispatchLocal` runs every non-GET route inside one transaction (`src/lib/localDispatcher.ts`): the handler, its audit
  entry included, commits together or not at all. Reads are left alone (each write to the driver schedules a save of
  the whole file).
- `OPERATION_OF_ROUTE` names the operation each route performs (`TASK_CREATE_FAILED` …). A route without a name is just
  as atomic — only its failure has no name of its own; a test makes every new write route pick one list or the other.
- The success line waits for the commit (`afterLocalCommit`). The audit entry is stored *inside* the transaction, so a
  rollback removes it together with the change (on SQLite a failed insert does not poison the transaction).
- The callback must be **synchronous**. The phone's database is one in-memory SQLite that is written to a file from a
  timer and on `pagehide`; a transaction left open across an `await` could be exported half-written. An async callback
  is refused and rolled back.
- Also transactional now: the first start (user + settings + default categories), adding missing default categories,
  merging duplicate categories, applying one widget-queue entry (an activity and its time, or a check-in — a retried
  entry can no longer leave half of itself behind), the calendar-file import, and the three blocks that used to write
  `BEGIN` / `COMMIT` by hand (backup import, the wipe when another account signs in, applying a sync pull), which now
  use the same wrapper.

### Testing

Failures are injected with SQLite triggers that abort the *last* write of an operation (`RAISE(ABORT)`), after the
earlier ones have been made. The tests assert that nothing is left behind, that no history entry and no success line
exist, that the failure is logged once with a code, and that the same request succeeds once the fault is removed.
Server: `src/testing/transactions.e2e.test.ts` (the primitive) and `src/testing/atomicOperations.e2e.test.ts` (the
routes); phone: `src/local/transaction.test.ts` and `src/local/atomicOperations.test.ts`. The route suites were also run
with the transaction switched off, to confirm that they fail without it.

**Deliberately not one transaction:** the rows of a sync push (each is applied on its own — a bad row must not block
the good ones, see `SYNC_PARTIAL_SUCCESS`), the retention jobs, and effects outside the database (OS notifications).

## 2d. The phone's log and the sync correlation (phase 4) **[done]**

The Android app now keeps its own log and ties it to the server's:

- a rotated, compressed JSON-lines file in the app's private storage, written in batches off the action path, capped
  in size and age, that can fail without the app noticing (`src/lib/observability/client/`);
- a random device id, the Android version, the time zone and — once linked — the server's user id on every record;
- a `sync_id` and a W3C trace for every sync cycle, sent to the server as `X-Parva-Sync-Id` / `traceparent` /
  `X-Parva-Device-Id`, so the phone's and the server's records of one cycle share ids, and the phone quotes the server's
  `X-Request-Id`;
- `sync_status: PENDING` and a `local_event_id` on every local write, OS-reminder and widget-queue events, and the
  errors nobody catches (`SYSTEM_UNHANDLED_ERROR`, `UI_RENDER_ERROR`);
- a diagnostic report the person can build and send from Settings.

Details: [android.md](android.md) (the file, identity, what is written, the report, the budget) and [sync.md](sync.md)
(the cycle, the events, incident reconstruction, the rollout rule: **deploy the server before the APK**).

Tests: the sink's rotation, retention, compression and failure handling (`core/rotatingFileSink.test.ts`), the install and flush
behaviour (`install.test.ts`), the report and its redaction (`diagnostics.test.ts`), global errors
(`globalErrors.test.ts`), the headers and their fallback (`remoteFetch.test.ts`), the cycle's events against a scripted
server, the acceptance scenarios 4–6 (`src/local/syncLogging.test.ts`), the CORS guard (`nativeCors.test.ts`) and the
whole path, phone to server (`src/testing/syncCorrelation.e2e.test.ts`).

## 2e. Server destinations, administration and dashboards (phase 5) **[done]**

**Where the server's records go.** stdout always (Docker rotates it), and, when configured:

- a **rotated file** (`LOG_FILE_DIR`; the compose volume `hesabkon_logs` at `/app/logs`): the same `RotatingFileSink` as the
  phone's, told different limits — 20 MB a file, gzip on rotation, kept `LOG_RETENTION_DAYS` days (default 14; 7, 30 and 90
  are the usual choices; `0`/`off` keeps them until the size ceiling), never more than `LOG_FILE_MAX_MB` (300) together;
- a **central collector** (`LOG_REMOTE_URL`, `LOG_REMOTE_TOKEN`, `LOG_REMOTE_MIN_LEVEL`, default WARN): one HTTP POST per
  batch of newline-delimited JSON, which Vector, Fluent Bit, Logstash's `http` input and OpenObserve accept.

Both sit behind a `BatchingSink` (bounded queue, retry spacing, circuit breaker), so a slow or full disk and a dead collector
never reach a request; each failure is reported on the console at most once a minute, with its cause but never an address or
a token. A timer-driven flush writes what was queued when it started — full batches, unless the interval has run out or an
error is waiting — so a busy server sends a few full batches instead of a stream of tiny ones; on the way out (`exit`, which
is what Next.js turns SIGTERM into) what the file's queue still holds is written synchronously, `SYSTEM_SHUTDOWN` included.

**Retention.** The file sink deletes what expired whenever it rotates, and a daily job (`src/lib/logRetention.ts`) does it for a
quiet server as well: `JOB_STARTED` / `JOB_COMPLETED` / `JOB_FAILED` and `jobs_total{job,outcome}`. The audit trail has its own,
much longer retention ([audit.md](audit.md)).

**Performance events.** The thresholds are configurable: `SLOW_API_THRESHOLD_MS` (1000), `SLOW_DB_THRESHOLD_MS` (300),
`SLOW_SYNC_THRESHOLD_MS` (3000 — a sync request writes `SYNC_SLOW` instead of `API_SLOW_REQUEST`) and
`SLOW_REPORT_THRESHOLD_MS` (2000); the older `LOG_SLOW_*` names still work. Every report — on the server and on the phone,
one shared tracker (`core/reportRun.ts`) — writes `REPORT_GENERATION_STARTED` / `_COMPLETED` / `_FAILED` and `REPORT_SLOW` with
the period, the number of rows and the duration, and never a figure. Backups and restores carry their duration; the phone's
sync cycle writes `SYNC_SLOW` past `NEXT_PUBLIC_SLOW_SYNC_THRESHOLD_MS` (8 s).

**The owner's tools** (owner-only, `requireAdmin`; a panel for each on `/admin`):

| Endpoint | What it does |
| --- | --- |
| `GET` / `PUT` / `DELETE /api/admin/logging` | dynamic debugging: show and change the level for the whole server, one component (`SYNC=DEBUG`) or one account, with no restart. A verbose level always expires (30 minutes by default, 24 hours at most); everything can be put back to what the environment configured; each change is audited (`LOG_LEVEL_ADMIN_UPDATED`) and logged (`LOG_LEVEL_CHANGED`) |
| `GET /api/admin/health` | requests, error rate, p50/p95, slow requests, database, sync, sign-in failures, jobs, reports, the log pipeline and the last problems |
| `GET /api/admin/logs` | the support timeline, read from the rotated files: `user` (id or e-mail), `request`, `sync`, `entity`, `event`, `level`, `module`, `platform`, `version`, `code`, `since`, `until`, `limit`; redacted when written and again on the way out; reading it writes `LOG_QUERIED` |
| `GET /api/metrics` | Prometheus text, `Authorization: Bearer $METRICS_TOKEN`; does not exist unless the token (16 characters or more) is set |

**Dashboards.** The metrics behind the panels the specification asks for: total requests, error rate and latency
(`http_requests_total`, `http_request_duration_ms`), slow requests (`http_slow_requests_total`), database errors
(`db_queries_total{outcome}`), sync failures and duration (`sync_requests_total`, and the sync routes' entries in the two `http_*`
metrics), authentication failures (`auth_events_total`), failed jobs (`jobs_total`), report performance (`reports_total`,
`report_duration_ms`) — and every WARN-or-worse record by event name (`log_events_total{event,level}`), which covers notification
and backup failures without a metric of their own. Filtering by user, version, module, event or error code is what the log file
and the collector are for. All of it, with the configuration, the failure behaviour and the measured cost, is in
[operations.md](operations.md).

Tests: the shared file sink on a real folder (`nodeLogFileStore.test.ts`), the configuration (`logConfig.test.ts`), the HTTP sink
against a real local collector (`httpLogSink.test.ts`), the wiring and its failure behaviour (`serverSinks.test.ts`), the retention
job (`logRetention.test.ts`), the batching rules (`core/sink.test.ts`), the report tracker (`reportRun.test.ts`) and its use on the
server and on the phone, level administration (`adminLogging.test.ts`), the timeline's filters and redaction (`logSearch.test.ts`),
the health report (`healthReport.test.ts`), the metrics endpoint (`metricsEndpoint.test.ts`), the middleware's public paths
(`src/middleware.test.ts`) and the whole of it against the real routes and a real database (`src/testing/adminObservability.e2e.test.ts`,
`observabilityPipeline.e2e.test.ts`).

## 3. The record

One JSON object per line. Optional fields are omitted when unknown (absent = null); `metadata` is
always present.

```json
{
  "timestamp": "2026-09-20T12:44:23.000Z", "level": "ERROR", "event": "SYNC_FAILED",
  "message": "A sync cycle did not finish.", "service": "parva-android", "module": "sync", "component": "runner",
  "environment": "production", "app_version": "1.1.0", "git_commit": "6eb6614",
  "session_id": "sess_…", "platform": "android", "layer": "local",
  "error_code": "SYNC-001", "error": { "type": "TypeError", "message": "Failed to fetch" },
  "metadata": { "kind": "network", "pulledCount": 0, "pushedCount": 0 }
}
```

Fields: `timestamp` (always UTC), `level`, `event`, `message`, `service` (`parva-api` | `parva-web` |
`parva-android`), `module`, `component`, `environment`, `app_version`, `build_number`, `git_commit`,
`user_id`, `session_id`, `request_id`, `trace_id`, `span_id`, `platform` (`server` | `web` |
`android`), `device_id`, `os_version`, `tz`, `entity_type`, `entity_id`, `operation`, `layer`
(`local` | `server`), `sync_id`, `local_event_id`, `sync_status`, `duration_ms`, `error_code`,
`error`, `metadata`.

Everything that has no dedicated field goes into `metadata`, after redaction and a size cap (8 KB
per record, values truncated, depth/array/key limits).

## 4. Context, ids and correlation

A developer never passes user/request/trace ids by hand: they come from **context providers**
(request scope on the server **[done]**, launch/device scope on a phone **[planned 4]**),
child-logger bindings, and finally the call's own fields (later wins). Today a phone/browser runtime
gets a `session_id` per launch; the server has none until a request supplies one.

Correlation ids: `request_id` (one per HTTP request), `trace_id`/`span_id` (W3C shape),
`session_id`, `device_id`, `sync_id` (one per sync cycle, sent to the server as a header so both
sides log the same id — the server already reads `traceparent`, `X-Parva-Device-Id` and `X-Parva-Sync-Id`
and stamps them on every record of that request; the app starts sending them in phase 4),
`local_event_id` (one per local write), `entity_id`.

## 5. Levels and dynamic control

Production defaults to INFO, development DEBUG, tests ERROR. `LOG_LEVEL` may carry overrides
(`info,SYNC=debug,FINANCE=info`); `LOG_LEVEL_OVERRIDES` adds more. An override key matches an event's
**domain** (`SYNC`), **module** (`finance`) or a logger's **component** (`sync-runner`); the most
specific wins. `LoggerCore.levels` changes any of these at runtime (with a TTL) — the owner's admin endpoint
(`/api/admin/logging`, section 2e) drives it, and a verbose level always expires. Invalid tokens are reported and ignored; a typo can never switch
logging off.

## 6. Sampling

Only DEBUG, TRACE and events flagged `high-volume` (per-request/tick INFO) can be sampled
(`LOG_SAMPLE_DEBUG`, default keep everything), and the decision is made **per request/sync id**, so a
request's records are kept or dropped together. ERROR and above, every `security` and `protected`
event (all `*_FAILED`, all `AUTH_*`, `SYNC_FAILED`, `AUDIT_WRITE_FAILED`…) are never sampled.

## 7. Sinks and the failure policy

*Logging failure must not become application failure.* The logger catches everything: a sink that
throws or rejects is counted (`log_sink_errors_total`) and reported once a minute on a last-resort
channel; a record that cannot be built is replaced by a reduced `LOG_INTERNAL_ERROR`. Sinks that do
real I/O sit behind a `BatchingSink`:

- bounded in-memory queue (default 10 000) — when full, DEBUG/TRACE go first, then INFO/WARN, and a protected record is sacrificed only if the queue holds nothing else (and then it is reported);
- flush on an interval (timers are `unref`'d, so logging never keeps a process alive), records kept and retried when the sink fails;
- circuit breaker: after repeated failures the sink is skipped with exponential back-off, ERROR-and-above records meanwhile go to a fallback (the console), and the circuit closes again by itself.

The default runtime sink is the console (stdout JSON on a server, an expandable object in browser
devtools / `chrome://inspect` for the Android WebView). The server keeps to stdout because Docker now
rotates it; the phone's file sink (2d) and the server's rotated file and HTTP collector (2e) sit beside it, not in place of it;
the provider-independent `LogSink` interface is what Loki, Elasticsearch or an OpenTelemetry exporter
would implement.

## 8. Metrics

`core/metrics.ts` is a dependency-free registry (counters, fixed-bucket histograms, bounded label
cardinality) with a JSON snapshot and Prometheus text. The logger already counts what it emits, drops
and fails on (`logs_emitted_total`, `logs_sampled_out_total`, `log_sink_errors_total`,
`log_internal_errors_total`), and phase 1 added `http_requests_total{method,route,status}`,
`http_request_duration_ms{method,route}`, `db_queries_total{outcome}`, `db_query_duration_ms{operation}`
and `db_slow_queries_total`. Phase 5 added the counters behind the dashboards (sync, authentication, jobs, reports, slow requests, every WARN-or-worse event) and the endpoints that expose them (2e). The registry is one per process, kept on `globalThis` like the root logger: a Next.js
server build holds `core/metrics.ts` more than once (the instrumentation hook is bundled apart from the routes), and a counter
incremented in one copy — the logger's own, the jobs' — has to be seen by the health view and the metrics endpoint in another
(found by running the real server; `core/metrics.test.ts` loads the module twice to keep it so).

## 9. Configuration

| Variable | Meaning |
| --- | --- |
| `LOG_LEVEL` | base level, optionally with overrides: `info,SYNC=debug` |
| `LOG_LEVEL_OVERRIDES` | more overrides: `finance=warn,auth=debug` |
| `LOG_FORMAT` | `json` (server default), `object` (browser default), `pretty` (dev) |
| `LOG_STACK_TRACES` | keep stack traces on ERROR+ (default true; never shown to a person) |
| `LOG_SAMPLE_DEBUG` | fraction (0–1) of DEBUG/TRACE kept |
| `SLOW_API_THRESHOLD_MS` (older: `LOG_SLOW_REQUEST_MS`) | a request at least this slow also writes `API_SLOW_REQUEST` (default 1000) |
| `SLOW_DB_THRESHOLD_MS` (older: `LOG_SLOW_QUERY_MS`) | a database operation at least this slow writes `DB_SLOW_QUERY` (default 300) |
| `SLOW_SYNC_THRESHOLD_MS` | a sync request at least this slow writes `SYNC_SLOW` (default 3000) |
| `SLOW_REPORT_THRESHOLD_MS` | a report at least this slow also writes `REPORT_SLOW` (default 2000) |
| `LOG_FILE_DIR`, `LOG_RETENTION_DAYS`, `LOG_FILE_MAX_MB` | the server's rotated log file, how long it is kept (default 14 days) and its size ceiling (300 MB) — see [operations.md](operations.md) |
| `LOG_REMOTE_URL`, `LOG_REMOTE_TOKEN`, `LOG_REMOTE_MIN_LEVEL`, `LOG_REMOTE_TIMEOUT_MS` | a central collector (newline-delimited JSON over HTTP), and what it receives |
| `METRICS_TOKEN` | switches on `GET /api/metrics` (Prometheus text); 16 characters or more |
| `LOG_HASH_SECRET` | key for the e-mail pseudonyms in auth events (falls back to `JWT_SECRET`) |
| `APP_ENV` / `NEXT_PUBLIC_APP_ENV` | `development` / `staging` / `production` |
| `GIT_COMMIT`, `BUILD_NUMBER` (`NEXT_PUBLIC_*` on the client) | build identity on every record |

Client bundles only see `NEXT_PUBLIC_*` variables (inlined at build time).

## 10. Rollout

| Phase | Content | State |
| --- | --- | --- |
| 0 | core library, registries, redaction, sinks, tests, the 31 `console.*` calls replaced, docs | **done** |
| 1 | server pipeline: request context (`request_id`, trace), `withApiLogging`, Prisma timing/slow/error classification, auth events, sync summaries, error codes in API responses, Docker log rotation | **done** in the code; takes effect on the server after a deploy |
| 2 | audit evolution: additive columns, field-level diffs, the `audit.log()` facade beside `writeAuditLog`, closing the unaudited routes, backups, retention (see [audit.md](audit.md)) | **done** in the code; the server part takes effect after a deploy, the phone part with the next APK |
| 3 | atomic money paths: real database transactions on the server and the phone; history and success logged only after commit; installment payment exactly once | **done** in the code (section 2c); the server part takes effect after a deploy, the phone part with the next APK |
| 4 | Android client: device file sink, sync correlation headers and `sync_id`, local event ids and `sync_status`, widget/notification events, global error capture, diagnostic report | **done** in the code (section 2d); ships with the next APK — deploy the server first |
| 5 | the server's rotated file and central collector, log retention, spec-named slow thresholds and report events, the counters behind the dashboards, admin log-level / health / timeline / metrics endpoints and their admin panels, benchmarks | **done** in the code (section 2e, [operations.md](operations.md)); takes effect after a server deploy — the phone part (`SYNC_SLOW`, report events, backup durations) with the next APK |

## 11. Decisions taken by default in phase 0

The following were proposed and are assumed until changed: unified event names across platforms with
a `layer=local|server` field (instead of `*_LOCAL` suffixes); money fields masked in application logs
always; application-log retention 14 days (phone 7 days, ~2 MB); audit retention 2 years; docs in
`doc/logging/`. Decisions that only matter later (phone log upload policy, syncing the audit log
between devices) are settled when their phase starts. Phase 2 applied the audit default — real amounts
in the owner's own history, with `AUDIT_MONEY_MODE` to change it — and kept the audit per platform.

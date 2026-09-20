# Logging architecture

Parva's logging is a subsystem of its own (`src/lib/observability/`), not scattered `console.log`
calls. Its purpose: **if a person says a year later "my data is wrong", we can reconstruct what
happened** — without logging more than that, without leaking anything private, and without ever
slowing down or breaking the application.

Status of each part is marked **[done]** (phases 0 and 1, in the code today) or **[planned N]** (phase N
of the rollout below). Nothing marked planned is claimed to exist.

## 1. Three layers, deliberately separate

| Layer | Question it answers | Where it lives | Retention |
| --- | --- | --- | --- |
| **Application log** | What is the system doing, and what went wrong? (technical, for developers) | server: stdout JSON lines → Docker's rotated `json-file` log **[done]**; on the phone a rotated local file **[planned 4]**. Never in PostgreSQL. | server: a ~100 MB ring in Docker; a 14-day file/shipper is **[planned 5]** |
| **Audit log** | What did the *person* change, and when? (part of the product: Settings → History) | the existing `AuditLog` table, on the server and on the device | long (default 2 years), independent, configurable **[planned 2]** |
| **Observability data** | How is the system behaving? (rates, latency, failures) | in-process metrics registry, `/api/admin/metrics` **[planned 5]**; trace/span ids on every record | live |

The audit log is **not** replaced or changed by the application log: `writeAuditLog` and
`writeLocalAuditLog` keep their signatures, tables and the History screen. They only gained a
structured way to report their *own* failure (`AUDIT_WRITE_FAILED`).

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
specific wins. `LoggerCore.levels` changes any of these at runtime (with a TTL) — an admin endpoint
that drives it is **[planned 5]**. Invalid tokens are reported and ignored; a typo can never switch
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
rotates it; a phone file sink is **[planned 4]** and a server file/remote sink **[planned 5]**;
the provider-independent `LogSink` interface is what Loki, Elasticsearch or an OpenTelemetry exporter
would implement.

## 8. Metrics

`core/metrics.ts` is a dependency-free registry (counters, fixed-bucket histograms, bounded label
cardinality) with a JSON snapshot and Prometheus text. The logger already counts what it emits, drops
and fails on (`logs_emitted_total`, `logs_sampled_out_total`, `log_sink_errors_total`,
`log_internal_errors_total`), and phase 1 added `http_requests_total{method,route,status}`,
`http_request_duration_ms{method,route}`, `db_queries_total{outcome}`, `db_query_duration_ms{operation}`
and `db_slow_queries_total`. The admin endpoint that exposes them is **[planned 5]**.

## 9. Configuration

| Variable | Meaning |
| --- | --- |
| `LOG_LEVEL` | base level, optionally with overrides: `info,SYNC=debug` |
| `LOG_LEVEL_OVERRIDES` | more overrides: `finance=warn,auth=debug` |
| `LOG_FORMAT` | `json` (server default), `object` (browser default), `pretty` (dev) |
| `LOG_STACK_TRACES` | keep stack traces on ERROR+ (default true; never shown to a person) |
| `LOG_SAMPLE_DEBUG` | fraction (0–1) of DEBUG/TRACE kept |
| `LOG_SLOW_REQUEST_MS` | a request at least this slow also writes `API_SLOW_REQUEST` (default 1000) |
| `LOG_SLOW_QUERY_MS` | a database operation at least this slow writes `DB_SLOW_QUERY` (default 300) |
| `LOG_HASH_SECRET` | key for the e-mail pseudonyms in auth events (falls back to `JWT_SECRET`) |
| `APP_ENV` / `NEXT_PUBLIC_APP_ENV` | `development` / `staging` / `production` |
| `GIT_COMMIT`, `BUILD_NUMBER` (`NEXT_PUBLIC_*` on the client) | build identity on every record |

Client bundles only see `NEXT_PUBLIC_*` variables (inlined at build time).

## 10. Rollout

| Phase | Content | State |
| --- | --- | --- |
| 0 | core library, registries, redaction, sinks, tests, the 31 `console.*` calls replaced, docs | **done** |
| 1 | server pipeline: request context (`request_id`, trace), `withApiLogging`, Prisma timing/slow/error classification, auth events, sync summaries, error codes in API responses, Docker log rotation | **done** in the code; takes effect on the server after a deploy |
| 2 | audit evolution: additive columns, field-level diffs, `audit.log()` facade over `writeAuditLog`, closing the unaudited routes, retention | planned |
| 3 | atomic money paths: real database transactions; log/audit only after commit | planned (needs its own approval: it changes behaviour) |
| 4 | Android/web client: device file sink, sync correlation headers, local event ids, widget/notification events, global error capture, diagnostics export | planned (ships with a new APK) |
| 5 | retention jobs, admin log-level/metrics endpoints, dashboards, benchmarks | planned |

## 11. Decisions taken by default in phase 0

The following were proposed and are assumed until changed: unified event names across platforms with
a `layer=local|server` field (instead of `*_LOCAL` suffixes); money fields masked in application logs
always; application-log retention 14 days (phone 7 days, ~2 MB); audit retention 2 years; docs in
`doc/logging/`. Decisions that only matter later (audit shows real amounts to its owner, phone log
upload policy, syncing the audit log between devices) are settled when their phase starts.

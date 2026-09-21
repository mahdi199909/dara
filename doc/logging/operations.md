# Running the logs: files, a collector, retention, dashboards, the owner's tools

Phase 5 of the logging work. Everything here is **[done]** in the code and off by default: with nothing configured the server
behaves as before (one JSON line per record on stdout, which Docker rotates). Each destination below is switched on by an
environment variable, and none of them can hurt the application: a slow disk, a full disk or a dead collector is contained
(see *When something fails*).

## 1. Where the server's records go

| Destination | Switched on by | What it receives | What it is for |
| --- | --- | --- | --- |
| **stdout** (Docker's own log) | always | every record | `docker compose logs`, and anything that already ships container logs |
| **A rotated file** | `LOG_FILE_DIR` | every record | a durable, searchable history on the server: the support timeline reads it |
| **A central collector** | `LOG_REMOTE_URL` | records at `LOG_REMOTE_MIN_LEVEL` and above (default `WARN`) | Loki / OpenObserve / Elasticsearch / any HTTP log intake, for dashboards and alerts |

The file is the same `RotatingFileSink` the phone uses for its own log — the same rotation, compression and failure
handling, told different limits — so it is tested once and behaves the same in both places.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOG_FILE_DIR` | *(unset: no file)* | folder for the rotated files. `docker-compose.yml` sets `/app/logs`, a volume |
| `LOG_RETENTION_DAYS` | `14` | how long files are kept: `7`, `14`, `30` or `90` are the usual choices; any whole number ≥ 1 works; `0`, `off`, `never` or `forever` keep them until the size ceiling |
| `LOG_FILE_MAX_MB` | `300` | the most all log files may occupy together (at least 20); the oldest archives go first |
| `LOG_REMOTE_URL` | *(unset: nothing is sent)* | an `http(s)` address that accepts `POST` of newline-delimited JSON (`application/x-ndjson`, one record per line) — Vector, Fluent Bit, Logstash's `http` input, OpenObserve, Loki behind a shipper |
| `LOG_REMOTE_TOKEN` | – | sent as `Authorization: Bearer <token>`. Never appears in a log line or an error |
| `LOG_REMOTE_MIN_LEVEL` | `WARN` | the lowest level sent there (stdout and the file keep everything) |
| `LOG_REMOTE_TIMEOUT_MS` | `5000` | how long one delivery may take (500–60000) |
| `SLOW_API_THRESHOLD_MS` | `1000` | a request this slow also writes `API_SLOW_REQUEST` (the older `LOG_SLOW_REQUEST_MS` still works; this name wins) |
| `SLOW_DB_THRESHOLD_MS` | `300` | a database call this slow writes `DB_SLOW_QUERY` (older name: `LOG_SLOW_QUERY_MS`) |
| `SLOW_SYNC_THRESHOLD_MS` | `3000` | a sync request this slow writes `SYNC_SLOW` (instead of `API_SLOW_REQUEST`: a push can carry a whole backup) |
| `SLOW_REPORT_THRESHOLD_MS` | `2000` | a report this slow also writes `REPORT_SLOW` |
| `METRICS_TOKEN` | *(unset: no endpoint)* | switches on `GET /api/metrics`; at least 16 characters (`openssl rand -hex 32`) |

A value that cannot be used is **reported once at startup** (`LOG_INTERNAL_ERROR`, level WARN, naming the variable — never
its value) and replaced by the default; a bad setting never stops the server and never switches logging off. `http://`
to another host is allowed but warned about (records hold no personal data, but the token would travel in the clear).

On the phone the thresholds are build-time settings, because a WebView has no environment to read:
`NEXT_PUBLIC_SLOW_REPORT_THRESHOLD_MS` (default 1500) and `NEXT_PUBLIC_SLOW_SYNC_THRESHOLD_MS` (default 8000, for a whole
pull-and-push cycle over a mobile network).

### Disk

A typical request record is about **540 bytes** as a JSON line; rotated files are gzip-compressed to roughly **a tenth** of
that. Files rotate at 20 MB or after a day in use, whichever comes first, and are named after the time of their *last*
record (`parva-20260921T101500123Z.jsonl.gz`), so "kept for 14 days" counts from the age of what is inside. The ceiling
(`LOG_FILE_MAX_MB`) and at most 1 000 archives always hold, whatever the traffic.

The file volume is separate from the database volume and from Docker's own log, so none of them can fill the others.

### Retention

The file sink deletes what has expired every time it rotates, and a **daily job** (`src/lib/logRetention.ts`, a few
minutes after start and every 24 hours) does it for a quiet server that may not rotate for days. Every run is one line in
the log (`JOB_COMPLETED` with the number of files removed, `JOB_FAILED` with the error, `JOB_SKIPPED` when no file is
configured) and one count in `jobs_total`. The **audit trail** (Settings → History) is a different thing with a different
retention (two years, `AUDIT_RETENTION_DAYS`): see [audit.md](audit.md).

## 2. When something fails

*Logging failure must not become application failure.* Both destinations sit behind a bounded queue with a circuit breaker
(`BatchingSink`): the application only ever appends to memory; a timer writes batches off the request path.

| What happens | What the application sees | What is kept | How it shows | How it ends |
| --- | --- | --- | --- | --- |
| The disk is full or the folder is unwritable | nothing | records wait in the queue (20 000, then the least important are dropped first; errors last) — stdout still has every record | `[parva-log] log file: could not be written…` on the console, at most once a minute; `parva_log_sink_failures{sink="file"}` | writes resume by themselves when space returns; what was queued is written |
| The collector is down, slow or refuses | nothing | a queue of 5 000 records; batches are retried with back-off (5 s, doubling to 5 min) | `log collector: could not be written…` (the cause: `ECONNREFUSED`, `answered 503`, `did not answer within 5000 ms` — never the address or the token); `parva_log_circuit_open{sink="collector"}` = 1 | the circuit closes by itself when a delivery succeeds |
| A burst larger than the queue | nothing | DEBUG/TRACE go first, then INFO/WARN; a protected record (ERROR and above) only if nothing else is left | `the log queue was full and N records were dropped` (with how many were errors) | – |
| A setting is wrong | nothing | – | a `LOG_INTERNAL_ERROR` warning at startup naming the variable | fix the variable |

Worst-case memory of the two queues together is a few tens of megabytes. Measured with the collector down at 10 000
records a second: the queue stayed at its 5 000 cap and the event loop was not disturbed (section 7).

### Shutdown

An asynchronous queue cannot be drained once Node's `exit` event has fired, so on the way out the file sink writes what it
still holds **synchronously** — `SYSTEM_SHUTDOWN` included (Next.js turns SIGTERM into `process.exit()`, so a `docker stop`
ends this way). What the collector's queue still holds is lost; it was on stdout and in the file. If the last seconds before
a restart are ever missing from the file, check that SIGTERM reaches Node (`docker compose exec app ps`): the container
starts through `sh -c "prisma db push && next start"`.

## 3. The owner's tools

All owner-only (the account whose e-mail is `ADMIN_EMAIL`; anyone else gets `403` / `AUTH-004`), all on the `/admin` page
(*پنل مدیریت*) and as plain JSON APIs.

### Changing the log level without a restart — `/api/admin/logging`

The "dynamic debugging" of the specification: `SYNC=DEBUG` while `FINANCE` stays at `INFO`, no code change, no deployment.

```
GET    /api/admin/logging                       what is in force, the levels and scopes to choose from, the limits
PUT    /api/admin/logging   {"kind":"scope","key":"SYNC","level":"DEBUG","ttlMinutes":20}
PUT    /api/admin/logging   {"kind":"base","level":"DEBUG","ttlMinutes":10}        the whole server
PUT    /api/admin/logging   {"kind":"user","userId":"cm…","level":"DEBUG"}         one account's requests
DELETE /api/admin/logging?scope=SYNC            put one component back to what the environment configured
DELETE /api/admin/logging?user=cm…              stop tracing that account
DELETE /api/admin/logging?all=1                 put everything back
```

A `key` is anything the `LOG_LEVEL` syntax accepts: an event's **domain** (`SYNC`, `AUTH`, `DB`, `REPORT`…), a **module**
(`finance`, `sync`) or a logger's **component**. Rules that keep it safe:

- **A verbose level always expires.** `TRACE` and `DEBUG` last 30 minutes unless another time is asked, and never more than
  24 hours — a forgotten "turned it up to look at something" cannot fill the disk or record everyone's activity for weeks.
  A quieter level (`INFO` and above) may last until the next restart.
- **It only widens for a person.** A per-account rule can make that account's records *more* verbose than the rest, never
  quieter than what an operator set.
- **Everything is on record:** an audit entry (`LOG_LEVEL_ADMIN_UPDATED`, who, and what the levels were and became) and a
  `LOG_LEVEL_CHANGED` log line. (Turning the whole server *up* is itself logged at the new level; a change to `WARN` or
  above hides the INFO line, which is why the audit entry exists.)

### The health view — `/api/admin/health`

One request answers "is the server well?": uptime and memory; requests, client and server errors, **error rate**, median and
95th-percentile latency, the busiest and the slowest routes; slow requests; database operations, failures, slow queries and
transactions; sync requests by direction and outcome; sign-in events (failures, throttling, invalid sessions); background
jobs and reports with their outcomes; the log pipeline (records written, dropped, the queues, the circuits); the most
frequent warnings and errors; and the last twenty problems (when, what, the request id, the error code, the record's one-line
message — never its metadata or a stack). It is counts and timings since the process started; a restart resets them.

### The support timeline — `/api/admin/logs`

*"A person reports a problem: show me what the server did."* Reads the rotated files (so it needs `LOG_FILE_DIR`; without it
the answer says so), oldest first:

```
/api/admin/logs?user=ali@example.com&since=24h&level=warn          one person, by address or account id
/api/admin/logs?request=req_01J…                                    one request, end to end
/api/admin/logs?sync=sync_01J…                                      one sync cycle (the phone quotes it)
/api/admin/logs?user=cm…&event=SYNC_*,AUTH_LOGIN_FAILED&limit=300
/api/admin/logs?entity=<row id>&since=7d                            what touched one row
```

Filters: `user`, `request`, `trace`, `sync`, `entity`, `event` (names, comma-separated, a trailing `*` for a prefix), `level`
(this and above), `module`, `platform`, `version`, `code`, `since` (an ISO time, or `15m` / `2h` / `3d`; default 24 h),
`until`, `limit` (default 200, at most 1 000), `stack=1`.

- Searching by **e-mail address** finds the account's records *and* the failed sign-ins that carry only a keyed pseudonym of
  the address — including an address that is no account.
- The records were redacted when written and are **redacted again** on the way out; the error is shown without its stack
  unless asked for. There is no title, note, amount, address, password or token in it.
- The search is bounded (60 files, the limit above) and says when it stopped short. What is still queued in memory is
  flushed first, so the last few seconds are in it.
- **Reading is itself logged** (`LOG_QUERIED`): who, which filters were used, how many records matched — never the results.

### Metrics for dashboards — `/api/metrics`

Prometheus text, for Grafana / Prometheus / any scraper. It **does not exist** until `METRICS_TOKEN` is set (at least 16
characters); then it answers only to `Authorization: Bearer <token>` (a wrong one is `401` and is logged as an invalid
session).

```yaml
# prometheus.yml
scrape_configs:
  - job_name: parva
    scheme: https
    metrics_path: /api/metrics
    authorization: { credentials_file: /etc/prometheus/parva-token }
    static_configs: [{ targets: ["my.parvaapp.ir"] }]
```

The metrics behind each panel the specification asks for (§42):

| Panel | Metric |
| --- | --- |
| Total requests · error rate | `http_requests_total{method,route,status}` (`status` is `2xx`/`4xx`/`5xx`) |
| API latency | `http_request_duration_ms_bucket{method,route}` |
| Slow requests | `http_slow_requests_total{route}` |
| Database errors · slow queries | `db_queries_total{outcome}`, `db_slow_queries_total`, `db_transactions_total{outcome}` |
| Sync failures · sync duration | `sync_requests_total{direction,outcome}`; the sync routes' entries in the two `http_*` metrics; `log_events_total{event="SYNC_SLOW"}` |
| Authentication failures | `auth_events_total{event}` (`login_failed`, `rate_limited`, `session_invalid`, `forbidden`…) |
| Failed jobs | `jobs_total{job,outcome}`, `job_duration_ms_bucket{job}` |
| Report performance | `reports_total{report,outcome}`, `report_duration_ms_bucket{report}` |
| Notification, backup and every other failure | `log_events_total{event,level}` — every record at `WARN` or above, by event name |
| The log pipeline itself | `logs_emitted_total{level}`, `log_sink_errors_total`, `parva_log_queue_size{sink}`, `parva_log_circuit_open{sink}`, `parva_log_records_dropped{sink}` |
| Process · build | `process_uptime_seconds`, `process_resident_memory_bytes`, `parva_build_info{version,commit,environment}` |

Filtering by *user*, *platform*, *version*, *module*, *event* or *error code* is what the log file and the collector are for
(`user_id`, `platform`, `app_version`, `module`, `event`, `error_code` are top-level fields of every record); metrics stay
label-bounded on purpose, so a bad label can never grow memory.

Suggested alerts: server error rate above 2 % for 5 minutes; `parva_log_circuit_open == 1` for 10 minutes; `jobs_total{outcome="failed"}`
increasing; `rate(auth_events_total{event="login_failed"}[5m])` far above its usual level (a guessing attempt).

## 4. Performance events

| Event | Written when | Fields that matter |
| --- | --- | --- |
| `API_SLOW_REQUEST` | a request took ≥ `SLOW_API_THRESHOLD_MS` | `duration_ms`, `route`, `dbQueries`, `dbMs`, `dbSlowestMs` |
| `SYNC_SLOW` | a request to `/api/sync/*` took ≥ `SLOW_SYNC_THRESHOLD_MS` — or, on the phone, a whole cycle took ≥ the phone's threshold | the same, or `pushed`, `pulled`, `ok`, `trigger` |
| `DB_SLOW_QUERY` | a Prisma call took ≥ `SLOW_DB_THRESHOLD_MS` | model and operation only |
| `REPORT_GENERATION_STARTED` / `_COMPLETED` / `_FAILED` | every report, on the server and on the phone | `metadata.report`, `metadata.dateRange {from,to}`, `metadata.recordCount`, `duration_ms` |
| `REPORT_SLOW` | a report took ≥ `SLOW_REPORT_THRESHOLD_MS` | as above, plus `thresholdMs` |
| `BACKUP_COMPLETED`, `RESTORE_COMPLETED` / `_PARTIAL` | a backup was made / restored | `duration_ms`, counts per table |

A report's `recordCount` is the number of rows in what it returned (categories, projects, cost items…), not a figure from
it: **no amount, balance, title or name is ever in a report's log line.** Reports that fail write `REPORT_GENERATION_FAILED`
with the error and `REPORT-001`; the request handler then does not write the same failure a second time.

## 5. How batches are sent

A busy server sends a few full batches, not a stream of small ones. A timer-driven flush writes what was queued **when it
started** — full batches (500 records for the file, 200 for the collector), unless the interval has run out or an error is
waiting — and leaves what arrives meanwhile for the next batch or the next interval. After a failed delivery nothing is tried
again before the retry spacing (or the circuit's back-off) is over, however many records arrive meanwhile. An explicit flush
(shutdown, the timeline's read) always writes everything that was queued before it.

## 6. Upgrading a server to phase 5

1. `git pull` on the server; back up as always (this release changes no table; the audit vocabulary gained one entry).
2. The update command of [DEPLOYMENT.md §5b](../../DEPLOYMENT.md) (`GIT_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build`) — the new volume `hesabkon_logs` is created and mounted at `/app/logs`, and the app now
   writes there. Nothing is required in `.env`; `LOG_RETENTION_DAYS`, `LOG_REMOTE_*` and `METRICS_TOKEN` are optional.
3. Check: `docker compose logs app | head -3` shows `SYSTEM_STARTED` with `logSinks` listing the file sink; open `/admin`
   (health, timeline, levels); `docker compose exec app ls -la /app/logs`.

Nothing here changes what the phone sends, so the server can be deployed on its own; the phone's part of phase 5 (`SYNC_SLOW`,
report and backup durations, the shared file sink) ships with the next APK.

## 7. Measured cost

`npm run logs:bench` drives the exact wiring the server uses (`startServerLogSinks`) at a steady 100 / 1 000 / 10 000
records a second for three seconds each, to a real disk and a real HTTP collector on this machine. One run on a development
laptop (the numbers are for shape, not for a promise — rerun it on the server; "process CPU" is the whole script's, and the
collector runs in the same process, so its work is in it):

| Destination | Records/s | Delivered | Dropped | Queue peak | Process CPU | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| File | 100 / 1 000 / 10 000 | all | 0 | ≈ 100 / 500 / 600 records | 0 % / ≈ 1 % / ≈ 3 % | 536 bytes a record; 15 MB written at 10 000/s |
| Collector | 100 / 1 000 / 10 000 | all | 0 | 200 / 210 / 390 | 0 % / ≈ 2 % / ≈ 2 % | full 200-record batches: about 5 requests a second at 1 000/s, 50 at 10 000/s |
| Collector **down** | 10 000 | 0 | 24 957 of 29 957 | 5 000 (the cap) | ≈ 1 % | no event-loop stall beyond the ≈ 20 ms noise of every run; memory bounded |

The application's own cost of one log call (about 0.8 µs for a bare INFO, 2 µs with fields, 5 µs with an error and stack, and
4 ns for a disabled DEBUG) is in the first table of the same script's output.

## 8. Checklist when something looks wrong

- **Nothing in `/app/logs`:** `LOG_FILE_DIR` set? The startup line lists the sinks (`logSinks`). A bad setting is reported at
  startup as `LOG_INTERNAL_ERROR`.
- **The timeline says "no log file":** the same variable is missing in the container's environment.
- **The collector receives nothing:** look for `log collector:` lines on the console; the cause is in them. `LOG_REMOTE_MIN_LEVEL`
  defaults to `WARN`, so a healthy server sends little.
- **`/api/metrics` is 404:** `METRICS_TOKEN` is unset or shorter than 16 characters (the latter is logged once).
- **A component is too quiet or too noisy right now:** `/admin` → log levels, or `DELETE /api/admin/logging?all=1`.
- **The disk is filling anyway:** lower `LOG_FILE_MAX_MB` or `LOG_RETENTION_DAYS`; both apply at the next rotation or the daily job.

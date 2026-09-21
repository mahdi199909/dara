# Logging on Android (Capacitor)

The Android app keeps the person's data in a local SQLite database and can work fully offline, so its
logs must stand on their own and still be correlatable with the server's. Status: **[done]** exists
today (phase 4 ships with the next APK).

## Today **[done]**

- The same logger runs in the WebView (`service: parva-android`, `platform: android`, records
  carry `layer: "local"`), with a `session_id` per app launch, the app version (`NEXT_PUBLIC_APP_VERSION`)
  and the environment.
- Output goes to the console as an expandable object (`LOG_FORMAT=object`), visible through
  `chrome://inspect`. The default level in a release build is INFO; `NEXT_PUBLIC_LOG_LEVEL` sets it
  at build time.
- The device's former `console.error` calls now write catalogued events with error codes and no
  personal data: `SYNC_FAILED`, `SYNC_PULL_ROW_FAILED`, `DB_LOCAL_RECOVERED`, `DB_LOCAL_FLUSH_CALLBACK_FAILED`,
  `AUDIT_WRITE_FAILED`, `WIDGET_QUEUE_FAILED`, `WIDGET_REFRESH_FAILED`, `LOCAL_NOTIFICATION_FAILED`,
  `LOCAL_NOTIFICATION_PERMISSION_FAILED`, `CAPITAL_SNAPSHOT_FAILED`, `IMPORT_ROW_FAILED`, …
  (see [debugging.md](debugging.md)).
- Every write the app makes on the device is one SQLite transaction (`withLocalTransaction`, see
  [architecture.md](architecture.md) section 2c): a failure half-way leaves nothing behind, and the log says
  `DB_TRANSACTION_ROLLBACK` and `<OPERATION>_FAILED` (with `layer: "local"`) instead of a success. The
  `*_SUCCESS` line is written after the commit.
- Widget queue records never contain what the person typed into a widget; notification failures name
  the operation and the reminder id, never its title or body.

## The phone's own log **[done, phase 4]**

### The file

Records are written to a rotated JSON-lines file in the app's private storage (`@capacitor/filesystem`, already a
dependency — no new native plugin), *not* to the SQLite database: that database is written out as one whole file on
every debounced save, so log lines there would rewrite the person's data on every line and make it grow.

`src/lib/observability/client/` (client only; nothing of it is in the web bundle's first load):

| File | Role |
| --- | --- |
| `install.ts` | `installClientLogging()`, called first thing at native launch (FirstRunGate), before the database opens: identity, the file sink, flush on background, global error capture |
| `capacitorLogFileStore.ts` | the storage behind the file sink: Capacitor Filesystem, in the app's private folder |
| `../core/rotatingFileSink.ts`, `../core/logFileStore.ts` | `RotatingFileSink` (append batches, rotate, compress, prune, search) and the storage interface with its in-memory twin for tests. **Shared with the server**, which keeps its own log with the same code (phase 5) |
| `../core/bytes.ts` | base64 / UTF-8 / gzip helpers both stores use |
| `identity.ts`, `clientContext.ts` | the device id, the Android version, the time zone; the account the records belong to |
| `globalErrors.ts` | `window.onerror`, unhandled rejections, render errors |
| `diagnostics.ts`, `shareReport.ts` | the diagnostic report |

- `current.jsonl` is the file being written; `parva-<UTC time>.jsonl.gz` are the rotated ones (plain `.jsonl` when the
  WebView cannot gzip). A file is rotated at 256 KB or after a day in use; archives older than 7 days go, then the
  oldest until everything (active file and archives) is under 2 MB and there are at most 60 archives; an active file
  nobody wrote to for 7 days is dropped at launch. An archive is named after the time of its *last* record, so
  retention counts from the age of the content.
- Records are queued in memory (a bounded queue with three priorities: DEBUG is dropped first, ERROR and above last)
  and written a batch at a time — every 3 s, when the app goes to the background (`visibilitychange`, `pagehide`,
  Capacitor `pause`) and within 0.5 s of an ERROR — so logging costs no I/O on the person's action path.
- **Logging failure never reaches the person.** A failed append (disk full, filesystem error) keeps the batch, backs
  off (1 s doubling to 60 s) and the app carries on; the first problems are reported on the console, at most once a
  minute; ERROR and above still reach the console while the file is unavailable. A rotation, compression or
  clean-up that fails never stops the appends; a half-written last line after a crash is skipped when reading.

### Who is logging

Every record carries `platform: android`, `layer: "local"`, `app_version`, `session_id` (per launch) and:

- `device_id` — a random `dev_…` id made on the first launch and kept in Preferences. **Not a hardware id**: it says
  "this installation", and disappears with the app;
- `os_version` — `Android 14`, the major version only (the phone model in the WebView's user agent is left out on purpose);
- `tz` — the person's IANA time zone, for "today" / reminder / habit-day questions;
- `user_id` once the phone is linked — the id the *server* knows the person by, so the same value finds the server's
  records. Set when a sign-in links the phone, cleared on sign-out.

### What the phone writes down

- **Every local write** — `TASK_CREATE_SUCCESS`, `EXPENSE_CREATE_SUCCESS`, … — with `entity_type`, `entity_id`,
  `operation`, `local_event_id` and `sync_status: PENDING` (a change to anything that syncs is pending until a later
  sync sends it — derived, since sync is cursor-based rather than a per-row queue). The same `local_event_id` and the
  device id are stored on the History row. Written after the commit ([architecture.md](architecture.md) section 2c).
  `SYNC_PENDING` (DEBUG) says a write is waiting for the next sync. (The requirement's example name
  `EXPENSE_CREATED_LOCAL` is `EXPENSE_CREATE_SUCCESS` with `layer: local` here — one name for both platforms.)
- **Every sync cycle** — [sync.md](sync.md).
- **OS reminders** — `LOCAL_NOTIFICATION_SCHEDULED` / `RESCHEDULED` / `CANCELLED` / `RECONCILED` (DEBUG): the
  reminder's id and the moment it rings, never its title or body; `LOCAL_NOTIFICATION_FAILED` when the OS refused.
- **Widgets** — the widget's own Java code cannot write to this log (and a crash there is outside the JavaScript
  logger's reach), so a widget action becomes visible when the offline queue is drained: `WIDGET_ACTION_RECEIVED` (how
  many, how many malformed) and `WIDGET_QUEUE_PROCESSED` (applied / failed); `WIDGET_QUEUE_FAILED` for an entry that
  failed and stays queued while the rest go on. Never what was typed. `WIDGET_QUEUE_ADDED` is reserved — the Java side
  would write it.
- **Launch** — `SYSTEM_STARTED`.

### Errors nobody catches

`window.onerror` → `SYSTEM_UNHANDLED_ERROR` (CRITICAL); an unhandled promise rejection → `SYSTEM_UNHANDLED_ERROR`
(ERROR); both with the stack, the file name only (no path, no query) and line/column. A screen that fails to render →
`UI_RENDER_ERROR`, from `src/app/error.tsx` and `global-error.tsx`, which also replace Next's blank fallback with a
short Persian screen ("مشکلی پیش آمد" / "تلاش دوباره"). Each distinct error is written at most 5 times a minute (30 in
all); the rest are counted and reported on the next record (`suppressedSince`). The browser's harmless
`ResizeObserver loop` notice is ignored.

### Getting the log to a developer

Only on the person's initiative: **Settings → the backup tab → گزارش تشخیصی** builds `parva-diagnostics-<date>.json`
(one record per line) from the newest records (up to 1.5 MB), the app's counters, the state of the log and the last
sync's outcome, and opens the share sheet — the person chooses where it goes. It holds events, counts and ids; the
records are cleaned once more when the report is built (an e-mail address, token or password that somehow reached the
log is masked). The app uploads nothing by itself.

*Not built:* an automatic upload of errors and sync-failure summaries, and a way to raise the log level from the phone.
Both need a decision on the upload policy first — the app's promise that personal data stays on the phone is not
weakened by logging.

### Budget

Measured with `npm run logs:bench` (in-memory storage, so this is the sink's own work): a typical INFO record is about
750 bytes; the file sink absorbs about 57 000 records a second, far more than the app produces; a rotated 256 KB file
compresses to about 25 KB; the 2 MB ceiling holds about 2 700 records uncompressed and 28 000 compressed (about 4 000 a
day for the whole retention period); the queue holds at most about 1.4 MB.

**Not measured:** battery, CPU and flash wear on a real phone. The design keeps them small — a few batched appends a
minute, no network — but that has to be checked on a device before a release.

### Performance events on the phone **[done, phase 5]**

- **Reports** (`GET /api/reports`, `/api/reports/category-calendar` in the on-device dispatcher) write
  `REPORT_GENERATION_STARTED` / `_COMPLETED` / `_FAILED` with the period, the number of rows and the duration — never a figure or a
  name — and `REPORT_SLOW` past `NEXT_PUBLIC_SLOW_REPORT_THRESHOLD_MS` (a build-time setting, default 1500 ms).
- **A slow sync cycle** writes `SYNC_SLOW` after its own closing `SYNC_COMPLETED`, past `NEXT_PUBLIC_SLOW_SYNC_THRESHOLD_MS`
  (default 8000 ms, pull and push together).
- **Backups and restores** carry their `duration_ms` (making the file; the share sheet that follows is the person's time).

### Rolling it out

The app sends `traceparent`, `X-Parva-Device-Id` and `X-Parva-Sync-Id` with its sync, sign-in and licence requests. A
server built before phase 1 does not list them in its CORS preflight, so the browser refuses the request — and `fetch`
reports that like being offline. The app therefore retries once without the headers and, if that works, goes without
them for half an hour before trying again: an updated app keeps syncing against an older server, only without
correlation. **Deploy the server first anyway** (see [sync.md](sync.md)).

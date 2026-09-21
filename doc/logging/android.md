# Logging on Android (Capacitor)

The Android app keeps the person's data in a local SQLite database and can work fully offline, so its
logs must stand on their own and still be correlatable with the server's. Status: **[done]** exists
today, **[planned 4]** ships with a later APK.

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

## Planned **[planned 4]**

**Storage.** A rotated JSON-lines file in the app's private storage (`@capacitor/filesystem`, already a
dependency — no new native plugin), *not* in the SQLite database: that database is persisted as one file
on every debounced flush, so log writes there would rewrite the person's whole database and make it grow.

- in-memory ring buffer; flushed in batches (every few seconds, on `pause`/`visibilitychange`, and shortly after any ERROR) so logging costs no I/O on the user's action path;
- rotation by size (about 256 KB per file, 8 files ≈ 2 MB in total), retention 7 days, oldest deleted first; rotated files gzip-compressed when the WebView supports `CompressionStream`;
- logging failure (disk full, filesystem error) never reaches the person: the sink disables itself with back-off and the app carries on.

**Identity.** A random `device_id` (UUID stored in Preferences on first launch — not a hardware id),
`session_id` per launch, `user_id` once linked to an account, `app_version`/`build_number`, coarse
`os_version`, and the person's time zone (`tz`) for debugging "today"/reminder/habit-day questions.

**Local operations.** Every local write gets a `local_event_id` and is logged with
`entity_type`, `entity_id`, `operation`, `layer: "local"`, `sync_status` (`PENDING` until a later sync
pushes it — derived, since sync is cursor-based rather than a per-row queue). Event names are the same
as on the server (`EXPENSE_CREATE_SUCCESS`); the `layer` field says where it happened.

**Errors nobody catches.** `error.tsx` / `global-error.tsx`, `window.onerror` and `unhandledrejection`
produce `UI_RENDER_ERROR` / `SYSTEM_UNHANDLED_ERROR` (today such errors are invisible). Crashes in the
Java layer (widgets, native shell) are outside the JavaScript logger's reach; widget actions are
logged when the offline queue is drained.

**Getting logs to a developer.** Only on the person's initiative: Settings → *diagnostic report*
builds a redacted bundle (recent local log + the app's metrics) and shares it (Share sheet) or, if they
choose, uploads it. Automatic upload is limited to errors and sync-failure summaries and is decided
separately; the app's promise that personal data stays on the phone is not weakened by logging.

**Budget.** Batching and the bounded queue keep CPU, memory and battery impact negligible; storage
growth is capped by rotation. These are verified on a real device before release.

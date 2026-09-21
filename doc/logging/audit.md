# The audit trail

The audit trail is the person's own history of what changed in their data — Settings → History. It is
**product functionality**, not a debugging tool, and it is deliberately a different thing from the
application log:

| | Audit trail | Application log |
| --- | --- | --- |
| Answers | *What happened to my data, and when?* | *What is the system doing, and what went wrong?* |
| Lives in | the `AuditLog` table (PostgreSQL on the server, SQLite on the phone) | stdout JSON (Docker), the phone's console |
| Kept | years (two by default, configurable) | days |
| Money | real values by default (see below) | always masked |
| Read by | the owner, in the app | developers |

Changing one never touches the other. Phase 2 *extended* the audit trail — every existing column, every
existing writer and the History screen behave as before.

## What one entry holds

Legacy columns (unchanged; History and the backup files depend on them):

| Column | Meaning |
| --- | --- |
| `userId`, `createdAt` | who (the account that acted) and when |
| `action` | what History labels: `CREATE`, `UPDATE`, `COMPLETE_TASK`, `PAYMENT` … |
| `entityType`, `entityId` | what it happened to: `Task` + an id |
| `oldValue`, `newValue` | the whole object before / after (JSON), as always |
| `ipAddress`, `userAgent` | where the request came from (server rows only) |
| `metadata` | anything extra (JSON): counts, the quick-capture source … |

Added in phase 2 (all optional, so every older row and every older writer stays valid):

| Column | Meaning |
| --- | --- |
| `event` | the canonical **fact**, e.g. `TASK_UPDATED` — the vocabulary below |
| `source` | `api` (a request from the web app or the API), `admin` (an owner-only route), `local` (written on the phone) |
| `requestId`, `traceId` | the API request that wrote the row; the application log carries the same ids |
| `deviceId` | the phone the request came from, when it says so (`X-Parva-Device-Id`) |
| `localEventId` | the phone's own id for the write (`lev_…`); the same id is on that write's application-log line |
| `changes` | for an update: the field-level difference (below) |

## The difference, not the snapshot

For an update, `changes` holds only what changed:

```json
{
  "changedFields": ["title", "status"],
  "changes": {
    "title":  { "from": "Buy a laptop", "to": "Buy a better laptop" },
    "status": { "from": "TODO", "to": "DONE" }
  }
}
```

`id`, `userId`, `createdAt` and `updatedAt` are bookkeeping, not changes. A creation or a deletion has no
`changes` — the snapshot beside it says everything. A pasted-whole note that would make the diff larger
than 16 000 characters reduces it to `{ "changedFields": […], "changes": {}, "truncated": true }`; the two
snapshots are still complete. Fields that are secrets by name are only ever flagged (`{ "changed": true }`).

The snapshots (`oldValue`/`newValue`) are still written in full: they are what the spec calls the previous
and the new value, and the History screen's backups carry them. `changes` is what a person or a
developer actually reads.

### Money

An audit entry lives in the same database as the transaction it describes, so by default it keeps real
values: masking an amount in a row that sits next to the record holding that amount would protect
nothing, and a masked value can never be un-masked later. The **application log** is the other way round —
it never contains an amount, whatever this setting says.

`AUDIT_MONEY_MODE` (server) changes the policy for *both* the diff and the snapshots, so one setting means
one thing:

| Value | Diff | Snapshots |
| --- | --- | --- |
| `values` (default) | `{ "from": 900000, "to": 1200000 }` | untouched |
| `redacted` | `{ "from": "[REDACTED_MONEY]", "to": "[REDACTED_MONEY]" }` | money fields become `[REDACTED_MONEY]` |
| `flag` | `{ "changed": true }` | money fields become `[REDACTED_MONEY]` |

"Money" is decided by field name (`amount`, `balance`, `directCost`, `purchasePrice` … — the same list the
log redactor uses). The phone always keeps values: it is the owner's own device.

## The vocabulary

Every audited write is one row of one table (`src/lib/observability/core/auditVocabulary.ts`): the
legacy `action` History has always keyed its labels on, the canonical **fact** it records, and the
application-log event written when the operation succeeded. Same domains, same stems, two layers:
`TASK_UPDATED` in the database says *what happened*, `TASK_UPDATE_SUCCESS` in the log says *the operation
finished*, and the request id or local event id joins them.

A test scans every audit call in the code and fails on a pair that is not in the table, and on a row nobody
writes any more — so the vocabulary cannot silently fall behind. (An unknown pair is still recorded, under a
derived name such as `NOTE_ARCHIVE`, so a forgotten row never loses an entry.)

| Fact (`event`) | Entity | Legacy action | Log event after success |
| --- | --- | --- | --- |
| `USER_REGISTERED` | User | `REGISTER` | — |
| `USER_LOGGED_IN` | User | `LOGIN` | — |
| `USER_LOGGED_OUT` | User | `LOGOUT` | — |
| `SETTINGS_UPDATED` | Settings | `CHANGE_SETTINGS` | `SETTINGS_UPDATE_SUCCESS` |
| `LICENSE_TRIAL_STARTED` | License | `LICENSE_TRIAL_START` | `LICENSE_TRIAL_START_SUCCESS` |
| `LICENSE_ADMIN_UPDATED` | License | `ADMIN_LICENSE_UPDATE` | — |
| `RELEASE_ADMIN_UPDATED` | AppRelease | `ADMIN_RELEASE_UPDATE` | — |
| `LOG_LEVEL_ADMIN_UPDATED` | LogSettings | `ADMIN_LOG_LEVEL_UPDATE` | — |
| `TASK_CREATED` | Task | `CREATE` | `TASK_CREATE_SUCCESS` |
| `TASK_UPDATED` | Task | `UPDATE` | `TASK_UPDATE_SUCCESS` |
| `TASK_DELETED` | Task | `DELETE` | `TASK_DELETE_SUCCESS` |
| `TASK_COMPLETED` | Task | `COMPLETE_TASK` | `TASK_COMPLETE_SUCCESS` |
| `PROJECT_CREATED` | Project | `CREATE` | `PROJECT_CREATE_SUCCESS` |
| `PROJECT_UPDATED` | Project | `UPDATE` | `PROJECT_UPDATE_SUCCESS` |
| `PROJECT_DELETED` | Project | `DELETE` | `PROJECT_DELETE_SUCCESS` |
| `PROJECT_COMPLETED` | Project | `COMPLETE_PROJECT` | `PROJECT_COMPLETE_SUCCESS` |
| `ACTIVITY_CREATED` | Activity | `CREATE` | `ACTIVITY_CREATE_SUCCESS` |
| `ACTIVITY_UPDATED` | Activity | `UPDATE` | `ACTIVITY_UPDATE_SUCCESS` |
| `ACTIVITY_DELETED` | Activity | `DELETE` | `ACTIVITY_DELETE_SUCCESS` |
| `TIMER_STARTED` | Activity | `TIMER_START` | `TIME_TIMER_START_SUCCESS` |
| `TIMER_STOPPED` | Activity | `TIMER_STOP` | `TIME_TIMER_STOP_SUCCESS` |
| `TIME_ENTRY_CREATED` | TimeEntry | `CREATE` | `TIME_ENTRY_CREATE_SUCCESS` |
| `CATEGORY_CREATED` | Category | `CREATE` | `CATEGORY_CREATE_SUCCESS` |
| `CATEGORY_UPDATED` | Category | `UPDATE` | `CATEGORY_UPDATE_SUCCESS` |
| `CATEGORY_DELETED` | Category | `DELETE` | `CATEGORY_DELETE_SUCCESS` |
| `CATEGORIES_REORDERED` | Category | `REORDER` | `CATEGORY_REORDER_SUCCESS` |
| `EVENT_CREATED` | Event | `CREATE` | `EVENT_CREATE_SUCCESS` |
| `EVENT_UPDATED` | Event | `UPDATE` | `EVENT_UPDATE_SUCCESS` |
| `EVENT_DELETED` | Event | `DELETE` | `EVENT_DELETE_SUCCESS` |
| `EVENT_COMPLETED` | EventCompletion | `EVENT_COMPLETE` | `EVENT_COMPLETE_SUCCESS` |
| `EVENT_UNCOMPLETED` | EventCompletion | `EVENT_UNCOMPLETE` | — |
| `REMINDER_CREATED` | Reminder | `CREATE` | — |
| `REMINDER_DELETED` | Reminder | `DELETE` | — |
| `HABIT_CREATED` | Habit | `CREATE` | `HABIT_CREATE_SUCCESS` |
| `HABIT_UPDATED` | Habit | `UPDATE` | `HABIT_UPDATE_SUCCESS` |
| `HABIT_DELETED` | Habit | `DELETE` | `HABIT_DELETE_SUCCESS` |
| `HABIT_PROMOTED` | Habit | `HABIT_PROMOTE_TRIAL` | — |
| `HABIT_CHECKED_IN` | HabitCheckIn | `HABIT_CHECKIN` | `HABIT_CHECKIN_SUCCESS` |
| `HABIT_UNDONE` | HabitCheckIn | `HABIT_UNCHECK` | `HABIT_UNDO_SUCCESS` |
| `HABIT_DURATION_LOGGED` | HabitCheckIn | `HABIT_LOG_DURATION` | — |
| `ACCOUNT_CREATED` | FinanceAccount | `CREATE` | `ACCOUNT_CREATE_SUCCESS` |
| `ACCOUNT_UPDATED` | FinanceAccount | `UPDATE` | `ACCOUNT_UPDATE_SUCCESS` |
| `ACCOUNT_DELETED` | FinanceAccount | `DELETE` | `ACCOUNT_DELETE_SUCCESS` |
| `EXPENSE_CREATED` | Transaction | `CREATE_EXPENSE` | `EXPENSE_CREATE_SUCCESS` |
| `INCOME_CREATED` | Transaction | `CREATE_INCOME` | `INCOME_CREATE_SUCCESS` |
| `ACCOUNT_TRANSFERRED` | Transaction | `CREATE_TRANSFER` | `ACCOUNT_TRANSFER_SUCCESS` |
| `TRANSACTION_UPDATED` | Transaction | `UPDATE` | `TRANSACTION_UPDATE_SUCCESS` |
| `TRANSACTION_DELETED` | Transaction | `DELETE` | `TRANSACTION_DELETE_SUCCESS` |
| `INSTALLMENT_PLAN_CREATED` | InstallmentPlan | `CREATE` | `INSTALLMENT_CREATE_SUCCESS` |
| `INSTALLMENT_PLAN_UPDATED` | InstallmentPlan | `UPDATE` | `INSTALLMENT_UPDATE_SUCCESS` |
| `INSTALLMENT_PLAN_DELETED` | InstallmentPlan | `DELETE` | `INSTALLMENT_DELETE_SUCCESS` |
| `INSTALLMENT_PAID` | Installment | `PAYMENT` | `INSTALLMENT_PAY_SUCCESS` |
| `ASSET_CREATED` | Asset | `CREATE` | `ASSET_CREATE_SUCCESS` |
| `ASSET_UPDATED` | Asset | `UPDATE` | `ASSET_UPDATE_SUCCESS` |
| `ASSET_DELETED` | Asset | `DELETE` | `ASSET_DELETE_SUCCESS` |
| `VIRTUAL_ASSET_ENTRY_DELETED` | VirtualAssetEntry | `DELETE` | — |
| `BACKUP_EXPORTED` | Backup | `BACKUP_EXPORT` | — (the backup code logs `BACKUP_COMPLETED`) |
| `BACKUP_IMPORTED` | Backup | `BACKUP_IMPORT` | — (the backup code logs `RESTORE_COMPLETED` / `RESTORE_PARTIAL`) |

Sign-in, sign-out and registration also have their own security events in the application log
(`AUTH_LOGIN_SUCCESS` …, see [security.md](security.md)); the audit row is the person-facing record.

## Writing an entry

Existing call sites use `writeAuditLog` (server, `src/lib/audit.ts`) and `writeLocalAuditLog` (phone,
`src/local/audit.ts`) exactly as before. Both now, with no change at the call site:

- store the canonical `event` (from the vocabulary), the request/trace ids (server) or a fresh
  `localEventId` (phone), and the diff of an update;
- write the operation's `*_SUCCESS` line to the application log, **after** the commit (phase 3): on the server
  the routes call the writer once their transaction has committed (and a call made *inside* a transaction is
  held back until it does, then dropped if it rolls back); on the phone the entry is stored inside the
  transaction — a rollback removes it with the change — and the success line waits for the commit. So neither
  the History screen nor the log ever shows something that was rolled back. An audit row that cannot be
  stored is reported (`AUDIT_WRITE_FAILED`, `AUDIT-001`) without failing the operation and without hiding
  that the operation itself succeeded;
- never throw.

New server code uses the facade, which needs less:

```ts
await audit.log({ event: "CATEGORIES_REORDERED", entityType: "Category", metadata: { count }, req });
await audit.log({ event: "TASK_UPDATED", entityType: "Task", entityId, before, after, req });
```

The user, request id, trace id and device come from the request context; `before`/`after` produce the
diff; `req` supplies the address and browser; the legacy `action` History labels is looked up from the
event. New audited operations get a row in the vocabulary first.

## What is audited

Every API route that changes data leaves an entry, and so does every write on the phone. Phase 2 closed
the routes that did not:

| Route | Now records |
| --- | --- |
| `PATCH /api/admin/license` | `LICENSE_ADMIN_UPDATED` against the **owner** who acted — the target account appears only as an opaque id in `metadata.targetUserId`, never the address — with the license's diff |
| `PATCH /api/admin/release` | `RELEASE_ADMIN_UPDATED` with the diff of what the installed apps are told about updates (including a forced-update lock-out) |
| `PUT` / `DELETE /api/admin/logging` | `LOG_LEVEL_ADMIN_UPDATED` with what the log levels were and became (`before` / `after`) and what was asked for (`metadata`) — turning a component up to DEBUG for a few minutes leaves a trace of who did it and for how long |
| `PATCH /api/categories/reorder` (and the phone's equivalent) | `CATEGORIES_REORDERED` with the number of categories moved |
| `POST /api/backup/record` (new) and the phone's Backup screen | `BACKUP_EXPORTED` / `BACKUP_IMPORTED` with counts per table — never rows |

Deliberately **not** audited, listed with the reason in `src/testing/auditCoverage.test.ts` (a test fails
for a data-changing route that is in neither group, and for an exemption that is no longer true):

- `POST /api/notifications/[id]/read` — marking a notification read is interface state, not a change to
  the person's data.
- `POST /api/sync/push` — it applies rows a device already recorded in its own history, and the server's
  application log keeps a summary of every push (`SYNC_PUSH_SUCCESS` / `SYNC_PARTIAL_SUCCESS`, counts per
  table and kinds of refusal). A durable per-push entry waits for phase 4, when a push carries a device id
  and a sync id worth recording.

### Backups

A backup is data leaving, or a lot of data arriving, so it leaves a trace. On the phone the Settings →
Backup screen records it once the file is written / the import returned (`src/local/backupAudit.ts`:
an audit entry plus `BACKUP_COMPLETED` / `RESTORE_COMPLETED` / `RESTORE_PARTIAL` / `*_FAILED` in the
log). The web app has no backup route of its own — exporting is a full `/api/sync/pull` and importing a
chunked `/api/sync/push` — so once the browser has finished one it reports the counts to
`POST /api/backup/record`, best effort. That report is the client's own account (a modified client could
skip or falsify it); it is a trail, not a guarantee.

## Retention

The audit trail is kept for years, independently of the application log:

- **Server:** `AUDIT_RETENTION_DAYS` — unset means 730 (two years); a number of days; `0`, `off`, `never`
  or `forever` keeps everything; anything unreadable falls back to 730 (never to "delete everything").
  A job started from `src/instrumentation.ts` deletes older entries once, five minutes after the server
  starts, and then daily, with a single delete by date. Each run is one line in the application log
  (`JOB_COMPLETED`, `job: "audit-retention"`, `deleted`).
- **Phone:** the same two years, applied on every app launch (`src/local/auditRetention.ts`), because a
  phone has far less room than a server.

An account's entries are deleted with the account (`onDelete: Cascade`), as before.

## Compatibility and migration

- **Server:** additive nullable columns; `prisma db push` at container start adds them without touching a
  row. Both Prisma schemas carry them, and a test (`src/lib/schemaParity.test.ts`) now fails when the two
  files describe different models.
- **Phone:** a new on-device migration (`20260920210000_audit_log_evolution`, seven `ALTER TABLE … ADD
  COLUMN`) applied incrementally on the first launch of the build that contains it. A test upgrades a
  database that already has a history and checks that not a row changes. The new writer reaches a phone
  only with a new APK; an old phone keeps its old writer and its old rows.
- **Backups:** `exportAllData` copies rows as they are, so new backups carry the new columns; a backup made
  before them restores unchanged (both directions are tested).
- **History screen:** the screen and `GET /api/audit-logs` are unchanged — the same rows, the same order, the
  same filter — with the new fields alongside. The screen still shows only the action label, the entity type
  and the time; it does not yet show what changed (the data to do so is now stored). Labels for the new
  actions were added; older actions without a Persian label still fall back to their raw name.

## Finding things

```bash
# every audit entry the request req_… wrote (PostgreSQL)
docker compose exec postgres psql -U hesabkon hesabkon -c "select \"createdAt\", event, \"entityType\", \"entityId\", source from \"AuditLog\" where \"requestId\" = 'req_…'"

# what changed on one entity, oldest first
docker compose exec postgres psql -U hesabkon hesabkon -c "select \"createdAt\", event, changes from \"AuditLog\" where \"entityType\" = 'Task' and \"entityId\" = '…' order by \"createdAt\""

# the matching application-log lines for that request
docker logs parva-app-1 2>&1 | jq -c 'select(.request_id == "req_…")'
```

On the phone the join key is `local_event_id` (`localEventId` in the row).

## Known limits

- The phone's history and the server's are separate (`AuditLog` is not one of the synced tables): a change
  made on the phone appears in the web History only as the sync that carried it, in the application log.
  Syncing the audit trail would be a sync-protocol change and is not part of this phase.
- A web backup report is client-reported (see above).
- Row-level auditing of changes that arrive through `sync/push` is not done (see above).

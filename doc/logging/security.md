# Logging security and privacy

Parva holds personal and financial data. **A log must contain enough to debug a problem — no more.**
Logging must never become a second, unprotected copy of a person's data.

## Rules

1. **Log identifiers, counts, sizes, durations and error codes — not content.** `entity_id`,
   `record_count`, `payload_size`, `created/updated/deleted/rejected`, `duration_ms`. Never a task
   title, note, amount, account or card number, e-mail address, or a request body.
2. **Never log a secret**: password, JWT, cookie, `Authorization` header, refresh token, API key,
   session secret, card number, CVV. Authentication events carry an error code, not the credential.
3. **Money is masked in application logs.** Audit entries may keep real values for their owner (see
   "Audit vs. application log").
4. **Stack traces stay server-side.** They are kept in the server log (and the phone's local file) on
   ERROR and above, and are never put in a response or shown on screen. `LOG_STACK_TRACES=false`
   turns them off.
5. **Errors are scrubbed**: an exception message can carry a connection string, a token or an
   address; every message and stack goes through the same text scrubber as any other string.
6. **A database error never reaches a log as Prisma wrote it** (see the next section).
7. **What a request carried is not logged**: no body, no query string (`?search=…` can be private), no
   headers, no cookies. The path is logged without its query, and the *route pattern*
   (`/api/tasks/[id]`) is what metrics group by.

## Database errors: Prisma prints your data **[done]**

The text of a failed Prisma call is *the call itself*, with its arguments: the e-mail being
registered, the task title, the amount. Prisma also prints it to stderr by itself, and raises it again
as an engine `error` event. Left alone, that is a second copy of a person's data in the log. So:

- `src/lib/db.ts` creates the client with `log: [{ emit: "event", … }]` — nothing is written by Prisma.
- `serializeError` recognises a Prisma error (by its class name, or by the "Invalid … invocation" header
  Prisma puts on every failed call, whatever the call was written as) and rebuilds the message from what
  is safe: the operation (for example `prisma.user.create()`), the explanation Prisma prints at the very
  end (for example "Unique constraint failed on the fields: (email)" — quoted values blanked, runs of 4+
  digits blanked), and the schema names in `meta` (`modelName`, `target`, `field_name` … never a value or a
  driver message).
- the **stack** is rebuilt from its `    at …` frames only: V8 starts a stack with the whole message,
  which for Prisma is the data.
- the engine's own copy of a failed query (an `error` event with the same text) is dropped — the
  extension records that failure once, classified; other engine events are scrubbed of PostgreSQL's
  `Key (email)=(…)` detail lines first.
- the Prisma extension records **model, operation, duration and error code** — never the SQL or the arguments.

This was found and fixed against the real client (the unit tests alone had assumed a message shape
Prisma does not use): `src/testing/observabilityPipeline.e2e.test.ts` provokes real unique-constraint,
foreign-key and validation failures and asserts nothing typed by the person appears anywhere.

## Authentication events **[done]**

`AUTH_LOGIN_FAILED`, `AUTH_RATE_LIMITED`, `AUTH_REGISTER_FAILED`, `AUTH_SESSION_INVALID`, `AUTH_FORBIDDEN` are
WARN, security-flagged and never sampled. They say *why* (`wrong_password` vs `no_such_user` — visible in
the log, identical in the response, so an attacker learns nothing) and *from where* (IP), and identify
the account only as `emailHash`: `em_` + 12 hex characters of an HMAC-SHA256 of the lower-cased address,
keyed from `LOG_HASH_SECRET` (or `JWT_SECRET`). Two failures for the same account are visibly the same;
the address cannot be read or tested back out of the log without the key.

Headers a client supplies (`traceparent`, `X-Parva-Device-Id`, `X-Parva-Sync-Id`, `X-Request-Id`) are
validated against a strict shape and dropped when malformed, so a hostile value can never reach a log
line as free text. The request id the server trusts is always its own; a client's `X-Request-Id` is kept
only as a hint.

## The redaction layer (`core/redact.ts`) **[done]**

It runs on every record, so a developer passing the wrong thing by mistake cannot leak it.

**By key** (case, punctuation and nesting are irrelevant: `Password`, `x-api-key`, `card_number`):

| Class | Replaced with | Examples |
| --- | --- | --- |
| secret | `[REDACTED]` | `password`, `passwordHash`, `token`, `accessToken`, `jwt`, `authorization`, `cookie`, `set-cookie`, `secret`, `clientSecret`, `apiKey`, `cardNumber`, `cvv`, `pin`, `otp`, `sheba`, `iban`, `nationalCode` … and any key *ending* in token/secret/password/apikey/authorization/cookie |
| money | `[REDACTED_MONEY]` | `amount`, `totalAmount`, `balance`, `directCost`, `purchasePrice`, `monthlyIncome`, … and any key ending in amount/balance/price/cost |
| content | `[REDACTED_CONTENT]` | `title`, `description`, `notes`, `text`, `comment`, `body` |
| e-mail | `m***@g***.com` | `email`, `remoteEmail` |
| personal | `[REDACTED]` | `phone`, `mobile`, `address`, `fullName`, `displayName`, `birthDate` |

Empty values (`null`/`undefined`) are left alone; `extraSecretKeys` adds more.

**By value**, inside any string (messages, error text, metadata values):

- JWTs (`eyJ….….…`) → `[REDACTED_JWT]`; `Bearer <token>` → `Bearer [REDACTED]`
- credentials in URLs (`postgresql://user:pass@host`) → `scheme://[REDACTED]@host`
- `password=…`, `token: …`, `api_key=…`, `secret='…'` pairs → value replaced
- card numbers — 15–19 digits that pass the Luhn check, with spaces/dashes, in ASCII **or Persian/Arabic-Indic digits** → `[REDACTED_CARD]`
- Sheba/IBAN (`IR` + 24 digits) → `[REDACTED_IBAN]`
- e-mail addresses → masked

**Safe serialisation:** cycles (`[Circular]`), BigInt, Symbols, functions, throwing getters, hostile
proxies, binary data, `NaN`/`Infinity`, and oversized values (depth 6, 50 array items, 50 keys,
500 chars per string, 2 000 nodes, 8 KB of metadata per record) can never reach a sink in a form that
could throw or explode.

## Audit vs. application log

| | Application log | Audit log |
| --- | --- | --- |
| Purpose | debugging the system | the person's own history of changes |
| Contains | ids, counts, durations, codes | who/what/when + a field-level diff |
| Money | always masked | real values for the owner by default — their own data, returned only to them, in the same database as the transaction it describes; `AUDIT_MONEY_MODE=redacted\|flag` masks it in the diff and the snapshots alike |
| Lifetime | days | long, independent retention (`AUDIT_RETENTION_DAYS`, two years by default) |
| Who reads it | developers (via logs) | the owner (Settings → History) |

Developer-facing tools (support timeline, diagnostics export) only ever show the redacted view. The audit
trail's own design — columns, the diff, the vocabulary, retention — is in [audit.md](audit.md).

## The phone's log and its report **[done, phase 4]**

- **The device id is random.** `dev_…` is made on the first launch and kept in the app's own preferences; it is not
  derived from the phone (no IMEI, Android ID, model or serial number) and disappears with the app. `os_version` is the
  major Android version only.
- **What the correlation headers carry:** `traceparent`, `X-Parva-Device-Id`, `X-Parva-Sync-Id` — random ids, nothing
  about the person or the data. The server validates them and drops anything malformed.
- **The log file** is in the app's private storage (not visible to other apps or the file manager, removed with the
  app). It holds what any application log holds: ids, counts, durations, codes — never a title, note, amount, e-mail
  address, password or token. `user_id` is the server's opaque id, not an e-mail address.
- **The diagnostic report** is built only when the person asks, is cleaned once more (masking of e-mail addresses,
  tokens and secrets that somehow reached a record) and leaves the phone only through the share sheet, to wherever the
  person chooses. The app uploads nothing by itself; an automatic upload of errors and sync-failure summaries is a
  separate decision that has not been taken.
- **Errors nobody catches** are written with their stack and the script's file name (no path, no query) — an error
  message that quotes a value passes through the same redaction as every other message.

## The owner's tools **[done, phase 5]**

- **Who:** `/api/admin/logging`, `/health` and `/logs` require the owner (`requireAdmin`: the signed-in account whose e-mail is
  `ADMIN_EMAIL`); anyone else gets `403` / `AUTH-004`, which is itself logged (`AUTH_FORBIDDEN`) and counted. Nothing sensitive
  is rendered client-side before that check.
- **The timeline shows nothing the log did not already hold** — ids, counts, durations, codes, event names. The records were
  redacted when written and are passed through the same redaction again on the way out, so a record written before a rule was
  tightened is still safe to show; an error appears without its stack unless the owner asks (`stack=1`).
- **Searching by e-mail address** never puts the address in a log line: the failed sign-ins it finds are matched by their keyed
  pseudonym (`em_…`, see *Authentication events*), and an address that is no account can still be looked up that way.
- **Reading is recorded.** Every timeline search writes `LOG_QUERIED` — who, which filters, how many records matched, never the
  results — so "who looked at this person's records" has an answer.
- **A verbose level cannot be forgotten.** `TRACE`/`DEBUG` always expire (30 minutes by default, 24 hours at most); every change
  of level is an audit entry (`LOG_LEVEL_ADMIN_UPDATED`) and a log line. A per-account rule can only make that account's
  records *more* verbose than the operator's setting, never quieter.
- **The metrics endpoint** is off unless `METRICS_TOKEN` (16 characters or more) is set, answers only to that bearer token
  (compared in constant time), returns `404` rather than `401` when it is off, logs a wrong token as an invalid session, and
  prints only counts, durations and event names — no person, no address, no route parameter (routes are the declared patterns,
  not the URLs requested).
- **The collector's token** (`LOG_REMOTE_TOKEN`) goes only in the `Authorization` header. Errors from the sink are scrubbed of
  the address (which an operator may have written with credentials in it) and of the token; the configuration warnings name the
  variable, never its value. A collector receives records that are free of personal data by construction, but plain `http://`
  to another host is still warned about.
- **The log volume** (`/app/logs`) is the server's own; it holds the same records that stdout does, for the retention period.

## IP addresses and users

`user_id` is an opaque id, never an e-mail address. IP addresses are recorded only for security
events (`AUTH_LOGIN_SUCCESS`/`FAILED`, `AUTH_RATE_LIMITED`, `AUTH_REGISTER_*`) and in the audit trail (as
today); ordinary request records (`HTTP_REQUEST_COMPLETED`) do not carry them.

## Sampling and security events

Security events (`AUTH_*`) and every failure are exempt from sampling and are the last thing a full
queue may drop.

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
| Money | always masked | real values for the owner (their own data, returned only to them); masked/flag-only mode available |
| Lifetime | days | long, independent retention |
| Who reads it | developers (via logs) | the owner (Settings → History) |

Developer-facing tools (support timeline, diagnostics export) only ever show the redacted view.

## IP addresses and users

`user_id` is an opaque id, never an e-mail address. IP addresses are recorded only for security
events (login failures, rate limiting) and in the audit trail (as today); ordinary request records do
not carry them.

## Sampling and security events

Security events (`AUTH_*`) and every failure are exempt from sampling and are the last thing a full
queue may drop.

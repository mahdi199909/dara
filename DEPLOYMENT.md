# Deployment Guide

Target scenario: a single-user personal deployment on a VPS, served from a subdomain (e.g. `app.example.com`), behind a reverse proxy with SSL.

## 1. Environment Variables

Copy `.env.example` to `.env` and fill in real values:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `file:./dev.db` locally, or a `postgresql://...` URL in production |
| `JWT_SECRET` | yes | Generate with `openssl rand -base64 48`. Never commit this. |
| `SESSION_COOKIE_NAME` | no | Defaults to `hesabkon_session` |
| `NODE_ENV` | yes | `production` in deployment |
| `APP_URL` | no | Used for cookie/redirect defaults; set to your real domain |
| `TZ` | no | Timezone the server treats as "local" — day boundaries for habit check-ins, reports and the calendar follow it. Defaults to `Asia/Tehran` in the Dockerfile/compose file; if you run without Docker, set it yourself, otherwise days roll over at UTC midnight (03:30 Tehran) and a habit checked in on the web is stored under a different instant than the same day on the phone. |
| `LOG_LEVEL` | no | Logging threshold, default `info` in production. Accepts overrides: `info,SYNC=debug`. See section 5d. |
| `SLOW_API_THRESHOLD_MS`, `SLOW_DB_THRESHOLD_MS`, `SLOW_SYNC_THRESHOLD_MS`, `SLOW_REPORT_THRESHOLD_MS` | no | A request / a database call / a sync request / a report at least this slow is logged as a warning (defaults 1000 / 300 / 3000 / 2000 ms). The older `LOG_SLOW_REQUEST_MS` and `LOG_SLOW_QUERY_MS` still work. |
| `LOG_FILE_DIR`, `LOG_RETENTION_DAYS`, `LOG_FILE_MAX_MB` | no | A rotated log file the owner's timeline reads (the compose file sets `/app/logs`, a volume), how many days it is kept (default 14; 7, 30 and 90 are common) and its size ceiling (300 MB). See section 5d. |
| `LOG_REMOTE_URL`, `LOG_REMOTE_TOKEN`, `LOG_REMOTE_MIN_LEVEL` | no | Send records (default: warnings and above) to a central collector as newline-delimited JSON over HTTP. Unset = nothing leaves the server. |
| `METRICS_TOKEN` | no | Switches on `GET /api/metrics` (Prometheus text, bearer token). At least 16 characters (`openssl rand -hex 32`); unset = the endpoint does not exist. |
| `LOG_HASH_SECRET` | no | Key for the e-mail pseudonyms in login-failure log lines; defaults to `JWT_SECRET` |
| `AUDIT_RETENTION_DAYS` | no | How long Settings → History entries are kept on the server: 730 days by default; `0`, `off` or `never` keeps everything. Old entries are pruned daily. See doc/logging/audit.md. |
| `AUDIT_MONEY_MODE` | no | `values` (default), `redacted` or `flag`: whether audit entries keep real amounts, mask them, or only record that they changed |
| `CHECKUP_ALLOWED_ORIGINS` | no | Origins the public research form (`parvaapp.ir/checkup`) may write from, comma-separated and exact. Default `https://parvaapp.ir,https://www.parvaapp.ir`; outside production any `http://localhost:<port>` is allowed too. See section 5g. |
| `CHECKUP_IP_SECRET` | no | Key for the hashed addresses stored with research-form answers (spam checks only; the raw address is never stored). Defaults to `JWT_SECRET`; set it if you want the hashes to survive a `JWT_SECRET` rotation. |
| `CHECKUP_DAILY_CAP` | no | Most new research-form answer sheets stored per rolling 24 hours, for the whole server (default 2000). Protects the disk the app runs on from a flood. |
| `AI_PROVIDER`, `AI_API_KEY` | no | Leave empty — the app runs fully rule-based without them (see README §9/§10) |

**Never commit `.env` to git.** `.gitignore` already excludes it.

## 2. Choosing a database

- **SQLite** (what this project ships and fully tests): perfectly adequate for one person's data on a single VPS. Simplest possible operations story — the "database" is one file you can back up with `cp`.
- **PostgreSQL**: use `prisma/schema.postgresql.prisma` if you want a separate DB process (e.g. you already run Postgres for other apps on the same box, or plan to scale beyond a single SQLite file). See §4 below.

## 3. Simple deployment (SQLite, no Docker)

```bash
git clone <your-repo> && cd hesabkon
npm ci
cp .env.example .env   # fill in JWT_SECRET; DATABASE_URL can stay as file:./dev.db
npx prisma migrate deploy
npm run build
npm run start           # listens on :3000 by default
```

Run it under a process manager (pm2, systemd) so it restarts on crash/reboot:

```ini
# /etc/systemd/system/hesabkon.service
[Unit]
Description=Hesabkon
After=network.target

[Service]
WorkingDirectory=/opt/hesabkon
ExecStart=/usr/bin/npm run start
Restart=always
EnvironmentFile=/opt/hesabkon/.env
User=hesabkon

[Install]
WantedBy=multi-user.target
```

Back up `prisma/dev.db` on a schedule (it's a single file — `cp prisma/dev.db /backups/dev-$(date +%F).db` in a cron job is a complete backup strategy for this app).

## 4. Docker deployment (PostgreSQL)

```bash
cp .env.example .env
# set JWT_SECRET and POSTGRES_PASSWORD in .env
docker compose up -d --build
```

This builds the app against `prisma/schema.postgresql.prisma` (the Dockerfile swaps it in at build time) and runs `prisma db push` against the `postgres` service on container start — see the comments in `Dockerfile` for why `db push` is used instead of `prisma migrate deploy` here (the committed migration history was generated for SQLite and isn't valid Postgres SQL).

> **Note:** this sandbox had no Docker daemon available, so this path was written to a well-established, standard pattern and reviewed carefully, but not executed end-to-end here. Run `docker compose up --build` and verify before relying on it in production; if something doesn't line up, the most likely culprit is a Prisma/Postgres version mismatch — `docker compose logs app` will show it.

To seed demo data into the Postgres container:
```bash
docker compose exec app npm run db:seed
```

### Backup/restore (PostgreSQL)

```bash
docker compose exec postgres pg_dump -U hesabkon hesabkon > backup.sql
# restore:
docker compose exec -T postgres psql -U hesabkon hesabkon < backup.sql
```

## 5. Reverse proxy + SSL

### Nginx + Certbot

```nginx
server {
    server_name app.example.com;
    listen 80;
    # The Android app syncs through /api/sync/push. nginx's default 1 MB request-body cap answers
    # anything bigger with a bare "413 Request Entity Too Large" (the app splits its own pushes
    # to stay well under this, but a generous limit keeps older app builds working too).
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo certbot --nginx -d app.example.com
```

### Caddy (simpler, automatic HTTPS)

```
app.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Either way, once SSL terminates at the proxy, cookies are sent over HTTPS and `secure: true` (already set in `src/lib/auth.ts` when `NODE_ENV=production`) applies correctly.

**The app must only be reachable through the proxy.** `docker-compose.yml` publishes port 3000 on `127.0.0.1` alone;
before that it listened on every interface, so `http://<server-ip>:3000` skipped TLS, the body-size limit and the
proxy-written `X-Forwarded-For` entry the rate limits trust (`src/lib/clientIp.ts` reads the *last* entry, the one
nginx appends — keep `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` as above). If a firewall is in use,
allow only 22, 80 and 443. The security headers (CSP, HSTS, X-Frame-Options …) come from the app itself
(`next.config.mjs`); in nginx add `server_tokens off;` so the version is not announced.

## 5e. Email and SMS (one-time codes)

Verifying an email or phone, signing in with a code and "forgot password" send a 6-digit code. Configure one or both
channels in `/opt/parva/.env` (names in `.env.example`, passed through by `docker-compose.yml`), then
`docker compose up -d` (no rebuild needed):

- **Email:** any SMTP account — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (`SMTP_SECURE=true` for port 465).
  Check that the VPS can reach the SMTP host on that port; some providers block Iranian addresses — a local provider
  or one reachable from the VPS is safer.
- **SMS:** `SMS_PROVIDER=kavenegar` with `KAVENEGAR_API_KEY` and `KAVENEGAR_OTP_TEMPLATE` (a *verify/lookup* template
  whose `%token` is the code), or `SMS_PROVIDER=smsir` with `SMSIR_API_KEY`, `SMSIR_TEMPLATE_ID`, `SMSIR_PARAM_NAME`.

**Or from the dashboard** (/dashboard → «ایمیل و پیامک»): the same settings can be typed there instead. They are
stored encrypted in the `ServerSetting` table (AES-256-GCM; key derived from `SETTINGS_ENCRYPTION_KEY` if set, otherwise
from `JWT_SECRET` — so a database dump or backup alone reveals nothing), secret fields are write-only, saving asks for
the owner's password again, and a dashboard value overrides the `.env` one. Changing `JWT_SECRET` (without a separate
`SETTINGS_ENCRYPTION_KEY`) makes the stored values unreadable — the page then says so and they must be typed again.

Until a channel is configured, production refuses to send on it (`AUTH-008`) and the app says so; password sign-in
keeps working. The owner dashboard's «ایمیل و پیامک» page shows what is configured and sends a test message.

## 5f. The owner dashboard

`https://my.parvaapp.ir/dashboard` — every account, its subscription and days left, extensions (+1 month, custom days,
an exact end date, lifetime, cancel), suspension, "sign out everywhere", server health, logs, the app-update settings
and messaging. Only `m.gh.hut@gmail.com` gets in (fixed in `src/lib/adminIdentity.ts`; in production `ADMIN_EMAIL` is
ignored). An account with that address created after 2026-09-28 must have verified it first. Everyone else gets a
404; the old `/admin` redirects here.

## 5g. The research form (حسابرسی ۵ دقیقه‌ای)

The static page `parvaapp.ir/checkup/` (from `doc/landing/site/checkup/`, uploaded by hand like the rest of the site)
saves anonymous answers to `POST /api/checkup` and `POST /api/checkup/event` on this server. Those two paths — exactly
those — are public in `src/middleware.ts`; the routes check the Origin (`CHECKUP_ALLOWED_ORIGINS`), cap the body at
16 KB, rate-limit per address (an IPv6 /64 counts as one) and stop storing new sheets at `CHECKUP_DAILY_CAP` a day.
The owner reads them at `/dashboard/checkup` (CSV export there too). The table, `CheckupResponse`, is created by the
normal `prisma db push` at container start: a new table with no unique index, so no manual step is needed. It is never
synced to phones. Full notes: `doc/checkup/README.md`.

## 5b. Updating a running deployment

```bash
cd /path/to/checkout
git pull
GIT_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build   # rebuilds the app image; `prisma db push` runs again at container start
```

On the production server use the script instead, which wraps the same build with what went wrong before:

```bash
cd /opt/parva
nohup setsid scripts/server-deploy.sh v1.7.4 > /root/backups/deploy-$(date +%Y%m%d-%H%M%S).log 2>&1 < /dev/null &
```

(`scripts/server-deploy.sh` without a tag updates the code only.) It refuses to start with less than 8 GB free, backs
the database up, keeps the running image as `parva-app:rollback` (one image, not one per release), pulls, fetches the
APK, builds, waits for `/login`, then clears the build cache. **Disk space matters here:** on 2026-09-30 the 40 GB disk
filled with rollback images and build cache; nginx cut every large response short (the APK stopped at ~80 KB) and
Postgres crash-looped on "No space left on device" until `docker builder prune -af` freed it. A download that stops
half way or a sudden «مشکلی پیش آمد» on every page: look at `df -h /` first.

`GIT_COMMIT` is baked into the image so every log line says which build wrote it (the image has no `.git`
to ask). Leaving it out is harmless — the records then say `git_commit: "unknown"`.

### Schema changes

Since the account-security release the container starts with a plain `prisma db push` — **without**
`--accept-data-loss`. A change Prisma considers risky (dropping or retyping a column, adding a unique index) no longer
applies itself at start: the new container stops with Prisma's warning instead, and the old data is untouched. Such a
change is applied once, by hand, before starting the new image:

```bash
docker exec parva-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' | gzip > /root/backups/parva-pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz
GIT_COMMIT=$(git rev-parse --short HEAD) docker compose build app
# Read what would change (inside the new image, against the live database):
docker compose run --rm --no-deps app npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
# Only if that is what you expect:
docker compose run --rm --no-deps app npx prisma db push --skip-generate --accept-data-loss
GIT_COMMIT=$(git rev-parse --short HEAD) docker compose up -d
```

(Inside `docker compose run`, `$DATABASE_URL` is the container's own; quote the command so the host shell does not
expand it.) The account-security release needs this once: it adds `User.phone` with a unique index, plus nullable
columns and the `VerificationCode` table — nothing is dropped.

Earlier releases relied on `--accept-data-loss` at start, e.g. to convert the money columns from `integer` to
`double precision` in place (checked on a real PostgreSQL 16; every value kept).

After pulling a release that touches the sync routes (`src/app/api/sync/*`), redeploy the server **before** (or
together with) shipping the matching Android build: an updated app works against an older server but
falls back to the old behavior (deletions and display-name/settings don't sync until the server catches up; amounts
above ~2.1 billion Toman are refused by an old server, one row at a time, with the reason shown in the app).

The web app's *backup* tab (download / restore a backup file) needs no server change: it is built on the same
`/api/sync/pull` and `/api/sync/push` endpoints the phone syncs through.

## 5d. Logs

The app writes one JSON object per line to stdout — requests, failures, sign-in events, sync summaries
(what each contains, and what is deliberately never logged: [doc/logging/architecture.md](doc/logging/architecture.md),
[doc/logging/security.md](doc/logging/security.md)). Docker keeps them, and `docker-compose.yml` caps that at five
files of 20 MB for the app and three of 10 MB for Postgres, so logs can never fill the disk.

```bash
docker compose logs app --since 1h                                   # raw
docker logs parva-app-1 --since 1h 2>&1 | jq -c 'select(.level == "ERROR")'   # errors only (needs jq)
docker logs parva-app-1 2>&1 | jq -c 'select(.request_id == "req_…")'         # one request, end to end
```

More recipes (slow requests, failed logins, sync results): [doc/logging/debugging.md](doc/logging/debugging.md).
Every error the app returns carries a `code` and a `requestId`; ask a person who hit one for the
`requestId` and search for it.

To watch every request for a while, set `LOG_LEVEL=debug` in `.env` and `docker compose up -d`; set it back
afterwards (successful reads are only written at debug level).

Changing the compose file's `logging:` section, like any compose change, takes effect when the containers are
recreated (`docker compose up -d`).

**A searchable history, retention and the owner's tools.** The compose file mounts a volume, `hesabkon_logs`, at `/app/logs`
and sets `LOG_FILE_DIR` to it: the server then also keeps every record in rotated, compressed files (20 MB each, kept 14 days,
never more than 300 MB together — `LOG_RETENTION_DAYS`, `LOG_FILE_MAX_MB`), and `/admin` gains a server-health panel, a
per-user technical timeline that reads those files, and a panel that turns the log level of one component up for a while
without a restart. With `METRICS_TOKEN` set, `GET /api/metrics` serves Prometheus text for Grafana. A collector
(`LOG_REMOTE_URL`) is optional. Every setting, what happens when a disk or a collector fails, and the measured cost:
[doc/logging/operations.md](doc/logging/operations.md). This release changes no table and no request the phone sends, so the server can be deployed on its own (the phone's part —
`SYNC_SLOW`, report and backup durations — ships with the next APK); back up as always before deploying (5b).

**Server first, then the APK.** From the logging work on, the Android app sends `traceparent`, `X-Parva-Device-Id` and
`X-Parva-Sync-Id` with its sync and sign-in requests, so that the phone's log and the server's can be joined. The
server's CORS answer (`src/lib/nativeCors.ts`) lists them since phase 1. An updated app keeps working against an older
server — it retries once without the headers — but without the correlation, so deploy this release to the server before
publishing the APK that needs it (see 5c).

The **audit trail** (Settings → History) is a different thing from these logs: it lives in the database and is
kept for two years by default. A release that changes its table (the audit columns added in the logging work) adds
nullable columns with `prisma db push` at container start — no row is touched, but back up first as always. Query
recipes and retention are in [doc/logging/audit.md](doc/logging/audit.md).

## 5c. Releasing a new Android APK

The app is called **parvaapp** wherever a person sees a name — the launcher label, the download file `parvaapp.apk` and
the UI copy (`APP_NAME` in `src/lib/appVersion.ts`) — and there is one permanent download link:

    https://my.parvaapp.ir/parvaapp.apk

The server itself serves it (`next.config.mjs` rewrites it to `src/app/api/app/apk/route.ts`), from `/opt/parva/downloads/parvaapp.apk`
(mounted read-only into the container). It resumes interrupted downloads (Range) and does not depend on GitHub being
reachable from Iran; only when that file is missing does it fall back to the GitHub release. The link never changes;
copying a new file there (step 3 below) is what changes what it downloads.

**Versions.** `package.json`'s version is the only source. The APK's `versionName` is that version and its `versionCode`
is derived from it (`1.1.0` → `10100`, i.e. major·10000 + minor·100 + patch, with minor and patch below 100), so it
always grows with the version and is known before the APK exists. Builds made before 1.1.0 used the CI run number
(always far below 10000), so they read as older. Never change the application id (`ir.parvaapp` since the re-issued 1.7.2 of 2026-09-30; builds before it were `ir.mganic.dara`, which Android treats as a different app), delete `android/app/debug.keystore` or replace the private key
(see "Signing the APK" below): Android would treat the result as a different app and refuse to install it over the old one.

**To release X.Y.Z**

1. Bump the version in `package.json` (`npm version X.Y.Z --no-git-tag-version`) **and** `LATEST_APP_RELEASE.versionName`
   in `src/lib/appVersion.ts`. A test, and the CI, fail if the two disagree.
2. Commit and push to `master`, then tag and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. CI
   (`.github/workflows/build-android.yml`) builds the APK, fails if the file does not carry the right version,
   application id and name, and publishes it as the release asset `parvaapp.apk`. (Pushes to `master` without a tag
   only produce a test build, kept as the `parvaapp-apk` workflow artifact — nobody is told about those.)
3. **After** the tag's run is green and the release exists, put the APK on the server — in /opt/parva:
   `scripts/server-fetch-apk.sh vX.Y.Z` (downloads the release asset, checks size and zip header, swaps it in; the
   previous file stays as `downloads/parvaapp.previous.apk`) — then deploy the server (section 5b). From then on every install
   older than X.Y.Z shows "نسخه جدید … آماده‌ی دانلود است" with a download button that opens the permanent link. Deploying
   first would announce a version nobody can download yet.
4. Check: `curl -s https://my.parvaapp.ir/api/app/version` reports the new `latestVersionName`, and
   `curl -sIL https://my.parvaapp.ir/parvaapp.apk` ends in a `200` whose `content-disposition` names `parvaapp.apk`.

**How installed apps find out.** On every launch and every resume the app asks the public `GET /api/app/version` (no
login needed — it also reaches phones that only ever worked offline) and compares its own `versionCode` with
`latestVersionCode`. Older → the update notice with the download link; below `minSupportedVersionCode` → the
blocking "به‌روزرسانی لازم است" screen. The minimum is `1` (nobody is ever forced) unless an admin raises it at
`/dashboard/release` («نسخه‌ی اپ اندروید»), which also lets the owner announce a higher number or use another download link;
what is saved there only overrides the release shipped in code, so a stale row can never hide a newer release.

**Signing the APK (private key only).** Gradle signs with the committed debug key; CI then signs the APK again with
the private key (`scripts/sign-apk.sh`), which replaces the debug signature completely. The script fails the build unless
every Android version (7 through the newest) sees exactly one signer, the private key, and that key is not the debug key.
Because every release is signed with the same key, each one installs over the previous as an ordinary update — no
uninstall.

History: up to 1.7.2 the app's id was `ir.mganic.dara`, first published debug-signed and then moved to the private key
through key rotation. With the id `ir.parvaapp` (published from 1.7.4; 1.7.3 was tagged but never published) there was no older install to stay compatible with, so the
rotation was dropped and the debug key no longer appears in the file at all. An install of the old id is a different app
to Android: it is not updated by these builds (install the new one, sign in, the data returns through sync).

The key lives only with the owner (created 2026-09-27 in `C:/Users/asus/parva-signing/`, never in the repository) and in
two repository secrets (GitHub → Settings → Secrets and variables → Actions → *New repository secret*):
`PARVA_KEYSTORE_BASE64` (the contents of `parva.p12.base64.txt`) and `PARVA_KEYSTORE_PASSWORD` (the contents of
`keystore-password.txt`). Without them a plain master build warns and keeps a debug-signed artifact (and still runs the
signing script with a throwaway key as a self-test); a release tag fails rather than publish it. **Back the key up** (the
`parva-signing` folder, somewhere offline): losing it means no further update can be installed over the app — every
person would have to uninstall and reinstall.


## 6. Migrations going forward

SQLite (dev/simple deployment):
```bash
npx prisma migrate dev --name <change-description>   # generates + applies a new migration
```

PostgreSQL (Docker path): since it uses `db push`, schema changes just need a rebuild + restart (`docker compose up -d --build`). If you want versioned migrations for Postgres instead, generate a fresh migration history once against your real Postgres instance:
```bash
cp prisma/schema.postgresql.prisma prisma/schema.prisma
npx prisma migrate dev --name init
# then switch the Dockerfile to `prisma migrate deploy` instead of `prisma db push`
```

## 7. First login

Either register a new account at `/register`, or (for evaluation) seed the demo account:
```bash
npm run db:seed        # or: docker compose exec app npm run db:seed
```
Demo login: `demo@hesabkon.app` / `demo1234`. **Change or remove this account before exposing the deployment publicly.**

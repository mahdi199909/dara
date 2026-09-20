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
| `LOG_SLOW_REQUEST_MS`, `LOG_SLOW_QUERY_MS` | no | A request / a database call at least this slow is logged as a warning (defaults 1000 / 300 ms) |
| `LOG_HASH_SECRET` | no | Key for the e-mail pseudonyms in login-failure log lines; defaults to `JWT_SECRET` |
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

## 5b. Updating a running deployment

```bash
cd /path/to/checkout
git pull
GIT_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build   # rebuilds the app image; `prisma db push` runs again at container start
```

`GIT_COMMIT` is baked into the image so every log line says which build wrote it (the image has no `.git`
to ask). Leaving it out is harmless — the records then say `git_commit: "unknown"`.

`db push` runs with `--accept-data-loss` (see the `Dockerfile`), which is safe for the changes shipped so far: it adds new
tables/columns (such as `SyncTombstone`, `Reminder.updatedAt`) and converts the money columns from `integer` to
`double precision` **in place, keeping every value** (a whole-Toman amount is exact in a double up to ~9 quadrillion).
That conversion is what lifts the old ~2.1 billion Toman ceiling (PostgreSQL's 32-bit `integer`); it was checked on a
real PostgreSQL 16 by loading the previous schema with data, running exactly this command, and reading the values back.
Back up first anyway (`pg_dump`, see section 5) — it is one command and the conversion rewrites those tables.

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

## 5c. Releasing a new Android APK

The app is called **parvaapp** wherever a person sees a name — the launcher label, the download file `parvaapp.apk` and
the UI copy (`APP_NAME` in `src/lib/appVersion.ts`) — and there is one permanent download link:

    https://my.parvaapp.ir/parvaapp.apk

`next.config.mjs` redirects it to `https://github.com/mahdi199909/dara/releases/latest/download/parvaapp.apk`, which
GitHub points at the newest **release**'s `parvaapp.apk`. The link itself never changes; publishing a release is what
changes what it downloads (and it works without logging in).

**Versions.** `package.json`'s version is the only source. The APK's `versionName` is that version and its `versionCode`
is derived from it (`1.1.0` → `10100`, i.e. major·10000 + minor·100 + patch, with minor and patch below 100), so it
always grows with the version and is known before the APK exists. Builds made before 1.1.0 used the CI run number
(always far below 10000), so they read as older. Never change the application id (`ir.mganic.dara`) or the signing key
(`android/app/debug.keystore`): Android would treat the result as a different app and refuse to install it over the old one.

**To release X.Y.Z**

1. Bump the version in `package.json` (`npm version X.Y.Z --no-git-tag-version`) **and** `LATEST_APP_RELEASE.versionName`
   in `src/lib/appVersion.ts`. A test, and the CI, fail if the two disagree.
2. Commit and push to `master`, then tag and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. CI
   (`.github/workflows/build-android.yml`) builds the APK, fails if the file does not carry the right version,
   application id and name, and publishes it as the release asset `parvaapp.apk`. (Pushes to `master` without a tag
   only produce a test build, kept as the `parvaapp-apk` workflow artifact — nobody is told about those.)
3. **After** the tag's run is green and the release exists, deploy the server (section 5b). From then on every install
   older than X.Y.Z shows "نسخه جدید … آماده‌ی دانلود است" with a download button that opens the permanent link. Deploying
   first would announce a version nobody can download yet.
4. Check: `curl -s https://my.parvaapp.ir/api/app/version` reports the new `latestVersionName`, and
   `curl -sIL https://my.parvaapp.ir/parvaapp.apk` ends in a `200` whose `content-disposition` names `parvaapp.apk`.

**How installed apps find out.** On every launch and every resume the app asks the public `GET /api/app/version` (no
login needed — it also reaches phones that only ever worked offline) and compares its own `versionCode` with
`latestVersionCode`. Older → the update notice with the download link; below `minSupportedVersionCode` → the
blocking "به‌روزرسانی لازم است" screen. The minimum is `1` (nobody is ever forced) unless an admin raises it at
`/admin` → «کنترل نسخه اپ اندروید», which also lets the owner announce a higher number or use another download link;
what is saved there only overrides the release shipped in code, so a stale row can never hide a newer release.

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

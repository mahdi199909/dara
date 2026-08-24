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

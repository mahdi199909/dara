# Production image for Hesabkon, targeting PostgreSQL (see DEPLOYMENT.md).
#
# This uses `prisma db push` at container start rather than versioned migrations,
# because prisma/migrations/ was generated against the SQLite schema used for local
# development and is not compatible with PostgreSQL's SQL dialect. `db push` syncs
# prisma/schema.postgresql.prisma straight to the database, which is fine for a
# single-user personal app; switch to `prisma migrate deploy` with a fresh Postgres
# migration history later if you want versioned migrations.
#
# NOTE: built/verified by static review only — this sandbox has no Docker daemon to
# run an actual `docker build`/`docker compose up` against. Test before relying on it.

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
# python3/make/g++: needed to compile better-sqlite3's native addon during `npm ci`. It's a
# devDependency (test-only, used by vitest to exercise the on-device local data layer — see
# src/local/drivers/nodeSqlite.ts) never touched by the actual running app, but `npm ci` still
# installs+builds all devDependencies, and node-gyp has nothing to compile against on bare
# node:20-alpine otherwise.
RUN apk add --no-cache python3 make g++

COPY . .
# Use the PostgreSQL schema for this image (the default schema.prisma targets SQLite for
# zero-setup local dev — see prisma/schema.postgresql.prisma). Must happen before `npm ci`:
# npm ci's own postinstall hook runs `prisma generate` immediately, and needs both a
# schema.prisma file to exist at all (copied in by `COPY . .` just above) and for it to
# already be the Postgres variant, since generate bakes the datasource provider into the
# generated client.
RUN cp prisma/schema.postgresql.prisma prisma/schema.prisma
RUN npm ci
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production

# Explicit `-p 3000` (not just `npm run start` / an ENV PORT default) because the host
# platform (e.g. Railway) injects its own PORT env var at container runtime — which
# overrides any ENV PORT baked into the image — and that injected value is NOT stable
# across redeploys (observed 8080 on one deploy, 3000 on the next). A CLI flag takes
# precedence over the PORT env var in Next.js's own port resolution, so this pins the
# app to a fixed, known port regardless of whatever the platform injects, and the
# platform's public domain just needs to target that same fixed port once.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && npx next start -p 3000"]

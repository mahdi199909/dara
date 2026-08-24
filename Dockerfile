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
ENV PORT=3000

CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && npm run start"]

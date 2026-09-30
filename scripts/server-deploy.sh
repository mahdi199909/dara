#!/usr/bin/env bash
# Run on the server, in /opt/parva: updates the running deployment to origin/master.
#
#   scripts/server-deploy.sh            # code only
#   scripts/server-deploy.sh v1.7.4     # also puts that release's APK in ./downloads first
#
# Over ssh, run it detached so a dropped connection cannot stop it half way (the build takes ~7 minutes):
#   nohup setsid scripts/server-deploy.sh v1.7.4 > /root/backups/deploy-$(date +%Y%m%d-%H%M%S).log 2>&1 < /dev/null &
# The last line of the log is DEPLOY_EXIT=<code>.
#
# Order: free space -> database backup -> keep the running image as parva-app:rollback -> pull -> APK ->
# build and restart the app -> wait until it answers -> clear the build leftovers. Nothing here deletes
# data; it stops at the first failure, and until the build finishes the old container keeps serving.
#
# Why the space checks: on 2026-09-30 the 40 GB disk filled up (a rollback image kept per deploy, ~1.8 GB
# each, plus 20 GB of build cache). nginx then cut every large response short and Postgres crash-looped
# on "No space left on device". So: one rollback image, not one per release, and the build cache is
# cleared after every deploy.
set -euo pipefail
trap 'echo "DEPLOY_EXIT=$?"' EXIT
cd "$(dirname "$0")/.."
TAG="${1:-}"
MIN_FREE_GB=8
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p /root/backups

free_gb() { df -BG --output=avail / | tail -1 | tr -dc '0-9'; }

# 1. Room to build.
if [ "$(free_gb)" -lt "$MIN_FREE_GB" ]; then
  echo "== only $(free_gb) GB free; clearing the build cache"
  docker builder prune -af > /dev/null
fi
[ "$(free_gb)" -ge "$MIN_FREE_GB" ] || { echo "only $(free_gb) GB free, $MIN_FREE_GB needed - stopping (see: docker system df, docker images)" >&2; exit 1; }
echo "== free before: $(free_gb) GB; at $(git rev-parse --short HEAD) on $(git branch --show-current)"

# 2. Backup (the container's own env supplies the credentials), then prove it is readable.
BK="/root/backups/parva-pre-deploy-$TS.sql.gz"
docker exec parva-postgres-1 sh -c 'pg_dump --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < /dev/null | gzip > "$BK"
gzip -t "$BK"
echo "== backup: $BK ($(stat -c %s "$BK") bytes)"

# 3. Quick rollback: the image that is running now, under one fixed name. Older per-release names
# (parva-app:before-*) are dropped so they do not pile up.
docker tag "$(docker inspect --format '{{.Image}}' parva-app-1)" parva-app:rollback
for old in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^parva-app:before-' || true); do docker rmi "$old" > /dev/null; done
echo "== rollback image: parva-app:rollback"

# 4. Code.
git fetch --quiet origin
git merge-base --is-ancestor HEAD origin/master || { echo "server HEAD is not an ancestor of origin/master - stopping" >&2; exit 1; }
git checkout -q master
git pull --quiet --ff-only origin master
echo "== now: $(git rev-parse --short HEAD) $(git log -1 --format=%s)"

# 5. The APK must be downloadable before the server announces the version.
[ -z "$TAG" ] || bash scripts/server-fetch-apk.sh "$TAG" < /dev/null

# 6. Build and restart the app only.
GIT_COMMIT="$(git rev-parse --short HEAD)" docker compose up -d --build app < /dev/null

# 7. Wait until it answers.
CODE=000
for _ in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:3000/login || true)"
  [ "$CODE" = "200" ] && break
  sleep 4
done
[ "$CODE" = "200" ] || { echo "the app does not answer (/login -> $CODE); roll back with: docker tag parva-app:rollback parva-app:latest && docker compose up -d app" >&2; exit 1; }
echo "== up: $(curl -s -m 10 http://127.0.0.1:3000/api/app/version)"

# 8. Leftovers of the build: the cache and images no name points at any more.
docker builder prune -af > /dev/null
docker image prune -f > /dev/null
echo "== free after: $(free_gb) GB"
docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}'

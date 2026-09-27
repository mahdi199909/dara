#!/usr/bin/env bash
# Run on the server, in /opt/parva: puts the published APK of a release into ./downloads, which the app
# serves at https://my.parvaapp.ir/parvaapp.apk (src/app/api/app/apk/route.ts).
#
#   scripts/server-fetch-apk.sh v1.7.2
#
# The file is downloaded next to the old one and swapped in with a rename only once it is complete and
# checked (right size, a zip), so a download in progress never serves half a file. The previous APK is
# kept as parvaapp.previous.apk. (If the repository is ever made private, pass a token in GITHUB_TOKEN.)
set -euo pipefail
TAG="${1:?usage: server-fetch-apk.sh vX.Y.Z}"
REPO="mahdi199909/dara"
DIR="$(cd "$(dirname "$0")/.." && pwd)/downloads"
mkdir -p "$DIR"
AUTH=()
[ -n "${GITHUB_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")

META="$(curl -fsSL "${AUTH[@]}" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases/tags/$TAG")"
ASSET_URL="$(printf '%s' "$META" | grep -o '"url": *"https://api.github.com/repos/[^"]*/releases/assets/[0-9]*"' | head -n1 | sed 's/.*"\(https[^"]*\)"/\1/')"
SIZE="$(printf '%s' "$META" | grep -o '"size": *[0-9]*' | head -n1 | grep -o '[0-9]*$')"
[ -n "$ASSET_URL" ] && [ -n "$SIZE" ] || { echo "no parvaapp.apk asset on release $TAG" >&2; exit 1; }

TMP="$DIR/.parvaapp.apk.part"
curl -fsSL "${AUTH[@]}" -H "Accept: application/octet-stream" -o "$TMP" "$ASSET_URL"
GOT="$(stat -c %s "$TMP")"
[ "$GOT" = "$SIZE" ] || { echo "size mismatch: got $GOT, release says $SIZE" >&2; rm -f "$TMP"; exit 1; }
[ "$(head -c 2 "$TMP")" = "PK" ] || { echo "not a zip/APK" >&2; rm -f "$TMP"; exit 1; }

[ -f "$DIR/parvaapp.apk" ] && cp -p "$DIR/parvaapp.apk" "$DIR/parvaapp.previous.apk"
chmod 644 "$TMP"
mv -f "$TMP" "$DIR/parvaapp.apk"
echo "$TAG" > "$DIR/VERSION"
sha256sum "$DIR/parvaapp.apk"
echo "served now: $TAG ($SIZE bytes)"

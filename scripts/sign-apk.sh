#!/usr/bin/env bash
# Signs an APK with the private key, and with nothing else.
#
# Up to 1.7.2 the app's id was ir.mganic.dara and its installs had been signed with the public debug key, so
# the published APK carried a key rotation (debug key -> private key) to stay installable over them. Since
# the id became ir.parvaapp there is no older install of THIS app to stay compatible with: every phone,
# Android 7 included, sees the private key only, and the debug key appears nowhere in the file. Every later
# version signed the same way installs over this one as an ordinary update — no uninstall.
#
# Usage: sign-apk.sh <in.apk> <out.apk> <key.p12> <password-env-var-name>
# (Gradle has already signed <in.apk> with the debug key; signing again replaces that signature.)
set -euo pipefail

IN="$1"
OUT="$2"
KS="$3"
PASS_VAR="$4"
BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
APKSIGNER="$BUILD_TOOLS/apksigner"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

"$APKSIGNER" sign \
  --ks "$KS" --ks-type PKCS12 --ks-key-alias parva --ks-pass "env:$PASS_VAR" --key-pass "env:$PASS_VAR" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
  --out "$OUT" "$IN"

# Prove it: one signer, the private key, for the oldest Android this app runs on and for the newest.
digests() { "$APKSIGNER" verify --print-certs "$@" "$OUT" | awk '/certificate SHA-256 digest/ {print $NF}' | sort -u; }
want="$(openssl pkcs12 -in "$KS" -passin "env:$PASS_VAR" -nokeys 2>/dev/null | openssl x509 -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':' | tr 'A-F' 'a-f')"
debug="$(keytool -list -v -keystore "$ROOT/android/app/debug.keystore" -storepass android -alias androiddebugkey | awk '/SHA256:/ && !f {print $2; f=1}' | tr -d ':' | tr 'A-F' 'a-f')"
old="$(digests --min-sdk-version 24 --max-sdk-version 27)"
new="$(digests --min-sdk-version 28)"
echo "Android 7-8 see: $old"
echo "Android 9+  see: $new"
echo "private key:     $want"
[ "$old" = "$want" ] || { echo "::error::Android 7-8 do not see exactly the private key"; exit 1; }
[ "$new" = "$want" ] || { echo "::error::Android 9+ do not see exactly the private key"; exit 1; }
[ "$want" != "$debug" ] || { echo "::error::the signing key is the public debug key"; exit 1; }
"$APKSIGNER" verify -v "$OUT" | grep -E "Verified using v(1|2|3)"

#!/usr/bin/env bash
# Signs an APK with the private key while keeping it installable as an update over every build signed
# with the old, public debug key — APK Signature Scheme v3 key rotation:
#
#   - Android 9+ (API 28+) sees the new private key, plus a "proof of rotation" (the lineage) in which the
#     old debug key vouches for the new one. Android accepts the update without an uninstall, and from
#     then on only the private key can sign an update for that phone. The old key keeps no right to sign
#     updates after rotation ("rollback" off), so a debug-signed APK can no longer replace the app.
#   - Android 7–8 (API 24–27) do not understand rotation; they keep verifying the old debug-key signature
#     (v1/v2), so they too update without an uninstall — but stay protected only by the public key.
#
# Usage: sign-apk-rotated.sh <in.apk> <out.apk> <new.p12> <password-env-var-name>
# The debug keystore (the old signer) is the committed android/app/debug.keystore.
set -euo pipefail

IN="$1"
OUT="$2"
NEW_KS="$3"
PASS_VAR="$4"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OLD_KS="$ROOT/android/app/debug.keystore"
BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
APKSIGNER="$BUILD_TOOLS/apksigner"
WORK="$(mktemp -d)"

old_signer=(--ks "$OLD_KS" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android)
new_signer=(--ks "$NEW_KS" --ks-type PKCS12 --ks-key-alias parva --ks-pass "env:$PASS_VAR" --key-pass "env:$PASS_VAR")

"$APKSIGNER" rotate --out "$WORK/lineage.bin" \
  --old-signer "${old_signer[@]}" --set-rollback false \
  --new-signer "${new_signer[@]}"

"$APKSIGNER" sign \
  "${old_signer[@]}" \
  --next-signer "${new_signer[@]}" \
  --lineage "$WORK/lineage.bin" \
  --rotation-min-sdk-version 28 \
  --v4-signing-enabled false \
  --out "$OUT" "$IN"

# Prove both halves: what an Android 7–8 phone checks, and what Android 9+ checks.
cert_digest() { "$APKSIGNER" verify --print-certs "$@" "$OUT" | awk '/certificate SHA-256 digest/ && !f {print $NF; f=1}'; }
old_digest="$(keytool -list -v -keystore "$OLD_KS" -storepass android -alias androiddebugkey | awk '/SHA256:/ && !f {print $2; f=1}' | tr -d ':' | tr 'A-F' 'a-f')"
new_digest="$(openssl pkcs12 -in "$NEW_KS" -passin "env:$PASS_VAR" -nokeys 2>/dev/null | openssl x509 -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':' | tr 'A-F' 'a-f')"
pre_p="$(cert_digest --min-sdk-version 24 --max-sdk-version 27)"
post_p="$(cert_digest --min-sdk-version 28)"
echo "Android 7-8 see: $pre_p (debug key: $old_digest)"
echo "Android 9+  see: $post_p (private key: $new_digest)"
[ "$pre_p" = "$old_digest" ] || { echo "::error::pre-Android-9 signature is not the debug key"; exit 1; }
[ "$post_p" = "$new_digest" ] || { echo "::error::Android 9+ signature is not the private key"; exit 1; }
"$APKSIGNER" verify -v "$OUT" | grep -E "Verified using v(1|2|3)"
"$APKSIGNER" lineage --in "$OUT" --print-certs -v
rm -rf "$WORK"

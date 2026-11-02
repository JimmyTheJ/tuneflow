#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
"$project_root/apps/android/gradlew" -p "$project_root/apps/android" assembleDebug testDebugUnitTest lintDebug --console=plain
apk_directory="$project_root/apps/android/app/build/outputs/apk/debug"
artifact="$apk_directory/tuneflow-native-0.4.0-debug.apk"
cp -- "$apk_directory/app-debug.apk" "$artifact"
delivery_directory="${TUNEFLOW_APK_DELIVERY_DIR:-/mnt/d/Users/jamus/Nextcloud/APKs}"
mkdir -p -- "$delivery_directory"
delivery="$delivery_directory/$(basename -- "$artifact")"
cp -- "$artifact" "$delivery"
source_hash="$(sha256sum -- "$artifact" | cut -d ' ' -f 1)"
delivery_hash="$(sha256sum -- "$delivery" | cut -d ' ' -f 1)"
if [[ "$source_hash" != "$delivery_hash" ]]; then
  printf 'APK delivery checksum mismatch\n' >&2
  exit 1
fi
printf 'Delivered %s\nSHA-256: %s\n' "$delivery" "$delivery_hash"

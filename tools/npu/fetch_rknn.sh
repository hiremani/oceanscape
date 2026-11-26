#!/usr/bin/env bash
# Puts Rockchip's NPU runtime and its header where the app's build finds them (both gitignored: Rockchip's
# RKNN SDK licence doesn't clearly allow redistributing them, so they're fetched, not committed):
#   android/app/src/main/jniLibs/arm64-v8a/librknnrt.so   bundled in the APK, used when the system has none
#   android/app/src/main/cpp/third_party/rknn/rknn_api.h  compiles the NPU code in (without it, it's left out)
# By running this you accept Rockchip's RKNN SDK licence:
#   https://github.com/airockchip/rknn-toolkit2/blob/master/LICENSE
# The files are checked against the SHA-256s of the version the app was written against (2.5.0).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
app="$here/../../android/app/src/main"
base=https://raw.githubusercontent.com/airockchip/rknn-toolkit2/master/rknpu2/runtime/Android/librknn_api
RT_SHA=7ec1f56dd3f19981283a225a348ece974664e3678c50d47b254b012e56bd5e21
H_SHA=2d4160cd868efd7b83a72587e411c16d6972da5876e067bd73665cea778ce666
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -sSfL -o "$tmp/librknnrt.so" "$base/arm64-v8a/librknnrt.so"
curl -sSfL -o "$tmp/rknn_api.h" "$base/include/rknn_api.h"
check() { echo "$2  $1" | shasum -a 256 -c - >/dev/null || { echo "fetch_rknn: $(basename "$1") doesn't match the expected SHA-256 (a newer upstream version?)" >&2; exit 1; }; }
check "$tmp/librknnrt.so" "$RT_SHA"
check "$tmp/rknn_api.h" "$H_SHA"
mkdir -p "$app/jniLibs/arm64-v8a" "$app/cpp/third_party/rknn"
cp "$tmp/librknnrt.so" "$app/jniLibs/arm64-v8a/librknnrt.so"
cp "$tmp/rknn_api.h" "$app/cpp/third_party/rknn/rknn_api.h"
echo "fetch_rknn: runtime and header in place (2.5.0)"

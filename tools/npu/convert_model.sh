#!/usr/bin/env bash
# Builds the NPU detector's model, android/app/src/main/assets/npu/yolox_s-640-i8.rknn (gitignored: built, not
# committed): YOLOX-s from Rockchip's model zoo (Apache-2.0), int8-quantised for the RK3588 and calibrated on the
# car's own road camera, in Docker with Rockchip's rknn-toolkit2 (its licence: github.com/airockchip/rknn-toolkit2).
#
#   tools/npu/convert_model.sh ROUTE_DIR [ROUTE_DIR ...]
#
# Each ROUTE_DIR is a segment folder holding qcamera.ts (the comma's small road-camera video; see the drive-logs
# notes for where route copies live). About 30 frames each, one every 2 s, become the calibration set: scaled to
# 640 wide and letterboxed to 640x640 with the pad grey YOLOX was trained with (114 = 0x72), as the app feeds it.
# Pick drives with day and night, town and open road; 60-120 frames in all is plenty.
#
# Needs docker (runs linux/amd64 under emulation on Apple silicon: slow, ~10-20 min) and ffmpeg.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out_dir="$repo/android/app/src/main/assets/npu"
work=${WORK:-$(mktemp -d)}
ONNX_URL=https://ftrg.zbox.filez.com/v2/delivery/data/95f00b0fc900458ba134f8b180b3f7a1/examples/yolox/yolox_s.onnx
ONNX_SHA=a39c8476d10c242298d6a8654cb29937a9cc3c062358f4d96367689df23d1796
FRAMES_PER_ROUTE=${FRAMES_PER_ROUTE:-30}

[ $# -ge 1 ] || { sed -n 2,13p "$0"; exit 2; }
command -v docker >/dev/null || { echo "convert: docker is needed" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "convert: ffmpeg is needed" >&2; exit 1; }
mkdir -p "$work/model" "$work/lb" "$out_dir"

if [ ! -f "$work/model/yolox_s.onnx" ]; then
  echo "convert: downloading yolox_s.onnx (Rockchip model zoo, ~34 MB)"
  curl -sSfL -o "$work/model/yolox_s.onnx" "$ONNX_URL"
fi
echo "$ONNX_SHA  $work/model/yolox_s.onnx" | shasum -a 256 -c - >/dev/null || { echo "convert: yolox_s.onnx checksum mismatch" >&2; exit 1; }

# calibration frames, letterboxed exactly as the app does (npu_post.cpp: pad 114 grey, centred)
: > "$work/dataset.txt"
for dir in "$@"; do
  ts="$dir/qcamera.ts"
  [ -f "$ts" ] || { echo "convert: no qcamera.ts in $dir, skipped" >&2; continue; }
  name=$(basename "$dir")
  ffmpeg -loglevel error -y -i "$ts" \
    -vf "fps=1/2,scale=640:-2:flags=bilinear,pad=640:640:(ow-iw)/2:(oh-ih)/2:color=0x727272" \
    -frames:v "$FRAMES_PER_ROUTE" "$work/lb/${name}_%02d.png"
done
for f in "$work"/lb/*.png; do echo "/data/lb/$(basename "$f")" >> "$work/dataset.txt"; done
n=$(wc -l < "$work/dataset.txt" | tr -d ' ')
[ "$n" -ge 20 ] || { echo "convert: only $n calibration frames; give more routes" >&2; exit 1; }
echo "convert: $n calibration frames; converting in Docker (linux/amd64)"

docker run --rm --platform linux/amd64 \
  -v "$work:/data" -v "$out_dir:/out" -v "$here:/scripts:ro" \
  python:3.11-slim bash /scripts/convert_in_docker.sh
ls -l "$out_dir/yolox_s-640-i8.rknn"
echo "convert: done; the simulator's detections on a few frames are printed above as a sanity check"

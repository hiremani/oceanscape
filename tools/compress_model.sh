#!/usr/bin/env bash
# compress_model.sh [in.glb] [out.glb]: meshopt-compress the Ocean model. The model is geometry-heavy (~800k
# triangles, ~20 MB of vertices; its textures are small), so EXT_meshopt_compression plus mesh quantization
# shrinks it about 3x to load and stores the vertices smaller in VRAM, without changing topology, materials or
# the drive/cutaway animations. It is lossless on triangle counts and only quantizes vertex attributes, which is
# not visible on a HUD-sized car.
#
# Run it after re-exporting from Blender (tools/export_ocean_glb.py). The committed third_party/models/*.glb is
# the compressed output; static/js/models.js loads it with the vendored decoder
# (third_party/three/meshopt_decoder.module.js), so the two must ship together. Needs node/npx, which fetches
# @gltf-transform/cli the first time.
set -eu
cd "$(dirname "$0")/.."
in=${1:-third_party/models/pulse_ocean_v0.10_parts.glb}
out=${2:-$in}
[ -f "$in" ] || { echo "no such model: $in" >&2; exit 1; }
tmp=$(mktemp -t ocean_meshopt).glb
npx --yes @gltf-transform/cli@4 meshopt "$in" "$tmp"
before=$(wc -c < "$in")
mv "$tmp" "$out"
after=$(wc -c < "$out")
printf 'wrote %s: %d -> %d bytes (%.1fx smaller)\n' "$out" "$before" "$after" "$(echo "$before / $after" | bc -l)"

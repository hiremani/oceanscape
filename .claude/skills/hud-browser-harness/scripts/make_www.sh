#!/usr/bin/env bash
# make_www.sh <www dir>: a folder that looks like the app's server root (/, /vendor, /models, /dbc) made of symlinks
# into the repo, with set.html (the driver page) copied in. Idempotent; the repo is found from this script's location.
set -eu
www=${1:?www dir (use the scratchpad)}
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
mkdir -p "$www"
for f in "$repo"/static/*; do ln -sfn "$f" "$www/$(basename "$f")"; done
ln -sfn "$repo/third_party/three" "$www/vendor"
ln -sfn "$repo/third_party/models" "$www/models"
ln -sfn "$repo/dbc" "$www/dbc"
cp "$here/set.html" "$www/set.html"
echo "www at $www"

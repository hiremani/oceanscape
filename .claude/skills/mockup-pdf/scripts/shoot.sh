#!/bin/sh
# Screenshot every mockup screen with headless Chrome at its native size.
set -e
SP="$(cd "$(dirname "$0")" && pwd)"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$SP/shots"
for f in "$SP"/screens/*.html; do
  n=$(basename "$f" .html)
  case "$n" in *landscape*) size=1784,1080;; *) size=1080,1784;; esac
  rm -f "$SP/shots/$n.png"
  "$CH" --headless=new --no-sandbox --disable-gpu --user-data-dir="$SP/chr" --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=$size --screenshot="$SP/shots/$n.png" "file://$f" >/dev/null 2>&1 &
  P=$!
  i=0; while [ $i -lt 40 ]; do sleep 1; [ -s "$SP/shots/$n.png" ] && break; i=$((i+1)); done
  kill $P 2>/dev/null || true; wait $P 2>/dev/null || true
  [ -s "$SP/shots/$n.png" ] && echo "ok $n" || echo "FAILED $n"
done

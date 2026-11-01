#!/usr/bin/env bash
# shoot_page.sh <out.png> [query] [WxH]: a screenshot of the real page, run by headless Chrome against the harness
# server (serve_www.py on $PORT, default 18093), with set.html's query, at Pulse's size (1080x1784 portrait by default).
#   shoot_page.sh glance_drive.png 'layout=glance&drive=1&dbg=0'
#   shoot_page.sh tiles_land.png 'layout=tiles&theme=dark' 1784x1080
# Chrome is killed once the file exists: headless Chrome does not exit by itself after --screenshot here.
set -u
out=${1:?output png}; query=${2:-}; size=${3:-1080x1784}
port=${PORT:-18093}
ch=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
prof=${PROFILE:-$(dirname "$out")/chrome-profile}
mkdir -p "$prof"
rm -f "$out"
"$ch" --headless=new --no-sandbox --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader \
  --user-data-dir="$prof" --hide-scrollbars --force-device-scale-factor=1 --window-size="${size/x/,}" \
  --screenshot="$out" "http://127.0.0.1:$port/set.html?$query" >"$out.log" 2>&1 &
pid=$!
i=0; while [ $i -lt 60 ]; do sleep 1; [ -s "$out" ] && break; i=$((i + 1)); done
kill $pid 2>/dev/null; wait $pid 2>/dev/null
[ -s "$out" ] && echo "ok $out" || { echo "FAILED $out (see $out.log)"; exit 1; }

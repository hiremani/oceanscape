#!/usr/bin/env bash
# pulse_resources.sh <device> [watch_seconds]: what the HUD app is costing on Pulse, and which blank-screen
# mechanism fires. The board's GPU and RAM are shared with Pulse's own app and up to two more builds, so a
# snapshot tells you how much headroom is left and whether native (lower fixed overhead) would buy much.
#
#   pulse_resources.sh 10.169.68.59            one-shot snapshot (RAM, our memory, GPU, jank)
#   pulse_resources.sh 10.169.68.59 180        the same, then watch the log 180s for a blank while you reproduce it
#
# No root needed. The two blank mechanisms (see MainActivity.onRenderProcessGone and scene.js context handling):
#   "WebView renderer gone"      -> the renderer PROCESS was killed (OOM); the app recreates it and reloads.
#   "WebHud: GL context lost"    -> the GL CONTEXT was dropped, process alive; scene.js restores it on the event.
# A blank with NEITHER line, and no "context restored" after a "lost", is the bug to chase.
set -eu
export PATH="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools:$PATH"
dev=${1:?device (ip:port or serial)}; watch=${2:-0}
pkg=${PKG:-ai.sunnypilot.oceanscape.hiremani}
case "$dev" in *.*:*) ;; *.*) dev="$dev:5555" ;; esac
case "$dev" in *.*) adb connect "$dev" </dev/null >/dev/null 2>&1 || true ;; esac
sh() { adb -s "$dev" shell "$@" </dev/null; }
[ "$(adb -s "$dev" get-state 2>/dev/null || true)" = device ] || { echo "$dev is not connected (asleep or wrong network?)" >&2; exit 1; }

echo "== board RAM =="
sh cat /proc/meminfo 2>/dev/null | grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' || echo "  (unreadable)"

echo; echo "== top memory by process (the other apps show here) =="
sh dumpsys meminfo 2>/dev/null | sed -n '/Total PSS by process/,/Total PSS by OOM/p' | grep -E 'K: ' | head -12 || echo "  (none)"

echo; echo "== $pkg =="
if sh pidof "$pkg" 2>/dev/null | grep -q '[0-9]'; then
  sh dumpsys meminfo "$pkg" 2>/dev/null | grep -E 'TOTAL|Native Heap|Dalvik Heap|Gfx dev|GL mtrack|EGL mtrack|Graphics' \
    | grep -vi 'TOTAL SWAP' || echo "  (no memory lines)"
  echo "  -- GPU memory above (Gfx dev / GL mtrack / EGL mtrack) is the WebGL footprint competing for the shared GPU."
  echo; echo "== jank (gfxinfo) =="
  sh dumpsys gfxinfo "$pkg" 2>/dev/null | grep -E 'Total frames|Janky frames|50th|90th|95th|99th|Number (Missed|High)' | head -10 || echo "  (no gfxinfo)"
else
  echo "  not running -- launch it: adb -s $dev shell am start -n $pkg/ai.sunnypilot.webhud.MainActivity"
fi

echo; echo "== recent blank-screen events in the log =="
sh logcat -d -t 2000 2>/dev/null \
  | grep -Ei 'GL context (lost|restored)|renderer gone|lowmemorykiller|am_kill.*'"$pkg"'|Out of memory' | tail -20 \
  || echo "  (none in the recent log)"

if [ "$watch" -gt 0 ]; then
  echo; echo "== watching ${watch}s -- reproduce the blank now (Ctrl-C to stop early) =="
  adb -s "$dev" logcat -c </dev/null 2>/dev/null || true
  ( adb -s "$dev" logcat </dev/null & echo $! >/tmp/.pr_lc ) \
    | grep --line-buffered -Ei 'WebHud|renderer gone|lowmemorykiller|GL context|Out of memory' &
  gp=$!
  sleep "$watch" || true
  kill "$(cat /tmp/.pr_lc 2>/dev/null)" "$gp" 2>/dev/null || true
  rm -f /tmp/.pr_lc
  echo "== done; the lines above are what the car logged during the window =="
fi

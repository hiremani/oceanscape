#!/usr/bin/env bash
# pulse_shot.sh <device> [name]: a screenshot of Pulse's screen, saved as <name>.png in $OUT (default: the current
# directory) and its pixel size printed. Read the PNG afterwards to see what the car shows.
set -eu
export PATH="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools:$PATH"
dev=${1:?device (ip:port or serial)}; name=${2:-pulse}
case "$dev" in *.*:*) ;; *.*) dev="$dev:5555" ;; esac
case "$dev" in *.*) adb connect "$dev" </dev/null >/dev/null ;; esac
out="${OUT:-.}/$name.png"
adb -s "$dev" exec-out screencap -p </dev/null > "$out"
[ -s "$out" ] || { echo "empty screenshot: is $dev awake and connected?" >&2; exit 1; }
python3 -c 'import struct,sys; d=open(sys.argv[1],"rb").read(24); print(sys.argv[1], "%dx%d" % struct.unpack(">II", d[16:24]))' "$out"

#!/usr/bin/env bash
# Put Mrichchhakatikam on the car's Pulse board one careful stage at a time, stopping at anything unexpected.
#
#   tools/car_deploy.sh [run]          # the whole walk-through: build, install, read-only checks, comma, drive
#   tools/car_deploy.sh controls       # optional, parked only: try the car controls one at a time
#   tools/car_deploy.sh check          # compare the filters and the buses with what was saved before the install
#   tools/car_deploy.sh stop           # force-stop the app (closing it leaves its CAN reader running)
#   tools/car_deploy.sh undo           # force-stop, uninstall, reboot Pulse, check the filters came back
#
#   --device <ip[:port]|serial>   the board (asked for if there's more than one, or none)
#   --skip-build                  use the APK already built
#   --emulator                    rehearse on an emulator: no CAN there, so the CAN checks are skipped
#
# Nothing here sends to the car. The controls stage asks you to press things in the app, and only watches the log.
# What it saves (the stock filters above all) goes to ~/.oceanscape-car/<time>, with `latest` pointing at the newest.
set -u   # no pipefail: `... | grep -q` closes the pipe early, and that would read as a failure

PKG=ai.sunnypilot.oceanscape.hiremani
BEN_PKG=ai.sunnypilot.oceanscape
BRANCH=pulse-coexist
PARAMS=/sys/module/mcp251x/parameters
LOCAL_PORT=18090
FORWARD_PORT=28090

root=$(cd "$(dirname "$0")/.." && pwd)
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
apk="$root/android/app/build/outputs/apk/release/app-release.apk"
canids="$root/android/app/src/main/java/ai/sunnypilot/webhud/CanIds.kt"
state_root="${OCEANSCAPE_CAR_DIR:-$HOME/.oceanscape-car}"

cmd=run; device=""; skip_build=0; emulator=0
while [ $# -gt 0 ]; do
  case "$1" in
    run|controls|check|stop|undo) cmd=$1 ;;
    --device) device=${2:?--device needs a value}; shift ;;
    --skip-build) skip_build=1 ;;
    --emulator) emulator=1 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

# ---- output and prompts ----------------------------------------------------------------------------------

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=; G=; Y=; R=; N=; fi
stage() { printf '\n%s== %s ==%s\n' "$B" "$*" "$N"; }
why()   { printf '   why: %s\n' "$*"; }
ok()    { printf '%sOK%s    %s\n' "$G" "$N" "$*"; }
warn()  { printf '%sWARN%s  %s\n' "$Y" "$N" "$*"; }
bad()   { printf '%sFAIL%s  %s\n' "$R" "$N" "$*"; }
die()   { bad "$*"; printf 'Stopped. To take it all back off: tools/car_deploy.sh undo\n'; exit 1; }

answer=""
ask() { printf '%s ' "$1"; IFS= read -r answer || die "no more input"; }

# Yes only when asked for: Enter means no, the safe answer.
confirm() { ask "$1 [y/N]"; case "$answer" in y|Y|yes|YES) return 0 ;; esac; return 1; }

# Stop unless the person says this is true. For the things only a person can see.
must() { confirm "$1" || die "not confirmed: $1"; }

# For conditions that matter most: a typed word can't be a stray Enter.
must_type() {
  ask "$1 Type $2 to go on:"
  [ "$answer" = "$2" ] || die "didn't get $2"
}

pause() { ask "$1 Press Enter when done."; }

# ---- the board -------------------------------------------------------------------------------------------

# Everything to adb has stdin closed: adb shell would otherwise swallow the answers meant for the prompts.
A() { adb -s "$device" "$@" </dev/null; }
sh_() { A shell "$@" 2>/dev/null | tr -d '\r'; }

online_devices() { adb devices </dev/null | tr -d '\r' | awk 'NR>1 && $2=="device" {print $1}'; }

choose_device() {
  command -v adb >/dev/null || die "no adb in $ANDROID_HOME/platform-tools"
  if [ -z "$device" ]; then
    local found; found=$(online_devices)
    if [ "$(printf '%s\n' "$found" | grep -c .)" = 1 ]; then
      device=$found
    else
      [ -n "$found" ] && printf 'Connected now:\n%s\n' "$found"
      ask "Pulse's address (ip, or ip:port) or serial:"
      device=$answer
    fi
  fi
  [ -n "$device" ] || die "no device given"
  case "$device" in
    *.*) case "$device" in *:*) ;; *) device="$device:5555" ;; esac
         adb connect "$device" </dev/null >/dev/null 2>&1 ;;
  esac
  local i=0
  until [ "$(A get-state 2>/dev/null | tr -d '\r')" = device ]; do
    i=$((i + 1))
    [ "$i" -le 20 ] || die "$device doesn't answer over adb. The repo doesn't document reaching Pulse: check the network, USB, and that adb is on"
    [ "$i" = 1 ] && printf 'Waiting for %s' "$device"
    printf '.'; sleep 3
  done
  [ "$i" -gt 0 ] && printf '\n'
  ok "connected to $device ($(sh_ getprop ro.product.model), Android $(sh_ getprop ro.build.version.release))"
}

# This is the check that keeps the script off the wrong device: Pulse has the CAN driver, and a phone doesn't.
check_is_pulse() {
  case "$device" in
    emulator-*) [ "$emulator" = 1 ] || die "$device is an emulator. Use --emulator to rehearse, or --device for Pulse" ;;
  esac
  [ "$emulator" = 1 ] && { warn "rehearsal on an emulator: CAN checks are skipped"; return; }
  sh_ ls -d "$PARAMS" | grep -q mcp251x || die "$device has no $PARAMS, so it isn't Pulse"
  sh_ ls -d /sys/class/net/can1 | grep -q can1 || die "$device has no can1"
  ok "this is a board with the mcp251x CAN driver and can1"
}

read_filters() { sh_ "cd $PARAMS && grep . rxb_mode_* rxb_mask_* rxb_filter_*"; }

# rx_packets dropped errors missed, each interface's kernel counters
counters() { sh_ "cat /sys/class/net/$1/statistics/rx_packets /sys/class/net/$1/statistics/rx_dropped /sys/class/net/$1/statistics/rx_errors /sys/class/net/$1/statistics/rx_missed_errors" | tr '\n' ' '; }

# One line per bus: over 10 s, frames in, drops and errors, and the controller's state.
measure() {
  local label=$1 out=$2 a1 a2 b1 b2
  a1=$(counters can1); a2=$(counters can2); sleep 10; b1=$(counters can1); b2=$(counters can2)
  {
    printf '%s can1 ' "$label"; delta "$a1" "$b1"
    printf '%s can2 ' "$label"; delta "$a2" "$b2"
  } | tee -a "$out"
  local s
  for ifc in can1 can2; do
    s=$(sh_ ip -d link show "$ifc" | grep -oE 'BUS-OFF|ERROR-PASSIVE|ERROR-WARNING|ERROR-ACTIVE|STOPPED' | head -1)
    case "$s" in
      ERROR-ACTIVE) ;;
      "") warn "$ifc: couldn't read the controller's state" ;;
      *) warn "$ifc is $s: the bus or the controller is unhappy" ;;
    esac
  done
}

delta() {
  # shellcheck disable=SC2086
  set -- $1 $2
  printf 'frames/10s=%s dropped=%s errors=%s missed=%s\n' "$(($5 - $1))" "$(($6 - $2))" "$(($7 - $3))" "$(($8 - $4))"
}

# The car must be talking: with a silent bus none of the later checks would mean anything.
wait_for_bus() {
  printf 'Waiting for traffic on can1 (wake the car if it is asleep)'
  local i=0 a b
  while :; do
    a=$(counters can1); a=${a%% *}; sleep 3; b=$(counters can1); b=${b%% *}
    if [ -n "$a" ] && [ -n "$b" ] && [ "$b" -gt "$a" ]; then printf '\n'; ok "the car's bus is awake"; return; fi
    i=$((i + 1)); printf '.'
    if [ "$i" -ge 40 ]; then
      printf '\n'
      confirm "No traffic for 2 minutes. Keep waiting?" || die "the bus stayed silent"
      i=0
    fi
  done
}

# ---- what the app logs -----------------------------------------------------------------------------------

log_file=""; log_pid=""
start_log() {
  log_file=$1
  adb -s "$device" logcat -T 1 -v time -s WebHud </dev/null >>"$log_file" 2>&1 &
  log_pid=$!
}
stop_log() { [ -n "$log_pid" ] && { kill "$log_pid" 2>/dev/null; wait "$log_pid" 2>/dev/null; }; log_pid=""; }
cleanup() { stop_log; [ -n "$device" ] && adb -s "$device" forward --remove "tcp:$FORWARD_PORT" </dev/null >/dev/null 2>&1; }
trap cleanup EXIT
trap 'printf "\nInterrupted. The app is still as it was: tools/car_deploy.sh stop, or undo.\n"; exit 130' INT

# wait_log <regex> <seconds> <what>: true once the log shows it. Only lines after the launch are in the file.
wait_log() {
  local pattern=$1 limit=$2 what=$3 t=0
  while :; do
    if grep -qE "$pattern" "$log_file"; then ok "$what"; return 0; fi
    if [ "$t" -ge "$limit" ]; then
      warn "no sign in ${limit}s: $what"
      confirm "Wait another ${limit}s?" || return 1
      t=0
    fi
    sleep 2; t=$((t + 2))
  done
}

# ---- the filters -----------------------------------------------------------------------------------------

# Would the plan this build writes keep every ID the board's stock filters pass? Reads the values the board really
# has, where gen_ibus.py's DRIVER_DEFAULTS only has what the docs say. Exit 0 yes, 1 no, 3 couldn't read them.
check_plan_covers() {
  python3 -B - "$1" "$canids" <<'PY'
import re, sys
saved = dict(l.strip().split(":", 1) for l in open(sys.argv[1]) if ":" in l)
kt = open(sys.argv[2]).read()
plan = {}
for m in re.finditer(r'chip = (\d), mask0 = (0x\w+), filters0 = listOf\(([^)]*)\), mask1 = (0x\w+), filters1 = listOf\(([^)]*)\)', kt):
    plan[m[1]] = (int(m[2], 16), [int(x, 16) for x in m[3].split(",")], int(m[4], 16), [int(x, 16) for x in m[5].split(",")])
def passes(p, i):
    return any(i & p[0] == f & p[0] for f in p[1]) or any(i & p[2] == f & p[2] for f in p[3])
def fmt(ids):
    out, ids = [], sorted(ids)
    while ids:
        a = b = ids.pop(0)
        while ids and ids[0] == b + 1: b = ids.pop(0)
        out.append(f"0x{a:03X}-0x{b:03X}")
    return ", ".join(out)
lost_any = False
for chip, bus in (("0", "IBUS1"), ("1", "IBUS2")):
    try:
        masks = [int(x, 0) for x in saved[f"rxb_mask_{chip}"].split(",")]
        filters = [int(x, 0) for x in saved[f"rxb_filter_{chip}"].split(",")]
        assert len(masks) == 2 and len(filters) == 6
    except Exception as e:
        print(f"can't read the stock filters of {bus}: {e!r}")
        sys.exit(3)
    stock = (masks[0], filters[:2], masks[1], filters[2:])
    kept = [i for i in range(0x800) if passes(stock, i)]
    lost = [i for i in kept if not passes(plan[chip], i)]
    print(f"{bus}: stock passes {len(kept)} IDs ({fmt(kept)})")
    if lost:
        lost_any = True
        print(f"{bus}: this build's filters would LOSE {fmt(lost)}")
    else:
        print(f"{bus}: this build's filters keep all of them")
sys.exit(1 if lost_any else 0)
PY
}

filters_now_vs() {
  read_filters > "$1.now"
  diff "$1" "$1.now" >/dev/null
}

# Writes the saved values back, the way HwFilters.kt writes its own: needs root, and it's asked for first.
restore_filters() {
  local saved=$1 script="cd $PARAMS" name val
  while IFS=: read -r name val; do
    case "$name" in rxb_mask_*|rxb_filter_*) script="$script; echo '$val' > $name" ;; esac
  done < "$saved"
  script="$script; echo 1 > apply_filters"
  printf 'Would run as root:\n  %s\n' "$script"
  confirm "Write the saved filters back now?" || return 1
  if sh_ su -c id | grep -q uid=0; then A shell su -c "\"$script\"" 2>&1 | tr -d '\r'
  elif sh_ id | grep -q uid=0; then A shell "$script" 2>&1 | tr -d '\r'
  else warn "no root from this shell (try: adb root)"; return 1; fi
}

latest_dir() {
  [ -e "$state_root/latest" ] || die "nothing saved yet in $state_root: run the walk-through first"
  (cd "$state_root/latest" && pwd -P)
}

# ---- the stages ------------------------------------------------------------------------------------------

stage_build() {
  stage "Stage 1: build on this Mac"
  cd "$root" || die "no checkout at $root"
  local at; at=$(git symbolic-ref --short HEAD 2>/dev/null || echo detached)
  [ "$at" = "$BRANCH" ] || must "You're on '$at', not $BRANCH. Build from here anyway?"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || warn "the checkout has uncommitted changes, which go into this build"
  if [ "$skip_build" = 1 ]; then
    [ -f "$apk" ] || die "no APK at $apk: run without --skip-build"
    warn "using the APK already built ($(date -r "$apk" '+%Y-%m-%d %H:%M'))"
  else
    why "the tests catch a bad build before it reaches the car"
    npm test --silent >"$run_dir/npm-test.log" 2>&1 || die "worker tests failed: $run_dir/npm-test.log"
    ok "worker tests pass"
    (cd android && ./gradlew --quiet testDebugUnitTest assembleRelease) </dev/null >"$run_dir/gradle.log" 2>&1 \
      || die "the Android build or tests failed: $run_dir/gradle.log"
    ok "Android tests pass and the APK is built"
  fi
  local aapt; aapt=$(ls -d "$ANDROID_HOME"/build-tools/*/aapt2 2>/dev/null | sort | tail -1)
  if [ -n "$aapt" ]; then
    "$aapt" dump badging "$apk" 2>/dev/null | grep -q "name='$PKG'" || die "the APK isn't package $PKG, so it wouldn't install beside the others"
    ok "the APK is $PKG"
  fi
}

stage_prepare() {
  stage "Stage 2: parked, saving how the board is now"
  must_type "Parked somewhere safe, in P, handbrake on, nobody relying on the screens, comma not engaged?" PARKED
  check_is_pulse
  pause "Look at Pulse's app and the car's screens now, and note how they behave (read-outs, any lag)."
  why "you need a baseline to spot changes"

  if sh_ pm list packages "$PKG" | grep -q "package:$PKG\$"; then
    warn "$PKG is already installed: the 'before' values below may already be its filters, not the stock ones"
    must "Carry on, knowing that?"
  fi

  if [ "$emulator" = 1 ]; then return; fi

  wait_for_bus
  read_filters > "$run_dir/filters-before.txt"
  [ -s "$run_dir/filters-before.txt" ] || die "couldn't read the filters from $PARAMS, so there'd be nothing to restore"
  ok "saved the stock filters: $run_dir/filters-before.txt"
  cat "$run_dir/filters-before.txt"
  cp "$run_dir/filters-before.txt" "$run_dir/stock-filters.txt"
  sh_ ip -s -d link show can1 > "$run_dir/can1-before.txt"
  sh_ ip -s -d link show can2 > "$run_dir/can2-before.txt"

  printf 'Checking this build against the stock filters:\n'
  check_plan_covers "$run_dir/filters-before.txt"
  case $? in
    0) ok "if the app ever gets root, Pulse's app keeps every ID it has now" ;;
    1) warn "if the app gets root, Pulse's app would lose those IDs. Fix DRIVER_DEFAULTS in tools/gen_ibus.py, or deny root"
       must "Carry on anyway (Pulse grants root without a prompt)?" ;;
    *) warn "couldn't compare them"; must "Carry on anyway (Pulse grants root without a prompt)?" ;;
  esac

  printf 'Measuring the buses for 10 s, before the app runs:\n'
  measure before "$run_dir/bus.txt"

  if sh_ pm list packages "$BEN_PKG" | grep -q "package:$BEN_PKG\$"; then
    why "on a rooted board Ben's OceanScape overwrites the filters whenever it starts"
    if confirm "Ben's OceanScape is installed. Force-stop it now?"; then A shell am force-stop "$BEN_PKG" >/dev/null; ok "stopped"
    else warn "left running, so it can undo this build's filters"; fi
  fi
}

stage_install() {
  stage "Stage 3: install and first launch, read-only"
  why "installing doesn't start the app or touch the filters"
  A install -r "$apk" 2>&1 | tail -1 | tr -d '\r' | tee "$run_dir/install.txt"
  grep -q Success "$run_dir/install.txt" || die "the install failed (see above). INSTALL_FAILED_UPDATE_INCOMPATIBLE means another key signed the copy there"
  ok "installed"

  start_log "$run_dir/webhud.log"
  sleep 1
  printf '%sPulse grants root without asking (its su is open), so the app will rewrite the shared filters: they are checked below.%s\n' "$B" "$N"
  why "the filters it writes are a superset of the stock ones (DRIVER_DEFAULTS), and the stock ones were saved above"
  pause "Ready to launch: be at the screen."
  A shell am start -n "$PKG/ai.sunnypilot.webhud.MainActivity" >/dev/null 2>&1   # monkey does nothing on Pulse
  ok "launched"

  if [ "$emulator" = 1 ]; then
    wait_log 'CAN helper starting' 60 "the app started its CAN helper" || die "the app didn't come up"
    return
  fi

  wait_log 'CAN hardware filters' 120 "the app decided about the filters" || die "the app never got to the filters: $log_file"
  grep -E 'CAN hardware filters' "$log_file" | tail -3

  if filters_now_vs "$run_dir/filters-before.txt"; then
    ok "the filters are exactly as saved: Pulse's app is unaffected"
    warn "steering, yaw, seat and mirror positions, and charging data stay empty without root. That's expected"
  else
    warn "THE FILTERS CHANGED: the app has root, and Pulse's app shares them"
    diff "$run_dir/filters-before.txt" "$run_dir/filters-before.txt.now"
    must "Look closely at Pulse's app. Carry on with these filters?"
  fi

  wait_log 'CAN helper: .*ready' 60 "the CAN helper is ready" || die "the helper didn't start: $log_file"
  wait_log 'CAN frames flowing' 60 "CAN frames are reaching the app" || die "no frames reached the app: $log_file"

  printf 'Measuring the buses for 10 s, with the app running:\n'
  measure "with-app" "$run_dir/bus.txt"
  printf 'All measurements so far:\n'; cat "$run_dir/bus.txt"
  must "Does the 3D view show the car, and do Pulse's app and the car's screens behave as they did before?"
}

stage_comma() {
  stage "Stage 4: the comma (optional)"
  confirm "Add the comma now? It needs Settings > Developer > Web HUD in its sunnypilot" || {
    why "if it isn't there, don't switch branches for it: that system steers the car"
    return
  }
  pause "Still parked: turn on Web HUD on the comma, and put it on Pulse's hotspot."
  A forward "tcp:$FORWARD_PORT" "tcp:$LOCAL_PORT" >/dev/null || { warn "couldn't forward to the app's port"; return; }
  printf 'Waiting for the app to find the comma'
  local t=0 status
  while :; do
    status=$(curl -s -m 3 "http://127.0.0.1:$FORWARD_PORT/api/status" </dev/null)
    case "$status" in *\"version\"*) printf '\n'; ok "the comma answers through the app"; break ;; esac
    t=$((t + 1)); printf '.'; sleep 3
    if [ "$t" -ge 40 ]; then
      printf '\n'
      confirm "No comma after 2 minutes. Keep waiting?" || { warn "going on without the comma"; return; }
      t=0
    fi
  done
  must "Does the comma chip show, and does openpilot still behave normally, parked?"
}

stage_drive() {
  stage "Stage 5: a short drive, watching only (optional)"
  confirm "Do the drive now? It needs a passenger: the driver doesn't watch this, or this laptop" || {
    warn "no drive"; return
  }
  printf '%sRules: a quiet, familiar road. The passenger watches. The car controls stay closed: they work while moving.%s\n' "$B" "$N"
  why "this tests the read-only side under real traffic, with nothing to tap"
  must_type "Passenger ready, car controls closed?" DRIVE
  pause "Drive. Back parked?"
  must_type "Back in P with the handbrake on?" PARKED
  [ "$emulator" = 1 ] && return
  [ "$(A get-state 2>/dev/null | tr -d '\r')" = device ] || die "lost adb during the drive. Reconnect, then: tools/car_deploy.sh check"
  measure "after-drive" "$run_dir/bus.txt"
  cat "$run_dir/bus.txt"
  if grep -E 'CAN helper exited|CAN helper failed' "$log_file" >/dev/null; then warn "the CAN helper restarted during this run: see $log_file"; fi
  must "On the drive, did the HUD's speed, gear and objects agree with the car's own display, with Pulse's app normal?"
}

stage_stop() {
  stage "Closing the app"
  why "closing it from the screen leaves the background service reading CAN"
  A shell am force-stop "$PKG" >/dev/null
  sleep 1
  [ -z "$(sh_ pidof "$PKG")" ] && ok "stopped" || warn "it is still running"
}

do_run() {
  run_dir="$state_root/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$run_dir" || exit 1
  ln -sfn "$run_dir" "$state_root/latest"
  printf 'Saving this run to %s\n' "$run_dir"
  stage_build
  choose_device
  stage_prepare
  stage_install
  stage_comma
  stage_drive
  stage_stop
  stage "Done"
  ok "read-only checks finished. Everything is in $run_dir"
  printf 'The car controls are a separate, optional step: tools/car_deploy.sh controls\n'
}

do_controls() {
  run_dir=$(latest_dir)
  choose_device
  check_is_pulse
  stage "Car controls, parked only"
  printf '%sThe app has no speed or gear check on these: they would go out while driving.%s\n' "$B" "$N"
  why "these send real frames to the car, and earlier commits record some doing nothing"
  must_type "In P, handbrake on, key on you, people clear of the windows, mirrors and doors?" PARKED
  start_log "$run_dir/webhud-controls.log"
  sleep 1
  A shell am start -n "$PKG/ai.sunnypilot.webhud.MainActivity" >/dev/null 2>&1
  pause "Optional first look: Signals > IBUS1 > Check the link."

  local c before after
  for c in "Fan speed: one step" "Rear defrost: on, then off" "Mirror fold: fold, then unfold" \
           "Door lock: lock, then unlock (key on you)" "One window: a short move, hands clear"; do
    confirm "Try: $c?" || { warn "stopped trying controls"; break; }
    before=$(grep -c 'CAN send ' "$log_file")
    pause "Press it once in the app, and watch the car."
    after=$(grep -c 'CAN send ' "$log_file")
    if [ "$after" -gt "$before" ]; then
      ok "$((after - before)) send(s) logged:"; grep 'CAN send ' "$log_file" | tail -n "$((after - before))"
    else
      warn "nothing logged as sent: greyed out, asleep, or a mockup control"
    fi
    grep -E 'CAN send failed|helper not running|tx .*error' "$log_file" | tail -2
    if ! confirm "Did the car do what you asked, and nothing else?"; then
      warn "stopping here"; stage_stop
      printf 'The log is %s. To take it off: tools/car_deploy.sh undo\n' "$log_file"
      return
    fi
  done
  printf 'Seat moves, the sunroof, the liftgate and lamps are left out on purpose: they move heavy parts or affect other drivers, and some compete with the head unit'"'"'s messages.\n'
  stage_stop
}

do_check() {
  run_dir=$(latest_dir)
  choose_device
  check_is_pulse
  stage "How the board compares with the saved state"
  [ "$emulator" = 1 ] && { warn "nothing to compare on an emulator"; return; }
  if [ -f "$run_dir/filters-before.txt" ]; then
    if filters_now_vs "$run_dir/filters-before.txt"; then ok "the filters match what was saved"
    else warn "the filters differ from what was saved:"; diff "$run_dir/filters-before.txt" "$run_dir/filters-before.txt.now"; fi
  else warn "no saved filters in $run_dir"; fi
  printf 'App running: %s\n' "$(sh_ pidof "$PKG" | grep . || echo no)"
  measure "check" "$run_dir/bus.txt"
  cat "$run_dir/bus.txt"
}

do_undo() {
  choose_device
  run_dir=""
  [ -e "$state_root/latest" ] && run_dir=$(latest_dir)
  stage "Taking it back off"
  must_type "This uninstalls the app and reboots Pulse, which takes its screen away for a while. Parked?" PARKED
  A shell am force-stop "$PKG" >/dev/null
  ok "force-stopped"
  A uninstall "$PKG" 2>&1 | tr -d '\r' | tail -1
  confirm "Reboot Pulse now? It should restore the driver's stock filters (not yet tested on a car)" || {
    warn "not rebooted: if the app had root, the filters are still its filters"; return
  }
  A reboot
  sleep 5
  case "$device" in *:*) printf 'Reconnecting'; local i=0
    until adb connect "$device" </dev/null 2>/dev/null | grep -q connected && [ "$(A get-state 2>/dev/null | tr -d '\r')" = device ]; do
      i=$((i + 1)); [ "$i" -le 60 ] || die "Pulse isn't back after 5 minutes"; printf '.'; sleep 5
    done; printf '\n' ;;
  *) A wait-for-device ;;
  esac
  ok "Pulse is back"
  sleep 20
  [ "$emulator" = 1 ] && return
  [ -n "$run_dir" ] && [ -f "$run_dir/filters-before.txt" ] || { warn "no saved filters to compare with"; return; }
  if filters_now_vs "$run_dir/filters-before.txt"; then ok "the filters match what was saved before the install"
  else
    warn "the filters differ from what was saved:"
    diff "$run_dir/filters-before.txt" "$run_dir/filters-before.txt.now"
    restore_filters "$run_dir/filters-before.txt" && filters_now_vs "$run_dir/filters-before.txt" && ok "restored" || warn "not restored"
  fi
  must "Is Pulse's app back to normal?"
}

case "$cmd" in
  run) do_run ;;
  controls) do_controls ;;
  check) do_check ;;
  stop) choose_device; stage_stop ;;
  undo) do_undo ;;
esac

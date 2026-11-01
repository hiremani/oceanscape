---
name: pulse-deploy
description: Put a build of this app on the car's Pulse board and check it there - adb over Wi-Fi, install, launch, logcat, screenshots, the CAN filter and bus checks, the comma's health. Use this whenever the user wants the APK on the car, says "deploy", "install on Pulse", "put it on the car", "try it in the car", "adb", "screenshot the car's screen", "is the comma alive", or asks why the app does not start, does not show CAN data, or cannot be reached, and whenever adb, gradle or the install prints an error (device offline, unauthorized, INSTALL_FAILED_UPDATE_INCOMPATIBLE, SDK location not found, CAN helper exited): the "When it fails" table says what each one meant here. Also read it before writing anything that touches adb, Pulse's root shell or the CAN hardware filters, because several of the obvious commands silently do nothing on this board.
---

# Deploying to Pulse

Pulse is the Rockchip Android 13 board behind the Fisker Ocean's center screen. It runs this app, Pulse's own app and
up to two other builds of this HUD side by side, all reading the same CAN chips. The walk-through that installs a
build one careful stage at a time is `tools/car_deploy.sh`; this skill is what you need to know around it, and
for the quick manual loop once the app is already there.

## The quick loop

```bash
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
PKG=ai.sunnypilot.oceanscape.hiremani
adb connect 192.168.0.178:5555                     # Pulse on the home network "Hiremanis"; 192.168.92.181 on the car's own hotspot
adb -s 192.168.0.178:5555 install -r android/app/build/outputs/apk/release/app-release.apk
adb -s 192.168.0.178:5555 shell am start -n "$PKG/ai.sunnypilot.webhud.MainActivity"
adb -s 192.168.0.178:5555 logcat -v time -s WebHud
```

Build first with `cd android && ./gradlew assembleRelease` (the page is copied into the APK at build time, so a
page change reaches the car only through a new APK). `tools/car_deploy.sh --skip-build --device <ip>` runs the
same steps with the filter and bus checks around them.

## What is true of this board, and not of a phone

- **The Mac must be on the same network as Pulse.** Pulse's adb listens on TCP 5555 and nowhere else. When
  `adb connect` says "failed to connect" or times out at every known address, stop: the Mac is on another
  network, or Pulse is asleep with the car. Do not loop on it, and do not conclude the app is broken. Tell the
  user which addresses were tried.
- **`monkey -p $PKG 1` does nothing on Pulse.** Launch with `am start -n $PKG/ai.sunnypilot.webhud.MainActivity`.
  Closing the app from the screen leaves its CAN service running; `am force-stop $PKG` really stops it.
- **Pulse grants root without a prompt.** Its `su` is open, so the app's root path runs the moment it asks.
  Do not tell the user to "deny the root prompt": there is none. The consequence is that the app rewrites the
  shared CAN hardware filters (see below), which is why the deploy script saves them first.
- **The screen is 1080 x 1784 portrait.** Measured from `adb exec-out screencap -p`. Mockups and the browser
  harness use this size. Landscape (Hollywood mode) is 1784 x 1080 and only applies parked.
- **Three CAN-reading apps share two chips.** The mcp251x driver's receive filters are module parameters in
  `/sys/module/mcp251x/parameters`; any app with root can change them for all. The generator's
  `DRIVER_DEFAULTS` must keep every ID the stock filters pass. `tools/car_deploy.sh check` diffs the live
  filters against the saved stock ones.

## Checking the app on the car

`scripts/pulse_shot.sh <device> [name]` saves a screenshot to the scratchpad and prints its size; read the PNG
to see what the car shows. Look at it before reasoning about what the user describes: it settles layout,
theme and orientation questions in one step.

Log lines worth waiting for after a launch, in order: `CAN helper starting`, `CAN hardware filters`,
`CAN helper: ... ready`, `CAN frames flowing`. No `frames flowing` with the car awake means the helper lost the
sockets, not that the page is wrong. The page's own errors show in the Settings > About sheet and in
`chrome://inspect` from a Chrome on the Mac with the device connected.

To reach the app's own server from the Mac, forward its port: `adb forward tcp:28090 tcp:18090`, then
`curl http://127.0.0.1:28090/api/status` (the comma's status through the app).

## The comma

The comma (sunnypilot) is optional and talks to the app over the car's hotspot. `scripts/comma_health.sh`,
run on the comma over ssh (`ssh comma@sunnypilot.local 'bash -s' < scripts/comma_health.sh`), prints whether
its processes are alive, the gear and speed it sees, the current alert and which processes crashed. Use it when
the HUD's comma chip is missing or an alert mentions the comma, before touching anything on the comma itself.

The comma's `webhud` bridge lives in the sunnypilot checkout at `../openpilot`, as a local commit that is
never pushed. A change to the bridge is deployed by copying the files to the comma, not through git.

## When it fails

Each of these happened in a real session. Match the text, then do the one thing listed; none of them is fixed
by retrying the same command.

| What you see | What it means | Do |
|---|---|---|
| `SDK location not found` from gradle | No `ANDROID_HOME` in this shell | `export ANDROID_HOME=$HOME/Library/Android/sdk`, or `sdk.dir` in `android/local.properties` |
| `failed to connect to '<ip>:5555': Operation timed out`, ping lost | The Mac is not on Pulse's network, or the car (and Pulse with it) is asleep | Check the Mac's own address (`ipconfig getifaddr en0`); Pulse was seen at 192.168.0.178 on the home Wi-Fi, 192.168.92.181 on the car's "FiskerGreenPulse" hotspot and 192.168.33.5 on another hotspot. Wake the car. If no address answers, stop and tell the user; do not sweep the subnet repeatedly |
| `adb: device offline` or `error: closed` after a connect that worked | The TCP session died: Pulse slept, roamed or the car went off | `adb disconnect <ip>:5555; adb connect <ip>:5555`, then `adb -s <ip>:5555 get-state` must say `device` before anything else |
| `unauthorized` in `adb devices` | USB debugging prompt waiting on Pulse's screen | Accept it on the screen; nothing from the Mac can |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` / `signatures do not match` | The copy on the board was signed with another key (an older build, Ben's, or a debug key) | Sign with the key `SIGNER` in `tools/release.sh` names, or `adb uninstall $PKG` first (the app's settings on the board are lost) |
| `ls: /sys/class/net/can1: No such file` | This is not Pulse: the emulator or a phone | Use `--device` with Pulse's address; the emulator is for rehearsal only (`--emulator`) |
| `su: No such file or directory` at `/system/bin/su` | Pulse's su is `/system/xbin/su` | Call `su` by name, not by `/system/bin/su` |
| `CAN helper: socket: permission denied` then `CAN helper exited (code 1)` in a loop | The helper cannot open a raw CAN socket: on the emulator always, on Pulse when the sockets are gone | On the emulator, expected. On Pulse, reboot it with the car parked, then `tools/car_deploy.sh check` |
| `CAN helper missing or not executable at ...` | The `.so` did not land in `nativeLibraryDir` (packaging flags) | Check `extractNativeLibs`/`useLegacyPackaging` in `build.gradle.kts`; rebuild |
| `CAN hardware filters left as they are (...)` | No root, so steering, yaw, seat and mirror positions and charging stay empty | Expected without root; on Pulse root is open, so this line means the root shell failed: read the reason in the brackets |
| App launches but the page says offline, no `CAN frames flowing` | The helper has no frames: car asleep, or the filters exclude the IDs | `wait_for_bus` in the deploy script; then compare filters with `tools/car_deploy.sh check` |
| `monkey` prints nothing and nothing starts | monkey is a no-op on Pulse | `am start -n $PKG/ai.sunnypilot.webhud.MainActivity` |
| `adb shell ...` eats the next prompt's answer | adb shell reads stdin | Give every adb call `</dev/null`, as the deploy script does |
| `comma@<ip>: Permission denied (publickey)` | The Mac's default keys are not on the comma; the app holds the key it uses | Use the key registered on the comma with `-i`, or go through the app's comma sheet (`android/README.md`, SSH management) |
| Comma not found, port 8088 closed on every host | The comma's Web HUD is off or it is on another network | Settings > Developer > Web HUD on the comma, and put it on Pulse's hotspot |
| `timeout: command not found` on the Mac | No GNU timeout in zsh here | Background the command and kill it after a wait loop, as the scripts do |

## Things not to do from here

- Never send CAN frames to test something; the car controls sheet is the only sender and it refuses while
  the car moves. Watching `CAN send` lines in logcat while the user taps is the test.
- Never narrow the hardware filters or write them by hand; the deploy script's `undo` restores the saved ones.
- Never run the controls stage, replay or a comma job while the car is in gear.
- Do not reboot Pulse to "fix" something while someone is driving: the screen goes away for a minute.

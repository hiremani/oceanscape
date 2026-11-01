---
name: pulse-deploy
description: Put a build of this app on the car's Pulse board and check it there - adb over Wi-Fi, install, launch, logcat, screenshots, the CAN filter and bus checks, the comma's health. Use this whenever the user wants the APK on the car, says "deploy", "install on Pulse", "put it on the car", "try it in the car", "adb", "screenshot the car's screen", "is the comma alive", or asks why the app does not start, does not show CAN data, or cannot be reached. Also read it before writing anything that touches adb, Pulse's root shell or the CAN hardware filters, because several of the obvious commands silently do nothing on this board.
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

## Things not to do from here

- Never send CAN frames to test something; the car controls sheet is the only sender and it refuses while
  the car moves. Watching `CAN send` lines in logcat while the user taps is the test.
- Never narrow the hardware filters or write them by hand; the deploy script's `undo` restores the saved ones.
- Never run the controls stage, replay or a comma job while the car is in gear.
- Do not reboot Pulse to "fix" something while someone is driving: the screen goes away for a minute.

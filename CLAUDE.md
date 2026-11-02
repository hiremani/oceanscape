# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Mrichchhakatikam ("the little clay cart"): hiremani's fork of benkayuk's OceanScape, itself a fork of moistpope's Oceanfront View, a 3D HUD and car-controls page for the Fisker Ocean's center screen. It runs as an Android app on Pulse (the add-on board) and reads the car's IBUS1/IBUS2. A comma device running sunnypilot is optional.

The docs still say "Oceanfront View" and name the upstream repo and package. This fork's real values are the launcher name in `strings.xml`, `applicationId = ai.sunnypilot.oceanscape.hiremani` (`android/app/build.gradle.kts`), local port 18090 (`LocalServer`) and releases from `hiremani/oceanscape` (`AppUpdater.REPO`), all so it runs beside Pulse's app and the other two builds. The Kotlin namespace stays `ai.sunnypilot.webhud`. Remotes: `origin` is the fork, `upstream` is `benkayuk/oceanscape`.

## Commands

```bash
npm test                                          # all worker tests (node --test)
node --test static/js/world/tests/dbc.test.js     # one test file
node --test --test-name-pattern='Calibration' static/js/world/tests/*.test.js   # tests by name

python3 serve.py                                  # page at http://localhost:18088, no data ("offline")
python3 serve.py --bridge sunnypilot.local        # relay /api, /ws, /video and /map to a comma

cd android
./gradlew testDebugUnitTest                       # JVM tests
./gradlew testDebugUnitTest --tests 'ai.sunnypilot.webhud.NetTest'   # one test class
./gradlew assembleRelease                         # APK (JDK 17+, Android SDK)
```

Gradle needs `ANDROID_HOME` or `sdk.dir` in `android/local.properties`, or it fails with "SDK location not found". On this Mac the SDK is at `~/Library/Android/sdk`.

There is no linter and no JS build step. The page is plain ES modules, and third-party code is vendored in `third_party/`, so there is no `npm install`.

Work on decoding and fusion without a browser (`record_ticks.mjs` needs Node 22+ for its global WebSocket):

```bash
node tools/record_ticks.mjs http://sunnypilot.local:8088 ticks.jsonl --seconds 120
node tools/replay_ticks.mjs ticks.jsonl
node tools/pose_eval.mjs ticks.jsonl
node tools/map_eval.mjs --tiles ~/.comma/media/0/osm/offline ticks.jsonl
```

Debug on the car with `adb logcat -s WebHud`, and inspect the WebView from `chrome://inspect`.

## Architecture

**Three hosts serve the same page, with the same URL roots.** `/` is `static/`, `/vendor/` is `third_party/three`, `/models/` is `third_party/models`, `/dbc/` is `dbc/`.
- `android/.../LocalServer.kt` serves from the APK assets at `127.0.0.1:18090`. `syncWebAssets` in `build.gradle.kts` copies the files in at build time, so a page change reaches the car only through a rebuilt APK.
- `serve.py` is the dev server for a plain browser.
- The comma's `webhud` bridge lives in the sunnypilot repo, not here. It keeps its own copy of the ADAS DBC.

A change to a server endpoint can need matching changes in `serve.py`, `LocalServer.kt` and the sunnypilot bridge. `/map/*` has two implementations: `MapTiles.kt`, `MapFeatures.kt` and `MapPrefetch.kt` in the app, and `maptiles.py` on the comma.

**Data flow.**
1. On the car, the Go helper `android/canbridge/main.go` (shipped as `libcanbridge.so`) reads the CAN sockets. `CanBridge.kt` forwards the frames to the page as `webhud:can` events.
2. With a comma, the bridge streams raw ADAS and radar frames plus openpilot service extracts as 20 Hz ticks over `/ws`. The app relays them byte for byte.
3. The worker in `static/js/world/` decodes frames with the DBCs, then runs the fusion (`world_model.js`), pose (`pose.js`) and map matching (`mapdata.js`, `mapmatch.js`). `merge.js` merges comma ticks into the car's view. The worker posts state snapshots to the main thread.
4. The main thread (`main.js`, `hud.js`, `scene.js` and the modules they use) only draws snapshots. Decoding and fusion belong in the worker, so that the 3D view keeps its frame budget.

The car-state read-out and car controls are separate from the worker: `carstate.js` decodes body messages from the same frames, `carcatalog.js` and `carcontrols.js` define the UI, and `cancmd.js` sends through `window.WebHudApp.canSend`.

`window.WebHudApp` is the JS bridge to the Android app. It is absent in a plain browser, where the car controls are a mockup and the music and navigation cards do not show. The code must keep working without it, and without a comma.

**Two road sources are never blended.** The cameras' road model (`road.js`) draws when there is no map match. Otherwise the map road (`mapsurface.js`, `roadnet.js`) is the only geometry, and the cameras only choose which lane the car is in. See INTERNALS.md before changing either.

## Generated files

Do not edit these by hand. Change the generator and re-run it:

| Output | Generator | Input (not in the repo) |
|---|---|---|
| `dbc/fisker_ocean_ibus.dbc`, `static/js/ibus_tables.js`, `android/.../CanIds.kt` | `tools/gen_ibus.py` | FM29 IBUS1 and IBUS2 matrix `.xlsx` |
| `dbc/fisker_ocean_adas_world.dbc` | `tools/gen_world_dbc.py` (also copy the result to sunnypilot) | FM29 ADASBUS matrix `.dbc` |
| `android/app/src/main/jniLibs/arm64-v8a/libcanbridge.so` | `android/canbridge/build.sh` (needs Go) | `canbridge/main.go` |
| `third_party/models/pulse_ocean_v0.10_parts.glb` | `tools/export_ocean_glb.py` in Blender, then `tools/compress_model.sh` | Pulse Ocean `.blend` and `.glb` |

`dbc/fisker_ocean_mrr.dbc` is reverse-engineered, and the matrices have known errors. Signal corrections live in the generators (`CORRECTIONS` in `gen_world_dbc.py`).

## Constraints on sending CAN

This code sends frames to a real car.
- Only IDs in `CanIds.TX` go out. The allowlist comes from `TX` in `gen_ibus.py` and is enforced in both `CanBridge.send` and the Go helper.
- The head unit's cyclic state messages (drive mode, charging, units, brightness, ambient light, California Mode: `ICC_0x610`, `0x529`, `0x336`, `0x563`) and the driver-assistance messages (`ICC_0x52A`, `0x35B`) are sent only by the **control trial** (Settings → Debug → Unlock controls), by the owner's choice, parked only and off by default. It copies the head unit's current frame, changes one field, continues the alive counter and fixes the checksum (`static/js/e2e.js`), so the rest of the frame is the head unit's own. The head unit overwrites these every cycle, so a change may not stick. Do not send any of them outside that trial path.
- Never send the audio messages (`ICC_0x44`, `ICC_0x46`). One frame carries every volume, the mute and the equalizer at once, with nothing to copy the current values from, so a send resets the audio. These stay off the send allowlist.
- The CAN chips' hardware filters are shared with Pulse's own app. `DRIVER_DEFAULTS` in `gen_ibus.py` keeps every ID the driver's defaults pass; do not narrow it.
- A control that cannot send stays greyed with a reason (`off` in `carcatalog.js`), not hidden.
- CAN overrides, SSH keys, replay and comma management jobs are refused while the car moves. Keep these guards.

## Releases

Use `tools/release.sh` (`patch`, `major`, a version, `--publish`). It bumps `versionName` and `versionCode`, which cars need to see an update, runs both test suites, builds, and checks the APK's signer against `SIGNER` in the script. Cars cannot install an APK signed with a different key over the app.

## Docs to read first

- `INTERNALS.md`: how each feature is decoded, fused and drawn, with the measured calibrations and the ADAS signal list.
- `android/README.md`: comma discovery, the relay, CAN hardware filters, SSH management and self-update.
- `DESIGN.md`: the car-controls design language. `static/design.html` is its live version.
- `CAR_CONTROLS_PLAN.md`: plan and status of the car-controls mockup.

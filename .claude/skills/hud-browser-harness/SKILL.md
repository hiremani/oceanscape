---
name: hud-browser-harness
description: Run the real HUD page on this Mac without the car, feed it synthetic CAN frames, and screenshot it with headless Chrome at Pulse's size, so a layout, theme, card or driving/parked change can be seen and checked before building an APK. Use this whenever a change touches what the page shows (CSS, layouts, cards, the status strip, settings that change the look, dark mode, landscape), whenever the user asks to "see", "screenshot", "verify in a browser" or "check it renders", and when a unit test cannot tell whether the DOM did the right thing. Read it before writing any headless-Chrome command for this repo: the obvious flags produce blank or stale pages here.
---

# The browser harness

The page (`static/`) draws state snapshots the worker posts; the worker decodes frames the Android app delivers as
`webhud:can` events. In a plain browser there is no app, so nothing arrives and the page sits "offline". The
harness gives it a server root that looks like the app's, a driver page that writes the settings under test and
dispatches synthetic frames, and a Chrome that can render WebGL without a GPU.

## Steps

```bash
S=<scratchpad>/www                                  # keep it in the session scratchpad
.claude/skills/hud-browser-harness/scripts/make_www.sh "$S"
python3 .claude/skills/hud-browser-harness/scripts/serve_www.py "$S" 18093 &    # remember the pid
cd <scratchpad> && .claude/skills/hud-browser-harness/scripts/shoot_page.sh glance_drive.png 'layout=glance&drive=1'
```

Then read the PNG. The yellow debug line at the top says what the page really had: `src=local` and a `gear`/`kph`
mean the synthetic frames decoded; `driving=true/false` and `layout=` are the page's own flags; `errs=` lists the
page's reported errors. Add `dbg=0` for a clean image once the line reads right. Kill the server when done
(`pkill -f serve_www.py`); a Chrome that was not killed keeps the profile locked for the next shot.

`set.html` parameters: `layout`, `theme`, `drive=1`, `kph`, `data=0` (offline look), `wait` (ms the load event
waits; 14000 is enough for the worker and the car model), `set=<json>` for any other settings keys, `dbg=0`.
Sizes: `1080x1784` is Pulse portrait, `1784x1080` landscape. Dark theme: `theme=dark`.

## Why it is built this way

- **The frames are objects, not hex.** `packFrame(bus, addr, signals)` from `carstate.js` returns
  `{bus, addr, data}`, exactly what `CanBridge.kt` puts in a `webhud:can` event's `detail` array. Wrapping it
  again (`{data: packFrame(...)}`) decodes nothing, and the page shows "offline" with no error. The same holds
  in a Node check: feed `h.data` to the decoder, not `h`.
- **Real time, not virtual time.** Chrome's `--virtual-time-budget` fast-forwards timers but the worker's
  messages and the model load do not keep up, so the shot shows stale or empty data. The `/slow?ms=` image in
  `serve_www.py` delays the load event instead, and Chrome screenshots after load.
- **WebGL needs `--use-angle=swiftshader --enable-unsafe-swiftshader`.** Without them the 3D canvas is blank
  and three.js logs a context error, which the page reports as an error chip.
- **Headless Chrome does not exit.** `shoot_page.sh` waits for the file and kills it. A `--dump-dom` run once
  hung for eight minutes. Never run Chrome in the foreground without that loop.
- **Settings are read from `localStorage` at load.** `set.html` writes `webhud.settings` before the iframe
  loads, including `demoCarState` and `demoInfotainment` so the car-controls and music cards have content, and
  `version: 3` so the migration does not reset them.
- **No comma, no map.** `/api/*` and `/map/*` answer 404 on purpose. The road comes from the cameras' model, so
  the scene is a plain road; this is right for layout and card checks and useless for map-matching ones, which
  belong in `tools/replay_ticks.mjs` and the worker tests.

## What to check from a screenshot

Compare the layout against `INTERNALS.md` "Layouts" and `DESIGN.md`: nothing hidden that should be greyed,
touch targets no smaller than the dock's, the strip and bar not overflowing at 1080 wide, dark theme contrast,
the `html[data-driving]` state matching `drive=` (parked-only buttons grey while driving). If the DOM matters
more than the pixels, run the page's pure logic in Node instead (`static/js/hudlayout_logic.js` and its test are
the pattern: keep arithmetic out of the DOM class so `node --test` can reach it).

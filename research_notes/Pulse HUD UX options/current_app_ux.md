# Current UX of the Fisker Ocean HUD app (Mrichchhakatikam fork, working tree as of 2026-10-31)

All paths below are relative to `/Users/hiremanirmss/code/projects/fisker/oceanscape`. Line numbers refer to the working tree (uncommitted changes included). "Landscape" vs "portrait": the task brief says the Pulse screen is landscape; the repo's own design document specifies the car-controls language for a *portrait* 1080 × 1920 frame and the CSS carries both orientations (see Gaps in question 5).

## Q1. What are all the HUD elements, where does each sit, and which depend on the comma or the Android bridge?

### Takeaway
The default screen is a full-screen three.js scene with roughly fifteen DOM overlays pinned to the edges: a status card top-left (speed, gear, ACC, telltales, power bar), alerts and a next-turn card top-centre, chips + road-info rows + a 2D mini-map top-right, a music card bottom-left, road name bottom-centre, a three-button "view dock" bottom-right, plus an optional draggable comma-camera window and a frame-rate counter. Everything driven by the ADAS bus works from the car alone; replay, radar, openpilot alerts, the camera window and ACC settings need the comma; music, navigation, car-control sends, comma management, self-update and device location need the Android bridge (`window.WebHudApp`).

### Cited Findings

**Page skeleton and z-order**
- The DOM is one `#app` holding `#scene` (canvas), `#olabels`, `#roadcam`, `#drive`, `#alerts`, `#chips`, `#roadinfo`, `#viewdock`, `#caranchors`/`#carribbon`/`#carpanel`, `#replaybar`, `#roadname`, `#toast`, `#settings` — [static/index.html:30-137](static/index.html#L30-L137). The music, nav, map cards, fps counter and energy dialog are appended at runtime ([infotainment.js:140-146, 202-205](static/js/infotainment.js#L140-L146), [minimap.js:17-18](static/js/minimap.js#L17-L18), [perf.js:22-23](static/js/perf.js#L22-L23), [energy.js:175-177](static/js/energy.js#L175-L177)).
- The page never scrolls; it is pinned to the visible viewport, because 100vh on mobile stole touches from the 3D view — [static/app.css:42-49](static/app.css#L42-L49).
- z-index ladder: object labels 1, roadcam 3, caranchors/mapcard 4, drive card/chips/roadinfo/roadname 5, alerts/replaybar/music/nav 6, viewdock 7, carpanel 9, carribbon 10, fps 11, toast 20, settings sheet 30, energy dialog 40 — [app.css:53, 67, 84, 103-105, 164, 174, 180, 190, 203-204, 223, 227, 317, 335, 409, 416, 438, 512, 564](static/app.css).

**3D scene (`#scene`)**
- Full-screen canvas with `touch-action: none` — [app.css:61](static/app.css#L61). Camera views: `chase` (r 17), `top` (r 26, nearly overhead), `close` (r 8.5, off-axis), `far` (r 36, labelled "Wide" in the menu) — [scene.js:132-137](static/js/scene.js#L132-L137), [index.html:84-87](static/index.html#L84-L87).
- Touch model: OrbitControls, min distance 4 m, max 90 m; `interacting` flag set on gesture start/end; pan springs back to the car after `RECENTER_S = 5` s untouched — [scene.js:26, 423-436, 1368](static/js/scene.js#L26). The About tab tells the user "one finger rotates around the car, two fingers zoom and pan. The view recenters on the car a few seconds after you let go" — [settings.js:671](static/js/settings.js#L671).
- Tap vs drag: a tap is < 8 px and < 300 ms; a double tap recenters (`setView` to the current view); a single tap that hits the ego car waits out the double-tap window and then opens car controls; with car controls open every tap goes to them — [main.js:20, 488-515](static/js/main.js#L488-L515).
- The chase camera backs off with speed (up to 1.5× at 70 mph) and the camera heading trails the car's on a critically damped spring (max 0.6 rad) — [scene.js:27-30](static/js/scene.js#L27-L30), [INTERNALS.md:84-88](INTERNALS.md#L84-L88).
- In landscape the car is centred in the area right of the status card (`setLayoutOffset`); in portrait overlays stack under the status header via `--drive-h` — [main.js:191-202](static/js/main.js#L191-L202).
- Scene contents: the rigged Ocean model in factory paints and five wheel options with lamps following the BCM, textured ground that moves with speed/steering, filtered lane lines, inferred road, map road + junctions + street furniture, fused objects, power trails, headlight throw, parking-sensor arcs, planned path, a nav arrow on the ego lane within 160 m of a turn — [INTERNALS.md:5-57, 59-72, 74-88, 101-113, 236-300](INTERNALS.md), [navarrow.js:8-9](static/js/navarrow.js#L8-L9).
- Two road sources are never blended: the cameras' road draws when there is no map match; otherwise the map road is the only geometry and the cameras only choose the lane — [INTERNALS.md:249-273](INTERNALS.md#L249-L273), [CLAUDE.md "Two road sources"](CLAUDE.md).
- Auto view: when speed < 2.5 m/s and (reverse or an ultrasonic zone ≤ 2) the view switches to `top` once per stop and returns to the user's view above 4 m/s; suppressed while car controls are open, while the user is dragging the camera, and for 10 s after a manual view pick — [main.js:19, 435-459](static/js/main.js#L435-L459).
- Theme is applied before first paint from `localStorage` and the `<meta theme-color>` is set to `#101216` (dark) / `#eceef1` (light) — [index.html:10-19](static/index.html#L10-L19), [main.js:162-170](static/js/main.js#L162-L170).

**Status card `#drive` (top-left)**
- Landscape: absolute top 16 / left 16, 300 px wide, glass card (blur 16 px, radius 18) — [app.css:94-106](static/app.css#L94-L106). Portrait: a 172 px floating square top-left, everything shrunk — [app.css:355-379](static/app.css#L355-L379). Narrow landscape (≤ 760 px) 250 px; short (≤ 520 px high) smaller speed — [app.css:392-400](static/app.css#L392-L400).
- Row 1: gear letters P R N D (the active one in text colour), left/right blinker glyphs, telltales (beam, belt, door, hands, eye, bsd, aeb, warn) coloured blue/green/amber/red — [index.html:49-53](static/index.html#L49-L53), [hud.js:96-100, 257-278](static/js/hud.js#L257-L278), [app.css:107-119](static/app.css#L107-L119).
- Speed: `clamp(64px, 11vh, 118px)`, weight 300, tabular; unit label below in small caps — [app.css:121-123](static/app.css#L121-L123). Source order: cluster speed via carState, else Fisker display speed, else wheel speed — [hud.js:124-130](static/js/hud.js#L124-L130). Unit: setting, else ICC display unit, else comma `IsMetric` — [hud.js:106-111](static/js/hud.js#L106-L111).
- Assist row: steering-assist (MADS) wheel icon with classes available/active/override/warn; ACC set-speed ring labelled "MAX" (engaged/available/off); 3- or 4-bar following-distance gap; a speed-limit sign in US ("SPEED LIMIT") or round EU style that turns red when > limit + 2 — [index.html:58-63](static/index.html#L58-L63), [hud.js:173-255](static/js/hud.js#L173-L255), [app.css:125-161](static/app.css#L125-L161). Assist text line: "Changing lanes ←/→", "MADS steering · ACC 65", "Experimental mode", "Fisker autosteer", "Take over" — [hud.js:180-184, 221-232](static/js/hud.js#L180-L232).
- Power bar (`#econ`) at the bottom of the card: Tesla-style bar without graduations, origin in the middle, regen left in green (full scale 60 kW), consumption right in text colour (180 kW); hidden until power data arrives; a tap opens the last 60 s as a trace with a "Details" button that opens the Energy dialog — [hud.js:13-33, 34-47](static/js/hud.js#L13-L47), [index.html:65](static/index.html#L65), [app.css:494-509](static/app.css#L494-L509).
- Energy dialog: modal over the view (z 40), two sections Driving / Charging, each with total kWh, stacked share bar, legend with kWh/%/kW, a 10-minute staircase graph with hover readout, Escape or backdrop tap closes — [energy.js:14, 143-178, 213-217](static/js/energy.js#L143-L178), [app.css:511-542](static/app.css#L511-L542).

**Alerts `#alerts` (top-centre, under the nav card)**
- Positioned at `top: 16px + --navcard-h`, width `min(560px, 46vw)`, non-interactive, at most 3 items; classes normal / userPrompt (amber) / critical (red, pulsing) / info (blue) — [app.css:164-172](static/app.css#L164-L172), [hud.js:280-300](static/js/hud.js#L280-L300). Sources: openpilot `selfdriveState` alerts, Fisker takeover request, AEB collision warning, ADAS warning text and high-priority warnings, and a bridge notice — [hud.js:282-294](static/js/hud.js#L282-L294). Portrait: full width under the status card — [app.css:383](static/app.css#L383).

**Chips `#chips` (top-right)**
- `LIVE` / `REPLAY` mode chip (replay = accent fill), a `comma` chip button that is only present while the comma streams (tap → Comma tab; turns amber "comma: no live data" if the bridge can't read the car), and a radar chip `radar N` / `no radar` — [index.html:72-76](static/index.html#L72-L76), [main.js:337-359, 408-418](static/js/main.js#L337-L418), [app.css:174-178](static/app.css#L174-L178). The Android README states the design intent: "Nothing on screen waits for it or says it's missing: no connecting card, no reconnecting pill, just a comma chip while it's there" — [android/README.md:10-12](android/README.md#L10-L12).
- Working-tree change: `showRadar` default flipped from `false` to `true`, so the radar chip is visible by default in this fork — [main.js:27](static/js/main.js#L27) (diff vs HEAD).

**Road info `#roadinfo` (top-right, under the chips, right-aligned stack)**
- Rows for: the ego-lane traffic light (lamp colour + distance), a prohibition sign ("⛔"), closest park-distance reading front/rear in cm or in (red < 40, amber < 80), construction/landmark/lane-marking/hazard with distance, and the outside temperature — [hud.js:302-340](static/js/hud.js#L302-L340), [app.css:180-184](static/app.css#L180-L184).

**2D mini-map `#mapcard` (top-right, below chips/limit and the nav card)**
- A square card `clamp(180px, 30vw, 320px)` at `right: 16px; top: max(130px, --drive-h) + 12px + --navcard-h`, `pointer-events: none` so touches reach the 3D view; hidden in car-controls mode — [app.css:562-572](static/app.css#L562-L572). Heading-up, draws the worker's roads layer (no download of its own), the matched road ahead in accent, traffic signals as red dots, street names, a north needle, the car as an accent arrow; status "Loading map…" / "GPS lost" (amber when stale); road name at its foot; redrawn at most every 100 ms to protect the frame budget — [minimap.js:1-9, 25-37, 66-138](static/js/minimap.js). Added in the last commit "HUD: a 2D street map that moves with the car" — [git log 15c19be](#).
- Toggle: Display → Road → "2D map", on by default (`miniMap: true`) — [settings.js:365-366](static/js/settings.js#L365-L366), [main.js:29](static/js/main.js#L29).

**Next-turn card `#navcard` (top-centre)**
- `width: min(540px, calc(100vw - 700px))`, min 280 px, non-interactive; maneuver icon in an accent square, distance in 30 px bold, street, trip line (time · distance · ETA) — [app.css:335-346](static/app.css#L335-L346), [infotainment.js:196-233](static/js/infotainment.js#L196-L233). On landscape ≤ 1020 px it is anchored `left: 332px` beside the status card; on phones it drops under the status card and pushes alerts and fps down — [app.css:348-350, 471-476](static/app.css#L348-L350). Hidden in car-controls mode — [app.css:347, 412](static/app.css#L347).
- Needs the Android app's notification listener; in a plain browser both cards stay hidden — [infotainment.js:1-6](static/js/infotainment.js#L1-L6), [android/README.md:75-100](android/README.md#L75-L100).

**Music card `#musiccard` (bottom-left)**
- `left: 16px; bottom: --music-bottom (16px, lifted over the replay bar)`, width `min(460px, 100vw - viewdock - 60px)`, grid: 64 px art, title/artist·album/source, prev / play-pause / next 44 px round buttons, a progress bar with elapsed/total when the session has a duration — [app.css:315-333](static/app.css#L315-L333), [infotainment.js:124-192](static/js/infotainment.js#L124-L192). Buttons are disabled without the app or when the session forbids the action — [infotainment.js:172-176](static/js/infotainment.js#L172-L176). Hidden in car-controls mode — [app.css:347](static/app.css#L347).

**Road name `#roadname` (bottom-centre)**
- Name + ref from the map match, else sunnypilot mapd's name; the last one lingers dimmed for 8 s; lifted 84 px during replay — [hud.js:149-171](static/js/hud.js#L149-L171), [app.css:204-208](static/app.css#L204-L208).

**View dock `#viewdock` (bottom-right)**
- Three 54 px round glass buttons: Settings (gear), Comma camera (video, on/off), Camera view (opens a popover `#viewmenu` with Chase / Top / Close / Wide) — [index.html:81-92](static/index.html#L81-L92), [main.js:462-487](static/js/main.js#L462-L487), [app.css:189-199](static/app.css#L189-L199). The dock fades out in car-controls mode — [app.css:199, 412](static/app.css#L199).

**Replay bar `#replaybar`**
- Play/pause, −10 s, seek slider with time and route label, +10 s, speed ¼×–8×, "Live"; sits left of the view dock (`--viewbar-w` measured) and only shows in replay; keyboard Space/←/→ when replaying — [index.html:100-114](static/index.html#L100-L114), [main.js:530-569](static/js/main.js#L530-L569), [app.css:201-215, 387-388, 395](static/app.css#L201-L215).

**Comma camera window `#roadcam`**
- A black 16:9 (Road/Wide) or 536 × 240 (Mirror, the comma 4's own onroad screen) window, default top-left, draggable anywhere between the status card and the dock, resized from the bottom-right handle, width 280 px up to 1600 px, geometry saved as fractions in settings; a tap shows the close button and the Road / Wide / Mirror radio group for 4 s — [index.html:33-45](static/index.html#L33-L45), [roadcam.js:1-7, 22-31, 70-90, 109-147, 207](static/js/roadcam.js), [app.css:63-83](static/app.css#L63-L83). Its frame rate is appended to the fps chip ("cam N fps") — [perf.js:103-105](static/js/perf.js#L103-L105). Needs the bridge's `/video` socket (comma) — [README.md:34-43](README.md#L34-L43).

**Frame-rate counter `.fps`**
- Under the status card at `top: --drive-h + 10px`, monospace, amber when slow, on by default (`showFps: true`); tap toggles details (median/worst/JS ms, draws, tris, resolution, "no blur") — [app.css:52-56](static/app.css#L52-L56), [perf.js:1-6, 22, 96-114](static/js/perf.js), [main.js:29](static/js/main.js#L29). Auto resolution drops the card blur first (`html.lowfx`) then steps resolution to 60 % — [perf.js:9-17](static/js/perf.js#L9-L17), [app.css:57-59](static/app.css#L57-L59).

**Toast**: bottom-centre at 84 px (150 px in portrait), 2.6 s default — [app.css:223, 389](static/app.css#L223), [main.js:572-578](static/js/main.js#L572-L578).

**Object stats labels `#olabels`**: debug HTML tags projected over objects, colour-coded by source (radar teal, openpilot accent, world green), stacked so two sources show both — [labels.js:1-5, 118-157](static/js/labels.js), [app.css:84-92](static/app.css#L84-L92).

**Offline state**: with no driving data (`source === 'none'`) the root gets `.offline`, which hides the status card, alerts, road info, replay bar and the mode/radar chips; car controls, music and navigation carry on — [main.js:317-335](static/js/main.js#L317-L335), [app.css:483-492](static/app.css#L483-L492) (the block is duplicated verbatim twice).

**Dependency matrix (what needs what)**
- From the car alone (Android app on Pulse, IBUS1/IBUS2 mirror): status card, lanes, objects, signs, lights, parking sensors, map road, mini-map (needs TBOX GPS), car-state read-outs — [INTERNALS.md:171-183](INTERNALS.md#L171-L183), [android/README.md:4-7](android/README.md#L4-L7).
- Comma-only: replay/Playback tab, CAN settings tab, Driving tab (banner text per tab) — [settings.js:10-14, 55-60](static/js/settings.js#L10-L14); radar tracks (chip tooltip "the radar's private bus comes through the comma") — [main.js:417](static/js/main.js#L417); openpilot alerts/MADS/experimental mode text — [hud.js:174-184, 230, 282-284](static/js/hud.js); comma camera window; ACC settings in Car → Assist ("Needs the comma: these settings are applied by it") — [accsettings.js:28-33](static/js/accsettings.js#L28-L33); Signals → ADAS bus option — [settings.js:555-558](static/js/settings.js#L555-L558).
- Android-bridge-only (`window.WebHudApp`): music and nav cards — [infotainment.js:5-6](static/js/infotainment.js#L5-L6); sending car controls ("Not in the car (the Android app sends to the car)") — [cancmd.js:73-77](static/js/cancmd.js#L73-L77); Comma tab ("Managing the comma needs the Mrichchhakatikam app") — [comma.js:93-95](static/js/comma.js#L93-L95); app updates ("Version: Web page") — [appupdate.js:42-47](static/js/appupdate.js#L42-L47); Position → "This screen" — [settings.js:396](static/js/settings.js#L396); Signals → "Check the link" — [settings.js:546-547](static/js/settings.js#L546-L547); theme hand-off to the app's loading screen — [main.js:168-169](static/js/main.js#L168-L169).
- Stated constraint: "The code must keep working without [WebHudApp], and without a comma" — [CLAUDE.md "Architecture"](CLAUDE.md).

### Inferences
- The top-right corner is the most crowded zone: chips at 16 px, road-info rows from 52 px growing downward, the mini-map at `max(130px, --drive-h) + 12px`, and in landscape `--drive-h` is the status card's bottom (~200+ px), so the map card starts below the road-info stack only if that stack is short; with a traffic light, two PDC rows, a hazard row and temperature (5 rows × ~40 px) the road-info stack can reach past the map card's top (overlap risk, not documented).
- The nav card's `calc(100vw - 700px)` width leaves 350 px either side for the status card and chips; on the 1080-wide portrait frame it is instead `min(560px, 100vw - 392px)` — the layout is tuned for a wide landscape screen plus a portrait fallback, not for a narrow landscape.
- The mini-map and nav card are deliberately non-interactive (`pointer-events: none`) so the 3D view keeps the gesture surface; only the status card, chips, dock, music card and roadcam window take touches.

### Gaps
- No screenshot or measured layout of the real Pulse screen is in the repo; the actual rendered pixel positions on the car are not recorded.
- The repo does not state the Pulse screen's resolution or orientation outright; DESIGN.md specifies portrait 1080 × 1920 while the brief says landscape (see Q5).

## Q2. What do the car controls let the user do, how are they organised, and which are off with what reason?

### Takeaway
Tapping the 3D car opens a Tesla-like "car mode": a bottom dock of ten car-part categories plus five system ones, a sheet (right side in landscape, bottom sheet with three detents in portrait), and controls pinned onto the car (window/sunroof/liftgate drag controls, rear-seat heat chips, tire chips, on-car cards for Lighting and Seats). Each control is tagged Sends / Reads only / Via comma / Not available / Demo; anything that cannot be sent stays visible but greyed with a reason on tap, and demo-only controls are hidden unless Settings → Debug → "Demo car controls" is on.

### Cited Findings

**Entering, leaving, the dock**
- A tap on the car enters; the dock (`#carribbon`, `.fo-dock`) slides up from the bottom, the view dock, music, nav, replay bar and map card hide, the camera goes top-down with the roof faded and a badge on each category's part — [carcontrols.js:1-6, 108-116, 367-372](static/js/carcontrols.js), [app.css:408-412, 572](static/app.css#L408-L412). Overview camera is top-down nose-up, or nose-right when free height < 420 px — [carcontrols.js:22-24, 220](static/js/carcontrols.js#L22-L24).
- Dock contents: a state tag at the left ("Mockup" / "On the car" (green) / "Car link down" (amber)), the category items (icon over short label), a divider before the system categories, a ✕ at the right — [carcontrols.js:235-250, 617-620](static/js/carcontrols.js#L235-L250). Categories with only demo controls are left out of the dock unless demos are shown — [carcontrols.js:302-311](static/js/carcontrols.js#L302-L311).
- A tap on the 3D view while open: a zone opens its category; elsewhere goes back to the overview, or from the overview closes — [carcontrols.js:172-181](static/js/carcontrols.js#L172-L181). Exit restores the roof, shuts the mockup's doors/windows/sunroof, resets Hollywood Mode and returns to the user's view — [carcontrols.js:118-140](static/js/carcontrols.js#L118-L140).
- Zones (tap targets + badge spots) in the car frame: lamps, vents, seats, drive (rear seats + motors), sensors, port, amp, doors (sides, quarter windows, liftgate, rear window while solid; not the sunroof), wheels, screen — [cutaway.js:41-61](static/js/cutaway.js#L41-L61). Pin anchors for cards/chips — [cutaway.js:63-72](static/js/cutaway.js#L63-L72).

**The sheet**
- Landscape: `aside.carpanel` at `top: 16px; right: 16px; bottom: ribbon-h + 16px; width: min(44vw, 700px)` with a hairline border, sliding in from the right — [app.css:416-419](static/app.css#L416-L419). Narrow landscape ≤ 760 px: 50vw — [app.css:430-433](static/app.css#L430-L433).
- Portrait: a bottom sheet over the dock with heights peek 28 rem (448 px), half 53 rem (848), full 85 rem (1360), hvac 22 rem (Climate only, no head) — [app.css:420-427, 455-457](static/app.css#L420-L427), [carcontrols.js:52-53](static/js/carcontrols.js#L52-L53), [DESIGN.md:53-64](DESIGN.md#L53-L64). Drag the handle ±40 px to step a detent, tap it to cycle — [carcontrols.js:281-296](static/js/carcontrols.js#L281-L296).
- Sheet head: back (to overview), icon + title, close — [carcontrols.js:259-272](static/js/carcontrols.js#L259-L272). Body groups: `rows` (hairline list), `tiles` (cells), `climate` (Tesla grid), `status` (Energy line), `app` (update section), `hidden` — [carcatalog.js:19-22](static/js/carcatalog.js#L19-L22), [carcontrols.js:313-341](static/js/carcontrols.js#L313-L341).
- Landscape on-car cards (Lighting, Seats) show beside the car only when ≥ 840 px of free width remains right of the status card; otherwise their groups go into the sheet; a floating "All settings" back chip appears at the top when cards are shown — [carcontrols.js:45, 205-209, 374-386](static/js/carcontrols.js#L205-L209).
- Camera per category: `focus` {at, az, el, fit/fitP/r}; roof fade; ghosting of all but named parts — [carcatalog.js:13-17](static/js/carcatalog.js#L13-L17); e.g. Climate sits between the front seats looking at the dash with airflow particles, Driving is a side x-ray with the seats ghosted, Service is a top-down with tire chips — [carcatalog.js:137-139, 185-187, 411-416](static/js/carcatalog.js).

**Control kinds, tags and off behaviour**
- `kindOf`: `acc` → "Via comma"; `moveOff` → "Reads only"/"Not available"; `tx`/`moves`/`winSig`/liftctl/sunroof/`sends` → "Sends"; `live` → "Reads only"; `off` (non-mock) → "Not available"; else "Demo" — [carcontrols.js:27-40](static/js/carcontrols.js#L27-L40). The tag is appended after the label — [carcontrols.js:824-830](static/js/carcontrols.js#L824-L830).
- An off control is greyed (`.off`), gets a lock icon before its control, its inputs disabled, its `title` set to the reason; a tap on it (via `set`) toasts the reason — [carcontrols.js:805-822, 680-682](static/js/carcontrols.js#L805-L822), [design.css:86-87](static/design.css#L86-L87). DESIGN.md principle 6: "An unavailable control is greyed, not hidden, and says why on tap" — [DESIGN.md:42-43](DESIGN.md#L42-L43). CLAUDE.md: "A control that cannot send stays greyed with a reason (`off` in `carcatalog.js`), not hidden" — [CLAUDE.md "Constraints on sending CAN"](CLAUDE.md).
- Reason strings: `OWNED` = "The head unit sends this setting itself every second; a request of ours would be undone at once"; `NO_MSG` = "The car has no message for this"; `MOCK` = "Mockup: nothing on the car for this"; `ADAS` = "Set under the gear menu → CAN settings (the comma sends the driver-assistance settings)"; `AUDIO_FRAME` = "Its message (ICC_0x46) also carries every audio volume and the mute… sending it would reset the audio"; "The telematics unit keeps the schedules" — [carcatalog.js:34, 49-52, 160, 315-316](static/js/carcatalog.js).
- In-app sends require the bus to be awake: `CarCommands.available` needs `WebHudApp.canSend` and a live `0x343` on IBUS1 within 3 s; otherwise toast "The car is asleep, or its CAN link is down" — [cancmd.js:67-77](static/js/cancmd.js#L67-L77). A control the car reports is the car's: a change sends and waits for the answer rather than pretending — [carcontrols.js:587-588, 684-687](static/js/carcontrols.js#L587-L588).
- Message kinds sent: event (3× 20 ms apart, then a release frame 200 ms later "as Pulse's own app does") and cyclic (held 3 cycles of 100 ms then idle; hold buttons repeat until release, 15 s stuck-pointer cap) — [cancmd.js:4-18, 95-131](static/js/cancmd.js).

**Category inventory (dock order; `short` label in parentheses)**

1. *Lighting* (cards; zone lamps; lamp preview on the car) — [carcatalog.js:99-134](static/js/carcatalog.js#L99-L134)
   - Headlights seg Off/Auto/Parking/Low — Sends (reads `BCM_ExtLampSwtSts`); Auto cannot be sent, toast "Auto: turn the stalk to Auto; the head unit has no message for it".
   - Auto high beam — off ADAS. Adaptive driving beam — Sends/reads.
   - Follow me home seg — off AUDIO_FRAME (reads). Welcome lights — off NO_MSG. Interior lights off after — off AUDIO_FRAME (reads). Ambient lighting toggle and brightness slider — off OWNED.
2. *Climate* (sheet, `hvac` detent, Tesla three-row grid) — [carcatalog.js:135-170](static/js/carcatalog.js#L135-L170), [carcontrols.js:1018-1039](static/js/carcontrols.js#L1018-L1039)
   - Row 1: power, Auto, A/C; the three vent toggles (windshield/face/feet) with Front/Rear tabs; Schedule (off "The telematics unit keeps the schedules"). Row 2: heated wheel (sends, car doesn't report), front defrost, rear defrost, fan LO·2–6·HI between arrows, recirculate, purifier. Row 3 (driver/passenger temperatures with Sync) only with Demo car controls: "The temperatures are a demo (no message for them)" — [carcatalog.js:148](static/js/carcatalog.js#L148), [carcontrols.js:1038](static/js/carcontrols.js#L1038).
3. *Seats* (cards Driver/Passenger; rear heat chips) — [carcatalog.js:171-183, 584-598](static/js/carcatalog.js)
   - Heat 0–3 glyph — Sends/reads. Position jog pad (slide/back/tilt/height) — **Reads only** in the working tree: `moveOff: "The seat doesn't answer this yet: use the seat's own switches"` replaced the previous `moves` signals because "ICC_0x533 went out clean on the car and the seat didn't move" — [carcatalog.js:588-592](static/js/carcatalog.js#L588-L592) (uncommitted). Memory 1/2/3 — Sends; Save disabled in-app ("Saving a position is a head unit key: hold its memory button"). Easy entry — Sends, no readback.
4. *Driving* (sheet; side x-ray; mode pulse ring) — [carcatalog.js:184-211](static/js/carcatalog.js#L184-L211)
   - Drive mode Earth/Fun/Hyper (reads, off OWNED); Regen, Creep, Accelerator response (reads, OWNED); Steering feel (OWNED). Tiles: Auto hold NO_MSG, Traction OWNED, Hill descent OWNED, Special terrain (reads, OWNED). A mode change (here or by the car's own button) sends a particle ring in the mode's colour — [carcontrols.js:609-611, 707-711](static/js/carcontrols.js#L707-L711).
5. *Assist* (sheet; sensor coverage fans) — [carcatalog.js:212-295](static/js/carcatalog.js#L212-L295)
   - Note: "The driver-assistance settings go to the car through the comma: gear → CAN settings. Adaptive cruise, auto speed, terrain and the speed-limit offset are set here, on the comma, and apply at once; the rest show the head unit's own values."
   - Via comma (ICC_0x52A override): Adaptive cruise, Set speed follows the limit, Over the limit (Never/Percent/Fixed), Speed-limit offset slider 0–31.5, ACC Terrain Mode. Greyed with reason when the comma is absent / loading / too old / car moving — [accsettings.js:28-34](static/js/accsettings.js#L28-L34); re-read every 3 s while open — [carcontrols.js:42, 639-644](static/js/carcontrols.js#L639-L644).
   - Off ADAS (33 controls): Active safety; Cruise type, Following distance, Set-speed step, Lane change assist, Show planned path; Lane keeping (LKA, warning type, ELKA, ESA, vibration); Collisions (FACM, timing, dynamic timing, brake pulse, BACM, timing, FCTA, timing, DCAA); Blind spot (BSD, timing, DOW); Speed and signs (ISA, TSR, TLR, warnings); Parking (APA, park in, pull out, RAP, trained parking, curb, chime, camera view, guide lines).
   - "Mock APA" primary action: a demo parking lot, scan, pick a space, back-in/nose-in, start/cancel/done, with the CAN exchange listed — [carcatalog.js:291](static/js/carcatalog.js#L291), [apamock.js:1-9](static/js/apamock.js#L1-L9), [carcontrols.js:1243-1290](static/js/carcontrols.js#L1243-L1290).
6. *Energy* (sheet; pack fills with liquid, port door) — [carcatalog.js:296-328](static/js/carcatalog.js#L296-L328)
   - Status line "`<range> mi` · Charging · 7.4 kW · time left / Plugged in, not charging / Using N kW / Not plugged in" (range = 330 mi × SoC, a mock figure) — [carcontrols.js:51, 1137-1161](static/js/carcontrols.js#L1137-L1161). Charge limit slider (OWNED), charge current stepper (reads, OWNED), Start/Stop charging button (reads, OWNED); Schedule rows (telematics); V2L and its stop-at slider (OWNED). The port door is read (`VCU_ACChrgShttrSts`) and shown on the model.
7. *Audio* (sheet; amp and sound rings) — [carcatalog.js:329-357](static/js/carcatalog.js#L329-L357): Preset NO_MSG; five EQ sliders off "ICC_0x44: see above"; Sound stage, HyperSound NO_MSG; Announcements checks NO_MSG. Hidden from the dock unless demos are shown only if all are demo — these are "unavailable", so Audio stays in the dock greyed.
8. *Doors & Windows* ("Doors"; chips on the car) — [carcatalog.js:358-409](static/js/carcatalog.js#L358-L409)
   - Drag controls pinned to the four door windows, the sunroof and the liftgate: knob between two arrows; drag down opens a window (up opens the liftgate), a tap on an arrow goes all the way; on the car only Auto_Up/Auto_Down exist so the drag's direction is sent at its end — [carcontrols.js:411-478](static/js/carcontrols.js#L411-L478), [DESIGN.md:222-227](DESIGN.md#L222-L227). Quarter windows and rear window are read-only, shown on the model.
   - Lock hero (Locked/Unlocked + one primary button) — Sends/reads. Tiles: California Mode (OWNED), Close all (Sends), Fold mirrors (Sends/reads), Rear window lock and Child locks (NO_MSG). Locking rows: Unlock driver's/all doors, Lock when walking away (no readback), Unlock when powered off, Close windows when locking, Fold mirrors when locking, Close the sunroof in rain — all Sends (most read back). Doors themselves: "The doors are manual" toast — [carcontrols.js:752](static/js/carcontrols.js#L752).
9. *Service* (tire chips "42 psi" mock) — [carcatalog.js:410-438](static/js/carcatalog.js#L410-L438): info rows (mock VIN etc.), Reset tire pressure (mock), Roadside Mode NO_MSG, Owner's manual / Schedule service (mock).
10. *Display* (camera in the cabin at the screen) — [carcatalog.js:439-454](static/js/carcatalog.js#L439-L454): Brightness slider (reads `BCM_BackgndBriLvl_Cfm`, OWNED), Auto brightness OWNED, Appearance Auto/Light/Dark ("This screen's own setting" — demo kind, affects only the modelled screen), Hollywood Mode action (OWNED; turns the modelled screen sideways), Driver display NO_MSG, Clean screen MOCK.
11. System: *Connectivity* ("Network"), *Profiles & Keys* ("Profiles"), *Navigation*, *General*, *Software* — [carcatalog.js:455-565](static/js/carcatalog.js#L455-L565). All Connectivity/Profiles/Navigation controls are MOCK (Valet mode OWNED). General: Distance mi/km and Temperature °F/°C ("This screen's own setting", used by the temps row), Clock and Language MOCK, Chime volume off "ICC_0x46 carries every volume at once". Software: the app's own version/update section (real, [appupdate.js](static/js/appupdate.js)), then mock FiskerOS rows.

**Live read-out tables**: `LIVE` provides per-category label/value rows from the car (lighting, climate, seats, driving, energy, doors, display) — [carcatalog.js:600-697](static/js/carcatalog.js#L600-L697). The README still describes a "From the car" block at the top of each menu — [README.md:31-32](README.md#L31-L32), [INTERNALS.md:184-186](INTERNALS.md#L184-L186) — while DESIGN.md records the decision "No 'From the car' blocks. A live control shows the car's value; the dock tag says whether changes go to the car" — [DESIGN.md:232-233](DESIGN.md#L232-L233).

### Inferences
- Of the ten car-part categories, the ones with real two-way control today are Doors & Windows, Climate (minus temperatures), Seats (heat, memory, easy entry) and Lighting (headlights, ADB); Driving, Energy, Display are read-only displays with every setter greyed as head-unit-owned; Assist is read-only except the five comma-routed ACC settings; Audio and Service are placeholders.
- `LIVE` rows appear to be dead code in the sheet since the "From the car" blocks were removed (no caller in `carcontrols.js` renders `LIVE`); the "Reads only" tags on individual controls replaced them.
- The Appearance segment under Display is not wired to the HUD's own theme setting (that lives in Settings → Display → General); a user looking for day/night in the car-controls UI finds a demo control.

### Gaps
- No usage data or user testing notes exist in the repo; which categories drivers actually open is unknown.
- Whether tire pressures can be read from CAN (the chips are hard-coded "42 psi") is not stated.

## Q3. What settings exist, grouped how, and which are debug-only?

### Takeaway
The gear button opens a right-hand sheet with seven tabs (Display, Signals, Comma, CAN settings, Driving, Playback, About); Display is split into General / Road / Objects / Debug sub-sections, and the Debug section holds the radar view, object stats, demo modes, fps counter, render resolution and geometry calibration. Three tabs (CAN settings, Driving, Playback) show a banner and nothing else without the comma.

### Cited Findings
- Sheet: `width: min(560px, 100vw)`, right-anchored, full width in portrait, tab bar scrolls horizontally, close ✕ — [app.css:226-237, 390](static/app.css#L226-L237), [index.html:122-136](static/index.html#L122-L136). Re-rendering keeps the scroll position — [settings.js:62-93](static/js/settings.js#L62-L93).
- Offline tabs and their banner text: overrides "The CAN settings are kept on it and applied by it; they stay as they were."; driving "The driving settings are openpilot's, on the comma."; playback "The recorded drives are on the comma." prefixed by "The comma isn't connected (it's optional: the HUD runs from the car)." — [settings.js:10-14, 55-60](static/js/settings.js#L10-L14).
- Defaults (all persisted in `localStorage` key `webhud.settings`, version 3) — [main.js:18-31](static/js/main.js#L18-L31).

**Display → General** — [settings.js:299-331](static/js/settings.js#L299-L331)
- Theme Auto/Day/Night; Speed units Follow cluster/mph/km/h; Traffic side Follow car/Left (UK)/Right; Camera speed-sign units Follow car/mph/km/h; Speed-sign style Follow units/Round (UK/EU)/US; Paint (swatch grid of factory paints) and Wheels (F3/F5/F6 alloy or black); toggles Power trails, Auto view, Music, Navigation (the last two "Needs the HUD's Android app on the car's screen").

**Display → Road** — [settings.js:333-388](static/js/settings.js#L333-L388)
- Lane lines Blended/Fisker ADAS/openpilot/Both; Lane confidence threshold slider 10–90 % with live "Now N%, lanes shown/hidden"; toggles Inferred road, Map road, Ground texture, 2D map, Traffic lights & signs, Planned path; Map download Off/10/25/50/100 km with a status line from `/map/status`; Position Car / This screen with a fix status line.

**Display → Objects** — [settings.js:417-433](static/js/settings.js#L417-L433): Objects World model / Raw sources; toggles openpilot leads, Low-confidence objects, Parking sensors.

**Display → Debug** (debug-only) — [settings.js:435-473](static/js/settings.js#L435-L473)
- Toggles: Radar objects (now on by default in the working tree), All radar tracks, Object stats, Demo music & navigation, Demo car controls, Demo live car state, Frame rate (on by default, "on for now" per [INTERNALS.md:205](INTERNALS.md#L205)); Render resolution Auto/Full/75 %/50 %; Geometry calibration: Measured sensor calibration (on), Invert lane heading / curvature / object heading.

**Signals** — [settings.js:552-646](static/js/settings.js#L552-L646): bus picker IBUS1 / IBUS2 / ADAS bus (comma, only while connected); on IBUS1 a "Sending to the car" link-check section with Check the link / Copy (app only) — [settings.js:536-550](static/js/settings.js#L536-L550); a search filter; each message as a row with frame count and age ("not seen", "via comma"), expandable to a live signal table.

**Comma** (app only) — [comma.js:1-17](static/js/comma.js#L1-L17): sub-sections Overview (connection, Look again, SSH key create/authorize/trust host key/delete, Start/Stop/Restart/Reboot, device summary), Log (tmux, 200/1000/3000 lines, pause), Processes (managerState table + device state), Routes (list, ▶ Play when the comma streams), Updates (installed, Update with preview of commits, Branch switch, Install a fork from three presets, Restore backup, Advanced: built-in updater and git fetch/pull, Panda build/flash/recover), Debug (a command with quick presets, recent jobs, raw info). Jobs stream into a card at the top of the tab and carry on when the tab is closed — [comma.js:13-14, 569-579](static/js/comma.js#L569-L579).

**CAN settings** (comma) — [settings.js:97-213](static/js/settings.js#L97-L213): one section per ICC message table with "customized"/"code defaults" badge, a row per signal (select or number, "Pass through (ICC value)"), Save / Revert / Reset to code defaults, "Show every signal" switch; "Changes are locked while the car is moving." banner when not editable.

**Driving** (comma) — [settings.js:217-271](static/js/settings.js#L217-L271): Following distance Aggressive/Standard/Relaxed; Fisker ACC defaults (ACC auto speed, ACC Terrain Mode) with the note "Car → Assist sets these live and wins over them"; Speed-limit signs (ADAS): Sign units, Traffic side, Country; Experimental mode; Use metric units.

**Playback** (comma) — [settings.js:477-527](static/js/settings.js#L477-L527): current replay banner with Back to live; drop/choose an rlog/qlog; "Playback is unavailable while the car is moving." banner; Play demo drive; routes on the device with ▶ Play and per-segment buttons.

**About** — [settings.js:650-677](static/js/settings.js#L650-L677): the app's version and update controls in the sheet's own style ("Mrichchhakatikam"), Driving data source line ("The car's IBUS1/IBUS2…", "The comma alone", "A drive the comma is replaying", "Nothing yet: the car is asleep, or this isn't the car's screen"), Comma bridge status, the touch hint, credits.

### Inferences
- Settings are a developer's instrument panel as much as a user's: of ~45 Display switches, about a third are calibration or demo switches, and the comma tabs are SSH administration. Only Theme, Speed units, Paint, Wheels, Music, Navigation, Auto view, 2D map and Map download read as end-user preferences.
- Regional settings are split across three places (Display → General traffic side/sign units; Driving → Speed-limit signs (ADAS) for the comma; Car → General distance/temperature for the car-controls temps row) with different scopes.

### Gaps
- The settings sheet has no search and no indication of which tabs are "advanced"; whether the authors consider that a problem is not recorded.

## Q4. How does the user navigate between HUD, car controls, settings, comma UI, playback, infotainment, energy and cutaway?

### Takeaway
There is no menu or home screen: the HUD is the root, and every other surface is reached by one gesture from it — gear button → settings sheet (tabs), tap on the car → car controls (dock + sheet + on-car pins), comma chip → Comma tab, power bar → trace → Energy dialog, video button → camera window, camera button → view menu, Android Back → a native menu. Replay is entered from Playback or the Comma tab's Routes and shows as a transport bar.

### Cited Findings
- Gear `#btn-settings` → `Settings.open()` (last tab remembered); ✕ closes and unsubscribes raw signals — [settings.js:28-53](static/js/settings.js#L28-L53).
- Tap the car → `CarControls.enter()` after the 300 ms double-tap wait; dock ✕, sheet ✕, a tap on empty space from the overview, all call `exit()`; the sheet's back chevron (and the "All settings" chip over on-car cards) return to the overview — [main.js:503-511](static/js/main.js#L503-L511), [carcontrols.js:170-181, 246, 261-263, 384](static/js/carcontrols.js).
- Comma chip (only while the comma streams) → `ui.open('comma')` — [main.js:98](static/js/main.js#L98).
- Power bar tap → opens the 60 s trace in the status card; its "Details" button → Energy dialog (modal, Escape/backdrop closes) — [hud.js:31-32](static/js/hud.js#L31-L32), [energy.js:128-141](static/js/energy.js#L128-L141).
- Video button → `roadcam.open(settings.roadcam)` / `close()`; inside the window a tap shows Road/Wide/Mirror and ✕ — [main.js:472-479](static/js/main.js#L472-L479), [roadcam.js:133, 147-164](static/js/roadcam.js#L147-L164).
- Camera button → popover menu; selecting a view saves it and suspends auto view for 10 s — [main.js:463-487](static/js/main.js#L463-L487).
- Playback: Settings → Playback → ▶ Play or "Play demo drive" closes the sheet and the replay bar appears at the bottom with Live to return; Comma → Routes → ▶ Play does the same — [settings.js:493, 507-515](static/js/settings.js#L507-L515), [comma.js:338](static/js/comma.js#L338), [main.js:344](static/js/main.js#L344).
- Assist → Mock APA swaps the sheet for the APA panel (hero, spaces, Start/Cancel/Done); Done returns to Assist — [carcontrols.js:573-585, 1245-1290](static/js/carcontrols.js#L573-L585).
- Software (car controls) and About (settings) both host the self-update section ("Check for updates", "Install vX") — [carcatalog.js:542](static/js/carcatalog.js#L542), [settings.js:653](static/js/settings.js#L653), [appupdate.js:37-52](static/js/appupdate.js#L37-L52).
- Android Back opens a native `AlertDialog` menu: title "Comma: host · address" or "Comma: not connected (optional)", items Reload HUD, Look for the comma again, Comma address…, Close; the address dialog explains the hotspot IP with "Find automatically" — [MainActivity.kt:222, 442-486](android/app/src/main/java/ai/sunnypilot/webhud/MainActivity.kt#L442-L486), [strings.xml:8-20](android/app/src/main/res/values/strings.xml#L8-L20), [android/README.md:53-54](android/README.md#L53-L54). The app is full-screen immersive with system bars hidden and the screen kept on — [MainActivity.kt:506-508](android/app/src/main/java/ai/sunnypilot/webhud/MainActivity.kt#L506-L508), [android/README.md:56](android/README.md#L56).
- Cutaway is not a destination: `cutaway.js` is the 3D side of car mode (roof fade, glows, doors, windows, battery, screen) driven by `carcontrols.js` — [cutaway.js:1-7](static/js/cutaway.js#L1-L7).
- Keyboard: Space/←/→ for replay only — [main.js:541-546](static/js/main.js#L541-L546).

### Inferences
- Car mode and the settings sheet can both be open at once (the sheet is z 30 over the dock at z 10); nothing in the code closes one when the other opens, so the user can stack them.
- The only persistent affordances visible while driving are the three round dock buttons and the (invisible) tap target on the car; discoverability of car controls depends on knowing to tap the car.
- Replay, demo drive and Mock APA all temporarily replace live data on the main HUD without a persistent framing other than the REPLAY chip / APA sheet.

### Gaps
- No onboarding or first-run hint exists in the code; the repo does not say whether users have found the tap-the-car entry on their own.

## Q5. What is the stated design language, theme handling, typography, colour roles and motion rules?

### Takeaway
Two visual systems coexist: the HUD's own "glass card" style (translucent panels with backdrop blur, 18 px radius, blue accent) in `app.css`, and the Tesla-derived "fo" flat language (hairline cells, 8 px radius, regular weights, one blue per screen, no blur) in `design.css` used by car mode. Both carry day/night tokens, follow the car's day/night via `prefers-color-scheme` on Auto, and the perf meter may strip the blur under load.

### Cited Findings

**HUD style (app.css)**
- Light tokens: `--bg #eceef1`, `--panel rgba(255,255,255,.84)`, `--text #16181c`, `--muted #7d828b`, `--accent #3e6ae1`, `--green #2fa84f`, `--amber #f0a020`, `--red #e5413a`, `--radar #0a9fb2`, chart series `--s1..--s5`, `--radius 18px`, system font stack — [app.css:1-22](static/app.css#L1-L22). Dark: `--bg #101216`, `--panel rgba(24,27,32,.82)`, `--accent #5b86ff` — [app.css:24-39](static/app.css#L24-L39). `.card` = panel + `backdrop-filter: blur(16px) saturate(1.2)` + shadow — [app.css:94-100](static/app.css#L94-L100).
- Scene colours per theme (bg, ground, road, lane line, edge, yellow, blue, red, path, radar) — [scene.js:93-98](static/js/scene.js#L93-L98). Ego reflection strength by theme — [scene.js:49](static/js/scene.js#L49).
- Motion: alerts drop in 0.25 s and critical ones pulse; the view menu pops 0.16 s; the settings sheet slides 0.22 s; switches 0.2 s — [app.css:165-172, 195-198, 228-230, 286-289](static/app.css).
- `html.lowfx` removes every backdrop blur and makes cards solid when frames fall behind — [app.css:57-59](static/app.css#L57-L59), [perf.js:1-17](static/js/perf.js#L1-L17).

**Car-controls language (DESIGN.md / design.css)**
- "The rules for the car-controls interface on the Fisker Ocean's portrait center screen, 1080 × 1920. Tesla's in-car interface … is the reference." — [DESIGN.md:3-5](DESIGN.md#L3-L5). What is copied: flat ground, cells not fills, ~8 px radii, regular type with hierarchy in size and grey, thin line icons, almost no colour, one number per screen — [DESIGN.md:12-26](DESIGN.md#L12-L26).
- Principles 1–7: the car is the interface; choose don't toggle; cells for what you do while driving, rows for parked settings; the number first; group by what it does to the car; one language for live/sent/off; scale by frame (rem against 1080 wide), no backdrop blur over the 3D view "the car's GPU would pay for it every frame" — [DESIGN.md:28-46](DESIGN.md#L28-L46).
- Scale: `html.fo { font-size: calc(100vw / 67.5) }` in portrait so 1 rem = 16 frame px — [DESIGN.md:48-51](DESIGN.md#L48-L51), [design.css:15-17](static/design.css#L15-L17), [app.css:406](static/app.css#L406).
- Layout zones for 1080 × 1920: status strip 96, stage, sheet 448/848/1360, dock 112 with ten car-part categories, a divider, *More* for the five system categories — [DESIGN.md:53-66](DESIGN.md#L53-L66).
- Colour tokens day/night: ground #f4f4f4/#171717, cell #fff/#1f1f1f, ink #393c41/#f0f0f0, accent #3e6ae1/#4d7ff0, heat #e0452c, cool #2f8fe6, ok #2e9e4f, warn #e8a317, bad #d93a2f, earth/fun/hyper, on-stage black 72 %/82 % — [DESIGN.md:69-85](DESIGN.md#L69-L85), [design.css:19-74](static/design.css#L19-L74).
- Type: system face (Roboto on the car), weights 300/400/500 only, .02 em tracking on labels, tabular numerals; display 72/300, hero 48/300, title 32/500, heading 24/400, body 24/400, label 22/400 (500 chosen), caption 18/400 — [DESIGN.md:87-100](DESIGN.md#L87-L100), [design.css:36-45](static/design.css#L36-L45).
- Measure: minimum hit 72, row 80, tile 120, switch 64 × 36, dock item 80 × 96, slider thumb 88 × 52, radius 8/12, icons 24-grid at 1.6 stroke — [DESIGN.md:102-113](DESIGN.md#L102-L113).
- States: Rest / On / Primary (at most one per screen) / Pressed / Live ("No mark on the control. The dock tag reads On the car, green") / Pending (glyph fades to 50 % up to 1.5 s) / Off (grey, lock, toast) / Mock (dock tag "Mockup") — [DESIGN.md:137-148](DESIGN.md#L137-L148).
- Motion: sheet/dock 380 ms `cubic-bezier(.2,.8,.2,1)` with the camera eased over the same time; state 180 ms; press 80 ms; chips 200 ms fade then no transition; `prefers-reduced-motion` turns everything off — [DESIGN.md:150-160](DESIGN.md#L150-L160), [design.css:54-55](static/design.css#L54-L55).
- Decisions taken 2026-10-05 (Climate as Tesla grid, Doors & Windows controls on the car with no percentages, Energy as a liquid-filled pack with no charge number, Driving as segments, no "From the car" blocks, the power bar on the status card) — [DESIGN.md:209-235](DESIGN.md#L209-L235).
- `design.html` is the living reference: tokens, components, four category screens (Climate, Doors & Windows, Energy, Driving) at frame size with detent switches, sheet-body excerpts for Lighting/Display/Audio, Seats cards, and a day/night toggle — [design.html:85-90, 339-364](static/design.html#L339-L364), [DESIGN.md:7-10](DESIGN.md#L7-L10).

**Theme handling**
- Theme setting Auto/Day/Night; Auto follows `prefers-color-scheme` (the app maps the car's day/night mode to it); the setting is handed to the Android app so it starts in that mode — [main.js:162-170](static/js/main.js#L162-L170), [android/README.md:56-57, 68-72](android/README.md#L68-L72). Mini-map, energy graph and econ trace read CSS tokens at runtime — [minimap.js:48-64](static/js/minimap.js#L48-L64), [energy.js:234-236](static/js/energy.js#L234-L236), [hud.js:53-56](static/js/hud.js#L53-L56).

### Inferences
- The HUD's status card uses blur (an explicit "no blur" rule exists only for car mode); the perf meter's first auto step is to remove it, which implies the authors measured blur as a frame-time cost on Pulse.
- The two systems disagree on radius (18 vs 8), on panel treatment (glass vs flat) and on accent in dark mode (#5b86ff vs #4d7ff0); DESIGN.md records the intent to converge ("nothing in app.css or carcontrols.js uses them yet" is stale: carcontrols now uses `fo-` classes — [DESIGN.md:9-10 vs 211-213](DESIGN.md#L209-L213)).

### Gaps
- DESIGN.md is explicitly for portrait 1080 × 1920; the brief says the Pulse screen is landscape. The repo contains both orientations' CSS and CAR_CONTROLS_PLAN notes "On a short landscape screen (free height under 420 px) the car lies nose-right" — [CAR_CONTROLS_PLAN.md:45-46](CAR_CONTROLS_PLAN.md#L45-L46) — but nowhere states which orientation the car actually runs. Treat as unresolved.
- DESIGN.md's "status strip" zone and the "More" dock item are specified but not built (see Q7).

## Q6. What moving-while-driving guards exist and what do they lock?

### Takeaway
Guards are server-side and comma-side, not in the HUD's own chrome: the comma refuses CAN overrides, SSH key changes and replay while moving; the Android app refuses comma jobs and self-install above walking pace; ACC settings in Assist grey out with "Parked only". Nothing in the page itself locks the car-control sends, settings sheet or camera window by speed.

### Cited Findings
- "CAN overrides, SSH keys and replay are refused while the car is moving." — [README.md:115-116](README.md#L115-L116); CLAUDE.md: "CAN overrides, SSH keys, replay and comma management jobs are refused while the car moves. Keep these guards." — [CLAUDE.md "Constraints on sending CAN"](CLAUDE.md).
- CAN settings tab: "Changes are locked while the car is moving." (controls disabled when `!data.editable`) — [settings.js:120, 136-138, 166-172](static/js/settings.js#L120).
- Playback: "Playback is unavailable while the car is moving." — [settings.js:491](static/js/settings.js#L491).
- Assist ACC settings: "Parked only: the comma refuses changes while the car moves" — [accsettings.js:32](static/js/accsettings.js#L32).
- Comma tab: "Anything that disturbs openpilot asks first, and the app refuses it while the car moves."; jobs POST the HUD's speed; "Not while the car is moving." on the Start/Stop/Restart/Reboot section, routes, exec and update — [comma.js:14, 58-63, 194, 319, 453, 512, 524](static/js/comma.js). Android: "Start, stop, restart, reboot, pull, branch, install, restore, the panda and commands are refused while the car moves" — [android/README.md:170-172](android/README.md#L170-L172).
- Self-update: "The HUD restarts either way, so installing is refused while the car moves." — [android/README.md:207-209](android/README.md#L207-L209), [appupdate.js:4, 83](static/js/appupdate.js#L83).
- Car-control sends are gated only by the bus being awake and the allowlist (`CanIds.TX`, enforced in `CanBridge.send` and the Go helper), rate-limited to 60 frames/s — [cancmd.js:67-77](static/js/cancmd.js#L67-L77), [android/README.md:112-121](android/README.md#L112-L121), [CLAUDE.md "Constraints on sending CAN"](CLAUDE.md).
- Android Automotive may block the whole app while driving unless it is a system app ("an app that isn't distraction optimized is blocked while driving … install it as a system app") — [android/README.md:194-197](android/README.md#L194-L197).
- Auto view switches to top view when parking (speed < 2.5 m/s) — the only speed-driven UI change — [main.js:435-459](static/js/main.js#L435-L459).

### Inferences
- The driving/parked distinction is a capability rule (what the car or comma will accept), not a UI mode: the same screens show while driving with some rows greyed. DESIGN.md's principle 3 ("Cells for what you do while driving … Rows are for settings you reach when parked") is the only designed distinction, applied by control shape rather than by lockout.
- Window, sunroof, liftgate, lock and seat-heat sends are allowed at any speed by the page; whether the car's BCM refuses them in motion is not recorded.

### Gaps
- No stated policy on driver distraction for the HUD's own overlays (e.g. hiding the music card or the mini-map above a speed); none is in the code.

## Q7. What UX issues, TODOs or known issues do the authors record?

### Takeaway
The authors keep an "Open" list in DESIGN.md and CAR_CONTROLS_PLAN.md (landscape on-car cards still old layout, no status strip in car mode, airflow colours, head-unit performance, phone landscape cramped), and the code carries admitted gaps: seat moves don't act on the car, Auto headlights can't be sent, navigation notifications untested on the real head unit, Pulse drops half the CAN frames, and several menus are mockups.

### Cited Findings
- DESIGN.md open items: "the on-car cards in landscape still use the old card layout in the new colors; the status strip in car mode is not built (the HUD's status card stays); the airflow particle colors deserve a pass with the car's real temperatures." — [DESIGN.md:237-239](DESIGN.md#L237-L239).
- CAR_CONTROLS_PLAN open items: head-unit performance to check (model is 815k triangles, ~230 draw calls); "On a phone in landscape the free area beside the panel is small; the HMI sizes are what it's laid out for"; the Pulse model package states no licence — [CAR_CONTROLS_PLAN.md:137-144](CAR_CONTROLS_PLAN.md#L137-L144). Performance history: car mode had backdrop blur over a 3D view redrawn every frame, a screen-sized SVG rewritten every frame, and `scrollIntoView` shifting the whole HUD up 94 px; all fixed — [CAR_CONTROLS_PLAN.md:109-124](CAR_CONTROLS_PLAN.md#L109-L124). Earlier tap-target bugs (sunroof box stealing seat taps, screen cutting into the dash) and their fixes — [CAR_CONTROLS_PLAN.md:65-72, 104-107](CAR_CONTROLS_PLAN.md#L65-L107).
- Seat position: "ICC_0x533 went out clean on the car and the seat didn't move, and the head unit sends that message itself: not sent until that's understood." — [carcatalog.js:590-591](static/js/carcatalog.js#L590-L591) (uncommitted).
- Headlights Auto cannot be sent (toast) — [carcatalog.js:108, 114](static/js/carcatalog.js#L108-L114). Heated wheel and Easy entry: "the car doesn't report whether it's on" — [carcatalog.js:161, 595](static/js/carcatalog.js#L161).
- ACC Terrain Mode: "its effect on driving is unverified" — [carcatalog.js:233](static/js/carcatalog.js#L233), [settings.js:232](static/js/settings.js#L232).
- Navigation source on the real head unit is unknown: "Not tested on the car's head unit yet: which app gives the turns there … is unknown." — [android/README.md:97-100](android/README.md#L97-L100).
- Frame loss: "Pulse drops a large share of received frames (about half on IBUS1, two-thirds on IBUS2) … the read-out still settles; it just lags." — [android/README.md:151-154](android/README.md#L151-L154). Without root the hardware filters stay narrow and "those read-outs stay empty and the car-only view has no steering or yaw" — [INTERNALS.md:198-203](INTERNALS.md#L198-L203).
- Frame rate counter is "on for now" by default — [INTERNALS.md:205](INTERNALS.md#L205); the display rate is assumed 60 Hz, "not measured: a guess from bunched frames once pinned the resolution low" — [perf.js:17, 25](static/js/perf.js#L17-L25).
- Road-network layout off-thread because "a town's network took 40-60 ms there on the head unit, a dropped frame or three each time" — [INTERNALS.md:276-277](INTERNALS.md#L276-L277).
- The UK regional overrides "are saved on the device and must be changed when the road/sign conventions change … car hardware validation is still required." — [android/README.md:240-249](android/README.md#L240-L249).
- Docs drift: README/INTERNALS still describe a "From the car" block, the repo name "Oceanfront View", and the upstream release URL — [README.md:1, 31-32, 103](README.md), [INTERNALS.md:184](INTERNALS.md#L184), acknowledged in [CLAUDE.md "What this is"](CLAUDE.md). DESIGN.md:9-10 says nothing in app.css/carcontrols.js uses the tokens yet, contradicted by DESIGN.md:211-213.
- Duplicate CSS block for `.offline` — [app.css:483-492](static/app.css#L483-L492).
- Design-doc items not implemented in code: the car-mode status strip ([DESIGN.md:57](DESIGN.md#L57)), the *More* dock item for system categories (the code lists all fifteen in one scrolling dock — [carcontrols.js:239-243](static/js/carcontrols.js#L239-L243) vs [DESIGN.md:60](DESIGN.md#L60)), the "Pending" 50 % fade state (no `pending` class in carcontrols.js), window cells with percentages (replaced by on-car drag controls per [DESIGN.md:222-227](DESIGN.md#L222-L227)).

### Inferences
- The authors' recorded concerns are almost all performance and correctness (frame budget, CAN semantics), not layout usability; there is no record of label clipping, card overlap or reach problems, which may mean they were not measured on the car rather than that they do not occur.
- Several "mockup" menus (Connectivity, Navigation, Profiles, Service, FiskerOS) exist only to mirror the head unit's manual; with demos off they vanish from the dock (Connectivity, Profiles, Navigation) or shrink (Service, Software), so the dock's length depends on a debug switch.

### Gaps
- No issue tracker export, bug list or user feedback is in the repo; "known issues" are limited to inline comments and the two docs' Open lists.
- No record of which overlays, if any, were observed overlapping on the real screen.

## Q8. What do the README and android/README say the user-facing features are?

### Takeaway
The README lists: driving view, world model, map road with prefetch, live car controls, music and navigation, the comma camera in three styles, a Comma tab for SSH management, and debug tools; android/README adds automatic comma discovery on the hotspot, a loopback relay that keeps settings stable, theme hand-off, notification-based music/nav, CAN read and allowlisted send, SSH management jobs, and self-update from GitHub releases with signature checks.

### Cited Findings
- README features list: Driving view (speed, gear, ACC/MADS, limit, alerts, lanes, objects, parking sensors, lights, signs, stop lines, crosswalks); World model (*Display → Objects*); Map road with tiles prefetched (*Display → Map download*); Live car controls "reflected on the 3D car … ones that can't are greyed out"; Music and navigation with a turn arrow; Comma camera (drag anywhere, resize from its corner, tap for controls; Road/Wide/Mirror); Comma tab (start/stop openpilot, logs, processes, routes/replay, updates, branch/fork switching, panda firmware); Debug tools (Signals tab, object stats, radar tracks, fps counter with auto resolution, demo modes) — [README.md:23-47](README.md#L23-L47).
- Bridge API and write policy ("Writes are accepted only from private addresses and never cross-origin") — [README.md:107-116](README.md#L107-L116).
- android/README: the page and model ship in the APK and the HUD is up when the app starts; the app finds the comma on the hotspot by itself (manual address, ARP via root, sweeps); "Nothing on screen waits for it or says it's missing" — [android/README.md:1-32](android/README.md#L1-L32). The page is served at `127.0.0.1:18090` so settings survive address changes; stale sockets dropped after 6 s; crashed WebView replaced; the app releases the comma when the screen is off — [android/README.md:34-51](android/README.md#L34-L51). Back menu; screen stays on, bars hidden, rotation keeps the page, Auto theme follows the car's day/night — [android/README.md:53-57](android/README.md#L53-L57). Theme hand-off to avoid a light flash at start — [android/README.md:68-72](android/README.md#L68-L72).
- Music and navigation via a notification listener: media sessions (title, artist, album, art, position, controls) and nav notifications from Google Maps, Waze, HERE, Sygic, OsmAnd, MapQuest, Organic Maps, parsed on the page — [android/README.md:75-100](android/README.md#L75-L100).
- CAN: reads the IDs in `CanIds.kt`, forwards changed frames and repeats each once a second; send allowlist enforced twice, refused when the bus is silent or above 60 frames/s, every send logged; cyclic head-unit state messages and audio messages never sent — [android/README.md:103-131](android/README.md#L103-L131).
- Comma management: app-owned ECDSA key in the Android Keystore, authorize via the bridge, pinned host key, scripts for jobs with 512 kB output kept — [android/README.md:156-175](android/README.md#L156-L175).
- Self-update: Software sheet checks GitHub releases at most every 30 min, verifies size/SHA-256/package/versionCode/signer, installs silently with root or via Android's installer; cars can't install an APK signed with a different key — [android/README.md:199-209, 226-230](android/README.md#L199-L230). This fork pulls releases from `hiremani/oceanscape` and runs beside Pulse's app and the other builds on its own package and port — [CLAUDE.md "What this is"](CLAUDE.md).

### Inferences
- The documented feature set is complete relative to the code; what the READMEs do not describe is any layout or interaction specification beyond "a card at the bottom / a card at the top" — layout decisions live only in CSS and DESIGN.md.

### Gaps
- The README still points at upstream `moistpope/oceanfront-view` releases; the fork's release notes (if any) are not in the repo.

## Q9. What is the state of the working tree (uncommitted changes relevant to UX)?

### Takeaway
The uncommitted work renames the app to "Mrichchhakatikam" (title, About, Software, update prompts, launcher name/icon), turns the radar chip on by default, makes seat position read-only with a reason, and adjusts object placement and map-trust logic in the 3D view; no layout changes are pending.

### Cited Findings
- `git diff --stat`: 24 files, +223/−82; UI-relevant: `index.html` title, `settings.js` About heading, `carcatalog.js` Software title and seat `moveOff`, `carcontrols.js` moveOff handling, `appupdate.js` texts, `comma.js` banner, `design.css` `.fo-jog button.off { opacity: .4 }`, `main.js` `showRadar: true`, `strings.xml` app name, launcher icon drawables — [git diff output; carcatalog.js:542, 588-592](static/js/carcatalog.js#L588-L592), [carcontrols.js:34, 1197, 1208-1214, 1232](static/js/carcontrols.js), [design.css:425](static/design.css#L425).
- `scene.js`: world objects now placed through the pose at snapshot time and glided over 0.35 s (`objplace.js`, new file with tests); map placement keeps running while the map has given way to the cameras (`mapDisagrees`) — [scene.js:21, 44-45, 1098-1131, 1410-1424](static/js/scene.js), [INTERNALS.md:107-113, 250-258](INTERNALS.md#L107-L113).
- Untracked: `static/js/objplace.js`, its test, `tools/car_deploy.sh`, a monochrome launcher icon.

### Inferences
- The fork's own UX work so far is identity (name, icon, port, package) and read-out fidelity; the layout is inherited unchanged from upstream OceanScape.

### Gaps
- `tools/car_deploy.sh` was not read; its role (presumably adb install to the car) is assumed, not confirmed.

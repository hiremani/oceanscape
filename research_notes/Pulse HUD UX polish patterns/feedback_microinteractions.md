# Action Feedback and Micro-Interactions in Touchscreen UIs

Scope: evidence-based, citable guidance on communicating action state (idle to pending to confirmed to failed/reverted), optimistic UI vs. wait-for-confirmation, micro-interaction timing/easing for in-vehicle large touch displays, and the choice between toast/snackbar, inline state, and transient highlight. Context is a portrait 1080x1784 Android car center-screen HUD that sends CAN commands and receives the car's reply, with the hard case that the head unit re-sends its own value every cycle, so a user change can silently revert.

Source-quality note: Several authoritative specs (m3.material.io, developer.apple.com HIG) are JavaScript-rendered and did not return body text via automated fetch. Where that happened, values are taken from the official token source code (androidx Compose Material3, the Flutter M3 generator) or faithful mirrors, and this is flagged. NN/g article text for response-time limits was retrieved directly and is reliable; NN/g figures for progress indicators come from secondary summaries and are flagged.

---

## Q1. Action states (idle -> pending -> confirmed -> failed/reverted): visual and timing conventions

### Takeaway
Design systems converge on a response-time budget (acknowledge input in ~0.1 s, show "working" if over ~1 s, show determinate progress if over ~10 s) and a small set of visual state treatments (translucent state-layer overlays for press/hover/focus; disable the control plus related controls during in-flight work; an explicit error surface on failure). There is no single published "optimistic-change-was-overridden" state in the major systems, so the reverted case must be composed from the failure + transient-highlight + inline-state patterns in Q2 and Q4.

### Cited Findings
- NN/g's three response-time limits (retrieved from the NN/g article directly): **0.1 s** = feels instantaneous, the result itself is sufficient feedback; for direct manipulation the selection highlight should appear within this limit. **1.0 s** = keeps the user's train of thought intact though lag is noticeable; delays of 1 s or more should show the system is working (e.g., change the cursor). **10 s** = attention limit; show a percent-done indicator and a way to interrupt, and expect reorientation afterward. — [NN/g, Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/)
- Material 3 **state-layer overlay opacities** (role color painted over a component to signal interaction state): hover 8%, focus 10%, pressed 10%, dragged 16%. Source is androidx Compose Material3 `StateTokens`, mirrored by a Rust port; a Dart M3 package matches. An older material-web table used 12% for focus/pressed, superseded by these tokens. — [androidx Compose Material3 StateTokens, via hydrolysis-m3 port](https://docs.rs/crate/hydrolysis-m3/latest/source/src/theme/state_layer.rs); [material_3_expressive M3EStateOpacity (Dart)](https://pub.dev/documentation/material_3_expressive/1.0.3/foundations_m3e_state_layer/M3EStateOpacity-class.html)
- Combining multiple active states: third-party implementations disagree — one takes the **maximum** of active opacities, another resolves in **priority order** (dragged > pressed > focused > hovered). Both are ports, not the spec; verify against the official spec before relying on either. — [frust-material state_layer](https://docs.rs/frust-material/latest/frust_material/state_layer/index.html)
- **In-flight / loading state (Carbon):** disable the triggering button while it loads AND disable related controls such as Cancel until the action completes; e.g., a modal submit button shows a spinner and stays disabled until done. Do not use inline loading for full-page loads (use skeletons) and do not trigger inline loading on more than one item/action at once. — [IBM Carbon, Inline loading guidelines](https://carbondesignsystem.com/components/inline-loading/guidelines/); [Carbon, Loading usage](https://carbondesignsystem.com/components/loading/usage)
- **Disabled styling (Carbon):** default disabled state = reduced opacity, no hover change, `not-allowed` cursor; a default-disabled element is skipped by screen readers (so provide a non-default disabled treatment when the control must stay discoverable/explained). — [Carbon, Disabled states pattern](https://www.carbondesignsystem.com/building-blocks/core/patterns/disabled-states)
- **Error state (Carbon):** on error the loading component becomes inactive and an inline notification or in-form error should appear (i.e., failure is surfaced inline near the control, not only as a transient toast). — [Carbon, Loading usage](https://carbondesignsystem.com/components/loading/usage)
- **Success dwell (Carbon v10):** the success state stays active for **1.5 s** before an optional onSuccess callback runs (version-specific; v10 "success" was renamed "finished" in later versions). — [Carbon v10, Inline loading usage](https://v10.carbondesignsystem.com/components/inline-loading/usage/)
- **Accessibility of state text (Carbon):** loading/status text is exposed via an `aria-live="polite"` region; where no text is shown, provide a text equivalent such as "loading". — [Carbon, Inline loading accessibility](https://www.carbondesignsystem.com/building-blocks/core/components/inline-loading/accessibility)
- **Apple HIG (from model memory, NOT verified against live page — JS-rendered, flag before citing):** show system status so people know input was received; confirm destructive/irreversible actions before performing them; reserve alerts for information requiring action, prefer inline/non-modal feedback for minor issues; use determinate indicators when the fraction of work is known and indeterminate spinners when duration is unknown; use haptics sparingly and pair with visual/audio cues (success/selection/error). — [Apple HIG, Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)

### Inferences
- For the Pulse CAN case, the "confirmed" state should be driven by the car's actual reply frame, not by the tap: this is effectively the wait-for-confirmation model where the canonical value comes back on the bus. A short success dwell (~1.5 s per Carbon) before settling to the confirmed resting state is a reasonable borrowed convention.
- Because a CAN send + car reply is typically well under 1 s, the "show working" (1 s) and "percent-done" (10 s) tiers rarely apply; the dominant need is the instantaneous (0.1 s) press acknowledgement plus a confirmed/reverted resolution.

### Gaps
- No major design system publishes a named state for "your value was accepted then overridden by another controller." Must be composed (see Q2/Q4).
- Live Apple HIG and m3.material.io body text could not be auto-fetched; state-layer and HIG specifics rest on token source/mirrors and model memory respectively.

---

## Q2. Optimistic UI vs. wait-for-confirmation, and the "change didn't stick / was overridden" pattern

### Takeaway
Optimistic UI (apply the change instantly, reconcile against the server/canonical value later) is a widely practiced convention for making actions feel fast, but it is practitioner convention, not research-validated. The standard safe loop is: snapshot prior state -> apply optimistically -> send -> reconcile to the canonical value or roll back, ALWAYS with an explicit user-visible notice on failure/rollback. For a system that re-asserts its own value every cycle (like the head unit), reconciling to the authoritative value and visibly showing the revert is exactly the recommended behavior; wait-for-confirmation is the more honest default when the authority can reject silently.

### Cited Findings
- **Optimistic UI core loop:** capture current state before the mutation; apply the change immediately; execute the server request in parallel; reconcile or roll back based on the response. Keep optimistic patches minimal and reversible to simplify rollback; maintain a serializable mutation queue with explicit IDs and timestamps. — [DEV Community, React optimistic UIs that don't drift from the server](https://dev.to/yaseenyk04/optimistic-react-uis-that-dont-drift-from-the-server-536l); [openreplay, Optimistic updates make apps faster](https://blog.openreplay.com/optimistic-updates-make-apps-faster/)
- **Reconcile to canonical data:** have the server return the canonical entity so the UI replaces its placeholder rather than assuming the optimistic value was right; version or checksum server data so reconcile logic can validate deltas. — [DEV Community](https://dev.to/yaseenyk04/optimistic-react-uis-that-dont-drift-from-the-server-536l)
- **Always tell the user about failure:** automatic rollback (e.g., React `useOptimistic` reverts when a transition fails) is not enough — the UI still needs an explicit error message/toast. — [DEV Community, useOptimistic patterns 2026](https://dev.to/stacknotice/react-useoptimistic-optimistic-ui-patterns-that-actually-work-2026-5460)
- **Edge handling:** set reasonable timeout thresholds, use exponential backoff for retries, store failed mutations for later retry when offline; test with simulated slow networks and forced server errors to validate rollback. — [openreplay](https://blog.openreplay.com/optimistic-updates-make-apps-faster/)
- **Evidence caveat:** a secondary source states no formal research validates optimistic UI; it is practitioner convention based on perceived-performance benefits. Treat it as established practice, not a research-backed finding. — [skills.cat, feedback-design (secondary)](https://skills.cat/skills/bfmcneill/agi-marketplace/feedback-design)
- **Direct-manipulation acknowledgement:** NN/g's 0.1 s limit means the optimistic highlight/selection should appear within 100 ms of the tap regardless of when the real result lands. — [NN/g, Response Times](https://www.nngroup.com/articles/response-times-3-important-limits/)
- **Undo as the reconciliation affordance:** Material snackbars that offer an action such as Undo should use a longer timeout to leave room for interaction (see Q4 for the 4-10 s range). — [Firefox Acorn, Snackbar (Android)](https://acorn.firefox.com/latest/mobile/components/snackbar/android-pNOUdFi9)

### Inferences
- The head-unit-re-sends-every-cycle case maps cleanly onto "reconcile to canonical data": the car's cyclic frame IS the canonical value, so the HUD should treat its own send as optimistic and snap the control back to the car's value when the car overrides it — and surface that revert explicitly (transient highlight + short inline message), not silently.
- Because the authority can reject silently and quickly, a defensible pattern is a brief optimistic "pending/sent" state (so the tap feels instant per the 0.1 s rule) that resolves to either "confirmed" (car's reply matches) or "reverted/overridden" (car's next frame differs) within a bounded window (e.g., a few cycles); if no confirming frame arrives in the window, fall to a "didn't stick" state rather than leaving the optimistic value showing.
- Wait-for-confirmation is the safer default for irreversible or safety-relevant sends; optimistic is appropriate only for cheap, reversible, frequently-confirmed controls.

### Gaps
- No automotive-specific source was found that prescribes exactly how to animate an override/revert on a vehicle HUD; the pattern is assembled from web-app optimistic-UI practice plus the transient-highlight/inline-state conventions in Q4.
- Exact dwell for a "pending -> reverted" window is not specified by any source; must be tuned to the car's frame cadence.

---

## Q3. Micro-interaction motion: durations, easing, press feedback, and reduced motion (in-vehicle emphasis)

### Takeaway
Material 3 provides a concrete 16-step duration scale (50-1000 ms) and a small set of named easing curves; short interaction feedback lives in the 50-200 ms range and larger transitions in 200-500 ms. For a moving vehicle, authoritative car-UI guidance emphasizes glanceability and distraction reduction (dim/hide disallowed features while driving, clearly communicate unavailable options) rather than decorative motion, and WCAG 2.3.3 plus `prefers-reduced-motion` back reducing non-essential animation.

### Cited Findings
- **M3 duration scale (ms), from the official token set (via ports/CSS listing; m3.material.io not auto-fetchable):** short1 50, short2 100, short3 150, short4 200, medium1 250, medium2 300, medium3 350, medium4 400, long1 450, long2 500, long3 550, long4 600, extra-long tiers 700-1000. Grouped short/medium/long/extra-long, four steps each. — [hydrolysis-m3 motion tokens port](https://docs.rs/crate/hydrolysis-m3/latest/source/src/theme/motion/tokens.rs); [Flutter M3 motion_template generator](https://flutter.googlesource.com/mirrors/flutter/+/228df7e82104877a79abdddbc066c05d57b6045c/dev/tools/gen_defaults/lib/motion_template.dart)
- **M3 easing curves:** standard = `cubic-bezier(0.2, 0.0, 0.0, 1.0)`; emphasized-accelerate = `cubic-bezier(0.3, 0.0, 0.8, 0.15)`; legacy (M2) standard = `cubic-bezier(0.4, 0.0, 0.2, 1.0)`. Role mapping: emphasized for on-screen movement, decelerate for entering elements, accelerate for exiting elements. M3 Expressive reportedly uses spring-based tokens rather than fixed beziers (secondary, verify). — [hydrolysis-m3 motion tokens](https://docs.rs/crate/hydrolysis-m3/latest/source/src/theme/motion/tokens.rs); [flutter_ui_kit_theme AppMotion](https://pub.dev/documentation/flutter_ui_kit_theme/latest/tokens_app_motion/AppMotion-class.html)
- **Press feedback (ripple), from a Material Components ripple port (component-local timings, NOT M3 scale tokens):** ripple wave grows over ~225 ms, opacity fades in over ~75 ms, state-layer fade ~280 ms with standard easing. — [hydrolysis-m3 motion mod](https://docs.rs/crate/hydrolysis-m3/latest/source/src/theme/motion/mod.rs)
- **Unofficial generic micro-interaction timings (secondary skill page, NOT official — flag):** hover 100-200 ms, focus 200-300 ms, press 100-150 ms. Not from the M3 spec. — [skills.cat, material design 3 motion (secondary)](https://skills.cat/skills/shelbeely/shelbeely-agent-skills/material-design-3-motion)
- **Car-UI distraction/glanceability (authoritative, Google Android for Cars):** clearly distinguish allowed from disallowed features while in motion (e.g., dim distracting media); hide parked-only features while driving (example: hide the search box); keep icons/terminology/interaction patterns consistent and predictable to reduce decision time; clearly communicate when options are unavailable or inaccessible so drivers understand system state at a glance. — [Google Android for Cars, Visual principles](https://developers.google.com/cars/design/design-foundations/visual-principles?hl=en)
- **Car-UI nighttime polarity:** nighttime content must use negative polarity (light on dark) because positive polarity can dazzle drivers. — [Google, Visual principles](https://developers.google.com/cars/design/design-foundations/visual-principles?hl=en)
- **Reduced motion (WCAG 2.3.3 Animation from Interactions, Level AAA):** applies when user interaction triggers non-essential animation; essential animation is allowed. Sufficient techniques: CSS `prefers-reduced-motion` query (C39) and the same query checked in JavaScript (SCR40, via `window.matchMedia('(prefers-reduced-motion: reduce)')`), skipping the animation or switching to an instant state change. Rationale: triggered reactions include nausea and migraine. Best practice (not strict): replace motion with opacity fades rather than removing feedback entirely, and offer an in-app toggle. — [W3C, Understanding SC 2.3.3](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions)

### Inferences
- A sensible mapping for the HUD: press acknowledgement and state-layer changes at short1-short4 (50-200 ms) with standard easing; card/panel transitions at medium (250-400 ms); reserve long (450-600 ms) for prominent, deliberate changes only. Keep ripple-style press feedback near the ~75 ms fade-in / ~200-280 ms settle range.
- For a moving car, non-essential motion should be suppressed or shortened (favor instant state swaps and opacity fades over travel/scale), aligning WCAG 2.3.3 with the "glanceable, low distraction while driving" car-UI guidance. Reserve richer motion for parked.

### Gaps
- Official m3.material.io motion page body text not auto-fetchable; duration/easing values rest on the Flutter generator and ports (which the generator cites against the spec), not a direct read of the spec page.
- No source gives a vehicle-specific maximum animation duration while driving; the driving constraint is expressed qualitatively (glanceability, distraction) plus NHTSA's glance limits in Q5.

---

## Q4. Toast/snackbar vs. inline state vs. transient highlight

### Takeaway
The consensus mapping: transient confirmations -> toast/snackbar (auto-dismiss, don't steal attention, never for blocking errors); field/control-level errors and anything that must persist or needs a decision -> inline state / banner / dialog. Snackbars auto-dismiss in a 4-10 s window; add Undo (and lengthen the timeout) when the action is reversible — which is the natural surface for the "overridden/undo" case.

### Cited Findings
- **Snackbar auto-dismiss window (Material, via faithful mirror; m3 page not auto-fetchable):** snackbars disappear automatically after a minimum of 4 s and a maximum of 10 s. — [Material snackbar spec, mirrored](https://zyun.gitbook.io/temporary-views/official/material-design/original/snackbars); [bevy_material_ui snackbar docs](https://docs.rs/crate/bevy_material_ui/latest/source/docs/components/snackbar.md)
- **Snackbars with an action (Undo) run longer:** when a snackbar offers an action like Undo, the timeout can run a little longer to leave room for interaction (no exact number given by the official-style source). A third-party reference suggests 8-10 s for actions with significant consequences (not Google spec). — [Firefox Acorn, Snackbar](https://acorn.firefox.com/latest/mobile/components/snackbar/android-pNOUdFi9)
- **Toasts/snackbars are for brief, low-stakes confirmations only; avoid for errors:** users often don't get a chance to fully read the message before it disappears; limit to short messages that confirm an action; snackbars should not carry blocking errors or actions that require a decision. — [Mirakl design system, Snackbar (secondary)](https://design.mirakl.com/~/changes/DpgERwSwrKIthStzL4D6/components/feedback/snackbar); [Actian inline toast (secondary)](https://levita99zeenea.github.io/actian-content-guidelines/inline-toast)
- **Inline validation for errors:** place the message next to the field/control where the problem occurred and explain what went wrong and how to fix it; pair with an error summary when many fields are involved. — [Jutro/Guidewire inline notification (secondary)](https://docs.guidewire.com/jutro/documentation/10.10/inline-notification)
- **Inline notifications (banner inside a section) for issues needing attention; toasts for system-level events.** Rule of thumb across systems: field-level errors go inline, transient confirmations go in toast/snackbar, anything persistent or needing a decision goes in a banner/alert/dialog. — [Actian DS notification content (secondary)](https://volivarii.github.io/actian-ds-docs/components/feedback/notification/content/)
- **Transient highlight for direct manipulation:** NN/g's 0.1 s rule treats the selection highlight itself as the feedback for direct manipulation — i.e., a transient state change on the control is the lightest-weight confirmation and needs no separate surface. — [NN/g, Response Times](https://www.nngroup.com/articles/response-times-3-important-limits/)
- **Apple HIG (model memory, unverified):** reserve alerts for must-act information; prefer inline/non-modal feedback for minor issues; confirm only destructive/irreversible actions. — [Apple HIG, Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)

### Inferences
- For the HUD override case, a transient highlight on the control (flash back to the car's value) plus a brief inline note reads as least attention-stealing and is glanceable; a snackbar with "Overridden by car — Retry/Undo" fits when the user likely wants to re-try, and should sit at the longer end (8-10 s) because it offers an action. Avoid a blocking dialog for a routine silent revert.
- Because snackbars auto-dismiss and are easy to miss while driving, a persistent inline control state (the control visibly showing the car's current value) is the more reliable source of truth; the snackbar is supplementary.

### Gaps
- Exact Material "Undo" snackbar timeout number is not published; sources give only the 4-10 s band and "run longer."
- No NN/g primary article text was retrieved for the toast-vs-inline tradeoff; it rests on multiple converging vendor design systems.

---

## Q5. Automotive-specific constraints: glance time, touch targets, driving vs. parked

### Takeaway
NHTSA's (voluntary) distraction guidelines cap a single off-road glance at ~2 s and total task time at ~12 s; Google's car-UI guidance sets a 76x76 dp minimum touch target with >=23 dp spacing, large glanceable text, and explicit hiding/dimming of features that are unsafe while moving. These bound how much feedback detail a driver can absorb per glance and argue for coarse, high-contrast, low-motion state cues while driving.

### Cited Findings
- **NHTSA glance limits (voluntary, Phase I, 2013 coverage):** cap any single off-road glance at ~2 s per task; limit total task time to ~12 s; limit unnecessary visual information in the driver's field of view and limit manual inputs; voluntary and phased in over three years. — [CS Monitor, Two-second rule](https://csmonitor.com/USA/2013/0423/A-two-second-rule-for-distracted-drivers-Automakers-asked-to-restrict-tech); [Dashboard Symbols, Two Second Rule](https://dashboardsymbols.com/2013/04/two-second-rule-distraction-guidelines-seek-to-limit-eyes-on-text/amp/)
- **Touch target (Google Android for Cars):** minimum 76x76 dp, based on driver distance from the head unit and the need for quick taps while driving; elements centered within the target, none outside its boundary; at least 23 dp between targets; width may be sacrificed for height (keeping total area) to tolerate vertical vehicle vibration. — [Google Android for Cars, Sizing](https://developers.google.com/cars/design/automotive-os/design-system/sizing?hl=it)
- **Text sizing:** primary text 32 dp (info needed for decisions, e.g., song/contact), secondary text 24 dp; Roman-alphabet strings <=120 chars (long strings force long glances); info-bearing content needs >=4.5:1 contrast. — [Google, Visual principles](https://developers.google.com/cars/design/design-foundations/visual-principles?hl=en); [Google, Sizing](https://developers.google.com/cars/design/automotive-os/design-system/sizing?hl=it)
- **Driving vs. parked:** distinguish allowed vs. disallowed features while in motion (dim distracting media); hide parked-only features while driving (example: hide the search box); clearly communicate unavailable/inaccessible options so state is understood at a glance. — [Google, Visual principles](https://developers.google.com/cars/design/design-foundations/visual-principles?hl=en)
- **Rotary input:** all navigable elements must sit at the same elevation level for rotary-dial traversal. — [Google, Sizing](https://developers.google.com/cars/design/automotive-os/design-system/sizing?hl=it)
- **Research basis for the limits:** NHTSA estimated texting takes a driver's eyes off the road ~23 s per message, motivating the glance/task caps. — [CS Monitor](https://csmonitor.com/USA/2013/0423/A-two-second-rule-for-distracted-drivers-Automakers-asked-to-restrict-tech)

### Inferences
- A state cue the driver must read while moving should be comprehensible in a single ~2 s glance: this favors a coarse, high-contrast, position/color/icon change on the control itself over text that must be read, and over motion that must be watched to be understood.
- The CLAUDE.md note that the project already gates CAN overrides while moving and greys unavailable controls with a reason aligns directly with Google's "clearly communicate unavailable options" and "hide/dim disallowed features while driving." Rich confirm/revert micro-interactions belong in the parked trial; while driving, prefer instant, static state.

### Gaps
- NHTSA figures come from 2012-2013 secondary coverage; whether the guidelines were revised since was not verified (check nhtsa.gov directly).
- Google's car-UI dp figures target Android Auto / Android Automotive head units; this app runs on Pulse at 1080x1784 px, so dp-to-px and the 76 dp figure need local adaptation (not a direct spec match).

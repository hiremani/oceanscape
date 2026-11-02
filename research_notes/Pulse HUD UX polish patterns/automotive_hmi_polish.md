# Automotive-safe UX polish and glanceability for a car center-screen / HUD

Scope note for the writer: the Pulse HUD is a portrait 1080×1784 Android app over the Fisker Ocean center screen, shown parked and while driving, with day/night themes. Throughout, I have tried to separate **while-driving** guidance (the hard constraints) from **while-parked** guidance (where polish is nearly unconstrained). Several primary standards (ISO 15008, SAE J2364/J2365) are paywalled; where I could only reach secondary sources for a specific number, I say so explicitly and the figure is flagged as unverified against the primary text.

---

## Q1 — Animation and motion on a driving display: is motion-while-moving discouraged, and the dim/blank/reposition principle?

### Takeaway
The governing principle across standards is not "no animation" but "no non-driving dynamic content that draws the eye while the vehicle is in motion." NHTSA makes this concrete with **per se lockouts** (categories disabled while driving), and Japan's JAMA guidelines state the rule directly: non-driving/entertainment visual content should be restricted or made inoperable while moving. Motion that is *salient by color, brightness and movement* is the specific hazard called out in the research.

### Cited Findings
- NHTSA's Visual-Manual Guidelines define **per se lockouts** — functions recommended to be disabled (not accessible to the driver) while driving: *displaying text to be read, manual text entry, graphical/photographic images, displaying video, dynamic maps/video, video for trailer hitching, and automatically scrolling lists and text.* — [NHTSA Guidelines (Federal Register 78 FR 24818 summary)](https://www.govinfo.gov/link/fr/78/24861); [UNT web archive copy of the Guidelines PDF](https://webarchive.library.unt.edu/web/20161031205947/http://www.distraction.gov/downloads/pdfs/visual-manual-nhtsa-driver-distraction-guidelines-for-in-vehicle-electronic-devices.pdf)
- NHTSA judged **manual text entry, reading more than 30 characters, and automatically scrolling text as per se unsafe** while driving. — [OH&S Online summary of NHTSA guidance](https://ohsonline.com/Articles/2012/02/26/New-Guidance-Lists-Unsafe-Driver-Distractions.aspx)
- **JAMA (Japan Automobile Manufacturers Association) guidelines**: "the types of information to be provided by a display system are such that the driver's attention will not be distracted from driving," entertainment content should be avoided, and "driving operation shall be inoperative by the driver while the vehicle is in motion." — [JAMA Guideline v3.0 (English)](https://www.jama.or.jp/english/news/past/release/2005/jama_guidelines_v30_en.pdf)
- **European Statement of Principles (ESoP) on in-vehicle HMI** frames the driver's primary task as "safely controlling the vehicle in a complex traffic environment," which is the stated basis for limiting distracting dynamic content. — [NHTSA-hosted Eurocomm paper](https://www-nrd.nhtsa.dot.gov/departments/Human%20Factors/driver-distraction/PDF/Eurocommpaper.PDF)
- A driving-simulator study on non-driving-related **animations in front displays** hypothesized and investigated that a **salient animation — defined by color, brightness, and movement — negatively affects visual attention**, and argues for removing high-distraction-potential animation features from the start of the design process. — [arXiv 1805.02787, "Designing Toward Minimalism in Vehicle HMI"](https://arxiv.org/pdf/1805.02787)
- An instrument-cluster design article recommends **fail-safe states for missing/invalid data** (show "unknown" rather than freeze the last reading or extrapolate) — relevant to motion because a frozen-but-still-animated gauge is a false-liveness hazard. — [engineered.at, digital instrument clusters](https://engineered.at/articles/the-problem-with-digital-instrument-clusters-and-how-to-design-a-better-one) (full text not retrievable; claim from search snippet)

### Inferences
- The "dim / blank / reposition non-safety dynamic info while driving" pattern is the design embodiment of NHTSA's per-se-lockout logic plus JAMA's "inoperative while moving" rule: anything that is decorative, entertainment, or non-driving and that moves should be stilled, dimmed, or removed when the vehicle is in motion, and restored when parked.
- For the Pulse HUD specifically: 3D world motion that *represents the driving scene* (road, lane, the car's own motion) is driving-related information and is not what these rules target; decorative transitions, animated empty-state chrome, auto-scrolling music/nav text, and ambient motion are what should be suppressed while moving.

### Gaps
- No ISO or SAE clause was found that names "animation" explicitly as a banned element; the constraint is expressed through glance-time limits (Q2) and per-se lockouts rather than a dedicated animation rule.

---

## Q2 — Glanceability numbers: legibility/contrast/type-size minimums, the ~2s glance and 12s task budgets, and the standards

### Takeaway
The anchor numbers are NHTSA's **2 s single-glance** and **12 s total-eyes-off-road** limits, the older AAM/SAE **15 s static** and **20 s total-glance** task limits, and ISO 15008 legibility minimums (character height ~**20 arc-minutes** recommended / ~**16–17 arc-min** floor and a minimum **contrast ratio ≈ 3:1**, both commonly cited but **not verifiable here against the paywalled primary text**). An ISO 15008 validation study confirms the standard's contrast minimums give ~94–98% reading accuracy in daylight.

### Cited Findings
- **NHTSA single-glance limit:** no single glance away from the road should last **2 seconds or longer**; **total eyes-off-road time (TEORT) for a task ≤ 12 seconds**. — [US DOT press release](https://www.transportation.gov/briefing-room/us-dot-releases-guidelines-minimize-vehicle-distractions); [DashboardSymbols summary](https://dashboardsymbols.com/?p=3525)
- NHTSA's three task **acceptance criteria** are **Total Eyes-Off-Road Time (TEORT), Long Glance Proportion (LGP), and Mean Single Glance duration**, benchmarked against **manual radio tuning** as the reference task; the pass test uses an **85th-percentile logic (21 of 24 participants must meet the criterion)**. — [UIowa Driving Assessment proceedings](https://pubs.lib.uiowa.edu/driving/article/28559/galley/136851/download)
- Critique to flag: many commonly accepted tasks (including manual radio tuning in some vehicles, and 4 of 9 radio-tuning tasks in one dataset) **fail** the NHTSA glance criteria, and NHTSA "did not allow for variability in its 85th-percentile estimate." — [UIowa Driving Assessment proceedings](https://pubs.lib.uiowa.edu/driving/article/28559/galley/136851/download)
- **AAM (Alliance of Automobile Manufacturers) guideline (2006)**, cited in a BMW presentation: single glance durations **should not exceed 2 seconds**, and task completion should not require **more than 20 seconds of total glance time** while the vehicle is in motion. — [ITU workshop, Keinath (BMW)](https://itu.int/en/ITU-T/Workshops-and-Seminars/its-em/201306/Documents/S4P4_Andreas_Keinath.pdf)
- **ISO 15008:2017** specifies **minimum requirements for image quality and legibility of displays containing dynamic (changeable) visual information presented to the driver of a passenger car** (mainly perceptual + basic cognitive: character legibility and colour recognition). Relevant clauses: **4.3.2 minimum contrast ratio**, **4.5.2 character height**, **4.5.3/4.5.4 width-to-height and stroke-width-to-height proportions**. — [ISO 15008:2017 catalogue](https://www.iso.org/standard/62784.html); [iTeh ToC](https://standards.iteh.ai/catalog/standards/iso/d07adfe7-f551-4557-bb09-7236d8491cf6/iso-15008-2017)
- ISO 15008 measurement method for contrast references **SAE J1757/1:2007** (vehicular display metrology), and under sunlight the contrast requirement need only be met in the direction of the critical observer position. — [ISO 15008:2009 sample text (front matter)](https://cdn.standards.iteh.ai/samples/50805/8b8f0af110d34e91985fb1e6c182abe7/ISO-15008-2009.pdf)
- **ISO 15008 validation study:** contrast ratios that drivers judged minimally acceptable were close to the ISO 15008 minimally-acceptable values; the ISO 15008 minimum contrast ratios yielded **~98% reading accuracy under overcast and ~94% under direct sunlight**; **colour difference played only a minor role** in daylight legibility. — [SAE 2011-01-0597](https://saemobilus.sae.org/content/2011-01-0597)
- ISO 15008 **current status**: 2017 edition reviewed and confirmed in 2025; a revision (ISO/CD 15008) was reported moving toward DIS in mid-2026, so a newer edition may be in progress. — [ISO 15008:2017 catalogue](https://www.iso.org/standard/62784.html)
- Status of NHTSA numbers: these are from the **2013 voluntary (non-binding) Phase 1 guidelines** for OEM-installed devices; they are recommendations, not regulation. — [US DOT press release](https://www.transportation.gov/briefing-room/us-dot-releases-guidelines-minimize-vehicle-distractions); [Automotive Fleet](https://www.automotive-fleet.com/news/dot-releases-voluntary-guidelines-for-automakers-to-limit-driver-distraction)

### Inferences
- Practical polish rule derived from the above: a driving-mode card must be readable in a single ≤2 s glance, and any task the driver can start while moving should complete within 12 s TEORT. Favor large type, high contrast, few elements per screen, and no information that requires reading long strings (>~30 chars) or scrolling while moving.
- ISO 15008's finding that colour difference matters little in daylight legibility implies **luminance contrast, not hue, is the lever** for day-mode glanceability — do not rely on color alone to separate text from background.

### Gaps
- The **exact ISO 15008 numeric values** (character height in arc-minutes; the specific minimum contrast ratio such as 3:1; stroke-width ratios) could not be verified — the primary clauses (4.3.2, 4.5.2) are behind ISO's paywall, and the free sample PDF contains only front matter up to 4.3.1. The widely-repeated figures (≈20 arc-min recommended, ≈3:1 contrast) are secondary/community claims and should be treated as approximate until checked against the purchased standard.
- **SAE J2364 (the "15-second rule" for static task completion) and J2365** did not surface a retrievable primary text; J2364's 15 s static-method limit is well known in the literature but I could not cite a primary source here.

---

## Q3 — Night / dark-mode polish: luminance, auto day/night, glare, color choices

### Takeaway
The hard night-mode problem is the inverse of day: at night the screen must not become a glare source (brightness floor and auto-dimming matter), while day legibility is limited by sunlight veiling glare. Auto day/night switching is expected by users but is a common failure point (early/late transitions, flicker). Warm/low-blue palettes and a calibrated minimum brightness are the recurring recommendations, but authoritative numeric night-luminance thresholds were thin in the sources.

### Cited Findings
- Daytime is the harder legibility case: cloud luminance up to **~20 kcd/m²** against a good automotive display max of **~500–800 cd/m²**; **veiling glare** (stray light scattered in the eye) lowers perceived contrast and matters most under bright ambient light. — [Information Display, 1997, automotive displays / ambient light](https://archive.informationdisplay.org/id-archive/1997/september/frontlinetechnologyautomotivedisplaysambientlight) (note: 25+ years old; sunlight focus, not dark mode)
- Users expect **day / night / auto** display modes; one Tesla owner noted light-gray fonts could be brighter and **contrast is weak in both modes** — a caution that dark mode can under-contrast text. — [Tesla Motors Club forum](https://teslamotorsclub.com/tmc/threads/night-mode-all-the-time.225496/)
- **Auto day/night is a frequent defect surface:** Rivian owners reported broken auto screen brightness at night (manual adjustment every drive) and Rivian shipped a fix for a driver-display icon that "incorrectly switched between day and night modes." — [InsideEVs Rivian review](https://insideevs.com/reviews/735802/rivian-r1s-infotainment-review-2024/); [Rivian 2024.07 update notes](https://rivianroamer.com/software-updates/2024-07)
- Lower-quality (likely machine-generated, treat as weak) sources repeat common practice: dark modes reduce emitted light and may ease night adaptation/eye strain; **warmer tones such as amber are chosen to cut blue-light emission**; over-aggressive dimming hurts legibility so a **brightness floor must be calibrated**; ambient-light-sensor triggering fails if poorly calibrated. — [Android Auto dark-mode how-to pages, low quality](https://mem.uandes.cl/?p=6528)

### Inferences
- For Pulse: a night theme should (a) keep a calibrated minimum brightness / avoid pure-white large fills that become glare sources, (b) preserve luminance contrast for text (the Tesla complaint shows dark mode can quietly fall below legibility), (c) drive the day/night switch from the car's own ambient/headlight state with hysteresis to avoid the flicker and mis-trigger problems Rivian hit, and (d) consider warm/low-blue accents at night. Because ISO 15008 says hue matters little for legibility, color is a comfort/glare lever, not a legibility substitute.

### Gaps
- No authoritative numeric **night-mode luminance ceiling/floor** or red/amber legibility thresholds were found in accessible sources; ISO 15008 and SAE J1757 (metrology) would hold the measurement framework but the numbers are paywalled.

---

## Q4 — Feedback timing in a driving context: how fast must a touch acknowledge, and how to confirm without a long glance?

### Takeaway
No automotive *standard* mandates a specific touch-ack latency, but the human-factors and patent literature converges on **"immediate" ≈ under 50 ms, with ~100 ms a common upper ceiling**; research points to **20–50 ms** for feedback that feels instantaneous. The driving-context twist: confirmation should be deliverable without a long glance — i.e., non-visual (haptic/audio) or peripherally-perceivable acknowledgment so the driver need not look to confirm.

### Cited Findings
- A touchscreen patent states overall latency should stay **under ~50 ms** to be perceived as immediate ("perceived as not delayed … should not fall below 50 ms reaction time"). — [USPTO 10585481, fast haptic feedback](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10585481)
- An HMI patent claims feedback emitted **within 100 ms** of control activation (narrower variant 90 ms), suggesting 100 ms is a common design ceiling. — [USPTO 10310604, HMI for a motor vehicle](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10310604)
- Research: current touch devices feature response times **between 50 and 200 ms**, with a suggested feedback window of **20–40 ms** for direct input. — [Springer chapter, touch response time](https://rd.springer.com/chapter/10.1007/978-3-319-20681-3_13)
- Automotive haptic study: **low-latency haptic feedback** made the system easy and pleasant and raised user confidence; **system latency** is a main challenge for automotive haptic touch interfaces. — [Immersion, UX Impacts of Haptic Latency in Automotive (Weddle, 2013/2021)](https://www.immersion.com/wp-content/uploads/2021/03/UX-Impacts-of-Haptic-Latency-in-Automotive_Weddle_2013.pdf)
- Microsoft Research context: ~**100 ms** is typical touch-panel latency, with a 1 ms aspiration (dated, 2012). — [The Register](https://www.theregister.com/2012/03/13/microsft_finger_latency/)

### Inferences
- Target for Pulse touch acknowledgment: aim for sub-100 ms visible ack, ideally ~50 ms; because the HUD runs on the WebView with a 3D scene competing for frame budget (per the repo's worker/main-thread split), the acknowledgment should be a cheap, immediate visual state change (button press state) decoupled from any heavier action so it never waits on the 3D frame.
- To "confirm without a long glance": prefer a brief, unambiguous state change at the point of touch (color/fill change plus, where available, the Android app's own haptic/audio) rather than a confirmation that requires reading new text — this keeps the confirmation inside the 2 s glance budget.

### Gaps
- No ISO/SAE clause with a mandated touch-feedback latency was found; the 50 ms / 100 ms figures are from patents and HCI research, not an automotive safety standard.

---

## Q5 — Graceful empty / absent / offline states on an automotive display

### Takeaway
The automotive-specific guidance is sparse but consistent: show an **explicit "unknown / not available" state rather than freezing the last reading or guessing**, keep the slot/gauge visible but marked unavailable (don't reflow or alarm), and keep any genuine safety alerts timely even when upstream data is noisy. Absence of data is a state to design, not an error to surface loudly.

### Cited Findings
- Digital instrument-cluster guidance: design **fail-safe states for missing or invalid data** — show an **"unknown" value instead of freezing the last reading or extrapolating a guess**; keep alerts timely even when upstream vehicle data is noisy or unavailable. — [engineered.at, instrument clusters](https://engineered.at/articles/the-problem-with-digital-instrument-clusters-and-how-to-design-a-better-one) (full article not retrievable; from search snippet)
- **Graceful degradation** = reduced functionality when a dependency is unavailable or a hardware limit is hit; warning that handling degradation only at the UI layer can hide backend errors. — [resilience-patterns reference](https://quizzly.ai/play/offline-mode-and-degradation-strategies)
- Component-level pattern (patent): on an error tied to a specific control, **automatically change that control's displayed state so it reads as no longer functional** rather than removing it. — [US11074122B2, graceful degradation of UI components](https://patents.google.com/patent/US11074122)
- Keep-in-place pattern: a sensor that goes offline is **dimmed in place rather than removed from the list**, so the selection/layout stays stable. — [SubZeroFramework release notes](https://github.com/TekuSP/SubZeroFramework/releases/tag/v0.1.4) (non-automotive, offered as analogy)

### Inferences
- For Pulse: this maps directly onto the repo's own existing pattern — a control that cannot send stays **greyed with a reason** rather than hidden (CLAUDE.md: `off` in `carcatalog.js`). The research endorses that choice: keep the slot, mark it unavailable calmly, don't reflow the layout, don't use alarm chrome (red/urgent styling) for the benign "comma offline" or "sensor absent" case. Reserve alarming visuals for genuine safety conditions.
- The "don't freeze the last reading" rule argues the HUD should visibly distinguish *live-but-zero* from *stale/absent* data (e.g., a dimmed/empty gauge for absent, not a held value) — important for a fusion display that merges car + comma sources and can lose one.

### Gaps
- No automotive *standard* (ISO/SAE/NHTSA) was found that prescribes empty/offline-state visual treatment specifically; the guidance here is from HMI engineering articles and general resilience/UI patterns, not safety regulation.

---

## Q6 — How real OEM center screens handle state, feedback, motion, and night mode

### Takeaway
Concrete, observed patterns: **Rivian** leans into rich scene animation for drive-mode changes (cloud/grass/tree motion) and uses Unreal Engine for its UI — praised for look but criticized for lag and too-many-taps while driving. **Tesla** is fast and minimal with day/night/auto modes but weak font contrast. **Euro NCAP (2026)** is actively pushing OEMs back toward **physical controls** for safety functions and penalizing deep touchscreen menus, which is the strongest current signal on where in-car UI is heading. MBUX/Polestar/Fisker-specific behaviors were thin in accessible sources.

### Cited Findings
- **Rivian** drive-mode changes animate the surroundings — "clouds, grass, flowers, and trees moving" — and any mode "can smoothly transition into another mode the driver chooses"; UI is built on **Unreal Engine**. — [InsideEVs](https://insideevs.com/reviews/735802/rivian-r1s-infotainment-review-2024/); [Unreal Engine spotlight](https://www.unrealengine.com/spotlights/rivian-brings-adventurous-spirit-to-new-display-ui-powered-by-unreal-engine); [The Drive](https://www.thedrive.com/news/rivians-new-cel-shaded-infotainment-update-is-cool-and-mandatory.md)
- **Rivian** criticism: owners call it "laggy and clunky, with too many taps required for even basic functions"; lag "completely ruins the entire experience"; Gen-2 consolidated ECUs (17→7) to improve UI responsiveness (2025.14). — [Torque News owner report](https://torquenews.com/17998/my-2025-r1s-great-vehicle-being-undermined-its-software-apple-music-doesnt-remember-your); [InsideEVs](https://insideevs.com/reviews/735802/rivian-r1s-infotainment-review-2024/)
- **Tesla**: automatic night display with user-selectable **day / night / auto**; described as "smartphone-quick response and intelligent menus" but "not backed up by physical controls"; owners note **weak contrast / too-light gray fonts in both modes**. — [Auto Express, Tesla UI](https://www.autoexpress.co.uk/best/car-infotainment-systems/tesla-ui); [Tesla Motors Club forum](https://teslamotorsclub.com/tmc/threads/night-mode-all-the-time.225496/)
- **Euro NCAP 2026**: to score full marks, cars will be expected to provide **physical buttons/stalks/dials for indicators, hazard lights, wipers, SOS/eCall, and the horn**; essential functions should use "direct physical input rather than be hidden within touchscreen menus." — [Carwow](https://www.carwow.co.uk/news/7490/rise-of-the-touchscreen-could-be-curbed-by-euro-ncap); [ETSC](https://etsc.eu/cars-will-need-buttons-not-just-touchscreens-to-get-a-5-star-euro-ncap-safety-rating/); [AM-Online](https://www.am-online.com/news/audi-and-kia-score-highly-as-euro-ncap-backs-physical-controls)
- Euro NCAP rationale: opening a menu to make the software do something "takes the driver's attention away from the road for longer than if using a regular button"; early grading had **Audi Q7 and Kia** keeping safety simple, while **Xpeng scored only 20%** in the driving-control category due to heavy touchscreen integration. — [Carwow](https://www.carwow.co.uk/news/7490/rise-of-the-touchscreen-could-be-curbed-by-euro-ncap); [AM-Online](https://www.am-online.com/news/audi-and-kia-score-highly-as-euro-ncap-backs-physical-controls)
- **Euro NCAP structure** (for the writer): the **Driver Engagement protocol v1.1** (Oct 2025, implementation Jan 2026) allocates **25 points** to driver monitoring split across transient driver state, long distraction, short distraction, and phone use; an assisted system must reach **≥50%** of the driving-collaboration and driver-monitoring scores to discourage over-reliance. A new **General Vehicle Controls** protocol took effect **Jan 2026**; Euro NCAP "does not prescribe specific HMI designs," aiming to prevent distraction from vehicle operation. — [Euro NCAP Driver Engagement protocol v1.1 PDF](https://www.euroncap.com/media/91704/euro-ncap-protocol-safe-driving-driver-engagement-v11.pdf); [Euro NCAP Assisted Driving protocol v1.1 PDF](https://www.euroncap.com/media/91713/euro-ncap-protocol-assisted-driving-v11.pdf)

### Inferences
- Rivian is the cautionary/aspirational twin of Pulse: a 3D/engine-driven HUD that looks great but whose lag and tap-depth hurt the driving case — reinforcing that Pulse should keep driving-mode interactions shallow, immediate, and animation-light, and reserve the rich scene motion for parked/ambient.
- Euro NCAP's physical-controls push does not bind an aftermarket center-screen app, but it is the clearest 2026 signal that **deep touchscreen menus for anything safety-adjacent are being actively graded down** — Pulse's driving mode should surface only what is glanceable and avoid burying anything the driver would reach for while moving.
- Tesla's weak-contrast complaint is a direct warning for Pulse's day *and* night themes: minimalist/low-contrast aesthetics can quietly violate legibility.

### Gaps
- **Mercedes MBUX**, **Polestar/Volvo**, and the **stock Fisker Ocean UI** specifics (their exact state-communication, feedback, motion, night-mode behaviors) did not surface in accessible sources this pass; only Tesla and Rivian returned concrete observed patterns. Teardown/review sources for MBUX and the stock Fisker UI would be a useful follow-up.
- Euro NCAP's **exact scoring of display mode-indication** (how an assisted-mode state is graded) was not found in the accessible protocol summaries; the full v1.1 Driver Engagement and General Vehicle Controls PDFs would need direct reading.

---

## Cross-cutting summary for the writer (parked vs driving)

- **While driving (hard constraints):** ≤2 s single glance, ≤12 s total task (NHTSA); no reading of long text (>~30 chars), no manual text entry, no video/auto-scrolling (NHTSA per-se lockouts); still/dim/hide non-driving motion (JAMA, arXiv minimalism); large type + high **luminance** contrast (ISO 15008; hue matters little); touch ack ~50–100 ms, confirm without a long glance (haptic/peripheral); offline/absent = calm greyed "unavailable," never alarm chrome, never a frozen reading.
- **While parked (polish is nearly free):** rich scene animation, mode-transition motion, denser info, decorative empty states, and the full day/night aesthetic are all acceptable — this is where Rivian-style richness belongs. The design task is a clean, enforced boundary between the two states driven by the car's motion signal.
- **Reliability caveat for every number above:** NHTSA figures are voluntary 2013 recommendations; ISO 15008 exact values are unverified against the paywalled primary text; feedback-latency numbers are from patents/HCI research, not a safety standard; empty-state guidance is from HMI engineering articles, not regulation.

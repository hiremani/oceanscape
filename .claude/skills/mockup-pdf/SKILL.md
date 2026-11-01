---
name: mockup-pdf
description: Make realistic UI mockups of this HUD (HTML screens at Pulse's 1080x1784 size in the app's own design language, screenshotted by headless Chrome) and turn a markdown report plus those mockups into a PDF through Chrome's print engine. Use this whenever the user asks for mockups, a design proposal, "what would option X look like", a PDF of a report or analysis, a document with screenshots for others to read, or a contact sheet to compare screens. Read it before reaching for reportlab or a markdown-to-PDF library: Chrome printing the page's own CSS is what matched the app's look, and the pitfalls below each cost a rebuild.
---

# Mockups and the PDF

Two scripts from the UX-options report are the worked example; copy and adapt them rather than starting over.

- `scripts/gen_mockups.py`: one HTML file per screen in `screens/`, built from Python helpers (`strip`, `band`,
  `bar`, `music`, `road_svg`, `minimap`, `page`) and a CSS block that mirrors `static/app.css` and
  `static/design.css` (the light theme tokens, 28 px card radius, the chip and dock styles). Portrait screens
  are 1080 x 1784, landscape 1784 x 1080.
- `scripts/shoot.sh`: screenshots every screen at its native size with headless Chrome into `shots/`.
- `scripts/build_pdf.py`: markdown (python-markdown with `tables`, `sane_lists`, `smarty`) to HTML with a cover,
  figures inserted after each option's first paragraph, balanced table columns, print CSS; then
  Chrome `--print-to-pdf`.

## The mockup rules that made them look real

- **Use the real car renders.** The ego car in the mockups is cut from screenshots of the app on the car
  (`pulse-deploy` skill, `pulse_shot.sh`), chroma-keyed to transparent with numpy (ground, road and the lane
  yellow keyed, soft shadow kept as alpha). A drawn car looks like a sketch; the real render makes the reader see
  the app. Keep the cutouts in `assets/` beside the generator.
- **Fake only the road.** An SVG perspective road with a horizon around 0.18 to 0.34 of the height, dashes and
  optionally a lead car. Drop the lead car in small windows: it clips.
- **One of each element.** Duplicated parking arcs, a clock in two strips and a wrapped assist label were the
  three things the first pass got wrong. Give the strip helper `right=()` when another element shows the time;
  `white-space: nowrap` on short labels; `flex-shrink: 0` on bars.
- **Keep the theme the app's.** Light by default; chips and cards exactly as DESIGN.md; the numbers on the
  mockups are illustrative and the report must say so.
- **Check with a contact sheet.** `pdftoppm -r 40 -png report.pdf page` then `montage` or a quick PIL grid; read
  the sheet image before declaring the PDF done. Half-empty pages and clipped figures show up at a glance.

## The PDF rules

- **Chrome prints it.** `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new
  --no-sandbox --disable-gpu --no-pdf-header-footer --print-to-pdf=out.pdf file://.../report.html`, backgrounded,
  then killed once the file exists (see `shoot.sh` for the loop). Letter size and margins come from `@page`.
- **Tables need `<colgroup>` widths.** Markdown tables print with one column squeezed to nothing. `build_pdf.py`
  keys widths by the header texts (`WIDTHS`), sets `table-layout: fixed` and `overflow-wrap: anywhere`.
- **Figures group per option.** `h3.opt { page-break-before: always }` keeps each option's figures with its
  text; portrait figures 52 mm wide, landscape 112 mm (140 mm for the one that must be read).
- **Repo-relative links become code.** A PDF cannot open `../static/js/x.js`; `fix_link` turns such citations
  into `<code class="ref">` and keeps web links.
- **The cover carries the thumbnails** of the main screens and the date, branch and sources line.
- **No reportlab.** The report mixes real screenshots, tables and the app's typography; Chrome's CSS engine
  does all three, reportlab does none well. python-markdown is the only Python dependency.

## Where things go

Mockup PNGs that the user will keep belong in `reports/<report name> mockups/`; the generator, screens and the
intermediate HTML stay in the scratchpad. The markdown report is the source; the PDF is built from it, never
edited by hand.

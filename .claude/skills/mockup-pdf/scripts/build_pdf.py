#!/usr/bin/env python3
"""Build the PDF: the research report (markdown) with the mockup screenshots in place of the ASCII sketches,
a cover, and a 'today on the car' page from real screenshots. Output: HTML next to this script; Chrome prints it."""
import os, re, html
import markdown

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = '/Users/hiremanirmss/code/projects/fisker/oceanscape'
MD = os.path.join(REPO, 'reports', 'Pulse HUD UX options.md')
SP = os.path.dirname(HERE)   # scratchpad: the real screenshots live there
src = open(MD, encoding='utf-8').read()

# ---- 1. strip the fenced ASCII sketches, remember where each option section starts ----
lines = src.split('\n')
out, infence = [], False
for ln in lines:
    if ln.startswith('```'):
        infence = not infence
        continue
    if infence:
        continue
    out.append(ln)
src = '\n'.join(out)

# ---- 2. figures per option, inserted after the option's first paragraph ----
FIGS = {
    'Option A': [('shots/A_portrait_driving.png', 'Driving (gear not P): strip, one-line band, 3D world, collapsed music, map pill, six-button bar'),
                 ('shots/A_portrait_parked.png', 'Parked (gear P): charge line, full music card, big map, camera / comma / replay on the bar'),
                 ('shots/A_landscape_parked.png', 'Landscape, parked only (Hollywood variant): 3D car with a draggable divider, charge, map, power, music')],
    'Option B': [('shots/B_portrait_drive.png', 'Drive page: the 3D world in the top 40 %, three stat rows and one action row, page selector'),
                 ('shots/B_landscape_charge.png', 'Charge page in landscape: pack figures, the Energy dialog\'s shares, owned actions greyed with the reason')],
    'Option C': [('shots/C_portrait_driving.png', 'Driving: the 2D map fills the middle, the 3D world is a draggable car-status window at the bottom third'),
                 ('shots/C_landscape_parked.png', 'Landscape, parked: the Tesla / Rivian split, 3D car status left, map right')],
    'Option D': [('shots/D_portrait_driving.png', 'Driving: stock status bar, ADAS view with the strip overlaid, active window (Home), media row, stock menu order'),
                 ('shots/D_landscape_parked.png', 'Landscape, parked (stock Hollywood: menu on the left): Charging as the active window, comma camera, energy')],
}
def figblock(items, key):
    cells = []
    for path, cap in items:
        landscape = 'landscape' in path
        cells.append(f'<figure class="{"land" if landscape else "port"}"><img src="{path}"><figcaption>{html.escape(cap)}</figcaption></figure>')
    return f'\n\n<div class="figs" data-opt="{key}">{"".join(cells)}</div>\n\n'

parts = re.split(r'(?m)^(### Option [A-D]:[^\n]*)$', src)
# parts: [before, heading, body, heading, body, ...]
rebuilt = [parts[0]]
for i in range(1, len(parts), 2):
    heading, body = parts[i], parts[i + 1]
    key = heading[4:12]   # 'Option A'
    paras = body.split('\n\n')
    # first non-empty paragraph, then the figures
    j = next(k for k, p in enumerate(paras) if p.strip())
    paras.insert(j + 1, figblock(FIGS[key], key).strip())
    rebuilt.append(heading + '\n\n' + '\n\n'.join(paras))
src = ''.join(rebuilt) if len(parts) == 1 else rebuilt[0] + ''.join(rebuilt[1:])

# ---- 3. repo-relative citations become plain code (a PDF cannot open ../paths); web links stay ----
def fix_link(m):
    text, href = m.group(1), m.group(2)
    if href.startswith('../') or href.startswith('reports/') or href.startswith('research_notes'):
        path = href.replace('../', '').split('#')[0]
        anchor = ('#' + href.split('#')[1]) if '#' in href else ''
        return f'<code class="ref">{html.escape(path)}{html.escape(anchor)}</code>'
    return m.group(0)
src = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', fix_link, src)

# ---- 4. the title becomes the cover; add a 'today' section after the summary paragraph ----
title_m = re.match(r'# (.+)\n', src)
title = title_m.group(1)
src = src[title_m.end():]
today = f'''

## Today on the car

<div class="figs"><figure class="port"><img src="../pulse4.png"><figcaption>Driving at 6 mph: the floating status card, speed-limit chip, lanes from the map road, the four-button view strip and the three-button dock. Screenshot of the app on Pulse, 2026-10-31.</figcaption></figure><figure class="port"><img src="../pulse10.png"><figcaption>Parked with a cruise-fault alert: the alert band under the status card, the new 2D mini-map at top right, the road name, the parking arcs. Same session.</figcaption></figure></div>

Both screenshots were taken with `adb screencap` from the Pulse board while the app was running in the car on 2026-10-31. They are **1080 × 1784 portrait**, which settles the first row of the open-questions table for the Android surface in Control Mode: Pulse renders portrait at 1080 × 1784, and the mockups in this document are drawn at that size. Whether the surface rotates in Hollywood Mode is still unverified. The mockups keep the app's light theme, type and card language (DESIGN.md), reuse the car renders from these screenshots, and draw the road scene schematically; the numbers on them (range, lead distance, charge rate) are illustrative.

'''
# insert the today section before the first H2
first_h2 = src.index('\n## ')
src = src[:first_h2] + today + src[first_h2:]

body = markdown.markdown(src, extensions=['tables', 'sane_lists', 'smarty'])

# ---- 5. balanced column widths: by the header texts of each table ----
WIDTHS = {
    ('Effort', 'Enhancement'): (7, 19, 30, 22, 22),
    ('Criterion (source)',): (24, 19, 19, 19, 19),
    ('Question', 'Why it matters'): (40, 30, 30),
}
def colgroup(m):
    head = m.group(0)
    ths = re.findall(r'<th>(.*?)</th>', head)
    for key, ws in WIDTHS.items():
        if ths and all(ths[i].startswith(k) for i, k in enumerate(key)):
            cg = '<colgroup>' + ''.join(f'<col style="width:{w}%">' for w in ws) + '</colgroup>'
            return head.replace('<thead>', cg + '<thead>', 1)
    return head
body = re.sub(r'<table>\s*<thead>.*?</thead>', colgroup, body, flags=re.S)
body = re.sub(r'<h3>(Option [A-D]:)', r'<h3 class="opt">\1', body)


CSS = '''
@page { size: Letter; margin: 16mm 15mm 18mm 15mm; }
html { font-size: 10.2pt; }
body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1b1d21; line-height: 1.42; }
.cover { height: 236mm; display: flex; flex-direction: column; justify-content: flex-end; page-break-after: always; border-left: 6px solid #3e6ae1; padding-left: 10mm; }
.cover h1 { font-size: 30pt; font-weight: 600; line-height: 1.15; margin: 0 0 8mm; letter-spacing: -.01em; }
.cover .sub { font-size: 13pt; color: #5b5f66; margin-bottom: 14mm; max-width: 150mm; }
.cover .meta { font-size: 9.5pt; color: #6b6f76; line-height: 1.6; }
.cover .thumbs { display: flex; gap: 6mm; margin: 0 0 14mm; }
.cover .thumbs img { height: 62mm; border-radius: 3mm; box-shadow: 0 2mm 6mm rgba(0,0,0,.12); }
h2 { font-size: 16pt; font-weight: 600; margin: 9mm 0 3mm; letter-spacing: -.01em; page-break-after: avoid; border-bottom: 1px solid #dfe2e6; padding-bottom: 1.5mm; }
h3 { font-size: 12.5pt; font-weight: 600; margin: 7mm 0 2mm; page-break-after: avoid; }
p { margin: 0 0 3mm; text-align: left; }
a { color: #3e6ae1; text-decoration: none; }
code { font-family: Menlo, Consolas, monospace; font-size: 8.3pt; background: #f1f3f6; padding: 0 2px; border-radius: 2px; }
code.ref { color: #6b6f76; background: none; font-size: 7.6pt; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 7.9pt; margin: 3mm 0 5mm; page-break-inside: auto; }
th, td { border-bottom: 1px solid #e1e4e8; padding: 1.4mm 1.8mm; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
td code { font-size: 7.3pt; }
th { background: #f4f5f7; font-weight: 600; }
tr { page-break-inside: avoid; }
.figs { display: flex; gap: 5mm; justify-content: center; align-items: flex-start; flex-wrap: wrap; margin: 4mm 0 5mm; }
figure { page-break-inside: avoid; }
h3.opt { page-break-before: always; margin-top: 0; }
figure { margin: 0; text-align: center; }
figure.port { width: 56mm; }
figure.port img { width: 56mm; border-radius: 2.5mm; box-shadow: 0 1.5mm 5mm rgba(0,0,0,.14); border: 1px solid #d9dce1; }
figure.land { width: 170mm; }
figure.land img { width: 170mm; border-radius: 2.5mm; box-shadow: 0 1.5mm 5mm rgba(0,0,0,.14); border: 1px solid #d9dce1; }
figcaption { font-size: 7.8pt; color: #5b5f66; margin-top: 1.5mm; line-height: 1.35; }
.figs[data-opt] figure.port { width: 52mm; } .figs[data-opt] figure.port img { width: 52mm; }
.figs[data-opt] figure.land { width: 112mm; } .figs[data-opt] figure.land img { width: 112mm; }
.figs[data-opt="Option A"] figure.land { width: 140mm; } .figs[data-opt="Option A"] figure.land img { width: 140mm; }
strong { font-weight: 600; }
ul, ol { margin: 0 0 3mm 6mm; }
li { margin-bottom: 1mm; }
.summary { font-size: 10.6pt; }
.footer { position: fixed; bottom: -10mm; right: 0; font-size: 8pt; color: #9a9ea5; }
'''

cover = f'''<div class="cover">
<div class="thumbs"><img src="shots/A_portrait_driving.png"><img src="shots/B_portrait_drive.png"><img src="shots/C_portrait_driving.png"><img src="shots/D_portrait_driving.png"></div>
<h1>Pulse HUD UX options</h1>
<div class="sub">{html.escape(title)}: the current experience of the Mrichchhakatikam HUD on the Fisker Ocean’s Pulse screen scored against automotive display guidance, four layouts that expose the same functions, and the enhancements the car, the comma and the map already make possible.</div>
<div class="meta">Research report with mockups · 1 November 2026 · Sources: the repository on branch <code>pulse-coexist</code> (working tree of 31 October 2026), NHTSA and Euro NCAP guidelines, manufacturer manuals, published HMI research, owner communities. Mockups are drawn at Pulse’s measured 1080 × 1784 portrait and 1784 × 1080 landscape.</div>
</div>'''

doc = f'<!doctype html><html><head><meta charset="utf-8"><title>Pulse HUD UX options</title><style>{CSS}</style></head><body>{cover}{body}</body></html>'
open(os.path.join(HERE, 'report.html'), 'w', encoding='utf-8').write(doc)
print('html written', len(doc))

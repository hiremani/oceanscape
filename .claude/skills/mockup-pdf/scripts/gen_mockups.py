#!/usr/bin/env python3
"""Mockup screens for the Pulse HUD UX options, in the app's own light design language (app.css / design.css).
Each screen is an HTML file at Pulse's real resolution (1080 x 1784 portrait; 1784 x 1080 landscape) to be
screenshotted by headless Chrome. The 3D world is faked with an SVG perspective road plus the real ego-car
renders cropped from screenshots of the app running on the car."""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'screens')
os.makedirs(OUT, exist_ok=True)

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#eceef1;--road:#dee1e5;--card:rgba(255,255,255,.92);--ink:#1b1d21;--ink2:#6b6f76;--ink3:#b4b8be;
--accent:#3e6ae1;--green:#2fa84f;--amber:#f0a020;--red:#e5413a;--line:rgba(0,0,0,.08);--ground:#f4f4f4}
html,body{width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--ink);
font-family:-apple-system,BlinkMacSystemFont,Roboto,"Segoe UI","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.screen{position:relative;overflow:hidden;background:var(--bg)}
.screen.portrait{width:1080px;height:1784px}
.screen.landscape{width:1784px;height:1080px}
.world{position:absolute;inset:0}
.world svg{position:absolute;inset:0;width:100%;height:100%}
.ego{position:absolute;pointer-events:none}
.card{position:absolute;background:var(--card);border-radius:28px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
.chip{position:absolute;background:#fff;border-radius:999px;padding:10px 22px;font:700 24px/1 sans-serif;letter-spacing:.06em;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.chip.green{color:var(--green)}.chip.amber{color:var(--amber)}.chip.grey{color:var(--ink2);font-weight:500;letter-spacing:0}
/* status strip */
.strip{position:absolute;left:0;right:0;top:0;height:96px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 32px;gap:28px}
.strip .speed{font:300 72px/1 sans-serif;letter-spacing:-.02em;min-width:110px;text-align:right}
.strip .unit{font:500 20px/1 sans-serif;color:var(--ink2);letter-spacing:.1em;margin-left:-12px;margin-top:30px}
.strip .gear{font:500 30px/1 sans-serif;letter-spacing:.3em;color:var(--ink3)}
.strip .gear b{color:var(--ink);font-weight:700}
.strip .sl{width:64px;height:64px;border-radius:50%;border:6px solid var(--red);display:flex;align-items:center;justify-content:center;font:700 28px/1 sans-serif;background:#fff}
.strip .sl.big{transform:scale(1.18)}
.strip .acc{width:64px;height:64px;border-radius:50%;border:4px solid var(--accent);display:flex;flex-direction:column;align-items:center;justify-content:center;font:600 22px/1 sans-serif;color:var(--accent)}
.strip .acc small{font:700 11px/1 sans-serif;letter-spacing:.08em;margin-top:2px}
.strip .acc.off{border-color:var(--ink3);color:var(--ink3)}
.strip .ic{width:44px;height:44px;display:flex;align-items:center;justify-content:center}
.strip .ic svg{width:40px;height:40px}
.strip .spacer{flex:1}
.strip .tt{display:flex;gap:16px;align-items:center}
.strip .right{display:flex;gap:18px;align-items:center;font:500 24px/1 sans-serif;color:var(--ink2)}
.strip .assist{font:500 24px/1 sans-serif;color:var(--accent);letter-spacing:.01em;white-space:nowrap}
.strip .assist.off{color:var(--ink3)}
.strip .pbar{flex-shrink:0;width:150px;height:6px;background:#e2e4e8;border-radius:3px;position:relative}
.strip .pbar i{position:absolute;top:-4px;width:3px;height:14px;background:var(--ink)}
/* alert / nav band */
.band{position:absolute;left:0;right:0;top:96px;height:88px;display:flex;align-items:center;gap:22px;padding:0 32px;font:500 34px/1 sans-serif;background:rgba(255,255,255,.85);border-bottom:1px solid var(--line)}
.band.alert{background:#fff8e8;color:#7a4d00}
.band.critical{background:var(--red);color:#fff;font-weight:700}
.band .dist{font-weight:700;min-width:120px}
.band .sub{color:var(--ink2);font-size:26px;margin-left:auto}
.band .arrow{width:48px;height:48px}
/* bottom bar */
.bar{position:absolute;left:0;right:0;bottom:0;height:112px;background:var(--ground);border-top:1px solid var(--line);display:flex;align-items:stretch}
.bar .b{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;font:500 18px/1 sans-serif;letter-spacing:.04em;color:#393c41;border-right:1px solid var(--line)}
.bar .b:last-child{border-right:0}
.bar .b svg{width:40px;height:40px;stroke:#393c41;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.bar .b.on{color:var(--accent)}.bar .b.on svg{stroke:var(--accent)}
.bar .b.heat{color:#e0452c}.bar .b.heat svg{stroke:#e0452c}
.bar .b.off{color:#c2c4c7}.bar .b.off svg{stroke:#c2c4c7}
.bar .b .st{font-size:15px;color:var(--ink2);letter-spacing:0}
/* music */
.music{position:absolute;display:flex;align-items:center;gap:20px;padding:14px 22px;background:var(--card);border-radius:24px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
.music img{width:76px;height:76px;border-radius:12px}
.music .t{font:600 26px/1.2 sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.music .a{font:400 22px/1.3 sans-serif;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.music .ctl{display:flex;gap:10px;margin-left:auto}
.music .ctl b{width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px}
.music .ctl b svg{width:34px;height:34px;fill:var(--ink)}
.music .prog{position:absolute;left:120px;right:24px;bottom:10px;height:5px;background:#e2e4e8;border-radius:3px}
.music .prog i{display:block;width:48%;height:100%;background:var(--accent);border-radius:3px}
.music.line{height:64px;padding:0 24px;border-radius:0;box-shadow:none;background:rgba(255,255,255,.85);border-top:1px solid var(--line)}
.music.line .t{font-size:24px}.music.line .a{font-size:22px}
.music.line .ctl b{width:56px;height:56px}
/* map pill / card */
.mapcard{position:absolute;border-radius:24px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.08);background:#fff}
.mapcard img{display:block;width:100%;height:100%;object-fit:cover}
.roadname{position:absolute;background:#fff;border-radius:999px;padding:14px 28px;font:600 30px/1 sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.08)}
/* tiles */
.tiles{position:absolute;display:grid;gap:8px}
.tile{background:#fff;border-radius:16px;border:1px solid var(--line);padding:22px 26px;display:flex;flex-direction:column;justify-content:space-between}
.tile .l{font:400 20px/1 sans-serif;color:var(--ink2);letter-spacing:.04em;text-transform:uppercase}
.tile .v{font:300 58px/1 sans-serif;letter-spacing:-.02em}
.tile .v small{font-size:26px;color:var(--ink2);margin-left:6px}
.tile .s{font:400 22px/1.3 sans-serif;color:var(--ink2)}
.tile.action{flex-direction:row;align-items:center;gap:18px}
.tile.action svg{width:44px;height:44px;stroke:#393c41;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.tile.action .v{font:500 28px/1.2 sans-serif}
.tile.action.on{background:rgba(62,106,225,.07);border-color:rgba(62,106,225,.35)}
.tile.action.on svg{stroke:var(--accent)}
.tile.action.heat svg{stroke:#e0452c}
.tile.dim{color:var(--ink3)}.tile.dim .v,.tile.dim .l,.tile.dim .s{color:var(--ink3)}
.tile .soc{height:14px;background:#e2e4e8;border-radius:7px;overflow:hidden}.tile .soc i{display:block;height:100%;width:61%;background:var(--green)}
.pages{position:absolute;display:flex;gap:40px;justify-content:center;font:500 24px/1 sans-serif;color:var(--ink2)}
.pages b{color:var(--accent);font-weight:600}
.pages span::before{content:"○ ";color:var(--ink3)}
.pages b::before{content:"● "}
/* stock-like */
.statusbar{position:absolute;left:0;right:0;top:0;height:64px;background:#1b1d21;color:#fff;display:flex;align-items:center;padding:0 32px;gap:26px;font:500 24px/1 sans-serif}
.statusbar .sp{flex:1}
.statusbar .dot{width:14px;height:14px;border-radius:50%;background:var(--green);display:inline-block;margin-right:8px}
.menu{position:absolute;background:#1b1d21;display:flex}
.menu .m{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#cfd2d7;font:500 20px/1 sans-serif;letter-spacing:.03em}
.menu .m svg{width:42px;height:42px;stroke:#cfd2d7;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.menu .m.on{color:#fff}.menu .m.on svg{stroke:#fff}
.menu .m.dim{color:#5c6066}.menu .m.dim svg{stroke:#5c6066}
.window{position:absolute;background:#fff;border-radius:20px;border:1px solid var(--line);overflow:hidden}
.window h3{font:500 28px/1 sans-serif;padding:24px 28px;border-bottom:1px solid var(--line);color:var(--ink)}
.window .row{display:flex;justify-content:space-between;align-items:center;padding:22px 28px;border-bottom:1px solid var(--line);font:400 26px/1 sans-serif}
.window .row span:last-child{color:var(--ink2)}
.window .row.dim{color:var(--ink3)}.window .row.dim span:last-child{color:var(--ink3)}
.lock{display:inline-block;width:20px;height:20px;vertical-align:-2px;margin-right:8px}
/* driver window (option C) */
.dragwin{position:absolute;background:var(--bg);border-radius:24px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.12);border:1px solid var(--line)}
.dragwin .handle{position:absolute;top:10px;left:50%;width:80px;height:8px;margin-left:-40px;border-radius:4px;background:rgba(0,0,0,.18)}
.label{position:absolute;font:500 22px/1 sans-serif;color:var(--ink2);background:rgba(255,255,255,.85);padding:8px 14px;border-radius:10px}
.charge{position:absolute;background:#fff;border-radius:24px;border:1px solid var(--line);padding:28px 32px}
.charge .big{font:300 64px/1 sans-serif}.charge .big small{font-size:28px;color:var(--ink2)}
.charge .sub{font:400 24px/1.4 sans-serif;color:var(--ink2);margin-top:10px}
.charge .soc{height:18px;background:#e2e4e8;border-radius:9px;overflow:hidden;margin-top:22px}.charge .soc i{display:block;height:100%;width:61%;background:var(--green)}
.graph{position:absolute;background:#fff;border-radius:16px;border:1px solid var(--line);padding:18px 22px}
.graph .l{font:400 20px/1 sans-serif;color:var(--ink2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px}
.divider{position:absolute;width:10px;border-radius:5px;background:rgba(0,0,0,.12)}
.side{position:absolute;display:flex;flex-direction:column;gap:12px}
.side .m{width:150px;height:118px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#cfd2d7;font:500 20px/1 sans-serif}
.side .m svg{width:42px;height:42px;stroke:#cfd2d7;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.side .m.on{color:#fff}.side .m.on svg{stroke:#fff}.side .m.dim{color:#5c6066}.side .m.dim svg{stroke:#5c6066}
.camwin{position:absolute;border-radius:24px;overflow:hidden;background:#2a2d33;box-shadow:0 6px 24px rgba(0,0,0,.2)}
.camwin .cap{position:absolute;left:0;right:0;bottom:0;padding:14px 20px;color:#fff;font:500 22px/1 sans-serif;background:linear-gradient(transparent,rgba(0,0,0,.6))}
.dock{position:absolute;display:flex;gap:16px}
.dock b{width:80px;height:80px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.08)}
.dock b svg{width:36px;height:36px;stroke:var(--ink);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.note{position:absolute;font:400 18px/1.3 sans-serif;color:var(--ink2)}
"""

# ---------- icons (stroke) ----------
I = {
 'lock': '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
 'unlock': '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
 'seat': '<svg viewBox="0 0 24 24"><path d="M7 4h7l1 8H8z"/><path d="M6 12h12l1 5H5z"/><path d="M9 3c0 2 2 2 2 4M13 3c0 2 2 2 2 4"/></svg>',
 'wheel': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6M12 15v6"/></svg>',
 'defrost': '<svg viewBox="0 0 24 24"><path d="M4 18c3 0 3-4 0-4s-3 4 0 4"/><path d="M6 6c2 2 2 4 0 6M12 4c2 2 2 4 0 6M18 6c2 2 2 4 0 6"/><path d="M4 20h16"/></svg>',
 'car': '<svg viewBox="0 0 24 24"><path d="M3 13l2-5h14l2 5v6H3z"/><circle cx="7" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/><path d="M3 13h18"/></svg>',
 'gear': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3.9a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.4a7 7 0 0 0-1.7 1l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 1.7 1l.4 2.4h5l.4-2.4a7 7 0 0 0 1.7-1l2.3.9 2-3.4-2-1.5c.1-.3.1-.7.1-1z"/></svg>',
 'cam': '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3z"/></svg>',
 'comma': '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3"/></svg>',
 'replay': '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/></svg>',
 'map': '<svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
 'music': '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
 'home': '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9H3z"/><path d="M10 20v-6h4v6"/></svg>',
 'phone': '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
 'charge': '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="15" height="10" rx="2"/><path d="M18 10h2v4h-2"/><path d="M11 9l-2 3h3l-2 3"/></svg>',
 'apps': '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg>',
 'clim': '<svg viewBox="0 0 24 24"><path d="M12 3v18M5 7l14 10M19 7L5 17"/></svg>',
 'three': '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
 'mirror': '<svg viewBox="0 0 24 24"><path d="M4 8h16v8H4z"/><path d="M12 4v16"/></svg>',
 'turnR': '<svg viewBox="0 0 24 24" fill="none" stroke="#1b1d21" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V10a4 4 0 0 1 4-4h8"/><path d="M14 2l4 4-4 4"/></svg>',
 'warn': '<svg viewBox="0 0 24 24" fill="none" stroke="#f0a020" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
 'eye': '<svg viewBox="0 0 24 24" fill="none" stroke="#e5413a" stroke-width="2.2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
 'beam': '<svg viewBox="0 0 24 24" fill="none" stroke="#2fa84f" stroke-width="2.2" stroke-linecap="round"><path d="M9 7a5 5 0 0 0 0 10h3V7z"/><path d="M15 8h6M15 12h6M15 16h6"/></svg>',
 'belt': '<svg viewBox="0 0 24 24" fill="none" stroke="#e5413a" stroke-width="2.2"><circle cx="12" cy="5" r="2.5"/><path d="M6 21l12-10M8 12l7 9"/></svg>',
 'steer': '<svg viewBox="0 0 24 24" fill="none" stroke="#3e6ae1" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M3.5 10l6 1.5M20.5 10l-6 1.5M12 14.5V21"/></svg>',
 'bolt': '<svg viewBox="0 0 24 24" fill="none" stroke="#2fa84f" stroke-width="2.2" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
 'door': '<svg viewBox="0 0 24 24" fill="none" stroke="#e5413a" stroke-width="2.2" stroke-linejoin="round"><path d="M14 3l-9 3v15h9z"/><path d="M11 12v2"/></svg>',
}
PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4l14 8-14 8z"/></svg>'
PREV = '<svg viewBox="0 0 24 24"><path d="M6 4h3v16H6zM20 4l-11 8 11 8z"/></svg>'
NEXT = '<svg viewBox="0 0 24 24"><path d="M15 4h3v16h-3zM4 4l11 8-11 8z"/></svg>'

# ---------- the 3D world, faked ----------
def road_svg(w, h, horizon=0.34, lead=True, side=True, dashes=True, tint=None):
    """A chase-camera road: two lanes going our way plus the oncoming side, a lead car, a car beside us."""
    hy = h * horizon
    cx = w / 2
    road = tint or '#dee1e5'
    bottom_half = w * 0.95
    top_half = w * 0.045
    def X(y, off):   # x at screen y for a lateral offset in road-widths (-1..1)
        t = (y - hy) / (h - hy)
        half = top_half + (bottom_half - top_half) * t ** 1.4
        return cx + off * half
    pts = []
    for off in (-1, 1):
        pass
    ys = [hy + (h - hy) * k / 24 for k in range(25)]
    left = ' '.join(f'{X(y,-1):.1f},{y:.1f}' for y in ys)
    right = ' '.join(f'{X(y,1):.1f},{y:.1f}' for y in reversed(ys))
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" preserveAspectRatio="none">']
    s.append(f'<rect width="{w}" height="{h}" fill="#eceef1"/>')
    s.append(f'<polygon points="{left} {right}" fill="{road}"/>')
    # edges
    for off in (-1, 1):
        p = ' '.join(f'{X(y,off):.1f},{y:.1f}' for y in ys)
        s.append(f'<polyline points="{p}" fill="none" stroke="#b9bdc4" stroke-width="5" stroke-linejoin="round"/>')
    # center double yellow at off=0, our lane boundary at +0.5 (we drive on the right side: lanes at 0..1)
    for off, col, wdt in ((0, '#e3b53a', 6), (-0.0, None, 0)):
        if col is None: continue
        for d in (-0.012, 0.012):
            p = ' '.join(f'{X(y,off+d):.1f},{y:.1f}' for y in ys)
            s.append(f'<polyline points="{p}" fill="none" stroke="{col}" stroke-width="{wdt}"/>')
    # lane dashes between our two lanes (off=0.5)
    if dashes:
        for k in range(0, 24, 2):
            y0, y1 = ys[k], ys[k + 1]
            s.append(f'<line x1="{X(y0,0.5):.1f}" y1="{y0:.1f}" x2="{X(y1,0.5):.1f}" y2="{y1:.1f}" stroke="#fff" stroke-width="{4 + 8*k/24:.1f}" stroke-linecap="round"/>')
    # ego lane highlight (blue structure lines like the app's L1/R1)
    for off in (0.0, 1.0):
        pass
    # ego lane outer line (right edge of our lane = off 1.0) in blue as the HMI does
    p = ' '.join(f'{X(y,1.0):.1f},{y:.1f}' for y in ys)
    s.append(f'<polyline points="{p}" fill="none" stroke="#3e6ae1" stroke-width="6" opacity=".85"/>')
    p = ' '.join(f'{X(y,0.5):.1f},{y:.1f}' for y in ys)
    s.append(f'<polyline points="{p}" fill="none" stroke="#3e6ae1" stroke-width="5" opacity=".55" stroke-dasharray="40 40"/>')
    # a lead car in our lane
    if lead:
        y = hy + (h - hy) * 0.30
        t = (y - hy) / (h - hy)
        sc = 0.10 + 0.5 * t
        cw, ch = 220 * sc * 2.2, 150 * sc * 2.2
        x = X(y, 0.75)
        s.append(f'<g transform="translate({x - cw/2:.1f},{y - ch:.1f})">'
                 f'<rect x="{cw*0.05:.1f}" y="{ch*0.1:.1f}" width="{cw*0.9:.1f}" height="{ch*0.6:.1f}" rx="{cw*0.08:.1f}" fill="#4a4e55"/>'
                 f'<rect x="{cw*0.15:.1f}" y="{ch*0.0:.1f}" width="{cw*0.7:.1f}" height="{ch*0.35:.1f}" rx="{cw*0.1:.1f}" fill="#30333a"/>'
                 f'<rect x="0" y="{ch*0.45:.1f}" width="{cw:.1f}" height="{ch*0.45:.1f}" rx="{cw*0.06:.1f}" fill="#3a3d44"/>'
                 f'<rect x="{cw*0.08:.1f}" y="{ch*0.56:.1f}" width="{cw*0.28:.1f}" height="{ch*0.08:.1f}" rx="4" fill="#e5413a"/>'
                 f'<rect x="{cw*0.64:.1f}" y="{ch*0.56:.1f}" width="{cw*0.28:.1f}" height="{ch*0.08:.1f}" rx="4" fill="#e5413a"/>'
                 f'<ellipse cx="{cw/2:.1f}" cy="{ch*0.95:.1f}" rx="{cw*0.55:.1f}" ry="{ch*0.08:.1f}" fill="rgba(0,0,0,.12)"/></g>')
    # a car in the left lane beside/ahead
    if side:
        y = hy + (h - hy) * 0.52
        t = (y - hy) / (h - hy)
        sc = 0.10 + 0.5 * t
        cw, ch = 220 * sc * 2.0, 150 * sc * 2.0
        x = X(y, 0.25)
        s.append(f'<g transform="translate({x - cw/2:.1f},{y - ch:.1f})">'
                 f'<rect x="{cw*0.05:.1f}" y="{ch*0.1:.1f}" width="{cw*0.9:.1f}" height="{ch*0.6:.1f}" rx="{cw*0.08:.1f}" fill="#7d8289"/>'
                 f'<rect x="{cw*0.15:.1f}" y="0" width="{cw*0.7:.1f}" height="{ch*0.35:.1f}" rx="{cw*0.1:.1f}" fill="#5c6067"/>'
                 f'<rect x="0" y="{ch*0.45:.1f}" width="{cw:.1f}" height="{ch*0.45:.1f}" rx="{cw*0.06:.1f}" fill="#6a6e75"/>'
                 f'<ellipse cx="{cw/2:.1f}" cy="{ch*0.95:.1f}" rx="{cw*0.55:.1f}" ry="{ch*0.08:.1f}" fill="rgba(0,0,0,.12)"/></g>')
    s.append('</svg>')
    return ''.join(s)

def ego_chase(left, top, width):
    return f'<img class="ego" src="../assets/car_chase.png" style="left:{left}px;top:{top}px;width:{width}px;filter:drop-shadow(0 18px 22px rgba(0,0,0,.18))">'

def ego_top(left, top, width):
    return f'<img class="ego" src="../assets/car_top.png" style="left:{left}px;top:{top}px;width:{width}px">'

def minimap(left, top, size, cls='mapcard'):
    return f'<div class="{cls}" style="left:{left}px;top:{top}px;width:{size}px;height:{size}px"><img src="../assets/minimap.png"></div>'

def strip(speed='42', unit='MPH', gear='D', limit='50', acc='45', assist='Steering · ACC 45', tts=('steer', 'beam'), right=('73°F', '9:41'), big=False, accoff=False):
    tt = ''.join(f'<span class="ic">{I[t]}</span>' for t in tts)
    rt = ''.join(f'<span>{r}</span>' for r in right)
    g = ''.join(f'<b>{c}</b>' if c == gear else c for c in 'PRND')
    return (f'<div class="strip"><span class="gear">{g}</span><span class="speed">{speed}</span><span class="unit">{unit}</span>'
            f'<span class="sl{" big" if big else ""}">{limit}</span>'
            f'<span class="acc{" off" if accoff else ""}">{acc}<small>MAX</small></span>'
            f'<span class="assist{" off" if accoff else ""}">{assist}</span><span class="tt">{tt}</span>'
            f'<span class="spacer"></span><span class="pbar"><i style="left:52%"></i></span><span class="right">{rt}</span></div>')

def band(kind, text, dist=None, sub=None, icon=None):
    ic = f'<span class="arrow">{icon}</span>' if icon else ''
    d = f'<span class="dist">{dist}</span>' if dist else ''
    sb = f'<span class="sub">{sub}</span>' if sub else ''
    return f'<div class="band {kind}">{ic}{d}<span>{text}</span>{sb}</div>'

def bar(items):
    """items: (icon, label, class, state)"""
    out = ['<div class="bar">']
    for ic, lb, cl, st in items:
        s = f'<span class="st">{st}</span>' if st else ''
        out.append(f'<div class="b {cl}">{I[ic]}<span>{lb}</span>{s}</div>')
    out.append('</div>')
    return ''.join(out)

def music(left, top, width, line=False):
    cls = 'music line' if line else 'music'
    ctl = f'<div class="ctl"><b>{PREV}</b><b>{PLAY}</b><b>{NEXT}</b></div>'
    if line:
        return (f'<div class="{cls}" style="left:{left}px;top:{top}px;width:{width}px"><span class="t">Tu Hi Re</span>'
                f'<span class="a">· Hariharan, Kavita Krishnamurthy</span>{ctl}</div>')
    return (f'<div class="{cls}" style="left:{left}px;top:{top}px;width:{width}px"><img src="../assets/album.png">'
            f'<div style="min-width:0;flex:1"><div class="t">Tu Hi Re (From "Bombay")</div><div class="a">Hariharan, Kavita Krishnamurthy · Bombay</div></div>{ctl}'
            f'<div class="prog"><i></i></div></div>')

def page(name, body, orient='portrait'):
    html = f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body><div class="screen {orient}">{body}</div></body></html>'
    with open(os.path.join(OUT, name + '.html'), 'w') as f:
        f.write(html)

W, H = 1080, 1784
LW, LH = 1784, 1080

# ---------- TODAY (reference, drawn in the same style for comparison is the real screenshot; skip) ----------

# ---------- OPTION A: Glance Strip ----------
def A_driving():
    b = [f'<div class="world">{road_svg(W, H - 112, horizon=0.30)}</div>', ego_chase(160, 1040, 760)]
    b.append(strip(big=False))
    b.append(band('', 'Turn right onto W Pico Blvd', dist='0.3 mi', sub='Main St · A12', icon=I['turnR']))
    b.append(minimap(W - 32 - 130, H - 112 - 64 - 24 - 130, 130))
    b.append(f'<div class="label" style="left:32px;top:{H-112-64-24-40}px">Lead 34 m · 1.8 s</div>')
    b.append(music(0, H - 112 - 64, W, line=True))
    b.append(bar([('lock', 'LOCK', 'on', 'locked'), ('seat', 'SEAT', 'heat', 'hi'), ('wheel', 'WHEEL', '', 'off'),
                  ('defrost', 'DEFROST', '', 'off'), ('car', 'CAR', '', ''), ('gear', 'SETTINGS', '', '')]))
    page('A_portrait_driving', ''.join(b))

def A_parked():
    b = [f'<div class="world"><svg viewBox="0 0 {W} {H}"><rect width="{W}" height="{H}" fill="#eceef1"/></svg></div>']
    b.append(ego_top(W / 2 - 130, 560, 260))
    # parking arcs like the app
    b.append(f'<svg class="ego" style="left:{W/2-260}px;top:500px" width="520" height="620" viewBox="0 0 520 620"><path d="M150 70 A 180 180 0 0 1 300 40" fill="none" stroke="#f0c020" stroke-width="16" stroke-linecap="round" opacity=".9"/><path d="M80 150 A 200 200 0 0 1 130 90" fill="none" stroke="#f0a020" stroke-width="16" stroke-linecap="round"/><path d="M470 300 L470 380" stroke="#f0d040" stroke-width="16" stroke-linecap="round"/></svg>')
    b.append(strip(speed='0', gear='P', limit='–', acc='–', assist='ACC off', tts=('door', 'belt'), right=('73°F', '9:41'), accoff=True))
    b.append(band('', 'Charging 7.4 kW · 61 % · 187 mi · 1 h 40 left', icon=I['bolt']))
    b.append(f'<div class="label" style="left:32px;top:{200}px;background:none;font-size:24px">Rear left door open</div>')
    b.append(minimap(W - 32 - 320, 960, 320))
    b.append(f'<div class="roadname" style="left:32px;top:{H-112-150-40-56}px">Gatewood Street</div>')
    b.append(music(32, H - 112 - 150, W - 64))
    b.append(bar([('lock', 'LOCK', 'on', 'locked'), ('seat', 'SEAT', 'heat', 'hi'), ('cam', 'CAMERA', '', ''),
                  ('comma', 'COMMA', '', 'live'), ('replay', 'REPLAY', '', ''), ('car', 'CAR', '', ''), ('gear', 'SETTINGS', '', '')]))
    page('A_portrait_parked', ''.join(b))

def A_landscape():
    b = [f'<div class="world"><svg viewBox="0 0 {LW} {LH}"><rect width="{LW}" height="{LH}" fill="#eceef1"/></svg></div>']
    # left: 3D car; right column: charge, map, music
    b.append(ego_chase(140, 300, 800))
    b.append(strip(speed='0', gear='P', limit='–', acc='–', assist='ACC off', tts=('belt',), right=('comma · live', '12 V 12.6 V', '73°F', '9:41'), accoff=True))
    b.append(f'<div class="divider" style="left:1086px;top:140px;height:{LH-112-180}px"></div>')
    b.append(f'<div class="charge" style="left:1130px;top:130px;width:620px"><div class="big">7.4 <small>kW</small></div><div class="sub">61 % · 187 mi · 1 h 40 to 80 %</div><div class="soc"><i></i></div></div>')
    b.append(minimap(1130, 400, 300))
    b.append(f'<div class="graph" style="left:1450px;top:400px;width:300px;height:300px"><div class="l">Power · 10 min</div><svg viewBox="0 0 260 200" width="256" height="220"><polyline points="0,120 30,100 60,130 90,60 120,80 150,40 180,90 210,70 240,110 260,100" fill="none" stroke="#3e6ae1" stroke-width="4"/><line x1="0" y1="120" x2="260" y2="120" stroke="#c9ccd1" stroke-dasharray="6 6"/><text x="4" y="195" font-size="18" fill="#6b6f76">drive 71 % · climate 18 %</text></svg></div>')
    b.append(music(1130, 730, 620))
    b.append(bar([('lock', 'LOCK', 'on', 'locked'), ('seat', 'SEAT', '', 'off'), ('cam', 'CAMERA', '', ''), ('comma', 'COMMA', '', 'live'),
                  ('replay', 'REPLAY', '', ''), ('car', 'CAR', '', ''), ('gear', 'SETTINGS', '', '')]))
    b.append(f'<div class="label" style="left:32px;top:{LH-112-50}px">Drag the divider to resize, as Tesla does</div>')
    page('A_landscape_parked', ''.join(b), 'landscape')

# ---------- OPTION B: Tile Dash ----------
def B_drive():
    top_h = int(H * 0.40)
    b = [f'<div class="world" style="height:{top_h}px">{road_svg(W, top_h, horizon=0.30, side=False)}</div>']
    b.append(ego_chase(290, top_h - 360, 500))
    b.append(strip())
    grid_top = top_h + 8
    tiles = [
        ('Range', '187<small>mi</small>', '61 % · valid', ''),
        ('Power', '< 12<small>kW</small>', 'regen limit 80 %', ''),
        ('Lead', '34<small>m</small>', '1.8 s · closing 2 mph', ''),
        ('State of charge', '61<small>%</small>', '<div class="soc"><i></i></div>', ''),
        ('Outside', '54<small>°F</small>', 'road grade +2 %', ''),
        ('Trip', '23.4<small>mi</small>', '3.1 mi/kWh', ''),
    ]
    t = [f'<div class="tiles" style="left:32px;top:{grid_top}px;width:{W-64}px;grid-template-columns:repeat(3,1fr);grid-auto-rows:220px">']
    for l, v, s, c in tiles:
        t.append(f'<div class="tile {c}"><div class="l">{l}</div><div class="v">{v}</div><div class="s">{s}</div></div>')
    t.append(f'<div class="tile action heat">{I["seat"]}<div><div class="v">Seat heat</div><div class="s">High</div></div></div>')
    t.append(f'<div class="tile action">{I["defrost"]}<div><div class="v">Defrost</div><div class="s">Off</div></div></div>')
    t.append(f'<div class="tile action on">{I["lock"]}<div><div class="v">Locked</div><div class="s">Tap to unlock</div></div></div>')
    t.append('</div>')
    b.append(''.join(t))
    b.append(f'<div class="pages" style="left:0;right:0;top:{grid_top + 3*228 + 30}px"><b>Drive</b><span>Assist</span><span>Charge</span><span>Park</span></div>')
    b.append(f'<div class="note" style="left:32px;top:{grid_top + 3*228 + 90}px;width:{W-64}px">Pages switch with the car\'s state (Drive / Assist / Charge / Park); every page stays tappable and says why it is not current.</div>')
    b.append(bar([('car', 'CAR', '', ''), ('map', 'MAP', '', ''), ('music', 'MUSIC', '', ''), ('comma', 'COMMA', '', 'live'), ('gear', 'SETTINGS', '', '')]))
    page('B_portrait_drive', ''.join(b))

def B_charge_landscape():
    b = [f'<div class="world"><svg viewBox="0 0 {LW} {LH}"><rect width="{LW}" height="{LH}" fill="#eceef1"/></svg></div>']
    b.append(ego_top(260, 300, 300))
    b.append(f'<div class="label" style="left:420px;top:560px">Charge port open</div>')
    b.append(strip(speed='0', gear='P', limit='–', acc='–', assist='Plugged in · 7.4 kW · 1 h 40 left', tts=(), right=('73°F', '9:41'), accoff=True))
    t = [f'<div class="tiles" style="left:720px;top:120px;width:{LW-752}px;grid-template-columns:repeat(4,1fr);grid-auto-rows:200px">']
    for l, v, s, c in [('SoC', '61<small>%</small>', '187 mi · to 80 % in 1 h 40', ''), ('Pack', '398<small>V</small>', '19 A · 7.4 kW', ''),
                       ('12 V battery', '12.6<small>V</small>', 'SoH 94 % · needs gen_ibus', 'dim'), ('Cell temp', '21–24<small>°C</small>', 'needs gen_ibus', 'dim')]:
        t.append(f'<div class="tile {c}"><div class="l">{l}</div><div class="v">{v}</div><div class="s">{s}</div></div>')
    t.append('</div>')
    b.append(''.join(t))
    b.append(f'<div class="graph" style="left:720px;top:540px;width:{LW-752}px;height:260px"><div class="l">Energy shares · 10 min (from the Energy dialog)</div>'
             f'<svg viewBox="0 0 1000 170" width="{LW-800}" height="170"><polyline points="0,120 60,100 120,130 180,60 240,80 300,40 360,90 420,70 480,110 540,100 600,60 660,90 720,80 780,50 840,70 900,60 960,90 1000,80" fill="none" stroke="#3e6ae1" stroke-width="4"/>'
             f'<polyline points="0,150 200,145 400,150 600,140 800,148 1000,145" fill="none" stroke="#e0452c" stroke-width="3"/><text x="4" y="24" font-size="20" fill="#6b6f76">drive 71 % · climate 18 % · aux 11 %</text></svg></div>')
    t2 = [f'<div class="tiles" style="left:720px;top:820px;width:{LW-752}px;grid-template-columns:repeat(3,1fr);grid-auto-rows:110px">']
    t2.append(f'<div class="tile action dim">{I["charge"]}<div><div class="v">Limit 80 %</div><div class="s">Head unit owns this</div></div></div>')
    t2.append(f'<div class="tile action dim">{I["bolt"]}<div><div class="v">Stop charging</div><div class="s">Head unit owns this</div></div></div>')
    t2.append(f'<div class="tile action">{I["comma"]}<div><div class="v">Comma</div><div class="s">live · 41 °C</div></div></div>')
    t2.append('</div>')
    b.append(''.join(t2))
    b.append(f'<div class="pages" style="left:32px;right:auto;top:{LH-112-60}px;width:650px"><span>Drive</span><span>Assist</span><b>Charge</b><span>Park</span></div>')
    b.append(bar([('car', 'CAR', '', ''), ('map', 'MAP', '', ''), ('music', 'MUSIC', '', ''), ('comma', 'COMMA', '', 'live'), ('gear', 'SETTINGS', '', '')]))
    page('B_landscape_charge', ''.join(b), 'landscape')

# ---------- OPTION C: Map Centre ----------
def big_map_svg(w, h, heading_up=True):
    # a street grid with the matched road ahead, signals, a limit-ahead label
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">', f'<rect width="{w}" height="{h}" fill="#eceef1"/>']
    import random
    rnd = random.Random(7)
    for x in range(-200, w + 400, 190):
        s.append(f'<line x1="{x}" y1="0" x2="{x-180}" y2="{h}" stroke="#fff" stroke-width="18"/>')
    for y in range(-100, h + 300, 210):
        s.append(f'<line x1="0" y1="{y}" x2="{w}" y2="{y-160}" stroke="#fff" stroke-width="14"/>')
    # our road: vertical-ish through the car
    cx = w / 2
    s.append(f'<path d="M{cx} {h} L{cx} {h*0.45} Q{cx} {h*0.3} {cx+180} {h*0.22} L{w} {h*0.1}" fill="none" stroke="#fff" stroke-width="34"/>')
    s.append(f'<path d="M{cx} {h} L{cx} {h*0.45} Q{cx} {h*0.3} {cx+180} {h*0.22} L{w} {h*0.1}" fill="none" stroke="#3e6ae1" stroke-width="10" opacity=".85"/>')
    # signals
    for (x, y) in ((cx, h * 0.45), (cx - 180 + 10, h * 0.62)):
        s.append(f'<circle cx="{x}" cy="{y}" r="14" fill="#2fa84f" stroke="#fff" stroke-width="4"/>')
    # car
    cy = h * 0.72
    s.append(f'<path d="M{cx} {cy-34} L{cx+26} {cy+26} L{cx} {cy+12} L{cx-26} {cy+26} Z" fill="#3e6ae1" stroke="#fff" stroke-width="4"/>')
    # labels
    s.append(f'<text x="{cx+30}" y="{h*0.58}" font-size="30" font-weight="600" fill="#1b1d21" transform="rotate(-90 {cx+30} {h*0.58})">Main St</text>')
    s.append(f'<text x="{w*0.12}" y="{h*0.36}" font-size="28" font-weight="600" fill="#1b1d21" transform="rotate(-40 {w*0.12} {h*0.36})">W Pico Blvd</text>')
    s.append(f'<g transform="translate({cx+40},{h*0.40})"><rect x="0" y="0" width="190" height="70" rx="14" fill="#fff" stroke="#e5413a" stroke-width="4"/><text x="18" y="48" font-size="34" font-weight="700" fill="#1b1d21">35</text><text x="70" y="46" font-size="24" fill="#6b6f76">in 400 m</text></g>')
    s.append('</svg>')
    return ''.join(s)

def C_driving():
    win_h = int((H - 112 - 184) / 3)
    map_top, map_h = 184, H - 112 - 184 - win_h
    b = [f'<div class="world" style="top:{map_top}px;height:{map_h}px">{big_map_svg(W, map_h)}</div>']
    b.append(strip())
    b.append(band('', 'Main St', dist='0.3 mi', sub='ETA 4:12 · 35 mph ahead', icon=I['turnR']))
    # the car-status window at the bottom third
    wt = map_top + map_h
    b.append(f'<div class="dragwin" style="left:0;top:{wt}px;width:{W}px;height:{win_h}px">{road_svg(W, win_h, horizon=0.18, lead=False, side=False)}'
             + ego_chase(290, win_h - 360, 500) + '<div class="handle"></div>'
             f'<div class="label" style="right:24px;top:28px">lane 2 of 2 · lead 34 m · 1.8 s</div></div>')
    b.append(f'<div class="label" style="left:24px;top:{map_top+16}px">heading up · GPS 9 sat · 1.2 m</div>')
    b.append(bar([('lock', 'LOCK', 'on', 'locked'), ('seat', 'SEAT', 'heat', 'hi'), ('defrost', 'DEFROST', '', 'off'),
                  ('car', 'CAR', '', ''), ('three', '3D VIEW', '', ''), ('gear', 'SETTINGS', '', '')]))
    page('C_portrait_driving', ''.join(b))

def C_landscape():
    b = [f'<div class="world"><svg viewBox="0 0 {LW} {LH}"><rect width="{LW}" height="{LH}" fill="#eceef1"/></svg></div>']
    b.append(strip(speed='0', gear='P', limit='–', acc='–', assist='ACC off', tts=(), right=('73°F', '9:41'), accoff=True))
    b.append(f'<div class="dragwin" style="left:0;top:96px;width:600px;height:{LH-96-112}px;border-radius:0"><div class="world"><svg viewBox="0 0 600 {LH-208}"><rect width="600" height="{LH-208}" fill="#eceef1"/></svg></div>'
             + ego_top(150, 200, 300) + f'<div class="label" style="left:24px;top:24px">3D car status · doors, windows, port</div></div>')
    b.append(f'<div class="world" style="left:600px;top:96px;width:{LW-600}px;height:{LH-208}px">{big_map_svg(LW-600, LH-208)}</div>')
    b.append(f'<div class="label" style="left:624px;top:120px">north up · prefetch 25 km · 83 % · GPS 9 sat</div>')
    b.append(f'<div class="divider" style="left:595px;top:140px;height:{LH-112-180}px"></div>')
    b.append(bar([('lock', 'LOCK', 'on', 'locked'), ('seat', 'SEAT', '', 'off'), ('cam', 'CAMERA', '', ''), ('comma', 'COMMA', '', 'live'), ('car', 'CAR', '', ''), ('gear', 'SETTINGS', '', '')]))
    page('C_landscape_parked', ''.join(b), 'landscape')

# ---------- OPTION D: Ocean Native ----------
def D_driving():
    b = ['<div class="statusbar"><span><span class="dot"></span>Mallikarjun</span><span>Mrichchhakatikam</span><span class="sp"></span><span>comma · live</span><span>73°F</span><span>9:41</span></div>']
    adas_top, adas_h = 64, 760
    b.append(f'<div class="world" style="top:{adas_top}px;height:{adas_h}px">{road_svg(W, adas_h, horizon=0.34, side=False)}</div>')
    b.append(ego_chase(270, adas_top + adas_h - 400, 540))
    b.append(strip(right=()).replace('class="strip"', f'class="strip" style="top:{adas_top}px;background:rgba(255,255,255,.85)"'))
    b.append(f'<div class="label" style="left:24px;top:{adas_top+adas_h-50}px">ADAS view</div>')
    wt = adas_top + adas_h + 16
    b.append(f'<div class="window" style="left:24px;top:{wt}px;width:{W-48}px;height:560px"><h3>Home</h3>'
             f'<div class="row"><span>Range</span><span>187 mi · 61 %</span></div><div class="row"><span>Power</span><span>&lt; 12 kW · regen limit 80 %</span></div>'
             f'<div class="row"><span>Lead</span><span>34 m · 1.8 s</span></div><div class="row"><span>Trip</span><span>23.4 mi · 3.1 mi/kWh</span></div>'
             f'<div class="row dim"><span>{I["lock"].replace("<svg", "<svg class=lock")}Charging schedule</span><span>Head unit owns this</span></div></div>')
    b.append(music(24, wt + 580, W - 48))
    m = [f'<div class="menu" style="left:0;right:0;bottom:0;height:135px">']
    for ic, lb, cl in [('home', 'Home', 'on'), ('map', 'Maps', ''), ('music', 'Music', ''), ('phone', 'Phone', 'dim'), ('charge', 'Charging', ''), ('apps', 'Apps', 'dim'), ('clim', 'Climate', ''), ('gear', 'Settings', '')]:
        m.append(f'<div class="m {cl}">{I[ic]}<span>{lb}</span></div>')
    m.append('</div>')
    b.append(''.join(m))
    page('D_portrait_driving', ''.join(b))

def D_landscape():
    b = ['<div class="statusbar" style="left:150px"><span><span class="dot"></span>Mallikarjun</span><span class="sp"></span><span>comma · live</span><span>73°F</span><span>9:41</span></div>']
    b.append(f'<div style="position:absolute;left:0;top:0;width:150px;height:{LH}px;background:#1b1d21"></div>')
    m = ['<div class="side" style="left:0;top:40px">']
    for ic, lb, cl in [('home', 'Home', ''), ('map', 'Maps', ''), ('music', 'Music', ''), ('phone', 'Phone', 'dim'), ('charge', 'Charging', 'on'), ('apps', 'Apps', 'dim'), ('clim', 'Climate', ''), ('gear', 'Settings', '')]:
        m.append(f'<div class="m {cl}">{I[ic]}<span>{lb}</span></div>')
    m.append('</div>')
    b.append(''.join(m))
    # active window: energy / camera (video, Park only)
    b.append(f'<div class="window" style="left:174px;top:88px;width:1000px;height:{LH-88-24-160}px"><h3>Charging</h3>'
             f'<div class="row"><span>Plugged in</span><span>7.4 kW · 398 V · 19 A</span></div><div class="row"><span>State of charge</span><span>61 % · 187 mi</span></div>'
             f'<div class="row"><span>Time to 80 %</span><span>1 h 40</span></div><div class="row dim"><span>Charge limit</span><span>Head unit owns this</span></div>'
             f'<div class="row dim"><span>12 V battery</span><span>needs gen_ibus re-run</span></div></div>')
    b.append(f'<div class="camwin" style="left:1198px;top:88px;width:562px;height:316px"><svg viewBox="0 0 562 316" width="562" height="316"><rect width="562" height="316" fill="#30343b"/><polygon points="0,316 230,120 332,120 562,316" fill="#4a4f57"/><line x1="281" y1="120" x2="281" y2="316" stroke="#fff" stroke-width="3" stroke-dasharray="14 14"/><rect x="0" y="0" width="562" height="120" fill="#5c6675"/></svg><div class="cap">Comma camera · road · Park only</div></div>')
    b.append(f'<div class="window" style="left:1198px;top:428px;width:562px;height:{LH-428-24-160}px"><h3>Energy · 10 min</h3><svg viewBox="0 0 520 220" width="520" height="220" style="padding:10px"><polyline points="0,120 60,100 120,130 180,60 240,80 300,40 360,90 420,70 480,110 520,100" fill="none" stroke="#3e6ae1" stroke-width="4"/><text x="4" y="200" font-size="22" fill="#6b6f76">drive 71 % · climate 18 % · aux 11 %</text></svg></div>')
    b.append(music(174, LH - 24 - 130, LW - 174 - 24))
    page('D_landscape_parked', ''.join(b), 'landscape')

if __name__ == '__main__':
    for f in (A_driving, A_parked, A_landscape, B_drive, B_charge_landscape, C_driving, C_landscape, D_driving, D_landscape):
        f()
    print('wrote', sorted(os.listdir(OUT)))

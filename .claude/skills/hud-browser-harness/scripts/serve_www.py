#!/usr/bin/env python3
"""serve_www.py <www dir> [port]: a static server for the harness (default port 18093).

Serves the page's files from <www dir> (make_www.sh builds it), plus /slow?ms=N: a 1x1 PNG that answers after
N ms. set.html loads it as an <img>, so the harness page's load event, and with it headless Chrome's
--screenshot, waits that long in real time while the worker decodes the synthetic frames. Chrome's own
--virtual-time-budget is no substitute: it leaves the page's timers stale and the data never arrives.
/map/* and /api/* answer 404, as a plain browser without a comma would see."""
import http.server, os, sys, time, urllib.parse

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 18093
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ff9f0100020001de2a7d2a0000000049454e44ae426082')


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path.startswith('/slow'):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            time.sleep(int(q.get('ms', ['5000'])[0]) / 1000)
            self.send_response(200); self.send_header('Content-Type', 'image/png'); self.send_header('Content-Length', str(len(PNG))); self.end_headers()
            self.wfile.write(PNG); return
        if self.path.startswith('/map/') or self.path.startswith('/api/'):
            self.send_response(404); self.end_headers(); return
        super().do_GET()


print(f'serving {ROOT} at http://127.0.0.1:{PORT}', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()

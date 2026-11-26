#!/usr/bin/env python3
"""
Oceanscape dev server: serves the HUD page from this checkout the way the Android app's LocalServer
does on the car, and relays the comma bridge's endpoints to a sunnypilot device.

  python3 serve.py                              # http://localhost:18088, the page alone (it shows "offline")
  python3 serve.py --bridge sunnypilot.local    # relay /api, /ws and /map to the comma (port 8088)
  python3 serve.py --bridge 127.0.0.1:8088      # a bridge on this PC: python -m openpilot.sunnypilot.webhud.server --replay ...
  python3 serve.py ... --npu-synth              # serve /npu (the NPU detector, static/js/npu.js) from tools/npu_synth.py
  python3 serve.py ... --npu-relay HOST:PORT    # ...or relay /npu and /npu/status to an app's LocalServer (e.g. adb forward)
  python3 serve.py ... --npu-replay FILE.jsonl  # ...or serve recorded detections in step with a replay (tools/npu_replay.py)

/map/buildings/<klat>/<klon> (static/js/buildings.js) is answered here, not relayed: the cell's buildings from the
Overpass API, fetched once (one request at a time) and kept under ~/.cache/oceanscape/buildings, as the app's
MapFeatures.kt does on the car. The comma's own server has no buildings.

URL roots match the app and the bridge: "/" the page (static/), /vendor/ three.js, /models/ the Ocean model,
/dbc/ the DBCs; unknown paths fall back to index.html so deep links work. A relayed request is forwarded
byte for byte after its head, one request per connection, so the WebSocket upgrade passes unchanged.
Stdlib only.
"""
import argparse
import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC_ROOTS = {   # URL prefix -> directory ("" = the page itself; checked in order)
  "vendor/": os.path.join(ROOT, "third_party", "three"),
  "models/": os.path.join(ROOT, "third_party", "models"),
  "dbc/": os.path.join(ROOT, "dbc"),
  "": os.path.join(ROOT, "static"),
}
DEFAULT_PORT = 18088          # the Android app's local port, so the page's origin matches the car's
BRIDGE_PORT = 8088            # the comma bridge
BRIDGE: tuple[str, int] | None = None
NPU_RELAY: tuple[str, int] | None = None   # --npu-relay: where /npu goes
NPU_SYNTH = None                          # --npu-synth: tools/npu_synth.py's Synth
NPU_REPLAY = None                         # --npu-replay: tools/npu_replay.py's Recorded


def relayed(path: str) -> bool:
  return path in ("/ws", "/video") or (path.startswith(("/api/", "/map/")) and not path.startswith("/map/buildings/"))


# ---- buildings (static/js/buildgeom.js BLD_DEG cells, from Overpass, kept on disk) ----------------------------------
BLD_DEG = 0.01
BLD_DIR = os.path.join(os.path.expanduser("~"), ".cache", "oceanscape", "buildings")
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
BLD_RETRY_S = 60
_bld_lock = threading.Lock()
_bld_failed: dict[str, float] = {}


def building_cell(klat: int, klon: int) -> bytes | None:
  """The cell's Overpass answer (JSON bytes), fetched once and kept; None when it can't be had."""
  if not (-9000 <= klat < 9000 and -18000 <= klon < 18000):
    return None
  path = os.path.join(BLD_DIR, f"{klat}_{klon}.json")
  if os.path.isfile(path):
    with open(path, "rb") as f:
      return f.read()
  key = f"{klat},{klon}"
  with _bld_lock:   # one Overpass request at a time
    if os.path.isfile(path):
      with open(path, "rb") as f:
        return f.read()
    if time.time() - _bld_failed.get(key, 0) < BLD_RETRY_S:
      return None
    s, w = klat * BLD_DEG, klon * BLD_DEG
    bb = f"{s:.4f},{w:.4f},{s + BLD_DEG:.4f},{w + BLD_DEG:.4f}"
    query = f'[out:json][timeout:90];(way["building"]({bb});relation["building"]["type"="multipolygon"]({bb}););out tags geom qt;'
    req = urllib.request.Request(OVERPASS_URL, data=urllib.parse.urlencode({"data": query}).encode(),
                                 headers={"User-Agent": "oceanscape-dev/1.0 (map buildings)", "Accept": "application/json"})
    for attempt in range(3):
      try:
        with urllib.request.urlopen(req, timeout=150) as r:
          body = r.read()
        break
      except urllib.error.HTTPError as e:
        if e.code not in (429, 502, 503, 504) or attempt == 2:
          _bld_failed[key] = time.time()
          return None
        time.sleep(3)
      except OSError:
        _bld_failed[key] = time.time()
        return None
    os.makedirs(BLD_DIR, exist_ok=True)
    with open(path + ".part", "wb") as f:
      f.write(body)
    os.replace(path + ".part", path)
    return body


def pump(src: socket.socket, dst: socket.socket) -> None:
  try:
    while True:
      data = src.recv(65536)
      if not data:
        break
      dst.sendall(data)
  except OSError:
    pass
  finally:
    for s in (src, dst):
      try:
        s.shutdown(socket.SHUT_RDWR)
      except OSError:
        pass


class Handler(SimpleHTTPRequestHandler):
  protocol_version = "HTTP/1.1"
  rbufsize = 0   # unbuffered: bytes after the request head (a WebSocket's first frames) must reach the relay
  extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript",
                    ".glb": "model/gltf-binary", ".dbc": "text/plain", ".json": "application/json", ".webmanifest": "application/json"}

  def translate_path(self, path: str) -> str:
    rel = unquote(urlparse(path).path).lstrip("/") or "index.html"
    prefix = next(p for p in STATIC_ROOTS if rel.startswith(p))
    root = os.path.realpath(STATIC_ROOTS[prefix])
    full = os.path.realpath(os.path.join(root, rel[len(prefix):]))
    if not full.startswith(root + os.sep) or not os.path.isfile(full):
      return os.path.join(STATIC_ROOTS[""], "index.html")   # deep links (and traversal attempts) get the app shell
    return full

  def end_headers(self) -> None:
    self.send_header("Cache-Control", "no-cache")   # a dev server: always revalidate (Last-Modified is sent)
    super().end_headers()

  def do_GET(self) -> None:
    path = urlparse(self.path).path
    if path == "/npu" or path.startswith("/npu/"):
      return self.npu(path)
    if path.startswith("/map/buildings/"):
      return self.buildings(path)
    if relayed(path):
      return self.relay()
    super().do_GET()

  # ---- the NPU detector (static/js/npu.js): synthetic, relayed to an app, or not here --------------------------
  def npu(self, path: str) -> None:
    if NPU_RELAY is not None:
      return self.relay(NPU_RELAY)
    if NPU_REPLAY is not None:
      import npu_replay
      if path == "/npu" and self.headers.get("Upgrade", "").lower() == "websocket":
        return npu_replay.serve_ws(self, NPU_REPLAY)
      if path == "/npu/status":
        return self._json(NPU_REPLAY.status())
      return self.send_error(404)
    if NPU_SYNTH is None:
      return self.send_error(404, "no NPU detector: start with --npu-synth, --npu-replay or --npu-relay")
    import npu_synth
    if path == "/npu" and self.headers.get("Upgrade", "").lower() == "websocket":
      return npu_synth.serve_ws(self, NPU_SYNTH)
    if path == "/npu/status":
      return self._json(NPU_SYNTH.status())
    if path == "/npu/scene":
      if self.command == "POST":
        n = int(self.headers.get("Content-Length", "0") or 0)
        try:
          NPU_SYNTH.set_scene(json.loads(self.rfile.read(n) or b"[]"))
        except ValueError:
          return self.send_error(400, "expected a JSON list")
      return self._json(NPU_SYNTH.get_scene())
    return self.send_error(404)

  def _json(self, obj) -> None:
    body = json.dumps(obj).encode()
    self.send_response(200)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def buildings(self, path: str) -> None:
    m = re.fullmatch(r"/map/buildings/(-?\d+)/(-?\d+)", path)
    body = building_cell(int(m.group(1)), int(m.group(2))) if m else None
    if body is None:
      return self.send_error(404, "no buildings for this cell")
    self.send_response(200)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def do_HEAD(self) -> None:
    if relayed(urlparse(self.path).path):
      return self.relay()
    super().do_HEAD()

  def do_POST(self) -> None:
    path = urlparse(self.path).path
    if path.startswith("/npu/"):
      return self.npu(path)
    self.relay() if relayed(path) else self.send_error(404)

  do_PUT = do_DELETE = do_POST

  def relay(self, target: tuple[str, int] | None = None) -> None:
    self.close_connection = True
    target = target or BRIDGE
    if target is None:
      return self.send_error(503, "no bridge: start with --bridge <host[:port]>")
    try:
      up = socket.create_connection(target, timeout=5)
    except OSError as e:
      return self.send_error(502, f"{target[0]}:{target[1]}: {e}")
    up.settimeout(None)
    upgrade = self.headers.get("Upgrade", "").lower() == "websocket"
    head = [f"{self.command} {self.path} {self.request_version}"]
    for k, v in self.headers.items():
      if k.lower() == "connection" and not upgrade:
        continue
      head.append(f"{k}: {v}")
    if not upgrade:
      head.append("Connection: close")   # one request per connection: the bridge's EOF ends the relay
    up.sendall(("\r\n".join(head) + "\r\n\r\n").encode("latin-1"))
    client = self.connection
    threading.Thread(target=pump, args=(client, up), daemon=True).start()   # request body, WebSocket frames up
    pump(up, client)                                                        # the response down

  def log_message(self, fmt, *args) -> None:   # noqa: A002
    if not str(args[0]).startswith(("GET /ws", "GET /video", "GET /api/", "GET /npu")):
      super().log_message(fmt, *args)


def main() -> None:
  global BRIDGE, NPU_RELAY, NPU_SYNTH, NPU_REPLAY
  ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  ap.add_argument("--port", type=int, default=DEFAULT_PORT)
  ap.add_argument("--host", default="127.0.0.1", help="bind address (0.0.0.0 to reach it from another device)")
  ap.add_argument("--bridge", help="the comma bridge, host or host:port (default port 8088)")
  ap.add_argument("--npu-synth", action="store_true", help="serve /npu from tools/npu_synth.py (a synthetic NPU detector)")
  ap.add_argument("--npu-cam-x", type=float, default=-1.7, help="the synthetic camera's place ahead of the bumper (m)")
  ap.add_argument("--npu-relay", help="relay /npu and /npu/status to host:port (an app's LocalServer)")
  ap.add_argument("--npu-replay", help="serve /npu from recorded detections (JSON lines), in step with the bridge's replay")
  args = ap.parse_args()
  if args.npu_relay:
    host, _, port = args.npu_relay.rpartition(":")
    NPU_RELAY = (host, int(port))
  elif args.npu_synth:
    import sys
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import npu_synth
    NPU_SYNTH = npu_synth.Synth(cam_x=args.npu_cam_x)
  if args.bridge:
    host, _, port = args.bridge.rpartition(":") if ":" in args.bridge else (args.bridge, "", "")
    BRIDGE = (host, int(port or BRIDGE_PORT))
  if args.npu_replay and not args.npu_relay:
    import sys
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import npu_replay
    NPU_REPLAY = npu_replay.Recorded(args.npu_replay, BRIDGE)
  ThreadingHTTPServer.daemon_threads = True
  ThreadingHTTPServer.allow_reuse_address = True
  httpd = ThreadingHTTPServer((args.host, args.port), Handler)
  print(f"Oceanscape at http://{args.host}:{args.port}/" + (f", bridge {BRIDGE[0]}:{BRIDGE[1]}" if BRIDGE else ", no bridge (offline)"))
  try:
    httpd.serve_forever()
  except KeyboardInterrupt:
    pass


if __name__ == "__main__":
  main()

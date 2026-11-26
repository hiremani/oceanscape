#!/usr/bin/env python3
"""
A stand-in for the Android app's NPU detector (protocol v1, static/js/npu.js), for testing the page on a PC.

It "detects" a scene of known objects: each road user (car frame: m ahead of the front bumper, m left) and each
signal is projected through a synthetic road camera into the boxes a detector would report, at 15 frames a second,
and the camera's calibration and a flat road model are passed on the way the app passes on the bridge's. The page
places the boxes back on the road (npu_geom.js), so where its objects land against this scene's truth checks the
whole path end to end.

  python3 serve.py --npu-synth [--npu-cam-x -1.7] ...    serves /npu and /npu/status from this module
  GET /npu/scene   the scene (JSON)          POST /npu/scene   replace it: [{"k": "person", "x": 15, "y": 2.5}, ...]

The camera: 1280 x 720, fx = fy = 910 px, pitched 2 deg down, yawed 1 deg left, 1.22 m over a flat road, cam_x m
ahead of the bumper (negative: behind it; the page's own modelXOffset, -1.7 with the measured calibration).
Stdlib only.
"""
import base64
import hashlib
import json
import math
import struct
import threading
import time

W, H = 1280, 720
FX = FY = 910.0
PITCH = math.radians(2.0)
YAW = math.radians(1.0)
CAM_H = 1.22
FPS = 15.0
MODEL = "synthetic-yolox"

# the detector's class -> (w, l, h) as npu_geom.js DIMS_PRIOR sizes them
DIMS = {"person": (0.6, 0.6, 1.7), "bicycle": (0.6, 1.8, 1.7), "motorcycle": (0.8, 2.1, 1.5), "car": (1.85, 4.6, 1.5),
        "bus": (2.55, 12.0, 3.1), "truck": (2.5, 8.0, 3.2)}
SIGN_FACE = {"traffic_light": 1.0, "stop_sign": 0.75}
SIGN_W = {"traffic_light": 0.4, "stop_sign": 0.75}

DEFAULT_SCENE = [
  {"k": "person", "x": 15.0, "y": 2.5},
  {"k": "bicycle", "x": 25.0, "y": -1.5},
  {"k": "truck", "x": 40.0, "y": 0.4},
  {"k": "stop_sign", "x": 20.0, "y": -4.5, "z": 2.1},
  {"k": "traffic_light", "x": 35.0, "y": 2.0, "z": 5.0},
]


def _mm(a, b):
  return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def camera_matrix():
  """M = K . view_from_calib for the synthetic camera (calib x fwd, y right, z down -> pixels)."""
  k = [[FX, 0, W / 2], [0, FY, H / 2], [0, 0, 1]]
  cp, sp, cy, sy = math.cos(PITCH), math.sin(PITCH), math.cos(YAW), math.sin(YAW)
  ry = [[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]]
  rz = [[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]]
  dev = _mm(rz, ry)
  view = [dev[1], dev[2], dev[0]]
  return k, _mm(k, view)


K, M = camera_matrix()


def to_pixel(cam_x, x, y, up):
  """A car-frame point (up m over the road) in the picture, or None behind the camera."""
  f = x - cam_x
  p = (f, -y, CAM_H - up)
  q = [M[i][0] * p[0] + M[i][1] * p[1] + M[i][2] * p[2] for i in range(3)]
  if q[2] <= 1e-6:
    return None
  return q[0] / q[2], q[1] / q[2]


def object_box(cam_x, x, y, w, l, h):
  """The box of an upright w x l x h object whose near face's middle stands at (x, y), facing along the car."""
  pts = []
  for dx in (0.0, l):
    for dy in (-w / 2, w / 2):
      for up in (0.0, h):
        p = to_pixel(cam_x, x + dx, y + dy, up)
        if p is None:
          return None
        pts.append(p)
  xs, ys = [p[0] for p in pts], [p[1] for p in pts]
  return [min(xs), min(ys), max(xs), max(ys)]


def sign_box(cam_x, x, y, z, k):
  face, w = SIGN_FACE[k], SIGN_W[k]
  a, b = to_pixel(cam_x, x, y + w / 2, z + face / 2), to_pixel(cam_x, x, y - w / 2, z - face / 2)
  if a is None or b is None:
    return None
  return [min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1])]


def detections(scene, cam_x):
  """The protocol's dets for a scene: boxes clipped to the picture, those entirely outside it left out."""
  out = []
  for o in scene:
    k = o.get("k")
    if k in DIMS:
      w, l, h = DIMS[k]
      b = object_box(cam_x, float(o["x"]), float(o["y"]), w, l, h)
    elif k in SIGN_FACE:
      b = sign_box(cam_x, float(o["x"]), float(o["y"]), float(o.get("z", 2.0)), k)
    else:
      continue
    if b is None or b[2] < 0 or b[0] > W or b[3] < 0 or b[1] > H:
      continue
    b = [round(max(0.0, b[0]), 1), round(max(0.0, b[1]), 1), round(min(W, b[2]), 1), round(min(H, b[3]), 1)]
    out.append({"k": k, "s": float(o.get("s", 0.9)), "b": b})
  return out


def calib_message():
  """The calib message the bridge sends on /video (sunnypilot webhud/video.py), for the synthetic camera."""
  cam = {"width": W, "height": H, "K": K, "M": M}
  return {"type": "calib", "calibrated": True, "cameras": {"road": cam, "wide": cam}}


def model_message():
  return {"type": "model", "frameId": 0, "pathZ": CAM_H, "lanes": [], "laneProbs": []}


class Synth:
  """The scene, shared by every /npu connection and editable over /npu/scene."""

  def __init__(self, cam_x=-1.7):
    self.cam_x = cam_x
    self.scene = [dict(o) for o in DEFAULT_SCENE]
    self.lock = threading.Lock()
    self.running = 0
    self.frame_id = 0

  def set_scene(self, scene):
    with self.lock:
      self.scene = [dict(o) for o in scene if isinstance(o, dict)]

  def get_scene(self):
    with self.lock:
      return [dict(o) for o in self.scene]

  def status(self):
    return {"available": True, "reason": "", "runtime": "synthetic (serve.py --npu-synth)", "model": MODEL,
            "running": self.running > 0, "fps": FPS if self.running else 0,
            "ms": {"decode": 3.0, "pre": 2.0, "npu": 25.0, "post": 2.0, "total": 32.0}}

  def frame(self, camera="road"):
    with self.lock:
      self.frame_id = (self.frame_id + 1) & 0xFFFFFFFF
      scene = list(self.scene)
      fid = self.frame_id
    return {"v": 1, "frameId": fid, "tsNs": time.monotonic_ns(), "camera": camera, "w": W, "h": H, "model": MODEL,
            "fps": FPS, "ms": {"decode": 3.0, "pre": 2.0, "npu": 25.0, "post": 2.0, "total": 32.0},
            "dets": detections(scene, self.cam_x)}


# ---- a minimal WebSocket server side (RFC 6455): text frames out, the client's masked frames in --------------------

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def ws_accept(key):
  return base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()


def ws_frame(text):
  data = text.encode()
  n = len(data)
  if n < 126:
    head = struct.pack("!BB", 0x81, n)
  elif n < 65536:
    head = struct.pack("!BBH", 0x81, 126, n)
  else:
    head = struct.pack("!BBQ", 0x81, 127, n)
  return head + data


def ws_read(sock):
  """One client frame: (opcode, payload bytes), or None when the connection ends."""
  def exact(n):
    buf = b""
    while len(buf) < n:
      chunk = sock.recv(n - len(buf))
      if not chunk:
        return None
      buf += chunk
    return buf
  h = exact(2)
  if h is None:
    return None
  op, ln = h[0] & 0x0F, h[1] & 0x7F
  masked = h[1] & 0x80
  if ln == 126:
    e = exact(2)
    ln = struct.unpack("!H", e)[0] if e else 0
  elif ln == 127:
    e = exact(8)
    ln = struct.unpack("!Q", e)[0] if e else 0
  mask = exact(4) if masked else b"\0\0\0\0"
  data = exact(ln) if ln else b""
  if mask is None or data is None:
    return None
  return op, bytes(b ^ mask[i % 4] for i, b in enumerate(data))


def serve_ws(handler, synth):
  """Answer a /npu WebSocket on a http.server handler's connection: frames at FPS while the page has started us."""
  key = handler.headers.get("Sec-WebSocket-Key", "")
  handler.send_response(101, "Switching Protocols")
  handler.send_header("Upgrade", "websocket")
  handler.send_header("Connection", "Upgrade")
  handler.send_header("Sec-WebSocket-Accept", ws_accept(key))
  handler.end_headers()
  handler.wfile.flush()
  sock = handler.connection
  state = {"on": False, "camera": "road", "alive": True}
  send_lock = threading.Lock()

  def send(obj):
    with send_lock:
      sock.sendall(ws_frame(json.dumps(obj)))

  def reader():
    while state["alive"]:
      f = ws_read(sock)
      if f is None or f[0] == 0x8:
        state["alive"] = False
        break
      if f[0] == 0x1:
        try:
          cmd = json.loads(f[1].decode())
        except ValueError:
          continue
        if cmd.get("cmd") == "start":
          state["on"], state["camera"] = True, cmd.get("camera", "road")
        elif cmd.get("cmd") == "stop":
          state["on"] = False

  threading.Thread(target=reader, daemon=True).start()
  try:
    send({"v": 1, "status": synth.status()})
    send(calib_message())
    send(model_message())
    was_on = False
    next_t = time.monotonic()
    last_calib = time.monotonic()
    while state["alive"]:
      if state["on"] != was_on:
        synth.running += 1 if state["on"] else -1
        was_on = state["on"]
        send({"v": 1, "status": synth.status()})
      if state["on"]:
        send(synth.frame(state["camera"]))
        if time.monotonic() - last_calib > 5:
          send(calib_message())
          send(model_message())
          last_calib = time.monotonic()
      next_t += 1 / FPS
      time.sleep(max(0.0, next_t - time.monotonic()))
  except OSError:
    pass
  finally:
    state["alive"] = False
    if was_on:
      synth.running -= 1
    handler.close_connection = True


if __name__ == "__main__":
  s = Synth()
  print(json.dumps(s.frame(), indent=1))

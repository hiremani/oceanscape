"""
Recorded NPU detections for a replayed drive, served on /npu the way the app's native service does (NpuHub,
protocol v1), so the page's detector side can be checked on a PC against what the real model saw.

The file is JSON lines, one protocol v1 detection message per inferred frame ({"v":1,"frameId":..,"tsNs":..,
"camera":"road","w":..,"h":..,"model":..,"ms":{..},"dets":[..]}), keyed by the frame ids of the replayed route (made,
for example, by running the converted model in Rockchip's simulator over the route's recorded road camera).

Like the native service, it holds its own /video connection to the comma bridge (serving a replay with its recorded
cameras: sunnypilot webhud replay_video.py) while a page has started it, passes the bridge's calib and model messages
on, and sends the recorded message of each frame as that frame goes by, so detections stay in step with the replay's
pause, speed and seeks.

  python3 serve.py --bridge 127.0.0.1:8088 --npu-replay detections.jsonl
"""
import base64
import json
import os
import socket
import struct
import threading
import time

from npu_synth import ws_accept, ws_frame, ws_read

FRAME_HEADER = struct.Struct("<BBHIQ")   # the bridge's /video frame header (kind, flags, camera, frameId, tsEof)
KIND_FRAME = 1
PASS_THROUGH = ("calib", "model")


def load(path: str) -> dict[int, dict]:
  """frameId -> detection message."""
  out = {}
  with open(path) as f:
    for line in f:
      line = line.strip()
      if line:
        m = json.loads(line)
        out[int(m["frameId"])] = m
  return out


class Recorded:
  def __init__(self, path: str, bridge: tuple[str, int] | None):
    self.path = path
    self.msgs = load(path)
    self.bridge = bridge
    self.model = next(iter(self.msgs.values()), {}).get("model", "recorded")
    self.running = 0
    self.sent = 0
    self.t0 = time.monotonic()

  def status(self) -> dict:
    ok = bool(self.msgs) and self.bridge is not None
    return {"available": ok, "reason": "" if ok else ("no recorded detections" if not self.msgs else "no bridge to follow"),
            "runtime": f"recorded ({os.path.basename(self.path)}, {len(self.msgs)} frames)", "model": self.model,
            "running": self.running > 0, "fps": 0, "ms": {}}


def ws_client(host: str, port: int, path: str) -> socket.socket:
  s = socket.create_connection((host, port), timeout=5)
  key = base64.b64encode(os.urandom(16)).decode()
  s.sendall((f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
             f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
  head = b""
  while b"\r\n\r\n" not in head:
    chunk = s.recv(4096)
    if not chunk:
      raise OSError("bridge closed during the handshake")
    head += chunk
  if not head.startswith(b"HTTP/1.1 101"):
    raise OSError(head.split(b"\r\n", 1)[0].decode(errors="replace"))
  rest = head.split(b"\r\n\r\n", 1)[1]
  s.settimeout(None)
  return _Prefixed(s, rest)


class _Prefixed:
  """A socket whose first recv()s return bytes already read past the handshake."""
  def __init__(self, sock, prefix: bytes):
    self.sock, self.prefix = sock, prefix

  def recv(self, n: int) -> bytes:
    if self.prefix:
      out, self.prefix = self.prefix[:n], self.prefix[n:]
      return out
    return self.sock.recv(n)

  def close(self):
    try:
      self.sock.close()
    except OSError:
      pass


def follow(rec: Recorded, camera: str, send, alive) -> None:
  """While alive(): the bridge's /video for `camera`; calib/model passed on, each recorded frame's message sent."""
  host, port = rec.bridge
  while alive():
    try:
      sock = ws_client(host, port, f"/video?camera={camera}")
    except OSError:
      time.sleep(1.0)
      continue
    try:
      while alive():
        f = ws_read(sock)
        if f is None or f[0] == 0x8:
          break
        op, data = f
        if op == 0x1:
          try:
            if json.loads(data.decode()).get("type") in PASS_THROUGH:
              send(data.decode())
          except ValueError:
            pass
        elif op == 0x2 and len(data) >= FRAME_HEADER.size:
          kind, _, _, frame_id, _ = FRAME_HEADER.unpack(data[:FRAME_HEADER.size])
          m = rec.msgs.get(frame_id) if kind == KIND_FRAME else None
          if m is not None and m.get("camera", "road") == camera:
            rec.sent += 1
            send(json.dumps(m, separators=(",", ":")))
    finally:
      sock.close()


def serve_ws(handler, rec: Recorded) -> None:
  key = handler.headers.get("Sec-WebSocket-Key", "")
  handler.send_response(101, "Switching Protocols")
  handler.send_header("Upgrade", "websocket")
  handler.send_header("Connection", "Upgrade")
  handler.send_header("Sec-WebSocket-Accept", ws_accept(key))
  handler.end_headers()
  handler.wfile.flush()
  sock = handler.connection
  lock = threading.Lock()
  state = {"alive": True, "run": None, "camera": "road"}

  def send_text(text: str) -> None:
    with lock:
      sock.sendall(ws_frame(text))

  def start(camera: str) -> None:
    stop()
    token = {"on": True}
    state["run"], state["camera"] = token, camera
    rec.running += 1
    threading.Thread(target=follow, args=(rec, camera, send_text, lambda: token["on"] and state["alive"]),
                     daemon=True).start()

  def stop() -> None:
    if state["run"] is not None:
      state["run"]["on"] = False
      state["run"] = None
      rec.running -= 1

  send_text(json.dumps({"v": 1, "status": rec.status()}))
  try:
    while state["alive"]:
      f = ws_read(sock)
      if f is None or f[0] == 0x8:
        break
      if f[0] != 0x1:
        continue
      try:
        cmd = json.loads(f[1].decode())
      except ValueError:
        continue
      if cmd.get("cmd") == "start":
        start(cmd.get("camera", "road"))
      elif cmd.get("cmd") == "stop":
        stop()
      send_text(json.dumps({"v": 1, "status": rec.status()}))
  except OSError:
    pass
  finally:
    state["alive"] = False
    stop()

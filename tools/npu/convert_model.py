# Converts YOLOX-s (ONNX) to an int8 RKNN model for the RK3588, calibrated on the car's own road-camera frames,
# then runs the quantized model in the toolkit's simulator on a few frames as a sanity check.
import sys, numpy as np, cv2, json
from rknn.api import RKNN
ONNX, DATASET, OUT = '/data/model/yolox_s.onnx', '/data/dataset.txt', '/out/yolox_s-640-i8.rknn'
r = RKNN(verbose=False)
r.config(mean_values=[[0, 0, 0]], std_values=[[1, 1, 1]], target_platform='rk3588')
assert r.load_onnx(model=ONNX) == 0
assert r.build(do_quantization=True, dataset=DATASET) == 0
assert r.export_rknn(OUT) == 0
assert r.init_runtime() == 0   # simulator
COCO = {0: 'person', 1: 'bicycle', 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck', 9: 'traffic_light', 11: 'stop_sign'}
def decode(outs, conf=0.35):
  dets = []
  for o, stride in zip(outs, (8, 16, 32)):
    o = o[0]                                   # (85, H, W) in the model zoo's layout
    if o.shape[-1] == 85: o = o.transpose(2, 0, 1)
    _, H, W = o.shape
    gy, gx = np.mgrid[0:H, 0:W]
    obj = o[4]; cls = o[5:]
    c = cls.argmax(0); s = obj * cls.max(0)
    keep = s > conf
    for y, x in zip(*np.nonzero(keep)):
      k = int(c[y, x])
      if k not in COCO: continue
      cx, cy = (o[0, y, x] + x) * stride, (o[1, y, x] + y) * stride
      w, h = np.exp(o[2, y, x]) * stride, np.exp(o[3, y, x]) * stride
      dets.append((COCO[k], float(s[y, x]), [float(cx - w / 2), float(cy - h / 2), float(cx + w / 2), float(cy + h / 2)]))
  dets.sort(key=lambda d: -d[1])
  kept = []
  for d in dets:
    if all(d[0] != e[0] or iou(d[2], e[2]) < 0.45 for e in kept): kept.append(d)
  return kept
def iou(a, b):
  ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
  u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy
  return ix * iy / u if u > 0 else 0
files = [l.strip() for l in open(DATASET)][::11][:8]
report = {}
for f in files:
  img = cv2.cvtColor(cv2.imread(f), cv2.COLOR_BGR2RGB)
  outs = r.inference(inputs=[img[None]], data_format='nhwc')
  if f == files[0]: report['output_shapes'] = [list(o.shape) for o in outs]
  report[f.split('/')[-1]] = [(k, round(s, 2), [round(v) for v in b]) for k, s, b in decode(outs)][:8]
print(json.dumps(report, indent=1))
r.release()

#include "npu_post.h"

#include <algorithm>
#include <cmath>

namespace npu {

bool kept_class(int coco) {
  switch (coco) {
    case PERSON: case BICYCLE: case CAR: case MOTORCYCLE: case BUS: case TRUCK: case TRAFFIC_LIGHT: case STOP_SIGN: return true;
    default: return false;
  }
}

const char* kind_name(int coco) {
  switch (coco) {
    case PERSON: return "person";
    case BICYCLE: return "bicycle";
    case CAR: return "car";
    case MOTORCYCLE: return "motorcycle";
    case BUS: return "bus";
    case TRUCK: return "truck";
    case TRAFFIC_LIGHT: return "traffic_light";
    case STOP_SIGN: return "stop_sign";
    default: return "other";
  }
}

Letterbox letterbox_for(int srcW, int srcH, int dst) {
  Letterbox lb;
  lb.srcW = srcW;
  lb.srcH = srcH;
  lb.dst = dst;
  if (srcW <= 0 || srcH <= 0) return lb;
  lb.scale = std::min(static_cast<float>(dst) / srcW, static_cast<float>(dst) / srcH);
  const int w = static_cast<int>(std::lround(srcW * lb.scale)), h = static_cast<int>(std::lround(srcH * lb.scale));
  lb.padX = (dst - w) / 2;
  lb.padY = (dst - h) / 2;
  return lb;
}

static inline uint8_t clamp8(int v) { return static_cast<uint8_t>(v < 0 ? 0 : (v > 255 ? 255 : v)); }

void yuv420_to_rgb_letterbox(const uint8_t* y, const uint8_t* u, const uint8_t* v, int srcW, int srcH,
                             int yRowStride, int uvRowStride, int uvPixelStride, const Letterbox& lb, uint8_t* out) {
  const int dst = lb.dst;
  std::fill(out, out + static_cast<size_t>(dst) * dst * 3, static_cast<uint8_t>(114));
  if (srcW <= 0 || srcH <= 0 || lb.scale <= 0.f) return;
  const int w = std::min(dst - lb.padX, static_cast<int>(std::lround(srcW * lb.scale)));
  const int h = std::min(dst - lb.padY, static_cast<int>(std::lround(srcH * lb.scale)));
  // source column of each output column, once per frame
  std::vector<int> sx(static_cast<size_t>(w));
  for (int x = 0; x < w; x++) sx[x] = std::min(srcW - 1, static_cast<int>((x + 0.5f) / lb.scale));
  for (int oy = 0; oy < h; oy++) {
    const int syy = std::min(srcH - 1, static_cast<int>((oy + 0.5f) / lb.scale));
    const uint8_t* yr = y + static_cast<size_t>(syy) * yRowStride;
    const size_t uvRow = static_cast<size_t>(syy >> 1) * uvRowStride;
    uint8_t* o = out + (static_cast<size_t>(oy + lb.padY) * dst + lb.padX) * 3;
    for (int ox = 0; ox < w; ox++) {
      const int s = sx[ox];
      const size_t uvi = uvRow + static_cast<size_t>(s >> 1) * uvPixelStride;
      // BT.601 limited range (the encoder's), integer
      const int c = static_cast<int>(yr[s]) - 16, d = static_cast<int>(u[uvi]) - 128, e = static_cast<int>(v[uvi]) - 128;
      const int cc = 298 * c + 128;
      o[0] = clamp8((cc + 409 * e) >> 8);
      o[1] = clamp8((cc - 100 * d - 208 * e) >> 8);
      o[2] = clamp8((cc + 516 * d) >> 8);
      o += 3;
    }
  }
}

int8_t qnt(float f, int32_t zp, float scale) {
  const float q = f / scale + static_cast<float>(zp);
  const int r = static_cast<int>(std::lround(q));
  return static_cast<int8_t>(r < -128 ? -128 : (r > 127 ? 127 : r));
}

int stride_for(int inputSize, int gridH, int gridW) {
  if (gridH <= 0 || gridW <= 0 || inputSize % gridH || inputSize % gridW || inputSize / gridH != inputSize / gridW) return 0;
  return inputSize / gridH;
}

float iou(const Det& a, const Det& b) {
  const float ix = std::max(0.f, std::min(a.x2, b.x2) - std::max(a.x1, b.x1));
  const float iy = std::max(0.f, std::min(a.y2, b.y2) - std::max(a.y1, b.y1));
  const float inter = ix * iy;
  const float u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return u > 0.f ? inter / u : 0.f;
}

namespace {

struct Reader {
  const Head& h;
  int cells;
  float at(int c, int cell) const {
    const size_t i = h.layout == NCHW ? static_cast<size_t>(c) * cells + cell : static_cast<size_t>(cell) * h.channels + c;
    if (h.int8) return deqnt(static_cast<const int8_t*>(h.data)[i], h.zp, h.scale);
    return static_cast<const float*>(h.data)[i];
  }
  // compared in the quantised domain where possible: the same order as dequantised (positive scale)
  int raw(int c, int cell) const {
    const size_t i = h.layout == NCHW ? static_cast<size_t>(c) * cells + cell : static_cast<size_t>(cell) * h.channels + c;
    return static_cast<const int8_t*>(h.data)[i];
  }
};

}  // namespace

std::vector<Det> decode_yolox(const std::vector<Head>& heads, const Letterbox& lb, const Params& p) {
  std::vector<Det> cand;
  for (const Head& h : heads) {
    if (!h.data || h.channels < 6 || h.gridH <= 0 || h.gridW <= 0 || h.stride <= 0) continue;
    const int cells = h.gridH * h.gridW, classes = h.channels - 5;
    const Reader r{h, cells};
    const int8_t objMinQ = h.int8 ? qnt(p.scoreMin, h.zp, h.scale) : 0;
    for (int gy = 0; gy < h.gridH; gy++) {
      for (int gx = 0; gx < h.gridW; gx++) {
        const int cell = gy * h.gridW + gx;
        // objectness alone already under the threshold: the product can't pass (class scores are <= 1)
        if (h.int8 ? r.raw(4, cell) < objMinQ : r.at(4, cell) < p.scoreMin) continue;
        int best = 0;
        if (h.int8) {
          int bestQ = r.raw(5, cell);
          for (int k = 1; k < classes; k++) { const int q = r.raw(5 + k, cell); if (q > bestQ) { bestQ = q; best = k; } }
        } else {
          float bestP = r.at(5, cell);
          for (int k = 1; k < classes; k++) { const float v = r.at(5 + k, cell); if (v > bestP) { bestP = v; best = k; } }
        }
        if (!kept_class(best)) continue;
        const float score = r.at(4, cell) * r.at(5 + best, cell);
        if (score < p.scoreMin) continue;
        const float cx = (r.at(0, cell) + gx) * h.stride, cy = (r.at(1, cell) + gy) * h.stride;
        const float bw = std::exp(r.at(2, cell)) * h.stride, bh = std::exp(r.at(3, cell)) * h.stride;
        Det d;
        d.cls = best;
        d.score = score;
        // back from the model's input to the camera frame
        d.x1 = (cx - bw / 2 - lb.padX) / lb.scale;
        d.y1 = (cy - bh / 2 - lb.padY) / lb.scale;
        d.x2 = (cx + bw / 2 - lb.padX) / lb.scale;
        d.y2 = (cy + bh / 2 - lb.padY) / lb.scale;
        d.x1 = std::clamp(d.x1, 0.f, static_cast<float>(lb.srcW));
        d.x2 = std::clamp(d.x2, 0.f, static_cast<float>(lb.srcW));
        d.y1 = std::clamp(d.y1, 0.f, static_cast<float>(lb.srcH));
        d.y2 = std::clamp(d.y2, 0.f, static_cast<float>(lb.srcH));
        if (d.x2 - d.x1 < 1.f || d.y2 - d.y1 < 1.f) continue;
        cand.push_back(d);
      }
    }
  }
  std::sort(cand.begin(), cand.end(), [](const Det& a, const Det& b) { return a.score > b.score; });
  std::vector<Det> out;
  std::vector<char> gone(cand.size(), 0);
  for (size_t i = 0; i < cand.size() && static_cast<int>(out.size()) < p.maxDets; i++) {
    if (gone[i]) continue;
    out.push_back(cand[i]);
    for (size_t j = i + 1; j < cand.size(); j++) {
      if (!gone[j] && cand[j].cls == cand[i].cls && iou(cand[i], cand[j]) > p.nmsIou) gone[j] = 1;
    }
  }
  return out;
}

}  // namespace npu

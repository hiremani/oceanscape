// Tests for the NPU detector's image maths (npu_post.cpp): synthetic YOLOX heads with known boxes in,
// the boxes expected back in camera pixels out; quantisation; NMS; the letterboxed YUV to RGB conversion.
#include "npu_post.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>

using namespace npu;

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); failures++; } } while (0)
#define NEAR(a, b, tol) do { const double _a = (a), _b = (b); if (std::fabs(_a - _b) > (tol)) { \
  std::printf("FAIL %s:%d  %s = %g, want %g (+-%g)\n", __FILE__, __LINE__, #a, _a, _b, (double)(tol)); failures++; } } while (0)

// A synthetic head: every cell's objectness near zero, except the objects put in.
struct SynthHead {
  int grid, stride, channels = 85;
  Layout layout;
  bool int8;
  int32_t zp = -10;
  float scale = 0.05f;
  std::vector<int8_t> q;
  std::vector<float> f;
  SynthHead(int g, int s, Layout l, bool i8) : grid(g), stride(s), layout(l), int8(i8) {
    q.assign(static_cast<size_t>(channels) * g * g, qnt(0.f, zp, scale));
    f.assign(static_cast<size_t>(channels) * g * g, 0.f);
    // a box tensor with zero objectness everywhere, but box channels non-zero so stray decoding would show
    for (int cell = 0; cell < g * g; cell++) for (int c = 0; c < 4; c++) set(c, cell, 0.3f);
  }
  size_t idx(int c, int cell) const {
    return layout == NCHW ? static_cast<size_t>(c) * grid * grid + cell : static_cast<size_t>(cell) * channels + c;
  }
  void set(int c, int cell, float v) {
    q[idx(c, cell)] = qnt(v, zp, scale);
    f[idx(c, cell)] = v;
  }
  // an object whose box centre is (cx, cy) and size (w, h) in model-input pixels
  void put(float cx, float cy, float w, float h, int cls, float obj, float clsP, float other = 0.f, int otherCls = -1) {
    const int gx = static_cast<int>(cx / stride), gy = static_cast<int>(cy / stride), cell = gy * grid + gx;
    set(0, cell, cx / stride - gx);
    set(1, cell, cy / stride - gy);
    set(2, cell, std::log(w / stride));
    set(3, cell, std::log(h / stride));
    set(4, cell, obj);
    set(5 + cls, cell, clsP);
    if (otherCls >= 0) set(5 + otherCls, cell, other);
  }
  Head head() const {
    Head h;
    h.data = int8 ? static_cast<const void*>(q.data()) : static_cast<const void*>(f.data());
    h.int8 = int8;
    h.zp = zp;
    h.scale = scale;
    h.layout = layout;
    h.channels = channels;
    h.gridH = h.gridW = grid;
    h.stride = stride;
    return h;
  }
};

static void test_letterbox() {
  const Letterbox lb = letterbox_for(1280, 720, 640);
  NEAR(lb.scale, 0.5, 1e-6);
  CHECK(lb.padX == 0);
  CHECK(lb.padY == 140);
  const Letterbox sq = letterbox_for(640, 640, 640);
  NEAR(sq.scale, 1.0, 1e-6);
  CHECK(sq.padX == 0 && sq.padY == 0);
  CHECK(stride_for(640, 80, 80) == 8);
  CHECK(stride_for(640, 40, 40) == 16);
  CHECK(stride_for(640, 20, 20) == 32);
  CHECK(stride_for(640, 21, 21) == 0);
}

static void test_quant_round_trip() {
  for (float v : {-1.f, -0.25f, 0.f, 0.35f, 0.9f, 2.5f}) NEAR(deqnt(qnt(v, -10, 0.05f), -10, 0.05f), v, 0.026);
  CHECK(qnt(100.f, 0, 0.05f) == 127);
  CHECK(qnt(-100.f, 0, 0.05f) == -128);
}

// a car and a person in a 1280x720 frame, through the letterbox and back, in each layout and type
static void test_decode(Layout layout, bool int8) {
  const Letterbox lb = letterbox_for(1280, 720, 640);
  SynthHead h8(80, 8, layout, int8), h16(40, 16, layout, int8), h32(20, 32, layout, int8);
  // car: frame box (400, 300)-(600, 420) -> input centre (250, 320), size 100 x 60
  h16.put(250.f, 320.f, 100.f, 60.f, CAR, 0.95f, 0.9f);
  // person: frame box (1000, 360)-(1040, 460) -> input centre (510, 345), size 20 x 50
  h8.put(510.f, 345.f, 20.f, 50.f, PERSON, 0.9f, 0.8f);
  // a dog (COCO 16) that scores high: dropped, not relabelled
  h32.put(100.f, 400.f, 64.f, 64.f, 16, 0.95f, 0.95f);
  // weak: under the threshold
  h32.put(500.f, 200.f, 64.f, 64.f, TRUCK, 0.4f, 0.5f);
  const std::vector<Head> heads = {h8.head(), h16.head(), h32.head()};
  const std::vector<Det> d = decode_yolox(heads, lb, Params{});
  CHECK(d.size() == 2);
  if (d.size() != 2) return;
  const double tol = int8 ? 8.0 : 0.5;   // int8 at scale 0.05 moves a box edge by a few pixels
  CHECK(d[0].cls == CAR);
  NEAR(d[0].x1, 400, tol); NEAR(d[0].y1, 300, tol); NEAR(d[0].x2, 600, tol); NEAR(d[0].y2, 420, tol);
  NEAR(d[0].score, 0.95 * 0.9, int8 ? 0.05 : 1e-4);
  CHECK(d[1].cls == PERSON);
  NEAR(d[1].x1, 1000, tol); NEAR(d[1].y1, 360, tol); NEAR(d[1].x2, 1040, tol); NEAR(d[1].y2, 460, tol);
  CHECK(std::strcmp(kind_name(d[0].cls), "car") == 0);
  CHECK(std::strcmp(kind_name(d[1].cls), "person") == 0);
}

static void test_nms() {
  const Letterbox lb = letterbox_for(640, 640, 640);
  SynthHead h(80, 8, NCHW, false);
  // the same car seen by two neighbouring cells: one survives; a truck overlapping it is another class and stays
  h.put(300.f, 300.f, 120.f, 80.f, CAR, 0.9f, 0.9f);
  h.put(308.f, 300.f, 120.f, 80.f, CAR, 0.8f, 0.9f);
  h.put(316.f, 300.f, 120.f, 80.f, TRUCK, 0.7f, 0.9f);
  // a separate car far away
  h.put(100.f, 100.f, 40.f, 40.f, CAR, 0.6f, 0.9f);
  std::vector<Det> d = decode_yolox({h.head()}, lb, Params{});
  CHECK(d.size() == 3);
  int cars = 0, trucks = 0;
  for (const Det& x : d) { cars += x.cls == CAR; trucks += x.cls == TRUCK; }
  CHECK(cars == 2 && trucks == 1);
  for (size_t i = 1; i < d.size(); i++) CHECK(d[i - 1].score >= d[i].score);
  Params one;
  one.maxDets = 1;
  CHECK(decode_yolox({h.head()}, lb, one).size() == 1);
}

static void test_clip() {
  const Letterbox lb = letterbox_for(1280, 720, 640);
  SynthHead h(20, 32, NHWC, false);
  // a box running off the left edge and into the top pad
  h.put(20.f, 150.f, 120.f, 60.f, BUS, 0.9f, 0.9f);
  const std::vector<Det> d = decode_yolox({h.head()}, lb, Params{});
  CHECK(d.size() == 1);
  if (d.size() == 1) { CHECK(d[0].x1 == 0.f); CHECK(d[0].y1 == 0.f); CHECK(d[0].x2 <= 1280.f); }
}

// a 4x2 I420 / NV12 frame of known colours, into an 8x8 letterbox
static void test_yuv() {
  // two grey-ish columns: left half Y=16 (black), right half Y=235 (white); chroma neutral
  const int W = 4, H = 2;
  uint8_t yI420[W * H] = {16, 16, 235, 235, 16, 16, 235, 235};
  uint8_t u[2] = {128, 128}, v[2] = {128, 128};
  const Letterbox lb = letterbox_for(W, H, 8);   // scale 2, padY 2
  CHECK(lb.padY == 2 && lb.padX == 0);
  std::vector<uint8_t> out(8 * 8 * 3);
  yuv420_to_rgb_letterbox(yI420, u, v, W, H, W, 2, 1, lb, out.data());
  auto px = [&](int x, int y, int c) { return out[(static_cast<size_t>(y) * 8 + x) * 3 + c]; };
  CHECK(px(0, 0, 0) == 114);            // pad above
  CHECK(px(0, 2, 0) <= 1);              // black
  CHECK(px(7, 3, 1) >= 254);            // white
  CHECK(px(0, 7, 2) == 114);            // pad below
  // NV12: interleaved UV, pixel stride 2; a red-ish chroma (V high) shows in R over G
  uint8_t uv[4] = {128, 220, 128, 220};
  yuv420_to_rgb_letterbox(yI420, uv, uv + 1, W, H, W, 4, 2, lb, out.data());
  CHECK(px(7, 3, 0) == 255);
  CHECK(px(1, 3, 0) > px(1, 3, 1));
}

int main() {
  test_letterbox();
  test_quant_round_trip();
  test_decode(NCHW, true);
  test_decode(NHWC, true);
  test_decode(NCHW, false);
  test_decode(NHWC, false);
  test_nms();
  test_clip();
  test_yuv();
  if (failures) { std::printf("%d failure(s)\n", failures); return 1; }
  std::printf("npu_post: all tests passed\n");
  return 0;
}

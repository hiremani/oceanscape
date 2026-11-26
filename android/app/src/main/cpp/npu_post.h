// The NPU detector's image maths, with no Android or RKNN dependencies, so the Mac builds and tests it
// (tools/npu/test): the camera frame (YUV 4:2:0 planes) letterboxed into the model's square RGB input,
// and YOLOX's output heads decoded into boxes back in the camera frame's pixels.
#pragma once

#include <cstdint>
#include <vector>

namespace npu {

// The 8 COCO classes the HUD uses, by COCO index (yolox_s is trained on all 80). A detection whose best
// class is anything else (a dog, a chair) is dropped rather than relabelled as the nearest kept class.
enum Kind : int { PERSON = 0, BICYCLE = 1, CAR = 2, MOTORCYCLE = 3, BUS = 5, TRUCK = 7, TRAFFIC_LIGHT = 9, STOP_SIGN = 11 };
bool kept_class(int coco);
const char* kind_name(int coco);   // the protocol's "k": person, bicycle, car, motorcycle, bus, truck, traffic_light, stop_sign

// Where the camera frame sits inside the model's square input: scaled by `scale`, offset by (padX, padY).
struct Letterbox {
  int srcW = 0, srcH = 0, dst = 640;
  float scale = 1.f;
  int padX = 0, padY = 0;
};
Letterbox letterbox_for(int srcW, int srcH, int dst);

// YUV 4:2:0 (any plane layout: I420, NV12, NV21, as android.media.Image hands it over) to RGB888, letterboxed
// into dst x dst with the pad value 114 (what YOLOX was trained with), nearest-neighbour sampling.
// out must hold dst * dst * 3 bytes.
void yuv420_to_rgb_letterbox(const uint8_t* y, const uint8_t* u, const uint8_t* v, int srcW, int srcH,
                             int yRowStride, int uvRowStride, int uvPixelStride, const Letterbox& lb, uint8_t* out);

// One output head as the runtime reports it.
enum Layout : int { NCHW = 0, NHWC = 1 };
struct Head {
  const void* data = nullptr;
  bool int8 = true;          // int8 affine-quantised (zp, scale), else float32
  int32_t zp = 0;
  float scale = 1.f;
  Layout layout = NCHW;
  int channels = 85;         // 4 box + 1 objectness + classes
  int gridH = 0, gridW = 0;
  int stride = 0;            // input pixels per grid cell (8, 16, 32)
};

struct Det {
  int cls = 0;               // COCO index
  float score = 0.f;         // objectness x class probability
  float x1 = 0, y1 = 0, x2 = 0, y2 = 0;   // camera frame pixels, clipped to it
};

struct Params {
  float scoreMin = 0.35f;
  float nmsIou = 0.45f;
  int maxDets = 32;
};

// The stride of a head from its grid against the input size (640 / 80 = 8), or 0 if it doesn't divide.
int stride_for(int inputSize, int gridH, int gridW);

// YOLOX heads (strides 8/16/32) as Rockchip's model zoo exports them: box x, y as offsets in grid cells,
// w, h as log sizes, objectness and class scores already through a sigmoid. Kept classes over scoreMin, per-class
// NMS, highest scores first, at most maxDets, mapped back through the letterbox and clipped to the frame.
std::vector<Det> decode_yolox(const std::vector<Head>& heads, const Letterbox& lb, const Params& p);

float iou(const Det& a, const Det& b);

// Exposed for tests: int8 affine quantisation as RKNN does it.
inline float deqnt(int8_t q, int32_t zp, float scale) { return (static_cast<float>(q) - static_cast<float>(zp)) * scale; }
int8_t qnt(float f, int32_t zp, float scale);

}  // namespace npu

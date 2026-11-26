// The NPU detector's native half (NpuNative.kt): a camera frame's YUV planes letterboxed into the model's
// input (npu_post.cpp), YOLOX run on the RK3588's NPU through Rockchip's runtime, and its heads decoded into
// boxes. The runtime is opened with dlopen, never linked: the system's own copy first, then the one bundled
// in the APK; a build without Rockchip's header (tools/npu/fetch_rknn.sh) compiles all of this out and says so.
#include <jni.h>
#include <android/log.h>
#include <dlfcn.h>

#include <chrono>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "npu_post.h"

#if NPU_HAVE_RKNN
#include "rknn_api.h"
#endif

#define LOG_TAG "WebHud"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

namespace {

using Clock = std::chrono::steady_clock;
double ms_since(Clock::time_point t) { return std::chrono::duration<double, std::milli>(Clock::now() - t).count(); }

#if NPU_HAVE_RKNN
struct Rknn {
  void* lib = nullptr;
  std::string path;
  decltype(&rknn_init) init = nullptr;
  decltype(&rknn_query) query = nullptr;
  decltype(&rknn_inputs_set) inputs_set = nullptr;
  decltype(&rknn_run) run = nullptr;
  decltype(&rknn_outputs_get) outputs_get = nullptr;
  decltype(&rknn_outputs_release) outputs_release = nullptr;
  decltype(&rknn_destroy) destroy = nullptr;
  decltype(&rknn_set_core_mask) set_core_mask = nullptr;   // optional
};

template <typename F>
bool sym(void* lib, const char* name, F& out) {
  out = reinterpret_cast<F>(dlsym(lib, name));
  return out != nullptr;
}
#endif

struct Ctx {
  std::mutex lock;   // the pipeline's output and inference threads share it: preprocess and infer never overlap
  std::string error = "model not loaded";
  std::string runtime;
  int inSize = 640;
  std::vector<uint8_t> input;
  npu::Letterbox lb;
  bool framed = false;   // a frame is in `input`
  double preMs = 0;
#if NPU_HAVE_RKNN
  Rknn rk;
  rknn_context ctx = 0;
  bool loaded = false;
  uint32_t nOut = 0;
  std::vector<rknn_tensor_attr> outAttr;
  bool int8Out = true;
#endif
};

#if NPU_HAVE_RKNN
// The runtime: the system's first (it matches the kernel driver the vendor shipped), then the APK's.
bool open_runtime(Ctx& c, const std::string& libDir) {
  const std::string candidates[] = {"/vendor/lib64/librknnrt.so", "/system/lib64/librknnrt.so", libDir + "/librknnrt.so", "librknnrt.so"};
  std::string tried;
  for (const std::string& p : candidates) {
    void* h = dlopen(p.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!h) {
      const char* e = dlerror();
      tried += p + ": " + (e ? e : "not loadable") + "; ";
      continue;
    }
    Rknn r;
    r.lib = h;
    r.path = p;
    if (sym(h, "rknn_init", r.init) && sym(h, "rknn_query", r.query) && sym(h, "rknn_inputs_set", r.inputs_set) &&
        sym(h, "rknn_run", r.run) && sym(h, "rknn_outputs_get", r.outputs_get) &&
        sym(h, "rknn_outputs_release", r.outputs_release) && sym(h, "rknn_destroy", r.destroy)) {
      sym(h, "rknn_set_core_mask", r.set_core_mask);
      c.rk = r;
      return true;
    }
    tried += p + ": missing symbols; ";
    dlclose(h);
  }
  c.error = "NPU runtime (librknnrt.so) not found or not loadable: " + tried;
  return false;
}

bool load_model(Ctx& c, std::vector<uint8_t>& model, const std::string& libDir) {
  if (!c.rk.lib && !open_runtime(c, libDir)) return false;
  c.runtime = c.rk.path;   // which copy loaded, even if the NPU then refuses
  int ret = c.rk.init(&c.ctx, model.data(), static_cast<uint32_t>(model.size()), 0, nullptr);
  if (ret != RKNN_SUCC) {
    c.error = "rknn_init failed (" + std::to_string(ret) + "): is the NPU driver (/dev/rknpu) reachable from the app?";
    c.ctx = 0;
    return false;
  }
  rknn_sdk_version ver{};
  if (c.rk.query(c.ctx, RKNN_QUERY_SDK_VERSION, &ver, sizeof(ver)) == RKNN_SUCC) {
    c.runtime = c.rk.path + " api " + ver.api_version + ", driver " + ver.drv_version;
  }
  if (c.rk.set_core_mask) c.rk.set_core_mask(c.ctx, RKNN_NPU_CORE_0);   // one core; the other two stay free
  rknn_input_output_num io{};
  if (c.rk.query(c.ctx, RKNN_QUERY_IN_OUT_NUM, &io, sizeof(io)) != RKNN_SUCC || io.n_input != 1 || io.n_output < 1) {
    c.error = "model has an unexpected number of inputs/outputs";
    return false;
  }
  rknn_tensor_attr in{};
  in.index = 0;
  if (c.rk.query(c.ctx, RKNN_QUERY_INPUT_ATTR, &in, sizeof(in)) != RKNN_SUCC || in.n_dims != 4) {
    c.error = "could not read the model's input";
    return false;
  }
  // NHWC [1, H, W, 3] or NCHW [1, 3, H, W]; square either way
  c.inSize = static_cast<int>(in.fmt == RKNN_TENSOR_NCHW ? in.dims[2] : in.dims[1]);
  if (c.inSize < 32 || c.inSize > 2048) {
    c.error = "model input size " + std::to_string(c.inSize) + " not supported";
    return false;
  }
  c.input.assign(static_cast<size_t>(c.inSize) * c.inSize * 3, 114);
  c.nOut = io.n_output;
  c.outAttr.assign(io.n_output, rknn_tensor_attr{});
  c.int8Out = true;
  for (uint32_t i = 0; i < io.n_output; i++) {
    c.outAttr[i].index = i;
    if (c.rk.query(c.ctx, RKNN_QUERY_OUTPUT_ATTR, &c.outAttr[i], sizeof(rknn_tensor_attr)) != RKNN_SUCC || c.outAttr[i].n_dims != 4) {
      c.error = "model output " + std::to_string(i) + " isn't a 4-D head (expected YOLOX's three)";
      return false;
    }
    if (c.outAttr[i].type != RKNN_TENSOR_INT8 || c.outAttr[i].qnt_type != RKNN_TENSOR_QNT_AFFINE_ASYMMETRIC) c.int8Out = false;
  }
  c.loaded = true;
  c.error.clear();
  LOGI("NPU: model loaded (%dx%d input, %u outputs, %s), %s", c.inSize, c.inSize, c.nOut, c.int8Out ? "int8" : "float", c.runtime.c_str());
  return true;
}

// The head as decode_yolox reads it, from the output's attributes.
npu::Head head_of(const rknn_tensor_attr& a, const void* data, bool int8, int inSize) {
  npu::Head h;
  h.data = data;
  h.int8 = int8;
  h.zp = a.zp;
  h.scale = a.scale;
  int c = static_cast<int>(a.dims[1]), gh = static_cast<int>(a.dims[2]), gw = static_cast<int>(a.dims[3]);
  h.layout = npu::NCHW;
  if (a.fmt == RKNN_TENSOR_NHWC || (c < 6 && a.dims[3] >= 6)) {
    h.layout = npu::NHWC;
    gh = static_cast<int>(a.dims[1]);
    gw = static_cast<int>(a.dims[2]);
    c = static_cast<int>(a.dims[3]);
  }
  h.channels = c;
  h.gridH = gh;
  h.gridW = gw;
  h.stride = npu::stride_for(inSize, gh, gw);
  return h;
}
#endif

Ctx* ctx_of(jlong h) { return reinterpret_cast<Ctx*>(h); }

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_ai_sunnypilot_webhud_NpuNative_create(JNIEnv*, jobject) {
  auto* c = new Ctx();
#if !NPU_HAVE_RKNN
  c->error = "this build has no NPU runtime (tools/npu/fetch_rknn.sh was not run before building)";
#endif
  c->input.assign(static_cast<size_t>(c->inSize) * c->inSize * 3, 114);
  return reinterpret_cast<jlong>(c);
}

JNIEXPORT jboolean JNICALL Java_ai_sunnypilot_webhud_NpuNative_hasRuntime(JNIEnv*, jobject) {
  return NPU_HAVE_RKNN ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jboolean JNICALL Java_ai_sunnypilot_webhud_NpuNative_loadModel(JNIEnv* env, jobject, jlong h, jbyteArray model, jstring libDir) {
  Ctx* c = ctx_of(h);
  if (!c) return JNI_FALSE;
  std::lock_guard<std::mutex> g(c->lock);
#if NPU_HAVE_RKNN
  if (c->loaded) return JNI_TRUE;
  std::vector<uint8_t> bytes(static_cast<size_t>(env->GetArrayLength(model)));
  env->GetByteArrayRegion(model, 0, static_cast<jsize>(bytes.size()), reinterpret_cast<jbyte*>(bytes.data()));
  const char* dir = env->GetStringUTFChars(libDir, nullptr);
  const std::string libs = dir ? dir : "";
  if (dir) env->ReleaseStringUTFChars(libDir, dir);
  const bool ok = load_model(*c, bytes, libs);
  if (!ok) LOGW("NPU: %s", c->error.c_str());
  return ok ? JNI_TRUE : JNI_FALSE;
#else
  (void)env; (void)model; (void)libDir;
  return JNI_FALSE;
#endif
}

JNIEXPORT jstring JNICALL Java_ai_sunnypilot_webhud_NpuNative_lastError(JNIEnv* env, jobject, jlong h) {
  Ctx* c = ctx_of(h);
  return env->NewStringUTF(c ? c->error.c_str() : "no context");
}

JNIEXPORT jstring JNICALL Java_ai_sunnypilot_webhud_NpuNative_runtime(JNIEnv* env, jobject, jlong h) {
  Ctx* c = ctx_of(h);
  return env->NewStringUTF(c ? c->runtime.c_str() : "");
}

JNIEXPORT jint JNICALL Java_ai_sunnypilot_webhud_NpuNative_inputSize(JNIEnv*, jobject, jlong h) {
  Ctx* c = ctx_of(h);
  return c ? c->inSize : 0;
}

// A decoded frame's planes (android.media.Image) into the model's input. Returns the time it took (ms), or -1.
JNIEXPORT jdouble JNICALL Java_ai_sunnypilot_webhud_NpuNative_preprocess(JNIEnv* env, jobject, jlong h, jobject y, jobject u, jobject v,
                                                                         jint w, jint hgt, jint yRow, jint uvRow, jint uvPix) {
  Ctx* c = ctx_of(h);
  if (!c || w <= 0 || hgt <= 0) return -1;
  auto* py = static_cast<const uint8_t*>(env->GetDirectBufferAddress(y));
  auto* pu = static_cast<const uint8_t*>(env->GetDirectBufferAddress(u));
  auto* pv = static_cast<const uint8_t*>(env->GetDirectBufferAddress(v));
  if (!py || !pu || !pv) return -1;
  // the planes must cover what the conversion reads
  const jlong ny = env->GetDirectBufferCapacity(y), nu = env->GetDirectBufferCapacity(u), nv = env->GetDirectBufferCapacity(v);
  const jlong needY = static_cast<jlong>(yRow) * (hgt - 1) + w;
  const jlong needUV = static_cast<jlong>(uvRow) * ((hgt - 1) / 2) + static_cast<jlong>(uvPix) * ((w - 1) / 2) + 1;
  if (ny < needY || nu < needUV || nv < needUV) return -1;
  std::lock_guard<std::mutex> g(c->lock);
  const auto t0 = Clock::now();
  c->lb = npu::letterbox_for(w, hgt, c->inSize);
  npu::yuv420_to_rgb_letterbox(py, pu, pv, w, hgt, yRow, uvRow, uvPix, c->lb, c->input.data());
  c->framed = true;
  c->preMs = ms_since(t0);
  return c->preMs;
}

// Runs the model on the last preprocessed frame. out: 6 floats per detection (coco class, score, x1, y1, x2, y2 in the
// frame's pixels); ms: [npu, post]. Returns the number of detections, or -1 (see lastError).
JNIEXPORT jint JNICALL Java_ai_sunnypilot_webhud_NpuNative_infer(JNIEnv* env, jobject, jlong h, jfloatArray out, jfloatArray ms,
                                                                 jfloat scoreMin, jfloat nmsIou) {
  Ctx* c = ctx_of(h);
  if (!c) return -1;
#if NPU_HAVE_RKNN
  std::lock_guard<std::mutex> g(c->lock);
  if (!c->loaded || !c->framed) return -1;
  const auto t0 = Clock::now();
  rknn_input in{};
  in.index = 0;
  in.buf = c->input.data();
  in.size = static_cast<uint32_t>(c->input.size());
  in.pass_through = 0;
  in.type = RKNN_TENSOR_UINT8;
  in.fmt = RKNN_TENSOR_NHWC;
  int ret = c->rk.inputs_set(c->ctx, 1, &in);
  if (ret == RKNN_SUCC) ret = c->rk.run(c->ctx, nullptr);
  std::vector<rknn_output> outs(c->nOut);
  for (uint32_t i = 0; i < c->nOut; i++) {
    outs[i] = rknn_output{};
    outs[i].index = i;
    outs[i].want_float = c->int8Out ? 0 : 1;
  }
  if (ret == RKNN_SUCC) ret = c->rk.outputs_get(c->ctx, c->nOut, outs.data(), nullptr);
  if (ret != RKNN_SUCC) {
    c->error = "inference failed (" + std::to_string(ret) + ")";
    return -1;
  }
  const double npuMs = ms_since(t0);
  const auto t1 = Clock::now();
  std::vector<npu::Head> heads;
  for (uint32_t i = 0; i < c->nOut; i++) heads.push_back(head_of(c->outAttr[i], outs[i].buf, c->int8Out, c->inSize));
  npu::Params p;
  p.scoreMin = scoreMin;
  p.nmsIou = nmsIou;
  const jsize cap = env->GetArrayLength(out) / 6;
  p.maxDets = static_cast<int>(cap);
  const std::vector<npu::Det> dets = npu::decode_yolox(heads, c->lb, p);
  c->rk.outputs_release(c->ctx, c->nOut, outs.data());
  std::vector<float> flat;
  flat.reserve(dets.size() * 6);
  for (const npu::Det& d : dets) {
    flat.insert(flat.end(), {static_cast<float>(d.cls), d.score, d.x1, d.y1, d.x2, d.y2});
  }
  if (!flat.empty()) env->SetFloatArrayRegion(out, 0, static_cast<jsize>(flat.size()), flat.data());
  const float t[2] = {static_cast<float>(npuMs), static_cast<float>(ms_since(t1))};
  env->SetFloatArrayRegion(ms, 0, 2, t);
  return static_cast<jint>(dets.size());
#else
  (void)env; (void)out; (void)ms; (void)scoreMin; (void)nmsIou;
  return -1;
#endif
}

JNIEXPORT void JNICALL Java_ai_sunnypilot_webhud_NpuNative_destroy(JNIEnv*, jobject, jlong h) {
  Ctx* c = ctx_of(h);
  if (!c) return;
  {
    std::lock_guard<std::mutex> g(c->lock);
#if NPU_HAVE_RKNN
    if (c->ctx && c->rk.destroy) c->rk.destroy(c->ctx);
    c->ctx = 0;
    // the runtime stays loaded: dlclose of a driver library mid-process isn't worth the risk
#endif
  }
  delete c;
}

}  // extern "C"

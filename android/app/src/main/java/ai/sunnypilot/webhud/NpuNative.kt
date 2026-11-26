package ai.sunnypilot.webhud

import android.util.Log
import java.nio.ByteBuffer

/**
 * libnpu.so (src/main/cpp/npu_jni.cpp): YUV planes letterboxed into the model's input, YOLOX on the NPU through
 * Rockchip's runtime (opened with dlopen, so its absence is a status, not a crash), boxes back in frame pixels.
 * A context is used by one pipeline; preprocess and infer lock it, so they may come from different threads.
 */
object NpuNative {
    /** Whether libnpu.so loaded at all (it is in every arm64 build; the JVM tests have none). */
    val loaded: Boolean = try {
        System.loadLibrary("npu")
        true
    } catch (e: Throwable) {
        Log.w("WebHud", "NPU: native library unavailable: ${e.message}")
        false
    }

    external fun create(): Long
    /** Whether this build has the NPU code at all (Rockchip's header was there when it was built). */
    external fun hasRuntime(): Boolean
    external fun loadModel(handle: Long, model: ByteArray, nativeLibDir: String): Boolean
    external fun lastError(handle: Long): String
    external fun runtime(handle: Long): String
    external fun inputSize(handle: Long): Int
    /** The frame's planes (direct buffers, as android.media.Image gives them) into the input; the time it took (ms), or -1. */
    external fun preprocess(handle: Long, y: ByteBuffer, u: ByteBuffer, v: ByteBuffer, width: Int, height: Int,
                            yRowStride: Int, uvRowStride: Int, uvPixelStride: Int): Double
    /** Runs the model; [out] gets 6 floats a detection (COCO class, score, x1, y1, x2, y2), [ms] [npu, post]; -1 on failure. */
    external fun infer(handle: Long, out: FloatArray, ms: FloatArray, scoreMin: Float, nmsIou: Float): Int
    external fun destroy(handle: Long)
}

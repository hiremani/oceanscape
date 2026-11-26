package ai.sunnypilot.webhud

import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The NPU detector's wire formats, kept free of Android so the JVM tests cover them.
 *
 * In: the comma's `/video` frames (sunnypilot webhud/video.py): a 16-byte little-endian header `<BBHIQ` (kind = 1,
 * flags bit 0 = keyframe, camera index, frameId, timestampEof in ns) and the H.264 access unit (Annex B).
 *
 * Out, protocol v1 on the app's `/npu` WebSocket (the page's static/js/npu.js):
 *   page -> app  {"cmd":"start","camera":"road"|"wide"} (optional "dry":true: decode and preprocess without the NPU,
 *                for checking a device that has none), {"cmd":"stop"}
 *   app -> page  {"v":1,"frameId","tsNs","camera","w","h","model","fps","ms":{decode,pre,npu,post,total},
 *                 "dets":[{"k","s","b":[x1,y1,x2,y2]}]} per inferred frame, and {"v":1,"status":{...}} on connect and
 *                 whenever it changes. GET /npu/status answers the status object alone.
 */
object NpuProtocol {
    const val VERSION = 1
    const val HEADER_BYTES = 16
    val CAMERAS = listOf("road", "wide")

    class FrameHeader(val key: Boolean, val camera: String, val frameId: Long, val tsNs: Long)

    /** The header of a binary `/video` message, or null if it isn't a frame. */
    fun parseFrame(msg: ByteArray): FrameHeader? {
        if (msg.size < HEADER_BYTES) return null
        val b = ByteBuffer.wrap(msg, 0, HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN)
        if (b.get().toInt() and 0xFF != 1) return null
        val flags = b.get().toInt() and 0xFF
        val cam = b.short.toInt() and 0xFFFF
        val frameId = b.int.toLong() and 0xFFFFFFFFL
        val ts = b.long
        return FrameHeader(flags and 1 == 1, CAMERAS.getOrElse(cam) { "road" }, frameId, ts)
    }

    /** NAL unit types and payload offsets (after the start code) of an Annex B access unit. */
    fun nalUnits(data: ByteArray, from: Int = 0): List<Pair<Int, Int>> {
        val out = ArrayList<Pair<Int, Int>>()
        var i = from
        while (i + 3 < data.size) {
            if (data[i].toInt() == 0 && data[i + 1].toInt() == 0) {
                val sc = if (data[i + 2].toInt() == 1) 3 else if (data[i + 2].toInt() == 0 && data[i + 3].toInt() == 1) 4 else 0
                if (sc > 0) {
                    val start = i + sc
                    if (start < data.size) out += (data[start].toInt() and 0x1F) to start
                    i = start
                    continue
                }
            }
            i++
        }
        return out
    }

    /** The SPS and PPS of a keyframe (each with a 4-byte start code, as MediaCodec's csd-0/csd-1 want), or null. */
    fun parameterSets(data: ByteArray, from: Int = HEADER_BYTES): Pair<ByteArray, ByteArray>? {
        val units = nalUnits(data, from)
        var sps: ByteArray? = null
        var pps: ByteArray? = null
        for ((k, nal) in units.withIndex()) {
            val end = if (k + 1 < units.size) startCodeBefore(data, units[k + 1].second) else data.size
            val unit = START + data.copyOfRange(nal.second, end)
            if (nal.first == 7 && sps == null) sps = unit
            if (nal.first == 8 && pps == null) pps = unit
        }
        return if (sps != null && pps != null) sps to pps else null
    }

    private val START = byteArrayOf(0, 0, 0, 1)

    private fun startCodeBefore(data: ByteArray, payload: Int): Int {
        var e = payload - 3   // 00 00 01
        if (e > 0 && data[e - 1].toInt() == 0) e--   // 00 00 00 01
        return e
    }

    /** A page's command, or null if it isn't one: ("start", camera, dry) or ("stop", null, false). */
    fun parseCommand(text: String): Triple<String, String?, Boolean>? = try {
        val j = JSONObject(text)
        when (j.optString("cmd")) {
            "start" -> Triple("start", j.optString("camera", "road").takeIf { it in CAMERAS } ?: "road", j.optBoolean("dry", false))
            "stop" -> Triple("stop", null, false)
            else -> null
        }
    } catch (e: Exception) {
        null
    }

    /** The comma /video stream's own text messages the page needs to place boxes (npu.js): the camera calibration and
     *  the model's road. The pipeline passes these on to /npu as they come, so the page needn't open /video itself. */
    val PASS_THROUGH = setOf("calib", "model")

    fun isPassThrough(text: String): Boolean = try {
        JSONObject(text).optString("type") in PASS_THROUGH
    } catch (e: Exception) {
        false
    }

    class Detection(val coco: Int, val score: Float, val x1: Float, val y1: Float, val x2: Float, val y2: Float)

    /** The protocol's class name for a COCO index (the eight the detector keeps), or null for any other. */
    fun kind(coco: Int): String? = when (coco) {
        0 -> "person"
        1 -> "bicycle"
        2 -> "car"
        3 -> "motorcycle"
        5 -> "bus"
        7 -> "truck"
        9 -> "traffic_light"
        11 -> "stop_sign"
        else -> null
    }

    fun result(
        frame: FrameHeader, w: Int, h: Int, model: String, fps: Double,
        decodeMs: Double, preMs: Double, npuMs: Double, postMs: Double, totalMs: Double,
        dets: List<Detection>, dry: Boolean = false,
    ): String {
        val arr = JSONArray()
        for (d in dets) {
            val k = kind(d.coco) ?: continue
            arr.put(JSONObject().put("k", k).put("s", r3(d.score.toDouble()))
                .put("b", JSONArray().put(r1(d.x1.toDouble())).put(r1(d.y1.toDouble())).put(r1(d.x2.toDouble())).put(r1(d.y2.toDouble()))))
        }
        val j = JSONObject().put("v", VERSION).put("frameId", frame.frameId).put("tsNs", frame.tsNs).put("camera", frame.camera)
            .put("w", w).put("h", h).put("model", model).put("fps", r1(fps))
            .put("ms", JSONObject().put("decode", r1(decodeMs)).put("pre", r1(preMs)).put("npu", r1(npuMs)).put("post", r1(postMs)).put("total", r1(totalMs)))
            .put("dets", arr)
        if (dry) j.put("dry", true)
        return j.toString()
    }

    fun status(available: Boolean, reason: String, runtime: String, model: String, running: Boolean, fps: Double, ms: JSONObject?): JSONObject =
        JSONObject().put("available", available).put("reason", reason).put("runtime", runtime).put("model", model)
            .put("running", running).put("fps", r1(fps)).put("ms", ms ?: JSONObject())

    fun statusMessage(status: JSONObject): String = JSONObject().put("v", VERSION).put("status", status).toString()

    private fun r1(v: Double) = if (v.isFinite()) Math.round(v * 10) / 10.0 else 0.0
    private fun r3(v: Double) = if (v.isFinite()) Math.round(v * 1000) / 1000.0 else 0.0
}

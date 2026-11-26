package ai.sunnypilot.webhud

import android.content.res.AssetManager
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * The NPU detector on the car (Reality View phase 3): the comma's road camera, straight from its `/video`
 * WebSocket (not through the page), decoded by the hardware H.264 decoder, letterboxed and run through YOLOX on
 * the RK3588's NPU (NpuNative), the boxes sent to the page (NpuHub, protocol v1 in NpuProtocol).
 *
 * Three threads per run: the network one reads frames and feeds the decoder; the decoder's output one takes a
 * frame only while the NPU is idle (so the NPU always gets the newest frame and nothing queues up behind it),
 * converts it and hands it over; the inference one runs the model and sends the result. One inference is ever in
 * flight. [stop] never blocks: it flags the run and closes its socket, and the threads wind down on their own.
 */
class NpuPipeline(
    private val assets: AssetManager,
    private val nativeLibDir: String,
    private val deviceOf: () -> InetSocketAddress?,
) : NpuEngine {
    override var onStatusChange: (() -> Unit)? = null

    @Volatile private var available = false
    @Volatile private var reason = "not checked yet"
    @Volatile private var runtime = ""
    @Volatile private var run: Run? = null
    @Volatile private var fps = 0.0
    @Volatile private var lastMs: JSONObject? = null
    private var handle = 0L
    private val prepared = AtomicBoolean()

    /** Loads the native library and the model, once; afterwards [available] and [reason] say how it went. */
    @Synchronized
    private fun prepare() {
        if (prepared.get()) return
        prepared.set(true)
        if (!NpuNative.loaded) {
            reason = "the app's native NPU library (libnpu.so) didn't load"
            return
        }
        handle = NpuNative.create()
        if (!NpuNative.hasRuntime()) {
            reason = NpuNative.lastError(handle)
            return
        }
        val model = try {
            assets.open(MODEL_ASSET).use { it.readBytes() }
        } catch (e: FileNotFoundException) {
            reason = "no model in this build (tools/npu/convert_yolox.sh was not run before building)"
            return
        } catch (e: IOException) {
            reason = "model unreadable: ${e.message}"
            return
        }
        available = NpuNative.loadModel(handle, model, nativeLibDir)
        runtime = NpuNative.runtime(handle)
        reason = if (available) "" else NpuNative.lastError(handle)
        Log.i(TAG, if (available) "NPU: ready, $runtime" else "NPU: unavailable: $reason")
    }

    override fun status(): JSONObject {
        prepare()
        return NpuProtocol.status(available, reason, runtime, MODEL, run != null, fps, lastMs)
    }

    override fun start(camera: String, dry: Boolean, sink: (String) -> Unit) {
        prepare()
        run?.cancel()
        run = null
        fps = 0.0
        if (available || dry) {
            if (dry && !NpuNative.loaded) {
                reason = "the app's native NPU library (libnpu.so) didn't load"
            } else {
                run = Run(camera, dry, sink).also { it.begin() }
            }
        }
        notifyStatus()
    }

    override fun stop() {
        run?.cancel()
        run = null
        fps = 0.0
        notifyStatus()
    }

    private fun notifyStatus() {
        try {
            onStatusChange?.invoke()
        } catch (e: Exception) {
            Log.w(TAG, "NPU: status listener failed: ${e.message}")
        }
    }

    // ---- one run (start to stop) ---------------------------------------------------------------------

    private class Meta(val frame: NpuProtocol.FrameHeader, val seq: Long, val receivedNs: Long, val queuedNs: Long)
    private class Pending(val meta: Meta, val w: Int, val h: Int, val decodeMs: Double, val preMs: Double)

    private inner class Run(val camera: String, val dry: Boolean, val sink: (String) -> Unit) {
        @Volatile var alive = true
        @Volatile private var socket: Socket? = null
        private var codec: MediaCodec? = null
        private var output: Thread? = null
        private var seq = 0L
        private var needKey = true
        private val ring = arrayOfNulls<Meta>(RING)
        private val busy = AtomicBoolean()
        private val pending = ArrayBlockingQueue<Pending>(1)
        private var lastResultNs = 0L
        private var intervalMs = 0.0

        fun begin() {
            thread(name = "npu-net", isDaemon = true) { netLoop() }
            thread(name = "npu-infer", isDaemon = true) { inferLoop() }
        }

        fun cancel() {
            alive = false
            socket?.closeQuietly()
        }

        // -- network: the comma's /video, frames into the decoder --

        private fun netLoop() {
            try {
                while (alive) {
                    val device = deviceOf()
                    if (device == null) {
                        Thread.sleep(RETRY_MS)
                        continue
                    }
                    try {
                        stream(device)
                    } catch (e: IOException) {
                        if (alive) {
                            Log.d(TAG, "NPU: video from $device: ${e.message}")
                            Thread.sleep(RETRY_MS)
                        }
                    }
                }
            } catch (e: InterruptedException) {
                // shutting down
            } catch (e: Exception) {
                Log.w(TAG, "NPU: video loop failed", e)
                reason = "video pipeline failed: ${e.message}"
                notifyStatus()
            } finally {
                alive = false
                socket?.closeQuietly()
                runCatching { output?.join(1000) }
                codec?.let { c -> runCatching { c.stop() }; runCatching { c.release() } }
                codec = null
            }
        }

        private fun stream(device: InetSocketAddress) {
            val s = Socket()
            socket = s
            if (!alive) {
                s.closeQuietly()
                return
            }
            s.tcpNoDelay = true
            s.connect(device, CONNECT_TIMEOUT_MS)
            s.soTimeout = READ_TIMEOUT_MS
            val out = s.getOutputStream()
            val host = "${device.hostString}:${device.port}"
            out.write(("GET /video?camera=$camera HTTP/1.1\r\nHost: $host\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                "Sec-WebSocket-Key: ${WsCodec.newKey()}\r\nSec-WebSocket-Version: 13\r\n\r\n").toByteArray(Charsets.ISO_8859_1))
            out.flush()
            val input = s.getInputStream()
            val head = readHead(input) ?: throw IOException("no handshake answer")
            if (!head.startsWith("HTTP/1.1 101")) throw IOException("handshake refused: ${head.substringBefore("\r\n")}")
            needKey = true
            // the page's camera message too, in case the server keys on it rather than the query
            WsCodec.writeText(out, "{\"type\":\"camera\",\"camera\":\"$camera\"}", mask = true)
            val reader = WsCodec.Reader(input, MAX_FRAME)
            while (alive) {
                val msg = reader.next()
                when (msg.opcode) {
                    WsCodec.BINARY -> onFrame(msg.payload)
                    // calibration and model messages go on to the page as they are (NpuProtocol.PASS_THROUGH)
                    WsCodec.TEXT -> msg.text.let { if (NpuProtocol.isPassThrough(it)) sink(it) }
                    WsCodec.PING -> WsCodec.write(out, WsCodec.PONG, msg.payload, mask = true)
                    WsCodec.CLOSE -> return
                }
            }
        }

        private fun onFrame(bytes: ByteArray) {
            val frame = NpuProtocol.parseFrame(bytes) ?: return
            if (frame.camera != camera) return
            val received = System.nanoTime()
            var c = codec
            if (c == null) {
                if (!frame.key) return
                val ps = NpuProtocol.parameterSets(bytes) ?: return
                c = createCodec(ps.first, ps.second)
                codec = c
                output = thread(name = "npu-dec", isDaemon = true) { outputLoop(c) }
            }
            if (needKey && !frame.key) return
            val idx = c.dequeueInputBuffer(INPUT_WAIT_US)
            if (idx < 0) {
                needKey = true   // a dropped frame breaks the picture until the next keyframe (every 5 frames)
                return
            }
            needKey = false
            val buf = c.getInputBuffer(idx) ?: return
            buf.clear()
            val len = bytes.size - NpuProtocol.HEADER_BYTES
            if (len > buf.capacity()) {
                c.queueInputBuffer(idx, 0, 0, 0, 0)
                needKey = true
                return
            }
            buf.put(bytes, NpuProtocol.HEADER_BYTES, len)
            val n = ++seq
            ring[(n % RING).toInt()] = Meta(frame, n, received, System.nanoTime())
            c.queueInputBuffer(idx, 0, len, n * PTS_STEP_US, if (frame.key) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
        }

        private fun createCodec(sps: ByteArray, pps: ByteArray): MediaCodec {
            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, 1280, 720)
            format.setByteBuffer("csd-0", ByteBuffer.wrap(sps))
            format.setByteBuffer("csd-1", ByteBuffer.wrap(pps))
            format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            format.setInteger(MediaFormat.KEY_PRIORITY, 0)   // realtime
            if (Build.VERSION.SDK_INT >= 30) format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
            val c = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            c.configure(format, null, null, 0)
            c.start()
            Log.i(TAG, "NPU: decoder ${c.name} started for the $camera camera")
            return c
        }

        // -- decoder output: the newest frame into the model's input while the NPU is idle --

        private fun outputLoop(c: MediaCodec) {
            val info = MediaCodec.BufferInfo()
            while (alive) {
                val idx = try {
                    c.dequeueOutputBuffer(info, OUTPUT_WAIT_US)
                } catch (e: IllegalStateException) {
                    break
                }
                if (idx < 0) continue
                try {
                    val n = info.presentationTimeUs / PTS_STEP_US
                    val meta = ring[(n % RING).toInt()]?.takeIf { it.seq == n }
                    if (meta != null && !busy.get()) {
                        val decodeMs = (System.nanoTime() - meta.queuedNs) / 1e6
                        val got = convert(c, idx)
                        if (got != null) {
                            busy.set(true)
                            if (!pending.offer(Pending(meta, got.first, got.second, decodeMs, got.third))) busy.set(false)
                        }
                    }
                } catch (e: IllegalStateException) {
                    break
                } finally {
                    runCatching { c.releaseOutputBuffer(idx, false) }
                }
            }
        }

        /** The output buffer's frame into the model's input: (width, height, ms), or null. */
        private fun convert(c: MediaCodec, idx: Int): Triple<Int, Int, Double>? {
            val img = c.getOutputImage(idx)
            if (img != null) {
                img.use {
                    val crop = it.cropRect
                    val w = crop.width()
                    val h = crop.height()
                    val p = it.planes
                    if (p.size < 3) return null
                    val y = offset(p[0].buffer, crop.top * p[0].rowStride + crop.left * p[0].pixelStride)
                    val u = offset(p[1].buffer, (crop.top / 2) * p[1].rowStride + (crop.left / 2) * p[1].pixelStride)
                    val v = offset(p[2].buffer, (crop.top / 2) * p[2].rowStride + (crop.left / 2) * p[2].pixelStride)
                    val ms = NpuNative.preprocess(handle, y, u, v, w, h, p[0].rowStride, p[1].rowStride, p[1].pixelStride)
                    return if (ms >= 0) Triple(w, h, ms) else null
                }
            }
            // no Image for this decoder's format: planar or semi-planar 4:2:0 from the raw buffer
            val buf = c.getOutputBuffer(idx) ?: return null
            val f = c.outputFormat
            val w = f.getInteger(MediaFormat.KEY_WIDTH)
            val h = f.getInteger(MediaFormat.KEY_HEIGHT)
            val stride = if (f.containsKey(MediaFormat.KEY_STRIDE)) f.getInteger(MediaFormat.KEY_STRIDE) else w
            val slice = if (f.containsKey(MediaFormat.KEY_SLICE_HEIGHT)) f.getInteger(MediaFormat.KEY_SLICE_HEIGHT) else h
            val colour = if (f.containsKey(MediaFormat.KEY_COLOR_FORMAT)) f.getInteger(MediaFormat.KEY_COLOR_FORMAT) else -1
            val uvStart = stride * slice
            val ms = when (colour) {
                MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420SemiPlanar ->
                    NpuNative.preprocess(handle, offset(buf, 0), offset(buf, uvStart), offset(buf, uvStart + 1), w, h, stride, stride, 2)
                MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Planar ->
                    NpuNative.preprocess(handle, offset(buf, 0), offset(buf, uvStart), offset(buf, uvStart + (stride / 2) * (slice / 2)), w, h, stride, stride / 2, 1)
                else -> {
                    reason = "the decoder's colour format ($colour) isn't supported"
                    -1.0
                }
            }
            return if (ms >= 0) Triple(w, h, ms) else null
        }

        private fun offset(b: ByteBuffer, at: Int): ByteBuffer {
            if (at == 0 && b.position() == 0) return b
            val d = b.duplicate()
            d.position(b.position() + at)
            return d.slice()
        }

        // -- inference: the model, the result to the page --

        private fun inferLoop() {
            val out = FloatArray(6 * MAX_DETS)
            val ms = FloatArray(2)
            while (alive) {
                val p = try {
                    pending.poll(100, TimeUnit.MILLISECONDS)
                } catch (e: InterruptedException) {
                    break
                } ?: continue
                try {
                    val n = if (dry) 0 else NpuNative.infer(handle, out, ms, SCORE_MIN, NMS_IOU)
                    if (n < 0) {
                        val err = NpuNative.lastError(handle)
                        if (err != reason) {
                            reason = err
                            Log.w(TAG, "NPU: $err")
                            notifyStatus()
                        }
                        continue
                    }
                    val dets = (0 until n).map { i ->
                        NpuProtocol.Detection(out[i * 6].toInt(), out[i * 6 + 1], out[i * 6 + 2], out[i * 6 + 3], out[i * 6 + 4], out[i * 6 + 5])
                    }
                    val now = System.nanoTime()
                    if (lastResultNs != 0L) {
                        val dt = (now - lastResultNs) / 1e6
                        intervalMs = if (intervalMs == 0.0) dt else intervalMs + 0.2 * (dt - intervalMs)
                        fps = if (intervalMs > 0) 1000.0 / intervalMs else 0.0
                    }
                    lastResultNs = now
                    val npuMs = if (dry) 0.0 else ms[0].toDouble()
                    val postMs = if (dry) 0.0 else ms[1].toDouble()
                    val totalMs = (now - p.meta.receivedNs) / 1e6
                    lastMs = JSONObject().put("decode", round1(p.decodeMs)).put("pre", round1(p.preMs)).put("npu", round1(npuMs))
                        .put("post", round1(postMs)).put("total", round1(totalMs))
                    if (alive) {
                        sink(NpuProtocol.result(p.meta.frame, p.w, p.h, MODEL, fps, p.decodeMs, p.preMs, npuMs, postMs, totalMs, dets, dry))
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "NPU: inference step failed", e)
                } finally {
                    busy.set(false)
                }
            }
        }
    }

    private fun readHead(input: InputStream): String? {
        val buf = ByteArrayOutputStream()
        var last4 = 0
        while (buf.size() < 16 * 1024) {
            val b = input.read()
            if (b < 0) return null
            buf.write(b)
            last4 = (last4 shl 8 or b) and 0xFFFFFFFF.toInt()
            if (last4 == 0x0D0A0D0A) return String(buf.toByteArray(), Charsets.ISO_8859_1)
        }
        return null
    }

    private fun round1(v: Double) = if (v.isFinite()) Math.round(v * 10) / 10.0 else 0.0

    companion object {
        private const val TAG = "WebHud"
        const val MODEL = "yolox_s-640-i8"
        const val MODEL_ASSET = "npu/$MODEL.rknn"
        private const val RING = 64
        private const val PTS_STEP_US = 50_000L
        private const val INPUT_WAIT_US = 20_000L
        private const val OUTPUT_WAIT_US = 10_000L
        private const val CONNECT_TIMEOUT_MS = 2000
        private const val READ_TIMEOUT_MS = 5000
        private const val RETRY_MS = 1000L
        private const val MAX_FRAME = 8 * 1024 * 1024
        private const val MAX_DETS = 32
        private const val SCORE_MIN = 0.35f
        private const val NMS_IOU = 0.45f
    }
}

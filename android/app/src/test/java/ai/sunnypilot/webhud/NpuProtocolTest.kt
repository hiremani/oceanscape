package ai.sunnypilot.webhud

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder

class NpuProtocolTest {
    /** A /video message as the comma sends it (webhud/video.py FRAME_HEADER <BBHIQ + Annex B). */
    private fun frame(key: Boolean, camera: Int, frameId: Long, tsNs: Long, payload: ByteArray): ByteArray {
        val b = ByteBuffer.allocate(16 + payload.size).order(ByteOrder.LITTLE_ENDIAN)
        b.put(1).put(if (key) 1 else 0).putShort(camera.toShort()).putInt(frameId.toInt()).putLong(tsNs).put(payload)
        return b.array()
    }

    private val sps = byteArrayOf(0x67, 0x42, 0x00, 0x1f, 0x11)
    private val pps = byteArrayOf(0x68, 0xce.toByte(), 0x3c, 0x80.toByte())
    private val idr = byteArrayOf(0x65, 0x88.toByte(), 0x84.toByte(), 0x00, 0x33)
    private fun annexB(vararg units: ByteArray, long: Boolean = true): ByteArray {
        val out = ByteArrayOutputStream()
        for (u in units) {
            out.write(if (long) byteArrayOf(0, 0, 0, 1) else byteArrayOf(0, 0, 1))
            out.write(u)
        }
        return out.toByteArray()
    }

    @Test fun parsesFrameHeader() {
        val f = NpuProtocol.parseFrame(frame(true, 1, 0xFFFFFFF0L, 1_234_567_890_123L, byteArrayOf(9)))!!
        assertTrue(f.key)
        assertEquals("wide", f.camera)
        assertEquals(0xFFFFFFF0L, f.frameId)   // unsigned
        assertEquals(1_234_567_890_123L, f.tsNs)
        val g = NpuProtocol.parseFrame(frame(false, 0, 7, 1, ByteArray(0)))!!
        assertFalse(g.key)
        assertEquals("road", g.camera)
    }

    @Test fun rejectsNonFrames() {
        assertNull(NpuProtocol.parseFrame(ByteArray(15)))
        val notFrame = frame(true, 0, 1, 1, byteArrayOf(1)).also { it[0] = 2 }
        assertNull(NpuProtocol.parseFrame(notFrame))
    }

    @Test fun findsParameterSetsForTheDecoder() {
        val msg = frame(true, 0, 1, 1, annexB(sps, pps, idr))
        val (s, p) = NpuProtocol.parameterSets(msg)!!
        assertArrayEquals(byteArrayOf(0, 0, 0, 1) + sps, s)
        assertArrayEquals(byteArrayOf(0, 0, 0, 1) + pps, p)
        // 3-byte start codes too
        val short = frame(true, 0, 1, 1, annexB(sps, pps, idr, long = false))
        assertArrayEquals(byteArrayOf(0, 0, 0, 1) + sps, NpuProtocol.parameterSets(short)!!.first)
        // a P frame has none
        assertNull(NpuProtocol.parameterSets(frame(false, 0, 2, 1, annexB(byteArrayOf(0x41, 0x9a.toByte())))))
    }

    @Test fun parsesCommands() {
        assertEquals(Triple("start", "road", false), NpuProtocol.parseCommand("""{"cmd":"start","camera":"road"}"""))
        assertEquals(Triple("start", "wide", true), NpuProtocol.parseCommand("""{"cmd":"start","camera":"wide","dry":true}"""))
        assertEquals("road", NpuProtocol.parseCommand("""{"cmd":"start","camera":"driver"}""")!!.second)
        assertEquals(Triple("stop", null, false), NpuProtocol.parseCommand("""{"cmd":"stop"}"""))
        assertNull(NpuProtocol.parseCommand("""{"cmd":"explode"}"""))
        assertNull(NpuProtocol.parseCommand("not json"))
    }

    @Test fun resultMessageIsProtocolV1() {
        val hdr = NpuProtocol.FrameHeader(false, "road", 42, 9_000_000_000L)
        val dets = listOf(
            NpuProtocol.Detection(2, 0.8765f, 400.04f, 300f, 600f, 420f),
            NpuProtocol.Detection(0, 0.5f, 1000f, 360f, 1040f, 460f),
            NpuProtocol.Detection(16, 0.9f, 1f, 1f, 2f, 2f),   // a dog: not one of the eight, left out
        )
        val j = JSONObject(NpuProtocol.result(hdr, 1280, 720, "yolox_s-640-i8", 14.96, 4.04, 2.5, 30.12, 0.8, 41.0, dets))
        assertEquals(1, j.getInt("v"))
        assertEquals(42L, j.getLong("frameId"))
        assertEquals(9_000_000_000L, j.getLong("tsNs"))
        assertEquals("road", j.getString("camera"))
        assertEquals(1280, j.getInt("w"))
        assertEquals(720, j.getInt("h"))
        assertEquals("yolox_s-640-i8", j.getString("model"))
        assertEquals(15.0, j.getDouble("fps"), 1e-9)
        val ms = j.getJSONObject("ms")
        for (k in listOf("decode", "pre", "npu", "post", "total")) assertTrue(k, ms.has(k))
        assertEquals(30.1, ms.getDouble("npu"), 1e-9)
        val d = j.getJSONArray("dets")
        assertEquals(2, d.length())
        assertEquals("car", d.getJSONObject(0).getString("k"))
        assertEquals(0.877, d.getJSONObject(0).getDouble("s"), 1e-9)
        assertEquals(400.0, d.getJSONObject(0).getJSONArray("b").getDouble(0), 1e-9)
        assertEquals("person", d.getJSONObject(1).getString("k"))
        assertFalse(j.has("dry"))
    }

    @Test fun kindsAreTheEightClasses() {
        val kept = (0..79).mapNotNull { NpuProtocol.kind(it) }
        assertEquals(listOf("person", "bicycle", "car", "motorcycle", "bus", "truck", "traffic_light", "stop_sign"), kept)
    }

    @Test fun statusMessage() {
        val s = NpuProtocol.status(false, "no runtime", "", "yolox_s-640-i8", false, 0.0, null)
        val m = JSONObject(NpuProtocol.statusMessage(s))
        assertEquals(1, m.getInt("v"))
        val st = m.getJSONObject("status")
        assertFalse(st.getBoolean("available"))
        assertEquals("no runtime", st.getString("reason"))
        for (k in listOf("runtime", "model", "running", "fps", "ms")) assertTrue(k, st.has(k))
    }

    // ---- WebSocket frames ----

    @Test fun acceptKeyMatchesRfc6455() {
        assertEquals("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", WsCodec.acceptKey("dGhlIHNhbXBsZSBub25jZQ=="))
    }

    @Test fun framesRoundTripMaskedAndNot() {
        for (size in listOf(0, 5, 125, 126, 1000, 65535, 70000)) for (mask in listOf(false, true)) {
            val payload = ByteArray(size) { (it * 7).toByte() }
            val out = ByteArrayOutputStream()
            WsCodec.write(out, WsCodec.BINARY, payload, mask)
            val m = WsCodec.Reader(ByteArrayInputStream(out.toByteArray()), 1 shl 20).next()
            assertEquals(WsCodec.BINARY, m.opcode)
            assertArrayEquals("size $size mask $mask", payload, m.payload)
        }
    }

    @Test fun joinsFragmentsAndPassesControlFrames() {
        // "Hel" + ping + "lo": RFC 6455 section 5.4's example with a control frame in between
        val bytes = byteArrayOf(0x01, 0x03, 0x48, 0x65, 0x6c, 0x89.toByte(), 0x00, 0x80.toByte(), 0x02, 0x6c, 0x6f)
        val reader = WsCodec.Reader(ByteArrayInputStream(bytes), 100)
        assertEquals(WsCodec.PING, reader.next().opcode)
        val m = reader.next()
        assertEquals(WsCodec.TEXT, m.opcode)
        assertEquals("Hello", m.text)
    }

    @Test(expected = IOException::class) fun refusesOversizedFrames() {
        val out = ByteArrayOutputStream()
        WsCodec.write(out, WsCodec.BINARY, ByteArray(2000))
        WsCodec.Reader(ByteArrayInputStream(out.toByteArray()), 1000).next()
    }

    @Test(expected = EOFException::class) fun endOfStream() {
        WsCodec.Reader(ByteArrayInputStream(byteArrayOf(0x81.toByte())), 100).next()
    }

    @Test
    fun passesOnOnlyCalibAndModelMessages() {
        assertTrue(NpuProtocol.isPassThrough("""{"type":"calib","rpy":[0,0.02,0]}"""))
        assertTrue(NpuProtocol.isPassThrough("""{"type":"model","frameId":7}"""))
        assertFalse(NpuProtocol.isPassThrough("""{"type":"camera","camera":"road"}"""))
        assertFalse(NpuProtocol.isPassThrough("""{"cmd":"start"}"""))
        assertFalse(NpuProtocol.isPassThrough("not json"))
    }
}

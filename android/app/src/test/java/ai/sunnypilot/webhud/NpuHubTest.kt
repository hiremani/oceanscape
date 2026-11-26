package ai.sunnypilot.webhud

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList

/** The `/npu` WebSocket through the real LocalServer, with a fake engine in place of the decoder and NPU. */
class NpuHubTest {
    private class FakeEngine : NpuEngine {
        override var onStatusChange: (() -> Unit)? = null
        val calls = CopyOnWriteArrayList<String>()
        @Volatile var sink: ((String) -> Unit)? = null
        @Volatile var running = false

        override fun start(camera: String, dry: Boolean, sink: (String) -> Unit) {
            calls += "start:$camera:$dry"
            this.sink = sink
            running = true
            onStatusChange?.invoke()
        }

        override fun stop() {
            calls += "stop"
            sink = null
            running = false
            onStatusChange?.invoke()
        }

        override fun status(): JSONObject = NpuProtocol.status(true, "", "fake", "yolox_s-640-i8", running, 0.0, null)
    }

    private val engine = FakeEngine()
    private val hub = NpuHub(engine)
    private val server = LocalServer(null, "test") {}.also { it.npu = hub; it.start() }

    @After fun tearDown() = server.stop()

    private class Client(port: Int) {
        val s = Socket("127.0.0.1", port).apply { soTimeout = 3000 }
        val head: String

        init {
            s.getOutputStream().write(("GET /npu HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n").toByteArray())
            val b = StringBuilder()
            val input = s.getInputStream()
            while (!b.endsWith("\r\n\r\n")) b.append(input.read().toChar())
            head = b.toString()
        }

        private val reader by lazy { WsCodec.Reader(s.getInputStream(), 1 shl 16) }
        fun send(text: String) = WsCodec.writeText(s.getOutputStream(), text, mask = true)
        fun next(): JSONObject = JSONObject(reader.next().text)
        /** The next message that isn't a status one. */
        fun nextResult(): JSONObject {
            while (true) {
                val m = next()
                if (!m.has("status")) return m
            }
        }
    }

    private fun waitFor(what: String, cond: () -> Boolean) {
        val until = System.currentTimeMillis() + 3000
        while (!cond()) {
            if (System.currentTimeMillis() > until) throw AssertionError("timed out waiting for $what")
            Thread.sleep(10)
        }
    }

    @Test fun handshakeThenStatus() {
        val c = Client(server.port)
        assertTrue(c.head, c.head.startsWith("HTTP/1.1 101"))
        assertTrue(c.head.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="))
        val st = c.next()
        assertEquals(1, st.getInt("v"))
        assertEquals("fake", st.getJSONObject("status").getString("runtime"))
        assertTrue(engine.calls.isEmpty())   // connecting alone starts nothing
    }

    @Test fun runsOnlyWhileAPageHasStarted() {
        val c = Client(server.port)
        c.next()
        c.send("""{"cmd":"start","camera":"road"}""")
        waitFor("start") { engine.calls.contains("start:road:false") }
        engine.sink!!("""{"v":1,"frameId":5,"dets":[]}""")
        assertEquals(5, c.nextResult().getInt("frameId"))
        c.send("""{"cmd":"stop"}""")
        waitFor("stop") { engine.calls.lastOrNull() == "stop" }
    }

    @Test fun stopsWhenTheLastSubscriberLeaves() {
        val a = Client(server.port)
        val b = Client(server.port)
        a.next(); b.next()
        a.send("""{"cmd":"start","camera":"road"}""")
        b.send("""{"cmd":"start","camera":"road"}""")
        waitFor("start") { engine.running }
        a.s.close()
        Thread.sleep(150)
        assertTrue("one page still watching", engine.running)
        b.s.close()
        waitFor("stop after the last page") { !engine.running }
        waitFor("sessions gone") { hub.subscribers == 0 }
    }

    @Test fun latestStartPicksTheCamera() {
        val a = Client(server.port)
        val b = Client(server.port)
        a.next(); b.next()
        a.send("""{"cmd":"start","camera":"road"}""")
        waitFor("road") { engine.calls.contains("start:road:false") }
        b.send("""{"cmd":"start","camera":"wide"}""")
        waitFor("wide") { engine.calls.contains("start:wide:false") }
        b.send("""{"cmd":"stop"}""")
        waitFor("back to road") { engine.calls.count { it == "start:road:false" } == 2 }
    }

    @Test fun resultsGoOnlyToStartedPages() {
        val watching = Client(server.port)
        val idle = Client(server.port)
        watching.next(); idle.next()
        watching.send("""{"cmd":"start","camera":"road"}""")
        waitFor("start") { engine.running }
        engine.sink!!("""{"v":1,"frameId":9,"dets":[]}""")
        assertEquals(9, watching.nextResult().getInt("frameId"))
        // the idle page gets status messages only
        idle.s.soTimeout = 300
        val seen = mutableListOf<JSONObject>()
        try { while (true) seen += idle.next() } catch (e: java.io.IOException) { /* nothing more */ }
        assertTrue(seen.isNotEmpty())
        assertTrue(seen.all { it.has("status") })
    }

    @Test fun statusOverHttp() {
        val s = Socket("127.0.0.1", server.port).apply { soTimeout = 3000 }
        s.getOutputStream().write("GET /npu/status HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".toByteArray())
        val text = s.getInputStream().readBytes().toString(Charsets.UTF_8)
        assertTrue(text, text.startsWith("HTTP/1.1 200"))
        val body = JSONObject(text.substringAfter("\r\n\r\n"))
        assertTrue(body.getBoolean("available"))
        assertEquals("yolox_s-640-i8", body.getString("model"))
    }

    @Test fun plainGetOnNpuIsRefused() {
        val s = Socket("127.0.0.1", server.port).apply { soTimeout = 3000 }
        s.getOutputStream().write("GET /npu HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".toByteArray())
        val text = s.getInputStream().readBytes().toString(Charsets.UTF_8)
        assertTrue(text, text.startsWith("HTTP/1.1 400"))
        assertFalse(engine.running)
    }
}

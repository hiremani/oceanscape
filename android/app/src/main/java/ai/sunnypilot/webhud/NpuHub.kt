package ai.sunnypilot.webhud

import android.util.Log
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap

/** What runs the detector (NpuPipeline on the car; a fake in the tests). */
interface NpuEngine {
    /** Starts (or switches to) [camera]; each inferred frame's result JSON goes to [sink]. [dry]: without the NPU. */
    fun start(camera: String, dry: Boolean, sink: (String) -> Unit)
    fun stop()
    /** The status object of protocol v1 (NpuProtocol.status). */
    fun status(): JSONObject
    /** Called with nothing whenever the status changes, so the hub can pass it on. */
    var onStatusChange: (() -> Unit)?
}

/**
 * The `/npu` WebSocket on the app's LocalServer (protocol v1, NpuProtocol): pages subscribe with start, and the
 * detector runs only while at least one has; results go to every started page, status changes to every page.
 * The camera is the last start's (two pages asking for different cameras get the latest one's).
 */
class NpuHub(private val engine: NpuEngine) {
    private inner class Session(val socket: Socket, val out: OutputStream) {
        @Volatile var started = false
        @Volatile var camera = "road"
        @Volatile var dry = false
        @Volatile var startedAt = 0L

        fun send(text: String): Boolean = try {
            synchronized(this) { WsCodec.writeText(out, text) }
            true
        } catch (e: IOException) {
            close()
            false
        }

        fun close() {
            socket.closeQuietly()
            if (sessions.remove(this)) update()
        }
    }

    private val sessions: MutableSet<Session> = ConcurrentHashMap.newKeySet()
    private val lock = Any()
    private var running: Pair<String, Boolean>? = null   // (camera, dry) the engine was started with
    private var seq = 0L

    init {
        engine.onStatusChange = { broadcastStatus() }
    }

    fun status(): JSONObject = engine.status()

    /** Subscribers right now (started or not), for tests and logs. */
    val subscribers: Int get() = sessions.size

    /**
     * Takes over [client], whose request [head] asked for the WebSocket upgrade on `/npu`: answers the handshake,
     * sends the status, then reads commands until the page goes away. Runs on the connection's own thread.
     */
    fun serve(client: Socket, head: String) {
        val key = header(head, "Sec-WebSocket-Key")
        val upgrade = header(head, "Upgrade")
        val out = try {
            client.getOutputStream()
        } catch (e: IOException) {
            client.closeQuietly()
            return
        }
        if (key == null || upgrade == null || !upgrade.equals("websocket", ignoreCase = true)) {
            runCatching {
                out.write("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
                out.flush()
            }
            client.closeQuietly()
            return
        }
        val session = Session(client, out)
        try {
            client.soTimeout = 0
            out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: ${WsCodec.acceptKey(key)}\r\n\r\n").toByteArray(Charsets.ISO_8859_1))
            out.flush()
        } catch (e: IOException) {
            client.closeQuietly()
            return
        }
        sessions += session
        session.send(NpuProtocol.statusMessage(engine.status()))
        try {
            val reader = WsCodec.Reader(client.getInputStream(), MAX_MESSAGE)
            while (true) {
                val msg = reader.next()
                when (msg.opcode) {
                    WsCodec.TEXT -> command(session, msg.text)
                    WsCodec.PING -> synchronized(session) { WsCodec.write(out, WsCodec.PONG, msg.payload) }
                    WsCodec.CLOSE -> {
                        runCatching { synchronized(session) { WsCodec.write(out, WsCodec.CLOSE, ByteArray(0)) } }
                        break
                    }
                }
            }
        } catch (e: IOException) {
            // the page went away
        } finally {
            session.close()
        }
    }

    private fun command(s: Session, text: String) {
        val cmd = NpuProtocol.parseCommand(text) ?: return
        if (cmd.first == "start") {
            s.camera = cmd.second ?: "road"
            s.dry = cmd.third
            s.startedAt = synchronized(lock) { ++seq }
            s.started = true
        } else {
            s.started = false
        }
        update()
    }

    /** Starts, switches or stops the engine for the started sessions. */
    private fun update() {
        synchronized(lock) {
            val latest = sessions.filter { it.started }.maxByOrNull { it.startedAt }
            val want = latest?.let { it.camera to it.dry }
            if (want == running) return
            if (want == null) {
                Log.i(TAG, "NPU: no subscribers, stopping")
                engine.stop()
            } else {
                Log.i(TAG, "NPU: starting on the ${want.first} camera${if (want.second) " (dry run)" else ""}")
                engine.start(want.first, want.second) { result -> broadcast(result) }
            }
            running = want
        }
        broadcastStatus()
    }

    private fun broadcast(text: String) {
        for (s in sessions) if (s.started) s.send(text)
    }

    private fun broadcastStatus() {
        val text = NpuProtocol.statusMessage(engine.status())
        for (s in sessions) s.send(text)
    }

    fun closeAll() = sessions.toList().forEach { it.close() }

    private fun header(head: String, name: String): String? {
        val prefix = "$name:"
        return head.split("\r\n").drop(1).firstOrNull { it.startsWith(prefix, ignoreCase = true) }?.substring(prefix.length)?.trim()
    }

    companion object {
        private const val TAG = "WebHud"
        private const val MAX_MESSAGE = 4096   // the page only sends small commands
    }
}

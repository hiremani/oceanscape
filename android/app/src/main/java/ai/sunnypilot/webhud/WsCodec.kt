package ai.sunnypilot.webhud

import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * The little of RFC 6455 the NPU detector needs: the handshake's accept key, and reading and writing frames.
 * The app's LocalServer otherwise relays WebSockets byte for byte; `/npu` is the one it speaks itself (to the
 * page), and NpuPipeline is a client of the comma's `/video`.
 */
object WsCodec {
    const val TEXT = 0x1
    const val BINARY = 0x2
    const val CLOSE = 0x8
    const val PING = 0x9
    const val PONG = 0xA
    private const val CONTINUATION = 0x0
    private const val GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
    private val random = SecureRandom()

    class Message(val opcode: Int, val payload: ByteArray) {
        val text: String get() = String(payload, Charsets.UTF_8)
    }

    /** Sec-WebSocket-Accept for a client's Sec-WebSocket-Key. */
    fun acceptKey(key: String): String =
        Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1").digest((key.trim() + GUID).toByteArray(Charsets.ISO_8859_1)))

    /** A fresh Sec-WebSocket-Key for a client handshake. */
    fun newKey(): String = Base64.getEncoder().encodeToString(ByteArray(16).also { random.nextBytes(it) })

    /**
     * Reads one connection's messages. A message may arrive in fragments with control frames (ping, close) between
     * them; those come back as they arrive, and the fragments read so far are kept for the next call.
     */
    class Reader(private val input: InputStream, private val maxBytes: Int) {
        private var opcode = -1
        private var buf = ByteArray(0)

        /** The next whole message or control frame. Throws EOFException at the end and IOException for one over maxBytes. */
        fun next(): Message {
            while (true) {
                val b0 = readByte(input)
                val b1 = readByte(input)
                val fin = b0 and 0x80 != 0
                val op = b0 and 0x0F
                val masked = b1 and 0x80 != 0
                var len = (b1 and 0x7F).toLong()
                if (len == 126L) len = (readByte(input).toLong() shl 8) or readByte(input).toLong()
                else if (len == 127L) {
                    len = 0
                    repeat(8) { len = (len shl 8) or readByte(input).toLong() }
                }
                if (len < 0 || len > maxBytes) throw IOException("WebSocket frame too large ($len bytes)")
                val mask = if (masked) ByteArray(4).also { readFully(input, it) } else null
                val payload = ByteArray(len.toInt())
                readFully(input, payload)
                if (mask != null) for (i in payload.indices) payload[i] = (payload[i].toInt() xor mask[i and 3].toInt()).toByte()
                if (op >= 0x8) return Message(op, payload)   // control frames stand alone, even between fragments
                if (op != CONTINUATION) {
                    opcode = op
                    buf = ByteArray(0)
                } else if (opcode < 0) {
                    throw IOException("WebSocket continuation without a start")
                }
                if (buf.size + payload.size > maxBytes) throw IOException("WebSocket message too large")
                buf = if (buf.isEmpty()) payload else buf + payload
                if (fin) {
                    val m = Message(opcode, buf)
                    opcode = -1
                    buf = ByteArray(0)
                    return m
                }
            }
        }
    }

    /** One unfragmented frame; [mask] for a client's frames (RFC 6455 requires it), not a server's. */
    fun write(out: OutputStream, opcode: Int, payload: ByteArray, mask: Boolean = false) {
        val head = java.io.ByteArrayOutputStream(14)
        head.write(0x80 or opcode)
        val m = if (mask) 0x80 else 0
        when {
            payload.size < 126 -> head.write(m or payload.size)
            payload.size <= 0xFFFF -> {
                head.write(m or 126)
                head.write(payload.size shr 8)
                head.write(payload.size and 0xFF)
            }
            else -> {
                head.write(m or 127)
                for (s in 56 downTo 0 step 8) head.write(((payload.size.toLong() shr s) and 0xFF).toInt())
            }
        }
        var body = payload
        if (mask) {
            val key = ByteArray(4).also { random.nextBytes(it) }
            head.write(key)
            body = ByteArray(payload.size) { i -> (payload[i].toInt() xor key[i and 3].toInt()).toByte() }
        }
        out.write(head.toByteArray())
        out.write(body)
        out.flush()
    }

    fun writeText(out: OutputStream, text: String, mask: Boolean = false) = write(out, TEXT, text.toByteArray(Charsets.UTF_8), mask)

    private fun readByte(input: InputStream): Int {
        val b = input.read()
        if (b < 0) throw EOFException()
        return b
    }

    private fun readFully(input: InputStream, buf: ByteArray) {
        var got = 0
        while (got < buf.size) {
            val n = input.read(buf, got, buf.size - got)
            if (n < 0) throw EOFException()
            got += n
        }
    }
}

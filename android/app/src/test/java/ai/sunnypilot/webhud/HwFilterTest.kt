package ai.sunnypilot.webhud

import org.junit.Assert.assertTrue
import org.junit.Test

class HwFilterTest {
    @Test
    fun everyReceivedIdPassesTheHardwareFilters() {
        for ((bus, ids) in CanIds.RX) {
            val f = CanIds.HW_FILTERS[bus] ?: error("no filter plan for $bus")
            val blocked = ids.filterNot { f.passes(it) }
            assertTrue("$bus blocks ${blocked.map { "0x%03X".format(it) }}", blocked.isEmpty())
        }
    }

    @Test
    fun pulsesOwnAppKeepsEveryIdTheDriverDefaultsPass() {
        val defaults = mapOf(
            "IBUS1" to (0x200..0x3FF) + (0x500..0x7FF),
            "IBUS2" to (0x200..0x23F) + (0x300..0x37F) + (0x500..0x53F) + (0x580..0x5BF),
        )
        for ((bus, ids) in defaults) {
            val blocked = ids.filterNot { CanIds.HW_FILTERS[bus]!!.passes(it) }
            assertTrue("$bus blocks ${blocked.map { "0x%03X".format(it) }}", blocked.isEmpty())
        }
    }

    @Test
    fun theChipsAreTheRightWayRound() {
        assertTrue(CanIds.HW_FILTERS["IBUS1"]!!.chip == 0 && CanIds.HW_FILTERS["IBUS2"]!!.chip == 1)
    }
}

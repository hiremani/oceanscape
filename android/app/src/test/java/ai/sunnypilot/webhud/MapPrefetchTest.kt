package ai.sunnypilot.webhud

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class MapPrefetchTest {
    @Test
    fun buildingCellsNearestFirstMatchTheComma() {
        // the same cells, in the same order, as the comma's buildings.py cells_within (its test uses this point)
        val cells = MapPrefetch.cellsWithin(37.5255, -121.9855, 1500.0, MapFeatures.BLD_DEG)
        assertEquals(Pair(3752, -12199), cells.first())
        assertEquals(cells.size, cells.toSet().size)
        for ((klat, _) in cells) assertTrue(abs((klat + 0.5) * MapFeatures.BLD_DEG - 37.5255) < 0.03)
        assertEquals(listOf(Pair(3752, -12199)), MapPrefetch.cellsWithin(37.5255, -121.9855, 0.0, MapFeatures.BLD_DEG))
    }

    @Test
    fun roadTilesUnchanged() {
        // tilesWithin is cellsWithin at the feature tile size: the point's own tile first
        val tiles = MapPrefetch.cellsWithin(37.5255, -121.9855, 25_000.0, MapFeatures.TILE_DEG)
        assertEquals(Pair(Math.floorDiv(3752, 25), Math.floorDiv(-12199, 25)), tiles.first())
        assertTrue(tiles.size in 4..16)
    }
}

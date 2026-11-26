package ai.sunnypilot.webhud

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Downloads every road tile ([MapTiles]) and feature tile ([MapFeatures]) within a radius of a point, in the
 * background, once asked (`POST /map/prefetch {lat, lon, radius_km, buildings_km}` from the page as the car moves;
 * the comma's own copy of the logic is maptiles.py MapPrefetch). Then the building cells ([MapFeatures.buildings])
 * within the much smaller buildings_km: a building cell is a 25th of a feature cell, and Overpass takes up to minutes
 * per cell. `POST /map/buildings/area {lat, lon, radius_km}` downloads an area's buildings on request, on a thread of
 * its own. Nothing fetched is ever dropped, so a stopped download picks up where it was.
 */
class MapPrefetch(private val tiles: MapTiles, private val features: MapFeatures) {
    private val lock = Any()
    private val wake = Object()
    @Volatile private var want: Triple<Double, Double, Double>? = null
    private var busy = false
    private var errors = 0
    private var updated = 0L
    private var thread: Thread? = null
    @Volatile private var buildingsKm = BUILDINGS_KM
    // the area download (POST /map/buildings/area)
    @Volatile private var area: Triple<Double, Double, Double>? = null
    private var areaBusy = false
    private var areaErrors = 0
    private var areaThread: Thread? = null
    @Volatile private var areaSeq = 0   // each request counts, so asking again retries the cells that failed

    /** The tile indices (tlat, tlon) of TILE_DEG tiles whose box comes within [radiusM] of the point, nearest first. */
    fun tilesWithin(lat: Double, lon: Double, radiusM: Double): List<Pair<Int, Int>> = cellsWithin(lat, lon, radiusM, TILE)

    fun request(lat: Double, lon: Double, radiusKm: Double, buildingsKm: Double = Double.NaN): JSONObject {
        require(lat in -90.0..90.0 && lon in -180.0..180.0) { "bad position" }
        val r = radiusKm.coerceIn(0.0, MAX_KM)
        if (!buildingsKm.isNaN()) this.buildingsKm = buildingsKm.coerceIn(0.0, MAX_BUILDINGS_KM)
        synchronized(lock) {
            want = Triple(lat, lon, r)
            if (thread == null) thread = Thread({ run() }, "webhud-map-prefetch").apply { isDaemon = true; start() }
        }
        synchronized(wake) { wake.notifyAll() }
        return status()
    }

    fun status(): JSONObject {
        val w = want
        val out = JSONObject()
        synchronized(lock) {
            out.put("busy", busy).put("errors", errors).put("updated", updated)
        }
        if (w == null) return out.put("center", JSONObject.NULL).put("radius_km", JSONObject.NULL).put("tiles", 0).put("roads_ready", 0).put("features_ready", 0)
        val list = tilesWithin(w.first, w.second, w.third * 1000.0)
        val bKm = min(buildingsKm, w.third)
        val bld = cellsWithin(w.first, w.second, bKm * 1000.0, MapFeatures.BLD_DEG)
        return out.put("center", JSONArray().put(w.first).put(w.second)).put("radius_km", w.third).put("tiles", list.size)
            .put("roads_ready", list.count { roadFile(it).isFile })
            .put("features_ready", list.count { features.haveTile(it.first, it.second) })
            .put("buildings_km", bKm).put("buildings", bld.size).put("buildings_ready", bld.count { features.haveBuildings(it.first, it.second) })
    }

    /** POST /map/buildings/area: download the buildings within [radiusKm] of the point, nearest first, in the background. */
    fun requestArea(lat: Double, lon: Double, radiusKm: Double): JSONObject {
        require(lat in -90.0..90.0 && lon in -180.0..180.0 && !radiusKm.isNaN()) { "bad position" }
        synchronized(lock) {
            area = Triple(lat, lon, radiusKm.coerceIn(0.0, MAX_BUILDINGS_KM))
            areaSeq++
            if (areaThread == null) areaThread = Thread({ runArea() }, "webhud-buildings-area").apply { isDaemon = true; start() }
        }
        synchronized(wake) { wake.notifyAll() }
        return areaStatus()
    }

    fun areaStatus(): JSONObject {
        val a = area ?: return JSONObject().put("center", JSONObject.NULL).put("radius_km", JSONObject.NULL).put("cells", 0)
            .put("ready", 0).put("busy", false).put("errors", 0)
        val cells = cellsWithin(a.first, a.second, a.third * 1000.0, MapFeatures.BLD_DEG)
        synchronized(lock) {
            return JSONObject().put("center", JSONArray().put(a.first).put(a.second)).put("radius_km", a.third).put("cells", cells.size)
                .put("ready", cells.count { features.haveBuildings(it.first, it.second) }).put("busy", areaBusy).put("errors", areaErrors)
        }
    }

    /** Fetch the building cells within [radiusKm], nearest first, while [keepGoing]; returns the failures. */
    private fun fetchBuildings(lat: Double, lon: Double, radiusKm: Double, keepGoing: () -> Boolean): Int {
        var errors = 0
        for (c in cellsWithin(lat, lon, radiusKm * 1000.0, MapFeatures.BLD_DEG)) {
            if (!keepGoing()) break
            if (features.haveBuildings(c.first, c.second)) continue
            if (features.buildings(c.first, c.second) == null) errors++
            Thread.sleep(PAUSE_MS)
        }
        return errors
    }

    private fun runArea() {
        while (true) {
            val (a, seq) = synchronized(lock) { Pair(area, areaSeq) }
            if (a == null) { synchronized(wake) { wake.wait(IDLE_WAIT_MS) }; continue }
            synchronized(lock) { areaBusy = true; areaErrors = 0 }
            val errors = try {
                fetchBuildings(a.first, a.second, a.third) { areaSeq == seq }
            } catch (e: Exception) {
                Log.w(TAG, "buildings area: ${e.message}")
                1
            }
            synchronized(lock) { areaErrors = errors; if (areaSeq == seq) areaBusy = false }
            synchronized(wake) { while (areaSeq == seq) wake.wait(IDLE_WAIT_MS) }
        }
    }

    /** The road tile file for a tile index, as MapTiles names it (downloaded when missing by [MapTiles.tile]). */
    private fun roadFile(t: Pair<Int, Int>): File {
        val (cLat, cLon, name) = roadName(t)
        return File(File(File(tiles.root, cLat.toString()), cLon.toString()), name)
    }

    private fun roadName(t: Pair<Int, Int>): Triple<Int, Int, String> {
        val lat = t.first * TILE + 0.01
        val lon = t.second * TILE + 0.01
        val tLat = floor(lat * 4) / 4
        val tLon = floor(lon * 4) / 4
        val name = "%.6f_%.6f_%.6f_%.6f".format(java.util.Locale.ROOT, tLat, tLon, tLat + 0.25, tLon + 0.25)
        return Triple(floor(lat / 2).toInt() * 2, floor(lon / 2).toInt() * 2, name)
    }

    private fun run() {
        while (true) {
            synchronized(wake) { while (want == null) wake.wait() }
            val w = want ?: continue
            synchronized(lock) { busy = true }
            try {
                for (t in tilesWithin(w.first, w.second, w.third * 1000.0)) {
                    if (want != w) break   // a newer position: start over from there
                    val (cLat, cLon, name) = roadName(t)
                    try {
                        tiles.tile(cLat, cLon, name)   // downloads the 2 deg cell when missing
                    } catch (e: Exception) {
                        Log.w(TAG, "prefetch road tile $name: ${e.message}")
                        synchronized(lock) { errors++ }
                    }
                    if (!features.haveTile(t.first, t.second)) {
                        if (!features.ensureTile(t.first, t.second)) synchronized(lock) { errors++ }
                        Thread.sleep(PAUSE_MS)
                    }
                    if (!features.haveWays(t.first, t.second)) {
                        if (!features.ensureWays(t.first, t.second)) synchronized(lock) { errors++ }
                        Thread.sleep(PAUSE_MS)
                    }
                }
                // then the buildings near the car
                if (want == w) {
                    val e = fetchBuildings(w.first, w.second, min(buildingsKm, w.third)) { want == w }
                    if (e > 0) synchronized(lock) { errors += e }
                }
            } finally {
                synchronized(lock) { busy = false; updated = System.currentTimeMillis() / 1000 }
            }
            if (want == w) synchronized(wake) { wake.wait(IDLE_WAIT_MS) }
        }
    }

    companion object {
        private const val TAG = "WebHud"
        private const val TILE = MapFeatures.TILE_DEG
        private const val MAX_KM = 200.0
        private const val PAUSE_MS = 1_000L
        private const val IDLE_WAIT_MS = 60_000L
        const val BUILDINGS_KM = 2.0      // around the car by default
        const val MAX_BUILDINGS_KM = 10.0 // ~300 cells already

        /** The [deg]-square cells (south-west corner / deg) whose box comes within [radiusM] of the point, nearest first. */
        fun cellsWithin(lat: Double, lon: Double, radiusM: Double, deg: Double): List<Pair<Int, Int>> {
            val mLat = 111_320.0
            val mLon = mLat * max(0.05, cos(Math.toRadians(lat)))
            val dLat = radiusM / mLat
            val dLon = radiusM / mLon
            val out = ArrayList<Triple<Double, Int, Int>>()
            for (klat in floor((lat - dLat) / deg).toInt()..floor((lat + dLat) / deg).toInt()) {
                for (klon in floor((lon - dLon) / deg).toInt()..floor((lon + dLon) / deg).toInt()) {
                    val s = klat * deg
                    val w = klon * deg
                    if (s < -90 || s >= 90 || w < -180 || w >= 180) continue
                    val dy = (max(s, min(lat, s + deg)) - lat) * mLat
                    val dx = (max(w, min(lon, w + deg)) - lon) * mLon
                    val d = hypot(dx, dy)
                    if (d <= radiusM) out.add(Triple(d, klat, klon))
                }
            }
            out.sortBy { it.first }
            return out.map { Pair(it.second, it.third) }
        }
    }
}

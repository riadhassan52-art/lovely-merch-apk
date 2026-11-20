package com.lovelymerch.app

import android.webkit.CookieManager
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object SadamataFetcher {

    private const val BASE_URL = "https://merch.sadamata.com"
    private const val USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"

    @Volatile
    private var inMemoryCookieHeader: String? = null

    fun setSavedCookieHeader(cookieStr: String?) {
        inMemoryCookieHeader = cookieStr?.trim()
    }

    fun getEffectiveCookies(url: String): String? {
        val cmCookie = try {
            CookieManager.getInstance().getCookie(url)?.trim()
        } catch (_: Exception) {
            null
        }
        val fallback = inMemoryCookieHeader?.trim()
        if (cmCookie.isNullOrBlank()) return fallback
        if (fallback.isNullOrBlank()) return cmCookie

        if (!cmCookie.contains("authjs.session-token") && fallback.contains("authjs.session-token")) {
            return "$fallback; $cmCookie"
        }
        return cmCookie
    }

    data class FetchResult(
        val ok: Boolean,
        val loggedOut: Boolean,
        val text: String,
        val isHtml: Boolean,
        val status: Int
    )

    data class SnapshotMetrics(
        val allSold: Int,
        val allRoyalty: Double,
        val todaySold: Int,
        val todayRoyalty: Double,
        val allCanc: Int,
        val todayCanc: Int,
        val allRet: Int,
        val todayRet: Int,
        val tier: Int,
        val liveProducts: Int,
        val rejectedProducts: Int
    ) {
        fun toJsonString(): String {
            return JSONObject().apply {
                put("allSold", allSold)
                put("allRoyalty", allRoyalty)
                put("todaySold", todaySold)
                put("todayRoyalty", todayRoyalty)
                put("allCanc", allCanc)
                put("todayCanc", todayCanc)
                put("allRet", allRet)
                put("todayRet", todayRet)
                put("tier", tier)
                put("liveProducts", liveProducts)
                put("rejectedProducts", rejectedProducts)
            }.toString()
        }

        companion object {
            fun fromJsonString(raw: String?): SnapshotMetrics? {
                if (raw.isNullOrBlank()) return null
                return try {
                    val o = JSONObject(raw)
                    SnapshotMetrics(
                        allSold = o.optInt("allSold", 0),
                        allRoyalty = o.optDouble("allRoyalty", 0.0),
                        todaySold = o.optInt("todaySold", 0),
                        todayRoyalty = o.optDouble("todayRoyalty", 0.0),
                        allCanc = o.optInt("allCanc", 0),
                        todayCanc = o.optInt("todayCanc", 0),
                        allRet = o.optInt("allRet", 0),
                        todayRet = o.optInt("todayRet", 0),
                        tier = o.optInt("tier", 0),
                        liveProducts = o.optInt("liveProducts", 0),
                        rejectedProducts = o.optInt("rejectedProducts", 0)
                    )
                } catch (_: Exception) {
                    null
                }
            }
        }
    }

    private fun performGet(path: String, sendRscHeader: Boolean): FetchResult {
        var currentUrl = if (path.startsWith("http")) path else "$BASE_URL$path"
        var redirects = 0

        while (redirects < 5) {
            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                instanceFollowRedirects = false
                connectTimeout = 15000
                readTimeout = 20000
                setRequestProperty("User-Agent", USER_AGENT)
                setRequestProperty("Accept", if (sendRscHeader) "text/x-component, */*" else "text/html, */*")
                if (sendRscHeader) {
                    setRequestProperty("RSC", "1")
                }
                val cookies = getEffectiveCookies(currentUrl)
                if (!cookies.isNullOrBlank()) {
                    setRequestProperty("Cookie", cookies)
                }
            }

            try {
                val code = conn.responseCode
                if (code in 300..399) {
                    val loc = conn.getHeaderField("Location") ?: ""
                    conn.disconnect()
                    if (loc.contains("/login", ignoreCase = true) || loc.contains("/sign-in", ignoreCase = true)) {
                        return FetchResult(false, true, "", !sendRscHeader, code)
                    }
                    currentUrl = if (loc.startsWith("http")) loc else URL(URL(currentUrl), loc).toString()
                    redirects++
                    continue
                }

                val finalPath = URL(currentUrl).path ?: ""
                if (finalPath.contains("/login", ignoreCase = true) || finalPath.contains("/sign-in", ignoreCase = true)) {
                    conn.disconnect()
                    return FetchResult(false, true, "", !sendRscHeader, code)
                }

                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val body = if (stream != null) {
                    BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
                } else {
                    ""
                }
                conn.disconnect()
                return FetchResult(code in 200..299, false, body, !sendRscHeader, code)
            } catch (_: Exception) {
                try {
                    conn.disconnect()
                } catch (_: Exception) {
                }
                return FetchResult(false, false, "", !sendRscHeader, 0)
            }
        }
        return FetchResult(false, false, "", !sendRscHeader, 0)
    }

    fun fetchMerchPath(path: String): FetchResult {
        val rsc = performGet(path, sendRscHeader = true)
        if (rsc.loggedOut) return rsc
        val looksValid = rsc.ok && (
            rsc.text.contains("merchantProfile") ||
                rsc.text.contains("initialItems") ||
                rsc.text.contains("summery") ||
                rsc.text.contains("self.__next_f")
            )
        if (looksValid) return rsc

        val html = performGet(path, sendRscHeader = false)
        return html
    }

    fun extractBackgroundMetrics(rawText: String, isHtml: Boolean): SnapshotMetrics? {
        if (rawText.isBlank()) return null
        val normalized = if (isHtml) {
            rawText.replace("\\\"", "\"")
        } else {
            rawText
        }

        val tier = extractIntField(normalized, "\"tiar\"") ?: return null
        val live = extractIntField(normalized, "\"totalLiveProducts\"") ?: 0
        val rejected = extractIntField(normalized, "\"totalRejectedProducts\"") ?: 0

        val reportObj = extractJsonObjectAfter(normalized, "\"report\":")
        val allTimeObj = extractJsonObjectAfter(normalized, "\"allTime\":")

        val todaySold = reportObj?.optInt("soldUnits", 0) ?: 0
        val todayRoy = (reportObj?.optDouble("merchantRoyalty", 0.0) ?: 0.0) +
            (reportObj?.optDouble("merchantExcessRoyalty", 0.0) ?: 0.0)
        val todayCanc = reportObj?.optInt("canceledOrders", 0) ?: 0
        val todayRet = reportObj?.optInt("refundedUnits", 0) ?: 0

        val allSold = allTimeObj?.optInt("soldUnits", todaySold) ?: todaySold
        val allRoy = if (allTimeObj != null) {
            allTimeObj.optDouble("merchantRoyalty", 0.0) + allTimeObj.optDouble("merchantExcessRoyalty", 0.0)
        } else {
            todayRoy
        }
        val allCanc = allTimeObj?.optInt("canceledOrders", todayCanc) ?: todayCanc
        val allRet = allTimeObj?.optInt("refundedUnits", todayRet) ?: todayRet

        return SnapshotMetrics(
            allSold = allSold,
            allRoyalty = allRoy,
            todaySold = todaySold,
            todayRoyalty = todayRoy,
            allCanc = allCanc,
            todayCanc = todayCanc,
            allRet = allRet,
            todayRet = todayRet,
            tier = tier,
            liveProducts = live,
            rejectedProducts = rejected
        )
    }

    private fun extractIntField(text: String, quotedKey: String): Int? {
        val idx = text.indexOf(quotedKey)
        if (idx == -1) return null
        val colon = text.indexOf(':', idx + quotedKey.length)
        if (colon == -1) return null
        var p = colon + 1
        while (p < text.length && text[p].isWhitespace()) p++
        val start = p
        if (p < text.length && text[p] == '-') p++
        while (p < text.length && text[p].isDigit()) p++
        if (p == start) return null
        return text.substring(start, p).toIntOrNull()
    }

    private fun extractJsonObjectAfter(text: String, marker: String): JSONObject? {
        val idx = text.indexOf(marker)
        if (idx == -1) return null
        val start = text.indexOf('{', idx + marker.length)
        if (start == -1 || start - (idx + marker.length) > 12) return null
        var depth = 0
        var inStr = false
        var escape = false
        for (i in start until minOf(text.length, start + 4096)) {
            val ch = text[i]
            if (escape) {
                escape = false
                continue
            }
            if (ch == '\\' && inStr) {
                escape = true
                continue
            }
            if (ch == '"') {
                inStr = !inStr
                continue
            }
            if (!inStr) {
                if (ch == '{') depth++
                else if (ch == '}') {
                    depth--
                    if (depth == 0) {
                        return try {
                            JSONObject(text.substring(start, i + 1))
                        } catch (_: Exception) {
                            null
                        }
                    }
                }
            }
        }
        return null
    }
}

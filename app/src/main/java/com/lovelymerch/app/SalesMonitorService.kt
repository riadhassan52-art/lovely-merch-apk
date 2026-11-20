package com.lovelymerch.app

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class SalesMonitorService : Service() {

    private var scheduler: ScheduledExecutorService? = null
    private var pollTask: ScheduledFuture<*>? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences(NotificationHelper.PREFS_NAME, Context.MODE_PRIVATE)
        val savedCookies = prefs.getString("sadamata_cookies", null)
        if (!savedCookies.isNullOrBlank()) {
            SadamataFetcher.setSavedCookieHeader(savedCookies)
        }
        val settings = parseSettings(prefs.getString(NotificationHelper.KEY_SETTINGS, null))
        val enabled = settings.optBoolean("autoSyncEnabled", true) &&
            settings.optBoolean("bgMonitorEnabled", true)

        if (!enabled) {
            stopSelf()
            return START_NOT_STICKY
        }

        val lastSnap = SadamataFetcher.SnapshotMetrics.fromJsonString(
            prefs.getString(NotificationHelper.KEY_SNAPSHOT, null)
        )
        val subtitle = if (lastSnap != null) {
            String.format(
                Locale.US,
                "Today: %d sold • BDT %.2f",
                lastSnap.todaySold,
                lastSnap.todayRoyalty
            )
        } else {
            "Monitoring Sadamata sales in background"
        }

        val notification = NotificationHelper.buildMonitorNotification(this, subtitle)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NotificationHelper.MONITOR_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NotificationHelper.MONITOR_NOTIFICATION_ID, notification)
        }

        val intervalMin = settings.optInt("syncIntervalMin", 1).coerceIn(1, 30)
        reschedulePolling(intervalMin.toLong())

        return START_STICKY
    }

    override fun onDestroy() {
        pollTask?.cancel(true)
        scheduler?.shutdownNow()
        pollTask = null
        scheduler = null
        super.onDestroy()
    }

    private fun reschedulePolling(intervalMin: Long) {
        pollTask?.cancel(false)
        if (scheduler == null || scheduler?.isShutdown == true) {
            scheduler = Executors.newSingleThreadScheduledExecutor()
        }
        pollTask = scheduler?.scheduleWithFixedDelay(
            { runBackgroundPoll() },
            intervalMin,
            intervalMin,
            TimeUnit.MINUTES
        )
    }

    private fun runBackgroundPoll() {
        // Avoid duplicate notifications while UI is active in foreground
        if (MainActivity.isForeground) return

        try {
            val prefs = getSharedPreferences(NotificationHelper.PREFS_NAME, Context.MODE_PRIVATE)
            val settings = parseSettings(prefs.getString(NotificationHelper.KEY_SETTINGS, null))
            if (!settings.optBoolean("autoSyncEnabled", true) ||
                !settings.optBoolean("bgMonitorEnabled", true)
            ) {
                stopSelf()
                return
            }

            val res = SadamataFetcher.fetchMerchPath("/dashboard")
            if (!res.ok || res.loggedOut || res.text.isBlank()) return

            val next = SadamataFetcher.extractBackgroundMetrics(res.text, res.isHtml) ?: return
            val prev = SadamataFetcher.SnapshotMetrics.fromJsonString(
                prefs.getString(NotificationHelper.KEY_SNAPSHOT, null)
            )

            prefs.edit().putString(NotificationHelper.KEY_SNAPSHOT, next.toJsonString()).apply()

            // Update subtle ongoing status bar notification
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val sub = String.format(
                Locale.US,
                "Today: %d sold • BDT %.2f",
                next.todaySold,
                next.todayRoyalty
            )
            nm.notify(
                NotificationHelper.MONITOR_NOTIFICATION_ID,
                NotificationHelper.buildMonitorNotification(this, sub)
            )

            if (prev == null) return

            // 1. New Sales
            var deltaUnits = 0
            var deltaRoy = 0.0
            if (next.allSold > prev.allSold) {
                deltaUnits = next.allSold - prev.allSold
                deltaRoy = (next.allRoyalty - prev.allRoyalty).coerceAtLeast(0.0)
            } else if (next.todaySold > prev.todaySold) {
                deltaUnits = next.todaySold - prev.todaySold
                deltaRoy = (next.todayRoyalty - prev.todayRoyalty).coerceAtLeast(0.0)
            }

            if (deltaUnits > 0) {
                val title = "New Sale (+$deltaUnits)"
                val body = String.format(
                    Locale.US,
                    "You sold %d more unit%s (+BDT %.2f royalty).",
                    deltaUnits,
                    if (deltaUnits > 1) "s" else "",
                    deltaRoy
                )
                NotificationHelper.appendBackgroundAlert(this, "sale", title, body)
                if (settings.optBoolean("notifyOnSale", true)) {
                    NotificationHelper.showAlertNotification(this, "sale", title, body)
                }
                if (settings.optBoolean("playSaleSound", true)) {
                    val preset = settings.optString("soundPreset", "kaching")
                    val vol = settings.optDouble("saleSoundVolume", 0.75).toFloat()
                    NotificationHelper.playBundledSound(this, preset, vol)
                }
                NotificationHelper.vibrate(this, "sale")
            }

            // 2. Cancellations
            val deltaCanc = maxOf(
                0,
                if (next.allCanc > prev.allCanc) next.allCanc - prev.allCanc
                else next.todayCanc - prev.todayCanc
            )
            if (deltaCanc > 0) {
                val title = "Order Cancelled (+$deltaCanc)"
                val body = "$deltaCanc order${if (deltaCanc > 1) "s were" else " was"} cancelled."
                NotificationHelper.appendBackgroundAlert(this, "cancel", title, body)
                if (settings.optBoolean("notifyOnCancel", true)) {
                    NotificationHelper.showAlertNotification(this, "cancel", title, body)
                }
                if (settings.optBoolean("playCancelSound", true)) {
                    val vol = settings.optDouble("cancelSoundVolume", 0.75).toFloat()
                    NotificationHelper.playBundledSound(this, "cancel", vol)
                }
                NotificationHelper.vibrate(this, "cancel")
            }

            // 3. Returns
            val deltaRet = maxOf(
                0,
                if (next.allRet > prev.allRet) next.allRet - prev.allRet
                else next.todayRet - prev.todayRet
            )
            if (deltaRet > 0) {
                val title = "Product Returned (+$deltaRet)"
                val body = "$deltaRet unit${if (deltaRet > 1) "s were" else " was"} returned / refunded."
                NotificationHelper.appendBackgroundAlert(this, "return", title, body)
                if (settings.optBoolean("notifyOnCancel", true)) {
                    NotificationHelper.showAlertNotification(this, "return", title, body)
                }
                if (settings.optBoolean("playCancelSound", true)) {
                    val vol = settings.optDouble("cancelSoundVolume", 0.75).toFloat()
                    NotificationHelper.playBundledSound(this, "cancel", vol)
                }
                NotificationHelper.vibrate(this, "cancel")
            }

            // 4. Tier Up
            if (prev.tier > 0 && next.tier > prev.tier) {
                val title = "Tier Up: Tier ${next.tier}!"
                val body = "Your account moved from Tier ${prev.tier} to Tier ${next.tier}."
                NotificationHelper.appendBackgroundAlert(this, "tier", title, body)
                if (settings.optBoolean("notifyOnTierUp", true)) {
                    NotificationHelper.showAlertNotification(this, "tier", title, body)
                    NotificationHelper.playBundledSound(this, "tier", 0.9f)
                }
            }

            // 5. Status changes
            if (next.liveProducts > prev.liveProducts) {
                val diff = next.liveProducts - prev.liveProducts
                val title = "+$diff Product${if (diff > 1) "s" else ""} Went Live"
                val body = "Live catalog increased from ${prev.liveProducts} to ${next.liveProducts}."
                NotificationHelper.appendBackgroundAlert(this, "live", title, body)
                if (settings.optBoolean("notifyOnStatusChange", true)) {
                    NotificationHelper.showAlertNotification(this, "status", title, body)
                }
            }

            if (next.rejectedProducts > prev.rejectedProducts) {
                val diff = next.rejectedProducts - prev.rejectedProducts
                val title = "+$diff Design${if (diff > 1) "s" else ""} Rejected"
                val body = "Rejected count increased from ${prev.rejectedProducts} to ${next.rejectedProducts}."
                NotificationHelper.appendBackgroundAlert(this, "rejected", title, body)
                if (settings.optBoolean("notifyOnStatusChange", true)) {
                    NotificationHelper.showAlertNotification(this, "status", title, body)
                }
            }
        } catch (_: Exception) {
        }
    }

    private fun parseSettings(raw: String?): JSONObject {
        return try {
            if (!raw.isNullOrBlank()) JSONObject(raw) else JSONObject()
        } catch (_: Exception) {
            JSONObject()
        }
    }
}

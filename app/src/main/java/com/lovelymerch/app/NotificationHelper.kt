package com.lovelymerch.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicInteger

object NotificationHelper {

    const val PREFS_NAME = "lovely_merch_prefs"
    const val KEY_SETTINGS = "settings_json"
    const val KEY_SNAPSHOT = "snapshot_json"
    const val KEY_PENDING_ALERTS = "pending_alerts_json"

    const val CHANNEL_MONITOR = "slm_live_monitor"
    const val CHANNEL_SALES = "slm_sales_alerts"
    const val CHANNEL_CANCELS = "slm_cancel_alerts"
    const val CHANNEL_STATUS = "slm_status_alerts"

    const val MONITOR_NOTIFICATION_ID = 1001
    private val notifIdGen = AtomicInteger(2000)

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val monitor = NotificationChannel(
            CHANNEL_MONITOR,
            "Live Sales Monitor",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Persistent background monitor indicator for real-time Sadamata alerts"
            setShowBadge(false)
        }

        val sales = NotificationChannel(
            CHANNEL_SALES,
            "New Sale Alerts",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Instant notifications when a new Sadamata sale occurs"
            enableVibration(true)
        }

        val cancels = NotificationChannel(
            CHANNEL_CANCELS,
            "Cancel & Return Alerts",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Notifications when an order is cancelled or returned"
            enableVibration(true)
        }

        val status = NotificationChannel(
            CHANNEL_STATUS,
            "Tier & Product Status",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Tier-up milestones and product live/rejected status changes"
        }

        nm.createNotificationChannel(monitor)
        nm.createNotificationChannel(sales)
        nm.createNotificationChannel(cancels)
        nm.createNotificationChannel(status)
    }

    fun buildMonitorNotification(context: Context, subtitle: String): Notification {
        ensureChannels(context)
        val launchIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(context, CHANNEL_MONITOR)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("LoveLy Merch • Live Monitor")
            .setContentText(subtitle)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    fun showAlertNotification(context: Context, type: String, title: String, body: String) {
        ensureChannels(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }

        val channelId = when (type) {
            "sale" -> CHANNEL_SALES
            "cancel", "return" -> CHANNEL_CANCELS
            else -> CHANNEL_STATUS
        }

        val launchIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("open_tab", "alerts")
        }
        val pi = PendingIntent.getActivity(
            context,
            notifIdGen.incrementAndGet(),
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notif = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setPriority(
                if (type == "sale" || type == "cancel" || type == "return") {
                    NotificationCompat.PRIORITY_HIGH
                } else {
                    NotificationCompat.PRIORITY_DEFAULT
                }
            )
            .build()

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(notifIdGen.incrementAndGet(), notif)
    }

    fun playBundledSound(context: Context, key: String, volume: Float) {
        val resId = when (key) {
            "kaching" -> R.raw.cha_ching_kaching
            "register" -> R.raw.cha_ching_register
            "bell" -> R.raw.cha_ching_bell
            "cancel", "chime" -> R.raw.cancel_return
            "tier" -> R.raw.tier_celebration
            else -> R.raw.cha_ching_kaching
        }

        val vol = volume.coerceIn(0.05f, 1.0f)
        try {
            val mp = MediaPlayer()
            mp.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            val afd = context.resources.openRawResourceFd(resId) ?: return
            mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
            afd.close()
            mp.setVolume(vol, vol)
            mp.setOnCompletionListener { player ->
                try {
                    player.release()
                } catch (_: Exception) {
                }
            }
            mp.setOnErrorListener { player, _, _ ->
                try {
                    player.release()
                } catch (_: Exception) {
                }
                true
            }
            mp.prepare()
            mp.start()
        } catch (_: Exception) {
        }
    }

    fun vibrate(context: Context, kind: String) {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vm.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }
            if (!vibrator.hasVibrator()) return

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                when (kind) {
                    "sale" -> vibrator.vibrate(
                        VibrationEffect.createWaveform(longArrayOf(0, 70, 60, 120), -1)
                    )
                    "cancel" -> vibrator.vibrate(
                        VibrationEffect.createWaveform(longArrayOf(0, 140, 80, 140), -1)
                    )
                    else -> vibrator.vibrate(
                        VibrationEffect.createOneShot(18, VibrationEffect.DEFAULT_AMPLITUDE)
                    )
                }
            } else {
                @Suppress("DEPRECATION")
                when (kind) {
                    "sale" -> vibrator.vibrate(longArrayOf(0, 70, 60, 120), -1)
                    "cancel" -> vibrator.vibrate(longArrayOf(0, 140, 80, 140), -1)
                    else -> vibrator.vibrate(18)
                }
            }
        } catch (_: Exception) {
        }
    }

    @Synchronized
    fun appendBackgroundAlert(context: Context, type: String, title: String, body: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_PENDING_ALERTS, "[]") ?: "[]"
        val arr = try {
            JSONArray(raw)
        } catch (_: Exception) {
            JSONArray()
        }

        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val entry = JSONObject().apply {
            put("id", "bg-${System.currentTimeMillis()}-${notifIdGen.incrementAndGet()}")
            put("type", type)
            put("title", title)
            put("body", body)
            put("timestamp", sdf.format(Date()))
            put("read", false)
        }

        val next = JSONArray()
        next.put(entry)
        val limit = minOf(arr.length(), 80)
        for (i in 0 until limit) {
            next.put(arr.get(i))
        }
        prefs.edit().putString(KEY_PENDING_ALERTS, next.toString()).apply()
    }

    @Synchronized
    fun consumePendingAlertsJson(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_PENDING_ALERTS, "[]") ?: "[]"
        if (raw != "[]") {
            prefs.edit().putString(KEY_PENDING_ALERTS, "[]").apply()
        }
        return raw
    }
}

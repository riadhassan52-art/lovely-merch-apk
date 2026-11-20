package com.lovelymerch.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.max

class MainActivity : AppCompatActivity() {

    companion object {
        private const val APP_HOME_URL = "https://appassets.androidplatform.net/assets/app/index.html"
        private val LICENSE_SERVER_URL: String get() = BuildConfig.API_BASE_URL
        private const val DOUBLE_BACK_MS = 2000L

        @Volatile
        var isForeground: Boolean = false
    }

    private lateinit var rootContainer: LinearLayout
    private lateinit var statusBarBg: View
    private lateinit var webView: WebView

    private val ioExecutor = Executors.newCachedThreadPool()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var lastBackTime = 0L

    private val notificationPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ ->
        syncMonitorServiceFromPrefs()
    }

    private var pendingWebPermissionRequest: PermissionRequest? = null

    private val cameraPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            pendingWebPermissionRequest?.grant(pendingWebPermissionRequest?.resources)
        } else {
            pendingWebPermissionRequest?.deny()
        }
        pendingWebPermissionRequest = null

        webView.evaluateJavascript(
            "window.__slmOnCameraPermission && window.__slmOnCameraPermission($granted);",
            null
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        NotificationHelper.ensureChannels(this)

        rootContainer = findViewById(R.id.rootContainer)
        statusBarBg = findViewById(R.id.statusBarBg)
        webView = findViewById(R.id.webView)

        setupWindowInsets()
        setupMainWebView()
        setupBackNavigation()

        applyThemeChromeFromPrefs()
        requestNotificationPermissionIfNeeded()

        webView.loadUrl(APP_HOME_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val tab = intent.getStringExtra("open_tab")
        if (!tab.isNullOrBlank()) {
            val quoted = JSONObject.quote(tab)
            webView.evaluateJavascript("window.__slmSwitchTab && window.__slmSwitchTab($quoted);", null)
        }
    }

    override fun onResume() {
        super.onResume()
        isForeground = true
        webView.onResume()
        webView.evaluateJavascript("window.__slmOnNativeResume && window.__slmOnNativeResume();", null)
    }

    override fun onPause() {
        isForeground = false
        CookieManager.getInstance().flush()
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        isForeground = false
        CookieManager.getInstance().flush()
        ioExecutor.shutdownNow()
        webView.destroy()
        super.onDestroy()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                notificationPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun setupWindowInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { view, windowInsets ->
            val systemBars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime())

            val statusParams = statusBarBg.layoutParams
            if (statusParams.height != systemBars.top) {
                statusParams.height = systemBars.top
                statusBarBg.layoutParams = statusParams
            }

            view.setPadding(
                systemBars.left,
                0,
                systemBars.right,
                max(systemBars.bottom, ime.bottom)
            )
            WindowInsetsCompat.CONSUMED
        }
    }

    private fun applyThemeChrome(isLight: Boolean) {
        val bgColor = if (isLight) Color.parseColor("#FFFFFF") else Color.parseColor("#0F1117")
        rootContainer.setBackgroundColor(bgColor)
        statusBarBg.setBackgroundColor(bgColor)
        webView.setBackgroundColor(bgColor)

        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = isLight
            isAppearanceLightNavigationBars = isLight
        }
    }

    private fun applyThemeChromeFromPrefs() {
        val prefs = getSharedPreferences(NotificationHelper.PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(NotificationHelper.KEY_SETTINGS, null)
        val isLight = try {
            raw != null && JSONObject(raw).optString("theme", "dark") == "light"
        } catch (_: Exception) {
            false
        }
        applyThemeChrome(isLight)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupMainWebView() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        val savedCookies = getSharedPreferences(NotificationHelper.PREFS_NAME, Context.MODE_PRIVATE)
            .getString("sadamata_cookies", null)
        if (!savedCookies.isNullOrBlank()) {
            SadamataFetcher.setSavedCookieHeader(savedCookies)
            for (part in savedCookies.split(";")) {
                val clean = part.trim()
                if (clean.isNotEmpty()) {
                    cookieManager.setCookie("https://merch.sadamata.com", "$clean; path=/")
                    cookieManager.setCookie("https://sadamata.com", "$clean; path=/")
                }
            }
            cookieManager.flush()
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.addJavascriptInterface(AndroidBridge(), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val uri = request?.url ?: return null
                return assetLoader.shouldInterceptRequest(uri)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return false
                if (uri.host == "appassets.androidplatform.net") return false
                openExternalUri(uri)
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                runOnUiThread {
                    if (request == null) return@runOnUiThread
                    val hasCam = ContextCompat.checkSelfPermission(
                        this@MainActivity,
                        Manifest.permission.CAMERA
                    ) == PackageManager.PERMISSION_GRANTED

                    if (hasCam) {
                        request.grant(request.resources)
                    } else {
                        pendingWebPermissionRequest = request
                        cameraPermLauncher.launch(Manifest.permission.CAMERA)
                    }
                }
            }
        }
    }

    private fun syncMonitorServiceFromPrefs() {
        val prefs = getSharedPreferences(NotificationHelper.PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(NotificationHelper.KEY_SETTINGS, null)
        val settings = try {
            if (!raw.isNullOrBlank()) JSONObject(raw) else JSONObject()
        } catch (_: Exception) {
            JSONObject()
        }
        val shouldRun = settings.optBoolean("autoSyncEnabled", true) &&
            settings.optBoolean("bgMonitorEnabled", true)

        val serviceIntent = Intent(this, SalesMonitorService::class.java)
        try {
            if (shouldRun) {
                ContextCompat.startForegroundService(this, serviceIntent)
            } else {
                stopService(serviceIntent)
            }
        } catch (_: Exception) {
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(function(){ return window.__slmHandleBack ? window.__slmHandleBack() : false; })();"
                ) { result ->
                    if (result != "true") {
                        val now = System.currentTimeMillis()
                        if (now - lastBackTime < DOUBLE_BACK_MS) {
                            finish()
                        } else {
                            lastBackTime = now
                            Toast.makeText(
                                this@MainActivity,
                                getString(R.string.press_back_again),
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                }
            }
        })
    }

    private fun openExternalUri(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
        }
    }

    inner class AndroidBridge {

        @JavascriptInterface
        fun fetchMerchPath(path: String, callbackId: String) {
            ioExecutor.execute {
                val res = SadamataFetcher.fetchMerchPath(path)
                val payload = JSONObject().apply {
                    put("ok", res.ok)
                    put("loggedOut", res.loggedOut)
                    put("text", res.text)
                    put("isHtml", res.isHtml)
                    put("status", res.status)
                }.toString()

                val quotedId = JSONObject.quote(callbackId)
                val quotedPayload = JSONObject.quote(payload)
                runOnUiThread {
                    webView.evaluateJavascript(
                        "window.__slmOnFetchResult && window.__slmOnFetchResult($quotedId, $quotedPayload);",
                        null
                    )
                }
            }
        }

        @JavascriptInterface
        fun hasCameraPermission(): Boolean {
            return ContextCompat.checkSelfPermission(
                this@MainActivity,
                Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
        }

        @JavascriptInterface
        fun requestCameraPermission() {
            runOnUiThread {
                if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    cameraPermLauncher.launch(Manifest.permission.CAMERA)
                } else {
                    webView.evaluateJavascript("window.__slmOnCameraPermission && window.__slmOnCameraPermission(true);", null)
                }
            }
        }

        @JavascriptInterface
        fun claimPairing(pairCode: String, callbackId: String) {
            ioExecutor.execute {
                val cleanPairCode = pairCode.trim()
                val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "android_${System.currentTimeMillis()}"
                val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

                val claimUrl = "$LICENSE_SERVER_URL/api/license/pair/claim"
                var ok = false
                var errorMsg = "Failed to connect to license server"
                var resultData = JSONObject()

                try {
                    val conn = (URL(claimUrl).openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"
                        connectTimeout = 12000
                        readTimeout = 15000
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json")
                    }

                    val reqBody = JSONObject().apply {
                        put("pairCode", cleanPairCode)
                        put("mobileDeviceId", androidId)
                        put("deviceName", deviceName)
                    }.toString()

                    conn.outputStream.use { it.write(reqBody.toByteArray()) }

                    val status = conn.responseCode
                    val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                    val responseStr = stream.bufferedReader().use { it.readText() }
                    val respObj = JSONObject(responseStr)

                    if (respObj.optBoolean("ok", false)) {
                        ok = true
                        resultData = respObj

                        // Inject Sadamata cookies into Android CookieManager!
                        val cookies = respObj.optJSONArray("cookies")
                        val cookieHeaderBuilder = StringBuilder()
                        if (cookies != null && cookies.length() > 0) {
                            val cm = CookieManager.getInstance()
                            cm.setAcceptCookie(true)
                            try {
                                cm.setAcceptThirdPartyCookies(webView, true)
                            } catch (_: Exception) {}

                            for (i in 0 until cookies.length()) {
                                val c = cookies.getJSONObject(i)
                                val name = c.optString("name")
                                val value = c.optString("value")
                                val domain = c.optString("domain", "merch.sadamata.com").trimStart('.')
                                val path = c.optString("path", "/")

                                if (name.isNotBlank() && value.isNotBlank()) {
                                    if (cookieHeaderBuilder.isNotEmpty()) cookieHeaderBuilder.append("; ")
                                    cookieHeaderBuilder.append("$name=$value")

                                    // Set as host-only cookie on merch.sadamata.com
                                    cm.setCookie("https://merch.sadamata.com", "$name=$value; path=$path")
                                    // Set with explicit domain
                                    cm.setCookie("https://merch.sadamata.com", "$name=$value; domain=$domain; path=$path")
                                    cm.setCookie("https://merch.sadamata.com", "$name=$value; domain=.$domain; path=$path")
                                    // Set on root domain as well
                                    cm.setCookie("https://sadamata.com", "$name=$value; domain=sadamata.com; path=$path")
                                }
                            }
                            cm.flush()
                        }

                        val cookieHeader = cookieHeaderBuilder.toString()
                        if (cookieHeader.isNotBlank()) {
                            SadamataFetcher.setSavedCookieHeader(cookieHeader)
                        }

                        // Save license info and cookies in prefs
                        getSharedPreferences(NotificationHelper.PREFS_NAME, Context.MODE_PRIVATE)
                            .edit()
                            .putString("license_key", respObj.optString("licenseKey"))
                            .putString("license_expires", respObj.optString("expiresAt"))
                            .putString("mobile_device_id", androidId)
                            .putString("sadamata_cookies", cookieHeader)
                            .apply()
                    } else {
                        errorMsg = respObj.optString("error", "Pairing failed")
                    }
                } catch (e: Exception) {
                    errorMsg = e.message ?: "Connection error"
                }

                val finalPayload = JSONObject().apply {
                    put("ok", ok)
                    put("error", errorMsg)
                    put("data", resultData)
                }.toString()

                val quotedId = JSONObject.quote(callbackId)
                val quotedPayload = JSONObject.quote(finalPayload)
                runOnUiThread {
                    webView.evaluateJavascript(
                        "window.__slmOnClaimResult && window.__slmOnClaimResult($quotedId, $quotedPayload);",
                        null
                    )
                }
            }
        }

        @JavascriptInterface
        fun verifyLicense(callbackId: String) {
            ioExecutor.execute {
                val prefs = getSharedPreferences(NotificationHelper.PREFS_NAME, Context.MODE_PRIVATE)
                val savedKey = prefs.getString("license_key", "")?.trim().orEmpty()
                val androidId = prefs.getString("mobile_device_id", null)
                    ?: Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
                    ?: "android_unknown"
                val deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

                var valid = false
                var reason = "No license key saved"
                var respObj = JSONObject()

                if (savedKey.isNotBlank()) {
                    try {
                        val conn = (URL("$LICENSE_SERVER_URL/api/license/verify").openConnection() as HttpURLConnection).apply {
                            requestMethod = "POST"
                            connectTimeout = 10000
                            readTimeout = 12000
                            doOutput = true
                            setRequestProperty("Content-Type", "application/json")
                        }
                        val reqBody = JSONObject().apply {
                            put("licenseKey", savedKey)
                            put("deviceId", androidId)
                            put("deviceName", deviceName)
                            put("slot", "mobile")
                            put("mode", "check")
                        }.toString()
                        conn.outputStream.use { it.write(reqBody.toByteArray()) }

                        val status = conn.responseCode
                        val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                        val responseStr = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
                        respObj = JSONObject(responseStr)
                        valid = respObj.optBoolean("valid", false)
                        reason = respObj.optString("reason", if (valid) "Active" else "License invalid")
                    } catch (e: Exception) {
                        reason = e.message ?: "Connection error"
                    }
                }

                val payload = JSONObject().apply {
                    put("valid", valid)
                    put("reason", reason)
                    put("data", respObj)
                }.toString()

                val quotedId = JSONObject.quote(callbackId)
                val quotedPayload = JSONObject.quote(payload)
                runOnUiThread {
                    webView.evaluateJavascript(
                        "window.__slmOnVerifyResult && window.__slmOnVerifyResult($quotedId, $quotedPayload);",
                        null
                    )
                }
            }
        }

        @JavascriptInterface
        fun logout() {
            val prefs = getSharedPreferences(NotificationHelper.PREFS_NAME, Context.MODE_PRIVATE)
            val savedKey = prefs.getString("license_key", "")?.trim().orEmpty()
            if (savedKey.isNotBlank()) {
                ioExecutor.execute {
                    try {
                        val conn = (URL("$LICENSE_SERVER_URL/api/license/unpair").openConnection() as HttpURLConnection).apply {
                            requestMethod = "POST"
                            connectTimeout = 8000
                            readTimeout = 8000
                            doOutput = true
                            setRequestProperty("Content-Type", "application/json")
                        }
                        val reqBody = JSONObject().apply {
                            put("licenseKey", savedKey)
                            put("slot", "mobile")
                        }.toString()
                        conn.outputStream.use { it.write(reqBody.toByteArray()) }
                        conn.responseCode
                        conn.disconnect()
                    } catch (_: Exception) {
                    }
                }
            }

            runOnUiThread {
                val cm = CookieManager.getInstance()
                cm.removeAllCookies { cm.flush() }
                SadamataFetcher.setSavedCookieHeader(null)
                prefs.edit()
                    .remove(NotificationHelper.KEY_SNAPSHOT)
                    .remove("license_key")
                    .remove("license_expires")
                    .remove("mobile_device_id")
                    .remove("sadamata_cookies")
                    .apply()
            }
        }

        @JavascriptInterface
        fun showNativeNotification(type: String, title: String, body: String) {
            NotificationHelper.showAlertNotification(this@MainActivity, type, title, body)
        }

        @JavascriptInterface
        fun playNativeSound(key: String, volume: Float) {
            NotificationHelper.playBundledSound(this@MainActivity, key, volume)
        }

        @JavascriptInterface
        fun vibrate(kind: String) {
            NotificationHelper.vibrate(this@MainActivity, kind)
        }

        @JavascriptInterface
        fun updateSettings(settingsJson: String) {
            getSharedPreferences(NotificationHelper.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(NotificationHelper.KEY_SETTINGS, settingsJson)
                .apply()

            runOnUiThread {
                try {
                    val obj = JSONObject(settingsJson)
                    applyThemeChrome(obj.optString("theme", "dark") == "light")
                } catch (_: Exception) {
                }
                syncMonitorServiceFromPrefs()
            }
        }

        @JavascriptInterface
        fun saveSnapshotMetrics(metricsJson: String) {
            getSharedPreferences(NotificationHelper.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(NotificationHelper.KEY_SNAPSHOT, metricsJson)
                .apply()
        }

        @JavascriptInterface
        fun consumePendingAlerts(): String {
            return NotificationHelper.consumePendingAlertsJson(this@MainActivity)
        }

        @JavascriptInterface
        fun openExternalUrl(url: String) {
            runOnUiThread { openExternalUri(Uri.parse(url)) }
        }

        @JavascriptInterface
        fun onSyncComplete() {
            // Hook for native UI if needed
        }
    }
}

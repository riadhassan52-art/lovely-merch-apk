(function () {
  "use strict";

  const SLMFlight = window.SLMFlight;
  const SLMAudio = window.SLMAudio;
  const SLMEffects = window.SLMEffects;

  const STORAGE = {
    SETTINGS: "slm_mob_settings_v3",
    DASHBOARD: "slm_mob_dashboard_v3",
    ALERTS: "slm_mob_alerts_v3",
    ANALYZE_ITEMS: "slm_mob_analyze_items_v3",
    PROFILE: "slm_mob_profile_v4"
  };

  const DEFAULT_SETTINGS = {
    theme: "dark",
    netMode: true,
    autoSyncEnabled: true,
    bgMonitorEnabled: true,
    syncIntervalMin: 1,
    notifyOnSale: true,
    playSaleSound: true,
    soundPreset: "kaching",
    saleSoundVolume: 0.75,
    showSaleEffect: true,
    notifyOnCancel: true,
    playCancelSound: true,
    cancelSoundPreset: "sad_wah",
    cancelSoundVolume: 0.75,
    notifyOnTierUp: true,
    notifyOnStatusChange: true
  };

  const FALLBACK_SHIRT =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="12" fill="#f1f5f9"/><path d="M24 16 L32 12 C36 16 44 16 48 12 L56 16 L70 26 L62 38 L55 34 L55 68 L25 68 L25 34 L18 38 L10 26 Z" fill="#334155"/></svg>`
    );

  let state = {
    settings: loadJson(STORAGE.SETTINGS, DEFAULT_SETTINGS, true),
    dashboard: loadJson(STORAGE.DASHBOARD, null, false),
    alerts: loadJson(STORAGE.ALERTS, [], false),
    analyzeItems: loadJson(STORAGE.ANALYZE_ITEMS, [], false),
    profile: loadJson(STORAGE.PROFILE, { name: "", photo: "" }, true),
    authenticated: false,
    syncing: false,
    lastSyncAt: 0,
    lastAnalyzeAt: 0,
    lastProfileAt: 0
  };

  let activePeriod = "today";
  let privacyMode = false;
  let alertFilter = "all";
  let currentDetailUrl = "";
  let syncTimer = null;
  let toastTimer = null;
  let pushTimer = null;
  const pendingFetches = new Map();
  let fetchSeq = 1;

  function loadJson(key, fallback, mergeDefault) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return mergeDefault ? { ...fallback } : fallback;
      const parsed = JSON.parse(raw);
      return mergeDefault && parsed && typeof parsed === "object"
        ? { ...fallback, ...parsed }
        : parsed;
    } catch (_) {
      return mergeDefault ? { ...fallback } : fallback;
    }
  }

  function saveJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (_) {}
  }

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatBDT(amount, decimals = 2) {
    const n = Number(amount || 0);
    if (!Number.isFinite(n)) return "BDT 0.00";
    const fixed = decimals > 0 ? n.toFixed(decimals) : Math.round(n).toString();
    const parts = fixed.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `BDT ${parts.join(".")}`;
  }

  function formatRelTime(ts) {
    if (!ts) return "Never";
    const ms = typeof ts === "number" ? ts : new Date(ts).getTime();
    if (!Number.isFinite(ms)) return "—";
    const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (sec < 10) return "Just now";
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return new Date(ms).toLocaleDateString();
  }

  function showToast(msg) {
    const el = document.getElementById("toastEl");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
  }

  function showPushBanner(title, body) {
    const el = document.getElementById("pushBanner");
    if (!el) return;
    document.getElementById("pushTitle").textContent = title;
    document.getElementById("pushBody").textContent = body;
    el.classList.add("show");
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function vibrate(kind) {
    try {
      window.AndroidBridge?.vibrate?.(kind);
    } catch (_) {}
  }

  function syncSettingsToNative() {
    saveJson(STORAGE.SETTINGS, state.settings);
    try {
      window.AndroidBridge?.updateSettings?.(JSON.stringify(state.settings));
    } catch (_) {}
  }

  function mergeNativeAlerts() {
    try {
      const raw = window.AndroidBridge?.consumePendingAlerts?.();
      if (!raw) return;
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length > 0) {
        const existingIds = new Set(state.alerts.map((a) => a.id));
        const fresh = list.filter((a) => a && a.id && !existingIds.has(a.id));
        if (fresh.length > 0) {
          state.alerts = [...fresh, ...state.alerts].slice(0, 150);
          saveJson(STORAGE.ALERTS, state.alerts);
        }
      }
    } catch (_) {}
  }

  function appendAlert(alertObj) {
    const entry = {
      id: alertObj.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: alertObj.timestamp || new Date().toISOString(),
      read: false,
      ...alertObj
    };
    state.alerts = [entry, ...state.alerts].slice(0, 150);
    saveJson(STORAGE.ALERTS, state.alerts);
    renderAlertBadge();
    return entry;
  }

  function notifyNative(type, title, body) {
    try {
      window.AndroidBridge?.showNativeNotification?.(type, title, body);
    } catch (_) {}
  }

  window.__slmOnFetchResult = function (callbackId, payloadJson) {
    const resolver = pendingFetches.get(callbackId);
    if (!resolver) return;
    pendingFetches.delete(callbackId);
    try {
      resolver(JSON.parse(payloadJson));
    } catch (_) {
      resolver({ ok: false, loggedOut: false, text: "", isHtml: false });
    }
  };

  function fetchMerchPath(path) {
    return new Promise((resolve) => {
      if (window.AndroidBridge && typeof window.AndroidBridge.fetchMerchPath === "function") {
        const id = `f_${fetchSeq++}`;
        pendingFetches.set(id, resolve);
        setTimeout(() => {
          if (pendingFetches.has(id)) {
            pendingFetches.delete(id);
            resolve({ ok: false, loggedOut: false, text: "", isHtml: false });
          }
        }, 25000);
        try {
          window.AndroidBridge.fetchMerchPath(path, id);
        } catch (_) {
          pendingFetches.delete(id);
          resolve({ ok: false, loggedOut: false, text: "", isHtml: false });
        }
        return;
      }
      resolve({ ok: false, loggedOut: true, text: "", isHtml: false });
    });
  }

  function resolveMerchantName(dash) {
    const list = [
      state.profile?.name,
      dash?.stats?.merchantProfile?.name,
      dash?.stats?.merchantProfile?.fullName,
      dash?.stats?.merchantProfile?.ownerName,
      dash?.stats?.merchantProfile?.merchantName,
      dash?.session?.user?.name
    ];
    for (const c of list) {
      const s = String(c || "").trim();
      if (s && !/^manager\d*$/i.test(s) && s.toLowerCase() !== "merchant") return s;
    }
    return "LoveLy Merch";
  }

  function isDefaultAvatar(url) {
    if (!url) return true;
    const s = String(url).toLowerCase();
    return s.includes("/avatar.png") || s.endsWith("avatar.png") || s.startsWith("data:image/gif");
  }

  function resolveProfilePic(dash) {
    const u = dash?.session?.user || {};
    const p = dash?.stats?.merchantProfile || {};
    const candidates = [
      state.profile?.photo,
      u.profileImageUrl,
      u.profileImage,
      u.avatarUrl,
      u.image,
      p.profileImageUrl,
      p.profileImage
    ];
    for (const raw of candidates) {
      if (!raw || isDefaultAvatar(raw)) continue;
      const s = String(raw).trim();
      if (/^https?:\/\//i.test(s)) return s;
      if (s.startsWith("//")) return `https:${s}`;
      if (s.startsWith("/")) return `https://merch.sadamata.com${s}`;
    }
    return "./logo.png";
  }

  async function refreshProfileFromServer(force = false) {
    if (!force && state.lastProfileAt && Date.now() - state.lastProfileAt < 10 * 60 * 1000 && state.profile?.name) {
      return;
    }
    state.lastProfileAt = Date.now();
    try {
      const res = await fetchMerchPath("/dashboard/profile");
      if (!res.ok || !res.text) return;

      const parsed = SLMFlight.extractProfileData(res.text, res.isHtml);
      let changed = false;

      if (parsed?.name && !/^manager\d*$/i.test(parsed.name)) {
        state.profile.name = parsed.name;
        changed = true;
      }
      if (parsed?.profileImageUrl && !isDefaultAvatar(parsed.profileImageUrl)) {
        state.profile.photo = parsed.profileImageUrl;
        changed = true;
      }

      if (changed) {
        saveJson(STORAGE.PROFILE, state.profile);
        renderHeader();
        renderHeroAndStrip();
      }
    } catch (_) {}
  }

  function pushSnapshotMetricsToNative(dash) {
    try {
      if (!dash || !dash.stats || !window.AndroidBridge?.saveSnapshotMetrics) return;
      const rep = dash.report || {};
      const all = dash.salesReport?.allTime || {};
      window.AndroidBridge.saveSnapshotMetrics(
        JSON.stringify({
          allSold: Number(all.soldUnits ?? 0),
          allRoyalty: Number(all.merchantRoyalty ?? 0) + Number(all.merchantExcessRoyalty ?? 0),
          todaySold: Number(rep.soldUnits ?? 0),
          todayRoyalty: Number(rep.merchantRoyalty ?? 0) + Number(rep.merchantExcessRoyalty ?? 0),
          allCanc: Number(all.canceledOrders ?? 0),
          todayCanc: Number(rep.canceledOrders ?? 0),
          allRet: Number(all.refundedUnits ?? 0),
          todayRet: Number(rep.refundedUnits ?? 0),
          tier: Number(dash.stats?.merchantProfile?.tiar ?? 0),
          liveProducts: Number(dash.stats?.totalLiveProducts ?? 0),
          rejectedProducts: Number(dash.stats?.totalRejectedProducts ?? 0)
        })
      );
    } catch (_) {}
  }

  async function refreshAnalyzeCatalog(force = false) {
    if (!force && state.lastAnalyzeAt && Date.now() - state.lastAnalyzeAt < 5 * 60 * 1000 && state.analyzeItems.length > 0) {
      return state.analyzeItems;
    }
    try {
      const res = await fetchMerchPath("/dashboard/analyze");
      if (!res.ok || !res.text) return state.analyzeItems;
      const parsed = SLMFlight.extractAnalyzeData(res.text, res.isHtml);
      if (parsed && Array.isArray(parsed.initialItems)) {
        state.analyzeItems = parsed.initialItems;
        state.lastAnalyzeAt = Date.now();
        saveJson(STORAGE.ANALYZE_ITEMS, state.analyzeItems);
      }
    } catch (_) {}
    return state.analyzeItems;
  }

  async function findChangedAnalyzeItem(fieldName) {
    const prevItems = [...state.analyzeItems];
    const freshItems = await refreshAnalyzeCatalog(true);
    for (const nextIt of freshItems) {
      const pId = nextIt.productId || nextIt.id;
      const prevIt = prevItems.find(
        (p) => (p.productId || p.id) === pId || (p.slug && p.slug === nextIt.slug)
      );
      if (Number(nextIt[fieldName] || 0) > Number(prevIt?.[fieldName] || 0)) {
        return nextIt;
      }
    }
    return null;
  }

  async function processSnapshotDiff(prev, next) {
    if (!prev || !prev.stats || !next || !next.stats) return;
    const s = state.settings;

    // 1. New Sales
    const prevAllSold = Number(prev.salesReport?.allTime?.soldUnits ?? 0);
    const nextAllSold = Number(next.salesReport?.allTime?.soldUnits ?? 0);
    const prevTodaySold = Number(prev.report?.soldUnits ?? 0);
    const nextTodaySold = Number(next.report?.soldUnits ?? 0);

    let deltaUnits = 0;
    let deltaRoyalty = 0;
    if (nextAllSold > prevAllSold) {
      deltaUnits = nextAllSold - prevAllSold;
      const pR = Number(prev.salesReport?.allTime?.merchantRoyalty ?? 0) + Number(prev.salesReport?.allTime?.merchantExcessRoyalty ?? 0);
      const nR = Number(next.salesReport?.allTime?.merchantRoyalty ?? 0) + Number(next.salesReport?.allTime?.merchantExcessRoyalty ?? 0);
      deltaRoyalty = Math.max(0, nR - pR);
    } else if (nextTodaySold > prevTodaySold) {
      deltaUnits = nextTodaySold - prevTodaySold;
      const pR = Number(prev.report?.merchantRoyalty ?? 0) + Number(prev.report?.merchantExcessRoyalty ?? 0);
      const nR = Number(next.report?.merchantRoyalty ?? 0) + Number(next.report?.merchantExcessRoyalty ?? 0);
      deltaRoyalty = Math.max(0, nR - pR);
    }

    if (deltaUnits > 0) {
      const royTxt = formatBDT(deltaRoyalty, 2);
      const title = `New Sale (+${deltaUnits})`;
      const body = `You sold ${deltaUnits} more unit${deltaUnits > 1 ? "s" : ""} (+${royTxt} royalty).`;
      appendAlert({ type: "sale", title, body, deltaSold: deltaUnits, deltaRoyalty });
      showPushBanner(title, body);

      if (s.notifyOnSale) notifyNative("sale", title, body);
      if (s.playSaleSound) SLMAudio.playSaleSound(s.soundPreset, s.saleSoundVolume);
      vibrate("sale");
      if (s.showSaleEffect !== false && SLMEffects?.triggerSaleCelebration) {
        SLMEffects.triggerSaleCelebration({ deltaSold: deltaUnits, deltaRoyalty, currencySymbol: "BDT", compact: true });
      }
      refreshAnalyzeCatalog(true).then(() => renderProductsList());
    }

    // 2. Cancellations & Returns
    const prevAllCanc = Number(prev.salesReport?.allTime?.canceledOrders ?? 0);
    const nextAllCanc = Number(next.salesReport?.allTime?.canceledOrders ?? 0);
    const prevTodayCanc = Number(prev.report?.canceledOrders ?? 0);
    const nextTodayCanc = Number(next.report?.canceledOrders ?? 0);
    const deltaCanc = Math.max(0, nextAllCanc > prevAllCanc ? nextAllCanc - prevAllCanc : nextTodayCanc - prevTodayCanc);

    const prevAllRet = Number(prev.salesReport?.allTime?.refundedUnits ?? 0);
    const nextAllRet = Number(next.salesReport?.allTime?.refundedUnits ?? 0);
    const prevTodayRet = Number(prev.report?.refundedUnits ?? 0);
    const nextTodayRet = Number(next.report?.refundedUnits ?? 0);
    const deltaRet = Math.max(0, nextAllRet > prevAllRet ? nextAllRet - prevAllRet : nextTodayRet - prevTodayRet);

    if (deltaCanc > 0) {
      const matched = await findChangedAnalyzeItem("cancelledQty");
      const cleanTitle = matched ? String(matched.title || "").trim() : "";
      const title = cleanTitle ? `Cancelled (+${deltaCanc}): ${cleanTitle}` : `Order Cancelled (+${deltaCanc})`;
      const body = cleanTitle
        ? `${deltaCanc} order for "${cleanTitle}" was cancelled.`
        : `${deltaCanc} order${deltaCanc > 1 ? "s were" : " was"} cancelled.`;
      appendAlert({ type: "cancel", title, body });
      showPushBanner(`📉 ${title}`, body);
      if (s.notifyOnCancel) notifyNative("cancel", title, body);
      if (s.playCancelSound) SLMAudio.playCancelSound(s.cancelSoundPreset, s.cancelSoundVolume);
      vibrate("cancel");
    }

    if (deltaRet > 0) {
      const matched = await findChangedAnalyzeItem("returnedQty");
      const cleanTitle = matched ? String(matched.title || "").trim() : "";
      const title = cleanTitle ? `Returned (+${deltaRet}): ${cleanTitle}` : `Product Returned (+${deltaRet})`;
      const body = cleanTitle
        ? `${deltaRet} unit of "${cleanTitle}" was returned / refunded.`
        : `${deltaRet} unit${deltaRet > 1 ? "s were" : " was"} returned / refunded.`;
      appendAlert({ type: "return", title, body });
      showPushBanner(`↩️ ${title}`, body);
      if (s.notifyOnCancel) notifyNative("return", title, body);
      if (s.playCancelSound) SLMAudio.playCancelSound(s.cancelSoundPreset, s.cancelSoundVolume);
      vibrate("cancel");
    }

    // 3. Tier Up
    const prevTier = Number(prev.stats?.merchantProfile?.tiar ?? 0);
    const nextTier = Number(next.stats?.merchantProfile?.tiar ?? 0);
    if (prevTier > 0 && nextTier > prevTier) {
      const title = `Tier Up: Tier ${nextTier}!`;
      const body = `Your account leveled up from Tier ${prevTier} to Tier ${nextTier}.`;
      appendAlert({ type: "tier", title, body });
      if (s.notifyOnTierUp) {
        notifyNative("tier", title, body);
        if (SLMEffects?.triggerTierUpCelebration) {
          SLMEffects.triggerTierUpCelebration({ tier: nextTier, previousTier: prevTier, playSound: true, volume: 0.9 });
        }
      }
    }

    // 4. Live / Rejected Status Changes
    const prevLive = Number(prev.stats?.totalLiveProducts ?? 0);
    const nextLive = Number(next.stats?.totalLiveProducts ?? 0);
    if (nextLive > prevLive) {
      const diff = nextLive - prevLive;
      const title = `+${diff} Product${diff > 1 ? "s" : ""} Went Live`;
      const body = `Live catalog increased from ${prevLive} to ${nextLive}.`;
      appendAlert({ type: "live", title, body });
      showPushBanner(`✅ ${title}`, body);
      if (s.notifyOnStatusChange) notifyNative("status", title, body);
    }

    const prevRej = Number(prev.stats?.totalRejectedProducts ?? 0);
    const nextRej = Number(next.stats?.totalRejectedProducts ?? 0);
    if (nextRej > prevRej) {
      const diff = nextRej - prevRej;
      const title = `+${diff} Design${diff > 1 ? "s" : ""} Rejected`;
      const body = `Rejected count increased from ${prevRej} to ${nextRej}.`;
      appendAlert({ type: "rejected", title, body });
      if (s.notifyOnStatusChange) notifyNative("status", title, body);
    }
  }

  async function syncDashboard(manual = false) {
    if (state.syncing) return;
    state.syncing = true;
    const syncBtn = document.getElementById("syncBtn");
    if (syncBtn) syncBtn.classList.add("spinning");

    mergeNativeAlerts();

    try {
      const res = await fetchMerchPath("/dashboard");
      if (res.loggedOut) {
        state.authenticated = false;
        renderAll();
        if (manual) showToast("Please sign in to Sadamata");
        return;
      }

      if (res.ok && res.text) {
        const parsed = SLMFlight.extractDashboardData(res.text, res.isHtml);
        const layoutPhoto = SLMFlight.extractLayoutProfileImage(res.text, res.isHtml);
        if (layoutPhoto && !isDefaultAvatar(layoutPhoto)) {
          state.profile.photo = layoutPhoto;
          saveJson(STORAGE.PROFILE, state.profile);
        }
        if (parsed && parsed.stats) {
          const prev = state.dashboard;
          state.authenticated = true;
          state.lastSyncAt = Date.now();
          await processSnapshotDiff(prev, parsed);
          state.dashboard = { ...parsed, fetchedAt: state.lastSyncAt };
          saveJson(STORAGE.DASHBOARD, state.dashboard);
          pushSnapshotMetricsToNative(state.dashboard);
          renderAll();
          if (manual) showToast("Dashboard synced!");
          // Enrich sold product thumbnails/royalties & exact profile name asynchronously
          refreshAnalyzeCatalog(false).then(() => renderProductsList());
          refreshProfileFromServer(manual || !state.profile?.name);
          return;
        }
      }

      if (manual) showToast("Could not refresh — check internet");
      renderHeader();
    } finally {
      state.syncing = false;
      if (syncBtn) syncBtn.classList.remove("spinning");
    }
  }

  function scheduleAutoSync() {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
    if (state.settings.autoSyncEnabled) {
      const mins = Math.max(1, Number(state.settings.syncIntervalMin) || 1);
      syncTimer = setInterval(() => syncDashboard(false), mins * 60 * 1000);
    }
  }

  /* ==================== RENDERING ==================== */

  function initMonthLabels() {
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const now = new Date();
    const curM = months[now.getMonth()];
    const prevM = months[(now.getMonth() + 11) % 12];
    const elCur = document.getElementById("tabThisMonth");
    const elPrev = document.getElementById("tabPrevMonth");
    if (elCur) elCur.textContent = curM;
    if (elPrev) elPrev.textContent = prevM;
  }

  function applyTheme() {
    const theme = state.settings.theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
  }

  function renderHeader() {
    const banner = document.getElementById("loginBanner");
    if (banner) banner.style.display = state.authenticated ? "none" : "flex";
  }

  function renderAlertBadge() {
    const unread = state.alerts.filter((a) => !a.read).length;
    const badge = document.getElementById("bellBadge");
    if (!badge) return;
    if (unread > 0) {
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.style.display = "inline-flex";
    } else {
      badge.style.display = "none";
    }
  }

  function getPeriodStats() {
    const d = state.dashboard;
    const netMode = state.settings.netMode !== false;
    const now = new Date();
    const curMonthName = now.toLocaleString("en-US", { month: "long" });

    if (!d || !d.stats) {
      return { title: "Today's Sales", royLbl: "Today's Royalty", units: 0, canc: 0, ret: 0, royalty: 0 };
    }

    const rep = d.report || {};
    const sr = d.salesReport || {};

    if (activePeriod === "today") {
      return {
        title: "Today's Sales",
        royLbl: "Today's Royalty",
        units: Number(rep.soldUnits || 0),
        canc: Number(rep.canceledOrders || 0),
        ret: Number(rep.refundedUnits || 0),
        royalty: Number(rep.merchantRoyalty || 0) + Number(rep.merchantExcessRoyalty || 0)
      };
    }

    const map = {
      yesterday: { obj: sr.yesterday, title: "Yesterday's Sales", royLbl: "Yesterday's Royalty" },
      last7: { obj: sr.last7, title: "Last 7 Days", royLbl: "7-Day Royalty" },
      thisMonth: { obj: sr.thisMonth, title: `${curMonthName} Sales`, royLbl: "This Month's Royalty" },
      prevMonth: { obj: sr.prevMonth, title: "Previous Month", royLbl: "Prev Month's Royalty" },
      allTime: { obj: sr.allTime, title: "All Time Sales", royLbl: "Total Royalty" }
    };
    const chosen = map[activePeriod] || map.last7;
    const o = chosen.obj || {};
    const units = netMode ? Number(o.netUnits ?? o.soldUnits ?? 0) : Number(o.soldUnits ?? 0);
    const roy = netMode
      ? Number(o.netMerchantRoyalty || 0) + Number(o.netMerchantExcessRoyalty || 0)
      : Number(o.merchantRoyalty || 0) + Number(o.merchantExcessRoyalty || 0);

    return {
      title: chosen.title,
      royLbl: chosen.royLbl,
      units,
      canc: Number(o.canceledOrders || 0),
      ret: Number(o.refundedUnits || 0),
      royalty: roy
    };
  }

  function renderHeroAndStrip() {
    const d = state.dashboard;
    const netMode = state.settings.netMode !== false;
    const p = getPeriodStats();
    const st = d?.stats || {};
    const tier = Number(st.merchantProfile?.tiar || 0);

    // Sadamata Merchant Profile Photo, Name & Tier in Hero Header
    const heroAvatar = document.getElementById("heroAvatar");
    if (heroAvatar) {
      const pic = resolveProfilePic(d);
      if (heroAvatar.getAttribute("src") !== pic) {
        heroAvatar.onerror = () => {
          heroAvatar.onerror = null;
          heroAvatar.src = "./logo.png";
        };
        heroAvatar.src = pic;
      }
    }
    const heroDot = document.getElementById("heroLiveDot");
    if (heroDot) heroDot.className = `hero-live-dot ${state.authenticated ? "online" : "offline"}`;
    document.getElementById("heroProfileName").textContent = resolveMerchantName(d);
    document.getElementById("heroTierPill").textContent = tier ? `Tier ${tier}` : "Tier —";

    document.getElementById("heroPeriodLabel").textContent = p.title;
    document.getElementById("heroRoyLbl").textContent = p.royLbl;
    document.getElementById("heroCount").textContent = p.units.toLocaleString();
    document.getElementById("heroCanc").textContent = String(p.canc);
    document.getElementById("heroRet").textContent = String(p.ret);
    document.getElementById("heroWithSales").textContent = String(Number(st.totalProductsWithSales || 0));
    document.getElementById("heroRoy").textContent = formatBDT(p.royalty, 2);
    document.getElementById("netTxt").textContent = netMode ? "Net" : "Gross";
    const pct = Number(st.merchantProfile?.dailyLimitPct || 0);
    const dailyMax = Math.round((tier * pct) / 100);
    const uploaded = Number(d?.today?.totalTodayUploaded || 0);
    const barPct = dailyMax > 0 ? Math.min(100, Math.round((uploaded / dailyMax) * 100)) : 0;

    document.getElementById("mTierLbl").textContent = tier ? `TIER ${tier}` : "TIER —";
    document.getElementById("mUploadVal").textContent = `${uploaded}/${dailyMax}`;
    document.getElementById("mTierSub").textContent = `${Number(st.merchantProfile?.leftTiar ?? 0)} slots left`;
    document.getElementById("mUploadBar").style.width = `${barPct}%`;

    const live = Number(st.totalLiveProducts || 0);
    const total = Number(st.totalProducts || 0);
    const withSales = Number(st.totalProductsWithSales || 0);
    const rev = Number(st.totalUnderReviewProducts || 0);
    const proc = Number(st.totalProcessingProducts || 0);
    const rej = Number(st.totalRejectedProducts || 0);

    document.getElementById("mLiveVal").textContent = live.toLocaleString();
    document.getElementById("mWithSalesSub").textContent = `${withSales} with sales`;
    document.getElementById("mPipeVal").textContent = String(rev + proc);
    document.getElementById("mPipeSub").textContent = `${rev} rev • ${proc} proc`;
    document.getElementById("mRejVal").textContent = String(rej);
    document.getElementById("mTotalSub").textContent = `${total} total`;
    document.getElementById("mTodayUpVal").textContent = String((d?.today?.products || []).length);

    renderCatalogDonut(live, rev, proc, rej, total);

    // Uploaded Today card (with clickable design links)
    const todayUps = d?.today?.products || [];
    document.getElementById("uploadsCountLbl").textContent = `${todayUps.length} design${todayUps.length === 1 ? "" : "s"}`;
    const uploadsEl = document.getElementById("todayUploadsList");
    uploadsEl.innerHTML = todayUps.length > 0
      ? todayUps
          .map((u) => {
            const matched = matchAnalyzeProduct(u);
            const url = buildProductUrl(u, matched, !u.isActive);
            return `
          <div class="upload-row">
            <a class="upload-title-link" href="${esc(url)}" data-ext-url="${esc(url)}">${esc(u.title)}</a>
            <span class="status-tag ${u.isActive ? "active" : "pending"}">${u.isActive ? "Active" : "Pending"}</span>
          </div>
        `;
          })
          .join("")
      : `<div class="uploads-empty">No designs uploaded today yet.</div>`;

    uploadsEl.querySelectorAll("a[data-ext-url]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const url = a.getAttribute("data-ext-url");
        if (url) openProductLink(url);
      });
    });
  }

  function renderCatalogDonut(live, rev, proc, rej, total) {
    const el = document.getElementById("catalogDonut");
    const lbl = document.getElementById("catalogTotalLbl");
    if (lbl) lbl.textContent = `${total.toLocaleString()} design${total === 1 ? "" : "s"}`;
    if (!el) return;

    const segments = [
      { label: "Live", value: live, color: "#10b981" },
      { label: "Under Review", value: rev, color: "#f59e0b" },
      { label: "Processing", value: proc, color: "#3b82f6" },
      { label: "Rejected", value: rej, color: "#f43f5e" }
    ];

    const sum = segments.reduce((acc, s) => acc + Math.max(0, Number(s.value || 0)), 0);
    const size = 132;
    const cx = 66;
    const cy = 66;
    const r = 47;
    const stroke = 14;
    const circ = 2 * Math.PI * r;

    let offset = 0;
    let arcs = "";
    if (sum === 0) {
      arcs = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(148,163,184,0.22)" stroke-width="${stroke}" />`;
    } else {
      for (const seg of segments) {
        const v = Math.max(0, Number(seg.value || 0));
        if (v === 0) continue;
        const dash = (v / sum) * circ;
        arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${esc(seg.color)}" stroke-width="${stroke}" stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" />`;
        offset += dash;
      }
    }

    const legend = segments
      .map(
        (s) => `
      <div class="donut-leg-row">
        <span class="donut-leg-left">
          <span class="donut-dot" style="background:${esc(s.color)}"></span>
          <span>${esc(s.label)}</span>
        </span>
        <strong class="donut-num">${Number(s.value || 0).toLocaleString()}</strong>
      </div>
    `
      )
      .join("");

    el.innerHTML = `
      <div class="donut-wrap">
        <svg viewBox="0 0 ${size} ${size}" width="118" height="118" style="flex-shrink:0;">
          ${arcs}
          <text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-center-top">${esc(total.toLocaleString())}</text>
          <text x="${cx}" y="${cy + 15}" text-anchor="middle" class="donut-center-sub">Total</text>
        </svg>
        <div class="donut-legend">${legend}</div>
      </div>
    `;
  }

  function buildProductUrl(it, matched, isPending = false) {
    const rawKey =
      it?.slug || it?.productId || it?.id || it?.productKey ||
      matched?.slug || matched?.productId || matched?.id || "";
    if (rawKey) {
      let slug = String(rawKey).trim();
      if (/^https?:\/\//i.test(slug)) return slug;
      slug = slug.replace(/^\/+|\/+$/g, "");
      if (slug.startsWith("products/")) return `https://sadamata.com/${slug}`;
      return `https://sadamata.com/products/${encodeURIComponent(slug)}`;
    }
    if (isPending) return "https://merch.sadamata.com/dashboard/manage";
    const title = String(it?.title || it?.productTitle || it?.name || "").trim();
    return title
      ? `https://sadamata.com/products?q=${encodeURIComponent(title)}`
      : "https://merch.sadamata.com/dashboard/manage";
  }

  function openProductLink(url) {
    if (!url) return;
    if (window.AndroidBridge && typeof window.AndroidBridge.openExternalUrl === "function") {
      window.AndroidBridge.openExternalUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function matchAnalyzeProduct(item) {
    if (!item || !state.analyzeItems.length) return null;
    const pid = item.productId || item.id;
    const slug = item.slug;
    const rawTitle = String(item.title || item.productTitle || item.name || "").trim().toLowerCase();
    return (
      state.analyzeItems.find(
        (a) =>
          (pid && (a.productId === pid || a.id === pid)) ||
          (slug && a.slug === slug) ||
          (rawTitle && String(a.title || "").trim().toLowerCase() === rawTitle)
      ) || null
    );
  }

  function normalizeThumb(raw) {
    if (!raw) return FALLBACK_SHIRT;
    const s = String(raw).trim();
    if (!s) return FALLBACK_SHIRT;
    if (/^https?:\/\//i.test(s) || s.startsWith("data:")) return s;
    if (s.startsWith("//")) return `https:${s}`;
    if (s.startsWith("/")) return `https://sadamata.com${s}`;
    return FALLBACK_SHIRT;
  }

  function buildProductsForActivePeriod() {
    const d = state.dashboard;
    if (!d) return [];

    const ranges = d.salesData?.ranges || {};
    let sourceItems = [];
    let rangeKey = "today";

    if (activePeriod === "today") {
      rangeKey = "today";
      sourceItems = ranges.today?.items || [];
    } else if (activePeriod === "yesterday" || activePeriod === "last7") {
      rangeKey = "last7d";
      sourceItems = ranges.last7d?.items || [];
    } else if (activePeriod === "thisMonth") {
      rangeKey = "last30d";
      sourceItems = ranges.last30d?.items || [];
    } else if (activePeriod === "prevMonth") {
      rangeKey = "last90d";
      sourceItems = ranges.last90d?.items || [];
    } else {
      // All Time -> prefer analyze catalog sorted by purchasedQty desc, fallback last90d
      const soldAnalyze = state.analyzeItems
        .filter((a) => Number(a.purchasedQty || 0) > 0)
        .sort((a, b) => Number(b.purchasedQty || 0) - Number(a.purchasedQty || 0));
      if (soldAnalyze.length > 0) {
        return soldAnalyze.slice(0, 40).map((a) => ({
          id: a.productId || a.id || "",
          title: a.title || "Product",
          brand: a.brandName || "Sadamata",
          qty: Number(a.purchasedQty || 0),
          cancRet: Number(a.cancelledQty || 0) + Number(a.returnedQty || 0),
          royalty: Number(a.royalties || 0) + Number(a.excessRoyalties || 0),
          thumb: normalizeThumb(a.previewUrl || a.thumbnail),
          url: a.productId || a.id ? `https://sadamata.com/products/${encodeURIComponent(a.productId || a.id)}` : ""
        }));
      }
      rangeKey = "last90d";
      sourceItems = ranges.last90d?.items || [];
    }

    const rep = d.report || {};
    const todayRoy = Number(rep.merchantRoyalty || 0) + Number(rep.merchantExcessRoyalty || 0);
    const todaySold = Number(rep.soldUnits || 0);

    return sourceItems.map((it) => {
      const m = matchAnalyzeProduct(it);
      const qty = Number(it.qty || it.totalQty || it.units || it.purchasedQty || 1);
      const title = m?.title || it.title || it.productTitle || it.name || it.productId || "Sold Design";
      const brand = it.brandName || m?.brandName || "Sadamata Merch";
      const thumb = normalizeThumb(
        it.previewUrl || it.variants?.[0]?.frontImgUrl || it.frontImgUrl || it.thumbnail || it.image ||
        m?.previewUrl || m?.thumbnail
      );

      let roy =
        Number(it.merchantRoyalty || 0) + Number(it.merchantExcessRoyalty || 0) ||
        Number(it.totalRoyalty || 0) ||
        Number(it.royalty || 0) ||
        Number(it.royalties || 0);

      if (roy <= 0 && m) {
        const mRoy = Number(m.royalties || 0) + Number(m.excessRoyalties || 0);
        const mQty = Number(m.purchasedQty || 0);
        if (mRoy > 0 && mQty > 0) roy = (mRoy / mQty) * qty;
      }
      if (roy <= 0 && rangeKey === "today" && todayRoy > 0 && todaySold > 0) {
        roy = (todayRoy / todaySold) * qty;
      }

      const cancRet = Number(it.cancelledQty || 0) + Number(it.returnedQty || 0) +
        (m && rangeKey !== "today" ? Number(m.cancelledQty || 0) + Number(m.returnedQty || 0) : 0);

      const pid = it.productId || it.id || m?.productId || m?.id || "";
      return {
        id: pid,
        title,
        brand,
        qty,
        cancRet,
        royalty: roy,
        thumb,
        url: buildProductUrl(it, m, false)
      };
    });
  }

  function renderProductsList() {
    const listEl = document.getElementById("prodList");
    const countEl = document.getElementById("prodSecCount");
    const items = buildProductsForActivePeriod();

    listEl.classList.toggle("privacy-on", privacyMode);
    countEl.textContent = items.length > 0 ? `(${items.length})` : "";

    if (items.length === 0) {
      listEl.innerHTML = `<div class="empty-card">${
        state.authenticated
          ? "No products sold in this period yet."
          : "Sign in to your Sadamata account to see sold products here."
      }</div>`;
      return;
    }

    listEl.innerHTML = items
      .map(
        (p, idx) => `
      <div class="prod-card" data-pidx="${idx}">
        <div class="prod-thumb">
          <img src="${esc(p.thumb)}" alt="" loading="lazy" />
        </div>
        <div class="prod-info">
          <div class="badge-row">
            <span class="stat-pill sold">👕 ${p.qty}</span>
            <span class="stat-pill ret">↩ ${p.cancRet}</span>
            <span class="stat-pill roy">${esc(formatBDT(p.royalty, 2))}</span>
          </div>
          <a class="prod-title-link" href="${esc(p.url)}" data-ext-url="${esc(p.url)}">${esc(p.title)}</a>
          <div class="prod-meta">
            <span class="mini-dot" style="background:#ff681d;"></span>
            <span>${esc(String(p.brand || "SADAMATA").toUpperCase())}</span>
          </div>
        </div>
      </div>
    `
      )
      .join("");

    listEl.querySelectorAll(".prod-thumb img").forEach((img) => {
      img.addEventListener("error", () => {
        if (img.src !== FALLBACK_SHIRT) img.src = FALLBACK_SHIRT;
      }, { once: true });
    });

    listEl.querySelectorAll("a[data-ext-url]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (privacyMode) return;
        const url = a.getAttribute("data-ext-url");
        if (url) openProductLink(url);
      });
    });

    listEl.querySelectorAll(".prod-card").forEach((card) => {
      card.addEventListener("click", () => {
        const p = items[Number(card.getAttribute("data-pidx") || 0)];
        if (p) openProductDetail(p);
      });
    });
  }

  function openProductDetail(p) {
    currentDetailUrl = p.url || "";
    const extBtn = document.getElementById("prodExtBtn");
    if (extBtn) extBtn.style.display = currentDetailUrl ? "inline-flex" : "none";

    document.getElementById("prodModalBody").innerHTML = `
      <div class="detail-img-box">
        <img src="${esc(p.thumb)}" alt="" onerror="this.src='${FALLBACK_SHIRT}'" />
      </div>
      <a class="detail-title-link" href="${esc(currentDetailUrl)}" id="detailTitleLink">${esc(p.title)} ↗</a>
      <div class="detail-grid">
        <div class="detail-tile green">
          <div class="detail-tile-lbl" style="color:inherit;opacity:0.85;">STATUS</div>
          <div class="detail-tile-val">✓ Active</div>
        </div>
        <div class="detail-tile blue">
          <div class="detail-tile-lbl" style="color:inherit;opacity:0.85;">ROYALTY</div>
          <div class="detail-tile-val">${esc(formatBDT(p.royalty, 2))}</div>
        </div>
        <div class="detail-tile">
          <div class="detail-tile-lbl">UNITS SOLD</div>
          <div class="detail-tile-val">${p.qty}</div>
        </div>
        <div class="detail-tile">
          <div class="detail-tile-lbl">CANC / RET</div>
          <div class="detail-tile-val" style="color:var(--pm-amber);">${p.cancRet}</div>
        </div>
      </div>
      <div class="set-group" style="text-align:center;">
        <div class="set-row-s">Brand: <strong style="color:var(--pm-text);">${esc(p.brand)}</strong></div>
      </div>
    `;
    document.getElementById("prodModal").classList.add("open");
    document.getElementById("detailTitleLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      if (currentDetailUrl) openProductLink(currentDetailUrl);
    });
  }

  function renderAlertsSheet() {
    const filtered = state.alerts.filter((a) => {
      if (alertFilter === "sale") return a.type === "sale";
      if (alertFilter === "cancel") return a.type === "cancel" || a.type === "return";
      if (alertFilter === "status") return a.type === "tier" || a.type === "live" || a.type === "rejected";
      return true;
    });

    const unread = state.alerts.filter((a) => !a.read).length;
    document.getElementById("alertsSummaryText").textContent =
      unread > 0 ? `${unread} unread • ${state.alerts.length} total` : `${state.alerts.length} alerts`;

    const box = document.getElementById("alertsModalBody");
    box.innerHTML = filtered.length
      ? filtered
          .map(
            (a) => `
          <div class="alert-card ${esc(a.type || "sale")}">
            <div class="alert-card-head">
              <span class="alert-card-title">${esc(a.title)}</span>
              <span class="alert-card-time">${esc(formatRelTime(a.timestamp))}</span>
            </div>
            <div class="alert-card-body">${esc(a.body)}</div>
          </div>
        `
          )
          .join("")
      : `<div class="empty-card">No alerts recorded in this category yet.</div>`;
  }

  function renderSettingsModal() {
    const s = state.settings;
    document.getElementById("setNetToggle").checked = s.netMode !== false;
    document.getElementById("setAutoSync").checked = Boolean(s.autoSyncEnabled);
    document.getElementById("setBgMonitor").checked = Boolean(s.bgMonitorEnabled);

    const mins = Number(s.syncIntervalMin) || 1;
    document.getElementById("intervalTag").textContent = `${mins} min`;
    document.querySelectorAll("#intervalPills .int-btn").forEach((b) => {
      b.classList.toggle("active", Number(b.getAttribute("data-min")) === mins);
    });

    document.getElementById("setNotifySale").checked = Boolean(s.notifyOnSale);
    document.getElementById("setPlaySaleSound").checked = Boolean(s.playSaleSound);
    document.getElementById("setSalePreset").value = s.soundPreset || "kaching";
    const sVol = Math.round((Number(s.saleSoundVolume) || 0.75) * 100);
    document.getElementById("setSaleVol").value = String(sVol);
    document.getElementById("saleVolTag").textContent = `${sVol}%`;
    document.getElementById("setShowEffect").checked = s.showSaleEffect !== false;

    document.getElementById("setNotifyCancel").checked = Boolean(s.notifyOnCancel);
    document.getElementById("setPlayCancelSound").checked = Boolean(s.playCancelSound);
    document.getElementById("setCancelPreset").value = s.cancelSoundPreset || "sad_wah";
    const cVol = Math.round((Number(s.cancelSoundVolume) || 0.75) * 100);
    document.getElementById("setCancelVol").value = String(cVol);
    document.getElementById("cancelVolTag").textContent = `${cVol}%`;

    document.getElementById("setNotifyTier").checked = Boolean(s.notifyOnTierUp);
    document.getElementById("setNotifyStatus").checked = Boolean(s.notifyOnStatusChange);
  }

  function renderAll() {
    applyTheme();
    renderHeader();
    renderAlertBadge();
    renderHeroAndStrip();
    renderProductsList();
    renderAlertsSheet();
    renderSettingsModal();
  }

  function closeAllModals() {
    let closedAny = false;
    document.querySelectorAll(".sheet-overlay.open").forEach((el) => {
      el.classList.remove("open");
      closedAny = true;
    });
    const qrModal = document.getElementById("qrScannerModal");
    if (qrModal && qrModal.style.display !== "none") {
      closeQrScannerModal();
      closedAny = true;
    }
    return closedAny;
  }

  function populateSoundSelects() {
    document.getElementById("setSalePreset").innerHTML = SLMAudio.SALE_PRESETS.map(
      (p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`
    ).join("");
    document.getElementById("setCancelPreset").innerHTML = SLMAudio.CANCEL_PRESETS.map(
      (p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`
    ).join("");
  }

  function wireEvents() {
    document.addEventListener("pointerdown", () => SLMAudio.unlockAudio(), { once: true });

    // Date tabs
    document.querySelectorAll("#dateTabs .date-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        vibrate("tap");
        activePeriod = btn.getAttribute("data-p") || "today";
        document.querySelectorAll("#dateTabs .date-tab").forEach((b) => b.classList.toggle("active", b === btn));
        renderHeroAndStrip();
        renderProductsList();
      });
    });

    // Topbar buttons
    document.getElementById("syncBtn").addEventListener("click", () => {
      vibrate("tap");
      syncDashboard(true);
    });

    document.getElementById("bulbBtn").addEventListener("click", () => {
      vibrate("tap");
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      syncSettingsToNative();
      applyTheme();
    });

    document.getElementById("alertsBtn").addEventListener("click", () => {
      vibrate("tap");
      mergeNativeAlerts();
      renderAlertsSheet();
      document.getElementById("alertsModal").classList.add("open");
    });

    document.getElementById("gearBtn").addEventListener("click", () => {
      vibrate("tap");
      renderSettingsModal();
      document.getElementById("settingsModal").classList.add("open");
    });

    document.getElementById("brandTap").addEventListener("click", () => {
      if (!state.authenticated) {
        openQrScannerModal();
      } else {
        renderSettingsModal();
        document.getElementById("settingsModal").classList.add("open");
      }
    });

    document.getElementById("bannerLoginBtn").addEventListener("click", () => {
      openQrScannerModal();
    });

    document.getElementById("qrCloseBtn")?.addEventListener("click", closeQrScannerModal);
    document.getElementById("qrScannerModal")?.addEventListener("click", (e) => {
      if (e.target.id === "qrScannerModal") closeQrScannerModal();
    });

    document.getElementById("manualPairBtn")?.addEventListener("click", () => {
      const code = (document.getElementById("manualPairInput")?.value || "").trim().toUpperCase();
      if (!code) {
        showToast("Please enter a Pair Code");
        return;
      }
      submitPairCode(code);
    });

    document.getElementById("manualPairInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        document.getElementById("manualPairBtn")?.click();
      }
    });

    document.getElementById("qrCameraWrap")?.addEventListener("click", () => {
      if (!qrScanActive) {
        openQrScannerModal();
      }
    });

    document.getElementById("netBtn").addEventListener("click", () => {
      state.settings.netMode = !(state.settings.netMode !== false);
      syncSettingsToNative();
      renderHeroAndStrip();
      renderSettingsModal();
      showToast(state.settings.netMode ? "Net mode" : "Gross mode");
    });

    // Privacy Eye toggle
    document.getElementById("eyeBtn").addEventListener("click", (e) => {
      privacyMode = !privacyMode;
      e.currentTarget.classList.toggle("active", privacyMode);
      document.getElementById("prodList").classList.toggle("privacy-on", privacyMode);
      showToast(privacyMode ? "Privacy blur ON" : "Privacy blur OFF");
    });

    // Modal close buttons & backdrop tap
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-close");
        document.getElementById(id)?.classList.remove("open");
      });
    });

    document.querySelectorAll(".sheet-overlay").forEach((ov) => {
      ov.addEventListener("click", (e) => {
        if (e.target === ov) ov.classList.remove("open");
      });
    });

    document.getElementById("prodExtBtn").addEventListener("click", () => {
      if (currentDetailUrl) window.AndroidBridge?.openExternalUrl?.(currentDetailUrl);
    });

    // Alerts actions
    document.querySelectorAll("#alertFilterBar .flt-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        alertFilter = btn.getAttribute("data-f") || "all";
        document.querySelectorAll("#alertFilterBar .flt-pill").forEach((b) => b.classList.toggle("active", b === btn));
        renderAlertsSheet();
      });
    });

    document.getElementById("markReadBtn").addEventListener("click", () => {
      state.alerts = state.alerts.map((a) => ({ ...a, read: true }));
      saveJson(STORAGE.ALERTS, state.alerts);
      renderAlertBadge();
      renderAlertsSheet();
      showToast("All alerts marked read");
    });

    document.getElementById("clearAlertsBtn").addEventListener("click", () => {
      state.alerts = [];
      saveJson(STORAGE.ALERTS, state.alerts);
      renderAlertBadge();
      renderAlertsSheet();
      showToast("Alert history cleared");
    });

    // Settings toggles
    const bindToggle = (id, key, onChange) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        state.settings[key] = el.checked;
        syncSettingsToNative();
        if (onChange) onChange(el.checked);
      });
    };

    bindToggle("setNetToggle", "netMode", () => renderHeroAndStrip());
    bindToggle("setAutoSync", "autoSyncEnabled", () => scheduleAutoSync());
    bindToggle("setBgMonitor", "bgMonitorEnabled", (on) => showToast(on ? "Background Monitor ON" : "Background Monitor OFF"));
    bindToggle("setNotifySale", "notifyOnSale");
    bindToggle("setPlaySaleSound", "playSaleSound");
    bindToggle("setShowEffect", "showSaleEffect");
    bindToggle("setNotifyCancel", "notifyOnCancel");
    bindToggle("setPlayCancelSound", "playCancelSound");
    bindToggle("setNotifyTier", "notifyOnTierUp");
    bindToggle("setNotifyStatus", "notifyOnStatusChange");

    // Sound pickers & volume sliders (play chosen sound on select/release — no separate test buttons!)
    document.getElementById("setSalePreset").addEventListener("change", (e) => {
      state.settings.soundPreset = e.target.value;
      syncSettingsToNative();
      SLMAudio.playSaleSound(state.settings.soundPreset, state.settings.saleSoundVolume);
    });

    document.getElementById("setSaleVol").addEventListener("input", (e) => {
      const pct = Number(e.target.value || 75);
      document.getElementById("saleVolTag").textContent = `${pct}%`;
      state.settings.saleSoundVolume = pct / 100;
    });
    document.getElementById("setSaleVol").addEventListener("change", () => {
      syncSettingsToNative();
      SLMAudio.playSaleSound(state.settings.soundPreset, state.settings.saleSoundVolume);
    });

    document.getElementById("setCancelPreset").addEventListener("change", (e) => {
      state.settings.cancelSoundPreset = e.target.value;
      syncSettingsToNative();
      SLMAudio.playCancelSound(state.settings.cancelSoundPreset, state.settings.cancelSoundVolume);
    });

    document.getElementById("setCancelVol").addEventListener("input", (e) => {
      const pct = Number(e.target.value || 75);
      document.getElementById("cancelVolTag").textContent = `${pct}%`;
      state.settings.cancelSoundVolume = pct / 100;
    });
    document.getElementById("setCancelVol").addEventListener("change", () => {
      syncSettingsToNative();
      SLMAudio.playCancelSound(state.settings.cancelSoundPreset, state.settings.cancelSoundVolume);
    });

    // Interval pills
    document.querySelectorAll("#intervalPills .int-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mins = Number(btn.getAttribute("data-min") || 1);
        state.settings.syncIntervalMin = mins;
        syncSettingsToNative();
        scheduleAutoSync();
        renderSettingsModal();
        showToast(`Sync interval: ${mins} min`);
      });
    });

    // Log Out button
    document.getElementById("logoutBtn").addEventListener("click", () => {
      window.AndroidBridge?.logout?.();
      state.authenticated = false;
      state.dashboard = null;
      state.analyzeItems = [];
      state.profile = { name: "", photo: "" };
      state.lastProfileAt = 0;
      localStorage.removeItem(STORAGE.DASHBOARD);
      localStorage.removeItem(STORAGE.ANALYZE_ITEMS);
      localStorage.removeItem(STORAGE.PROFILE);
      closeAllModals();
      renderAll();
      showToast("Logged out");
    });
  }

  // ============================================================
  // Mobile QR Code Scanner & Instant Cookie Pairing Logic
  // ============================================================
  let qrMediaStream = null;
  let qrScanActive = false;

  function openQrScannerModal() {
    const modal = document.getElementById("qrScannerModal");
    const manualInput = document.getElementById("manualPairInput");
    const statusText = document.getElementById("qrStatusText");
    if (!modal) return;
    modal.style.display = "flex";
    if (manualInput) manualInput.value = "";

    let alreadyHasPerm = false;
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.hasCameraPermission === "function") {
        alreadyHasPerm = window.AndroidBridge.hasCameraPermission();
      }
    } catch (_) {}

    if (alreadyHasPerm) {
      if (statusText) statusText.textContent = "Starting camera...";
      startCameraAndScanner();
    } else {
      if (statusText) statusText.textContent = "Requesting camera permission...";
      if (window.AndroidBridge && typeof window.AndroidBridge.requestCameraPermission === "function") {
        window.AndroidBridge.requestCameraPermission();
      } else {
        startCameraAndScanner();
      }
    }
  }

  function closeQrScannerModal() {
    stopCameraAndScanner();
    const modal = document.getElementById("qrScannerModal");
    if (modal) modal.style.display = "none";
  }

  window.__slmOnCameraPermission = function (granted) {
    if (granted) {
      startCameraAndScanner();
    } else {
      const statusText = document.getElementById("qrStatusText");
      if (statusText) {
        statusText.innerHTML = `Camera permission denied. Enter Pair Code below or <button type="button" id="qrRetryPermBtn" style="background:none;border:none;color:#f37927;text-decoration:underline;cursor:pointer;font-weight:600;font-size:12px;">Grant Permission</button>`;
        document.getElementById("qrRetryPermBtn")?.addEventListener("click", () => {
          window.AndroidBridge?.requestCameraPermission?.();
        });
      }
    }
  };

  async function startCameraAndScanner() {
    const video = document.getElementById("qrVideo");
    const canvas = document.getElementById("qrCanvas");
    const statusText = document.getElementById("qrStatusText");
    if (!video || !canvas) return;

    stopCameraAndScanner();

    video.setAttribute("autoplay", "");
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.muted = true;
    video.playsInline = true;

    if (statusText) statusText.textContent = "Accessing camera...";

    let stream = null;
    let lastErr = null;

    const constraintOptions = [
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: "environment" }, audio: false },
      { video: { facingMode: { ideal: "user" } }, audio: false },
      { video: true, audio: false }
    ];

    for (const c of constraintOptions) {
      try {
        if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function") {
          stream = await navigator.mediaDevices.getUserMedia(c);
          if (stream) break;
        }
      } catch (err) {
        lastErr = err;
      }
    }

    if (!stream) {
      console.warn("Camera stream unavailable:", lastErr);
      if (statusText) {
        statusText.innerHTML = `Camera unavailable. You can enter the 12-char Pair Code below.<br><button type="button" id="qrRetryCamBtn" style="margin-top:6px;background:none;border:1px solid #f37927;color:#f37927;padding:3px 10px;border-radius:6px;font-size:11px;cursor:pointer;">Retry Camera</button>`;
        document.getElementById("qrRetryCamBtn")?.addEventListener("click", (e) => {
          e.stopPropagation();
          openQrScannerModal();
        });
      }
      return;
    }

    try {
      qrMediaStream = stream;
      video.srcObject = stream;
      await video.play();
      qrScanActive = true;
      if (statusText) statusText.textContent = "Point camera at the QR code on PC screen...";
      requestAnimationFrame(scanQrFrame);
    } catch (playErr) {
      console.warn("Video play error:", playErr);
      qrScanActive = true;
      if (statusText) statusText.textContent = "Scanning QR code...";
      requestAnimationFrame(scanQrFrame);
    }
  }

  function stopCameraAndScanner() {
    qrScanActive = false;
    if (qrMediaStream) {
      try {
        qrMediaStream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      qrMediaStream = null;
    }
  }

  function scanQrFrame() {
    if (!qrScanActive) return;
    const video = document.getElementById("qrVideo");
    const canvas = document.getElementById("qrCanvas");
    const statusText = document.getElementById("qrStatusText");

    if (video && video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert"
      });

      if (code && code.data) {
        let pairCode = code.data.trim();
        if (pairCode.startsWith("LM_PAIR:")) {
          pairCode = pairCode.replace("LM_PAIR:", "").trim();
        }
        if (pairCode.startsWith("PAIR-")) {
          stopCameraAndScanner();
          if (statusText) statusText.textContent = "QR Code detected! Connecting...";
          vibrate("success");
          submitPairCode(pairCode);
          return;
        }
      }
    }

    if (qrScanActive) {
      requestAnimationFrame(scanQrFrame);
    }
  }

  const claimCallbacks = new Map();
  let claimSeq = 0;

  window.__slmOnClaimResult = function (callbackId, payloadJson) {
    const cb = claimCallbacks.get(callbackId);
    if (cb) {
      claimCallbacks.delete(callbackId);
      try {
        cb(JSON.parse(payloadJson));
      } catch (e) {
        cb({ ok: false, error: e.message });
      }
    }
  };

  function submitPairCode(pairCode) {
    const statusText = document.getElementById("qrStatusText");
    const btn = document.getElementById("manualPairBtn");
    if (btn) btn.disabled = true;
    if (statusText) statusText.textContent = "Pairing with extension & authenticating...";

    const callbackId = "claim_" + (++claimSeq) + "_" + Date.now();
    claimCallbacks.set(callbackId, (res) => {
      if (btn) btn.disabled = false;
      if (res && res.ok) {
        closeQrScannerModal();
        showToast("Connected to Sadamata & Pro Activated!");
        state.authenticated = true;
        const profile = res.data?.merchantProfile;
        if (profile) {
          if (profile.name && !/^manager\d*$/i.test(profile.name)) state.profile.name = profile.name;
          if (profile.photo && !isDefaultAvatar(profile.photo)) state.profile.photo = profile.photo;
          saveJson(STORAGE.PROFILE, state.profile);
        }
        renderHeader();
        syncDashboard(true);
      } else {
        if (statusText) statusText.textContent = res?.error || "Pairing failed. Please check code or try again.";
        showToast(res?.error || "Pairing failed", 3500);
      }
    });

    if (window.AndroidBridge && window.AndroidBridge.claimPairing) {
      window.AndroidBridge.claimPairing(pairCode, callbackId);
    } else {
      if (statusText) statusText.textContent = "AndroidBridge not available";
    }
  }

  // Native Android Hooks
  window.__slmOnDomProfile = function (name, photo) {
    let changed = false;
    if (name && !/^manager\d*$/i.test(name)) {
      state.profile.name = name;
      changed = true;
    }
    if (photo && !isDefaultAvatar(photo)) {
      state.profile.photo = photo;
      changed = true;
    }
    if (changed) {
      saveJson(STORAGE.PROFILE, state.profile);
      renderHeader();
      renderHeroAndStrip();
    }
  };

  window.__slmOnLoginComplete = function () {
    showToast("Connected to Sadamata!");
    syncDashboard(true);
  };

  window.__slmOnNativeResume = function () {
    mergeNativeAlerts();
    renderAlertBadge();
    renderAlertsSheet();
    if (!state.lastSyncAt || Date.now() - state.lastSyncAt > 45000) {
      syncDashboard(false);
    }
  };

  window.__slmHandleBack = function () {
    return closeAllModals();
  };

  window.__slmSwitchTab = function (tab) {
    if (tab === "alerts") {
      mergeNativeAlerts();
      renderAlertsSheet();
      document.getElementById("alertsModal").classList.add("open");
    } else if (tab === "sounds") {
      renderSettingsModal();
      document.getElementById("settingsModal").classList.add("open");
    }
  };

  function boot() {
    initMonthLabels();
    populateSoundSelects();
    wireEvents();
    mergeNativeAlerts();
    renderAll();
    syncSettingsToNative();
    scheduleAutoSync();
    syncDashboard(false);

    setInterval(() => renderHeader(), 15000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();

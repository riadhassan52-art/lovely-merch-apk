(function (root) {
  "use strict";

  const HOST_ID = "slm-sale-effect-host";
  let cleanupTimer = null;

  const CONFETTI_COLORS = [
    "#f37927",
    "#10b981",
    "#facc15",
    "#8b5cf6",
    "#38bdf8",
    "#f43f5e",
    "#34d399"
  ];

  function createDollarBillSvg(compact) {
    const w = compact ? 28 : 42;
    const h = compact ? 15 : 22;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.setAttribute("viewBox", "0 0 42 22");

    const r1 = document.createElementNS(ns, "rect");
    r1.setAttribute("x", "0.5"); r1.setAttribute("y", "0.5");
    r1.setAttribute("width", "41"); r1.setAttribute("height", "21");
    r1.setAttribute("rx", "3"); r1.setAttribute("fill", "#16a34a");
    r1.setAttribute("stroke", "#bbf7d0"); r1.setAttribute("stroke-width", "1");

    const r2 = document.createElementNS(ns, "rect");
    r2.setAttribute("x", "3"); r2.setAttribute("y", "3");
    r2.setAttribute("width", "36"); r2.setAttribute("height", "16");
    r2.setAttribute("rx", "1.5"); r2.setAttribute("fill", "none");
    r2.setAttribute("stroke", "#86efac"); r2.setAttribute("stroke-width", "0.9");
    r2.setAttribute("stroke-dasharray", "2 1.2");

    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", "21"); c.setAttribute("cy", "11"); c.setAttribute("r", "6");
    c.setAttribute("fill", "#15803d"); c.setAttribute("stroke", "#dcfce7"); c.setAttribute("stroke-width", "0.8");

    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", "21"); t.setAttribute("y", "14.2");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-family", "Inter, Segoe UI, sans-serif");
    t.setAttribute("font-size", "10"); t.setAttribute("font-weight", "800");
    t.setAttribute("fill", "#f0fdf4");
    t.textContent = "$";

    svg.append(r1, r2, c, t);
    return svg;
  }

  function createCoinSvg(compact, sym) {
    const size = compact ? 16 : 22;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");

    const label = (sym === "à§³" || sym === "BDT") ? "BDT" : "$";
    const c1 = document.createElementNS(ns, "circle");
    c1.setAttribute("cx", "12"); c1.setAttribute("cy", "12"); c1.setAttribute("r", "10.5");
    c1.setAttribute("fill", "#facc15"); c1.setAttribute("stroke", "#fef08a"); c1.setAttribute("stroke-width", "1.5");

    const c2 = document.createElementNS(ns, "circle");
    c2.setAttribute("cx", "12"); c2.setAttribute("cy", "12"); c2.setAttribute("r", "7.5");
    c2.setAttribute("fill", "#eab308"); c2.setAttribute("stroke", "#fef9c3"); c2.setAttribute("stroke-width", "0.8");

    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", "12"); t.setAttribute("y", "16");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-family", "Inter, Segoe UI, sans-serif");
    t.setAttribute("font-size", label === "BDT" ? "8.5" : "11.5"); t.setAttribute("font-weight", "900");
    t.setAttribute("fill", "#713f12");
    t.textContent = label;

    svg.append(c1, c2, t);
    return svg;
  }

  function formatAmount(amount, sym) {
    const n = Number(amount || 0);
    if (!Number.isFinite(n) || n <= 0) return "";
    const fixed = Number.isInteger(n) ? String(n) : n.toFixed(0);
    const s = (sym === "à§³" || !sym) ? "BDT" : sym;
    const prefix = /[A-Za-z]/.test(s) ? `${s} ` : s;
    return `${prefix}${fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  }

  function clearExistingHost() {
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    const existing = document.getElementById(HOST_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function triggerSaleCelebration(opts = {}) {
    try {
      if (typeof document === "undefined" || !document.body) return;
      if (opts.enabled === false && !opts.force) return;

      clearExistingHost();

      const compact = Boolean(opts.compact || window.innerWidth <= 440);
      const isTest = Boolean(opts.isTest);
      const sold = Math.max(1, Number(opts.deltaSold || 1));
      const royalty = Number(opts.deltaRoyalty || 0);
      const sym = (opts.currencySymbol === "à§³" || !opts.currencySymbol) ? "BDT" : opts.currencySymbol;
      const royText = formatAmount(royalty, sym);

      const host = document.createElement("div");
      host.id = HOST_ID;
      host.style.cssText =
        "all: initial; position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2147483646; overflow: hidden;";

      const shadow = host.attachShadow({ mode: "open" });

      const style = document.createElement("style");
      style.textContent = `
        * {
          box-sizing: border-box;
          pointer-events: none;
          font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Noto Sans Bengali", Arial, sans-serif;
        }
        .layer {
          position: fixed;
          inset: 0;
          overflow: hidden;
        }
        .flash {
          position: fixed;
          inset: 0;
          background: rgba(16, 185, 129, 0.18);
          opacity: 0;
        }
        .particle {
          position: fixed;
          top: -36px;
          will-change: transform, opacity;
          filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.32));
        }
      `;
      shadow.appendChild(style);

      const layer = document.createElement("div");
      layer.className = "layer";
      shadow.appendChild(layer);

      const flash = document.createElement("div");
      flash.className = "flash";
      layer.appendChild(flash);

      if (typeof flash.animate === "function") {
        flash.animate(
          [
            { opacity: 0 },
            { opacity: 1, offset: 0.14 },
            { opacity: 0.45, offset: 0.45 },
            { opacity: 0 }
          ],
          { duration: compact ? 950 : 1250, easing: "ease-out", fill: "forwards" }
        );
      }

      const totalLifeMs = compact ? 2500 : 3800;
      const viewH = Math.max(window.innerHeight || 600, 320);

      const billCount = compact ? 20 : 36;
      const coinCount = compact ? 10 : 16;
      const confettiCount = compact ? 22 : 40;
      let maxParticleEndMs = totalLifeMs;

      function spawnFallingParticle(el, delayMs, durationMs) {
        const startX = 3 + Math.random() * 94;
        const sway1 = (Math.random() - 0.5) * (compact ? 45 : 95);
        const sway2 = (Math.random() - 0.5) * (compact ? 65 : 130);
        const endDrift = (Math.random() - 0.5) * (compact ? 70 : 150);
        const rot0 = (Math.random() - 0.5) * 40;
        const rotEnd = rot0 + (Math.random() > 0.5 ? 1 : -1) * (160 + Math.random() * 240);
        const flipY = (Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 260);
        const scale = 0.82 + Math.random() * 0.42;

        el.className = "particle";
        el.style.left = `${startX}%`;
        el.style.opacity = "0";
        layer.appendChild(el);

        const endMs = delayMs + durationMs;
        if (endMs > maxParticleEndMs) maxParticleEndMs = endMs;

        if (typeof el.animate === "function") {
          el.animate(
            [
              {
                opacity: 0,
                transform: `translate3d(0px, -10px, 0) rotate(${rot0}deg) rotateY(0deg) scale(${scale})`
              },
              {
                opacity: 1,
                transform: `translate3d(${sway1 * 0.4}px, ${viewH * 0.22}px, 0) rotate(${rot0 + 60}deg) rotateY(${flipY * 0.35}deg) scale(${scale})`,
                offset: 0.16
              },
              {
                opacity: 1,
                transform: `translate3d(${sway2}px, ${viewH * 0.62}px, 0) rotate(${rot0 + 140}deg) rotateY(${flipY * 0.72}deg) scale(${scale})`,
                offset: 0.6
              },
              {
                opacity: 0,
                transform: `translate3d(${endDrift}px, ${viewH + 64}px, 0) rotate(${rotEnd}deg) rotateY(${flipY}deg) scale(${scale * 0.9})`
              }
            ],
            {
              duration: durationMs,
              delay: delayMs,
              easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
              fill: "forwards"
            }
          );
        }
      }

      for (let i = 0; i < billCount; i++) {
        const billWrap = document.createElement("div");
        billWrap.appendChild(createDollarBillSvg(compact));
        const delay = Math.random() * (compact ? 650 : 950);
        const dur = (compact ? 1450 : 2100) + Math.random() * (compact ? 700 : 1200);
        spawnFallingParticle(billWrap, delay, dur);
      }

      for (let i = 0; i < coinCount; i++) {
        const coinWrap = document.createElement("div");
        coinWrap.appendChild(createCoinSvg(compact, i % 3 === 0 ? sym : "$"));
        const delay = Math.random() * (compact ? 550 : 850);
        const dur = (compact ? 1250 : 1800) + Math.random() * (compact ? 600 : 950);
        spawnFallingParticle(coinWrap, delay, dur);
      }

      for (let i = 0; i < confettiCount; i++) {
        const piece = document.createElement("div");
        const w = (compact ? 5 : 7) + Math.random() * 5;
        const h = (compact ? 8 : 11) + Math.random() * 7;
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        piece.style.width = `${w.toFixed(1)}px`;
        piece.style.height = `${h.toFixed(1)}px`;
        piece.style.borderRadius = i % 4 === 0 ? "50%" : "2px";
        piece.style.background = color;
        const delay = Math.random() * (compact ? 500 : 750);
        const dur = (compact ? 1150 : 1700) + Math.random() * (compact ? 650 : 1100);
        spawnFallingParticle(piece, delay, dur);
      }

      document.body.appendChild(host);

      cleanupTimer = setTimeout(() => {
        clearExistingHost();
      }, maxParticleEndMs + 220);
    } catch (_) {}
  }

  /* --- Tier-Up Celebration Modal --- */
  const TIER_HOST_ID = "slm-tier-celebration-host";
  let tierCleanupTimer = null;
  let activeTierAudio = null;

  function stopActiveTierAudio() {
    if (activeTierAudio) {
      try {
        activeTierAudio.pause();
        activeTierAudio.currentTime = 0;
      } catch (_) {}
      activeTierAudio = null;
    }
  }

  function clearExistingTierHost() {
    stopActiveTierAudio();
    if (tierCleanupTimer) {
      clearTimeout(tierCleanupTimer);
      tierCleanupTimer = null;
    }
    const existing = document.getElementById(TIER_HOST_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function getTierLevelName(tier) {
    const t = Number(tier) || 0;
    if (t >= 20000) return "TITAN";
    if (t >= 10000) return "LEGEND";
    if (t >= 8000) return "GRANDMASTER";
    if (t >= 6000) return "MASTER";
    if (t >= 4000) return "CHAMPION";
    if (t >= 2000) return "VETERAN";
    if (t >= 1000) return "EXPERT";
    if (t >= 500) return "PRO";
    if (t >= 100) return "RISING STAR";
    if (t >= 25) return "APPRENTICE";
    return "NOVICE";
  }

  function playConfettiPopperSound(volume = 0.95, existingCtx = null, existingMaster = null) {
    try {
      const AudioCtx = root.AudioContext || root.webkitAudioContext;
      if (!AudioCtx && !existingCtx) return;
      const ownCtx = !existingCtx;
      const ctx = existingCtx || new AudioCtx();
      const now = ctx.currentTime;
      const vol = Math.min(1, Math.max(0.05, Number(volume) || 0.95));

      const master = existingMaster || ctx.createGain();
      if (ownCtx) {
        master.gain.setValueAtTime(vol * 0.95, now);
        master.connect(ctx.destination);
      }

      const sampleRate = ctx.sampleRate || 44100;
      const noiseBuf = ctx.createBuffer(1, Math.floor(sampleRate * 0.4), sampleRate);
      const chData = noiseBuf.getChannelData(0);
      for (let i = 0; i < chData.length; i++) {
        chData[i] = Math.random() * 2 - 1;
      }

      // Rhythmic Confetti Cannon / Party Popper bursts ("Thus! Thus! Thus!")
      const shots = [
        { delay: 0.00, pitch: 1.04, amp: 0.95 },
        { delay: 0.28, pitch: 0.94, amp: 0.88 },
        { delay: 0.56, pitch: 1.10, amp: 1.00 },
        { delay: 0.92, pitch: 0.90, amp: 0.65 }
      ];

      shots.forEach((shot) => {
        const t = now + shot.delay;
        const v = vol * shot.amp;
        const pf = shot.pitch;

        // 1. Hollow pressurized tube "THU" punch
        const bodyOsc = ctx.createOscillator();
        const bodyGain = ctx.createGain();
        bodyOsc.type = "sine";
        bodyOsc.frequency.setValueAtTime(290 * pf, t);
        bodyOsc.frequency.exponentialRampToValueAtTime(68 * pf, t + 0.058);
        bodyGain.gain.setValueAtTime(0.001, t);
        bodyGain.gain.linearRampToValueAtTime(0.9 * v, t + 0.002);
        bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.088);
        bodyOsc.connect(bodyGain);
        bodyGain.connect(master);
        bodyOsc.start(t);
        bodyOsc.stop(t + 0.095);

        // 2. Crisp cork / tube snap transient
        const snapOsc = ctx.createOscillator();
        const snapGain = ctx.createGain();
        snapOsc.type = "triangle";
        snapOsc.frequency.setValueAtTime(540 * pf, t);
        snapOsc.frequency.exponentialRampToValueAtTime(135 * pf, t + 0.032);
        snapGain.gain.setValueAtTime(0.001, t);
        snapGain.gain.linearRampToValueAtTime(0.48 * v, t + 0.0015);
        snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.042);
        snapOsc.connect(snapGain);
        snapGain.connect(master);
        snapOsc.start(t);
        snapOsc.stop(t + 0.048);

        // 3. Warm pressurized air puff ("-SS") with sweeping lowpass
        const puffSrc = ctx.createBufferSource();
        puffSrc.buffer = noiseBuf;
        const puffLp = ctx.createBiquadFilter();
        puffLp.type = "lowpass";
        puffLp.frequency.setValueAtTime(2800 * pf, t);
        puffLp.frequency.exponentialRampToValueAtTime(580, t + 0.11);
        puffLp.Q.setValueAtTime(1.2, t);
        const puffGain = ctx.createGain();
        puffGain.gain.setValueAtTime(0.001, t);
        puffGain.gain.linearRampToValueAtTime(0.75 * v, t + 0.003);
        puffGain.gain.exponentialRampToValueAtTime(0.001, t + 0.125);
        puffSrc.connect(puffLp);
        puffLp.connect(puffGain);
        puffGain.connect(master);
        puffSrc.start(t, 0, 0.14);

        // 4. Gentle brief paper confetti scatter right after pop
        const confSrc = ctx.createBufferSource();
        confSrc.buffer = noiseBuf;
        const confBp = ctx.createBiquadFilter();
        confBp.type = "bandpass";
        confBp.frequency.setValueAtTime(3600, t + 0.035);
        confBp.Q.setValueAtTime(1.8, t + 0.035);
        const confGain = ctx.createGain();
        confGain.gain.setValueAtTime(0.001, t + 0.035);
        confGain.gain.linearRampToValueAtTime(0.11 * v, t + 0.06);
        confGain.gain.exponentialRampToValueAtTime(0.001, t + 0.21);
        confSrc.connect(confBp);
        confBp.connect(confGain);
        confGain.connect(master);
        confSrc.start(t + 0.035, 0.05, 0.19);
      });

      if (ownCtx) {
        setTimeout(() => {
          try { ctx.close(); } catch (_) {}
        }, 1600);
      }
    } catch (_) {}
  }

  function playTierUpFanfare(volume = 0.95) {
    try {
      const vol = Math.min(1, Math.max(0.05, Number(volume) || 0.95));
      stopActiveTierAudio();

      if (typeof window !== "undefined" && window.AndroidBridge && typeof window.AndroidBridge.playNativeSound === "function") {
        try { window.AndroidBridge.playNativeSound("tier", vol); return; } catch (_) {}
      }
      if (typeof Audio !== "undefined") {
        const audioUrl = "./sounds/tier-celebration.m4a";
        const audio = new Audio(audioUrl);
        audio.volume = vol;
        activeTierAudio = audio;
        audio.addEventListener("ended", () => {
          if (activeTierAudio === audio) activeTierAudio = null;
        });
        audio.addEventListener("error", () => {
          if (activeTierAudio === audio) activeTierAudio = null;
          playConfettiPopperSound(vol);
        });
        const p = audio.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {
            if (activeTierAudio === audio) activeTierAudio = null;
            playConfettiPopperSound(vol);
          });
        }
        return;
      }

      playConfettiPopperSound(vol);
    } catch (_) {
      playConfettiPopperSound(volume);
    }
  }

  function playProVictorySound(volume = 0.65) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime + 0.02;
      const vol = Math.min(1, Math.max(0.05, Number(volume) || 0.65));

      const master = ctx.createGain();
      master.gain.setValueAtTime(vol, now);
      master.connect(ctx.destination);

      // Warm lowpass filter so brass/fanfare tones sound rich and clean
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(4200, now);
      lp.Q.setValueAtTime(0.7, now);
      lp.connect(master);

      // Classic triumphant victory fanfare melody: C5 - E5 - G5 - C6 (triumph chord)
      const melody = [
        { freq: 523.25, t: 0.00, dur: 0.13, gain: 0.30 }, // C5
        { freq: 659.25, t: 0.12, dur: 0.13, gain: 0.32 }, // E5
        { freq: 783.99, t: 0.24, dur: 0.13, gain: 0.34 }, // G5
        { freq: 1046.50, t: 0.37, dur: 0.78, gain: 0.42 } // C6 sustained victory peak
      ];

      melody.forEach((n) => {
        const start = now + n.t;
        const osc = ctx.createOscillator();
        const over = ctx.createOscillator();
        const g = ctx.createGain();

        osc.type = "triangle";
        over.type = "sawtooth";
        osc.frequency.setValueAtTime(n.freq, start);
        over.frequency.setValueAtTime(n.freq * 2, start);

        const overGain = ctx.createGain();
        overGain.gain.setValueAtTime(0.14, start);

        g.gain.setValueAtTime(0.001, start);
        g.gain.linearRampToValueAtTime(n.gain, start + 0.018);
        g.gain.setValueAtTime(n.gain * 0.85, start + n.dur * 0.55);
        g.gain.exponentialRampToValueAtTime(0.001, start + n.dur);

        osc.connect(g);
        over.connect(overGain);
        overGain.connect(g);
        g.connect(lp);

        osc.start(start);
        over.start(start);
        osc.stop(start + n.dur + 0.03);
        over.stop(start + n.dur + 0.03);
      });

      // Full C-major victory chord swell on the peak beat (t = 0.37s)
      const chordStart = now + 0.37;
      [261.63, 329.63, 392.00, 523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = idx < 2 ? "sine" : "triangle";
        osc.frequency.setValueAtTime(freq, chordStart);
        const amp = idx < 2 ? 0.16 : 0.12;
        g.gain.setValueAtTime(0.001, chordStart);
        g.gain.linearRampToValueAtTime(amp, chordStart + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, chordStart + 0.92);
        osc.connect(g);
        g.connect(lp);
        osc.start(chordStart);
        osc.stop(chordStart + 0.96);
      });

      // Crisp victory bell shimmer on top (G6 -> C7)
      [
        { freq: 1567.98, t: 0.42, dur: 0.42 },
        { freq: 2093.00, t: 0.50, dur: 0.55 }
      ].forEach((s) => {
        const start = now + s.t;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(s.freq, start);
        g.gain.setValueAtTime(0.001, start);
        g.gain.linearRampToValueAtTime(0.14, start + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, start + s.dur);
        osc.connect(g);
        g.connect(master);
        osc.start(start);
        osc.stop(start + s.dur + 0.03);
      });

      setTimeout(() => {
        try { ctx.close(); } catch (_) {}
      }, 1600);
    } catch (_) {}
  }

  function playMechanicalClick(volume = 0.8) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Deep button punch
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(450, now);
      osc1.frequency.exponentialRampToValueAtTime(70, now + 0.08);
      gain1.gain.setValueAtTime(volume * 0.7, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.085);

      // High crisp switch snap
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(1800, now);
      osc2.frequency.exponentialRampToValueAtTime(400, now + 0.045);
      gain2.gain.setValueAtTime(volume * 0.45, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.05);

      setTimeout(() => {
        try { ctx.close(); } catch (_) {}
      }, 150);
    } catch (_) {}
  }

  function playRollTick(freq = 550, volume = 0.18) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
      setTimeout(() => {
        try { ctx.close(); } catch (_) {}
      }, 80);
    } catch (_) {}
  }

  function triggerTierUpCelebration(opts = {}) {
    try {
      if (typeof document === "undefined" || !document.body) return;
      clearExistingTierHost();

      const tierNum = Number(opts.tier || opts.nextTier || 20000);
      const prevTier = Number(opts.previousTier || (tierNum > 500 ? Math.round(tierNum / 2) : 0));
      const tierFormatted = tierNum.toLocaleString();
      const levelTitle = (opts.levelName || getTierLevelName(tierNum)).toUpperCase();

      const host = document.createElement("div");
      host.id = TIER_HOST_ID;
      host.style.cssText =
        "all: initial; position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: auto; z-index: 2147483647; overflow: hidden;";

      const shadow = host.attachShadow({ mode: "open" });

      const style = document.createElement("style");
      style.textContent = `
        * {
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.65);
          backdrop-filter: blur(6px);
          display: flex;
          justify-content: center;
          align-items: center;
          opacity: 0;
          animation: slmBackdropFade 0.3s ease-out forwards;
        }
        @keyframes slmBackdropFade {
          to { opacity: 1; }
        }
        .card {
          position: relative;
          background: #ffffff;
          width: 380px;
          min-height: 440px;
          max-width: 90vw;
          border-radius: 24px;
          padding: 28px 24px 20px;
          text-align: center;
          box-shadow: 0 25px 60px -10px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.1);
          animation: slmCardPopIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.25) both;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        @keyframes slmCardPopIn {
          0% { transform: scale(0.65) translateY(40px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        .card.closing {
          animation: slmCardPopOut 0.25s ease-in forwards;
        }
        @keyframes slmCardPopOut {
          to { transform: scale(0.8) translateY(20px); opacity: 0; }
        }

        .stage-view {
          transition: opacity 0.22s ease, transform 0.22s ease;
        }
        .stage-view.hidden {
          display: none !important;
          opacity: 0;
          transform: scale(0.9);
        }

        /* STAGE 1: REVEAL BUTTON */
        .reveal-title {
          font-size: 26px;
          font-weight: 800;
          color: #3b2c22;
          line-height: 1.22;
          margin: 4px 0 14px;
          letter-spacing: -0.02em;
        }
        .reveal-btn-wrap {
          margin: 6px auto 12px;
          width: 250px;
          height: 195px;
          position: relative;
          cursor: pointer;
          user-select: none;
          transition: transform 0.12s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .reveal-btn-wrap:hover {
          transform: scale(1.04);
        }
        .reveal-btn-wrap:active, .reveal-btn-wrap.pressed {
          transform: scale(0.95) translateY(6px);
        }
        .reveal-hint {
          font-size: 14px;
          font-weight: 500;
          color: #94a3b8;
          margin-bottom: 12px;
        }

        /* STAGE 2: NUMBER ROLLING */
        .rolling-box {
          padding: 45px 0 35px;
        }
        .rolling-label {
          font-size: 14px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 16px;
        }
        .rolling-number {
          font-size: 62px;
          font-weight: 900;
          color: #0f172a;
          line-height: 1.1;
          letter-spacing: -0.03em;
          font-variant-numeric: tabular-nums;
          transition: transform 0.18s ease, color 0.18s ease;
        }
        .rolling-number.pop {
          transform: scale(1.15);
          color: #ea580c;
        }

        /* STAGE 3: CONGRATULATIONS */
        .title {
          font-size: 26px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          animation: slmTitlePop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.25) both;
        }
        @keyframes slmTitlePop {
          0% { transform: scale(0.7); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .mascot-wrap {
          width: 165px;
          height: 165px;
          margin: 0 auto;
          position: relative;
          animation: slmMascotFloat 3.2s ease-in-out infinite, slmMascotPop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.25) both;
        }
        @keyframes slmMascotPop {
          0% { transform: scale(0.5) translateY(20px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes slmMascotFloat {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-8px) scale(1.02); }
        }
        .mascot-svg {
          width: 100%;
          height: 100%;
          display: block;
          filter: drop-shadow(0 10px 18px rgba(0, 180, 216, 0.28));
        }
        .tier-num {
          font-size: 48px;
          font-weight: 900;
          color: #0f172a;
          line-height: 1.1;
          margin: 12px 0 2px;
          letter-spacing: -0.03em;
          animation: slmNumPop 0.4s ease-out both;
        }
        @keyframes slmNumPop {
          0% { transform: scale(0.8); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .tier-level {
          font-size: 13px;
          font-weight: 800;
          color: #64748b;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 18px;
        }

        .footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-top: 14px;
          border-top: 1px solid #f1f5f9;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
        }
        .pro-pill {
          background: #f37927;
          color: #ffffff;
          font-size: 10px;
          font-weight: 900;
          padding: 2px 6px;
          border-radius: 6px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .close-btn {
          background: transparent;
          color: #64748b;
          border: none;
          font-size: 15px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
          font-family: inherit;
        }
        .close-btn:hover {
          background: rgba(0, 0, 0, 0.05);
          color: #0f172a;
        }
        .confetti-piece {
          position: absolute;
          top: -20px;
          pointer-events: none;
          will-change: transform, opacity;
        }
      `;
      shadow.appendChild(style);

      const backdrop = document.createElement("div");
      backdrop.className = "backdrop";

      const card = document.createElement("div");
      card.className = "card";

      card.innerHTML = `
        <!-- STAGE 1: Reveal Button View -->
        <div class="stage-view" id="stageReveal">
          <div class="reveal-title">
            <div>A new Tier</div>
            <div>is waiting for you!</div>
          </div>

          <div class="reveal-btn-wrap" id="bigRedBtn" title="Tap to reveal your new tier">
            <svg viewBox="0 0 250 200" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="baseRimGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#9e9892" />
                  <stop offset="100%" stop-color="#69635e" />
                </linearGradient>
                <linearGradient id="baseTopGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#d6d0ca" />
                  <stop offset="100%" stop-color="#aba49d" />
                </linearGradient>
                <linearGradient id="btnSideGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#e53935" />
                  <stop offset="35%" stop-color="#c62828" />
                  <stop offset="100%" stop-color="#8e0000" />
                </linearGradient>
                <radialGradient id="btnTopGrad" cx="42%" cy="32%" r="68%">
                  <stop offset="0%" stop-color="#ff5252" />
                  <stop offset="50%" stop-color="#e53935" />
                  <stop offset="92%" stop-color="#c62828" />
                  <stop offset="100%" stop-color="#b71c1c" />
                </radialGradient>
                <filter id="btnShadowFilter" x="-15%" y="-10%" width="130%" height="140%">
                  <feDropShadow dx="0" dy="10" stdDeviation="7" flood-color="#000000" flood-opacity="0.32" />
                </filter>
              </defs>

              <!-- Gray Base Ring -->
              <g filter="url(#btnShadowFilter)">
                <path d="M 18 108 C 18 136 66 154 125 154 C 184 154 232 136 232 108 L 232 122 C 232 150 184 168 125 168 C 66 168 18 150 18 122 Z" fill="url(#baseRimGrad)" />
                <ellipse cx="125" cy="108" rx="107" ry="43" fill="url(#baseTopGrad)" />
                <ellipse cx="125" cy="108" rx="105" ry="41" fill="none" stroke="#ebe6e1" stroke-width="1.5" />
              </g>

              <!-- Red Button Body -->
              <g class="push-button-cyl">
                <path d="M 44 68 C 44 98 80 120 125 120 C 170 120 206 98 206 68 L 206 102 C 206 132 170 152 125 152 C 80 152 44 132 44 102 Z" fill="url(#btnSideGrad)" />
                <ellipse cx="125" cy="68" rx="81" ry="49" fill="url(#btnTopGrad)" />
                <ellipse cx="125" cy="67" rx="79" ry="47" fill="none" stroke="#ff8a80" stroke-width="2.5" opacity="0.65" />

                <!-- Bold White Text: REVEAL / NEW TIER -->
                <g style="font-family:'Arial Black', 'Impact', -apple-system, sans-serif; font-weight:900; text-anchor:middle; fill:#ffffff;">
                  <text x="125" y="60" font-size="25" fill="#6d0000" opacity="0.5" transform="translate(0, 2.5)">REVEAL</text>
                  <text x="125" y="60" font-size="25" letter-spacing="0.04em">REVEAL</text>
                  
                  <text x="125" y="89" font-size="25" fill="#6d0000" opacity="0.5" transform="translate(0, 2.5)">NEW TIER</text>
                  <text x="125" y="89" font-size="25" letter-spacing="0.04em">NEW TIER</text>
                </g>
              </g>

              <!-- Cartoon White Gloved Hand Pointing -->
              <g class="pointing-hand" transform="translate(138, 92)">
                <path d="M 10 0 C 4 -6 -4 2 -1 10 L 8 28 C 3 28 -4 32 -3 40 C -1 48 6 52 14 52 L 28 52 C 40 52 48 42 46 28 C 44 16 36 14 30 20 L 22 8 Z" fill="#000000" opacity="0.18" transform="translate(4, 5)" />
                <path d="M 12 2 C 7 -5 -3 3 1 12 L 10 30 C 5 30 -3 33 -2 41 C -1 48 6 51 14 51 L 28 51 C 42 51 49 39 46 26 C 44 15 35 13 30 18 L 22 7 C 18 -1 15 -1 12 2 Z" fill="#ffffff" stroke="#1e293b" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round" />
                <path d="M 10 30 C 3 31 -3 35 -2 42 C -1 48 7 49 14 47" fill="#ffffff" stroke="#1e293b" stroke-width="3" stroke-linejoin="round" />
                <path d="M 41 29 C 36 27 30 29 27 33" stroke="#1e293b" stroke-width="2.6" stroke-linecap="round" />
                <path d="M 43 39 C 38 37 32 39 29 43" stroke="#1e293b" stroke-width="2.6" stroke-linecap="round" />
                <line x1="28" y1="36" x2="33" y2="46" stroke="#1e293b" stroke-width="2.4" stroke-linecap="round" />
                <line x1="33" y1="33" x2="38" y2="43" stroke="#1e293b" stroke-width="2.4" stroke-linecap="round" />
                <line x1="38" y1="31" x2="43" y2="40" stroke="#1e293b" stroke-width="2.4" stroke-linecap="round" />
              </g>
            </svg>
          </div>

          <div class="reveal-hint">Tap to reveal your new tier</div>
        </div>

        <!-- STAGE 2: Number Rolling / Counting Stage -->
        <div class="stage-view hidden" id="stageRolling">
          <div class="rolling-box">
            <div class="rolling-label">Unlocking Milestone...</div>
            <div class="rolling-number" id="rollNumEl">${prevTier.toLocaleString()}</div>
          </div>
        </div>

        <!-- STAGE 3: Final Congratulations Screen -->
        <div class="stage-view hidden" id="stageCelebration">
          <div class="title">
            <span>Congratulations</span>
            <span style="font-size: 24px;">ðŸŽ‰</span>
          </div>

          <div class="mascot-wrap">
            <svg class="mascot-svg" viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="mascotBodyGrad" x1="20" y1="10" x2="140" y2="150" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#38bdf8" />
                  <stop offset="45%" stop-color="#0284c7" />
                  <stop offset="100%" stop-color="#0369a1" />
                </linearGradient>
                <linearGradient id="mascotEarInner" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#0284c7" />
                  <stop offset="100%" stop-color="#075985" />
                </linearGradient>
                <radialGradient id="mascotGlow" cx="50%" cy="30%" r="50%">
                  <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5" />
                  <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
                </radialGradient>
              </defs>

              <path d="M 28 58 L 22 24 L 54 44 Z" fill="url(#mascotBodyGrad)" />
              <path d="M 28 52 L 25 30 L 46 44 Z" fill="url(#mascotEarInner)" />
              <path d="M 132 58 L 138 24 L 106 44 Z" fill="url(#mascotBodyGrad)" />
              <path d="M 132 52 L 135 30 L 114 44 Z" fill="url(#mascotEarInner)" />

              <path d="M 32 62 C 32 34 60 28 80 28 C 100 28 128 34 128 62 C 128 92 134 116 118 126 C 104 135 94 130 80 130 C 66 130 56 135 42 126 C 26 116 32 92 32 62 Z" fill="url(#mascotBodyGrad)" />

              <ellipse cx="80" cy="38" rx="28" ry="8" fill="url(#mascotGlow)" />
              <circle cx="86" cy="48" r="5" fill="#ffffff" opacity="0.6" />
              <circle cx="95" cy="52" r="2.5" fill="#ffffff" opacity="0.5" />

              <path d="M 34 94 C 24 104 26 118 36 120 C 44 122 46 112 40 102 Z" fill="#0284c7" />
              <path d="M 126 94 C 136 104 134 118 124 120 C 116 122 114 112 120 102 Z" fill="#0284c7" />

              <circle cx="56" cy="68" r="13" fill="#ffffff" />
              <circle cx="56" cy="68" r="8" fill="#0c4a6e" />
              <circle cx="53" cy="65" r="3" fill="#ffffff" />
              <circle cx="59" cy="71" r="1.5" fill="#ffffff" />

              <circle cx="104" cy="68" r="13" fill="#ffffff" />
              <circle cx="104" cy="68" r="8" fill="#0c4a6e" />
              <circle cx="101" cy="65" r="3" fill="#ffffff" />
              <circle cx="107" cy="71" r="1.5" fill="#ffffff" />

              <circle cx="80" cy="88" r="13" fill="#ffffff" />
              <circle cx="80" cy="88" r="8" fill="#0c4a6e" />
              <circle cx="77" cy="85" r="3" fill="#ffffff" />
              <circle cx="83" cy="91" r="1.5" fill="#ffffff" />

              <path d="M 84 106 C 96 114 112 108 116 98 C 114 108 98 120 84 106 Z" fill="#ffffff" />
            </svg>
          </div>

          <div class="tier-num">${tierFormatted}</div>
          <div class="tier-level">MERCH LEVEL: ${levelTitle}</div>
        </div>

        <!-- Footer -->
        <div class="footer">
          <div class="brand">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f37927" stroke-width="2.3">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span>LoveLy Merch</span>
            <span class="pro-pill">APP</span>
          </div>
          <button type="button" class="close-btn" id="tierCloseBtn">Close</button>
        </div>
      `;

      function spawnConfetti() {
        const colors = ["#f37927", "#10b981", "#facc15", "#8b5cf6", "#38bdf8", "#f43f5e", "#fb923c"];
        for (let i = 0; i < 48; i++) {
          const p = document.createElement("div");
          p.className = "confetti-piece";
          const w = 5 + Math.random() * 6;
          const h = 8 + Math.random() * 8;
          p.style.width = `${w.toFixed(1)}px`;
          p.style.height = `${h.toFixed(1)}px`;
          p.style.background = colors[i % colors.length];
          p.style.borderRadius = i % 3 === 0 ? "50%" : "2px";
          p.style.left = `${(Math.random() * 100).toFixed(1)}%`;
          card.appendChild(p);

          const dur = 1800 + Math.random() * 1400;
          const delay = Math.random() * 700;
          const drift = (Math.random() - 0.5) * 80;
          const rot = 180 + Math.random() * 540;

          if (typeof p.animate === "function") {
            p.animate(
              [
                { opacity: 0, transform: "translate3d(0, -20px, 0) rotate(0deg)" },
                { opacity: 1, offset: 0.15 },
                { opacity: 1, offset: 0.75 },
                { opacity: 0, transform: `translate3d(${drift}px, 460px, 0) rotate(${rot}deg)` }
              ],
              {
                duration: dur,
                delay: delay,
                easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                fill: "forwards"
              }
            );
          }
        }
      }

      backdrop.appendChild(card);
      shadow.appendChild(backdrop);
      document.body.appendChild(host);

      // Wire stage transition
      const bigRedBtn = card.querySelector("#bigRedBtn");
      const stageReveal = card.querySelector("#stageReveal");
      const stageRolling = card.querySelector("#stageRolling");
      const stageCelebration = card.querySelector("#stageCelebration");
      const rollNumEl = card.querySelector("#rollNumEl");

      if (bigRedBtn) {
        bigRedBtn.addEventListener("click", () => {
          bigRedBtn.classList.add("pressed");
          playMechanicalClick();

          setTimeout(() => {
            if (stageReveal) stageReveal.classList.add("hidden");
            if (stageRolling) stageRolling.classList.remove("hidden");

            // Animate rolling numbers
            const duration = 1200;
            const startTime = performance.now();
            let lastTick = 0;

            function updateRoll(now) {
              const elapsed = now - startTime;
              const progress = Math.min(1, elapsed / duration);
              const ease = 1 - Math.pow(1 - progress, 3);
              const current = Math.floor(prevTier + (tierNum - prevTier) * ease);

              if (rollNumEl) rollNumEl.textContent = current.toLocaleString();

              // Light audio tick every ~80ms
              if (now - lastTick > 80 && progress < 0.9) {
                lastTick = now;
                playRollTick(400 + Math.floor(progress * 400), 0.15);
              }

              if (progress < 1) {
                requestAnimationFrame(updateRoll);
              } else {
                if (rollNumEl) {
                  rollNumEl.textContent = tierFormatted;
                  rollNumEl.classList.add("pop");
                }

                setTimeout(() => {
                  if (stageRolling) stageRolling.classList.add("hidden");
                  if (stageCelebration) stageCelebration.classList.remove("hidden");
                  spawnConfetti();
                  if (opts.playSound !== false) {
                    playTierUpFanfare(opts.volume || 0.95);
                  }
                }, 400);
              }
            }
            requestAnimationFrame(updateRoll);
          }, 200);
        });
      }

      function closeModal() {
        card.classList.add("closing");
        setTimeout(() => {
          clearExistingTierHost();
        }, 240);
        document.removeEventListener("keydown", onKey);
      }

      function onKey(e) {
        if (e.key === "Escape") closeModal();
      }

      const closeBtn = shadow.getElementById("tierCloseBtn");
      if (closeBtn) closeBtn.addEventListener("click", closeModal);

      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeModal();
      });

      document.addEventListener("keydown", onKey);
    } catch (_) {}
  }

  root.SLMEffects = {
    triggerSaleCelebration,
    triggerTierUpCelebration,
    playTierUpFanfare,
    playProVictorySound,
    playConfettiPopperSound,
    celebrate: () => {
      playProVictorySound(0.65);
      triggerSaleCelebration({ deltaSold: 0, deltaRoyalty: 0, force: true });
    },
    getTierLevelName
  };
})(typeof globalThis !== "undefined" ? globalThis : self);



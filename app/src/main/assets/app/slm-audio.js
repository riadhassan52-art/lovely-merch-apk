(function (root) {
  "use strict";

  const SALE_PRESETS = [
    { id: "kaching", label: "Ka-Ching (HD)", file: "./sounds/cha-ching-kaching.wav", nativeKey: "kaching" },
    { id: "register", label: "Classic Chime", file: "./sounds/cha-ching.ogg", nativeKey: "register" },
    { id: "bell", label: "Metallic Bell", file: "./sounds/cha-ching.wav", nativeKey: "bell" },
    { id: "coin", label: "Gold Coin Drop", synth: true },
    { id: "chime_up", label: "Crystal Sparkle", synth: true },
    { id: "cash_pop", label: "Pop & Ding", synth: true },
    { id: "fanfare", label: "Victory Chord", synth: true },
    { id: "levelup", label: "Level Up", synth: true }
  ];

  const CANCEL_PRESETS = [
    { id: "sad_wah", label: "Sad Trombone", synth: true },
    { id: "chime", label: "Descending Chime (HD)", file: "./sounds/cancel-return.wav", nativeKey: "cancel" },
    { id: "synth", label: "Synth Chime", synth: true },
    { id: "soft_drop", label: "Soft Drop", synth: true },
    { id: "alert_beep", label: "Double Alert Beep", synth: true },
    { id: "glass_tap", label: "Hollow Knock", synth: true },
    { id: "power_down", label: "Power Down", synth: true }
  ];

  let sharedAudioCtx = null;

  function getAudioContext() {
    const AudioCtx = root.AudioContext || root.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  }

  function unlockAudio() {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    } catch (_) {}
  }

  function clampVol(v, fallback = 0.75) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0.05, n));
  }

  function playChaChingSynthFallback(volume = 0.75) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const masterGain = ctx.createGain();
      masterGain.gain.value = clampVol(volume);
      masterGain.connect(ctx.destination);

      const bufSize = Math.floor(ctx.sampleRate * 0.08);
      const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.025));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2200;
      const nGain = ctx.createGain();
      nGain.gain.value = 0.22;
      noise.connect(hp);
      hp.connect(nGain);
      nGain.connect(masterGain);
      noise.start(now);

      const bellFreqs = [
        [2093.0, 0.12, 0.22, 0.45],
        [2637.02, 0.12, 0.14, 0.40],
        [3135.96, 0.17, 0.18, 0.42],
        [4186.01, 0.17, 0.11, 0.35]
      ];
      for (const [freq, startOff, amp, dur] of bellFreqs) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + startOff);
        gain.gain.setValueAtTime(0.001, now + startOff);
        gain.gain.exponentialRampToValueAtTime(amp, now + startOff + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, now + startOff + dur);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + startOff);
        osc.stop(now + startOff + dur + 0.03);
      }
    } catch (_) {}
  }

  function playCancelSynthFallback(volume = 0.75) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const masterGain = ctx.createGain();
      masterGain.gain.value = clampVol(volume);
      masterGain.connect(ctx.destination);

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(523.25, now);
      osc1.frequency.exponentialRampToValueAtTime(392.0, now + 0.32);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.linearRampToValueAtTime(0.24, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(masterGain);
      osc1.start(now);
      osc1.stop(now + 0.36);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(392.0, now + 0.22);
      osc2.frequency.exponentialRampToValueAtTime(261.63, now + 0.68);
      gain2.gain.setValueAtTime(0.001, now + 0.22);
      gain2.gain.linearRampToValueAtTime(0.28, now + 0.24);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
      osc2.connect(gain2);
      gain2.connect(masterGain);
      osc2.start(now + 0.22);
      osc2.stop(now + 0.75);
    } catch (_) {}
  }

  function playSaleSynthPreset(preset, volume = 0.75) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const vol = clampVol(volume);
      const master = ctx.createGain();
      master.gain.value = vol;
      master.connect(ctx.destination);

      const tone = (type, freqStart, freqEnd, startOff, dur, amp) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freqStart, now + startOff);
        if (freqEnd && freqEnd !== freqStart) {
          osc.frequency.exponentialRampToValueAtTime(freqEnd, now + startOff + dur);
        }
        g.gain.setValueAtTime(0.001, now + startOff);
        g.gain.linearRampToValueAtTime(amp, now + startOff + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, now + startOff + dur);
        osc.connect(g);
        g.connect(master);
        osc.start(now + startOff);
        osc.stop(now + startOff + dur + 0.02);
      };

      if (preset === "coin") {
        tone("square", 987.77, 987.77, 0.0, 0.09, 0.16);
        tone("sine", 987.77, 987.77, 0.0, 0.11, 0.24);
        tone("square", 1318.51, 1318.51, 0.085, 0.42, 0.14);
        tone("sine", 1318.51, 1318.51, 0.085, 0.48, 0.30);
        tone("sine", 2637.02, 2637.02, 0.085, 0.28, 0.12);
      } else if (preset === "chime_up") {
        [1046.5, 1318.51, 1567.98, 2093.0].forEach((f, idx) => {
          const st = idx * 0.075;
          tone("sine", f, f, st, 0.42, 0.26);
          tone("triangle", f * 2, f * 2, st, 0.24, 0.08);
        });
      } else if (preset === "cash_pop") {
        tone("sine", 340, 880, 0.0, 0.055, 0.32);
        tone("sine", 1174.66, 1174.66, 0.06, 0.36, 0.28);
        tone("sine", 1760.0, 1760.0, 0.13, 0.45, 0.32);
        tone("triangle", 3520.0, 3520.0, 0.13, 0.25, 0.09);
      } else if (preset === "fanfare") {
        tone("triangle", 523.25, 523.25, 0.0, 0.14, 0.28);
        tone("triangle", 659.25, 659.25, 0.11, 0.14, 0.28);
        tone("triangle", 783.99, 783.99, 0.22, 0.15, 0.30);
        tone("triangle", 1046.5, 1046.5, 0.33, 0.62, 0.34);
        tone("sine", 523.25, 523.25, 0.33, 0.58, 0.20);
        tone("sine", 659.25, 659.25, 0.33, 0.58, 0.18);
        tone("sine", 783.99, 783.99, 0.33, 0.58, 0.18);
      } else if (preset === "levelup") {
        [
          [783.99, 0.0, 0.11],
          [987.77, 0.09, 0.11],
          [1174.66, 0.18, 0.11],
          [1567.98, 0.27, 0.55]
        ].forEach(([f, st, d]) => {
          tone("triangle", f, f, st, d, 0.30);
          tone("sine", f * 1.5, f * 1.5, st, d * 0.7, 0.10);
        });
      } else {
        playChaChingSynthFallback(vol);
      }
    } catch (_) {}
  }

  function playCancelSynthPreset(preset, volume = 0.75) {
    try {
      if (preset === "synth") {
        playCancelSynthFallback(volume);
        return;
      }
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const vol = clampVol(volume);
      const master = ctx.createGain();
      master.gain.value = vol;
      master.connect(ctx.destination);

      const tone = (type, freqStart, freqEnd, startOff, dur, amp) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freqStart, now + startOff);
        if (freqEnd && freqEnd !== freqStart) {
          osc.frequency.exponentialRampToValueAtTime(freqEnd, now + startOff + dur);
        }
        g.gain.setValueAtTime(0.001, now + startOff);
        g.gain.linearRampToValueAtTime(amp, now + startOff + 0.012);
        g.gain.exponentialRampToValueAtTime(0.001, now + startOff + dur);
        osc.connect(g);
        g.connect(master);
        osc.start(now + startOff);
        osc.stop(now + startOff + dur + 0.02);
      };

      if (preset === "soft_drop") {
        tone("sine", 659.25, 650.0, 0.0, 0.22, 0.34);
        tone("triangle", 1318.5, 1300.0, 0.0, 0.07, 0.10);
        tone("sine", 440.0, 432.0, 0.17, 0.38, 0.36);
        tone("triangle", 880.0, 864.0, 0.17, 0.09, 0.09);
      } else if (preset === "sad_wah") {
        tone("sawtooth", 293.66, 286.0, 0.0, 0.22, 0.14);
        tone("triangle", 293.66, 286.0, 0.0, 0.22, 0.24);
        tone("sawtooth", 277.18, 270.0, 0.23, 0.22, 0.14);
        tone("triangle", 277.18, 270.0, 0.23, 0.22, 0.24);
        tone("sawtooth", 261.63, 254.0, 0.46, 0.22, 0.14);
        tone("triangle", 261.63, 254.0, 0.46, 0.22, 0.24);
        tone("sawtooth", 246.94, 218.0, 0.69, 0.52, 0.16);
        tone("triangle", 246.94, 218.0, 0.69, 0.52, 0.28);
      } else if (preset === "alert_beep") {
        tone("sine", 480, 480, 0.0, 0.14, 0.30);
        tone("sine", 340, 340, 0.18, 0.22, 0.32);
      } else if (preset === "glass_tap") {
        tone("sine", 340, 210, 0.0, 0.085, 0.40);
        tone("triangle", 680, 390, 0.0, 0.04, 0.14);
        tone("sine", 250, 155, 0.14, 0.11, 0.38);
      } else if (preset === "power_down") {
        tone("triangle", 580, 125, 0.0, 0.62, 0.32);
        tone("sine", 290, 68, 0.0, 0.65, 0.28);
      } else {
        playCancelSynthFallback(vol);
      }
    } catch (_) {}
  }

  function playSaleSound(preset = "kaching", volume = 0.75) {
    const vol = clampVol(volume);
    const meta = SALE_PRESETS.find((p) => p.id === preset) || SALE_PRESETS[0];

    if (meta.nativeKey && root.AndroidBridge && typeof root.AndroidBridge.playNativeSound === "function") {
      try {
        root.AndroidBridge.playNativeSound(meta.nativeKey, vol);
        return;
      } catch (_) {}
    }

    if (meta.file && typeof Audio !== "undefined") {
      try {
        const audio = new Audio(meta.file);
        audio.volume = vol;
        audio.play().catch(() => playChaChingSynthFallback(vol));
        return;
      } catch (_) {}
    }

    playSaleSynthPreset(meta.id, vol);
  }

  function playCancelSound(preset = "sad_wah", volume = 0.75) {
    const vol = clampVol(volume);
    const meta = CANCEL_PRESETS.find((p) => p.id === preset) || CANCEL_PRESETS[0];

    if (meta.nativeKey && root.AndroidBridge && typeof root.AndroidBridge.playNativeSound === "function") {
      try {
        root.AndroidBridge.playNativeSound(meta.nativeKey, vol);
        return;
      } catch (_) {}
    }

    if (meta.file && typeof Audio !== "undefined") {
      try {
        const audio = new Audio(meta.file);
        audio.volume = vol;
        audio.play().catch(() => playCancelSynthFallback(vol));
        return;
      } catch (_) {}
    }

    playCancelSynthPreset(meta.id, vol);
  }

  root.SLMAudio = {
    SALE_PRESETS,
    CANCEL_PRESETS,
    unlockAudio,
    playSaleSound,
    playCancelSound
  };
})(typeof globalThis !== "undefined" ? globalThis : self);

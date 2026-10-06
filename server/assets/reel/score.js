/* ui-motion-reel score
 * An original, loopable electronic track plus UI sound design, rendered with OfflineAudioContext
 * from the same timeline as the picture. ReelScore.render(reel, opts, sfxHook) -> { wav: base64, peak }.
 * See references/score.md for how to shape it (key, progression, sections, hits, sound design).
 */
(function () {
  'use strict';
  const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

  // Default harmony: C major, warm and optimistic. One chord per bar; b = bass MIDI, p = pad voicing.
  const DEFAULT_CHORDS = {
    F: { b: 41, p: [57, 60, 64, 67] }, G: { b: 43, p: [59, 62, 64, 67] }, Em: { b: 40, p: [55, 59, 62, 64] },
    Am: { b: 45, p: [55, 60, 64, 71] }, C: { b: 48, p: [55, 60, 64, 71] }, Dm: { b: 50, p: [53, 57, 60, 64] },
    E: { b: 40, p: [56, 59, 62, 64] },
  };
  const DEFAULT_PROG = ['F', 'G', 'Em', 'Am'];

  function makeNoise(ctx, seconds) {
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate), d = b.getChannelData(0); let s = 1234567;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
    return b;
  }
  function makeIR(ctx, seconds, decay) {
    const len = Math.ceil(ctx.sampleRate * seconds), b = ctx.createBuffer(2, len, ctx.sampleRate); let s = 42;
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; d[i] = ((s / 2147483647) * 2 - 1) * (1 - i / len) ** decay; } }
    return b;
  }

  async function render(reel, opts = {}, sfxHook) {
    // the renderer can override the scene's score, e.g. to render only the sound design under a licensed track
    if (typeof window !== 'undefined' && window.SCORE_OVERRIDE) opts = Object.assign({}, opts, window.SCORE_OVERRIDE);
    const SR = 48000, DUR = reel.DUR, TAIL = 4, BPM = reel.BPM, BEAT = 60 / BPM, BAR = BEAT * 4;
    const BARS = Math.round(DUR / BAR);
    const ctx = new OfflineAudioContext(2, SR * (DUR + TAIL), SR);
    const NOISE = makeNoise(ctx, 2);
    const CHORDS = Object.assign({}, DEFAULT_CHORDS, opts.chords || {});
    const PROG = opts.prog || DEFAULT_PROG;
    const at = (id) => reel.at(id);
    // A style varies the track from ad to ad: key, arpeggio, instruments, groove and swing. Without one it's the default track.
    const ST = Object.assign({ transpose: 0, arp: 'classic', pluck: 'soft', pad: 'saw', drums: 'four', swing: 0, bassStyle: 'pulse' }, opts.style || {});
    const TR = ST.transpose | 0;

    /* ---------- sections: explicit [[bar, name], ...] or derived from holds ---------- */
    const secOf = (() => {
      if (typeof opts.sections === 'function') return opts.sections;
      if (Array.isArray(opts.sections)) { const s = [...opts.sections].sort((a, b) => a[0] - b[0]); return (bar) => { let n = s[0][1]; for (const [b, name] of s) if (bar >= b) n = name; return n; }; }
      const holds = reel.HOLDS();
      const breakBars = new Set();
      for (const [a, b] of opts.breaks || []) { const b0 = Math.floor(at(a) / BAR), b1 = Math.floor((b ? at(b) : at(a) + 4) / BAR); for (let x = b0; x < b1; x++) breakBars.add(x); }
      const firstLift = holds.length ? Math.ceil((holds[0].t1 - 0.01) / BAR) : Infinity;
      return (bar) => {
        if (bar < (opts.introBars ?? 2)) return 'intro';
        if (bar >= BARS - (opts.outroBars ?? 2)) return 'outro';
        if (holds.some((h) => bar >= Math.floor(h.t0 / BAR) && bar < Math.ceil((h.t1 - 0.01) / BAR))) return 'riser';
        if (breakBars.has(bar)) return 'break';
        return bar >= firstLift ? 'lift' : 'groove';
      };
    })();

    /* ---------- bus ---------- */
    const out = ctx.createGain(); out.gain.value = 0.9;
    const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 40; hpf.Q.value = 0.7;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 2.5; comp.attack.value = 0.005; comp.release.value = 0.2;
    out.connect(hpf); hpf.connect(comp); comp.connect(ctx.destination);
    const rev = ctx.createConvolver(); rev.buffer = makeIR(ctx, 3.2, 2.4);
    const revOut = ctx.createGain(); revOut.gain.value = 0.32; rev.connect(revOut); revOut.connect(out);
    const dl = ctx.createDelay(1.5); dl.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2600;
    dl.connect(dlf); dlf.connect(fb); fb.connect(dl);
    const dlOut = ctx.createGain(); dlOut.gain.value = 0.26; dlf.connect(dlOut); dlOut.connect(out); dlOut.connect(rev);
    const duck = ctx.createGain(); duck.connect(out); // sidechain: pads + bass dip on every kick
    const padLP = ctx.createBiquadFilter(); padLP.type = 'lowpass'; padLP.Q.value = 0.6; padLP.connect(duck);
    const padSend = ctx.createGain(); padSend.gain.value = 0.55; padLP.connect(padSend); padSend.connect(rev);
    const sfx = ctx.createGain(); sfx.gain.value = opts.sfxLevel ?? 0.9; sfx.connect(out);
    const sfxRev = ctx.createGain(); sfxRev.gain.value = 0.35; sfxRev.connect(rev);
    const musicLevel = opts.musicLevel ?? 1;
    const noiseSrc = (t, dur) => { const n = ctx.createBufferSource(); n.buffer = NOISE; n.loop = true; n.start(t, (t * 7.3) % 1.5); n.stop(t + dur); return n; };

    /* ---------- instruments ---------- */
    function kick(t, v = 1) {
      v *= musicLevel;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.11);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.95 * v, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.42);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.45);
      const n = noiseSrc(t, 0.02), hp = ctx.createBiquadFilter(), ng = ctx.createGain(); hp.type = 'highpass'; hp.frequency.value = 2500;
      ng.gain.setValueAtTime(0.18 * v, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.015); n.connect(hp); hp.connect(ng); ng.connect(out);
      duck.gain.setValueAtTime(0.35, t); duck.gain.setTargetAtTime(1, t + 0.02, 0.09);
    }
    function hat(t, v = 0.1, open = false, pan = 0.2) {
      const n = noiseSrc(t, open ? 0.35 : 0.08), hp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
      hp.type = 'highpass'; hp.frequency.value = open ? 7000 : 8500; p.pan.value = pan;
      g.gain.setValueAtTime(v * musicLevel, t); g.gain.exponentialRampToValueAtTime(0.0008, t + (open ? 0.3 : 0.05));
      n.connect(hp); hp.connect(g); g.connect(p); p.connect(out);
    }
    function clap(t, v = 0.32) {
      v *= musicLevel;
      const n = noiseSrc(t, 0.3), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.9;
      g.gain.setValueAtTime(0.0001, t);
      [0, 0.011, 0.022].forEach((o) => { g.gain.setValueAtTime(v, t + o); g.gain.exponentialRampToValueAtTime(v * 0.25, t + o + 0.009); });
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.24);
      n.connect(bp); bp.connect(g); g.connect(out); const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(rev);
    }
    function bass(t, dur, m, v = 0.34) {
      v *= musicLevel;
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), g2 = ctx.createGain();
      m += TR;
      o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = mtof(m); o2.frequency.value = mtof(m + 12); g2.gain.value = 0.22;
      lp.type = 'lowpass'; lp.frequency.value = 700;
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(lp); lp.connect(duck);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.setValueAtTime(v, t + Math.max(0.02, dur - 0.05)); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
    }
    function pad(t, dur, notes, v = 0.032) {
      v *= musicLevel;
      if (ST.pad === 'warm') v *= 1.25; else if (ST.pad === 'organ') v *= 0.7;
      for (const m of notes) for (const det of [-6, 6]) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = ST.pad === 'warm' ? 'triangle' : ST.pad === 'organ' ? 'square' : 'sawtooth'; o.frequency.value = mtof(m + TR); o.detune.value = det;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.35); g.gain.setValueAtTime(v, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
        o.connect(g); g.connect(padLP); o.start(t); o.stop(t + dur + 0.7);
      }
    }
    function pluck(t, m, v = 0.1, bright = 1) {
      v *= musicLevel; m += TR;
      if (ST.pluck === 'marimba') {
        // a struck bar: a sine with a quick fourth-partial knock
        const o = ctx.createOscillator(), k = ctx.createOscillator(), g = ctx.createGain(), kg = ctx.createGain();
        o.type = 'sine'; k.type = 'sine'; o.frequency.value = mtof(m); k.frequency.value = mtof(m) * 3.98;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 1.5, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.38);
        kg.gain.setValueAtTime(v * 0.5, t); kg.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
        o.connect(g); k.connect(kg); kg.connect(g); g.connect(out); g.connect(dl); const s2 = ctx.createGain(); s2.gain.value = 0.3; g.connect(s2); s2.connect(rev);
        o.start(t); k.start(t); o.stop(t + 0.4); k.stop(t + 0.08);
        return;
      }
      if (ST.pluck === 'keys') {
        // an electric-piano-ish tone: a sine with a soft bell partial, longer decay
        const o = ctx.createOscillator(), mo = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
        o.frequency.value = mtof(m); mo.frequency.value = mtof(m) * 2; mg.gain.setValueAtTime(mtof(m) * 0.9, t); mg.gain.exponentialRampToValueAtTime(2, t + 0.5);
        mo.connect(mg); mg.connect(o.frequency); o.connect(g); g.connect(out); g.connect(dl); const s2 = ctx.createGain(); s2.gain.value = 0.4; g.connect(s2); s2.connect(rev);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 1.1, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.8);
        o.start(t); mo.start(t); o.stop(t + 0.85); mo.stop(t + 0.85);
        return;
      }
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter(), g2 = ctx.createGain();
      o.type = 'triangle'; o2.type = ST.pluck === 'bright' ? 'sawtooth' : 'square'; o.frequency.value = mtof(m); o2.frequency.value = mtof(m + 12); o2.detune.value = 4; g2.gain.value = ST.pluck === 'bright' ? 0.26 : 0.18;
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(900 + 3200 * bright, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.25);
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(lp); lp.connect(out); lp.connect(dl);
      const s = ctx.createGain(); s.gain.value = 0.35; lp.connect(s); s.connect(rev);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.42);
      o.start(t); o2.start(t); o.stop(t + 0.45); o2.stop(t + 0.45);
    }

    /* ---------- sound design voices (also handed to the scene's sfx hook) ---------- */
    const au = {
      BEAT, BAR, at, reel,
      bell(t, m, v = 0.1) {
        m += TR;
        const c = ctx.createOscillator(), mo = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
        c.frequency.value = mtof(m); mo.frequency.value = mtof(m) * 3.5; mg.gain.setValueAtTime(mtof(m) * 2.2, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.2);
        mo.connect(mg); mg.connect(c.frequency); c.connect(g); g.connect(sfx); g.connect(sfxRev); g.connect(dl);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.6);
        c.start(t); mo.start(t); c.stop(t + 1.7); mo.stop(t + 1.7);
      },
      tick(t, f = 3200, v = 0.12, len = 0.03) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + len);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.0015); g.gain.exponentialRampToValueAtTime(0.0006, t + len);
        o.connect(g); g.connect(sfx); o.start(t); o.stop(t + len + 0.01);
        const n = noiseSrc(t, 0.012), hp = ctx.createBiquadFilter(), ng = ctx.createGain(); hp.type = 'highpass'; hp.frequency.value = 5000;
        ng.gain.setValueAtTime(v * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.01); n.connect(hp); hp.connect(ng); ng.connect(sfx);
      },
      whoosh(t, up = true, v = 0.07, len = 0.34) {
        const n = noiseSrc(t, len + 0.05), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(up ? 500 : 3000, t); bp.frequency.exponentialRampToValueAtTime(up ? 3200 : 450, t + len);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + len * 0.45); g.gain.exponentialRampToValueAtTime(0.0006, t + len);
        n.connect(bp); bp.connect(g); g.connect(sfx); g.connect(sfxRev);
      },
      swipe(t, v = 0.08) {
        const n = noiseSrc(t, 0.3), lp = ctx.createBiquadFilter(), g = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.linearRampToValueAtTime(2200, t + 0.25);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0006, t + 0.27);
        n.connect(lp); lp.connect(g); g.connect(sfx);
      },
      boom(t, v = 0.5) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(72, t); o.frequency.exponentialRampToValueAtTime(45, t + 1.2);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.5);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.6);
        const n = noiseSrc(t, 1.4), lp = ctx.createBiquadFilter(), ng = ctx.createGain(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 1.2);
        ng.gain.setValueAtTime(0.12, t); ng.gain.exponentialRampToValueAtTime(0.0008, t + 1.3); n.connect(lp); lp.connect(ng); ng.connect(rev);
      },
      riser(t0, t1, v = 0.14) {
        const n = noiseSrc(t0, t1 - t0 + 0.05), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.Q.value = 2;
        bp.frequency.setValueAtTime(300, t0); bp.frequency.exponentialRampToValueAtTime(7000, t1);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t1 - 0.02); g.gain.linearRampToValueAtTime(0.0001, t1 + 0.01);
        n.connect(bp); bp.connect(g); g.connect(out); g.connect(rev);
        const o = ctx.createOscillator(), og = ctx.createGain(), trem = ctx.createOscillator(), tg = ctx.createGain();
        o.frequency.setValueAtTime(220, t0); o.frequency.exponentialRampToValueAtTime(880, t1);
        trem.frequency.setValueAtTime(6, t0); trem.frequency.linearRampToValueAtTime(18, t1); tg.gain.value = 0.035;
        og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(0.09, t1 - 0.02); og.gain.linearRampToValueAtTime(0.0001, t1 + 0.01);
        trem.connect(tg); tg.connect(og.gain); o.connect(og); og.connect(sfx); o.start(t0); trem.start(t0); o.stop(t1 + 0.05); trem.stop(t1 + 0.05);
      },
      // soft key ticks, one per non-space character typed between t0 and t1
      typing(t0, t1, text) { for (let i = 0; i < text.length; i++) if (text[i] !== ' ') au.tick(t0 + (i / text.length) * (t1 - t0), 4200 + ((i * 97) % 700), 0.035, 0.018); },
      // a tick every time a simulated channel crosses a step while in a state (slider detents, scrubbing)
      detents(channel, stateId, stepSize, base = 3000, v = 0.05, when) {
        const F = reel.FRAMES(); let last = null;
        for (let f = 0; f < F.length; f++) {
          const t = f / reel.FPS;
          if (reel.PLAN[reel.stateAt(t)].id !== stateId || (when && !when(F[f], t))) { last = null; continue; }
          const v2 = Math.round(F[f][channel] / stepSize);
          if (last !== null && v2 !== last) au.tick(t, base + (v2 % 20) * 40, v, 0.02);
          last = v2;
        }
      },
      // rolling counter ticks
      counter(t0, t1, n = 12, v = 0.04) { for (let i = 0; i < n; i++) au.tick(t0 + (i / n) * (t1 - t0), 2000 + i * 120, v, 0.02); },
    };

    /* ---------- the music ---------- */
    const ARPS = {
      classic: [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 4, 3, 2, 1],
      up: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1],
      skip: [0, -1, 2, -1, 1, 3, -1, 2, 0, -1, 2, 4, -1, 3, 1, -1],
      sparse: [0, -1, -1, 2, -1, -1, 1, -1, 3, -1, -1, 2, -1, -1, 4, -1],
      call: [4, 3, 2, -1, 4, 3, 1, -1, 2, 3, 4, -1, 1, 2, 0, -1],
    };
    const ARP = ARPS[ST.arp] || ARPS.classic;
    const sw = (s) => (s % 2 ? ST.swing * BEAT / 4 : 0); // swung 16ths
    function shaker(t, v = 0.04, pan = 0) { hat(t, v, false, pan); }
    function rim(t, v = 0.12) {
      v *= musicLevel;
      const o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter(); o.type = 'triangle'; o.frequency.value = 1750; bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 3;
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0006, t + 0.06); o.connect(bp); bp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.07);
    }
    // where the kick, snare/clap and rim fall in a bar (in beats), per groove
    const GROOVES = {
      four: { kick: [0, 1, 2, 3], clap: [1, 3], liftOnly: true },
      half: { kick: [0, 1.5, 2.75], clap: [2], liftOnly: false },
      afro: { kick: [0, 1.75, 2.5], clap: [1, 3], rim: [0.75, 1.5, 2.25, 3.5], shaker: true, liftOnly: false },
      piano: { kick: [0, 2], clap: [3], rim: [1.25, 2.75], shaker: true, logBass: true, liftOnly: false },
      none: { kick: [], clap: [], shaker: true, liftOnly: false },
    };
    const GR = GROOVES[ST.drums] || GROOVES.four;
    const padCut = Object.assign({ intro: 700, groove: 1200, riser: 1200, lift: 1800, break: 520, outro: 800 }, opts.padCut || {});
    for (let bar = 0; bar < BARS + 2; bar++) {
      const t = bar * BAR, b = bar % BARS, sec = secOf(b), chd = CHORDS[PROG[b % PROG.length]];
      padLP.frequency.setTargetAtTime(padCut[sec] ?? 1200, t, 0.35);
      if (sec === 'riser') padLP.frequency.setTargetAtTime(3200, t + 0.2, 0.6);
      pad(t, BAR, chd.p, sec === 'intro' || sec === 'outro' ? 0.026 : sec === 'break' ? 0.028 : 0.032);
      const tones = [...chd.p.map((m) => m + 12), chd.p[0] + 24];
      for (let s = 0; s < 16; s++) {
        const ts = t + (s * BEAT) / 4 + sw(s);
        if (ARP[s] < 0) continue;
        if (sec === 'intro' || sec === 'outro') { if (s % 2 === 0) pluck(ts, tones[ARP[s]], 0.075, 0.35); continue; }
        if (sec === 'break') { if (s % 4 === 0) pluck(ts, tones[ARP[s]] - 12, 0.06, 0.15); continue; }
        pluck(ts, tones[ARP[s]], 0.1 * (s % 4 === 0 ? 1 : s % 2 === 0 ? 0.8 : 0.6), sec === 'lift' ? 0.9 : 0.6);
      }
      const drums = sec === 'groove' || sec === 'lift';
      if (opts.style && drums) {
        // the styled groove: bass follows the kick (a gliding log-drum bass for 'piano'), plus the groove's own percussion
        for (const k of GR.kick.length ? GR.kick : [0, 2]) {
          if (GR.logBass) { bass(t + k * BEAT, BEAT * 0.9, chd.b + 12, 0.32); } else bass(t + k * BEAT, BEAT * (GR.kick.length ? 0.45 : 1.6), chd.b, ST.drums === 'none' ? 0.2 : 0.33);
        }
        for (const k of GR.kick) kick(t + k * BEAT, k === 0 ? 1 : 0.85);
        if (!GR.liftOnly || sec === 'lift') for (const c of GR.clap) clap(t + c * BEAT, ST.drums === 'half' ? 0.36 : 0.3);
        for (const r of GR.rim || []) rim(t + r * BEAT + sw(Math.round(r * 4)), 0.1);
        for (let s2 = 0; s2 < 16; s2++) {
          const th = t + (s2 * BEAT) / 4 + sw(s2);
          if (GR.shaker) shaker(th, s2 % 4 === 2 ? 0.05 : 0.025, s2 % 2 ? -0.3 : 0.3);
          else if (s2 % 4 === 2) hat(th, 0.085, sec === 'lift' && s2 === 14, s2 % 8 ? -0.25 : 0.25);
        }
        continue;
      }
      if (drums) { bass(t, BEAT / 2 - 0.02, chd.b, 0.3); for (let e = 1; e < 8; e += 2) bass(t + (e * BEAT) / 2, BEAT / 2 - 0.02, chd.b, 0.34); }
      else if (sec === 'break') { bass(t, BEAT * 1.5, chd.b, 0.14); bass(t + BEAT * 2, BEAT * 1.5, chd.b, 0.11); }
      else if (sec === 'riser') for (let e = 0; e < 16; e++) bass(t + (e * BEAT) / 4, BEAT / 4 - 0.02, chd.b, 0.12 + 0.012 * e);
      for (let q = 0; q < 4; q++) {
        const tq = t + q * BEAT;
        if (drums) { kick(tq, q === 0 ? 1 : 0.9); hat(tq + BEAT / 2, 0.085, sec === 'lift' && q === 3, q % 2 ? -0.25 : 0.25); }
        if (sec === 'lift' && q % 2 === 1) clap(tq);
        if (sec === 'lift') { hat(tq + BEAT * 0.25, 0.035, false, -0.35); hat(tq + BEAT * 0.75, 0.035, false, 0.35); }
        if (sec === 'riser') for (let s = 0; s < 4; s++) hat(tq + (s * BEAT) / 4, 0.03 + (0.012 * (q * 4 + s)) / 4, false, s % 2 ? -0.3 : 0.3);
        if (sec === 'break' && q % 2 === 1) hat(tq, 0.05, false, 0);
      }
    }
    // impacts: a sub boom and a short bell motif on chosen state changes
    for (const h of opts.hits || []) {
      const t = at(h.state);
      if (h.boom !== 0) au.boom(t, h.boom ?? 0.5);
      if (opts.hitBells !== false) (h.motif || [72, 76, 79]).forEach((m, i) => au.bell(t + (i * BEAT) / 2, m, h.bell ?? 0.085));
    }
    if (opts.holdRiser !== false) for (const h of reel.HOLDS()) { const next = reel.PLAN[reel.stateAt(h.t1) + 1]; au.riser(h.t0, next ? next.t0 : h.t1 + 0.1); }

    /* ---------- automatic sound design ---------- */
    if (opts.whooshes !== false) for (let i = 1; i < reel.PLAN.length; i++) { const a = reel.PLAN[i - 1], b = reel.PLAN[i]; au.whoosh(b.t0 - 0.02, b.w * b.h > a.w * a.h, 0.07); }
    if (opts.clicks !== false) for (const [d, u] of reel.PRESSES()) { au.tick(d, 2600, 0.11, 0.03); if (u - d < 0.3) au.tick(u, 3400, 0.06, 0.02); }
    if (sfxHook) sfxHook(au, reel);

    const buf = await ctx.startRendering();
    // fold the tail past DUR onto the start so reverb and delay loop seamlessly
    const L = SR * DUR, oL = new Float32Array(L), oR = new Float32Array(L), iL = buf.getChannelData(0), iR = buf.getChannelData(1);
    for (let i = 0; i < L; i++) { oL[i] = iL[i]; oR[i] = iR[i]; }
    for (let i = L; i < iL.length; i++) { oL[i - L] += iL[i]; oR[i - L] += iR[i]; }
    let peak = 0; for (let i = 0; i < L; i++) peak = Math.max(peak, Math.abs(oL[i]), Math.abs(oR[i]));
    const gain = 0.89 / peak, pcm = new Int16Array(L * 2);
    for (let i = 0; i < L; i++) { pcm[2 * i] = Math.max(-1, Math.min(1, oL[i] * gain)) * 32767; pcm[2 * i + 1] = Math.max(-1, Math.min(1, oR[i] * gain)) * 32767; }
    const header = new ArrayBuffer(44), v = new DataView(header), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, SR, true); v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.byteLength, true);
    const bytes = new Uint8Array(44 + pcm.byteLength); bytes.set(new Uint8Array(header), 0); bytes.set(new Uint8Array(pcm.buffer), 44);
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { wav: btoa(bin), peak };
  }

  window.ReelScore = { render, DEFAULT_CHORDS, DEFAULT_PROG, mtof };
})();

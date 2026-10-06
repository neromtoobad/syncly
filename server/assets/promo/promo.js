/* Promo engine: a full-frame motion ad for a shop, a kitchen or a service, built from a storyboard.
 * The storyboard (window.PROMO) picks scenes from a fixed set of designed templates and fills in the copy and
 * photos; the engine lays them out for the format, fits every line of text to its box, and animates each frame
 * as a pure function of time, so the renderer can seek to any frame. The score comes from score.js (ReelScore)
 * through a small timeline shim, so the music cuts with the picture.
 *
 * Renderer contract (same as reel.js): window.READY (promise), renderFrame(n), TOTAL_FRAMES, FPS, __starts,
 * renderAudio() -> { wav }.
 */
(() => {
  const P = window.PROMO;
  const [W, H] = P.size, FPS = P.fps || 30, BPM = P.bpm || 120;
  const TR = 0.45; // scene transition, seconds
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const outCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const outQuint = (t) => 1 - Math.pow(1 - clamp(t), 5);
  const inOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const outBack = (t) => { t = clamp(t); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const prog = (lt, start, len) => clamp((lt - start) / len);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const fmt = W > H * 1.2 ? 'landscape' : H > W * 1.2 ? 'vertical' : 'square';
  const U = Math.min(W, H) / 100; // one unit: 1% of the short side
  const pal = Object.assign({ bg: '#111111', ink: '#ffffff', accent: '#f2b705', dark: '#121212', light: '#f7f3ea' }, P.palette || {});
  const root = document.documentElement;
  root.style.setProperty('--u', `${U}px`);
  for (const [k, v] of Object.entries(pal)) root.style.setProperty(`--${k}`, v);
  root.style.setProperty('--display', `'${(P.font && P.font.display) || 'Bricolage Grotesque'}', system-ui, sans-serif`);
  root.style.setProperty('--body', `'${(P.font && P.font.body) || 'Geist'}', system-ui, sans-serif`);
  document.body.classList.add(fmt);

  /* ---------- timeline ---------- */
  let t0 = 0;
  const scenes = P.scenes.map((s, i) => { const x = { ...s, i, id: s.id || `s${i}`, t0 }; t0 += s.dur; x.t1 = t0; return x; });
  const DUR = t0, N = Math.round(DUR * FPS);
  const stateAt = (t) => { for (let i = scenes.length - 1; i >= 0; i--) if (t >= scenes[i].t0) return i; return 0; };

  /* ---------- building blocks ---------- */
  const words = (text, cls = '') => esc(text).split(/\s+/).filter(Boolean).map((w) => `<span class="w ${cls}"><span>${w}</span></span>`).join(' ');
  // A product cut-out (or a shot on white) stands on the brand ground; a real-life photo fills the frame over a blurred copy of itself.
  const cut = (src) => !!(P.cutouts && P.cutouts.includes(src));
  const photo = (src, cls = '') => cut(src)
    ? `<div class="ph cut ${cls}"><div class="ph-glow"></div><img class="ph-fg" src="${src}" alt=""></div>`
    : `<div class="ph ${cls}"><div class="ph-bg" style="background-image:url('${src}')"></div><img class="ph-fg" src="${src}" alt=""></div>`;
  const logo = () => (P.brand && P.brand.logo ? `<div class="logo"><img src="${P.brand.logo}" alt=""></div>` : `<div class="logo mono-logo">${esc((P.brand && P.brand.name || '?').trim().slice(0, 1))}</div>`);
  const tag = (t) => (t ? `<div class="tag fit1" data-fit>${esc(t)}</div>` : '');

  const T = {
    hook: (s) => `<div class="L hook ${s.tone || 'accent'}">
        <div class="blob b1"></div><div class="blob b2"></div>
        <div class="hook-in">
          ${s.eyebrow ? `<div class="eyebrow fit1" data-fit>${esc(s.eyebrow)}</div>` : ''}
          <div class="hl" data-fit>${(s.lines || [s.text]).map((l) => `<div class="ln">${words(l)}</div>`).join('')}</div>
        </div></div>`,
    product: (s) => `<div class="L product">
        ${photo(s.photo, 'kb')}
        <div class="shade"></div>
        <div class="prod-copy">
          ${tag(s.tag)}
          <div class="title" data-fit><div class="tx">${words(s.title)}</div></div>
          ${s.price ? `<div class="price"><span data-fit>${esc(s.price)}</span></div>` : ''}
        </div></div>`,
    showcase: (s) => `<div class="L showcase">
        <div class="sc-photo">${photo(s.photo, 'kb')}</div>
        <div class="sc-copy">
          ${tag(s.tag)}
          <div class="title dark" data-fit><div class="tx">${words(s.title)}</div></div>
          ${s.note ? `<div class="note" data-fit>${esc(s.note)}</div>` : ''}
          ${s.price ? `<div class="price inline"><span data-fit>${esc(s.price)}</span></div>` : ''}
        </div></div>`,
    grid: (s) => `<div class="L grid n${Math.min(4, (s.photos || []).length)}">
        <div class="g-head"><div class="title dark" data-fit><div class="tx">${words(s.title)}</div></div></div>
        <div class="g-tiles">${(s.photos || []).slice(0, 4).map((p) => `<div class="tile">${photo(p)}</div>`).join('')}</div>
        ${s.items && s.items.length ? `<div class="g-items" data-fit>${s.items.slice(0, 6).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
      </div>`,
    list: (s) => `<div class="L list">
        <div class="title dark" data-fit><div class="tx">${words(s.title)}</div></div>
        <div class="rows">${(s.items || []).slice(0, 6).map((x, k) => `<div class="row" style="--k:${k}"><span class="dot"></span><span class="rt" data-fit>${esc(x)}</span></div>`).join('')}</div>
      </div>`,
    points: (s) => `<div class="L points${s.photo ? ' withphoto' : ''}">
        ${s.photo ? `<div class="pt-photo">${photo(s.photo, 'kb')}</div>` : ''}
        <div class="title" data-fit><div class="tx">${words(s.title)}</div></div>
        <div class="rows">${(s.points || []).slice(0, 4).map((x, k) => `<div class="row" style="--k:${k}"><span class="tick"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg></span><span class="rt" data-fit>${esc(x)}</span></div>`).join('')}</div>
      </div>`,
    statement: (s) => `<div class="L statement ${s.tone || 'dark'}"><div class="st" data-fit><div class="tx">${words(s.text)}</div></div></div>`,
    price: (s) => `<div class="L pricebig">
        <div class="pb-label fit1" data-fit>${esc(s.label || '')}</div>
        <div class="pb-num" data-fit>${esc(s.price)}</div>
        ${s.note ? `<div class="pb-note fit1" data-fit>${esc(s.note)}</div>` : ''}
      </div>`,
    cta: (s) => `<div class="L cta">
        <div class="blob b1"></div>
        <div class="cta-in">
          ${logo()}
          <div class="brand" data-fit>${esc(s.brand || (P.brand && P.brand.name) || '')}</div>
          ${s.headline ? `<div class="cta-hl" data-fit><div class="tx">${words(s.headline)}</div></div>` : ''}
          <div class="pill"><span data-fit>${esc(s.action)}</span></div>
          ${s.sub ? `<div class="cta-sub fit1" data-fit>${esc(s.sub)}</div>` : ''}
        </div></div>`,
  };

  const stage = document.getElementById('stage');
  const layers = scenes.map((s) => {
    const el = document.createElement('div');
    el.className = 'scene';
    el.innerHTML = (T[s.type] || T.statement)(s);
    stage.appendChild(el);
    return el;
  });
  const wipe = document.createElement('div');
  wipe.className = 'wipe';
  stage.appendChild(wipe);

  /* ---------- fit every text box: shrink the font until it fits, once, after fonts load ---------- */
  function fitAll() {
    layers.forEach((L) => { L.style.display = 'block'; L.style.visibility = 'hidden'; });
    for (const el of document.querySelectorAll('[data-fit]')) {
      const cs = getComputedStyle(el);
      let size = parseFloat(cs.fontSize);
      const min = size * 0.42;
      // a title measures its inner block (.tx): the box itself reports a few px of overflow from the word masks
      const tx = el.firstElementChild && el.firstElementChild.classList.contains('tx') ? el.firstElementChild : null;
      const over = tx
        ? () => tx.scrollWidth > tx.clientWidth + 1 || tx.offsetHeight > el.clientHeight + 1
        : () => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      let guard = 60;
      while (over() && size > min && guard-- > 0) { size *= 0.94; el.style.fontSize = `${size}px`; }
    }
    layers.forEach((L) => { L.style.display = 'none'; L.style.visibility = ''; });
  }

  /* ---------- per-frame animation ---------- */
  const q = (L, sel) => [...L.querySelectorAll(sel)];
  function revealWords(L, lt, start = 0.1, stagger = 0.07) {
    q(L, '.w > span').forEach((w, k) => {
      const p = outQuint(prog(lt, start + k * stagger, 0.6));
      w.style.transform = `translateY(${(1 - p) * 105}%)`;
      w.style.opacity = String(clamp(p * 1.6));
    });
  }
  function kenBurns(L, lt, dur) {
    q(L, '.kb .ph-fg, .kb .ph-bg').forEach((im) => { im.style.transform = `scale(${lerp(1.1, 1.0, inOut(lt / (dur + TR)))})`; });
  }
  function rise(el, lt, start, len = 0.55, dist = 6) {
    if (!el) return;
    const p = outCubic(prog(lt, start, len));
    el.style.opacity = String(p);
    el.style.transform = `translateY(${(1 - p) * dist * U}px)`;
  }
  function pop(el, lt, start, rot = 0) {
    if (!el) return;
    const p = prog(lt, start, 0.5);
    el.style.opacity = String(clamp(p * 3));
    el.style.transform = `scale(${0.4 + 0.6 * outBack(p)}) rotate(${rot}deg)`;
  }
  function blobs(L, lt) {
    q(L, '.blob').forEach((b, k) => { b.style.transform = `translate(${Math.sin(lt * 0.6 + k * 2) * 4 * U}px, ${Math.cos(lt * 0.5 + k) * 4 * U}px) scale(${1 + 0.05 * Math.sin(lt * 0.9 + k)})`; });
  }

  const A = {
    hook(L, lt, s) { blobs(L, lt); rise(L.querySelector('.eyebrow'), lt, 0.05, 0.5, 3); revealWords(L, lt, 0.18, 0.09); },
    product(L, lt, s) { kenBurns(L, lt, s.dur); rise(L.querySelector('.tag'), lt, 0.2, 0.5, 3); revealWords(L, lt, 0.3, 0.07); pop(L.querySelector('.price'), lt, 0.75, -4); },
    showcase(L, lt, s) {
      kenBurns(L, lt, s.dur);
      const ph = L.querySelector('.sc-photo'); const p = outQuint(prog(lt, 0, 0.7));
      ph.style.clipPath = `inset(${(1 - p) * 12}% ${(1 - p) * 12}% ${(1 - p) * 12}% ${(1 - p) * 12}% round ${3 * U}px)`;
      rise(L.querySelector('.tag'), lt, 0.25, 0.5, 3); revealWords(L, lt, 0.3, 0.07); rise(L.querySelector('.note'), lt, 0.7); pop(L.querySelector('.price'), lt, 0.85, -3);
    },
    grid(L, lt, s) {
      revealWords(L, lt, 0.05, 0.06);
      q(L, '.tile').forEach((t, k) => { const p = outQuint(prog(lt, 0.25 + k * 0.12, 0.6)); t.style.opacity = String(clamp(p * 2)); t.style.transform = `translateY(${(1 - p) * 8 * U}px) scale(${0.92 + 0.08 * p})`; });
      q(L, '.tile .ph-fg').forEach((im) => { im.style.transform = `scale(${lerp(1.06, 1, inOut(lt / s.dur))})`; });
      q(L, '.chip').forEach((c, k) => pop(c, lt, 0.8 + k * 0.08));
    },
    list(L, lt, s) { revealWords(L, lt, 0.05); q(L, '.row').forEach((r, k) => rise(r, lt, 0.35 + k * 0.16, 0.5, 4)); },
    points(L, lt, s) {
      revealWords(L, lt, 0.05); kenBurns(L, lt, s.dur);
      const pp = L.querySelector('.pt-photo'); if (pp) { const p = outQuint(prog(lt, 0.1, 0.7)); pp.style.opacity = String(p); pp.style.transform = `translateX(${(1 - p) * 6 * U}px)`; }
      q(L, '.row').forEach((r, k) => { rise(r, lt, 0.4 + k * 0.32, 0.5, 4); const tk = r.querySelector('.tick'); if (tk) tk.style.transform = `scale(${0.3 + 0.7 * outBack(prog(lt, 0.5 + k * 0.32, 0.45))})`; });
    },
    statement(L, lt, s) { revealWords(L, lt, 0.1, 0.1); },
    price(L, lt, s) { rise(L.querySelector('.pb-label'), lt, 0.05); pop(L.querySelector('.pb-num'), lt, 0.3); rise(L.querySelector('.pb-note'), lt, 0.8); },
    cta(L, lt, s) {
      blobs(L, lt);
      pop(L.querySelector('.logo'), lt, 0.1);
      rise(L.querySelector('.brand'), lt, 0.3, 0.6, 4);
      revealWords(L, lt, 0.5, 0.08);
      const pill = L.querySelector('.pill'); pop(pill, lt, 0.85);
      if (pill && lt > 1.4) pill.style.transform = `scale(${1 + 0.035 * Math.sin((lt - 1.4) * Math.PI * 2 * (BPM / 60) / 2)})`;
      rise(L.querySelector('.cta-sub'), lt, 1.1, 0.5, 3);
    },
  };

  function apply(f) {
    const t = f / FPS;
    const i = stateAt(t), s = scenes[i];
    const lt = t - s.t0;
    layers.forEach((L, k) => { L.style.display = k === i || (k === i - 1 && lt < TR) ? 'block' : 'none'; L.style.clipPath = ''; L.style.zIndex = k === i ? 2 : 1; });
    // the scene coming in wipes over the one going out, an accent bar riding the edge
    if (i > 0 && lt < TR) {
      const p = inOut(lt / TR), dir = i % 2 ? 1 : -1;
      layers[i].style.clipPath = dir > 0 ? `inset(0 0 0 ${(1 - p) * 100}%)` : `inset(0 ${(1 - p) * 100}% 0 0)`;
      wipe.style.display = 'block';
      wipe.style.left = dir > 0 ? `${(1 - p) * 100}%` : '';
      wipe.style.right = dir > 0 ? '' : `${(1 - p) * 100}%`;
      wipe.style.opacity = String(1 - Math.pow(p, 3));
      const prev = scenes[i - 1];
      (A[prev.type] || A.statement)(layers[i - 1], t - prev.t0, prev);
    } else wipe.style.display = 'none';
    (A[s.type] || A.statement)(layers[i], lt, s);
  }

  /* ---------- boot ---------- */
  const reel = {
    DUR, BPM, FPS, N,
    PLAN: scenes.map((s) => ({ id: s.id, t0: s.t0, w: 1, h: 1, content: s.id })),
    FRAMES: () => [], HOLDS: () => [], PRESSES: () => [], clicks: () => [],
    stateAt, at: (id) => (scenes.find((s) => s.id === id) || scenes[0]).t0,
  };
  window.READY = (async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r; }))));
    await new Promise((r) => setTimeout(r, 60));
    fitAll();
    window.renderFrame = (f) => apply(Math.max(0, Math.min(N - 1, f)));
    window.TOTAL_FRAMES = N; window.FPS = FPS; window.__starts = scenes.slice(1).map((s) => s.t0 + 0.0001);
    // a still for each scene is taken once everything in it has arrived
    window.__rest = scenes.map((s) => s.t0 + Math.min(s.dur - 0.2, Math.max(1.6, s.dur * 0.7)));
    const qs = new URLSearchParams(location.search);
    apply(qs.has('t') ? Math.round(+qs.get('t') * FPS) : 0);
    if (qs.has('play')) { const st = performance.now(); const loop = () => { apply(Math.floor((((performance.now() - st) / 1000) * FPS) % N)); requestAnimationFrame(loop); }; loop(); }
    return true;
  })();
  window.renderAudio = () => (window.ReelScore ? window.ReelScore.render(reel, Object.assign({ clicks: false, holdRiser: false }, P.score || {}), null) : Promise.reject(new Error('score.js not loaded')));
})();

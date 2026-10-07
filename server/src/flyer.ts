// Flyer templates for Flyers & Price Lists: a promo flyer, a price list or menu, and an announcement, each in a bold
// (brand colour ground) and a clean (light ground) style, laid out for WhatsApp Status (1080×1920), an Instagram post
// (1080×1350) and A4 print. The copy comes from the Designer as JSON; these templates own the layout and shrink any
// text box until it fits, so nothing is cut off. Photos are embedded as data URIs; the page says POSTER_READY when
// its fonts, photos and fitting are done (browser.ts renderPoster waits for it).

export type FlyerKind = 'promo' | 'pricelist' | 'announcement';
export type FlyerCopy = { headline: string; sub?: string; badge?: string; points?: string[]; title?: string; note?: string; date?: string };
export type FlyerItem = { name: string; price?: string; group?: string };
export type FlyerInput = {
  kind: FlyerKind; variant: 'bold' | 'clean'; size: 'status' | 'post' | 'a4';
  business: string; copy: FlyerCopy; items?: FlyerItem[]; cta: string; ctaKind?: string; footer: string[];
  colour: string; logo?: { uri: string }; photos: { uri: string; cut: boolean }[];
};
export const SIZES = { status: [1080, 1920], post: [1080, 1350], a4: [794, 1123] } as const;

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function shade(hex: string, k: number) { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; const f = (c: number) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k); return `#${[f(r), f(g), f(b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`; }
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

export function flyerHtml(f: FlyerInput): string {
  const [W, H] = SIZES[f.size];
  const accent = /^#[0-9a-f]{6}$/i.test(f.colour) ? f.colour : '#d4380d';
  const onAccent = lum(accent) > 0.4 ? '#141414' : '#ffffff';
  const bold = f.variant === 'bold';
  const bg = bold ? accent : '#faf7f1', ink = bold ? onAccent : '#141414', soft = bold ? (onAccent === '#ffffff' ? 'rgba(255,255,255,.82)' : 'rgba(0,0,0,.7)') : '#555049';
  const card = bold ? (onAccent === '#ffffff' ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.55)') : '#ffffff';
  const ctaBg = bold ? (onAccent === '#ffffff' ? '#ffffff' : '#141414') : accent, ctaInk = bold ? (onAccent === '#ffffff' ? shade(accent, -0.35) : '#ffffff') : onAccent;
  const tall = f.size === 'status';
  const photo = f.photos[0];
  const hero = photo ? (photo.cut
    ? `<div class="hero cut"><div class="glow"></div><img src="${photo.uri}"></div>`
    : `<div class="hero"><img class="cover" src="${photo.uri}"></div>`) : '';
  const head = `<div class="top">${f.logo ? `<img class="logo" src="${f.logo.uri}">` : `<span class="mono">${esc(f.business.slice(0, 1))}</span>`}<b>${esc(f.business)}</b></div>`;
  const ICON: Record<string, string> = {
    whatsapp: '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 13.9c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.4 1.8 2.2 1.2 1.1 2.3 1.4 2.6 1.6.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l1.9.9c.3.1.5.2.5.3.1.2.1.6-.1 1.2z"/>',
    call: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>',
    visit: '<path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>',
    dm: '<path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm5 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17.3 5.6a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z"/>',
    website: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.95a15.6 15.6 0 0 0-1.38-3.56A8 8 0 0 1 18.9 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a8.2 8.2 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4zm.84 2h2.95c.32 1.25.78 2.45 1.38 3.56A8 8 0 0 1 5.1 16zM8.05 8H5.1a8 8 0 0 1 4.33-3.56A15.6 15.6 0 0 0 8.05 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82A13.5 13.5 0 0 1 12 19.96zM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8 8 0 0 1-4.33 3.56zM16.36 14a16.5 16.5 0 0 0 0-4h3.38a8.2 8.2 0 0 1 0 4z"/>',
  };
  const cta = `<div class="cta"><svg viewBox="0 0 24 24">${ICON[f.ctaKind ?? 'whatsapp'] ?? ICON.whatsapp}</svg><span data-fit>${esc(f.cta)}</span></div>`;
  const foot = f.footer.length ? `<div class="foot" data-fit>${f.footer.map(esc).join('<i>·</i>')}</div>` : '';

  let body = '';
  if (f.kind === 'promo') {
    body = `${head}${hero}
      ${f.copy.badge ? `<div class="badge"><span data-fit>${esc(f.copy.badge)}</span></div>` : ''}
      <div class="hl" data-fit><div>${esc(f.copy.headline)}</div></div>
      ${f.copy.sub ? `<div class="sub" data-fit>${esc(f.copy.sub)}</div>` : ''}
      ${f.copy.points?.length ? `<div class="pts">${f.copy.points.slice(0, 3).map((p) => `<div><i>✓</i><span data-fit>${esc(p)}</span></div>`).join('')}</div>` : ''}
      ${cta}${foot}`;
  } else if (f.kind === 'pricelist') {
    const items = (f.items ?? []).slice(0, 30);
    const groups: { name?: string; items: FlyerItem[] }[] = [];
    for (const it of items) { const g = groups.at(-1); if (g && g.name === it.group) g.items.push(it); else groups.push({ name: it.group, items: [it] }); }
    const cols = items.length > (tall ? 16 : 9) ? 2 : 1;
    // photos only when the list leaves room for them
    const strip = f.photos.slice(0, items.length > (tall ? 14 : f.size === 'a4' ? 12 : 7) ? 0 : 3);
    // two columns, balanced by lines (a group heading counts as one), never splitting a group
    const colOf: number[] = [];
    if (cols === 2) { const total = groups.reduce((t, g) => t + g.items.length + (g.name ? 1 : 0), 0); let run = 0; for (const g of groups) { colOf.push(run < total / 2 ? 0 : 1); run += g.items.length + (g.name ? 1 : 0); } }
    const section = (g: { name?: string; items: FlyerItem[] }) => `<section>${g.name ? `<h4>${esc(g.name)}</h4>` : ''}${g.items.map((it) => `<p><span>${esc(it.name)}</span><em></em><b>${esc(it.price ?? '')}</b></p>`).join('')}</section>`;
    const listInner = cols === 2 ? [0, 1].map((c) => `<div class="col">${groups.filter((_, i) => colOf[i] === c).map(section).join('')}</div>`).join('') : `<div class="col">${groups.map(section).join('')}</div>`;
    body = `${head}
      <div class="ttl" data-fit><div>${esc(f.copy.title || f.copy.headline || 'Price list')}</div></div>
      ${f.copy.sub ? `<div class="sub small" data-fit>${esc(f.copy.sub)}</div>` : ''}
      ${strip.length ? `<div class="strip n${strip.length}">${strip.map((p) => `<div class="${p.cut ? 'cut' : ''}"><img src="${p.uri}"></div>`).join('')}</div>` : ''}
      <div class="list c${cols}" data-fit>${listInner}</div>
      ${f.copy.note ? `<div class="note" data-fit>${esc(f.copy.note)}</div>` : ''}
      ${cta}${foot}`;
  } else {
    body = `${head}
      ${f.copy.date ? `<div class="date"><span data-fit>${esc(f.copy.date)}</span></div>` : ''}
      <div class="hl big" data-fit><div>${esc(f.copy.headline)}</div></div>
      ${f.copy.sub ? `<div class="sub" data-fit>${esc(f.copy.sub)}</div>` : ''}
      ${f.copy.points?.length ? `<div class="pts">${f.copy.points.slice(0, 3).map((p) => `<div><i>•</i><span data-fit>${esc(p)}</span></div>`).join('')}</div>` : ''}
      ${hero}${cta}${foot}`;
  }

  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Geist:wght@500;600;700&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{--u:${Math.min(W, H) / 100}px;background:${bg};color:${ink};font-family:Geist,Arial,sans-serif;display:flex;flex-direction:column;gap:calc(var(--u)*${tall ? 3.2 : 2.4});padding:calc(var(--u)*${f.size === 'a4' ? 7 : 6});position:relative}
body:before{content:"";position:absolute;inset:0;background:${bold ? `radial-gradient(circle at 85% 8%, rgba(255,255,255,.18), transparent 38%), radial-gradient(circle at 0% 100%, rgba(0,0,0,.14), transparent 40%)` : `radial-gradient(circle at 90% 0%, ${shade(accent, 0.75)}, transparent 42%)`};pointer-events:none}
body>*{position:relative}
.top{display:flex;align-items:center;gap:calc(var(--u)*2);font-size:calc(var(--u)*3.6);font-weight:700;flex:none}
.top .logo{width:calc(var(--u)*10);height:calc(var(--u)*10);object-fit:contain;background:#fff;border-radius:calc(var(--u)*2.4);padding:calc(var(--u)*.8)}
.top .mono{width:calc(var(--u)*10);height:calc(var(--u)*10);display:grid;place-items:center;border-radius:calc(var(--u)*2.4);background:${bold ? ink : accent};color:${bold ? bg : onAccent};font-family:'Bricolage Grotesque';font-size:calc(var(--u)*6)}
.hero{flex:${tall ? '1 1 34%' : '1 1 30%'};min-height:0;border-radius:calc(var(--u)*3.4);overflow:hidden;position:relative;background:${card}}
.hero .cover{width:100%;height:100%;object-fit:cover}
.hero.cut{background:${bold ? 'rgba(255,255,255,.92)' : '#fff'}}
.hero.cut .glow{position:absolute;left:50%;top:55%;width:110%;aspect-ratio:1;transform:translate(-50%,-50%);background:radial-gradient(circle, ${shade(accent, 0.55)} 0%, transparent 60%)}
.hero.cut img{position:absolute;inset:6%;width:88%;height:88%;object-fit:contain;filter:drop-shadow(0 calc(var(--u)*1.6) calc(var(--u)*2) rgba(0,0,0,.25))}
.hl,.ttl{font-family:'Bricolage Grotesque',Arial,sans-serif;font-weight:800;letter-spacing:-.03em;line-height:.98;font-size:calc(var(--u)*${tall ? 14 : 11});height:calc(var(--u)*${tall ? 34 : 23});display:flex;align-items:flex-end;overflow:hidden;flex:none}
.hl.big{font-size:calc(var(--u)*${tall ? 17 : 13});height:calc(var(--u)*${tall ? 48 : 30})}
.ttl{font-size:calc(var(--u)*12);height:calc(var(--u)*14)}
.hl>div,.ttl>div{width:100%}
.sub{font-size:calc(var(--u)*4.6);line-height:1.25;color:${soft};font-weight:600;max-height:calc(var(--u)*13);overflow:hidden;flex:none}
.sub.small{font-size:calc(var(--u)*3.8);max-height:calc(var(--u)*6)}
.badge{position:absolute;right:calc(var(--u)*5);top:calc(var(--u)*${tall ? 20 : 17});width:calc(var(--u)*28);height:calc(var(--u)*28);border-radius:50%;background:${bold ? ink : accent};color:${bold ? bg : onAccent};display:grid;place-items:center;transform:rotate(-8deg);box-shadow:0 calc(var(--u)*1.4) calc(var(--u)*3) rgba(0,0,0,.25);z-index:3}
.badge span{display:block;width:80%;text-align:center;font-family:'Bricolage Grotesque';font-weight:800;font-size:calc(var(--u)*7);line-height:1;max-height:62%;overflow:hidden}
.pts{display:grid;gap:calc(var(--u)*1.6);flex:none}
.pts div{display:flex;align-items:center;gap:calc(var(--u)*2);font-size:calc(var(--u)*4.4);font-weight:600}
.pts i{flex:none;width:calc(var(--u)*6);height:calc(var(--u)*6);border-radius:50%;display:grid;place-items:center;background:${bold ? ink : accent};color:${bold ? bg : onAccent};font-style:normal;font-size:calc(var(--u)*3.4)}
.pts span{white-space:nowrap;overflow:hidden;flex:1;min-width:0}
.cta{flex:none;display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*2);background:${ctaBg};color:${ctaInk};border-radius:999px;padding:calc(var(--u)*2.6) calc(var(--u)*4);font-weight:800;font-size:calc(var(--u)*5)}
.cta svg{width:calc(var(--u)*6);height:calc(var(--u)*6);fill:currentColor;flex:none}
.cta span{white-space:nowrap;overflow:hidden;min-width:0}
.foot{flex:none;font-size:calc(var(--u)*3.2);color:${soft};text-align:center;white-space:nowrap;overflow:hidden;font-weight:600}
.foot i{font-style:normal;margin:0 .6em}
.date{align-self:flex-start;background:${bold ? ink : accent};color:${bold ? bg : onAccent};border-radius:999px;padding:calc(var(--u)*1.4) calc(var(--u)*3.4);font-weight:800;font-size:calc(var(--u)*4.4);max-width:100%}
.date span{display:block;white-space:nowrap;overflow:hidden}
.strip{display:grid;gap:calc(var(--u)*1.6);height:calc(var(--u)*${tall ? 30 : 22});flex:none}.strip.n1{grid-template-columns:1fr}.strip.n2{grid-template-columns:1fr 1fr}.strip.n3{grid-template-columns:1fr 1fr 1fr}
.strip div{border-radius:calc(var(--u)*2.4);overflow:hidden;background:${card}}.strip img{width:100%;height:100%;object-fit:cover}.strip .cut{background:#fff}.strip .cut img{object-fit:contain;padding:8%}
.list{flex:1 1 auto;min-height:0;overflow:hidden;font-size:calc(var(--u)*4.4);background:${card};border-radius:calc(var(--u)*3);padding:calc(var(--u)*3.4) calc(var(--u)*4)}
.list.c2{display:grid;grid-template-columns:1fr 1fr;column-gap:calc(var(--u)*5);align-content:start}
.list section{break-inside:avoid;margin-bottom:.7em}
.list h4{font-family:'Bricolage Grotesque';font-size:1.2em;margin-bottom:.35em;color:${bold ? ink : shade(accent, -0.25)}}
.list p{display:flex;align-items:baseline;gap:.4em;margin:.32em 0;font-weight:600;break-inside:avoid}
.list p span{min-width:0}.list p em{flex:1;border-bottom:.12em dotted currentColor;opacity:.4;transform:translateY(-.25em)}.list p b{white-space:nowrap;font-weight:800}
.note{flex:none;font-size:calc(var(--u)*3.4);color:${soft};max-height:calc(var(--u)*9);overflow:hidden}
</style></head><body>${body}
<script>
(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((im) => im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r; })));
  for (const el of document.querySelectorAll('[data-fit]')) {
    let size = parseFloat(getComputedStyle(el).fontSize); const min = size * 0.4; let guard = 70;
    const inner = el.firstElementChild && el.firstElementChild.tagName === 'DIV' && !el.classList.contains('list') ? el.firstElementChild : null;
    const over = () => inner ? (inner.scrollWidth > inner.clientWidth + 1 || inner.offsetHeight > el.clientHeight + 1) : (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    while (over() && size > min && guard-- > 0) { size *= 0.95; el.style.fontSize = size + 'px'; }
  }
  // a list with room to spare grows its type, up to 1.35×
  const list = document.querySelector('.list');
  if (list) { let size = parseFloat(getComputedStyle(list).fontSize); const max = size * 1.35; let guard = 30; while (size < max && guard-- > 0) { list.style.fontSize = (size * 1.04) + 'px'; if (list.scrollHeight > list.clientHeight + 1 || list.scrollWidth > list.clientWidth + 1) { list.style.fontSize = size + 'px'; break; } size *= 1.04; } }
  window.POSTER_READY = true;
})();
</script></body></html>`;
}

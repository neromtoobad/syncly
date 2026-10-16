// Designed social posts for Social Media Posts: the owner's photo (or their brand colour, never an invented product)
// with the hook set in big type, their logo, a price chip and a WhatsApp line, at the exact size each place shows
// it: an Instagram feed post (1080×1350), a reel cover, story or WhatsApp Status (1080×1920). A carousel is a cover,
// slides and a closing slide that asks for the order. Rendered by our headless Chrome (browser.ts renderPages); the
// page says POSTER_READY once its fonts and photo are in and every text box is fitted.
import { esc, lum, shade, spacedPhones } from './flyer.ts';

export type PostSize = 'feed' | 'story' | 'wide';
export const POST_SIZES: Record<PostSize, [number, number]> = { feed: [1080, 1350], story: [1080, 1920], wide: [1600, 900] }; // wide: an X (Twitter) image
export type PostCard = {
  size: PostSize; kind: 'cover' | 'slide' | 'end';
  business: string; colour?: string; logo?: string; photo?: string;
  hook: string; sub?: string; price?: string; cta?: string; tag?: string;
  slide?: { n: number; of: number };
  /** picks one of the cover layouts, so posts in a week don't all look alike */
  look?: number;
};

export function postHtml(p: PostCard): string {
  const [W, H] = POST_SIZES[p.size];
  const accent = /^#[0-9a-f]{6}$/i.test(p.colour ?? '') ? p.colour! : '#c0392b';
  const onAccent = lum(accent) > 0.4 ? '#141414' : '#ffffff';
  const dark = shade(accent, -0.55);
  const tall = p.size === 'story';
  const look = (p.look ?? 0) % 3; // 0: photo + bottom title · 1: photo + top title band · 2: framed photo on colour
  const brand = `<div class="brand">${p.logo ? `<img src="${p.logo}" alt="">` : `<i>${esc(p.business.slice(0, 1))}</i>`}<span>${esc(p.business)}</span></div>`;
  const price = p.price ? `<div class="price"><span data-fit>${esc(p.price)}</span></div>` : '';
  const cta = p.cta ? `<div class="cta"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 13.9c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.4 1.8 2.2 1.2 1.1 2.3 1.4 2.6 1.6.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l1.9.9c.3.1.5.2.5.3.1.2.1.6-.1 1.2z"/></svg><span data-fit>${esc(spacedPhones(p.cta))}</span></div>` : '';
  const counter = p.slide ? `<div class="count">${p.slide.n}/${p.slide.of}${p.slide.n < p.slide.of ? ' · Swipe →' : ''}</div>` : '';
  const swipe = '';

  let body = '';
  if (p.kind === 'cover' && p.photo && look !== 2) {
    body = `<img class="bg" src="${p.photo}" alt=""><div class="shade ${look === 1 ? 'top' : 'bottom'}"></div>
      <div class="frame ${look === 1 ? 'title-top' : 'title-bottom'}">${brand}${counter}
        <div class="words">${p.tag ? `<div class="tag">${esc(p.tag)}</div>` : ''}<div class="hook" data-fit><div>${esc(p.hook)}</div></div>${p.sub ? `<div class="sub" data-fit>${esc(p.sub)}</div>` : ''}</div>
        <div class="row">${price}${cta}</div>${swipe}</div>`;
  } else if (p.kind === 'cover' && p.photo) {
    body = `<div class="frame framed">${brand}${counter}
        <div class="pic"><img src="${p.photo}" alt="">${price}</div>
        <div class="words">${p.tag ? `<div class="tag">${esc(p.tag)}</div>` : ''}<div class="hook small" data-fit><div>${esc(p.hook)}</div></div></div>
        ${cta}${swipe}</div>`;
  } else if (p.kind === 'end') {
    body = `<div class="frame plain end">${brand}<div class="grow"></div>
        <div class="hook" data-fit><div>${esc(p.hook)}</div></div>${p.sub ? `<div class="sub" data-fit>${esc(p.sub)}</div>` : ''}
        <div class="grow"></div>${price}${cta}</div>`;
  } else {
    // a text slide, or a cover with no photo: type on their colour, never a made-up product picture
    body = `<div class="frame plain">${brand}${counter}<div class="grow"></div>
        ${p.tag ? `<div class="tag">${esc(p.tag)}</div>` : ''}<div class="hook${p.kind === 'slide' ? ' slide' : ''}" data-fit><div>${esc(p.hook)}</div></div>${p.sub ? `<div class="sub" data-fit>${esc(p.sub)}</div>` : ''}
        <div class="grow"></div><div class="row">${price}${cta}</div>${swipe}</div>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Geist:wght@500;600;700&display=block" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{--u:${Math.min(W, H) / 100}px;font-family:Geist,Arial,sans-serif;background:${p.kind === 'cover' && p.photo && look !== 2 ? '#111' : accent};color:${onAccent};position:relative}
body:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 88% 6%, rgba(255,255,255,.2), transparent 40%),radial-gradient(circle at 0% 100%, rgba(0,0,0,.22), transparent 45%);pointer-events:none}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.shade{position:absolute;inset:0}.shade.bottom{background:linear-gradient(180deg,rgba(0,0,0,.35) 0%,rgba(0,0,0,0) 22%,rgba(0,0,0,0) 42%,rgba(0,0,0,.82) 78%,rgba(0,0,0,.9) 100%)}
.shade.top{background:linear-gradient(180deg,rgba(0,0,0,.88) 0%,rgba(0,0,0,.6) 34%,rgba(0,0,0,0) 58%,rgba(0,0,0,0) 80%,rgba(0,0,0,.6) 100%)}
.frame{position:absolute;inset:0;padding:calc(var(--u)*6.5) calc(var(--u)*6.5) calc(var(--u)*${tall ? 16 : 6.5});display:flex;flex-direction:column;gap:calc(var(--u)*2.6);color:#fff}
.frame.plain,.frame.framed{color:${onAccent}}
.title-bottom .words{margin-top:auto}.title-top .words{margin-top:calc(var(--u)*2)}.title-top .row{margin-top:auto}
.brand{display:flex;align-items:center;gap:calc(var(--u)*2);font-weight:700;font-size:calc(var(--u)*3.6);flex:none}
.brand img{width:calc(var(--u)*10);height:calc(var(--u)*10);border-radius:calc(var(--u)*2.6);object-fit:contain;background:#fff;padding:calc(var(--u)*.8)}
.brand i{width:calc(var(--u)*10);height:calc(var(--u)*10);border-radius:calc(var(--u)*2.6);display:grid;place-items:center;font-style:normal;font-family:'Bricolage Grotesque';font-size:calc(var(--u)*5.6);background:${onAccent};color:${accent}}
.count{position:absolute;right:calc(var(--u)*6.5);top:calc(var(--u)*8.5);font-weight:700;font-size:calc(var(--u)*3);background:rgba(0,0,0,.35);color:#fff;padding:calc(var(--u)*.8) calc(var(--u)*2);border-radius:999px}
.tag{align-self:flex-start;width:fit-content;font-weight:700;font-size:calc(var(--u)*3.2);letter-spacing:.06em;text-transform:uppercase;background:${accent};color:${onAccent};padding:calc(var(--u)*1) calc(var(--u)*2.4);border-radius:999px;margin-bottom:calc(var(--u)*1.6)}
.plain .tag,.framed .tag{background:${onAccent};color:${accent}}
.hook{font-family:'Bricolage Grotesque',Arial,sans-serif;font-weight:800;letter-spacing:-.035em;line-height:.97;font-size:calc(var(--u)*${tall ? 13.5 : 12});max-height:calc(var(--u)*${tall ? 62 : 44});overflow:hidden;flex:none}
.hook.small{font-size:calc(var(--u)*9);max-height:calc(var(--u)*${tall ? 34 : 22})}
.hook.slide{font-size:calc(var(--u)*10);max-height:calc(var(--u)*${tall ? 80 : 60})}
.hook>div{width:100%}
.sub{font-size:calc(var(--u)*4.4);line-height:1.3;font-weight:600;opacity:.9;max-height:calc(var(--u)*12);overflow:hidden;flex:none}
.row{display:flex;align-items:center;gap:calc(var(--u)*2.4);flex:none;flex-wrap:wrap}
.price{flex:none;align-self:flex-start;width:fit-content;background:${accent};color:${onAccent};font-family:'Bricolage Grotesque';font-weight:800;font-size:calc(var(--u)*6.4);padding:calc(var(--u)*1.4) calc(var(--u)*3.2);border-radius:calc(var(--u)*2.4);box-shadow:0 calc(var(--u)*1) calc(var(--u)*3) rgba(0,0,0,.3);max-width:100%;white-space:nowrap;overflow:hidden}
.plain .price,.framed .price{background:${onAccent};color:${accent}}
.cta{align-self:flex-start;display:flex;align-items:center;gap:calc(var(--u)*1.6);background:#25d366;color:#fff;font-weight:700;font-size:calc(var(--u)*4);padding:calc(var(--u)*2) calc(var(--u)*3.2);border-radius:999px;min-width:0;max-width:100%}
.cta svg{width:calc(var(--u)*5.2);height:calc(var(--u)*5.2);fill:currentColor;flex:none}.cta span{white-space:nowrap;overflow:hidden;min-width:0}
.swipe{position:absolute;right:calc(var(--u)*6.5);bottom:calc(var(--u)*${tall ? 16 : 6.5});font-weight:700;font-size:calc(var(--u)*3.2);opacity:.85}
.grow{flex:1 1 0;min-height:0}
.framed .pic{position:relative;flex:1 1 auto;min-height:0;border-radius:calc(var(--u)*4);overflow:hidden;box-shadow:0 calc(var(--u)*2) calc(var(--u)*5) rgba(0,0,0,.3);background:${dark}}
.framed .pic img{width:100%;height:100%;object-fit:cover}
.framed .pic .price{position:absolute;right:calc(var(--u)*3);bottom:calc(var(--u)*3)}
.end .hook{font-size:calc(var(--u)*11)}
</style></head><body>${body}
<script>
(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((im) => im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r; })));
  for (const el of document.querySelectorAll('[data-fit]')) {
    let size = parseFloat(getComputedStyle(el).fontSize); const min = size * 0.45; let guard = 80;
    const inner = el.firstElementChild && el.firstElementChild.tagName === 'DIV' ? el.firstElementChild : null;
    const over = () => inner ? (inner.scrollWidth > inner.clientWidth + 1 || inner.offsetHeight > el.clientHeight + 2) : (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2);
    while (over() && size > min && guard-- > 0) { size *= 0.95; el.style.fontSize = size + 'px'; }
  }
  window.POSTER_READY = true;
})();
</script></body></html>`;
}

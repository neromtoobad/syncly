// QR posters for the shop: the business's own type and colours, its best photo, and a QR code to its site (or a
// WhatsApp chat, its Chowdeck store, its Google review page, its bank details). One HTML page per poster, rendered
// by our headless Chrome to a print PDF or a PNG for WhatsApp Status. Site QR codes carry ?src=qr, so scans count.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { DATA_DIR } from '../config.ts';
import { palette } from './color.ts';
import { ICON, esc } from './engine.ts';
import { prettyPhone, waLink, type Facts, type Photo } from './facts.ts';
import { LINKS, linksIn } from './links.ts';
import type { Plan } from './plan.ts';
import { THEMES } from './themes.ts';

export const FORMATS = {
  a4: { w: 794, h: 1123, label: 'Poster (A4)', print: true },
  a5: { w: 559, h: 794, label: 'Counter card (A5)', print: true },
  status: { w: 1080, h: 1920, label: 'WhatsApp Status', print: false },
} as const;
export type PosterFormat = keyof typeof FORMATS;
export type PosterTarget = 'site' | 'whatsapp' | 'order' | 'review' | 'pay';
export type PosterOpts = { format?: string; target?: string; headline?: string; sub?: string; photo?: boolean; bank?: boolean };
type Site = { slug: string; url: string; plan: Plan; facts: Facts; photos: Photo[] };

const WHERE = (f: Facts) => [f.category, [f.area, f.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ');

/** What a poster's code can open, with the words that go with it. Only targets the site has the facts for. */
export function posterTargets(s: Site): { id: PosterTarget; label: string; url: string; headline: string; sub: string }[] {
  const f = s.facts, chat = f.whatsapp ?? f.phone, out: ReturnType<typeof posterTargets> = [];
  const look = f.kind === 'food' ? 'See our menu & order' : ['beauty', 'health'].includes(f.kind) ? 'See our prices & book' : ['creative', 'events'].includes(f.kind) ? 'See our work & book' : f.items.some((i) => i.price) ? 'See our prices' : 'See what we do';
  out.push({ id: 'site', label: 'Your website', url: `${s.url}?src=qr`, headline: look, sub: f.kind === 'food' ? 'Our menu, prices, opening hours and directions' : 'Prices, opening hours, directions and how to reach us' });
  const wa = waLink(chat, s.plan.whatsappText, f.country);
  if (wa) out.push({ id: 'whatsapp', label: 'WhatsApp chat', url: wa, headline: f.kind === 'food' ? 'Order on WhatsApp' : 'Chat with us on WhatsApp', sub: `Or save our number: ${prettyPhone(chat, f.country)}` });
  const get = [...linksIn(f.links, 'order'), ...linksIn(f.links, 'book'), ...linksIn(f.links, 'tickets'), ...linksIn(f.links, 'shop')][0];
  if (get) out.push({ id: 'order', label: get.label, url: get.url, headline: get.cta, sub: ({ order: 'Delivered to your door', book: 'Pick a time that suits you', tickets: 'Get yours before they sell out', shop: 'Pay safely online' } as Record<string, string>)[LINKS[get.id].group] ?? '' });
  if (f.links?.review) out.push({ id: 'review', label: 'Google review', url: f.links.review, headline: 'Enjoyed it? Review us on Google', sub: 'It takes 30 seconds and helps us a lot' });
  if (f.bank) out.push({ id: 'pay', label: 'Pay by transfer', url: `${s.url}?src=qr#pay`, headline: 'Pay by transfer', sub: 'Scan to copy our account number' });
  return out;
}

const dataUri = (slug: string, file?: string) => {
  if (!file || !/^[a-z0-9._-]+$/i.test(file)) return undefined;
  const p = join(DATA_DIR, 'sites', slug, file);
  return existsSync(p) ? `data:image/jpeg;base64,${readFileSync(p).toString('base64')}` : undefined;
};
/** The poster's photo: the hero, else the best real photo (never a flyer or a logo). */
function bestPhoto(s: Site): Photo | undefined {
  const ok = s.photos.filter((p) => p.kind !== 'flyer' && p.kind !== 'logo');
  return ok.find((p) => p.id === s.plan.hero.photo) ?? ok.sort((a, b) => b.quality - a.quality)[0];
}

/** The poster as a self-contained HTML page (photos inline). `fit` scales it to the window, for the editor's preview. */
export async function posterHtml(s: Site, o: PosterOpts, fit = false): Promise<{ html: string; w: number; h: number; format: PosterFormat; target: PosterTarget }> {
  const format: PosterFormat = o.format && o.format in FORMATS ? (o.format as PosterFormat) : 'a4';
  const targets = posterTargets(s);
  const tg = targets.find((x) => x.id === o.target) ?? targets[0];
  const { w, h } = FORMATS[format];
  const f = s.facts, t = THEMES[s.plan.theme], pal = palette(s.plan.brand, t.mode, t.action);
  const accent = palette(s.plan.brand, 'light', 'brand').brand; // the brand colour itself, even on 'ink' themes
  const qr = await QRCode.toString(tg.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#14181a', light: '#0000' } });
  const ph = o.photo === false ? undefined : bestPhoto(s);
  const img = ph && dataUri(s.slug, ph.file);
  const logo = dataUri(s.slug, f.logo);
  const headline = (o.headline ?? '').trim().slice(0, 70) || tg.headline;
  const sub = (o.sub ?? '').trim().slice(0, 90) || tg.sub;
  const showBank = !!f.bank && tg.id !== 'pay' && !!o.bank; // the transfer poster shows them in the middle instead
  const chat = f.whatsapp ?? f.phone;
  const short = tg.id === 'site' || tg.id === 'pay' ? s.url.replace(/^https?:\/\//, '') : tg.id === 'whatsapp' ? `WhatsApp ${prettyPhone(chat, f.country)}` : tg.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\?.*$/, '').slice(0, 48);
  const status = format === 'status', caps = t.display.caps;
  const initial = f.name.replace(/^(the|le|la)\s+/i, '').charAt(0).toUpperCase();
  const css = `
@page{size:${w}px ${h}px;margin:0}
*{box-sizing:border-box;margin:0}
html,body{width:${fit ? '100%' : `${w}px`};height:${fit ? '100%' : `${h}px`};background:${fit ? '#e9e6df' : pal.bg};-webkit-print-color-adjust:exact;print-color-adjust:exact}
${fit ? 'body{overflow:hidden;display:grid;place-items:center}' : ''}
.sheet{--u:${w / 100}px;width:${w}px;height:${h}px;position:relative;overflow:hidden;background:${pal.bg};color:${pal.ink};font-family:${t.body.family};font-weight:${t.body.weight};display:flex;flex-direction:column;${fit ? 'box-shadow:0 30px 80px -30px rgba(0,0,0,.45);transform-origin:center;flex:none' : ''}}
.top{position:relative;height:${status ? 31 : img ? 30 : 24}%;flex:none;color:#fff;background:${pal.deep};display:flex;flex-direction:column;justify-content:flex-end;padding:calc(var(--u)*6) calc(var(--u)*8);overflow:hidden}
.top img.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${ph?.focus === 'top' ? 'center 25%' : ph?.focus === 'bottom' ? 'center 75%' : 'center'}}
.top .scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 25%,rgba(0,0,0,.72) 100%)}
.top .mono{position:absolute;right:-.06em;top:-.2em;font-family:${t.display.family};font-weight:${t.display.weight};font-size:calc(var(--u)*${status ? 70 : 62});line-height:1;color:${accent};opacity:.35}
.brand{position:relative;display:flex;align-items:center;gap:calc(var(--u)*3)}
.brand img{width:calc(var(--u)*11);height:calc(var(--u)*11);border-radius:50%;object-fit:cover;background:#fff;flex:none}
.name{font-family:${t.display.family};font-weight:${Math.min(800, t.display.weight + 40)};font-size:calc(var(--u)*${status ? 8.6 : 8});line-height:1.02;letter-spacing:${t.display.tracking};${caps ? `text-transform:uppercase;font-stretch:${t.display.stretch ?? '100%'};` : ''}text-wrap:balance}
.where{position:relative;margin-top:calc(var(--u)*1.6);font-size:calc(var(--u)*3);opacity:.85;letter-spacing:.01em}
.body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:calc(var(--u)*${status ? 5 : 4}) calc(var(--u)*8);gap:calc(var(--u)*${status ? 3.4 : 2.6})}
h1{font-family:${t.display.family};font-weight:${t.display.weight};font-size:calc(var(--u)*${status ? 7.6 : 6.4});line-height:1.04;letter-spacing:${t.display.tracking};${caps ? 'text-transform:uppercase;' : ''}max-width:100%;text-wrap:balance}
.qr{position:relative;flex:none;width:calc(var(--u)*${status ? 52 : 42});aspect-ratio:1;padding:calc(var(--u)*3.6);background:#fff;border-radius:calc(var(--u)*${t.radius.card === '0px' ? 0 : 4});box-shadow:0 0 0 calc(var(--u)*.7) ${accent}, 0 calc(var(--u)*3) calc(var(--u)*8) calc(var(--u)*-3) rgba(0,0,0,.28)}
.qr svg{display:block;width:100%;height:100%}
.qr .tag{position:absolute;left:50%;bottom:calc(var(--u)*-3.2);transform:translateX(-50%);background:${accent};color:${palette(s.plan.brand, 'light', 'brand').onBrand};font:700 calc(var(--u)*2.5)/1 ${t.body.family};padding:calc(var(--u)*1.4) calc(var(--u)*3);border-radius:999px;white-space:nowrap;letter-spacing:.02em}
.sub{font-size:calc(var(--u)*${status ? 3.4 : 2.9});color:${pal.muted};max-width:86%;line-height:1.35;margin-top:calc(var(--u)*1.2)}
.short{font-family:${t.mono ?? 'ui-monospace, Menlo, monospace'};font-size:calc(var(--u)*2.5);color:${pal.muted};letter-spacing:.01em;overflow-wrap:anywhere}
.foot{flex:none;padding:calc(var(--u)*4) calc(var(--u)*8) calc(var(--u)*${status ? 7 : 4.5});display:grid;gap:calc(var(--u)*2.6);border-top:calc(var(--u)*.25) solid ${pal.line}}
.row{display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*2.2);font-size:calc(var(--u)*3.6);font-weight:600;flex-wrap:wrap;text-align:center}
.row svg{width:calc(var(--u)*5);height:calc(var(--u)*5);flex:none}
.row .wa{color:#1FA855}
.bank{display:grid;grid-template-columns:auto 1fr;gap:calc(var(--u)*.6) calc(var(--u)*3);align-items:center;background:${pal.surface};border-radius:calc(var(--u)*${t.radius.card === '0px' ? 0 : 3});padding:calc(var(--u)*3) calc(var(--u)*4)}
.bank svg{grid-row:span 2;width:calc(var(--u)*6.5);height:calc(var(--u)*6.5);color:${pal.brandInk}}
.bank.big{width:100%;padding:calc(var(--u)*3.4) calc(var(--u)*5);text-align:left}.bank.big .no{font-size:calc(var(--u)*7)}.bank.big .who{font-size:calc(var(--u)*3.2)}
.bank .no{font-family:${t.mono ?? 'ui-monospace, Menlo, monospace'};font-size:calc(var(--u)*5.4);font-weight:700;letter-spacing:.04em;line-height:1.1}
.bank .who{font-size:calc(var(--u)*2.8);color:${pal.muted}}
.fine{text-align:center;font-size:calc(var(--u)*1.9);color:${pal.muted};opacity:.8}`;
  const fitJs = `function fitText(){document.querySelectorAll('[data-fit]').forEach(function(e){var max=+e.getAttribute('data-fit'),cs=getComputedStyle(e),fs=parseFloat(cs.fontSize);for(var i=0;i<40;i++){var lh=parseFloat(getComputedStyle(e).lineHeight)||fs*1.05;if(e.scrollHeight<=lh*max+2&&e.scrollWidth<=e.clientWidth+1)break;fs*=.95;e.style.fontSize=fs+'px'}})}
${fit ? `function scale(){var s=document.querySelector('.sheet'),k=Math.min((innerWidth-32)/${w},(innerHeight-32)/${h});s.style.transform='scale('+k+')';s.style.margin=(${h}*(k-1)/2)+'px '+(${w}*(k-1)/2)+'px'}addEventListener('resize',scale);scale();` : ''}
// the code shrinks (never below a third of the width) until the footer is on the sheet
function fitQr(){var sh=document.querySelector('.sheet'),q=document.querySelector('.qr'),f=document.querySelector('.foot');for(var i=0;i<30;i++){if(f.offsetTop+f.offsetHeight<=sh.clientHeight)break;var w=q.offsetWidth*.95;if(w<${w}*.33)break;q.style.width=w+'px'}}
function done(){fitText();fitQr();window.POSTER_READY=true}
(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(done);setTimeout(done,4000);`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(f.name)} · QR poster</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${t.fonts}&display=block">
<style>${css}</style></head><body><div class="sheet">
<div class="top">${img ? `<img class="ph" src="${img}" alt=""><div class="scrim"></div>` : `<span class="mono" aria-hidden="true">${esc(initial)}</span>`}
<div class="brand">${logo ? `<img src="${logo}" alt="">` : ''}<p class="name" data-fit="2">${esc(f.name)}</p></div>${WHERE(f) ? `<p class="where">${esc(WHERE(f))}</p>` : ''}</div>
<div class="body"><h1 data-fit="${status ? 3 : 2}">${esc(headline)}</h1>${tg.id === 'pay' && f.bank ? `<div class="bank big">${ICON.bank}<span class="no">${esc(f.bank.accountNumber.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3'))}</span><span class="who">${esc(f.bank.accountName)} · ${esc(f.bank.bank)}</span></div>` : ''}<div class="qr">${qr}<span class="tag">Scan me</span></div><p class="sub">${esc(sub)}</p>${tg.id !== 'whatsapp' && tg.id !== 'pay' ? `<p class="short">${esc(short)}</p>` : ''}</div>
<div class="foot">${chat && tg.id !== 'whatsapp' ? `<p class="row"><span class="wa">${ICON.whatsapp}</span><span>WhatsApp ${esc(prettyPhone(chat, f.country))}</span></p>` : ''}${f.address && tg.id === 'whatsapp' ? `<p class="row">${ICON.pin}<span>${esc(f.address)}</span></p>` : ''}${showBank && f.bank ? `<div class="bank">${ICON.bank}<span class="no">${esc(f.bank.accountNumber.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3'))}</span><span class="who">${esc(f.bank.accountName)} · ${esc(f.bank.bank)}</span></div>` : ''}<p class="fine">Scan with your phone camera · no app needed</p></div>
</div><script>${fitJs}</script></body></html>`;
  return { html, w, h, format, target: tg.id };
}

// ---------------------------------------------------------------- scans of the site's QR codes

const statsFile = (slug: string) => { const d = join(DATA_DIR, 'site-stats'); mkdirSync(d, { recursive: true }); return join(d, `${slug}.json`); };
const lagosDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** One scan of a site's QR code (a visit with ?src=qr), counted per Lagos day; the last 120 days are kept. */
export function countScan(slug: string) {
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return;
  const f = statsFile(slug);
  let st: { qr: Record<string, number> } = { qr: {} };
  try { if (existsSync(f)) st = JSON.parse(readFileSync(f, 'utf8')); } catch { /* start again */ }
  const d = lagosDay();
  st.qr[d] = (st.qr[d] ?? 0) + 1;
  st.qr = Object.fromEntries(Object.entries(st.qr).sort().slice(-120));
  writeFileSync(f, JSON.stringify(st));
}
export function scanStats(slug: string): { total: number; week: number; today: number } {
  try {
    const st = JSON.parse(readFileSync(statsFile(slug), 'utf8')) as { qr: Record<string, number> };
    const since = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10), d = lagosDay();
    const e = Object.entries(st.qr ?? {});
    return { total: e.reduce((a, [, n]) => a + n, 0), week: e.filter(([k]) => k >= since).reduce((a, [, n]) => a + n, 0), today: st.qr?.[d] ?? 0 };
  } catch { return { total: 0, week: 0, today: 0 }; }
}

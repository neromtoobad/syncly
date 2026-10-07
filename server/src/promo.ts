// The promo style of Motion Ad: full-frame scenes from designed templates (assets/promo), filled from a
// storyboard the Producer writes as JSON. The model chooses the order, the words, the colours and which photo
// goes where; the templates own the layout, so text is always big, inside the frame and readable. This module
// prepares the photos, cleans the storyboard (lengths, timing on the beat, a hook first and the call to action
// last, only photos that exist) and writes the scene page the renderer plays.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpeg } from './media.ts';
import { DATA_DIR } from './config.ts';

const KIT = new URL('../assets/promo/', import.meta.url).pathname;
const REEL = new URL('../assets/reel/', import.meta.url).pathname;

export const FONTS = {
  bold: { display: 'Bricolage Grotesque', body: 'Geist', css: 'family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Geist:wght@500;600;700' },
  modern: { display: 'Sora', body: 'Sora', css: 'family=Sora:wght@500;600;700;800' },
  premium: { display: 'Fraunces', body: 'Geist', css: 'family=Fraunces:opsz,wght@9..144,700;9..144,800&family=Geist:wght@500;600;700' },
  playful: { display: 'Baloo 2', body: 'Nunito', css: 'family=Baloo+2:wght@700;800&family=Nunito:wght@600;700;800' },
} as const;
export type FontKey = keyof typeof FONTS;

export type Scene =
  | { type: 'hook'; eyebrow?: string; lines: string[]; tone?: 'accent' | 'dark' }
  | { type: 'product'; photo: string; tag?: string; title: string; price?: string }
  | { type: 'showcase'; photo: string; tag?: string; title: string; note?: string; price?: string }
  | { type: 'grid'; photos: string[]; title: string; items?: string[] }
  | { type: 'list'; title: string; items: string[] }
  | { type: 'points'; title: string; points: string[]; photo?: string }
  | { type: 'statement'; text: string; tone?: 'dark' | 'accent' | 'light' }
  | { type: 'price'; label?: string; price: string; note?: string }
  | { type: 'cta'; headline?: string; action: string; sub?: string; brand?: string };
export type Storyboard = { font?: FontKey; palette?: { accent?: string; dark?: string; light?: string }; scenes: (Scene & { dur?: number })[] };
export type Photo = { name: string; about: string; cut: boolean };

// How long each kind of scene wants, in seconds, before scaling to the ad's length.
const WANT: Record<Scene['type'], number> = { hook: 2.5, product: 3, showcase: 3, grid: 3.5, list: 3, points: 3.5, statement: 2, price: 2.5, cta: 4 };
const cap = (s: unknown, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };
const HEX = /^#[0-9a-f]{6}$/i;

/** A cut-out (transparent) or a shot on a white background: a product picture rather than a scene. */
async function isCutout(buf: Buffer): Promise<boolean> {
  const raw = await ffmpeg({ in: buf }, (f, o) => ['-i', f.in, '-vf', 'scale=32:32,format=rgba', '-f', 'rawvideo', o], 'raw');
  let plain = 0;
  for (const [x, y] of [[0, 0], [31, 0], [0, 31], [31, 31], [16, 0], [0, 16], [31, 16], [16, 31]]) {
    const i = (y * 32 + x) * 4;
    if (raw[i + 3] < 30 || (raw[i] > 232 && raw[i + 1] > 232 && raw[i + 2] > 232)) plain++;
  }
  return plain >= 6;
}

/** A QR code, barcode or flat black-and-white graphic rather than a picture of something: almost every pixel is
 *  near black or near white and there's no colour. Kept out of ads. */
export async function looksLikeCode(buf: Buffer): Promise<boolean> {
  const raw = await ffmpeg({ in: buf }, (f, o) => ['-i', f.in, '-vf', 'scale=48:48,format=rgba', '-f', 'rawvideo', o], 'raw');
  let bw = 0, black = 0, colour = 0, n = 0;
  for (let i = 0; i < raw.length; i += 4) {
    if (raw[i + 3] < 30) continue;
    n++;
    const r = raw[i], g = raw[i + 1], b = raw[i + 2], hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi - lo > 40) colour++;
    if (hi < 60) { bw++; black++; } else if (lo > 200) bw++;
  }
  return n > 0 && bw / n > 0.8 && black / n > 0.15 && colour / n < 0.05;
}

/** Photos for the scene folder: cut-outs stay PNG (transparency), the rest become JPEGs; logos are kept small. */
export async function preparePhoto(buf: Buffer, name: string, about: string, maxW = 1400): Promise<{ photo: Photo; file: { name: string; buf: Buffer } }> {
  const cut = await isCutout(buf).catch(() => false);
  const fname = `${name}.${cut ? 'png' : 'jpg'}`;
  const out = cut
    ? await ffmpeg({ in: buf }, (f, o) => ['-i', f.in, '-vf', `scale='min(${maxW},iw)':-2:flags=lanczos,format=rgba`, '-frames:v', '1', o], 'png')
    : await ffmpeg({ in: buf }, (f, o) => ['-i', f.in, '-vf', `scale='min(${maxW},iw)':-2:flags=lanczos,format=yuvj420p`, '-q:v', '3', '-frames:v', '1', o], 'jpg');
  return { photo: { name: fname, about, cut }, file: { name: fname, buf: out } };
}

/** Make a storyboard safe to render: known scene types, short copy, real photos, a hook first, the CTA last,
 *  every cut on a beat (0.5 s at 120 BPM) and the lengths adding up to exactly `seconds`. */
export function cleanStoryboard(sb: Storyboard, o: { seconds: number; photos: Photo[]; cta: string; business: string; brandColour?: string; beat?: number }): Storyboard & { scenes: (Scene & { dur: number })[] } {
  // a photo reference counts if it names a file we have, with or without the extension, in any case, or by its number
  const stem = (x: string) => x.toLowerCase().replace(/\.(png|jpe?g|webp)$/, '').replace(/[\s_]+/g, '-');
  const byStem = new Map(o.photos.map((p) => [stem(p.name), p.name]));
  const pic = (p: unknown): string | undefined => {
    if (typeof p !== 'string' || !p.trim()) return undefined;
    const k = stem(p.trim());
    return byStem.get(k) ?? byStem.get(k.replace(/^(photo|site|image|picture)-?(\d+)$/, (_, a, n) => `${a === 'site' ? 'site' : 'photo'}-${n}`)) ?? undefined;
  };
  const out: Scene[] = [];
  for (const raw of (Array.isArray(sb?.scenes) ? sb.scenes : []).slice(0, 8) as any[]) {
    switch (raw?.type) {
      case 'hook': { const lines = (Array.isArray(raw.lines) ? raw.lines : [raw.text]).map((l: unknown) => cap(l, 22)).filter(Boolean).slice(0, 3); if (lines.length) out.push({ type: 'hook', eyebrow: cap(raw.eyebrow, 28) || undefined, lines, tone: raw.tone === 'dark' ? 'dark' : 'accent' }); break; }
      case 'product': case 'showcase': {
        const photo = pic(raw.photo), title = cap(raw.title, 34);
        if (!title) break;
        if (!photo) { out.push({ type: 'statement', text: title, tone: 'light' }); break; }
        out.push(raw.type === 'product' ? { type: 'product', photo, tag: cap(raw.tag, 26) || undefined, title, price: cap(raw.price, 18) || undefined } : { type: 'showcase', photo, tag: cap(raw.tag, 26) || undefined, title, note: cap(raw.note, 90) || undefined, price: cap(raw.price, 18) || undefined });
        break;
      }
      case 'grid': { const photos = (Array.isArray(raw.photos) ? raw.photos : []).map(pic).filter(Boolean) as string[]; const title = cap(raw.title, 30); if (photos.length >= 2 && title) out.push({ type: 'grid', photos: photos.slice(0, 4), title, items: (raw.items ?? []).map((x: unknown) => cap(x, 18)).filter(Boolean).slice(0, 6) }); else if (title && raw.items?.length) out.push({ type: 'list', title, items: raw.items.map((x: unknown) => cap(x, 30)).filter(Boolean).slice(0, 5) }); break; }
      case 'list': { const items = (raw.items ?? []).map((x: unknown) => cap(x, 30)).filter(Boolean).slice(0, 5); if (items.length >= 2) out.push({ type: 'list', title: cap(raw.title, 30), items }); break; }
      case 'points': { const points = (raw.points ?? []).map((x: unknown) => cap(x, 32)).filter(Boolean).slice(0, 4); if (points.length >= 2) out.push({ type: 'points', title: cap(raw.title, 30), points, photo: pic(raw.photo) }); break; }
      case 'statement': { const text = cap(raw.text, 40); if (text) out.push({ type: 'statement', text, tone: ['dark', 'accent', 'light'].includes(raw.tone) ? raw.tone : 'dark' }); break; }
      case 'price': { const price = cap(raw.price, 16); if (price) out.push({ type: 'price', label: cap(raw.label, 32) || undefined, price, note: cap(raw.note, 40) || undefined }); break; }
      case 'cta': break; // the call to action is set from the order below, never invented
    }
  }
  if (out[0]?.type !== 'hook') out.unshift({ type: 'hook', lines: [cap(o.business, 22)], eyebrow: undefined, tone: 'accent' });
  // pictures sell: with photos to hand, at least three scenes (or one per photo) show them. Text-only scenes after the
  // hook become product scenes with the best unused photos (product cut-outs first), keeping their words.
  const used = () => new Set(out.flatMap((x: any) => [x.photo, ...(x.photos ?? [])].filter(Boolean)));
  const wantPhotos = Math.min(3, o.photos.length);
  const photoScenes = () => out.filter((x: any) => x.photo || x.photos?.length).length;
  const ranked = [...o.photos].sort((a, b) => Number(b.cut) - Number(a.cut));
  for (let i = 1; i < out.length && photoScenes() < wantPhotos; i++) {
    const x = out[i] as any;
    if (x.photo || x.photos || x.type === 'points' || x.type === 'price') continue;
    const free = ranked.find((p) => !used().has(p.name));
    if (!free) break;
    const words = x.type === 'statement' ? x.text : x.type === 'list' ? x.title : '';
    if (!words) continue;
    out[i] = i % 2 ? { type: 'product', photo: free.name, title: cap(words, 34), tag: x.type === 'list' ? cap(x.items?.[0], 26) || undefined : undefined } : { type: 'showcase', photo: free.name, title: cap(words, 34), note: x.type === 'list' ? cap((x.items ?? []).join(' · '), 90) || undefined : undefined };
  }
  // still short (every scene was points or a price): add product scenes before the call to action
  while (photoScenes() < wantPhotos) {
    const free = ranked.find((p) => !used().has(p.name));
    if (!free) break;
    out.splice(Math.max(1, out.length), 0, { type: 'product', photo: free.name, title: cap(free.about.replace(/^(their own photo \d+|from their website: |a picture from their website)/i, '').trim() || o.business, 34) });
  }
  const pts = out.find((x) => x.type === 'points') as any;
  if (pts && !pts.photo) { const free = ranked.find((p) => !p.cut && !used().has(p.name)) ?? ranked.find((p) => !used().has(p.name)); if (free) pts.photo = free.name; }
  const ctaIn = (sb?.scenes ?? []).find((x: any) => x?.type === 'cta') as any;
  out.push({ type: 'cta', headline: cap(ctaIn?.headline, 30) || undefined, action: cap(o.cta || ctaIn?.action || `Visit ${o.business}`, 46), sub: cap(ctaIn?.sub, 44) || undefined, brand: cap(o.business, 30) });
  // trim to fit: about 2.5 s a scene at least
  while (out.length > Math.max(3, Math.floor(o.seconds / 2.5))) out.splice(out.length - 2, 1);

  // lengths: what each scene wants, scaled to the ad, every cut on the music's beat (whole bars in all), the
  // remainder on the call to action
  const beat = o.beat ?? 0.5, unit = beat >= 0.6 ? beat : beat * 2;
  const total = Math.max(4, Math.round(o.seconds / (4 * beat))) * 4 * beat;
  const q = (x: number) => Math.round(x / unit) * unit, minD = Math.ceil(1.5 / unit) * unit;
  const want = out.map((s) => WANT[s.type]), sum = want.reduce((a, b) => a + b, 0);
  const durs = want.map((w) => Math.max(minD, q((w * total) / sum)));
  durs[durs.length - 1] = total - durs.slice(0, -1).reduce((a, b) => a + b, 0);
  const minLast = Math.ceil(2.5 / unit) * unit;
  if (durs[durs.length - 1] < minLast) { let need = minLast - durs[durs.length - 1]; durs[durs.length - 1] = minLast; for (let i = durs.length - 2; i >= 0 && need > 1e-6; i--) { const take = Math.min(need, Math.max(0, durs[i] - minD)); durs[i] -= take; need -= take; } }

  const pal = sb?.palette ?? {};
  return {
    font: sb?.font && sb.font in FONTS ? sb.font : 'bold',
    palette: { accent: HEX.test(pal.accent ?? '') ? pal.accent : HEX.test(o.brandColour ?? '') ? o.brandColour : '#f2b705', dark: HEX.test(pal.dark ?? '') ? pal.dark : '#141414', light: HEX.test(pal.light ?? '') ? pal.light : '#f7f3ea' },
    scenes: out.map((s, i) => ({ ...s, dur: durs[i] })),
  };
}

// The soundtrack changes from ad to ad: eight styles (harmony, arpeggio, instruments, groove, swing), each in a random
// key, never one of the last few used. The tempo stays at 120 BPM so every cut lands on the beat; the groove changes the feel.
export const MUSIC = {
  sunny: { label: 'Sunny Afro', prog: ['F', 'G', 'C', 'Am'], style: { arp: 'skip', pluck: 'marimba', pad: 'warm', drums: 'afro', swing: 0.12 }, mood: /warm|playful|fun|food|happy|cheer/ },
  highlife: { label: 'Highlife', prog: ['C', 'F', 'G', 'C'], style: { arp: 'call', pluck: 'marimba', pad: 'organ', drums: 'afro', swing: 0.18 }, mood: /warm|playful|party|food|lively|festive/ },
  logdrum: { label: 'Log Drum', prog: ['Am', 'Dm', 'G', 'C'], style: { arp: 'skip', pluck: 'keys', pad: 'warm', drums: 'piano', swing: 0.1 }, mood: /bold|street|fashion|young|night|party|cool/ },
  night: { label: 'Night Drive', prog: ['Am', 'F', 'C', 'G'], style: { arp: 'up', pluck: 'bright', pad: 'saw', drums: 'four' }, mood: /bold|energetic|modern|tech|fast|power/ },
  bounce: { label: 'Pop Bounce', prog: ['F', 'G', 'Em', 'Am'], style: { arp: 'classic', pluck: 'soft', pad: 'saw', drums: 'four' }, mood: /confident|bright|fresh|clean|modern/ },
  uplift: { label: 'Uplift', prog: ['C', 'G', 'Am', 'F'], style: { arp: 'up', pluck: 'soft', pad: 'saw', drums: 'half' }, mood: /hopeful|inspiring|confident|warm|friendly/ },
  gold: { label: 'Soft Gold', prog: ['C', 'Em', 'F', 'G'], style: { arp: 'sparse', pluck: 'keys', pad: 'warm', drums: 'half' }, mood: /calm|premium|elegant|soft|beauty|spa|gentle/ },
  lux: { label: 'Lux', prog: ['Dm', 'G', 'C', 'Am'], style: { arp: 'sparse', pluck: 'keys', pad: 'warm', drums: 'none' }, mood: /premium|luxury|calm|elegant|quiet/ },
} as const;
const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export type Music = { id: keyof typeof MUSIC; label: string; transpose: number; key: string };

/** A soundtrack style for this ad: suited to the mood when one fits, never one of the last three used. */
export function pickMusic(mood = ''): Music {
  const f = join(DATA_DIR, 'music-recent.json');
  let recent: string[] = [];
  try { if (existsSync(f)) recent = JSON.parse(readFileSync(f, 'utf8')); } catch { /* start fresh */ }
  const ids = Object.keys(MUSIC) as (keyof typeof MUSIC)[];
  const fresh = ids.filter((id) => !recent.slice(-3).includes(id));
  const pool = fresh.length ? fresh : ids;
  const weighted = pool.flatMap((id) => (MUSIC[id].mood.test(mood.toLowerCase()) ? [id, id, id] : [id]));
  const id = weighted[Math.floor(Math.random() * weighted.length)];
  const transpose = Math.floor(Math.random() * 10) - 4; // -4..+5 semitones: same style, a different key each time
  try { writeFileSync(f, JSON.stringify([...recent, id].slice(-8))); } catch { /* not remembering is fine */ }
  return { id, label: MUSIC[id].label, transpose, key: KEYS[(12 + transpose) % 12] };
}

/** Write the scene folder: the page, the engine, the score engine and the photos. Returns the page's path. */
export function writePromo(dir: string, sb: ReturnType<typeof cleanStoryboard>, o: { size: [number, number]; fps: number; business: string; logo?: string; photos: Photo[]; files: { name: string; buf: Buffer }[]; music?: Music; bpm?: number; score?: Record<string, unknown> }): string {
  const [W, H] = o.size, font = FONTS[(sb.font ?? 'bold') as FontKey];
  for (const f of ['promo.js', 'promo.css']) copyFileSync(join(KIT, f), join(dir, f));
  copyFileSync(join(REEL, 'score.js'), join(dir, 'score.js'));
  for (const f of o.files) writeFileSync(join(dir, f.name), f.buf);
  const ids = sb.scenes.map((_, i) => `s${i}`);
  const PROMO = {
    size: o.size, fps: o.fps, bpm: o.bpm ?? 120, palette: sb.palette, font: { display: font.display, body: font.body },
    brand: { name: o.business, logo: o.logo ?? null }, cutouts: o.photos.filter((p) => p.cut).map((p) => p.name),
    scenes: sb.scenes.map((s, i) => ({ ...s, id: ids[i] })),
    score: (() => {
      const m = MUSIC[o.music?.id ?? 'bounce'], seconds = sb.scenes.reduce((a, x) => a + x.dur, 0), bars = Math.round(seconds / ((4 * 60) / (o.bpm ?? 120)));
      return {
        prog: m.prog, style: { ...m.style, transpose: o.music?.transpose ?? 0 },
        // a quiet first bar, the groove, a fuller second half, and a last bar that eases out
        sections: [[0, 'intro'], [1, 'groove'], [Math.ceil(bars / 2), 'lift'], [Math.max(2, bars - 1), 'outro']],
        hits: [{ state: ids[0], boom: 0.4, motif: [72, 76, 79] }, { state: ids[ids.length - 1], boom: 0.5, motif: [72, 76, 79, 84] }],
        musicLevel: 1, sfxLevel: 0.8, ...(o.score ?? {}),
      };
    })(),
  };
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${o.business.replace(/</g, '')}</title>
<link href="https://fonts.googleapis.com/css2?${font.css}&display=block" rel="stylesheet">
<link rel="stylesheet" href="promo.css"><style>html,body{width:${W}px;height:${H}px}</style></head>
<body><div id="stage"></div>
<script>window.PROMO = ${JSON.stringify(PROMO).replace(/</g, '\\u003c')};</script>
<script src="score.js"></script><script src="promo.js"></script></body></html>`;
  const file = join(dir, 'index.html');
  writeFileSync(file, html);
  return file;
}

// Motion Ad: a designer-grade motion video for a small business, in the ui-motion-reel style: one
// shape that never cuts, morphing through the offer while a cursor drives every change, springs
// everywhere, and an original score synthesised from the same timeline. Researcher parses the brief →
// Reader reads the business's site → Producer (Opus 5, or Opus 4.8 when its wallet is empty) storyboards
// and codes the scene against the engine's own API and craft rules → the scene is loaded in headless
// Chrome; code checks it runs, lasts the right time and has no page errors; stills of every state go
// to a vision model → the Producer fixes what was found, once → our server renders every frame and the
// score to MP4 (free per job). Only facts from the brief and site appear on screen.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Job } from '../job.ts';
import { MODELS } from '../config.ts';
import { HOSTS, llm, parseJson, webRead, type Msg } from '../tools.ts';
import { download, ffmpeg } from '../media.ts';
import { reelAudio, reelStills, renderReel, siteImages } from '../browser.ts';
import { cleanStoryboard, looksLikeCode, pickMusic, preparePhoto, writePromo, FONTS, type Photo, type Storyboard } from '../promo.ts';
import { MUSIC_LICENSE, pickTrack, trackAudio, trackFile, trackGrid, type Track } from '../music.ts';
import { MAIL_BUDGET_USD, MAIL_HOST } from '../mail.ts';
import type { BusinessDetails } from '../details.ts';
import { readUpload } from '../uploads.ts';
import { prepPhoto } from '../site/photos.ts';
import { parseMenu } from '../site/facts.ts';

const KIT = new URL('../../assets/reel/', import.meta.url).pathname;
const kit = (f: string) => readFileSync(join(KIT, f), 'utf8');
const FORMATS = { vertical: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080] } as const;
type Format = keyof typeof FORMATS;
type Spec = { business: string; offer: string; points: string[]; prices: string[]; cta: string; palette: string; format: Format; seconds: number; website?: string; mood: string; kind?: 'app' | 'business'; area?: string };

export const motionAd = {
  id: 'motion-ad',
  name: 'Motion Ad',
  priceUsd: 2,
  policy: { budgetUsd: 2.4 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, HOSTS.blockrunArc, HOSTS.apex, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    const work = mkdtempSync(join(tmpdir(), 'syncly-reel-'));
    try {
      job.log('researcher', 'parse', 'the offer, the moments worth showing, and the format');
      const spec = parseJson<Spec>(
        await llm(job, 'researcher', [
          { role: 'system', content: 'Parse a request for a short motion ad for a small business. Reply JSON only: {"business": name, "offer": what they sell (one sentence), "points": [3-5 short selling points stated in the brief], "prices": [prices exactly as stated in the brief, else []], "cta": the call to action exactly as given (e.g. "Order on WhatsApp 0803 555 0142", "Book at site.com"), "palette": colours they asked for or their brand colours if stated, else "", "format": "vertical" (default, for Reels/TikTok/Status) | "square" | "landscape", "seconds": 16 (default; 12-24, a multiple of 2), "website": url or null, "mood": e.g. "warm and playful", "premium and calm", "kind": "app" if what they sell is software, an app or an online platform, else "business", "area": the city or area they serve if stated, else null}' },
          { role: 'user', content: brief },
        ], 'parse the ad brief', { model: MODELS.fast, maxTokens: 500, json: true,
          dry: () => JSON.stringify({ business: 'Tolu’s Small Chops', offer: 'Small chops trays for parties and offices in Lagos', points: ['Puff-puff, samosa, spring rolls, gizzard', 'Delivered hot, on time', 'Trays for 20 to 200 guests'], prices: ['₦25,000 for 20 guests'], cta: 'Order on WhatsApp 0803 555 0142', palette: 'warm red, gold and cream', format: 'landscape', seconds: 24, website: null, mood: 'warm and playful' }) }),
        { business: brief.slice(0, 40), offer: brief, points: [], prices: [], cta: '', palette: '', format: 'vertical', seconds: 16, mood: 'warm' },
      );
      // The order form's values are exact: they override what was read from the brief.
      const d = opts.details;
      if (d) {
        spec.business = d.name;
        spec.offer = d.promote ? `${d.promote} (${d.offer})` : d.offer;
        if (d.format) spec.format = d.format;
        if (d.length) spec.seconds = d.length;
        if (d.colour) spec.palette = `${d.colour} as the brand colour${spec.palette ? `; ${spec.palette}` : ''}`;
        if (d.tone) spec.mood = d.tone;
        if (d.website) spec.website = d.website;
        const menu = parseMenu(d.menu).filter((m) => m.price).slice(0, 4).map((m) => `${m.name}: ${m.price}`);
        spec.prices = [...(d.price ? [`${d.promote ?? d.offer}: ${d.price}`] : []), ...menu];
        const n = d.whatsapp ?? d.phone;
        spec.cta = d.cta === 'call' && n ? `Call ${n}` : d.cta === 'visit' && d.address ? `Visit us at ${d.address}` : d.cta === 'website' && d.website ? `Order at ${d.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : d.cta === 'dm' && d.instagram ? `DM @${d.instagram} on Instagram` : n ? `Order on WhatsApp ${n}` : spec.cta;
      }
      const format: Format = spec.format in FORMATS ? spec.format : 'vertical';
      const [W, H] = FORMATS[format];
      const seconds = Math.max(12, Math.min(24, Math.round((spec.seconds || 16) / 2) * 2));
      const fps = 30;

      let siteText = '';
      if (spec.website) {
        try {
          job.log('reader', 'read', `${spec.website} for real copy, prices and colours`);
          siteText = (await webRead(job, 'reader', [spec.website.startsWith('http') ? spec.website : `https://${spec.website}`], 'read the business\'s site'))[0]?.text.slice(0, 3000) ?? '';
        } catch (e: any) { job.log('reader', 'skip', `site unreadable (${String(e?.message ?? e).slice(0, 50)})`); }
      }

      // The owner's logo and product photos, if they uploaded any, go into the scene folder.
      const images: { name: string; about: string; buf: Buffer }[] = [];
      if (d?.logo) { const b = readUpload(d.logo); if (b) images.push({ name: 'logo.jpg', about: 'their logo', buf: (await prepPhoto(b, 480, 3)).buf }); }
      for (const [i, id] of (d?.photos ?? []).slice(0, 3).entries()) { const b = readUpload(id); if (b) images.push({ name: `photo-${i + 1}.jpg`, about: `their own product photo ${i + 1}`, buf: (await prepPhoto(b, 1200, 4)).buf }); }

      // A shop, a kitchen or a service gets the promo style: full-frame scenes from designed templates.
      // Apps and software keep the UI reel below (one shape, a cursor driving it).
      if (spec.kind !== 'app') {
        const made = await promoScene(job, { spec, brief, siteText, format, size: [W, H], seconds, fps, work, logo: d?.logo, uploads: d?.photos ?? [] });
        return await finish(job, { spec, file: made.file, size: [W, H], seconds: made.seconds, fps, work, look: made.look, scene: readFileSync(made.file, 'utf8'), what: made.what, track: made.track });
      }

      // 1. Storyboard + scene, written against the engine's real API and craft rules
      const zoomHint = format === 'vertical' ? 'about min(900 / w, 1500 / h)' : format === 'square' ? 'about min(880 / w, 880 / h)' : 'about min(1500 / w, 870 / h)';
      const system = `You are a motion designer. You make product motion videos with a small engine: one HTML scene, one shape that morphs through states, a cursor that causes every change, springs everywhere, and an original score synthesised from the same timeline. Read the engine API, the craft rules and the score guide below, then write ONE complete scene file (index.html) for a ${seconds}-second ${format} ad (${W}x${H}) for a small business.
Hard requirements:
- Output only the HTML file, starting with <!doctype html>. It loads the engine with <script src="reel.js"></script><script src="score.js"></script> exactly like the template.
- Page size: set html, body to ${W}px by ${H}px, and pass size: [${W}, ${H}] to Reel.define. fps: ${fps}, duration: ${seconds}, bpm: 120.
- 5 to 7 states whose dur values add up to exactly ${seconds} (multiples of 0.5 s; the last state has dur: null and duplicates state 0 so the loop closes). Zoom each state to fill the frame: ${zoomHint}.
- The story sells the business: open on a hook, show the offer and its best points as UI moments (a menu or product card, choosing an option, a price rolling up on an odometer, a hold-to-order button, a WhatsApp/booking confirmation), end on a brand lockup with the call to action. Every state has one idea readable in 2-3 seconds; type big enough to read on a phone.
- Use ONLY facts given (business, points, prices, CTA, site text). Never invent prices, ratings, awards, stats or testimonials. If no price is given, don't show one.
- Palette: ${spec.palette || 'derive a warm, confident palette that suits the business'}; 4-5 fills. Mood: ${spec.mood}. Use the template's fonts or one Google Font pair.
- Score: set score.prog and 2 hits on the key moments; keep the mix gentle. Images: ${images.length ? `you may use these files from the scene folder by exact name: ${images.map((i) => `${i.name} (${i.about})`).join(', ')}. Put the logo in the final brand lockup; show product photos inside a card or tile with the theme radius, never stretched` : 'none; use shapes, type and the engine icons'}.
- Keep it robust: every id unique, every cursor target exists, no console errors.

=== ENGINE API ===
${kit('api.md')}

=== CRAFT RULES ===
${kit('craft.md')}

=== SCORE ===
${kit('score.md')}

=== TEMPLATE (a working 24 s landscape scene; copy its structure, not its content) ===
${kit('template.html')}`;
      const user = `Business: ${spec.business}\nOffer: ${spec.offer}\nPoints: ${spec.points.join(' | ') || '(none given)'}\nPrices: ${spec.prices.join(' | ') || '(none given; show no prices)'}\nCall to action: ${spec.cta || 'Visit us'}\nBrief: ${brief}\n${siteText ? `\nTheir site says:\n${siteText}` : ''}`;
      const dryScene = () => kit('template.html').replace('fps: 60, duration: 24', 'fps: 30, duration: 24');
      const write = (msgs: Msg[], why: string) => llm(job, 'producer', msgs, why, { model: MODELS.designer, fallback: MODELS.designerFallback, maxTokens: 20000, maxUsd: 0.8, dry: dryScene });
      const clean = (s: string) => s.replace(/^[\s\S]*?(<!doctype html|<html)/i, '$1').replace(/<\/html>[\s\S]*$/i, '</html>').trim();

      job.log('producer', 'storyboard', `${seconds} s ${format} scene with ${MODELS.designer.split('/')[1]}`);
      let scene = clean(await write([{ role: 'system', content: system }, { role: 'user', content: user }], 'storyboard and code the motion scene'));
      for (const f of ['reel.js', 'score.js']) copyFileSync(join(KIT, f), join(work, f));
      for (const im of images) writeFileSync(join(work, im.name), im.buf);
      const file = join(work, 'index.html');
      const size: [number, number] = [W, H];

      // 2. Load it, check it in code, look at every state
      const inspect = async () => {
        writeFileSync(file, scene);
        const problems: string[] = [];
        let shot: Awaited<ReturnType<typeof reelStills>> | undefined;
        try { shot = await reelStills(file, size, 'states'); }
        catch (e: any) { return { problems: [`the scene did not load: ${String(e?.message ?? e).slice(0, 200)}`], stills: [] as { t: number; png: Buffer }[] }; }
        if (shot.errors.length) problems.push(...shot.errors.slice(0, 5).map((e) => `page error: ${e.slice(0, 160)}`));
        if (Math.abs(shot.total / shot.fps - seconds) > 0.1) problems.push(`the reel lasts ${(shot.total / shot.fps).toFixed(1)} s, not ${seconds} s`);
        if (shot.stills.length < 4) problems.push(`only ${shot.stills.length} states; the ad needs 5-7`);
        const jpgs = await Promise.all(shot.stills.map((s) => ffmpeg({ 'in.png': s.png }, (f, out) => ['-i', f['in.png'], '-vf', 'scale=iw/2:-1', '-q:v', '5', out], 'jpg')));
        job.log('auditor', 'look', `reviewing ${jpgs.length} state stills with ${MODELS.vision.split('/')[1]}`);
        const v = parseJson<{ issues: string[] }>(await llm(job, 'auditor', [
          { role: 'system', content: 'You review stills (one per state, in order) of a short motion ad for a small business. List concrete problems only: text cut off, overflowing or overlapping, text too small to read on a phone, blank or near-empty states, content spilling out of the shape or off the frame, clashing or unreadable colours, a missing call to action at the end, anything that looks broken or unfinished. Reply JSON only: {"issues": [short specific strings naming the state number]} (empty if it looks professional).' },
          { role: 'user', content: [{ type: 'text', text: `${spec.business}: ${jpgs.length} states in order.` }, ...jpgs.map((j) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${j.toString('base64')}` } }))] },
        ], 'look at every state', { model: MODELS.vision, maxTokens: 700, json: true, maxUsd: 0.12, dry: () => JSON.stringify({ issues: [] }) }), { issues: [] });
        return { problems: [...problems, ...(v.issues ?? [])], stills: shot.stills };
      };
      let look = await inspect();
      if (look.problems.length) {
        job.log('producer', 'revise', `${look.problems.length} issues from the checks and the review`);
        scene = clean(await write([{ role: 'system', content: system }, { role: 'user', content: user }, { role: 'assistant', content: scene },
          { role: 'user', content: `Fix every issue below and return the full corrected index.html only.\n- ${look.problems.join('\n- ')}` }], 'fix the scene'));
        look = await inspect();
      }
      if (look.problems.some((p) => /did not load|page error/.test(p))) throw new Error(`the scene still doesn't run: ${look.problems[0]}`);

      // a licensed track near the reel's 120 BPM, nudged onto it; the synthesised score if Mixkit can't be reached
      let track: Track | undefined = pickTrack(spec.mood, 120);
      try { await trackFile(track); } catch (e: any) { job.log('producer', 'music', `the track didn't download (${String(e?.message ?? e).slice(0, 60)}); composing one instead`); track = undefined; }
      return await finish(job, { spec, file, size, seconds, fps, work, look, scene, track, tempo: 120, what: [`${look.stills.length} moments, one shape that never cuts, every change caused by a tap, a drag or a press-and-hold`] });
    } catch (e: any) {
      job.status = 'failed';
      job.error = String(e?.message ?? e);
      console.error('  ✗', job.error);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    job.save();
    return job;
  },
};

type Look = { problems: string[]; stills: { t: number; png: Buffer }[] };

/** Stills of every scene, checked in code and by a vision model for anything unreadable, cut off or broken. */
async function review(job: Job, business: string, file: string, size: [number, number], seconds: number): Promise<Look> {
  const problems: string[] = [];
  let shot: Awaited<ReturnType<typeof reelStills>> | undefined;
  try { shot = await reelStills(file, size, 'states'); }
  catch (e: any) { return { problems: [`the scene did not load: ${String(e?.message ?? e).slice(0, 200)}`], stills: [] }; }
  if (shot.errors.length) problems.push(...shot.errors.slice(0, 5).map((e) => `page error: ${e.slice(0, 160)}`));
  if (Math.abs(shot.total / shot.fps - seconds) > 0.1) problems.push(`the ad lasts ${(shot.total / shot.fps).toFixed(1)} s, not ${seconds} s`);
  const jpgs = await Promise.all(shot.stills.map((s) => ffmpeg({ 'in.png': s.png }, (f, out) => ['-i', f['in.png'], '-vf', 'scale=iw/2:-1', '-q:v', '5', out], 'jpg')));
  job.log('auditor', 'look', `reviewing ${jpgs.length} scenes with ${MODELS.vision.split('/')[1]}`);
  const v = parseJson<{ issues: string[] }>(await llm(job, 'auditor', [
    { role: 'system', content: 'You review stills (one per scene, in order) of a short motion ad for a small business. List concrete problems only: text cut off or overlapping a product, text too small to read on a phone, a photo that is the wrong one for its words (e.g. a TV under "inverters"), a blank or broken-looking scene, unreadable colour contrast, a spelling mistake, a missing call to action at the end. Reply JSON only: {"issues": [short specific strings naming the scene number]} (empty if it looks professional).' },
    { role: 'user', content: [{ type: 'text', text: `${business}: ${jpgs.length} scenes in order.` }, ...jpgs.map((j) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${j.toString('base64')}` } }))] },
  ], 'look at every scene', { model: MODELS.vision, maxTokens: 700, json: true, maxUsd: 0.12, dry: () => JSON.stringify({ issues: [] }) }), { issues: [] });
  return { problems: [...problems, ...(v.issues ?? []).map(String)], stills: shot.stills };
}

/** The promo style: gather the photos (uploads, then the business's own site), storyboard with the photos in view,
 *  render stills, let the auditor look, revise the storyboard once if needed. */
async function promoScene(job: Job, o: { spec: Spec; brief: string; siteText: string; format: Format; size: [number, number]; seconds: number; fps: number; work: string; logo?: string; uploads: string[] }) {
  const { spec } = o;
  const photos: Photo[] = [], files: { name: string; buf: Buffer }[] = [];
  let logo: string | undefined;
  if (o.logo) { const b = readUpload(o.logo); if (b) { const r = await preparePhoto(b, 'logo', 'their logo', 600); logo = r.photo.name; files.push(r.file); } }
  for (const [i, id] of o.uploads.slice(0, 4).entries()) { const b = readUpload(id); if (b) { const r = await preparePhoto(b, `photo-${i + 1}`, `their own photo ${i + 1}`); photos.push(r.photo); files.push(r.file); } }
  if (spec.website && photos.length < 5) {
    job.log('reader', 'photos', `looking for product pictures on ${spec.website}`);
    const found = await siteImages(spec.website.startsWith('http') ? spec.website : `https://${spec.website}`, 12).catch(() => []);
    // product shots beat banners: try the squarer pictures first, keep the best few, cut-outs ahead
    const order = [...found].sort((a, b) => Math.abs(Math.log(a.w / a.h)) - Math.abs(Math.log(b.w / b.h)));
    const site: { photo: Photo; file: { name: string; buf: Buffer } }[] = [];
    for (const im of order) {
      if (site.length >= 8) break;
      if (/\bqr\b|qr[-_ ]?code|app ?store|play ?store|google ?play|barcode|download the app/i.test(`${im.src} ${im.alt}`)) continue;
      try {
        const buf = await download(im.src, 8);
        if (await looksLikeCode(buf).catch(() => false)) continue; // QR codes and flat black-and-white graphics
        site.push(await preparePhoto(buf, `site-${site.length + 1}`, im.alt ? `from their website: ${im.alt}` : 'a picture from their website'));
      } catch { /* a picture that won't download is skipped */ }
    }
    site.sort((a, b) => Number(b.photo.cut) - Number(a.photo.cut));
    const take = site.slice(0, Math.max(0, 7 - photos.length));
    take.forEach((x, i) => { const name = x.photo.name.replace(/site-\d+/, `site-${i + 1}`); photos.push({ ...x.photo, name }); files.push({ ...x.file, name }); });
    job.log('reader', 'photos', `${photos.length} pictures to work with: ${photos.length - take.length} you sent, ${take.length} from the site (${take.filter((x) => x.photo.cut).length} product cut-outs)`);
  }
  const thumbs = await Promise.all(files.filter((f) => photos.some((p) => p.name === f.name)).map(async (f) => ({ name: f.name, jpg: await ffmpeg({ in: f.buf }, (x, out) => ['-i', x.in, '-vf', "scale=320:-2,format=yuvj420p", '-q:v', '6', '-frames:v', '1', out], 'jpg') })));

  const system = `You are the art director of a ${o.seconds}-second ${o.format} motion ad (${o.size[0]}x${o.size[1]}) for a small business. You don't write code: you write the storyboard, and designed templates lay it out. Reply JSON only:
{"font": one of ${Object.keys(FONTS).map((k) => `"${k}"`).join(', ')}, "palette": {"accent": "#hex brand colour", "dark": "#hex near-black", "light": "#hex warm off-white"}, "scenes": [ ... ]}
Scene types (pick 5 to 7; the first is a hook, the last is the cta):
- {"type":"hook","eyebrow":"business name · area","lines":["2-3 short lines","max 22 characters each"],"tone":"accent"|"dark"} a question or a promise that stops the scroll
- {"type":"product","photo":"<file>","tag":"category, max 26","title":"max 34 characters","price":"only if given"} one product, full frame
- {"type":"showcase","photo":"<file>","tag":"...","title":"max 34","note":"one sentence, max 90","price":"only if given"} a product beside its copy
- {"type":"grid","photos":["2-4 files"],"title":"max 30","items":["up to 6 short names of the range"]} the range
- {"type":"list","title":"max 30","items":["2-5 lines, max 30"]} the range without photos
- {"type":"points","title":"max 30","points":["2-4 reasons to buy, max 32 each"],"photo":"<file, optional>"}
- {"type":"statement","text":"one line, max 40","tone":"dark"|"accent"|"light"}
- {"type":"price","label":"max 32","price":"exactly as given","note":"max 40"} only for a real stated price or offer
- {"type":"cta","headline":"max 30, e.g. Order today","sub":"max 44, e.g. Delivery across Abuja & Lagos"} (the button text is added for you)
A good storyboard, for an electronics and solar shop in Abuja that sent four photos (a TV, two inverters, a rooftop solar install) and whose site lists warranty, pay on delivery and free delivery on 3+ items:
{"font":"bold","palette":{"accent":"#d4a017","dark":"#14120e","light":"#f6f1e6"},"scenes":[{"type":"hook","eyebrow":"EasyPower Hub · Abuja","lines":["Power up","your home"]},{"type":"product","photo":"photo-1.png","tag":"Smart TVs","title":"43\" QLED TVs, new 2025 models"},{"type":"showcase","photo":"photo-2.png","tag":"Solar & inverters","title":"Hybrid inverters","note":"Premium solar and smart home systems, installed for you."},{"type":"grid","photos":["photo-1.png","photo-2.png","photo-3.png","photo-4.jpg"],"title":"And so much more","items":["Fans","Fridges","Stabilizers","Gas burners","Irons"]},{"type":"points","title":"Why EasyPower","points":["Warranty on all products","Pay on delivery","Free delivery on 3+ items"],"photo":"photo-4.jpg"},{"type":"cta","headline":"Order today","sub":"Delivery across Abuja & Lagos"}]}
Why it works: a short hook that names the benefit, the strongest product first and full frame, every title says what the photo shows, the range in one grid, three concrete reasons taken from the site, and a calm end card. Write yours for this business in the same spirit; don't copy its words.
Photos: refer to them by the exact file name given (e.g. "site-2.png"). With 3 or more photos, at least 3 scenes must show one (product, showcase, grid or points with a photo): people buy what they can see.
Rules: use ONLY facts in the brief and the site text; never invent prices, discounts, ratings, stats or testimonials. Put each photo with words that describe what is IN it (look at the pictures); never caption a photo with a product it doesn't show. Prefer product and showcase scenes for the best photos. Short, concrete, confident copy in plain English a Nigerian shopper would say. Palette: ${spec.palette || 'from the brand colours, if stated; else confident colours that suit the business'}; the accent must read well with dark text on it. Mood: ${spec.mood}.`;
  const user: Msg = { role: 'user', content: [
    { type: 'text', text: `Business: ${spec.business}\nOffer: ${spec.offer}\nSelling points: ${spec.points.join(' | ') || '(none given)'}\nPrices: ${spec.prices.join(' | ') || '(none given: show no prices)'}\nArea: ${spec.area ?? '(not stated)'}\nCall to action (the button): ${spec.cta || 'Visit us'}\nBrief: ${o.brief}${o.siteText ? `\n\nTheir site says:\n${o.siteText}` : ''}\n\nPhotos you can use (by file name):${photos.length ? photos.map((p) => `\n- ${p.name}: ${p.about}${p.cut ? ' (a cut-out product shot)' : ''}`).join('') : ' none: use hook, list, points, statement and cta scenes only'}` },
    ...thumbs.flatMap((t) => [{ type: 'text' as const, text: t.name }, { type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${t.jpg.toString('base64')}` } }]),
  ] };
  const dryBoard = (): string => JSON.stringify({ font: 'bold', palette: { accent: '#f2b705', dark: '#151310', light: '#f7f3ea' }, scenes: [{ type: 'hook', eyebrow: spec.business, lines: ['Hungry?', 'We deliver'] }, ...(photos[0] ? [{ type: 'product', photo: photos[0].name, tag: 'Bestseller', title: spec.offer.slice(0, 30) }] : []), { type: 'points', title: 'Why us', points: spec.points.slice(0, 3).length >= 2 ? spec.points.slice(0, 3) : ['Fresh every day', 'Fast delivery'] }, { type: 'cta', headline: 'Order today' }] });
  const board = (msgs: Msg[], why: string) => llm(job, 'producer', msgs, why, { model: MODELS.maker, maxTokens: 1600, json: true, maxUsd: 0.12, dry: dryBoard });
  // the music comes first: the scenes are cut on its beat
  let track: Track | undefined = pickTrack(spec.mood);
  let grid: { bpm: number; start: number } | undefined;
  try { grid = await trackGrid(track); job.log('producer', 'music', `"${track.title}" by ${track.author} (${Math.round(grid.bpm)} BPM): every cut lands on its beat`); }
  catch (e: any) { job.log('producer', 'music', `the track didn't download (${String(e?.message ?? e).slice(0, 60)}); composing one instead`); track = undefined; }
  const music = track ? undefined : pickMusic(spec.mood);
  const opts = { seconds: o.seconds, photos, cta: spec.cta, business: spec.business, brandColour: (spec.palette.match(/#[0-9a-f]{6}/i) ?? [])[0], beat: 60 / (grid?.bpm ?? 120) };
  const bpm = grid?.bpm ?? 120;

  job.log('producer', 'storyboard', `${o.seconds} s ${o.format}: scenes, words and photos, with the pictures in view`);
  let raw = await board([{ role: 'system', content: system }, user], 'storyboard the ad');
  let sb = cleanStoryboard(parseJson<Storyboard>(raw, { scenes: [] }), opts);
  const total = () => Math.round(sb.scenes.reduce((a, x) => a + x.dur, 0) * 1000) / 1000;
  const file = writePromo(o.work, sb, { size: o.size, fps: o.fps, business: spec.business, logo, photos, files, music, bpm });
  let look = await review(job, spec.business, file, o.size, total());
  if (look.problems.length) {
    job.log('producer', 'revise', `${look.problems.length} notes from the review`);
    raw = await board([{ role: 'system', content: system }, user, { role: 'assistant', content: raw }, { role: 'user', content: `The auditor looked at a still of every scene. Fix every note below and return the full corrected storyboard JSON only.\n- ${look.problems.join('\n- ')}` }], 'revise the storyboard');
    sb = cleanStoryboard(parseJson<Storyboard>(raw, { scenes: [] }), opts);
    writePromo(o.work, sb, { size: o.size, fps: o.fps, business: spec.business, logo, photos, files, music, bpm });
    look = await review(job, spec.business, file, o.size, total());
  }
  if (look.problems.some((p) => /did not load|page error/.test(p))) throw new Error(`the scene doesn't run: ${look.problems[0]}`);
  const kinds = sb.scenes.map((x) => x.type);
  job.log('producer', 'scenes', sb.scenes.map((x: any) => `${x.type}${x.photo ? ` (${x.photo})` : x.photos ? ` (${x.photos.length} photos)` : ''}`).join(' → '));
  return { file, look, track, seconds: total(), what: [`${sb.scenes.length} full-frame scenes: ${kinds.join(', ')}, cut on the beat`, track ? `Music: "${track.title}" by ${track.author}, licensed from Mixkit: free to use on social media and in online ads, not for TV or radio` : `Music: an original "${music!.label}" track in ${music!.key}, made for this ad`, (() => { const shown = new Set(sb.scenes.flatMap((x: any) => [x.photo, ...(x.photos ?? [])].filter(Boolean))); const site = [...shown].filter((n) => String(n).startsWith('site-')).length; return shown.size ? `${shown.size} pictures on screen${site ? ` (${site} from your website)` : ''}` : 'type and colour only (send photos for product scenes)'; })()] };
}

/** Score, render, package. */
async function finish(job: Job, o: { spec: Spec; file: string; size: [number, number]; seconds: number; fps: number; work: string; look: Look; scene: string; what: string[]; track?: Track; tempo?: number }): Promise<Job> {
  const { spec, size, seconds, fps, look } = o;
  let wav: Buffer | undefined;
  if (o.track) {
    // the scene's own whooshes and impacts (no synthesised music, no pitched bells to clash with the song) under the track
    job.log('producer', 'mix', `"${o.track.title}" from its first full-strength bar, with the scene's sound design underneath`);
    const sfx = await reelAudio(o.file, size, { musicLevel: 0, hitBells: false }).catch(() => undefined);
    wav = await trackAudio(o.track, seconds, { tempo: o.tempo, sfx }).catch((e) => { job.log('producer', 'music', `mixing the track failed (${String(e?.message ?? e).slice(0, 60)}); composing one instead`); return undefined; });
  }
  if (!wav) { job.log('producer', 'score', 'synthesising the soundtrack from the timeline'); wav = await reelAudio(o.file, size); }
  job.log('producer', 'render', `${Math.round(seconds * fps)} frames at ${size[0]}x${size[1]}`);
  const out = join(o.work, 'ad.mp4');
  const r = await renderReel(o.file, size, out, { workers: 2, audio: wav, onProgress: (d, t) => { if (d % 150 === 0) job.log('producer', 'render', `${d} of ${t} frames`); } });
  const mp4 = readFileSync(out);
  if (mp4.length < 100_000) throw new Error('the render came out empty');
  const poster = await ffmpeg({ 'in.png': look.stills[Math.min(1, look.stills.length - 1)].png }, (f, p) => ['-i', f['in.png'], '-q:v', '3', p], 'jpg');
  job.files.push({ name: 'motion-ad.mp4', content: mp4 }, { name: 'poster.jpg', content: poster });
  if (!o.file.endsWith('index.html') || o.scene.includes('Reel.define')) job.files.push({ name: 'scene.html', content: o.scene });
  job.deliverable = [
    `# Motion ad: ${spec.business}`,
    `**${Math.round(seconds * 10) / 10} seconds · ${size[0]}×${size[1]} · ${fps} fps · ${o.track ? 'licensed music' : 'original soundtrack'}.** Watch it above; \`poster.jpg\` is a cover frame.`,
    `## What's in it`,
    ...o.what.map((w) => `- ${w}`),
    `- Your offer${spec.points.length ? `: ${spec.points.join('; ')}` : ''}${spec.prices.length ? `. Prices shown: ${spec.prices.join(', ')}` : ''}`,
    `- It ends on your call to action${spec.cta ? `: "${spec.cta}"` : ''}`,
    o.track ? `- Music licence: ${MUSIC_LICENSE} Our sound design sits underneath, and the mix is levelled for social` : `- The music is composed for this ad from its own timeline (no licensing), mastered for social`,
    `## Checks`,
    `- The scene ran with ${r.errors.length ? `${r.errors.length} page warnings` : 'no page errors'} and lasts exactly ${(r.frames / r.fps).toFixed(1)} s`,
    `- A vision model looked at every scene: ${look.problems.length ? `notes left: ${look.problems.join('; ')}` : 'no problems found'}`,
    `- The audio was checked by loudness normalisation, not by ear. Have a listen.`,
    `## Changes`,
    `Ask for a revision with what to change: wording, colours, which product goes first, length, or vertical, square or landscape.`,
  ].join('\n\n');
  job.qa = { verdict: look.problems.length ? 'revise' : 'pass', notes: look.problems.join(' | ') || `${look.stills.length} scenes reviewed; rendered ${r.frames} frames`, model: `rules + ${MODELS.vision}` };
  job.status = 'delivered';
  job.save();
  return job;
}

// Website: a designed site for a small business, live at hiresyncly.site/s/<name> and downloadable.
// It runs on a site engine (src/site): our code owns the design (themes, type, colour, section layouts),
// and the model only fills a plan. Researcher parses the brief → Scout finds the Google listing and real
// reviews → Reader reads their site and Instagram (their own photos and prices) → Analyst pulls out the
// items and prices with the exact words they came from, and a vision model sorts the photos (flyers and
// text-heavy images are never used) → colours come from their photos → Designer (Opus 5, or Opus 4.8)
// writes the plan → code checks the copy for invented numbers and filler, renders the page, and a vision
// model reviews it on a phone and a laptop → the Designer fixes the plan once → Lighthouse on the live page.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Job } from '../job.ts';
import { DATA_DIR, DRY, MODELS } from '../config.ts';
import { HOSTS, llm, mapsSearch, parseJson, webRead, type Place } from '../tools.ts';
import { AISA, aisa, dataforseo, ortho } from '../sellers.ts';
import { download, ffmpeg, image } from '../media.ts';
import { screenshots } from '../browser.ts';
import { zip } from '../zip.ts';
import { MAIL_BUDGET_USD, MAIL_HOST, PUBLIC_URL } from '../mail.ts';
import { norm, parseHours, parseMenu, type Facts, type Item, type Kind, type Photo, type Review } from '../site/facts.ts';
import { prepPhoto } from '../site/photos.ts';
import { brandCandidates } from '../site/color.ts';
import { CATALOGUE, LIMITS, RECIPES, defaultPlan, validatePlan, type Plan } from '../site/plan.ts';
import { copyIssues } from '../site/checks.ts';
import { renderSite } from '../site/engine.ts';
import { THEMES, themeMenu, type ThemeId } from '../site/themes.ts';
import { readUpload } from '../uploads.ts';
import type { BusinessDetails } from '../details.ts';
import { e164 } from '../site/facts.ts';
import { chowdeckHours, classify, cleanUrl, readChowdeck, type ChowdeckStore, type Links } from '../site/links.ts';
import { keepSource } from '../site/edit.ts';

type Spec = { business: string; kind: Kind; category: string; offer: string; area?: string; city?: string; country: string; phone?: string; whatsapp?: string; email?: string; instagram?: string; website?: string; look?: string; mapsQuery: string };

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'site';
const handle = (h?: string) => h?.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '').trim() || undefined;
const KINDS: Kind[] = ['food', 'beauty', 'creative', 'health', 'retail', 'professional', 'events', 'other'];

async function thumb(buf: Buffer): Promise<string> {
  const j = await ffmpeg({ in: buf }, (f, o) => ['-i', f.in, '-vf', "scale='min(512,iw)':-2", '-q:v', '6', '-frames:v', '1', o], 'jpg');
  return `data:image/jpeg;base64,${j.toString('base64')}`;
}
async function toJpeg(png: Buffer, maxH: number): Promise<Buffer> {
  return ffmpeg({ 'in.png': png }, (f, out) => ['-i', f['in.png'], '-vf', `crop=iw:min(ih\\,${maxH}):0:0`, '-q:v', '4', out], 'jpg');
}

export const website = {
  id: 'website',
  name: 'Website',
  priceUsd: 2,
  policy: { budgetUsd: 2.2 + MAIL_BUDGET_USD, allowHosts: [HOSTS.blockrun, HOSTS.blockrunArc, HOSTS.orthogonal, HOSTS.apex, AISA, ...(MAIL_HOST ? [MAIL_HOST] : [])] },

  async run(brief: string, opts: { orderId?: string; details?: BusinessDetails } = {}): Promise<Job> {
    const job = new Job(this.id, brief, this.policy, opts.orderId);
    const sources: string[] = [`Owner's brief: ${brief}`];
    try {
      // 1. The brief: the order form's details when there are some, otherwise read from the text
      const d = opts.details;
      const fromMaps = (u?: string) => { try { return u ? decodeURIComponent(new URL(u).pathname.match(/\/place\/([^/]+)/)?.[1] ?? '').replace(/\+/g, ' ') || undefined : undefined; } catch { return undefined; } };
      job.log('researcher', 'parse', d ? 'the business details from the order form' : 'the business, its kind, and how customers reach it');
      const spec = d ? {
        business: d.name, kind: d.kind, category: '', offer: d.offer, area: d.area, city: d.city,
        country: (() => { const n = e164(d.whatsapp ?? d.phone, 'NG'); return !n || n.startsWith('234') ? 'NG' : n.startsWith('233') ? 'GH' : n.startsWith('254') ? 'KE' : n.startsWith('27') ? 'ZA' : n.startsWith('44') ? 'GB' : n.startsWith('1') ? 'US' : 'NG'; })(),
        phone: d.phone ?? d.whatsapp, whatsapp: d.whatsapp ?? d.phone, email: d.email, instagram: d.instagram, website: d.website,
        look: [d.style && d.style !== 'auto' ? `the ${d.style} theme` : '', d.notes ?? ''].filter(Boolean).join('; ') || undefined,
        mapsQuery: fromMaps(d.maps) ?? [d.name, d.area, d.city].filter(Boolean).join(' '),
      } as Spec : parseJson<Spec>(
        await llm(job, 'researcher', [
          { role: 'system', content: `Parse a request for a small-business website. Reply JSON only: {"business": name exactly as given, "kind": one of ${KINDS.join('|')}, "category": short category like "Caterer" or "Hair salon", "offer": what they sell in one plain sentence, "area": neighbourhood or null, "city": city or null, "country": ISO-2 code (default "NG"), "phone": as given or null, "whatsapp": as given or null, "email": or null, "instagram": handle or null, "website": existing site URL or null, "look": any look they asked for or null, "mapsQuery": a Google Maps search that finds this exact business ("name area city")}` },
          { role: 'user', content: brief },
        ], 'parse the site brief', { model: MODELS.fast, maxTokens: 500, json: true,
          dry: () => JSON.stringify({ business: 'Tolu’s Small Chops', kind: 'food', category: 'Caterer', offer: 'Small chops trays and party catering for events across Lagos', area: 'Surulere', city: 'Lagos', country: 'NG', phone: '0803 555 0142', whatsapp: '0803 555 0142', email: null, instagram: '@tolussmallchops', website: null, look: null, mapsQuery: 'Tolu small chops Surulere Lagos' }) }),
        { business: brief.slice(0, 50), kind: 'other', category: '', offer: brief.slice(0, 150), country: 'NG', mapsQuery: brief.slice(0, 60) },
      );
      if (!KINDS.includes(spec.kind)) spec.kind = 'other';

      // 2. The Google listing and its real reviews
      let place: Place | undefined;
      try {
        job.log('scout', 'listing', `Google listing for "${spec.mapsQuery}"`);
        const places = await mapsSearch(job, 'scout', spec.mapsQuery, `find ${spec.business} on Google Maps`);
        const words = norm(spec.business).split(' ').filter((w) => w.length > 2);
        place = places.find((p) => words.filter((w) => norm(p.title ?? '').includes(w)).length >= Math.min(2, words.length));
        if (place) sources.push(`Google listing: ${place.title}; ${place.address ?? ''}; ${place.phone ?? ''}; ${place.hours ?? ''}; rating ${place.rating ?? ''} (${place.ratingCount ?? 0}); ${place.category ?? ''}`);
        else job.log('scout', 'note', 'no Google listing matched; using the owner\'s details only');
      } catch (e: any) { job.log('scout', 'skip', `Maps lookup failed (${String(e?.message ?? e).slice(0, 50)})`); }
      const reviews: Review[] = [];
      if (place?.cid) {
        try {
          const d = await ortho<any>(job, 'serper/reviews', { body: { cid: place.cid } }, { agent: 'scout', vendor: 'Serper Reviews (Orthogonal)', reason: `real Google reviews for ${spec.business}`, expectUsd: 0.002, maxUsd: 0.005,
            dry: () => ({ reviews: [{ rating: 5, snippet: 'The small chops were still hot when they arrived and my guests finished everything before the cake came out.', user: { name: 'Adaeze Okafor' } }, { rating: 5, snippet: 'Booked for our office party with two days\' notice. Delivered on time, packed neatly. The puff-puff is elite.', user: { name: 'Kunle Bello' } }, { rating: 5, snippet: 'Fair prices and Tolu replies on WhatsApp within minutes. Our go-to for every birthday now.', user: { name: 'Ifeoma N.' } }] }) });
          for (const r of (d?.reviews ?? []).filter((r: any) => r.rating >= 4 && r.snippet && String(r.snippet).length >= 40).slice(0, 5)) {
            reviews.push({ id: `r${reviews.length + 1}`, text: String(r.snippet).trim().slice(0, 260), who: String(r.user?.name ?? 'Google reviewer').split(' ')[0], rating: r.rating });
          }
        } catch (e: any) { job.log('scout', 'skip', `reviews unavailable (${String(e?.message ?? e).slice(0, 50)})`); }
      }

      // 3. Their own words and photos
      if (spec.website) {
        try {
          job.log('reader', 'read', `their current site ${spec.website}`);
          const [pg] = await webRead(job, 'reader', [spec.website.startsWith('http') ? spec.website : `https://${spec.website}`], 'read their existing site');
          if (pg?.text) sources.push(`Their current website: ${pg.text.slice(0, 4000)}`);
        } catch (e: any) { job.log('reader', 'skip', `site unreadable (${String(e?.message ?? e).slice(0, 50)})`); }
      }
      const raw: { buf: Buffer; caption: string }[] = [];
      for (const id of d?.photos ?? []) { const b = readUpload(id); if (b) raw.push({ buf: b, caption: 'Uploaded by the owner' }); }
      if (d?.photos?.length) job.log('reader', 'photos', `${raw.length} photo${raw.length === 1 ? '' : 's'} the owner uploaded`);
      const logoBuf = d?.logo ? readUpload(d.logo) : undefined;
      const ig = handle(spec.instagram);
      if (ig) {
        try {
          job.log('reader', 'instagram', `@${ig}'s recent posts: their photos, prices and how they sell`);
          const d = await aisa<any>(job, 'instagram/user/posts', { query: { handle: ig, trim: true } }, { agent: 'reader', vendor: 'Instagram posts (AIsa)', reason: `@${ig}'s own photos and captions`,
            dry: () => ({ items: ['Party Tray (20 guests) ₦25,000: puff-puff, samosa, spring rolls, peppered gizzard', 'Party Tray (50 guests) ₦58,000. Everything in the 20, plus chicken wings and mini sausage rolls', 'Office Box (10 people) ₦15,500, individually packed, delivered before lunch', 'By the piece: Puff-puff (50 pieces) ₦6,000 · Samosa (25 pieces) ₦7,500 · Spring rolls (25 pieces) ₦7,000 · Peppered gizzard (1 litre) ₦9,000', 'Order 48 hours ahead. Delivery across Lagos Mainland and Island. Pay by transfer or POS on delivery', 'Wedding trays for 200 guests, Lekki', 'Behind the fryer at 6am', 'Weekend orders open, DM to book'].map((t, i) => ({ code: `P${i}`, display_uri: 'dry://photo', caption: { text: t } })) }) });
          const items = (d?.items ?? []).slice(0, 14);
          const caps = items.map((p: any) => String(p.caption?.text ?? '')).filter(Boolean);
          if (caps.length) sources.push(`Their Instagram captions: ${caps.map((c: string) => c.slice(0, 300)).join(' | ')}`);
          for (const p of items) {
            const url = p.display_uri ?? p.image_versions2?.candidates?.[0]?.url;
            if (!url) continue;
            try { raw.push({ buf: DRY ? (await image(job, 'illustrator', { prompt: `photo ${raw.length}`, reason: 'demo photo' })).buf : await download(url, 10), caption: String(p.caption?.text ?? '').slice(0, 120) }); }
            catch { /* expired or blocked image; skip it */ }
            if (raw.length >= 14) break;
          }
        } catch (e: any) { job.log('reader', 'skip', `Instagram unavailable (${String(e?.message ?? e).slice(0, 50)})`); }
      }

      // 3b. Where they already sell, book and get paid: links from the form, the brief and the Google listing.
      // A Chowdeck store link brings its menu, ₦ prices and hours, read in code like the owner's own price list.
      const links: Links = {};
      for (const u of [...(d?.links ?? []), spec.website, place?.website, ...brief.split(/[\s,()<>"']+/).filter((w) => /\.[a-z]{2,}\//i.test(w))]) {
        const id = classify(u ?? '');
        if (id && !links[id]) links[id] = cleanUrl(u)!;
      }
      if (Object.keys(links).length) job.log('reader', 'links', `found ${Object.keys(links).join(', ')} link${Object.keys(links).length === 1 ? '' : 's'}: wired into the site as buttons`);
      let chow: ChowdeckStore | undefined;
      if (links.chowdeck) {
        try {
          job.log('reader', 'chowdeck', 'their Chowdeck store: the menu, ₦ prices and opening hours');
          chow = await readChowdeck(links.chowdeck);
          if (chow.items.length) sources.push(`Their Chowdeck menu: ${chow.items.slice(0, 40).map((i) => `${i.name}${i.price ? ` ${i.price}` : ''}`).join(' | ')}`);
          if (chow.address || chow.phone) sources.push(`Their Chowdeck store: ${chow.address ?? ''}; ${chow.phone ?? ''}`);
          job.log('reader', 'chowdeck', `${chow.items.length} items on the menu${chow.hours?.length ? ', opening hours' : ''}`);
        } catch (e: any) { job.log('reader', 'skip', `Chowdeck page unreadable (${String(e?.message ?? e).slice(0, 60)})`); }
      }

      // 4. Items and prices, each tied to the words it came from
      const sourceText = sources.join('\n');
      job.log('analyst', 'extract', 'what they sell and the prices they publish');
      const ex = parseJson<{ items: { name: string; price?: string | null; note?: string | null; category?: string | null; quote: string }[]; delivery?: string | null; payments?: string[]; landmark?: string | null }>(
        await llm(job, 'analyst', [
          { role: 'system', content: 'From the sources, list what this business sells (up to 16 items or services). For each: name, price exactly as written in the source (or null), note (a short description from the source, or null), category (a group name like "Trays" or "Haircuts", or null), and quote (the exact words in the source that mention it). Also: delivery (how they deliver, from the source, or null), payments (payment methods the source mentions), landmark (a landmark near them the source mentions, or null). Never invent anything not in the sources. Reply JSON only: {"items":[...],"delivery":...,"payments":[...],"landmark":...}' },
          { role: 'user', content: sourceText.slice(0, 12000) },
        ], 'pull out items and prices', { model: MODELS.fast, maxTokens: 2000, json: true,
          dry: () => JSON.stringify({ items: [['Party Tray (20 guests)', '₦25,000', 'Puff-puff, samosa, spring rolls, peppered gizzard', 'Trays'], ['Party Tray (50 guests)', '₦58,000', 'Everything in the 20, plus chicken wings and mini sausage rolls', 'Trays'], ['Office Box (10 people)', '₦15,500', 'Individually packed, delivered before lunch', 'Trays'], ['Puff-puff (50 pieces)', '₦6,000', null, 'By the piece'], ['Samosa (25 pieces)', '₦7,500', null, 'By the piece'], ['Spring rolls (25 pieces)', '₦7,000', null, 'By the piece'], ['Peppered gizzard (1 litre)', '₦9,000', null, 'By the piece']].map(([name, price, note, category]) => ({ name, price, note, category, quote: `${name} ${price}` })), delivery: 'Delivery across Lagos Mainland and Island', payments: ['Bank transfer', 'POS on delivery'], landmark: null }) }),
        { items: [] },
      );
      const srcNorm = norm(sourceText).replace(/\s/g, '');
      const inSources = (s?: string | null) => !!s && srcNorm.includes(norm(s).replace(/\s/g, '').replace(/^₦/, '')) ;
      const items: Item[] = [];
      // the owner's own price list comes first, read in code; the model's finds fill in the rest
      for (const it of parseMenu(d?.menu)) items.push({ ...it, id: `i${items.length + 1}` });
      const have = new Set(items.map((i) => norm(i.name)));
      for (const it of (chow?.items ?? []).slice(0, 40)) if (!have.has(norm(it.name))) { items.push({ ...it, id: `i${items.length + 1}` }); have.add(norm(it.name)); }
      for (const it of ex.items ?? []) {
        if (it?.name && have.has(norm(it.name))) continue;
        if (!it?.name) continue;
        const words = norm(it.name).split(' ').filter((w) => w.length > 2);
        if (words.length && words.filter((w) => srcNorm.includes(w)).length < Math.ceil(words.length / 2)) continue; // name not in the sources
        const price = it.price && inSources(String(it.price).replace(/[^\d.,kK]/g, '')) ? String(it.price) : undefined;
        if (it.price && !price) job.log('analyst', 'drop', `price "${it.price}" for ${it.name} isn't in the sources; not shown`);
        items.push({ id: `i${items.length + 1}`, name: it.name.slice(0, 60), price, note: it.note && inSources(it.note.split(' ').slice(0, 3).join(' ')) ? it.note.slice(0, 110) : undefined, category: it.category ?? undefined, source: it.quote?.slice(0, 160) ?? '' });
      }

      // 5. Photos: resized on our server, then sorted by a vision model
      const photos: Photo[] = [];
      const files: { name: string; buf: Buffer }[] = [];
      for (const [i, r] of raw.entries()) {
        try {
          const p = await prepPhoto(r.buf, 1800);
          const file = `photo-${i + 1}.jpg`;
          files.push({ name: file, buf: p.buf });
          photos.push({ id: `p${i + 1}`, file, w: p.w, h: p.h, kind: 'other', subject: r.caption.slice(0, 80), quality: 3 });
        } catch { /* unreadable image */ }
      }
      if (photos.length) {
        job.log('auditor', 'photos', `sorting ${photos.length} photos with ${MODELS.vision.split('/')[1]}: what each shows, and which are flyers`);
        const thumbs = await Promise.all(files.map((f) => thumb(f.buf)));
        const tags = parseJson<{ photos: { id: string; kind: Photo['kind']; subject: string; quality: number; focus?: Photo['focus'] }[] }>(await llm(job, 'auditor', [
          { role: 'system', content: 'You sort a small business\'s photos for its website. For each photo (in order, ids p1, p2, …) reply: kind (food | people | premises | product | work | flyer | logo | other; "flyer" means any image with lots of text, prices, a poster or a promo graphic), subject (what it shows, under 8 words, plain), quality (1 = blurry/dark/cluttered … 5 = sharp, well lit, appetising or striking), focus (where the main subject sits: center | top | bottom | left | right). Reply JSON only: {"photos":[{"id","kind","subject","quality","focus"}]}' },
          { role: 'user', content: [{ type: 'text', text: `${photos.length} photos from ${spec.business} (${spec.category}).` }, ...thumbs.map((u) => ({ type: 'image_url' as const, image_url: { url: u } }))] },
        ], 'sort the photos', { model: MODELS.vision, maxTokens: 1200, json: true, maxUsd: 0.12,
          dry: () => JSON.stringify({ photos: photos.map((p, i) => ({ id: p.id, kind: i === 3 ? 'flyer' : 'food', subject: ['A full party tray', 'Puff-puff close up', 'Samosas on a tray', 'A price list flyer', 'Packed office boxes', 'Spring rolls frying', 'A wedding buffet table', 'Peppered gizzard in a bowl'][i % 8], quality: [5, 4, 4, 2, 4, 3, 5, 4][i % 8], focus: 'center' })) }) }), { photos: [] });
        for (const t of tags.photos ?? []) { const p = photos.find((x) => x.id === t.id); if (p) Object.assign(p, { kind: t.kind ?? p.kind, subject: (t.subject ?? p.subject).slice(0, 80), quality: Math.max(1, Math.min(5, Number(t.quality) || 3)), focus: t.focus }); }
        const flyers = photos.filter((p) => p.kind === 'flyer').length;
        if (flyers) job.log('auditor', 'photos', `${flyers} flyer${flyers === 1 ? '' : 's'} set aside (text-heavy images are never used as photos)`);
      }
      let logoFile: string | undefined;
      if (logoBuf) { const l = await prepPhoto(logoBuf, 320, 3); files.push({ name: 'logo.jpg', buf: l.buf }); logoFile = 'logo.jpg'; }
      const candidates = d?.colour ? [d.colour] : await brandCandidates([...(logoBuf ? [{ buf: logoBuf, logo: true }] : []), ...files.filter((f, i) => photos[i] && !['flyer', 'logo'].includes(photos[i].kind)).map((f) => ({ buf: f.buf }))]);

      const facts: Facts = {
        name: spec.business, kind: spec.kind, category: spec.category || place?.category, offer: spec.offer,
        area: spec.area ?? undefined, city: spec.city ?? undefined, country: (spec.country || 'NG').toUpperCase(),
        address: place?.address ?? chow?.address, landmark: ex.landmark ?? undefined,
        phone: spec.phone ?? place?.phone ?? chow?.phone, whatsapp: spec.whatsapp ?? spec.phone ?? undefined, email: spec.email ?? undefined,
        instagram: ig ? `@${ig}` : undefined, tiktok: d?.tiktok, facebook: d?.facebook, website: spec.website ?? undefined, mapsUrl: d?.maps, logo: logoFile,
        ...(d?.address ? { address: d.address } : {}),
        hoursText: place?.hours ?? chowdeckHours(chow), hours: parseHours(place?.hours ?? chowdeckHours(chow)), rating: place?.rating, ratingCount: place?.ratingCount,
        items, reviews, delivery: ex.delivery ?? undefined, payments: ex.payments, sources: sourceText,
        links: Object.keys(links).length ? links : undefined, bank: d?.bank,
      };
      job.log('analyst', 'facts', `${items.length} items (${items.filter((i) => i.price).length} with published prices), ${reviews.length} real reviews, ${photos.filter((p) => !['flyer', 'logo'].includes(p.kind)).length} usable photos${facts.hours ? ', opening hours' : ''}`);

      // 6. The plan (the only thing the model writes)
      const usable = photos.filter((p) => !['flyer', 'logo'].includes(p.kind));
      const system = `You are the art director for a small-business website. A site engine renders the page; you only write its plan, as JSON. You never write HTML or CSS.
Themes (pick the one that fits this business best):
${themeMenu()}
${CATALOGUE}
Suggested sections for a ${spec.kind} business, in order: ${RECIPES[spec.kind].join(', ')}. You may drop or reorder, but keep the CTA last.
Rules:
- Facts only. Prices, phone numbers, hours, addresses and reviews are rendered from the facts automatically; your copy must not contain any number the facts don't. No invented years, awards, founders, counts or claims.
- Write like the owner talking to a customer: plain, specific, warm, local. No filler ("nestled", "elevate", "in the heart of", "culinary journey", "look no further", "where X meets Y", "unforgettable"), no emoji, no exclamation marks.
- Hero headline: under ${LIMITS.headline} characters; a sharp, specific promise about what they sell (not the business name; the name is already in the header). Optionally mark 1–3 words of it as "accent" (they get the theme's accent style). Sub: one sentence on what, for whom, where.
- Photos: use photo ids only; prefer quality 4–5; the hero photo should be striking and not busy if the hero is "photo". Never use flyers.
- brand: pick one of the candidate colours taken from their photos, or one that fits the business if none fit.
Reply with JSON only: {"theme","brand","title","description","hero":{"variant","eyebrow","headline","accent","sub","photo","primary","secondary"},"sections":[...],"whatsappText"}`;
      const factsForModel = {
        name: facts.name, kind: facts.kind, category: facts.category, offer: facts.offer, area: facts.area, city: facts.city, address: facts.address, landmark: facts.landmark,
        hasPhone: !!(facts.phone ?? facts.whatsapp), hours: facts.hoursText, rating: facts.rating, ratingCount: facts.ratingCount, delivery: facts.delivery, payments: facts.payments,
        items: items.map((i) => ({ id: i.id, name: i.name, price: i.price ?? null, note: i.note ?? null, category: i.category ?? null })),
        reviews: reviews.map((r) => ({ id: r.id, text: r.text, rating: r.rating })),
      };
      const prefs = d ? [d.style && d.style !== 'auto' ? `Theme: the owner chose "${d.style}"; use it.` : '', d.colour ? `Brand colour: the owner chose ${d.colour}; use it.` : '', d.sections?.length ? `Sections: the owner wants ${d.sections.join(', ')} (plus strip and cta). Include each one the facts can support and no others.` : '', d.notes ? `Owner's notes: ${d.notes}` : '', d.story ? `About the business, in the owner's words: ${d.story}` : ''].filter(Boolean).join('\n') : '';
      const user = `${prefs ? `The owner's preferences (follow them):\n${prefs}\n\n` : ''}Facts:\n${JSON.stringify(factsForModel, null, 1)}\n\nPhotos:\n${usable.map((p) => `- ${p.id}: ${p.kind}, ${p.subject}, quality ${p.quality}, ${p.w}x${p.h}`).join('\n') || '(none usable: use the "type" hero and no gallery)'}\n\nBrand colour candidates (from their photos): ${candidates.join(', ') || 'none'}\n${spec.look ? `\nThe owner asked for: ${spec.look}` : ''}\nOwner's brief: ${brief}\n\nSource text, for tone and details:\n${sourceText.slice(0, 5000)}`;
      const fallback = defaultPlan(facts, photos, candidates);
      const planWith = async (msgs: { role: 'system' | 'user' | 'assistant'; content: string }[], why: string) => parseJson<any>(await llm(job, 'illustrator', msgs, why, { model: MODELS.designer, fallback: MODELS.designerFallback, maxTokens: 5000, maxUsd: 0.4, json: true, dry: () => JSON.stringify(fallback) }), null);
      job.log('illustrator', 'plan', `choosing the theme, sections and photos, and writing the copy (${MODELS.designer.split('/')[1]})`);
      let rawPlan = await planWith([{ role: 'system', content: system }, { role: 'user', content: user }], 'plan the site');
      if (!rawPlan) { job.log('illustrator', 'fallback', 'the plan came back unreadable; using the default plan for this kind of business'); rawPlan = fallback; }
      const prefer = (pl: Plan): Plan => {
        if (!d) return pl;
        const out = { ...pl };
        if (d.style && d.style !== 'auto' && d.style in THEMES) out.theme = d.style as ThemeId;
        if (d.colour) out.brand = d.colour;
        if (d.sections?.length) out.sections = out.sections.filter((x) => x.kind === 'strip' || x.kind === 'cta' || d.sections!.includes(x.kind));
        return out;
      };
      let { plan, notes } = validatePlan(rawPlan, facts, photos, candidates);
      plan = prefer(plan);
      let issues = copyIssues(plan, facts);

      // 7. Render, publish, look at it
      const slug = `${slugify(spec.business)}-${randomBytes(2).toString('hex')}`;
      const url = `${PUBLIC_URL}/s/${slug}`;
      const dir = join(DATA_DIR, 'sites', slug);
      let rendered = renderSite(plan, facts, photos, { url });
      const publish = () => {
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), rendered.html);
        writeFileSync(join(dir, 'llms.txt'), rendered.llms);
        writeFileSync(join(dir, 'robots.txt'), rendered.robots);
        for (const f of files) writeFileSync(join(dir, f.name), f.buf);
      };
      const review = async () => {
        const shots = await screenshots(join(dir, 'index.html'), [{ name: 'phone-top', width: 390, height: 844 }, { name: 'phone', width: 390, height: 844, full: true }, { name: 'laptop', width: 1366, height: 860, full: true }]);
        const jpg = Object.fromEntries(await Promise.all(shots.map(async (s) => [s.name, await toJpeg(s.png, s.name === 'laptop' ? 4200 : 5200)] as const)));
        job.log('auditor', 'look', `reviewing the site on a phone and a laptop with ${MODELS.vision.split('/')[1]}`);
        const v = parseJson<{ answers?: Record<string, string>; issues: string[] }>(await llm(job, 'auditor', [
          { role: 'system', content: 'You review a small-business website from three screenshots: the first screen on a phone, the full page on a phone, the full page on a laptop. Answer each question yes or no: q1 Is every piece of text easy to read (good contrast, not over a busy part of a photo)? q2 Is anything overlapping, cut off or spilling out of its box? q3 Are there empty, broken or placeholder-looking areas? q4 Does the first phone screen show what the business sells and a WhatsApp or call button? q5 Do the photos look right where they are (no awkward crops, no text-heavy flyers, no repeated photo)? q6 Does it look like a finished, premium site made for this business? Then list issues, each phrased as a change to the plan (for example "hero photo p3 is too busy for text on top: use hero variant split", "gallery uses a dark blurry photo p5: drop it", "headline wraps to 5 lines on the phone: shorten it"). Reply JSON only: {"answers":{"q1":"yes|no",…},"issues":[…]} with no issues if all answers are good.' },
          { role: 'user', content: [{ type: 'text', text: `${spec.business}: phone first screen, phone full page, laptop full page.` }, ...(['phone-top', 'phone', 'laptop'] as const).map((k) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${jpg[k].toString('base64')}` } }))] },
        ], 'look at the site on a phone and a laptop', { model: MODELS.vision, maxTokens: 900, json: true, maxUsd: 0.15, dry: () => JSON.stringify({ answers: { q1: 'yes', q2: 'yes', q3: 'yes', q4: 'yes', q5: 'yes', q6: 'yes' }, issues: [] }) }), { issues: [] });
        return { jpg, issues: v.issues ?? [] };
      };
      publish();
      let look = await review();

      // 8. One round of fixes, made in the plan only (the design system itself is never touched)
      if (issues.length || look.issues.length) {
        job.log('illustrator', 'revise', `${issues.length + look.issues.length} issues from the copy checks and the visual review`);
        const fixed = await planWith([{ role: 'system', content: system }, { role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(plan) },
          { role: 'user', content: `Fix every issue by changing the plan (theme, hero variant, photo choices, copy, section order or variants). Return the full corrected plan as JSON only.\n- ${[...issues, ...look.issues].join('\n- ')}` }], 'fix the plan');
        if (fixed) {
          ({ plan, notes } = validatePlan(fixed, facts, photos, candidates));
          plan = prefer(plan);
          issues = copyIssues(plan, facts);
          rendered = renderSite(plan, facts, photos, { url });
          publish();
          look = await review();
        }
      }

      // 9. Lighthouse on the live page (only reachable when this runs on the public server)
      let scores: Record<string, number> | undefined;
      if (!DRY) {
        try {
          job.log('auditor', 'lighthouse', `Lighthouse (mobile) on ${url}`);
          const r = await dataforseo<any>(job, 'on_page/lighthouse/live/json', { url, for_mobile: true, categories: ['performance', 'accessibility', 'best_practices', 'seo'] }, { agent: 'auditor', vendor: 'Lighthouse (DataForSEO via AIsa)', reason: 'score the live site', dry: () => [] });
          scores = Object.fromEntries(Object.entries(r?.[0]?.categories ?? {}).map(([k, v]: [string, any]) => [k, Math.round((v?.score ?? 0) * 100)]));
        } catch (e: any) { job.log('auditor', 'skip', `Lighthouse unavailable (${String(e?.message ?? e).slice(0, 60)})`); }
      }

      // 10. Deliver. The inputs are kept so the owner can edit the site later; the private edit link goes in their email only.
      keepSource({ slug, url, plan, facts, photos, candidates, orderId: job.orderId, email: spec.email ?? undefined });
      const theme = THEMES[plan.theme];
      job.files.push({ name: `${slug}.zip`, content: zip([{ name: 'index.html', data: rendered.html }, { name: 'llms.txt', data: rendered.llms }, { name: 'robots.txt', data: rendered.robots }, ...files.map((f) => ({ name: f.name, data: f.buf }))]) });
      job.files.push({ name: 'phone.jpg', content: look.jpg['phone-top'] }, { name: 'phone-full.jpg', content: look.jpg.phone }, { name: 'laptop.jpg', content: look.jpg.laptop });
      job.files.push({ name: 'index.html', content: rendered.html }, { name: 'site-plan.json', content: JSON.stringify(plan, null, 2) });
      const used = new Set([plan.hero.photo, ...plan.sections.flatMap((s) => (s.kind === 'gallery' ? s.photos : s.kind === 'offer' ? s.items.map((i) => i.photo) : s.kind === 'about' ? [s.photo] : []))].filter(Boolean));
      job.deliverable = [
        `# Your website: ${facts.name}`,
        `**Live now:** [${url.replace(/^https?:\/\//, '')}](${url})\n\nThe download (\`${slug}.zip\`) has the page, its photos and the files search engines read. It's one HTML file with no build step, so any host works, and it stays yours.`,
        `## What's on it`,
        `- **Look:** the ${theme.id} theme (${theme.mood.split(':')[0]}), in a colour taken from your own photos`,
        `- **Sections:** ${['hero', ...plan.sections.map((s) => s.kind)].join(' → ')}`,
        `- **WhatsApp everywhere:** a button on the first screen, a contact bar fixed to the bottom of every phone screen${facts.address ? ', directions to your address' : ''}${facts.hours ? ', and a live "open now" from your Google hours' : ''}`,
        `- **${items.length} items${items.some((i) => i.price) ? ` with ${items.filter((i) => i.price).length} published prices` : ''}**, ${reviews.length ? `${reviews.length} real Google reviews quoted word for word` : 'no testimonials (we only show real reviews)'}, and ${used.size} of your own photos`,
        `- **Found on Google and by AI assistants:** your business details marked up for search, plus an \`llms.txt\` summary`,
        Object.keys(links).length || facts.bank ? `- **Where you already sell:** ${[...Object.keys(links).map((k) => k[0].toUpperCase() + k.slice(1)), ...(facts.bank ? ['pay-by-transfer details with a copy button'] : [])].join(', ')}${chow?.items.length ? ` (your Chowdeck menu and prices were read straight from your store)` : ''}` : '',
        `## Checks`,
        `- **Facts:** every price, phone number, address and review on the page comes from your listing, your posts or your brief; the page can't show one that doesn't.${issues.length ? ` Open notes on the copy: ${issues.join('; ')}.` : ''}`,
        `- **Looked at on a phone and a laptop:** ${look.issues.length ? `open notes: ${look.issues.join('; ')}` : 'no problems found'}.`,
        scores ? `- **Lighthouse (mobile):** ${Object.entries(scores).map(([k, v]) => `${k.replace(/[-_]/g, ' ')} ${v}`).join(' · ')}` : '- **Lighthouse:** runs on the live page once it is published on the public server.',
        notes.length ? `- **Adjusted automatically:** ${notes.join('; ')}.` : '',
        `## Changes`,
        `**Edit it yourself, any time:** your email has a private link to your site's editor. Change prices, hours and your menu, add your Chowdeck, Glovo, Paystack or booking link and your bank details for transfers, swap photos and colours, and it's live in seconds.`,
        `Or ask for a revision on this order and say what to change. To use your own domain, point it at any static host and upload the zip.`,
      ].filter(Boolean).join('\n\n');
      job.qa = { verdict: issues.length || look.issues.length ? 'revise' : 'pass', notes: [...issues, ...look.issues].join(' | ') || `site live at /s/${slug}; ${plan.theme} theme`, model: `rules + ${MODELS.vision}` };
      job.status = 'delivered';
    } catch (e: any) {
      job.status = 'failed';
      job.error = String(e?.message ?? e);
      console.error('  ✗', job.error);
    }
    job.save();
    return job;
  },
};

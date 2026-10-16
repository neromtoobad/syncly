// A business's brand kit, read from its own pages so the owner doesn't have to fill it in: from the Instagram profile
// (one call: name, bio, category, website link, business phone, profile picture, and the last 12 posts with their
// captions) and from the website (its logo, theme colour, WhatsApp and phone links, site name). The logo and the
// best photos are saved as ordinary uploads, so every service that already takes uploads uses them unchanged; what
// the owner uploaded or typed always comes first. Only public pages are read.
import type { Job } from './job.ts';
import type { Role } from './wallets.ts';
import { aisa } from './sellers.ts';
import { download } from './media.ts';
import { siteBrand, siteImages } from './browser.ts';
import { saveUpload } from './uploads.ts';
import { brandCandidates } from './site/color.ts';
import { e164 } from './site/facts.ts';
import { DRY, MODELS } from './config.ts';
import { llm, parseJson, type Msg } from './tools.ts';
import { ffmpeg } from './media.ts';

export type BrandKit = {
  name?: string; bio?: string; category?: string; website?: string; whatsapp?: string; phone?: string;
  logo?: string; photos: string[]; colour?: string; prices: string[]; captions: string[]; sources: string[];
  notes: string[]; // for the customer: a handle or site we couldn't find, and what we used instead
  siteLabels?: string[]; // what their website calls its pictures, often the menu or product categories
  siteDead?: boolean; // the website they gave didn't open
  siteFixed?: string; // it didn't, but the likely right spelling did
};

const handleOf = (s?: string) => (s ?? '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#\s]/)[0] || undefined;
const PHONE = /(?:\+?234|\b0)\s?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}\b/;
// Words owners often misspell in their handle or business name, to try the right spelling when a handle isn't found.
const SPELL: [RegExp, string][] = [[/resturant|restaurent|resturent|restraunt|restuarant|resteraunt/g, 'restaurant'], [/kitchin|kitchn/g, 'kitchen'], [/boutque|botique|boutigue/g, 'boutique'], [/saloon/g, 'salon'], [/jewelry/g, 'jewellery'], [/jewellery/g, 'jewelry'], [/collections/g, 'collection'], [/apparels/g, 'apparel']];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
/** Free check that an Instagram handle exists: its public page is titled "Name (@handle)". A missing handle gets a
 *  generic "Instagram" title, and so does a blocked request, so only 'yes' is certain. */
export async function igExists(h: string): Promise<'unknown' | { name: string }> {
  if (!/^[a-z0-9._]{1,30}$/.test(h)) return 'unknown';
  try {
    const res = await fetch(`https://www.instagram.com/${h}/`, { headers: { 'user-agent': UA, 'accept-language': 'en' }, signal: AbortSignal.timeout(8000) });
    const title = (await res.text()).match(/<title>([^<]{0,200})/)?.[1] ?? '';
    const t = title.replace(/&#064;/g, '@').replace(/&amp;/g, '&');
    return t.toLowerCase().includes(`(@${h})`) ? { name: t.slice(0, t.toLowerCase().indexOf(`(@${h})`)).trim() } : 'unknown';
  } catch { return 'unknown'; }
}
/** Likely right spellings of a handle that wasn't found: common misspellings fixed, dots and underscores swapped,
 *  and the business name written the ways handles usually are. */
export function handleVariants(h: string, name?: string): string[] {
  const fix = (x: string) => SPELL.reduce((t, [re, to]) => t.replace(re, to), x);
  const words = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  const own = h.includes('.') ? '.' : h.includes('_') ? '_' : '', seps = [own, ...['.', '_', ''].filter((x) => x !== own)];
  for (const base of [h, fix(h)]) for (const sep of seps) out.add(base.replace(/[._]/g, sep));
  for (const w of [words, words.map(fix)]) if (w.length) for (const sep of seps) out.add(w.join(sep));
  out.delete(h);
  return [...out].filter((x) => /^[a-z0-9._]{3,30}$/.test(x)).slice(0, 10);
}

// When no vision model answers: rank posts by what their captions talk about. Words for what they sell count for a
// post, words for events, flyers and notices count against it; only posts that come out ahead are used.
const FOOD = /\b(food|foods|soups?|swallow|rice|pasta|sides|jollof|rice|fried rice|chicken|turkey|suya|asun|pepper ?soup|small chops|puff[- ]?puff|samosa|spring rolls?|shawarma|burgers?|pizza|fish|catfish|croaker|beef|goat|meat|plates?|platter|menu|dish(es)?|meals?|lunch|dinner|breakfast|delicious|yummy|tasty|swallow|egusi|efo|ogbono|amala|pounded yam|ofada|ayamase|nkwobi|isi ewu|abacha|moi ?moi|akara|grills?|grilled|bbq|fries|chips|plantain|dodo|snacks?|cakes?|pastr(y|ies)|bread|drinks?|cocktails?|mocktails?|smoothies?|zobo|chapman|juice|wings|noodles|pasta|spaghetti|salad|soup|stew|sauce)\b/gi;
const NOT_IT = /\b(wedding|birthday|anniversary|event|hosted|celebrat\w*|congrat\w*|hiring|vacanc\w*|job|apply|closed|announcement|notice|giveaway|winner|contest|happy (new year|sunday|monday|independence)|throwback|tbt|meet (our|the) (team|staff))\b/gi;
export function byCaption(posts: { caption: string; likes: number }[], about: string): number[] {
  const words = [...new Set(about.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4))];
  const food = FOOD.test(about) || /restaurant|food|kitchen|cater|eat|chops|bakery|grill|lounge|bar\b/i.test(about);
  FOOD.lastIndex = 0;
  const score = (c: string) => { const t = c.toLowerCase(); return (food ? (t.match(FOOD) ?? []).length * 2 : 0) + words.filter((w) => t.includes(w)).length - (t.match(NOT_IT) ?? []).length * 3; };
  return posts.map((p, i) => ({ i, s: score(p.caption), likes: p.likes })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || b.likes - a.likes).map((x) => x.i);
}

const PRICE = /(?:₦|\bN|#|NGN)\s?\d[\d,.]*\s?k?\b|\b\d{1,3}(?:,\d{3})+\s?(?:naira|NGN)\b/gi;

/**
 * Which of a business's Instagram posts show what it sells (its food, products or finished work), best first; the
 * rest (events, flyers, logos, people, notices) are left out, and an empty list means none do. A vision model looks
 * at the pictures (a second model if the first fails); with no model, the captions decide. Shared by every service
 * that takes photos from Instagram.
 */
export async function relevantPosts(job: Job, agent: Role, posts: { buf: Buffer; caption: string; likes: number }[], o: { name?: string; about?: string; bio?: string; what?: string }): Promise<number[]> {
  const what = o.what ?? 'recent posts';
  if (!posts.length) return [];
  const thumbs = await Promise.all(posts.map((p) => ffmpeg({ in: p.buf }, (f, out) => ['-i', f.in, '-vf', 'scale=256:-2,format=yuvj420p', '-q:v', '7', '-frames:v', '1', out], 'jpg').catch(() => undefined)));
  const msgs: Msg[] = [
    { role: 'system', content: 'You choose photos for a small business\'s ads from its Instagram posts. Keep ONLY the photos that clearly show what it sells: for a restaurant or caterer, plates of food, dishes, drinks; for a shop, its products; for a service, the finished result. Best first: sharp, appetising, the item filling the frame. Leave out logos, flyers, posters and anything mostly text, screenshots, selfies and group photos, weddings, birthdays and other events, and photos of the building or staff, unless that is what the business sells. If none qualify, return an empty list. Reply JSON only: {"pick": [photo numbers, best first]}' },
    { role: 'user', content: [{ type: 'text', text: `The business: ${o.name ?? ''}. It sells: ${o.about || 'see the photos'}. ${posts.length} photos:` }, ...thumbs.flatMap((t, i) => (t ? [{ type: 'text' as const, text: `Photo ${i + 1}` }, { type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${t.toString('base64')}` } }] : []))] },
  ];
  for (const model of [MODELS.vision, MODELS.auditor]) {
    try {
      const pick = parseJson<{ pick: number[] }>(await llm(job, agent, msgs, 'keep only the photos that show what they sell', { model, maxTokens: 120, json: true, maxUsd: 0.08, dry: () => JSON.stringify({ pick: posts.map((_, i) => i + 1) }) }), { pick: [] }).pick;
      const order = (Array.isArray(pick) ? pick : []).map((x) => Number(x) - 1).filter((x, k, xs) => Number.isInteger(x) && x >= 0 && x < posts.length && xs.indexOf(x) === k);
      job.log(agent, 'photos', order.length ? `${order.length} of ${posts.length} ${what} show what they sell; using those` : `none of their ${posts.length} ${what} show what they sell`);
      return order;
    } catch (e: any) { job.log(agent, 'skip', `photo pick with ${model.split('/')[1]} failed (${String(e?.message ?? e).slice(0, 100)})`); }
  }
  const order = byCaption(posts, `${o.about ?? ''} ${o.bio ?? ''}`);
  job.log(agent, 'photos', `picked by their captions: ${order.length} of ${posts.length} ${what} are about what they sell`);
  return order;
}

/** Pictures of what they sell from their own website (its menu, product and gallery images), checked like their
 *  Instagram posts; app screens, QR codes, logos and banners are left out. Returns the picked images and the words the
 *  site puts on its pictures (often its menu categories: "Soups", "Swallow", "Rice & Pasta"). */
export async function sitePhotos(job: Job, agent: Role, url: string, o: { name?: string; about?: string; want: number }): Promise<{ bufs: Buffer[]; labels: string[] }> {
  const ims = await siteImages(url, 24).catch(() => []);
  const ok = ims.filter((im) => !/\bqr\b|qr[-_ ]?code|app ?store|play ?store|google ?play|barcode|download the app|app[-_ ]?screen|screenshot|logo|icon|favicon|banner|avatar/i.test(`${im.src} ${im.alt}`) && Math.min(im.w, im.h) >= 300);
  const raw: { buf: Buffer; caption: string; likes: number }[] = [];
  for (const im of ok.slice(0, 12)) { const buf = await getImage(im.src); if (buf) raw.push({ buf, caption: im.alt ?? '', likes: 0 }); }
  const labels = [...new Set(ok.map((im) => String(im.alt ?? '').trim()).filter((a) => a.length >= 3 && a.length <= 40 && !/experience|photo|image|picture|food$|banner|hero/i.test(a)))].slice(0, 10);
  if (!raw.length || !o.want) return { bufs: [], labels };
  const pick = await relevantPosts(job, agent, raw, { name: o.name, about: o.about, what: 'pictures on their website' });
  return { bufs: pick.slice(0, o.want).map((i) => raw[i].buf), labels };
}

/** Read the brand kit from an Instagram handle and/or a website. Never throws: a page that won't read is skipped. */
export async function brandKit(job: Job, o: { instagram?: string; website?: string; photos?: number; agent?: 'reader' | 'scout'; name?: string; about?: string }): Promise<BrandKit> {
  const kit: BrandKit = { photos: [], prices: [], captions: [], sources: [], notes: [] };
  const agent = o.agent ?? 'reader';
  const logoBufs: Buffer[] = [];
  const wantPhotos = o.photos ?? 6;
  let ig = handleOf(o.instagram)?.toLowerCase();
  // a handle that doesn't check out may be a typo: try the likely right spellings (free) before paying for a lookup
  if (ig && !DRY && (await igExists(ig)) === 'unknown') {
    // only an account whose profile name shares a real word with the business name counts (not a stranger's)
    const fix = (x: string) => SPELL.reduce((t, [re, to]) => t.replace(re, to), x.toLowerCase());
    const words = fix(o.name ?? ig.replace(/[._]/g, ' ')).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const ours = (n: string) => words.some((w) => fix(n).includes(w));
    const vs = handleVariants(ig, o.name);
    const found = (await Promise.all(vs.map(async (v) => { const r = await igExists(v); return r !== 'unknown' && ours(r.name) ? v : undefined; }))).find(Boolean);
    if (found) { job.log(agent, 'instagram', `@${ig} wasn't found on Instagram; @${found} is ${o.name ?? 'the business'}, so we used that`); kit.notes.push(`We couldn't find @${ig} on Instagram, so we used @${found}. If that isn't you, ask for a revision with the right handle.`); ig = found; }
  }

  if (ig) {
    try {
      job.log(agent, 'instagram', `@${ig}: name, bio, logo, contact and recent posts`);
      const r = await aisa<any>(job, 'instagram/profile', { query: { handle: ig } }, {
        agent, vendor: 'Instagram profile (AIsa)', reason: `@${ig}'s profile and recent posts`, expectUsd: 0.1, maxUsd: 0.15, dry: () => dryProfile(ig),
      });
      const u = r?.data?.user ?? r?.user ?? r?.data;
      if (u && (u.username || u.id)) {
        kit.sources.push(`instagram.com/${ig}`);
        kit.name = u.full_name || undefined;
        kit.bio = String(u.biography ?? '').trim() || undefined;
        kit.category = u.category_name ?? u.category ?? undefined;
        const ext = String(u.external_url ?? u.bio_links?.[0]?.url ?? '');
        if (/wa\.me|whatsapp/i.test(ext)) kit.whatsapp = ext.match(/\d{10,15}/)?.[0];
        else if (/^https?:\/\//.test(ext) && !/linktr\.ee|bit\.ly|beacons|instagram\.com/i.test(ext)) kit.website = ext;
        const bizPhone = u.business_phone_number || u.public_phone_number || u.contact_phone_number;
        const bioPhone = kit.bio?.match(PHONE)?.[0];
        if (!kit.whatsapp && kit.bio && /whats\s?app|wa\.me|\bwa\b/i.test(kit.bio)) kit.whatsapp = kit.bio.match(/wa\.me\/(\d+)/)?.[1] ?? bioPhone;
        kit.phone = bizPhone ? `${u.public_phone_country_code ? `+${u.public_phone_country_code}` : ''}${bizPhone}` : bioPhone;
        const pic = u.profile_pic_url_hd ?? u.hd_profile_pic_url_info?.url ?? u.profile_pic_url;
        if (pic) { const b = await getImage(pic); if (b) logoBufs.push(b); }
        // the posts people liked most are the best pictures of what they sell
        const nodes: any[] = (u.edge_owner_to_timeline_media?.edges ?? []).map((e: any) => e?.node).filter(Boolean);
        const ranked = [...nodes].sort((a, b) => (b.edge_liked_by?.count ?? b.edge_media_preview_like?.count ?? 0) - (a.edge_liked_by?.count ?? a.edge_media_preview_like?.count ?? 0));
        for (const n of nodes) { const c = String(n.edge_media_to_caption?.edges?.[0]?.node?.text ?? '').trim(); if (c) kit.captions.push(c.slice(0, 280)); }
        for (const c of [kit.bio ?? '', ...kit.captions]) for (const m of c.match(PRICE) ?? []) if (kit.prices.length < 8 && !kit.prices.includes(m.trim())) kit.prices.push(m.trim());
        // the pictures of what they sell, never their most-liked post for its own sake (often an event, a flyer or the
        // logo): a vision model looks at the posts and keeps only those showing the food or product (a second model
        // if the first fails); with no model, the captions decide; nothing unrelated is used to fill the count
        const posts: { buf: Buffer; caption: string; likes: number }[] = [];
        for (const n of ranked.slice(0, 12)) {
          const src = n.display_url ?? n.thumbnail_src, b = src ? await getImage(src) : undefined;
          if (b) posts.push({ buf: b, caption: String(n.edge_media_to_caption?.edges?.[0]?.node?.text ?? ''), likes: n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? 0 });
        }
        let order: number[] | undefined;
        if (wantPhotos && posts.length) {
          order = await relevantPosts(job, agent, posts, { name: o.name ?? kit.name, about: `${o.about ?? ''} ${kit.category ?? ''}`.trim(), bio: kit.bio });
          if (!order.length) kit.notes.push('Your recent Instagram posts don\'t show what you sell, so we didn\'t use them. Upload a few photos of it in a revision and we remake it with them.');
        }
        for (const i of order ?? []) {
          if (kit.photos.length >= wantPhotos) break;
          const up = await saveUpload(posts[i].buf).catch(() => undefined);
          if (up) kit.photos.push(up.id);
        }
        job.log(agent, 'instagram', `@${ig}: ${[kit.name, logoBufs.length ? 'logo' : '', kit.photos.length ? `${kit.photos.length} photos` : '', kit.whatsapp || kit.phone ? 'a contact number' : '', kit.prices.length ? `${kit.prices.length} prices` : ''].filter(Boolean).join(', ') || 'nothing usable'}`);
      }
      else kit.notes.push(`We couldn't read @${ig} on Instagram. Check the handle is right and the account is public.`);
    } catch (e: any) { job.log(agent, 'skip', `Instagram unreadable (${String(e?.message ?? e).slice(0, 60)})`); kit.notes.push(`We couldn't read @${ig} on Instagram. Check the handle is right and the account is public.`); }
  }

  const site = o.website ?? kit.website;
  if (site && !DRY) {
    // the address as typed, then (if it doesn't open) the likely right spelling: otegaresturant.com → otegarestaurant.com
    const typed = /^https?:\/\//.test(site) ? site : `https://${site}`;
    const fixedUrl = SPELL.reduce((t, [re, to]) => t.replace(re, to), typed.toLowerCase());
    const bare = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');
    let opened = false;
    for (const url of [typed, ...(fixedUrl !== typed.toLowerCase() ? [fixedUrl] : [])]) {
      try {
        job.log(agent, 'website', `${bare(url)}: logo, colour and contact links`);
        const b = await siteBrand(url);
        if (!b) { job.log(agent, 'skip', `${bare(url)} didn't open`); continue; }
        opened = true;
        if (url !== typed) { kit.siteFixed = url; kit.notes.push(`${bare(typed)} didn't open, but ${bare(url)} is your site, so we used that.`); }
        kit.sources.push(bare(url));
        kit.website = kit.siteFixed ?? kit.website ?? url;
        kit.name = kit.name ?? b.name;
        kit.whatsapp = kit.whatsapp ?? b.whatsapp;
        kit.phone = kit.phone ?? b.phone;
        // a site's own logo file beats a profile picture, unless it's a wide wordmark (it would be tiny in a round
        // or square logo spot), when the profile picture stays first
        if (b.logo) { const buf = await getImage(b.logo); if (buf) { const sz = imgSize(buf); if (sz && sz[0] > sz[1] * 2 && logoBufs.length) logoBufs.push(buf); else logoBufs.unshift(buf); } }
        if (b.themeColour && /^#[0-9a-f]{6}$/i.test(b.themeColour)) kit.colour = b.themeColour;
        // their own site's pictures of what they sell fill what Instagram didn't (the best source for a restaurant's dishes)
        const sp = await sitePhotos(job, agent, url, { name: o.name ?? kit.name, about: o.about, want: Math.max(0, wantPhotos - kit.photos.length) });
        for (const buf of sp.bufs) { const up = await saveUpload(buf).catch(() => undefined); if (up) kit.photos.push(up.id); }
        if (sp.bufs.length) job.log(agent, 'photos', `${sp.bufs.length} pictures of what they sell from ${bare(url)}`);
        kit.siteLabels = sp.labels;
        break;
      } catch (e: any) { job.log(agent, 'skip', `${bare(url)} unreadable (${String(e?.message ?? e).slice(0, 60)})`); }
    }
    if (!opened) { kit.siteDead = true; kit.notes.push(`${bare(typed)} didn't open, so nothing was taken from it. Check the address.`); }
  }

  if (logoBufs.length) { const up = await saveUpload(logoBufs[0]).catch(() => undefined); if (up) kit.logo = up.id; }
  if (!kit.colour && logoBufs.length) kit.colour = (await brandCandidates([{ buf: logoBufs[0], logo: true }]).catch(() => []))[0];
  // keep only numbers someone can answer
  if (kit.whatsapp && !e164(kit.whatsapp)) kit.whatsapp = undefined;
  if (kit.phone && !e164(kit.phone)) kit.phone = undefined;
  return kit;
}

/** Width and height of a PNG or JPEG, read from its header. */
function imgSize(b: Buffer): [number, number] | undefined {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) for (let i = 2; i < b.length - 9;) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + b.readUInt16BE(i + 2); }
  return undefined;
}

async function getImage(url: string): Promise<Buffer | undefined> {
  try { return await download(url, 8); } catch { return undefined; }
}

function dryProfile(handle: string) {
  return { success: true, data: { user: { username: handle, full_name: 'Tolu’s Small Chops', biography: 'Party trays & small chops in Surulere, Lagos 🍢 Trays from ₦25,000 | WhatsApp 0803 555 0142 | Order a day ahead', category_name: 'Caterer', external_url: '', business_phone_number: '', profile_pic_url: '', edge_owner_to_timeline_media: { edges: [] } } } };
}

/**
 * The order's details with the gaps filled from the business's own pages: logo, photos, brand colour, WhatsApp or
 * phone, website, and a WhatsApp call to action when none was chosen. What the owner gave always stays. Skips the
 * paid profile call when nothing is missing. Returns a copy (the order keeps what the owner wrote) and the page
 * text (bio, category, prices, captions) for the writers.
 */
/** The brand kit's notes for the customer, as a section to append to a delivery. */
export const headsUp = (notes: string[]) => (notes.length ? `\n\n## Heads up\n\n${notes.map((n) => `- ${n}`).join('\n')}` : '');

export async function withBrandKit<T extends { name?: string; offer?: string; instagram?: string; website?: string; logo?: string; photos?: string[]; colour?: string; whatsapp?: string; phone?: string; cta?: string }>(job: Job, details: T | undefined, o: { photos?: number } = {}): Promise<{ d: T | undefined; text: string; notes: string[] }> {
  if (!details || (!details.instagram && !details.website)) return { d: details, text: '', notes: [] };
  const d = { ...details };
  const wantPhotos = Math.max(0, (o.photos ?? 6) - (d.photos?.length ?? 0));
  if (d.logo && !wantPhotos && d.colour && (d.whatsapp || d.phone)) return { d, text: '', notes: [] };
  const kit = await brandKit(job, { instagram: d.instagram, website: d.website, photos: wantPhotos, name: d.name, about: d.offer });
  if (!d.logo && kit.logo) d.logo = kit.logo;
  if (kit.photos.length) d.photos = [...(d.photos ?? []), ...kit.photos].slice(0, o.photos ?? 6);
  if (!d.colour && kit.colour) d.colour = kit.colour;
  if (!d.whatsapp && !d.phone && (kit.whatsapp || kit.phone)) d.whatsapp = kit.whatsapp ?? kit.phone;
  if (!d.website && kit.website) d.website = kit.website;
  // a website that doesn't open never becomes the button: their WhatsApp or phone does
  if (kit.siteFixed) d.website = kit.siteFixed;
  if (kit.siteDead && d.website) {
    d.website = undefined;
    if (d.cta === 'website') d.cta = d.whatsapp ? 'whatsapp' : d.phone ? 'call' : d.instagram ? 'dm' : undefined;
  }
  // their Instagram confirms how the name is spelled: "OTEGA RESTURANT" typed, "OTEGA RESTAURANT" on the profile
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const spelt = (x: string) => SPELL.reduce((t, [re, to]) => t.replace(re, to), x.toLowerCase());
  if (kit.name && d.name && flat(kit.name) !== flat(d.name) && flat(spelt(d.name)) === flat(kit.name)) { kit.notes.push(`We spelled your name "${kit.name}", as it is on your Instagram.`); d.name = kit.name; }
  if (!d.cta && d.whatsapp) d.cta = 'whatsapp';
  // nothing to brand it with: say so, so the customer knows why and how to fix it
  if (!d.logo && !d.photos?.length) kit.notes.push('We had no logo or photos to work with, so this uses your name and colours only. Upload your logo and a few photos in a revision and we remake it with them.');
  const text = [kit.siteLabels?.length && `Their website's sections and pictures: ${kit.siteLabels.join(', ')}`, kit.bio && `Their Instagram bio: ${kit.bio}`, kit.category && `Category: ${kit.category}`, kit.prices.length && `Prices in their posts: ${kit.prices.join(', ')}`, kit.captions.length && `Their recent posts say:\n${kit.captions.slice(0, 8).map((c) => `- ${c.replace(/\s+/g, ' ')}`).join('\n')}`].filter(Boolean).join('\n');
  return { d, text, notes: kit.notes };
}

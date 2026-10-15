// A business's brand kit, read from its own pages so the owner doesn't have to fill it in: from the Instagram profile
// (one call: name, bio, category, website link, business phone, profile picture, and the last 12 posts with their
// captions) and from the website (its logo, theme colour, WhatsApp and phone links, site name). The logo and the
// best photos are saved as ordinary uploads, so every service that already takes uploads uses them unchanged; what
// the owner uploaded or typed always comes first. Only public pages are read.
import type { Job } from './job.ts';
import { aisa } from './sellers.ts';
import { download } from './media.ts';
import { siteBrand } from './browser.ts';
import { saveUpload } from './uploads.ts';
import { brandCandidates } from './site/color.ts';
import { e164 } from './site/facts.ts';
import { DRY } from './config.ts';

export type BrandKit = {
  name?: string; bio?: string; category?: string; website?: string; whatsapp?: string; phone?: string;
  logo?: string; photos: string[]; colour?: string; prices: string[]; captions: string[]; sources: string[];
};

const handleOf = (s?: string) => (s ?? '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#\s]/)[0] || undefined;
const PHONE = /(?:\+?234|\b0)\s?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}\b/;
const PRICE = /(?:₦|\bN|#|NGN)\s?\d[\d,.]*\s?k?\b|\b\d{1,3}(?:,\d{3})+\s?(?:naira|NGN)\b/gi;

/** Read the brand kit from an Instagram handle and/or a website. Never throws: a page that won't read is skipped. */
export async function brandKit(job: Job, o: { instagram?: string; website?: string; photos?: number; agent?: 'reader' | 'scout' }): Promise<BrandKit> {
  const kit: BrandKit = { photos: [], prices: [], captions: [], sources: [] };
  const agent = o.agent ?? 'reader';
  const logoBufs: Buffer[] = [];
  const wantPhotos = o.photos ?? 6;
  const ig = handleOf(o.instagram);

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
        for (const n of ranked) {
          if (kit.photos.length >= wantPhotos) break;
          const src = n.display_url ?? n.thumbnail_src;
          const b = src ? await getImage(src) : undefined;
          if (b) { const up = await saveUpload(b).catch(() => undefined); if (up) kit.photos.push(up.id); }
        }
        job.log(agent, 'instagram', `@${ig}: ${[kit.name, logoBufs.length ? 'logo' : '', kit.photos.length ? `${kit.photos.length} photos` : '', kit.whatsapp || kit.phone ? 'a contact number' : '', kit.prices.length ? `${kit.prices.length} prices` : ''].filter(Boolean).join(', ') || 'nothing usable'}`);
      }
    } catch (e: any) { job.log(agent, 'skip', `Instagram unreadable (${String(e?.message ?? e).slice(0, 60)})`); }
  }

  const site = o.website ?? kit.website;
  if (site && !DRY) {
    try {
      const url = /^https?:\/\//.test(site) ? site : `https://${site}`;
      job.log(agent, 'website', `${url.replace(/^https?:\/\//, '')}: logo, colour and contact links`);
      const b = await siteBrand(url);
      if (b) {
        kit.sources.push(url.replace(/^https?:\/\//, ''));
        kit.website = kit.website ?? url;
        kit.name = kit.name ?? b.name;
        kit.whatsapp = kit.whatsapp ?? b.whatsapp;
        kit.phone = kit.phone ?? b.phone;
        if (b.logo) { const buf = await getImage(b.logo); if (buf) logoBufs.unshift(buf); } // a site's own logo file beats a profile picture
        if (b.themeColour && /^#[0-9a-f]{6}$/i.test(b.themeColour)) kit.colour = b.themeColour;
      }
    } catch (e: any) { job.log(agent, 'skip', `website unreadable (${String(e?.message ?? e).slice(0, 60)})`); }
  }

  if (logoBufs.length) { const up = await saveUpload(logoBufs[0]).catch(() => undefined); if (up) kit.logo = up.id; }
  if (!kit.colour && logoBufs.length) kit.colour = (await brandCandidates([{ buf: logoBufs[0], logo: true }]).catch(() => []))[0];
  // keep only numbers someone can answer
  if (kit.whatsapp && !e164(kit.whatsapp)) kit.whatsapp = undefined;
  if (kit.phone && !e164(kit.phone)) kit.phone = undefined;
  return kit;
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
export async function withBrandKit<T extends { instagram?: string; website?: string; logo?: string; photos?: string[]; colour?: string; whatsapp?: string; phone?: string; cta?: string }>(job: Job, details: T | undefined, o: { photos?: number } = {}): Promise<{ d: T | undefined; text: string }> {
  if (!details || (!details.instagram && !details.website)) return { d: details, text: '' };
  const d = { ...details };
  const wantPhotos = Math.max(0, (o.photos ?? 6) - (d.photos?.length ?? 0));
  if (d.logo && !wantPhotos && d.colour && (d.whatsapp || d.phone)) return { d, text: '' };
  const kit = await brandKit(job, { instagram: d.instagram, website: d.website, photos: wantPhotos });
  if (!d.logo && kit.logo) d.logo = kit.logo;
  if (kit.photos.length) d.photos = [...(d.photos ?? []), ...kit.photos].slice(0, o.photos ?? 6);
  if (!d.colour && kit.colour) d.colour = kit.colour;
  if (!d.whatsapp && !d.phone && (kit.whatsapp || kit.phone)) d.whatsapp = kit.whatsapp ?? kit.phone;
  if (!d.website && kit.website) d.website = kit.website;
  if (!d.cta && d.whatsapp) d.cta = 'whatsapp';
  const text = [kit.bio && `Their Instagram bio: ${kit.bio}`, kit.category && `Category: ${kit.category}`, kit.prices.length && `Prices in their posts: ${kit.prices.join(', ')}`, kit.captions.length && `Their recent posts say:\n${kit.captions.slice(0, 8).map((c) => `- ${c.replace(/\s+/g, ' ')}`).join('\n')}`].filter(Boolean).join('\n');
  return { d, text };
}

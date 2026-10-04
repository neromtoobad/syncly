// The places a Nigerian small business already sells, books and gets paid, wired into its site. Each
// integration is recognised by its link's host, so a pasted URL (or one found on the Google listing or the
// Instagram bio) lands in the right slot: "Order on Chowdeck", "Book on Fresha", "Pay by transfer"...
// Links are only ever rendered from this registry, as plain outbound links; no third-party scripts.
import type { Item } from './facts.ts';

export type LinkId =
  | 'chowdeck' | 'glovo' | 'heyfood'
  | 'paystack' | 'flutterwave' | 'selar' | 'bumpa' | 'jiji' | 'jumia' | 'catalog'
  | 'calendly' | 'fresha' | 'booking'
  | 'tix' | 'eventbrite'
  | 'review'
  | 'instagram' | 'tiktok' | 'facebook' | 'x' | 'youtube' | 'audiomack' | 'boomplay' | 'spotify' | 'linkedin' | 'telegram' | 'channel';
export type Group = 'order' | 'shop' | 'book' | 'tickets' | 'review' | 'social';
export type Links = Partial<Record<LinkId, string>>;
export type Bank = { bank: string; accountName: string; accountNumber: string; note?: string };

type Def = { label: string; group: Group; cta: string; hosts: RegExp; hint: string };
export const LINKS: Record<LinkId, Def> = {
  chowdeck: { label: 'Chowdeck', group: 'order', cta: 'Order on Chowdeck', hosts: /(^|\.)chowdeck\.com$/, hint: 'Your Chowdeck store page' },
  glovo: { label: 'Glovo', group: 'order', cta: 'Order on Glovo', hosts: /(^|\.)glovoapp\.com$/, hint: 'Your Glovo store page' },
  heyfood: { label: 'Heyfood', group: 'order', cta: 'Order on Heyfood', hosts: /(^|\.)heyfood\.africa$/, hint: 'Your Heyfood store page' },
  paystack: { label: 'Paystack', group: 'shop', cta: 'Pay online', hosts: /(^|\.)(paystack\.com|paystack\.shop)$/, hint: 'A Paystack payment page or storefront' },
  flutterwave: { label: 'Flutterwave', group: 'shop', cta: 'Pay online', hosts: /(^|\.)(flutterwave\.com|flw\.ink)$/, hint: 'A Flutterwave payment link or store' },
  selar: { label: 'Selar', group: 'shop', cta: 'Buy on Selar', hosts: /(^|\.)selar\.(co|com)$/, hint: 'Your Selar store (courses, e-books, tickets)' },
  bumpa: { label: 'Bumpa', group: 'shop', cta: 'Shop online', hosts: /(^|\.)bumpa\.shop$/, hint: 'Your Bumpa store' },
  jiji: { label: 'Jiji', group: 'shop', cta: 'See us on Jiji', hosts: /(^|\.)jiji\.ng$/, hint: 'Your Jiji shop' },
  jumia: { label: 'Jumia', group: 'shop', cta: 'Shop on Jumia', hosts: /(^|\.)jumia\.com\.ng$/, hint: 'Your Jumia store' },
  catalog: { label: 'WhatsApp catalogue', group: 'shop', cta: 'See our catalogue', hosts: /^wa\.me$/, hint: 'Your WhatsApp Business catalogue link (wa.me/c/...)' },
  calendly: { label: 'Calendly', group: 'book', cta: 'Book a time', hosts: /(^|\.)(calendly\.com|cal\.com)$/, hint: 'Your Calendly or Cal.com booking page' },
  fresha: { label: 'Fresha', group: 'book', cta: 'Book on Fresha', hosts: /(^|\.)fresha\.com$/, hint: 'Your Fresha booking page' },
  booking: { label: 'Booking page', group: 'book', cta: 'Book online', hosts: /(^|\.)(setmore\.com|square\.site|booksy\.com|zcal\.co|tidycal\.com)$/, hint: 'Any other online booking page' },
  tix: { label: 'Tix Africa', group: 'tickets', cta: 'Get tickets', hosts: /(^|\.)tix\.africa$/, hint: 'Your event on Tix Africa' },
  eventbrite: { label: 'Eventbrite', group: 'tickets', cta: 'Get tickets', hosts: /(^|\.)eventbrite\.(com|co\.uk)$/, hint: 'Your event on Eventbrite' },
  review: { label: 'Google review', group: 'review', cta: 'Review us on Google', hosts: /(^|\.)(g\.page|google\.com|search\.google\.com)$/, hint: 'Your Google review link (g.page/r/...)' },
  instagram: { label: 'Instagram', group: 'social', cta: 'Instagram', hosts: /(^|\.)instagram\.com$/, hint: 'Your Instagram profile' },
  tiktok: { label: 'TikTok', group: 'social', cta: 'TikTok', hosts: /(^|\.)tiktok\.com$/, hint: 'Your TikTok profile' },
  facebook: { label: 'Facebook', group: 'social', cta: 'Facebook', hosts: /(^|\.)(facebook\.com|fb\.com)$/, hint: 'Your Facebook page' },
  x: { label: 'X', group: 'social', cta: 'X', hosts: /(^|\.)(x\.com|twitter\.com)$/, hint: 'Your X (Twitter) profile' },
  youtube: { label: 'YouTube', group: 'social', cta: 'YouTube', hosts: /(^|\.)(youtube\.com|youtu\.be)$/, hint: 'Your YouTube channel' },
  audiomack: { label: 'Audiomack', group: 'social', cta: 'Audiomack', hosts: /(^|\.)audiomack\.com$/, hint: 'Your Audiomack page' },
  boomplay: { label: 'Boomplay', group: 'social', cta: 'Boomplay', hosts: /(^|\.)boomplay\.com$/, hint: 'Your Boomplay page' },
  spotify: { label: 'Spotify', group: 'social', cta: 'Spotify', hosts: /(^|\.)spotify\.com$/, hint: 'Your Spotify page' },
  linkedin: { label: 'LinkedIn', group: 'social', cta: 'LinkedIn', hosts: /(^|\.)linkedin\.com$/, hint: 'Your LinkedIn page' },
  telegram: { label: 'Telegram', group: 'social', cta: 'Telegram', hosts: /^(t\.me|telegram\.me)$/, hint: 'Your Telegram channel' },
  channel: { label: 'WhatsApp channel', group: 'social', cta: 'WhatsApp channel', hosts: /^(whatsapp\.com|www\.whatsapp\.com)$/, hint: 'Your WhatsApp channel link' },
};

/** A clean https URL, or undefined. */
export function cleanUrl(raw?: string): string | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    u.protocol = 'https:'; u.hash = '';
    return u.toString();
  } catch { return undefined; }
}

/** Which integration a URL belongs to, by its host (WhatsApp catalogue links are wa.me/c/...). */
export function classify(raw?: string): LinkId | undefined {
  const url = cleanUrl(raw);
  if (!url) return undefined;
  const u = new URL(url), host = u.hostname.replace(/^www\./, '');
  if (host === 'wa.me') return u.pathname.startsWith('/c/') ? 'catalog' : undefined;
  if ((host === 'google.com' || host === 'search.google.com') && !/writereview|\/r\//.test(u.pathname + u.search)) return undefined;
  for (const [id, d] of Object.entries(LINKS) as [LinkId, Def][]) if (d.hosts.test(host) || d.hosts.test(u.hostname)) return id;
  return undefined;
}

/** Keep only links that belong where they claim to: a Glovo URL can't sit in the Chowdeck slot. */
export function sanitizeLinks(raw: unknown): Links {
  const out: Links = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in LINKS)) continue;
    const url = cleanUrl(String(v ?? ''));
    if (url && classify(url) === k) out[k as LinkId] = url;
  }
  return out;
}

export function sanitizeBank(raw: any): Bank | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const num = String(raw.accountNumber ?? '').replace(/\D/g, '');
  const bank = String(raw.bank ?? '').trim().slice(0, 40), accountName = String(raw.accountName ?? '').trim().slice(0, 60);
  if (!/^\d{10}$/.test(num) || !bank || !accountName) return undefined; // Nigerian NUBAN account numbers are 10 digits
  const note = String(raw.note ?? '').trim().slice(0, 120);
  return { bank, accountName, accountNumber: num, ...(note ? { note } : {}) };
}

/** The links of one group, in registry order, each with its button text. */
export const linksIn = (links: Links | undefined, group: Group) =>
  (Object.keys(LINKS) as LinkId[]).filter((id) => LINKS[id].group === group && links?.[id]).map((id) => ({ id, url: links![id]!, label: LINKS[id].label, cta: LINKS[id].cta }));

// ---------------------------------------------------------------- Chowdeck: the store's menu and details

export type ChowdeckStore = { url: string; name?: string; phone?: string; address?: string; area?: string; rating?: number; ratingCount?: number; hours?: { day: string; opens: string; closes: string }[]; items: Omit<Item, 'id'>[] };

/** Read a Chowdeck store page: its schema.org Restaurant record (details, hours) and its menu (sections, items, ₦ prices). */
export async function readChowdeck(raw: string): Promise<ChowdeckStore> {
  const url = cleanUrl(raw);
  if (!url || classify(url) !== 'chowdeck' || !/\/store\/[^/]+\/[^/]+\/[^/?#]+/.test(new URL(url).pathname)) throw new Error('Paste the link to your store on Chowdeck (chowdeck.com/store/...).');
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; SynclyBot/1.0; +https://hiresyncly.site)' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Chowdeck answered ${res.status} for that link.`);
  const html = await res.text();
  // the page carries one Restaurant record in a ld+json tag, and the full record (with the menu) in its React payload
  const tag = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  const base = tag ? safeJson(tag[1]) : null;
  const payload = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => safeJson(`"${m[1]}"`) ?? '').join('');
  const menu = extractObject(payload, '"hasMenu":');
  const r: any = base ?? {};
  if (!base && !menu) throw new Error('No Chowdeck store on that page. Open your store in the Chowdeck app or site, share it, and paste that link.');
  const items: Omit<Item, 'id'>[] = [];
  for (const sec of (menu?.hasMenuSection ?? []) as any[]) {
    for (const it of (sec?.hasMenuItem ?? []) as any[]) {
      const name = String(it?.name ?? '').trim();
      if (!name) continue;
      const price = Number(it?.offers?.price), cur = String(it?.offers?.priceCurrency ?? 'NGN');
      const desc = String(it?.description ?? '').trim();
      items.push({ name: name.slice(0, 80), price: price > 0 ? (cur === 'NGN' ? `₦${Math.round(price).toLocaleString('en-NG')}` : `${cur} ${price}`) : undefined, note: desc && desc.toLowerCase() !== name.toLowerCase() ? desc.slice(0, 140) : undefined, category: String(sec?.name ?? '').trim().slice(0, 40) || undefined, source: 'chowdeck' });
      if (items.length >= 120) break;
    }
  }
  return {
    url, name: r.name, phone: r.telephone, address: r.address?.streetAddress, area: r.address?.addressLocality,
    rating: r.aggregateRating ? Number(r.aggregateRating.ratingValue) : undefined, ratingCount: r.aggregateRating ? Number(r.aggregateRating.reviewCount) : undefined,
    hours: Array.isArray(r.openingHoursSpecification) ? r.openingHoursSpecification.map((h: any) => ({ day: h.dayOfWeek, opens: h.opens, closes: h.closes })) : undefined,
    items,
  };
}
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
/** The JSON object that follows `key` in a string, by matching braces (strings and escapes respected). */
function extractObject(s: string, key: string): any {
  const at = s.indexOf(key);
  if (at < 0) return null;
  let i = s.indexOf('{', at), depth = 0, inStr = false;
  const start = i;
  for (; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) return safeJson(s.slice(start, i + 1));
  }
  return null;
}

/** Same business? Compare phone numbers by their last 10 digits. */
/** Chowdeck's opening hours as Google-style text ("Monday: 08:00-22:00; ..."), which parseHours reads. */
export function chowdeckHours(store?: ChowdeckStore): string | undefined {
  const hhmm = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); const x = d.length === 3 ? `0${d}` : d.slice(0, 4); return x.length === 4 ? `${x.slice(0, 2)}:${x.slice(2)}` : ''; }; // "0900", "09:00", "09:00:00"
  const t = (store?.hours ?? []).map((h) => ({ day: String(h.day ?? '').replace(/^.*\//, ''), o: hhmm(h.opens), c: hhmm(h.closes) }))
    .filter((h) => /^[A-Za-z]{3,}$/.test(h.day) && /^\d{1,2}:\d{2}$/.test(h.o) && /^\d{1,2}:\d{2}$/.test(h.c)).map((h) => `${h.day}: ${h.o}-${h.c}`);
  return t.length ? t.join('; ') : undefined;
}

export const samePhone = (a?: string, b?: string) => { const d = (x?: string) => (x ?? '').replace(/\D/g, '').slice(-10); return d(a).length === 10 && d(a) === d(b); };

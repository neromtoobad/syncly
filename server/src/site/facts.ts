// What a customer site may say, and where each fact came from. The engine renders phone numbers,
// addresses, hours, prices and reviews from here only; the model can choose and arrange them but never
// type them, so a site can't invent a price or a review.

export type Kind = 'food' | 'beauty' | 'creative' | 'health' | 'retail' | 'professional' | 'events' | 'other';

export type Item = { id: string; name: string; price?: string; note?: string; category?: string; source: string };
export type Review = { id: string; text: string; who: string; rating: number };
export type Photo = {
  id: string; file: string; w: number; h: number;
  kind: 'food' | 'people' | 'premises' | 'product' | 'work' | 'flyer' | 'logo' | 'other';
  subject: string; quality: number; // 1–5 from the vision check
  focus?: 'center' | 'top' | 'bottom' | 'left' | 'right';
};
/** An announcement at the top of the site, shown between two dates (Lagos time, inclusive). "closed" also marks the
 * business closed on those dates: "Open now" says so, and Google gets it as special opening hours. */
export type Notice = { text: string; from?: string; until?: string; closed?: boolean; link?: 'whatsapp' | 'order' };
export type Hours = { day: number; open: number; close: number }[]; // day 0 = Sunday; minutes from midnight

export type Facts = {
  name: string;
  kind: Kind;
  category?: string;
  offer: string;
  area?: string;
  city?: string;
  country: string; // ISO-2
  address?: string;
  landmark?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  website?: string;
  mapsUrl?: string;
  logo?: string; // file name of their logo, shown in the header
  hours?: Hours;
  hoursText?: string;
  rating?: number;
  ratingCount?: number;
  items: Item[];
  reviews: Review[];
  delivery?: string;
  payments?: string[];
  links?: import('./links.ts').Links; // ordering, booking, shop, tickets, review and social links (see links.ts)
  bank?: import('./links.ts').Bank; // "pay by transfer" details, shown with a copy button
  notice?: Notice; // the owner's announcement bar: a special, a closure, news
  sources: string; // every text the facts came from, for checking copy against
};

// ---------- phones

/** E.164 digits for a Nigerian (default) or international number, or undefined. */
export function e164(raw?: string, country = 'NG'): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(/[\/,;|]|\bor\b/i).find((x) => (x.match(/\d/g) ?? []).length >= 7) ?? raw;
  let d = first.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  if (country === 'NG') {
    if (d.startsWith('234')) return d;
    if (d.startsWith('0') && d.length === 11) return '234' + d.slice(1);
    if (d.length === 10) return '234' + d;
  }
  return d.length >= 8 ? d : undefined;
}
export const telLink = (raw?: string, country?: string) => { const n = e164(raw, country); return n ? `tel:+${n}` : undefined; };
export const waLink = (raw: string | undefined, text: string, country?: string) => { const n = e164(raw, country); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : undefined; };
/** How a Nigerian number is usually written: 0803 555 0142. */
export function prettyPhone(raw?: string, country = 'NG'): string | undefined {
  const n = e164(raw, country);
  if (!n) return raw;
  if (n.startsWith('234') && n.length === 13) { const l = '0' + n.slice(3); return `${l.slice(0, 4)} ${l.slice(4, 7)} ${l.slice(7)}`; }
  return '+' + n;
}

// ---------- hours

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const mins = (t: string): number | undefined => {
  const m = t.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return undefined;
  let h = Number(m[1]); const mm = Number(m[2] ?? 0); const ap = m[3]?.replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + mm;
};

/**
 * Google-style hours ("Monday: 8 AM–9 PM; Tuesday: Closed; …", "Mon-Sat 8am-9pm") to minutes per day.
 * Anything it can't read is dropped, and the site then shows the raw text instead of "open now".
 */
export function parseHours(text?: string): Hours | undefined {
  if (!text) return undefined;
  const out: Hours = [];
  const s = text.replace(/[–—]/g, '-').replace(/ | /g, ' ');
  const dayIdx = (d: string) => DAYS.findIndex((x) => x.startsWith(d.toLowerCase().slice(0, 3)));
  for (const part of s.split(/[;\n]|,(?=\s*[A-Za-z]{3,}\s*[:\-])/)) {
    const m = part.trim().match(/^([A-Za-z]{3,})(?:\s*-\s*([A-Za-z]{3,}))?\s*:?\s*(.+)$/);
    if (!m) continue;
    const a = dayIdx(m[1]), b = m[2] ? dayIdx(m[2]) : a;
    if (a < 0 || b < 0) continue;
    const span = m[3].trim();
    if (/closed/i.test(span)) continue;
    const range = /open 24 hours/i.test(span) ? [0, 1440] : (() => { const r = span.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)/i); if (!r) return undefined; const o = mins(r[1]), c = mins(r[2]); return o !== undefined && c !== undefined ? [o, c] : undefined; })();
    if (!range) continue;
    for (let d = a; ; d = (d + 1) % 7) { out.push({ day: d, open: range[0], close: range[1] }); if (d === b) break; }
  }
  return out.length ? out : undefined;
}

export const fmtTime = (m: number) => { const h = Math.floor(m / 60) % 24, mm = m % 60; const ap = h >= 12 ? 'pm' : 'am'; const h12 = h % 12 || 12; return `${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${ap}`; };
export const dayName = (d: number) => DAYS[d][0].toUpperCase() + DAYS[d].slice(1, 3);

/** "Mon–Sat 8am–9pm · Sun 12pm–8pm": consecutive days with the same hours folded together. */
export function hoursLines(h: Hours): { days: string; time: string }[] {
  const byDay = new Map(h.map((x) => [x.day, `${fmtTime(x.open)}–${fmtTime(x.close)}`]));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const lines: { days: string; time: string }[] = [];
  for (let i = 0; i < order.length; ) {
    const t = byDay.get(order[i]) ?? 'Closed';
    let j = i;
    while (j + 1 < order.length && (byDay.get(order[j + 1]) ?? 'Closed') === t) j++;
    lines.push({ days: i === j ? dayName(order[i]) : `${dayName(order[i])}–${dayName(order[j])}`, time: t });
    i = j + 1;
  }
  return lines;
}

// ---------- prices

/** The number in a price string (₦25,000 → 25000; "N4.5k" → 4500). */
export function priceValue(p?: string): number | undefined {
  if (!p) return undefined;
  const m = p.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kK])?/);
  if (!m) return undefined;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}
/** Normalised for display: "N25000", "25,000 naira" and "₦25k" all become "₦25,000". */
export function showPrice(p: string, country = 'NG'): string {
  if (country !== 'NG' || !/(₦|ngn|naira|\bn\s?\d)/i.test(p) && !/^\s*\d/.test(p)) return p.trim();
  const v = priceValue(p);
  if (v === undefined) return p.trim();
  const range = p.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*[kK]?\s*[-–]\s*(?:₦|N)?\s*(\d+(?:\.\d+)?)\s*([kK])?/);
  if (range) { const k = /k/i.test(p) ? 1000 : 1; return `₦${(Number(range[1]) * k).toLocaleString('en-NG')}–₦${(Number(range[2]) * k).toLocaleString('en-NG')}`; }
  return `${/from/i.test(p) ? 'from ' : ''}₦${v.toLocaleString('en-NG')}`;
}

/** Normalised text for "does this appear in the sources?" checks. */
export const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9₦]+/g, ' ').trim();

/**
 * The owner's own menu or price list, read line by line: "Beef suya (large) – ₦6,000", "Haircut: 3500",
 * "Trays:" (a category heading). Their prices are taken exactly as written, with no model in between.
 */
export function parseMenu(text?: string): Omit<Item, 'id'>[] {
  if (!text) return [];
  const out: Omit<Item, 'id'>[] = [];
  let category: string | undefined;
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(.*?)\s*(?:[-–—:|]|\.{2,}|\s)\s*((?:from\s+)?(?:₦|NGN|N|\$|£|€)?\s?\d[\d,]*(?:\.\d+)?\s?(?:k|K)?(?:\s*[-–]\s*(?:₦|N)?\s?\d[\d,]*(?:k|K)?)?)\s*$/);
    if (m && m[1] && /[a-z]/i.test(m[1])) { out.push({ name: m[1].replace(/[-–—:|.\s]+$/, '').slice(0, 60), price: m[2].trim(), category, source: line }); continue; }
    if (/:$/.test(line) && line.length <= 40) { category = line.replace(/:$/, '').trim(); continue; }
    if (line.length <= 60 && /[a-z]/i.test(line)) out.push({ name: line.replace(/[-–—:|.\s]+$/, ''), category, source: line });
  }
  return out.slice(0, 30);
}

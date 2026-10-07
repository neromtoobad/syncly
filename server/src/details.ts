// Business details from the order form: who the business is, how customers reach it, its links, what
// it sells, its photos, and how the owner wants it to look. Cleaned here (lengths, URLs, colours, ids)
// and turned into a readable brief, so the quote, the escrow terms and the email all show what was asked.
import { THEMES } from './site/themes.ts';
import { uploadExists } from './uploads.ts';
import { statementExists } from './statements.ts';
import { classify, cleanUrl, sanitizeBank, LINKS, type Bank } from './site/links.ts';

export const SECTION_CHOICES = ['offer', 'gallery', 'reviews', 'about', 'steps', 'location', 'faq'] as const;
export const KIND_CHOICES = ['food', 'beauty', 'creative', 'health', 'retail', 'professional', 'events', 'other'] as const;

export type BusinessDetails = {
  name: string;
  kind: (typeof KIND_CHOICES)[number];
  offer: string;
  area?: string;
  city?: string;
  whatsapp?: string;
  phone?: string;
  email?: string;
  address?: string;
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  maps?: string;
  website?: string;
  links?: string[]; // where they already sell, book and post: Chowdeck, Glovo, Paystack, Fresha, Tix... (see site/links.ts)
  bank?: Bank; // "pay by transfer" details for the site
  menu?: string; // "one per line: item – price"
  story?: string;
  style?: string; // a theme id, or "auto"
  colour?: string; // #rrggbb, or empty to take it from their photos
  sections?: string[];
  notes?: string;
  logo?: string; // upload id
  photos?: string[]; // upload ids
  // for Content Pack
  platforms?: string[];
  goal?: string;
  competitors?: string[]; // Instagram handles (Content Pack), business names (Get Found)
  tone?: string;
  // for Motion Ad and Video Ad
  promote?: string; // what the ad is for
  price?: string;
  cta?: 'whatsapp' | 'call' | 'visit' | 'website' | 'dm';
  format?: 'vertical' | 'square' | 'landscape';
  length?: number;
  // for Get Found
  questions?: string; // a question customers ask, put to the AI assistants
  searches?: string; // what customers type to find a business like this
  research?: string; // what the owner wants to know about their market (Market & Google Report)
  // for Ad Launch
  adGoal?: (typeof AD_GOALS)[number];
  adBudget?: string; // e.g. "₦5,000 a day"
  adPlatforms?: ('meta' | 'tiktok')[];
  audience?: string;
  adResults?: string[]; // upload ids: screenshots of the ads or boosts they already ran
  // for Product Photo Studio
  product?: string; // what is in the photos
  uses?: (typeof PHOTO_USES)[number][];
  look?: 'clean' | 'lifestyle' | 'bold';
  // for Buy Smart
  items?: string; // one per line, with quantity
  deliverTo?: string;
  budget?: string;
  condition?: 'new' | 'used' | 'any';
  sellers?: string; // sellers they are already talking to, one per line
  // for Flyers & Price Lists
  flyerKind?: 'promo' | 'pricelist' | 'announcement';
  // for Money Report: statement ids (src/statements.ts; private, deleted after the report)
  statements?: string[];
};
export const AD_GOALS = ['messages', 'sales', 'calls', 'visits', 'followers'] as const;
export const PHOTO_USES = ['instagram', 'whatsapp', 'marketplace', 'website'] as const;
export const PLATFORM_CHOICES = ['instagram', 'tiktok', 'whatsapp-status', 'facebook', 'x', 'linkedin'] as const;

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) || undefined : undefined);
const multiline = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) || undefined : undefined);
const url = (v: unknown) => {
  const t = s(v, 300);
  if (!t) return undefined;
  try { const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); return /^https?:$/.test(u.protocol) && u.hostname.includes('.') ? u.toString() : undefined; } catch { return undefined; }
};
const handle = (v: unknown) => { const t = s(v, 120); if (!t) return undefined; const h = t.replace(/^https?:\/\/(www\.)?(instagram|tiktok|facebook)\.com\/@?/i, '').replace(/^@/, '').replace(/[/?#].*$/, ''); return /^[\w.]{1,60}$/.test(h) ? h : undefined; };

const RELEVANT: Record<string, (keyof BusinessDetails)[]> = {
  website: ['whatsapp', 'phone', 'email', 'address', 'maps', 'instagram', 'tiktok', 'facebook', 'website', 'links', 'bank', 'menu', 'story', 'style', 'colour', 'sections', 'notes', 'logo', 'photos'],
  'content-pack': ['whatsapp', 'instagram', 'tiktok', 'website', 'competitors', 'platforms', 'goal', 'tone', 'colour', 'notes', 'photos'],
  'motion-ad': ['promote', 'price', 'cta', 'whatsapp', 'phone', 'instagram', 'website', 'address', 'format', 'length', 'colour', 'notes', 'logo', 'photos'],
  'video-ad': ['promote', 'price', 'cta', 'whatsapp', 'phone', 'instagram', 'website', 'address', 'colour', 'notes', 'logo', 'photos'],
  'ai-answer-audit': ['website', 'instagram', 'maps', 'menu', 'questions'],
  'get-found': ['website', 'instagram', 'maps', 'menu', 'questions', 'searches', 'whatsapp', 'phone', 'address', 'competitors', 'research'],
  'ad-launch': ['promote', 'price', 'cta', 'whatsapp', 'phone', 'instagram', 'website', 'address', 'colour', 'notes', 'logo', 'photos', 'competitors', 'adGoal', 'adBudget', 'adPlatforms', 'audience', 'adResults'],
  'product-photos': ['product', 'uses', 'look', 'colour', 'notes', 'logo', 'photos'],
  'buy-smart': ['items', 'deliverTo', 'budget', 'condition', 'sellers', 'notes'],
  flyers: ['flyerKind', 'promote', 'price', 'menu', 'cta', 'whatsapp', 'phone', 'instagram', 'website', 'address', 'colour', 'notes', 'logo', 'photos'],
  'money-report': ['statements', 'notes'],
};
const AD_SERVICES = ['motion-ad', 'video-ad', 'ad-launch'];

/** Links the site knows how to use (one per integration), from a list or pasted text. */
function linkList(raw: unknown): string[] | undefined {
  const all = (Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[\s,]+/) : []).map((x) => cleanUrl(x)).filter((x): x is string => !!x && !!classify(x));
  const seen = new Set<string>(), out = all.filter((u) => { const k = classify(u)!; return seen.has(k) ? false : (seen.add(k), true); });
  return out.length ? out.slice(0, 12) : undefined;
}

/** Throws a plain-English error when something required is missing (what's required depends on the service). */
export function cleanDetails(raw: any, service = 'website'): BusinessDetails {
  const name = s(raw?.name, 80), offer = s(raw?.offer, 220);
  if (!name) throw new Error('Add the business name.');
  if (!offer) throw new Error('Say in one line what the business sells.');
  const kind = (KIND_CHOICES as readonly string[]).includes(raw?.kind) ? raw.kind : 'other';
  const style = raw?.style === 'auto' || raw?.style in THEMES ? raw.style : 'auto';
  const colour = typeof raw?.colour === 'string' && /^#[0-9a-f]{6}$/i.test(raw.colour) ? raw.colour.toLowerCase() : undefined;
  const sections = Array.isArray(raw?.sections) ? raw.sections.filter((x: unknown) => (SECTION_CHOICES as readonly string[]).includes(x as string)) : undefined;
  const photos = Array.isArray(raw?.photos) ? raw.photos.filter((x: unknown) => typeof x === 'string' && uploadExists(x)).slice(0, 12) : undefined;
  const d: BusinessDetails = {
    name, kind, offer, area: s(raw?.area, 80), city: s(raw?.city, 60),
    whatsapp: s(raw?.whatsapp, 30), phone: s(raw?.phone, 30), email: s(raw?.email, 120), address: s(raw?.address, 200),
    instagram: handle(raw?.instagram), tiktok: handle(raw?.tiktok), facebook: handle(raw?.facebook), maps: url(raw?.maps), website: url(raw?.website),
    links: linkList(raw?.links), bank: sanitizeBank(raw?.bank ?? { bank: raw?.bankName, accountNumber: raw?.bankNumber, accountName: raw?.bankAccountName }),
    menu: multiline(raw?.menu, 2500), story: multiline(raw?.story, 800), style, colour, sections, notes: multiline(raw?.notes, 600),
    logo: typeof raw?.logo === 'string' && uploadExists(raw.logo) ? raw.logo : undefined, photos,
    platforms: Array.isArray(raw?.platforms) ? raw.platforms.filter((x: unknown) => (PLATFORM_CHOICES as readonly string[]).includes(x as string)) : undefined,
    goal: s(raw?.goal, 160), tone: s(raw?.tone, 120),
    competitors: service === 'get-found'
      ? (Array.isArray(raw?.competitors) ? raw.competitors : typeof raw?.competitors === 'string' ? raw.competitors.split(/[,\n;]+/) : []).map((x: unknown) => s(x, 80)).filter(Boolean).slice(0, 3) as string[]
      : Array.isArray(raw?.competitors) ? raw.competitors.map(handle).filter(Boolean).slice(0, 3) as string[] : typeof raw?.competitors === 'string' ? raw.competitors.split(/[\s,]+/).map(handle).filter(Boolean).slice(0, 3) as string[] : undefined,
    promote: s(raw?.promote, 200), price: s(raw?.price, 60),
    cta: ['whatsapp', 'call', 'visit', 'website', 'dm'].includes(raw?.cta) ? raw.cta : undefined,
    format: ['vertical', 'square', 'landscape'].includes(raw?.format) ? raw.format : undefined,
    length: [12, 16, 20, 24].includes(Number(raw?.length)) ? Number(raw.length) : undefined,
    questions: multiline(raw?.questions, 600), searches: s(raw?.searches, 200), research: multiline(raw?.research, 500),
    adGoal: (AD_GOALS as readonly string[]).includes(raw?.adGoal) ? raw.adGoal : undefined,
    adBudget: s(raw?.adBudget, 60), audience: s(raw?.audience, 200),
    adPlatforms: Array.isArray(raw?.adPlatforms) ? raw.adPlatforms.filter((x: unknown) => x === 'meta' || x === 'tiktok') : undefined,
    adResults: Array.isArray(raw?.adResults) ? raw.adResults.filter((x: unknown) => typeof x === 'string' && uploadExists(x)).slice(0, 4) : undefined,
    product: s(raw?.product, 160),
    uses: Array.isArray(raw?.uses) ? raw.uses.filter((x: unknown) => (PHOTO_USES as readonly string[]).includes(x as string)) : undefined,
    look: ['clean', 'lifestyle', 'bold'].includes(raw?.look) ? raw.look : undefined,
    items: multiline(raw?.items, 1200), deliverTo: s(raw?.deliverTo, 200), budget: s(raw?.budget, 60),
    condition: ['new', 'used', 'any'].includes(raw?.condition) ? raw.condition : undefined,
    sellers: multiline(raw?.sellers, 800),
    flyerKind: ['promo', 'pricelist', 'announcement'].includes(raw?.flyerKind) ? raw.flyerKind : undefined,
    statements: Array.isArray(raw?.statements) ? raw.statements.filter((x: unknown) => typeof x === 'string' && statementExists(x)).slice(0, 6) : undefined,
  };
  // The form keeps one draft across services; keep only what this service uses, so nothing stale leaks in.
  const keep = RELEVANT[service] ?? RELEVANT.website;
  for (const k of Object.keys(d) as (keyof BusinessDetails)[]) if (!['name', 'kind', 'offer', 'area', 'city'].includes(k) && !keep.includes(k)) delete d[k];
  if (AD_SERVICES.includes(service)) {
    if (d.cta !== 'call' && d.cta !== 'whatsapp') delete d.whatsapp, delete d.phone;
    if (d.cta !== 'visit') delete d.address;
  }
  const reach = d.whatsapp || d.phone || d.email || d.website;
  if (service === 'website' && !d.whatsapp && !d.phone && !d.email) throw new Error('Add at least one way for customers to reach the business: WhatsApp, phone or email.');
  if (AD_SERVICES.includes(service) && !reach && !d.instagram) throw new Error('Add how customers should respond to the ad: WhatsApp, phone, website or Instagram.');
  if ((service === 'ai-answer-audit' || service === 'get-found') && !d.city && !d.area) throw new Error('Add the area or city: Google and the AI assistants are searched from there.');
  if (service === 'product-photos' && !d.photos?.length) throw new Error('Upload at least one photo of the product.');
  if (service === 'buy-smart' && !d.items) throw new Error('List what you want to buy.');
  if (service === 'buy-smart' && !d.deliverTo && !d.city && !d.area) throw new Error('Add where it should be delivered.');
  if (service === 'flyers') {
    d.flyerKind ??= d.menu && !d.promote ? 'pricelist' : 'promo';
    if (d.flyerKind === 'pricelist' && !d.menu) throw new Error('Add your items and prices, one per line.');
    if (d.flyerKind !== 'pricelist' && !d.promote) throw new Error(d.flyerKind === 'announcement' ? 'Say what you are announcing.' : 'Say what the flyer is for.');
    if (!d.whatsapp && !d.phone && !d.instagram && !d.website && !d.address) throw new Error('Add how customers should reach you: WhatsApp, phone, Instagram, website or address.');
    d.cta ??= d.whatsapp ? 'whatsapp' : d.phone ? 'call' : d.instagram ? 'dm' : d.website ? 'website' : 'visit';
  }
  if (service === 'money-report' && !d.statements?.length) throw new Error('Upload your bank statement (PDF, CSV or screenshots).');
  if (service === 'ad-launch' && !d.adPlatforms?.length) d.adPlatforms = ['meta'];
  if (service === 'product-photos' && !d.uses?.length) d.uses = ['instagram', 'whatsapp'];
  if (service === 'content-pack' && !d.platforms?.length) d.platforms = ['instagram', 'tiktok'];
  return d;
}

/** The details as a readable brief: shown on the quote and the order, and hashed into the escrow terms. */
export function detailsBrief(d: BusinessDetails, service: string): string {
  if (service === 'money-report') return `A money report for ${d.name} (${d.offer}) from ${d.statements?.length ?? 0} statement file${d.statements?.length === 1 ? '' : 's'}.${d.notes ? `\nWhat they want to know: ${d.notes}` : ''}`;
  const what = ({ flyers: d.flyerKind === 'pricelist' ? 'A price list for' : d.flyerKind === 'announcement' ? 'An announcement flyer for' : 'A promo flyer for', website: 'A website for', 'content-pack': 'A content pack for', 'motion-ad': 'A motion ad for', 'video-ad': 'A video ad for', 'ai-answer-audit': 'An AI answer audit for', 'get-found': 'A market and Google report for', 'ad-launch': 'An ad campaign for', 'product-photos': 'Product photos for', 'buy-smart': 'Buying for' } as Record<string, string>)[service] ?? 'For';
  const GOAL: Record<string, string> = { messages: 'more WhatsApp or DM messages', sales: 'more sales on the website', calls: 'more phone calls', visits: 'more people visiting the shop', followers: 'more followers' };
  const ctaText = d.cta ? ({ whatsapp: `Order on WhatsApp ${d.whatsapp ?? d.phone ?? ''}`, call: `Call ${d.phone ?? d.whatsapp ?? ''}`, visit: `Visit us${d.address ? ` at ${d.address}` : ''}`, website: `Order at ${d.website ?? ''}`, dm: `DM us on Instagram @${d.instagram ?? ''}` } as const)[d.cta].trim() : undefined;
  const lines = [
    `${what} ${d.name}: ${d.offer}${d.area || d.city ? ` (${[d.area, d.city].filter(Boolean).join(', ')})` : ''}.`,
    d.promote && `Promote: ${d.promote}`, d.price && `Price: ${d.price}`, ctaText && `Call to action: ${ctaText}`,
    d.format && `Format: ${d.format}${d.length ? `, ${d.length} seconds` : ''}`,
    d.platforms?.length && service === 'content-pack' && `Platforms: ${d.platforms.join(', ')}`, d.goal && `Goal: ${d.goal}`, d.tone && `Tone: ${d.tone}`,
    d.competitors?.length && `Competitors: ${d.competitors.map((c) => (service === 'get-found' ? c : `@${c}`)).join(', ')}`,
    d.questions && `Questions customers ask:\n${d.questions}`, d.searches && `Customers search for: ${d.searches}`, d.research && `Wants to know about the market: ${d.research}`,
    d.adGoal && `Ad goal: ${GOAL[d.adGoal]}`, d.adBudget && `Ad budget: ${d.adBudget}`, d.adPlatforms?.length && service === 'ad-launch' && `Run on: ${d.adPlatforms.map((p) => (p === 'meta' ? 'Instagram and Facebook' : 'TikTok')).join(', ')}`,
    d.audience && `Who buys: ${d.audience}`, d.adResults?.length && `Current ad results: ${d.adResults.length} screenshot${d.adResults.length === 1 ? '' : 's'}`,
    d.product && `Product: ${d.product}`, d.uses?.length && service === 'product-photos' && `For: ${d.uses.map((u) => ({ whatsapp: 'WhatsApp catalogue and Status', marketplace: 'Jumia, Jiji and Konga listings' } as Record<string, string>)[u] ?? u).join(', ')}`, d.look && `Look: ${d.look}`,
    d.items && `To buy:\n${d.items}`, d.condition && d.condition !== 'any' && `Condition: ${d.condition}`, d.budget && `Budget: ${d.budget}`, d.deliverTo && `Deliver to: ${d.deliverTo}`,
    d.sellers && `Sellers already considered:\n${d.sellers}`,
    d.whatsapp && `WhatsApp: ${d.whatsapp}`, d.phone && d.phone !== d.whatsapp && `Phone: ${d.phone}`, d.email && `Email: ${d.email}`, d.address && `Address: ${d.address}`,
    d.instagram && `Instagram: @${d.instagram}`, d.tiktok && `TikTok: @${d.tiktok}`, d.facebook && `Facebook: ${d.facebook}`, d.maps && `Google Maps: ${d.maps}`, d.website && `Current website: ${d.website}`,
    d.links?.length && `Links: ${d.links.map((u) => `${LINKS[classify(u)!].label} ${u}`).join(', ')}`,
    d.bank && `Pay by transfer: ${d.bank.bank} ${d.bank.accountNumber} (${d.bank.accountName})`,
    d.menu && `Menu / prices:\n${d.menu}`, d.story && `About: ${d.story}`,
    d.style && d.style !== 'auto' && `Look: ${d.style}`, d.colour && `Brand colour: ${d.colour}`,
    service === 'website' && d.sections?.length && d.sections.length < SECTION_CHOICES.length && `Sections wanted: ${d.sections.join(', ')}`,
    (d.photos?.length || d.logo) && `Uploaded: ${d.logo ? 'logo' : ''}${d.logo && d.photos?.length ? ' + ' : ''}${d.photos?.length ? `${d.photos.length} photo${d.photos.length === 1 ? '' : 's'}` : ''}`,
    d.notes && `Notes: ${d.notes}`,
  ];
  return lines.filter(Boolean).join('\n');
}

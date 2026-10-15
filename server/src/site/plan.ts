// The site plan: the only thing the model writes. It picks a theme, a brand colour from candidates, the
// sections in order with one variant each, which real photos, items and reviews go where, and short
// copy for fixed slots with hard length limits. validatePlan() repairs what it can and reports the rest.
import { usableNumber, type Facts, type Kind } from './facts.ts';
import { THEMES, type ThemeId } from './themes.ts';

export type Action = 'whatsapp' | 'call' | 'directions' | 'menu' | 'book';

export type Section =
  | { kind: 'strip' }
  | { kind: 'offer'; variant: 'menu' | 'cards' | 'features'; title: string; intro?: string; items: { id: string; desc?: string; photo?: string }[] }
  | { kind: 'gallery'; variant: 'grid' | 'strip'; title?: string; photos: string[] }
  | { kind: 'reviews'; variant: 'quotes' | 'summary'; title: string; ids: string[] }
  | { kind: 'about'; variant: 'split' | 'statement'; title: string; body: string; photo?: string }
  | { kind: 'steps'; title: string; steps: { title: string; body: string }[] }
  | { kind: 'location'; variant: 'map' | 'card'; title: string; note?: string }
  | { kind: 'faq'; title: string; items: { q: string; a: string }[] }
  | { kind: 'cta'; variant: 'band' | 'card'; headline: string; sub?: string; action: Action };

export type Plan = {
  theme: ThemeId;
  brand: string; // hex, one of the candidates (or the theme default when none)
  title: string; // <title>
  description: string; // meta description
  hero: { variant: 'photo' | 'split' | 'stack' | 'type'; eyebrow?: string; headline: string; accent?: string; sub: string; photo?: string; primary: Action; secondary?: Action };
  sections: Section[];
  whatsappText: string; // the pre-filled WhatsApp message
};

/** Slot limits (characters). Copy past a limit is cut at a word boundary and reported. */
export const LIMITS = { title: 60, description: 155, eyebrow: 42, headline: 58, accent: 24, sub: 150, sectionTitle: 44, intro: 160, desc: 96, body: 520, stepTitle: 30, stepBody: 110, note: 130, q: 80, a: 240, ctaHeadline: 60, ctaSub: 130, whatsappText: 120 };

/** Which sections suit each kind of business, in a sensible default order. */
export const RECIPES: Record<Kind, Section['kind'][]> = {
  food: ['strip', 'offer', 'gallery', 'reviews', 'steps', 'location', 'faq', 'cta'],
  beauty: ['strip', 'offer', 'gallery', 'reviews', 'about', 'location', 'faq', 'cta'],
  creative: ['gallery', 'offer', 'reviews', 'about', 'steps', 'faq', 'cta'],
  events: ['gallery', 'offer', 'reviews', 'steps', 'about', 'faq', 'cta'],
  health: ['strip', 'offer', 'about', 'reviews', 'location', 'faq', 'cta'],
  retail: ['strip', 'offer', 'gallery', 'reviews', 'steps', 'location', 'faq', 'cta'],
  professional: ['offer', 'about', 'reviews', 'steps', 'faq', 'location', 'cta'],
  other: ['strip', 'offer', 'gallery', 'reviews', 'about', 'location', 'faq', 'cta'],
};

/** The section catalogue, as the model reads it. */
export const CATALOGUE = `Sections (use each kind at most once; the hero always comes first and the footer is automatic):
- strip: a row of quick facts under the hero (open now, area, Google rating, starting price). No fields. Only if at least two of hours/area/rating/prices are known.
- offer: what they sell. variant "menu" (a price list with dotted leaders, best for food and services with prices), "cards" (product or service cards, optional photo each), "features" (3–4 big alternating photo + text rows, for services without prices). Fields: title, intro?, items[{id (from the facts item list), desc? (one line), photo? (photo id)}]. Prices are shown automatically from the facts; never write a price.
- gallery: variant "grid" (one big + several small) or "strip" (a swipeable row of tall photos). Fields: title?, photos[ids]. Use 4–8 good photos; never flyers or text-heavy images.
- reviews: variant "quotes" (2–3 big quote cards) or "summary" (the Google rating large, quotes beside). Fields: title, ids[review ids]. Quotes are shown word for word from the facts.
- about: variant "split" (photo + story) or "statement" (one big sentence + a short paragraph). Fields: title, body, photo?. Only facts from the sources; no invented years, awards, founders or numbers.
- steps: how to order, book or buy, 3–4 steps. Fields: title, steps[{title, body}]. Base them on how the business actually works (WhatsApp, delivery, payment) per the facts.
- location: variant "map" (map, address, hours, directions) or "card" (address and hours on a coloured card, no map). Fields: title, note? (a landmark or parking tip from the facts). Only if an address is known.
- faq: 3–5 questions customers really ask, answered ONLY from the facts. Fields: title, items[{q, a}]. Skip if the facts can't answer at least 3.
- cta: the closing call to action. variant "band" (full-width brand colour) or "card". Fields: headline, sub?, action ("whatsapp" | "call" | "book" | "menu").
Hero variants: "photo" (full-bleed photo with the headline over it; needs a strong landscape-friendly photo), "split" (text beside a photo), "stack" (huge headline, wide photo under it), "type" (no photo: big type on brand colour; use when there are no good photos).
Actions: "whatsapp", "call", "directions", "menu" (jumps to the offer), "book" (opens WhatsApp with a booking message).`;

const cut = (s: string | undefined, n: number, path: string, notes: string[]) => {
  if (s === undefined || s === null) return s;
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  notes.push(`${path} was ${t.length} characters (limit ${n}); cut`);
  const c = t.slice(0, n + 1);
  return (c.lastIndexOf(' ') > n * 0.6 ? c.slice(0, c.lastIndexOf(' ')) : t.slice(0, n)).replace(/[,;:\-–—]+$/, '');
};

/**
 * Checks the plan against the facts and the catalogue. Unknown ids are dropped, missing essentials
 * are filled from defaults, long copy is cut. Returns the plan that will render and what was fixed.
 */
export function validatePlan(raw: any, facts: Facts, photos: { id: string; kind: string }[], candidates: string[]): { plan: Plan; notes: string[] } {
  const notes: string[] = [];
  const photoIds = new Set(photos.filter((p) => p.kind !== 'flyer' && p.kind !== 'logo').map((p) => p.id));
  const itemIds = new Set(facts.items.map((i) => i.id));
  const reviewIds = new Set(facts.reviews.map((r) => r.id));
  const theme: ThemeId = raw?.theme in THEMES ? raw.theme : 'atelier';
  if (raw?.theme !== theme) notes.push(`unknown theme "${raw?.theme}"; used atelier`);
  const brand = typeof raw?.brand === 'string' && /^#[0-9a-f]{6}$/i.test(raw.brand) ? raw.brand : candidates[0] ?? '#2E6B4F';
  const action = (a: any, d: Action): Action => (['whatsapp', 'call', 'directions', 'menu', 'book'].includes(a) ? a : d);
  const canChat = !!usableNumber(facts.country, facts.whatsapp, facts.phone);
  const h = raw?.hero ?? {};
  let heroVariant = ['photo', 'split', 'stack', 'type'].includes(h.variant) ? h.variant : 'split';
  const heroPhoto = photoIds.has(h.photo) ? h.photo : undefined;
  if (heroVariant !== 'type' && !heroPhoto) { heroVariant = 'type'; notes.push('hero had no usable photo; switched to the type-only hero'); }
  const plan: Plan = {
    theme, brand,
    title: cut(raw?.title, LIMITS.title, 'title', notes) || `${facts.name}${facts.area ? ` · ${facts.area}` : ''}`,
    description: cut(raw?.description, LIMITS.description, 'description', notes) || facts.offer.slice(0, LIMITS.description),
    hero: {
      variant: heroVariant, photo: heroPhoto,
      eyebrow: cut(h.eyebrow, LIMITS.eyebrow, 'hero.eyebrow', notes),
      headline: cut(h.headline, LIMITS.headline, 'hero.headline', notes) || facts.name,
      accent: cut(h.accent, LIMITS.accent, 'hero.accent', notes),
      sub: cut(h.sub, LIMITS.sub, 'hero.sub', notes) || facts.offer,
      primary: action(h.primary, canChat ? 'whatsapp' : 'directions'),
      secondary: h.secondary ? action(h.secondary, 'call') : undefined,
    },
    sections: [],
    whatsappText: cut(raw?.whatsappText, LIMITS.whatsappText, 'whatsappText', notes) || `Hello ${facts.name}, I found you online and I'd like to make an enquiry.`,
  };
  if (plan.hero.accent && !plan.hero.headline.includes(plan.hero.accent)) plan.hero.accent = undefined;
  const seen = new Set<string>();
  for (const [i, s] of (Array.isArray(raw?.sections) ? raw.sections : []).entries()) {
    const k = s?.kind;
    if (!k || seen.has(k)) continue;
    const p = `sections[${i}]`;
    switch (k) {
      case 'strip': plan.sections.push({ kind: 'strip' }); break;
      case 'offer': {
        const items = (s.items ?? []).filter((x: any) => itemIds.has(x?.id)).map((x: any, j: number) => ({ id: x.id, desc: cut(x.desc, LIMITS.desc, `${p}.items[${j}].desc`, notes), photo: photoIds.has(x.photo) ? x.photo : undefined }));
        if (!items.length && facts.items.length) items.push(...facts.items.slice(0, 8).map((x) => ({ id: x.id })));
        if (!items.length) { notes.push('offer section had no items from the facts; dropped'); break; }
        plan.sections.push({ kind: 'offer', variant: ['menu', 'cards', 'features'].includes(s.variant) ? s.variant : 'cards', title: cut(s.title, LIMITS.sectionTitle, `${p}.title`, notes) || 'What we offer', intro: cut(s.intro, LIMITS.intro, `${p}.intro`, notes), items });
        break;
      }
      case 'gallery': {
        const ph = (s.photos ?? []).filter((x: string) => photoIds.has(x) && x !== heroPhoto);
        if (ph.length < 3) { notes.push('gallery had fewer than 3 usable photos; dropped'); break; }
        plan.sections.push({ kind: 'gallery', variant: s.variant === 'strip' ? 'strip' : 'grid', title: cut(s.title, LIMITS.sectionTitle, `${p}.title`, notes), photos: ph.slice(0, 8) });
        break;
      }
      case 'reviews': {
        const ids = (s.ids ?? []).filter((x: string) => reviewIds.has(x));
        if (!ids.length) { notes.push('no real reviews to show; reviews section dropped'); break; }
        plan.sections.push({ kind: 'reviews', variant: s.variant === 'summary' && facts.rating ? 'summary' : 'quotes', title: cut(s.title, LIMITS.sectionTitle, `${p}.title`, notes) || 'What customers say', ids: ids.slice(0, 3) });
        break;
      }
      case 'about': {
        if (!s.body) break;
        plan.sections.push({ kind: 'about', variant: s.variant === 'statement' ? 'statement' : 'split', title: cut(s.title, LIMITS.sectionTitle, `${p}.title`, notes) || 'About us', body: cut(s.body, LIMITS.body, `${p}.body`, notes)!, photo: photoIds.has(s.photo) ? s.photo : undefined });
        break;
      }
      case 'steps': {
        const st = (s.steps ?? []).slice(0, 4).map((x: any, j: number) => ({ title: cut(x?.title, LIMITS.stepTitle, `${p}.steps[${j}].title`, notes) ?? '', body: cut(x?.body, LIMITS.stepBody, `${p}.steps[${j}].body`, notes) ?? '' })).filter((x: any) => x.title);
        if (st.length < 2) break;
        plan.sections.push({ kind: 'steps', title: cut(s.title, LIMITS.sectionTitle, `${p}.title`, notes) || 'How it works', steps: st });
        break;
      }
      case 'location': {
        if (!facts.address) { notes.push('no address known; location section dropped'); break; }
        plan.sections.push({ kind: 'location', variant: s.variant === 'card' ? 'card' : 'map', title: cut(s.title, LIMITS.sectionTitle, `${p}.title`, notes) || 'Visit us', note: cut(s.note, LIMITS.note, `${p}.note`, notes) });
        break;
      }
      case 'faq': {
        const items = (s.items ?? []).slice(0, 6).map((x: any, j: number) => ({ q: cut(x?.q, LIMITS.q, `${p}.items[${j}].q`, notes) ?? '', a: cut(x?.a, LIMITS.a, `${p}.items[${j}].a`, notes) ?? '' })).filter((x: any) => x.q && x.a);
        if (items.length < 2) break;
        plan.sections.push({ kind: 'faq', title: cut(s.title, LIMITS.sectionTitle, `${p}.title`, notes) || 'Questions', items });
        break;
      }
      case 'cta': plan.sections.push({ kind: 'cta', variant: s.variant === 'card' ? 'card' : 'band', headline: cut(s.headline, LIMITS.ctaHeadline, `${p}.headline`, notes) || `Ready when you are`, sub: cut(s.sub, LIMITS.ctaSub, `${p}.sub`, notes), action: action(s.action, canChat ? 'whatsapp' : 'call') }); break;
      default: notes.push(`unknown section "${k}" dropped`); continue;
    }
    seen.add(k);
  }
  if (!plan.sections.some((s) => s.kind === 'offer') && facts.items.length) plan.sections.unshift({ kind: 'offer', variant: facts.items.some((i) => i.price) ? 'menu' : 'cards', title: 'What we offer', items: facts.items.slice(0, 8).map((x) => ({ id: x.id })) });
  if (!plan.sections.some((s) => s.kind === 'cta')) plan.sections.push({ kind: 'cta', variant: 'band', headline: 'Ready when you are', action: canChat ? 'whatsapp' : 'call' });
  // messages the owner pasted from their customers always make it on: up to two beside the Google reviews, or a
  // section of their own before the questions and the call to action
  const msgs = facts.reviews.filter((r) => r.source === 'message').map((r) => r.id);
  if (msgs.length) {
    const rs = plan.sections.find((s) => s.kind === 'reviews') as Extract<Section, { kind: 'reviews' }> | undefined;
    if (rs && !rs.ids.some((id) => msgs.includes(id))) { const take = Math.min(2, msgs.length); rs.ids = [...rs.ids.slice(0, Math.max(1, 3 - take)), ...msgs.slice(0, take)]; }
    else if (!rs) {
      const at = plan.sections.findIndex((s) => s.kind === 'faq' || s.kind === 'cta' || s.kind === 'location');
      plan.sections.splice(at < 0 ? plan.sections.length : at, 0, { kind: 'reviews', variant: 'quotes', title: 'What customers say', ids: msgs.slice(0, 3) });
    }
  }
  return { plan, notes };
}

/** A sensible plan from the facts alone: used in demo runs and whenever the model's plan is unusable. */
export function defaultPlan(f: Facts, photos: { id: string; kind: string; quality: number }[], candidates: string[]): Plan {
  const good = photos.filter((p) => !['flyer', 'logo'].includes(p.kind)).sort((a, b) => b.quality - a.quality);
  const theme: ThemeId = ({ food: 'atelier', beauty: 'salon', creative: 'studio', events: 'salon', health: 'clinic', retail: 'market', professional: 'clinic', other: 'atelier' } as const)[f.kind];
  const hero = good[0];
  const priced = f.items.some((i) => i.price);
  const where = [f.area, f.city].filter(Boolean).join(', ');
  const sections: Section[] = [];
  for (const k of RECIPES[f.kind]) {
    if (k === 'strip') sections.push({ kind: 'strip' });
    if (k === 'offer' && f.items.length) sections.push({ kind: 'offer', variant: priced ? 'menu' : 'cards', title: f.kind === 'food' ? 'The menu' : priced ? 'Prices' : 'What we do', items: f.items.slice(0, 10).map((i) => ({ id: i.id })) });
    if (k === 'gallery' && good.length >= 4) sections.push({ kind: 'gallery', variant: 'grid', title: 'Recent work', photos: good.slice(1, 10).map((p) => p.id) });
    if (k === 'reviews' && f.reviews.length) sections.push({ kind: 'reviews', variant: f.rating ? 'summary' : 'quotes', title: 'What customers say', ids: f.reviews.slice(0, 3).map((r) => r.id) });
    if (k === 'location' && f.address) sections.push({ kind: 'location', variant: 'map', title: where ? `Find us in ${f.area ?? f.city}` : 'Find us', note: f.landmark });
  }
  sections.push({ kind: 'cta', variant: 'band', headline: usableNumber(f.country, f.whatsapp, f.phone) ? 'Message us on WhatsApp' : 'Get in touch', action: f.whatsapp ?? f.phone ? 'whatsapp' : 'call' });
  return {
    theme, brand: candidates[0] ?? '#2E6B4F',
    title: `${f.name}${where ? ` · ${where}` : ''}`.slice(0, 60),
    description: f.offer.slice(0, 155),
    hero: { variant: hero ? 'split' : 'type', photo: hero?.id, eyebrow: [f.category, where].filter(Boolean).join(' · ').slice(0, 42) || undefined, headline: f.name, sub: f.offer.slice(0, 150), primary: f.whatsapp ?? f.phone ? 'whatsapp' : 'directions', secondary: f.items.length ? 'menu' : undefined },
    sections,
    whatsappText: `Hello ${f.name}, I found you online and I'd like to make an enquiry.`,
  };
}

/**
 * Products with no photo get the photo that shows them: an item and a photo match when the item's name shares a
 * word with what the vision model said the photo shows ("Beaded earrings" ↔ "beaded earrings on a gold stand").
 * A photo goes to one item only and never one already used in the hero or the about section. When most of a
 * shop's items end up with a photo, the price list becomes product cards (a catalogue sells better than a list).
 */
export function matchItemPhotos(plan: Plan, facts: Facts, photos: { id: string; kind: string; subject?: string; quality: number }[]): Plan {
  const offer = plan.sections.find((s) => s.kind === 'offer') as Extract<Section, { kind: 'offer' }> | undefined;
  if (!offer || !offer.items.length) return plan;
  const about = plan.sections.find((s) => s.kind === 'about') as Extract<Section, { kind: 'about' }> | undefined;
  const STOP = new Set(['and', 'the', 'for', 'with', 'our', 'your', 'from', 'set', 'pack', 'piece', 'pcs', 'size', 'small', 'large', 'big', 'new']);
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.replace(/(es|s)$/, '')));
  const taken = new Set([plan.hero.photo, about?.photo, ...offer.items.map((i) => i.photo)].filter((x): x is string => !!x));
  const usable = photos.filter((p) => !['flyer', 'logo'].includes(p.kind) && p.quality >= 3);
  for (const it of offer.items) {
    if (it.photo) continue;
    const item = facts.items.find((x) => x.id === it.id);
    if (!item) continue;
    const iw = words(item.name);
    let best: (typeof usable)[number] | undefined, score = 0;
    for (const p of usable) {
      if (taken.has(p.id)) continue;
      const pw = words(p.subject ?? ''), sc = [...iw].filter((w) => pw.has(w)).length;
      if (sc > score) { score = sc; best = p; }
    }
    if (best) { it.photo = best.id; taken.add(best.id); }
  }
  const pictured = offer.items.filter((i) => i.photo).length;
  if (offer.variant === 'menu' && ['retail', 'creative', 'beauty'].includes(facts.kind) && offer.items.length <= 9 && pictured >= Math.ceil(offer.items.length * 0.7)) offer.variant = 'cards';
  return plan;
}
